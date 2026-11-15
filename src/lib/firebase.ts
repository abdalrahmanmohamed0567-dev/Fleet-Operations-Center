import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { OperationalSettings, UserProfile } from '../types/fleet';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const typedFirebaseConfig = firebaseConfig as typeof firebaseConfig & { firestoreDatabaseId?: string };
const app = initializeApp(typedFirebaseConfig);
export const db = getFirestore(app, typedFirebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Strict in-memory token cache (never localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{ providerId?: string | null; email?: string | null }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function isSigningInNow(): boolean {
  return isSigningIn;
}

export async function signInWithGoogle(): Promise<{ user: User; driveAccessToken: string | null }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedDriveAccessToken = credential?.accessToken ?? null;
    return { user: result.user, driveAccessToken: cachedDriveAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function refreshDriveTokenWithPopup(): Promise<string | null> {
  const { driveAccessToken } = await signInWithGoogle();
  return driveAccessToken;
}

export async function logoutUser(): Promise<void> {
  cachedDriveAccessToken = null;
  await signOut(auth);
}

export function subscribeAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedDriveAccessToken = null;
    }
    cb(user);
  });
}

export const BOOTSTRAPPED_OWNER_EMAIL = 'abdalrahmanmohamed0567@gmail.com';

export function getUserAllowedPlatforms(profile: UserProfile | null | undefined): ('hungerstation' | 'keeta')[] {
  if (!profile) return [];
  if (profile.role === 'owner' || profile.role === 'admin') {
    return ['hungerstation', 'keeta'];
  }
  const list = Array.isArray(profile.allowedPlatforms)
    ? profile.allowedPlatforms.filter((p): p is 'hungerstation' | 'keeta' => p === 'hungerstation' || p === 'keeta')
    : [];
  return list.length > 0 ? Array.from(new Set(list)) : ['hungerstation', 'keeta'];
}

export function canAccessGlobalHub(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === 'owner' || profile.role === 'admin') return true;
  if (profile.role === 'operations_manager') {
    const platforms = getUserAllowedPlatforms(profile);
    return platforms.includes('hungerstation') && platforms.includes('keeta');
  }
  return false;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    return snap.data() as UserProfile;
  }

  const isOwner =
    user.emailVerified &&
    (user.email || '').trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;

  const email = (user.email || '').trim().slice(0, 200);
  const rawName = (user.displayName || email.split('@')[0] || 'مستخدم').trim();
  const displayName = (rawName || 'مستخدم').slice(0, 120);

  const profilePayload = {
    uid: user.uid,
    email,
    displayName,
    role: isOwner ? 'owner' : 'viewer',
    active: isOwner ? true : false,
    allowedPlatforms: ['hungerstation', 'keeta'],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, profilePayload);
    const createdSnap = await getDoc(ref);
    return createdSnap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export const DEFAULT_OPERATIONAL_SETTINGS: Omit<OperationalSettings, 'createdByUid' | 'allowedUids' | 'updatedAt'> = {
  settingsId: 'default',
  minDailyWorkingHours: 8,
  minDailyOrders: 12,
  maxOverdueRatePct: 8,
  maxCancellationRatePct: 5,
  minAcceptanceRatePct: 85,
  minCompletionRatePct: 92,
  minOnTimeRatePct: 88,
  minAttendanceRatePct: 90,
  minFacialPassRatePct: 90,
  minWalletBalance: 0,
  minDeliveryQualityScore: 80,
  errorRepeatRiderThreshold: 2,
  errorSpikeDailyThreshold: 5,
  errorSpikeMultiplierPct: 150,
  errorSpreadRidersThreshold: 5,
  errorBranchConcentrationPct: 40,
  alertOnNewErrorCode: true,
  scoreWeightProductivity: 25,
  scoreWeightHours: 15,
  scoreWeightCommitment: 20,
  scoreWeightQuality: 20,
  scoreWeightAcceptance: 10,
  scoreWeightCancellation: 10,
  minActiveOrdersPerDay: 1,
  minActiveHoursPerDay: 1,
  caseOverdueDays: 3,
  configuredBranches: [],
  importMaxFiles: 10,
  importAllowUpdates: true,
  importStrictDates: true,
  keetaEnabled: false,
  keetaHidden: true,
  expiryAlertDays: [90, 60, 30, 7, 0],
  customVehicleTypes: ['سيارة سيدان', 'فان / توصيل', 'دراجة نارية', 'دراجة كهربائية'],
};

