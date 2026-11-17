import type { FleetConfigSettings, OperationalSettings, UserProfile } from '../types/fleet';
import {
  doc,
  erpDbClient,
  getDoc,
  readStoredSessionToken,
  serverTimestamp,
  setDoc,
  writeStoredSessionToken,
} from './erpDb';
import { safeParseJsonResponse } from './safeFetch';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

export const db = erpDbClient;

// Retained lightweight auth handle for backward compatibility; session state is managed via server session tokens
export const auth: {
  currentUser: {
    uid: string;
    email: string;
    getIdToken: () => Promise<string>;
  } | null;
} = {
  currentUser: null,
};

let cachedDriveAccessToken: string | null = null;
let cachedSessionProfile: UserProfile | null = null;

export function syncAuthHandle(profile: UserProfile | null): void {
  cachedSessionProfile = profile;
  if (!profile) {
    auth.currentUser = null;
  } else {
    auth.currentUser = {
      uid: profile.uid,
      email: profile.email,
      getIdToken: async () => {
        const tok = readStoredSessionToken();
        if (!tok) throw new Error('انتهت جلسة تسجيل الدخول.');
        return tok;
      },
    };
  }
}

export function getSessionToken(): string | null {
  return readStoredSessionToken();
}

export function setSessionToken(token: string | null): void {
  writeStoredSessionToken(token);
}

export async function getActiveAuthToken(): Promise<string | null> {
  return readStoredSessionToken();
}

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
      userId: cachedSessionProfile?.uid || auth.currentUser?.uid || null,
      email: cachedSessionProfile?.email || auth.currentUser?.email || null,
    },
    operationType,
    path,
  };
  console.error('Database Error: ', JSON.stringify(errInfo));
  throw new Error(error instanceof Error ? error.message : JSON.stringify(errInfo));
}

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export async function refreshDriveTokenWithPopup(): Promise<string | null> {
  return cachedDriveAccessToken;
}

export async function loginWithPhonePassword(
  phone: string,
  password: string
): Promise<{ token: string; profile: UserProfile }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const json = await safeParseJsonResponse<{ ok?: boolean; token?: string; profile?: UserProfile; error?: string }>(res);
  if (!res.ok || !json.token || !json.profile) {
    throw new Error(json.error || 'رقم الجوال أو كلمة المرور غير صحيحة.');
  }
  writeStoredSessionToken(json.token);
  syncAuthHandle(json.profile);
  return { token: json.token, profile: json.profile };
}

export async function fetchCurrentSessionProfile(): Promise<UserProfile | null> {
  const token = readStoredSessionToken();
  if (!token) {
    syncAuthHandle(null);
    return null;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      writeStoredSessionToken(null);
      syncAuthHandle(null);
      return null;
    }
    const json = await safeParseJsonResponse<{ ok?: boolean; profile?: UserProfile }>(res);
    if (!json.profile) {
      writeStoredSessionToken(null);
      syncAuthHandle(null);
      return null;
    }
    syncAuthHandle(json.profile);
    return json.profile;
  } catch {
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  const token = readStoredSessionToken();
  cachedDriveAccessToken = null;
  writeStoredSessionToken(null);
  syncAuthHandle(null);
  if (token) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
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

export const DEFAULT_FLEET_CONFIG: FleetConfigSettings = {
  mandatoryDocCategories: ['istimara', 'insurance', 'periodic_inspection'],
  documentAlertDays: [30, 15, 7, 3, 0],
  delegationAlertDays: [14, 7, 3, 0],
  maintenanceAlertDays: 14,
  maintenanceAlertKm: 1000,
  singleVehiclePerRider: true,
  strictSeparationOfDuties: true,
  requireOpsAndAdminForDelegation: true,
  requirePhotosOnHandover: true,
  requirePhotosOnReturn: true,
  mandatoryPhotoSlots: [
    { slotKey: 'front', labelAr: 'الواجهة الأمامية', required: true },
    { slotKey: 'rear', labelAr: 'الجهة الخلفية', required: true },
    { slotKey: 'right', labelAr: 'الجانب الأيمن', required: true },
    { slotKey: 'left', labelAr: 'الجانب الأيسر', required: true },
    { slotKey: 'plate', labelAr: 'لوحة المركبة', required: true },
    { slotKey: 'odometer', labelAr: 'لوحة العداد', required: true },
    { slotKey: 'fuel', labelAr: 'مؤشر الوقود', required: true },
    { slotKey: 'damage', labelAr: 'مواضع الملاحظات والأضرار', required: false },
  ],
  defaultChecklistItems: [
    { itemKey: 'body_exterior', labelAr: 'سلامة الهيكل الخارجي والدهان' },
    { itemKey: 'lights_signals', labelAr: 'الإضاءة الأمامية والخلفية والإشارات' },
    { itemKey: 'tires_rims', labelAr: 'حالة الإطارات والجنوط' },
    { itemKey: 'spare_tire', labelAr: 'الإطار الاحتياطي والرافعة' },
    { itemKey: 'windshield_mirrors', labelAr: 'الزجاج الأمامي والمرايا' },
    { itemKey: 'ac_cooling', labelAr: 'كفاءة المكيف والتبريد' },
    { itemKey: 'brakes_handbrake', labelAr: 'الفرامل وفرامل اليد' },
    { itemKey: 'engine_sounds', labelAr: 'صوت المحرك وعدم وجود تهريبات' },
    { itemKey: 'interior_seats', labelAr: 'نظافة المقصورة والمقاعد' },
    { itemKey: 'battery_start', labelAr: 'البطارية وسرعة التشغيل' },
    { itemKey: 'wipers_washer', labelAr: 'المساحات ورشاش الماء' },
    { itemKey: 'horn_locks', labelAr: 'البوق وأقفال الأبواب والريموت' },
    { itemKey: 'istimara_copy', labelAr: 'نسخة الاستمارة داخل المركبة' },
    { itemKey: 'insurance_copy', labelAr: 'نسخة وثيقة التأمين' },
    { itemKey: 'safety_triangle', labelAr: 'مثلث السلامة وطفاية الحريق' },
    { itemKey: 'first_aid', labelAr: 'حقيبة الإسعافات الأولية' },
  ],
  defaultAccessories: [
    { accessoryKey: 'main_key', labelAr: 'المفتاح الرئيسي' },
    { accessoryKey: 'spare_key', labelAr: 'المفتاح الاحتياطي' },
    { accessoryKey: 'fuel_card', labelAr: 'بطاقة الوقود' },
    { accessoryKey: 'delivery_box', labelAr: 'صندوق / حقيبة التوصيل' },
    { accessoryKey: 'phone_mount', labelAr: 'حامل الجوال والشاحن' },
    { accessoryKey: 'gps_tracker', labelAr: 'جهاز التتبع (GPS)' },
  ],
  companyReportHeader: {
    showLogo: true,
    footerDisclaimerAr: 'وثيقة صادرة من مركز عمليات الأسطول — تخضع للمراجعة والاعتماد الإلكتروني.',
  },
};

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
  fleetConfig: DEFAULT_FLEET_CONFIG,
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
    fleetConfig: {
      ...DEFAULT_FLEET_CONFIG,
      ...(raw.fleetConfig || {}),
    },
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
    return hydrateOperationalSettings(snap.data() as Partial<OperationalSettings>);
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
    return hydrateOperationalSettings((created.data() || payload) as Partial<OperationalSettings>);
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