export function hydrateOperationalSettings(raw: Partial<OperationalSettings>): OperationalSettings {
  return {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    ...raw,
    errorRepeatRiderThreshold: raw.errorRepeatRiderThreshold ?? DEFAULT_OPERATIONAL_SETTINGS.errorRepeatRiderThreshold,
    errorSpikeDailyThreshold: raw.errorSpikeDailyThreshold ?? DEFAULT_OPERATIONAL_SETTINGS.errorSpikeDailyThreshold,
    errorSpikeMultiplierPct: raw.errorSpikeMultiplierPct ?? DEFAULT_OPERATIONAL_SETTINGS.errorSpikeMultiplierPct,
    errorSpreadRidersThreshold: raw.errorSpreadRidersThreshold ?? DEFAULT_OPERATIONAL_SETTINGS.errorSpreadRidersThreshold,
    errorBranchConcentrationPct: raw.errorBranchConcentrationPct ?? DEFAULT_OPERATIONAL_SETTINGS.errorBranchConcentrationPct,
    alertOnNewErrorCode: raw.alertOnNewErrorCode ?? DEFAULT_OPERATIONAL_SETTINGS.alertOnNewErrorCode,
    scoreWeightProductivity: raw.scoreWeightProductivity ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightProductivity,
    scoreWeightHours: raw.scoreWeightHours ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightHours,
    scoreWeightCommitment: raw.scoreWeightCommitment ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightCommitment,
    scoreWeightQuality: raw.scoreWeightQuality ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightQuality,
    scoreWeightAcceptance: raw.scoreWeightAcceptance ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightAcceptance,
    scoreWeightCancellation: raw.scoreWeightCancellation ?? DEFAULT_OPERATIONAL_SETTINGS.scoreWeightCancellation,
    minActiveOrdersPerDay: raw.minActiveOrdersPerDay ?? DEFAULT_OPERATIONAL_SETTINGS.minActiveOrdersPerDay,
    minActiveHoursPerDay: raw.minActiveHoursPerDay ?? DEFAULT_OPERATIONAL_SETTINGS.minActiveHoursPerDay,
    caseOverdueDays: raw.caseOverdueDays ?? DEFAULT_OPERATIONAL_SETTINGS.caseOverdueDays,
    configuredBranches: Array.isArray(raw.configuredBranches) ? raw.configuredBranches : [],
    importMaxFiles: raw.importMaxFiles ?? DEFAULT_OPERATIONAL_SETTINGS.importMaxFiles,
    importAllowUpdates: raw.importAllowUpdates ?? DEFAULT_OPERATIONAL_SETTINGS.importAllowUpdates,
    importStrictDates: raw.importStrictDates ?? DEFAULT_OPERATIONAL_SETTINGS.importStrictDates,
    keetaEnabled: raw.keetaEnabled ?? false,
    keetaHidden: raw.keetaHidden ?? true,
    expiryAlertDays:
      Array.isArray(raw.expiryAlertDays) && raw.expiryAlertDays.length > 0
        ? raw.expiryAlertDays
        : DEFAULT_OPERATIONAL_SETTINGS.expiryAlertDays,
    customVehicleTypes:
      Array.isArray(raw.customVehicleTypes) && raw.customVehicleTypes.length > 0
        ? raw.customVehicleTypes
        : DEFAULT_OPERATIONAL_SETTINGS.customVehicleTypes,
    createdByUid: raw.createdByUid || '',
    allowedUids: Array.isArray(raw.allowedUids) ? raw.allowedUids : [],
  };
}

export async function ensureOperationalSettings(
  uid: string,
  email: string,
  canCreate = true
): Promise<OperationalSettings> {
  const path = 'operationalSettings/default';
  const ref = doc(db, 'operationalSettings', 'default');
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    return hydrateOperationalSettings(snap.data() as OperationalSettings);
  }

  if (!canCreate) {
    return {
      ...DEFAULT_OPERATIONAL_SETTINGS,
      createdByUid: uid,
      allowedUids: [uid],
      updatedByEmail: email,
    };
  }

  const payload = {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    createdByUid: uid,
    allowedUids: [uid],
    updatedByEmail: email.slice(0, 200),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, payload);
    const created = await getDoc(ref);
    return hydrateOperationalSettings(created.data() as OperationalSettings);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export const DEFAULT_DOCUMENT_TYPES = [
  { typeId: 'iqama', nameAr: 'صورة الإقامة', nameEn: 'Iqama ID', targetEntity: 'rider' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'driver_license', nameAr: 'رخصة القيادة', nameEn: 'Driver License', targetEntity: 'rider' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'passport', nameAr: 'جواز السفر', nameEn: 'Passport', targetEntity: 'rider' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'employment_contract', nameAr: 'عقد العمل', nameEn: 'Employment Contract', targetEntity: 'rider' as const, requiresExpiry: false, isDefault: true, active: true },
  { typeId: 'vehicle_istimara', nameAr: 'استمارة المركبة', nameEn: 'Vehicle Istimara', targetEntity: 'vehicle' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'vehicle_insurance', nameAr: 'وثيقة التأمين', nameEn: 'Vehicle Insurance', targetEntity: 'vehicle' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'vehicle_inspection', nameAr: 'الفحص الدوري', nameEn: 'Periodic Inspection', targetEntity: 'vehicle' as const, requiresExpiry: true, isDefault: true, active: true },
  { typeId: 'handover_photo', nameAr: 'صور تسليم/استلام العهدة', nameEn: 'Handover Photo', targetEntity: 'handover' as const, requiresExpiry: false, isDefault: true, active: true },
];

