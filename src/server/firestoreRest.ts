import fs from 'fs';
import path from 'path';
import type {
  CapabilityMap,
  DailySummary,
  DataScope,
  FleetPermissionMap,
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  KeetaDashboardDaily,
  KeetaVdaDaily,
  MonthlySummary,
  PermissionMatrix,
  Platform,
  RoleTemplate,
  UserProfile,
  UserRole,
} from '../types/fleet.js';
import {
  BOOTSTRAPPED_OWNER_EMAIL_LOWER,
  createEmptyCapabilities,
  createEmptyFleetPermissions,
  createEmptyPermissionMatrix,
  createFullCapabilities,
  createFullFleetPermissions,
  createFullPermissionMatrix,
  resolveDataScope,
  resolveEffectiveCapabilities,
  resolveEffectiveFleetPermissions,
  resolveEffectivePermissions,
} from '../shared/rbacCore.js';
import type { ParsedCollectionRecord } from './excelParser.js';
import { isServerSessionToken, verifySessionTokenToUser } from './authStore.js';
import {
  batchCheckLocalExisting,
  commitLocalBatch,
  deleteLocalDoc,
  getLocalDoc,
  listLocalCollection,
  type LocalBatchOp,
} from './localStore.js';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  cachedConfig = JSON.parse(raw) as FirebaseAppletConfig;
  return cachedConfig;
}

function dbBaseUrl(): string {
  const cfg = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`;
}

function commitUrl(): string {
  const cfg = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents:commit`;
}

function batchGetUrl(): string {
  const cfg = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents:batchGet`;
}

function docResourceName(collection: string, docId: string): string {
  const cfg = getFirebaseConfig();
  return `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/${collection}/${docId}`;
}

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  customRoleId?: string;
  active: boolean;
  allowedPlatforms: Platform[];
  permissions: PermissionMatrix;
  capabilities: CapabilityMap;
  fleetPermissions: FleetPermissionMap;
  dataScope: DataScope;
}

export async function verifyUserFromToken(idToken: string): Promise<VerifiedAuthUser> {
  if (isServerSessionToken(idToken)) {
    return verifySessionTokenToUser(idToken);
  }
  const cfg = getFirebaseConfig();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${cfg.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    throw new Error('تعذر التحقق من جلسة المستخدم.');
  }
  const data = (await res.json()) as {
    users?: Array<{ localId: string; email?: string; emailVerified?: boolean }>;
  };
  const user = data.users?.[0];
  if (!user || !user.localId || !user.email) {
    throw new Error('جلسة غير صالحة.');
  }
  if (!user.emailVerified) {
    throw new Error('البريد الإلكتروني غير موثق.');
  }

  const isBootstrappedOwner = user.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER;
  if (isBootstrappedOwner) {
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: true,
      role: 'owner',
      customRoleId: 'super_admin',
      active: true,
      allowedPlatforms: ['hungerstation', 'keeta'],
      permissions: createFullPermissionMatrix(),
      capabilities: createFullCapabilities(),
      fleetPermissions: createFullFleetPermissions(),
      dataScope: { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [], vehicleIds: [] },
    };
  }

  const userDoc = await getFirestoreDoc('users', user.localId, idToken);
  if (!userDoc) {
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: true,
      role: 'viewer',
      active: false,
      allowedPlatforms: ['hungerstation', 'keeta'],
      permissions: createEmptyPermissionMatrix(),
      capabilities: createEmptyCapabilities(),
      fleetPermissions: createEmptyFleetPermissions(),
      dataScope: { allBranches: false, branches: [], cities: [], platforms: [], riderIds: [], vehicleIds: [] },
    };
  }

  const typedProfile = userDoc as unknown as UserProfile;
  const role = (typedProfile.role as UserRole) || 'viewer';
  const rawPlatforms = Array.isArray(typedProfile.allowedPlatforms)
    ? typedProfile.allowedPlatforms.filter((p): p is Platform => p === 'hungerstation' || p === 'keeta')
    : [];
  const allowedPlatforms: Platform[] =
    role === 'owner' || role === 'admin'
      ? ['hungerstation', 'keeta']
      : rawPlatforms.length > 0
        ? rawPlatforms
        : ['hungerstation', 'keeta'];

  let roleTemplates: RoleTemplate[] = [];
  if (typedProfile.customRoleId) {
    const customDoc = await getFirestoreDoc('roleTemplates', typedProfile.customRoleId, idToken).catch(() => null);
    if (customDoc) roleTemplates = [customDoc as unknown as RoleTemplate];
  }

  const permissions = resolveEffectivePermissions({ ...typedProfile, email: user.email, role }, roleTemplates);
  const capabilities = resolveEffectiveCapabilities({ ...typedProfile, email: user.email, role }, roleTemplates);
  const fleetPermissions = resolveEffectiveFleetPermissions({ ...typedProfile, email: user.email, role }, roleTemplates);
  const dataScope = resolveDataScope({ ...typedProfile, email: user.email, role });

  return {
    uid: user.localId,
    email: user.email,
    emailVerified: true,
    role,
    customRoleId: typedProfile.customRoleId,
    active: Boolean(typedProfile.active),
    allowedPlatforms,
    permissions,
    capabilities,
    fleetPermissions,
    dataScope,
  };
}

// Convert JS values to Firestore REST Value JSON
type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val) && Math.abs(val) <= 9007199254740991) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('__timestampValue' in obj && typeof obj.__timestampValue === 'string') {
      return { timestampValue: obj.__timestampValue };
    }
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(fv: FirestoreValue | undefined): unknown {
  if (!fv) return null;
  if ('nullValue' in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return Number(fv.doubleValue);
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('stringValue' in fv) return fv.stringValue;
  if ('arrayValue' in fv) return (fv.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in fv) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fv.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function docToObject(doc: { name?: string; fields?: Record<string, FirestoreValue> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export async function getFirestoreDoc(
  collection: string,
  docId: string,
  idToken: string
): Promise<Record<string, unknown> | null> {
  if (isServerSessionToken(idToken)) {
    return getLocalDoc(collection, docId);
  }
  const res = await fetch(`${dbBaseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore GET error (${collection}/${docId}): ${errText}`);
  }
  const doc = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return docToObject(doc);
}

export async function deleteFirestoreDoc(
  collection: string,
  docId: string,
  idToken: string
): Promise<void> {
  if (isServerSessionToken(idToken)) {
    await deleteLocalDoc(collection, docId);
    return;
  }
  const res = await fetch(`${dbBaseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore DELETE error (${collection}/${docId}): ${errText}`);
  }
}

export async function isKeetaEnabledOnServer(idToken: string): Promise<boolean> {
  try {
    const [settingsDoc, catalogDoc] = await Promise.all([
      getFirestoreDoc('operationalSettings', 'default', idToken).catch(() => null),
      getFirestoreDoc('platformCatalog', 'keeta', idToken).catch(() => null),
    ]);
    if (catalogDoc) {
      return Boolean(catalogDoc.enabled === true && catalogDoc.hiddenFromUi !== true);
    }
    if (settingsDoc) {
      return Boolean(settingsDoc.keetaEnabled === true && settingsDoc.keetaHidden !== true);
    }
    return false;
  } catch {
    return false;
  }
}

export async function listFirestoreCollection<T = Record<string, unknown>>(
  collection: string,
  idToken: string,
  pageSize = 1000
): Promise<T[]> {
  if (isServerSessionToken(idToken)) {
    return listLocalCollection<T>(collection);
  }
  const items: T[] = [];
  let pageToken = '';
  do {
    const url = `${dbBaseUrl()}/${collection}?pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) break;
      throw new Error(`Firestore LIST error (${collection}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
      nextPageToken?: string;
    };
    for (const d of json.documents || []) {
      items.push(docToObject(d) as unknown as T);
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken && items.length < 15000);
  return items;
}

export interface ExistingDocMeta {
  rowChecksum: string;
  importedAt?: string;
  createdAt?: string;
  createdByUid?: string;
}

export async function batchCheckExisting(
  items: Array<{ collection: string; docId: string }>,
  idToken: string
): Promise<Map<string, ExistingDocMeta>> {
  if (isServerSessionToken(idToken)) {
    return batchCheckLocalExisting(items);
  }
  const result = new Map<string, ExistingDocMeta>();
  if (items.length === 0) return result;

  const chunkSize = 100;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const docNames = chunk.map((item) => docResourceName(item.collection, item.docId));
    const res = await fetch(batchGetUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ documents: docNames }),
    });
    if (!res.ok) {
      throw new Error(`Firestore batchGet failed: ${await res.text()}`);
    }
    const text = await res.text();
    // batchGet returns a JSON array of responses
    const parsed = JSON.parse(text) as Array<{
      found?: { name: string; fields?: Record<string, FirestoreValue> };
      missing?: string;
    }>;
    for (const entry of parsed) {
      if (entry.found && entry.found.name) {
        const parts = entry.found.name.split('/');
        const docId = parts[parts.length - 1];
        const col = parts[parts.length - 2];
        const obj = docToObject(entry.found);
        result.set(`${col}:${docId}`, {
          rowChecksum: String(obj.rowChecksum || ''),
          importedAt: obj.importedAt ? String(obj.importedAt) : undefined,
          createdAt: obj.createdAt ? String(obj.createdAt) : undefined,
          createdByUid: obj.createdByUid ? String(obj.createdByUid) : undefined,
        });
      }
    }
  }
  return result;
}

export interface WriteOperation {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
  serverTimestampFields: string[];
  preserveTimestampFields?: Record<string, string>;
}

export async function commitFirestoreWrites(writes: WriteOperation[], idToken: string): Promise<void> {
  if (writes.length === 0) return;
  if (isServerSessionToken(idToken)) {
    const batchOps: LocalBatchOp[] = writes.map((w) => ({
      type: 'set',
      collection: w.collection,
      docId: w.docId,
      data: w.data,
      serverTimestampFields: w.serverTimestampFields,
      preserveTimestampFields: w.preserveTimestampFields,
    }));
    await commitLocalBatch(batchOps);
    return;
  }

  // Keep under Firestore 500 writes/transforms limit per commit (each doc with transforms counts toward limit)
  const chunkSize = 200;
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    const writeEntries = chunk.map((w) => {
      const fields: Record<string, FirestoreValue> = {};
      for (const [k, v] of Object.entries(w.data)) {
        if (v !== undefined) {
          fields[k] = toFirestoreValue(v);
        }
      }
      if (w.preserveTimestampFields) {
        for (const [k, iso] of Object.entries(w.preserveTimestampFields)) {
          fields[k] = { timestampValue: iso };
        }
      }
      const fieldTransforms = w.serverTimestampFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      }));

      return {
        update: {
          name: docResourceName(w.collection, w.docId),
          fields,
        },
        updateTransforms: fieldTransforms.length > 0 ? fieldTransforms : undefined,
      };
    });

    const res = await fetch(commitUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes: writeEntries }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore commit error: ${errText}`);
    }
  }
}

export async function recomputeSummariesForDates(params: {
  affectedDates: Array<{ platform: 'hungerstation' | 'keeta'; date: string }>;
  createdByUid: string;
  allowedUids: string[];
  idToken: string;
}): Promise<{ dailyCount: number; monthlyCount: number }> {
  const { affectedDates, createdByUid, allowedUids, idToken } = params;
  if (affectedDates.length === 0) return { dailyCount: 0, monthlyCount: 0 };

  const hasHunger = affectedDates.some((d) => d.platform === 'hungerstation');
  const hasKeeta = affectedDates.some((d) => d.platform === 'keeta');

  const summaryWrites: WriteOperation[] = [];
  const affectedMonths = new Set<string>();

  if (hasHunger) {
    const [hungerDaily, hungerDist] = await Promise.all([
      listFirestoreCollection<HungerDailyRecord>('hungerDaily', idToken),
      listFirestoreCollection<HungerDistanceDailyRecord>('hungerDistanceDaily', idToken),
    ]);

    const distByDate = new Map<string, { totalKm: number; payableKm: number }>();
    for (const d of hungerDist) {
      const cur = distByDate.get(d.date) || { totalKm: 0, payableKm: 0 };
      cur.totalKm += d.totalKm ?? 0;
      cur.payableKm += d.payableKm ?? 0;
      distByDate.set(d.date, cur);
    }

    const byDate = new Map<string, HungerDailyRecord[]>();
    for (const r of hungerDaily) {
      const list = byDate.get(r.date) || [];
      list.push(r);
      byDate.set(r.date, list);
      affectedMonths.add(`hungerstation:${r.month}`);
    }

    const targetDates = new Set(affectedDates.filter((d) => d.platform === 'hungerstation').map((d) => d.date));
    for (const date of targetDates) {
      const rows = byDate.get(date) || [];
      const dist = distByDate.get(date) || { totalKm: 0, payableKm: 0 };
      const uniqueRiders = new Set(rows.map((r) => r.riderId));
      const activeRiders = new Set(rows.filter((r) => (r.completedDeliveries ?? 0) > 0 || (r.actualWorkingHours ?? 0) > 0).map((r) => r.riderId));
      const completedOrders = rows.reduce((s, r) => s + (r.completedDeliveries ?? 0), 0);
      const acceptedOrders = rows.reduce((s, r) => s + (r.acceptedDeliveries ?? 0), 0);
      const rejectedOrders = rows.reduce((s, r) => s + (r.declinedDeliveries ?? 0) + (r.notAcceptedDeliveries ?? 0), 0);
      const cancelledOrders = rows.reduce((s, r) => s + (r.cancelledDeliveries ?? 0), 0);
      const workingHours = rows.reduce((s, r) => s + (r.actualWorkingHours ?? 0), 0);
      const validHours = rows.reduce((s, r) => s + (r.plannedWorkingHours ?? 0), 0);
      const accRates = rows.map((r) => r.acceptanceRate).filter((v): v is number => v !== null);
      const attRates = rows.map((r) => r.attendanceRate).filter((v): v is number => v !== null);

      const summaryKey = `hungerstation_${date}`;
      const summaryDoc: Omit<DailySummary, 'updatedAt'> = {
        summaryKey,
        platform: 'hungerstation',
        date,
        month: date.slice(0, 7),
        totalRiders: uniqueRiders.size,
        activeRiders: activeRiders.size,
        completedOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
        workingHours: Number(workingHours.toFixed(2)),
        validHours: Number(validHours.toFixed(2)),
        totalKm: Number(dist.totalKm.toFixed(2)),
        payableKm: Number(dist.payableKm.toFixed(2)),
        overdueOrders: 0,
        avgAcceptanceRate: accRates.length ? Number((accRates.reduce((a, b) => a + b, 0) / accRates.length).toFixed(2)) : 0,
        avgCompletionRate: acceptedOrders > 0 ? Number(((completedOrders / acceptedOrders) * 100).toFixed(2)) : 0,
        avgOnTimeRate: 0,
        avgAttendanceRate: attRates.length ? Number((attRates.reduce((a, b) => a + b, 0) / attRates.length).toFixed(2)) : 0,
        createdByUid,
        allowedUids,
      };
      summaryWrites.push({
        collection: 'dailySummaries',
        docId: summaryKey,
        data: summaryDoc as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
      });
    }

    // Monthly HungerStation summaries
    for (const key of affectedMonths) {
      if (!key.startsWith('hungerstation:')) continue;
      const month = key.split(':')[1];
      const mRows = hungerDaily.filter((r) => r.month === month);
      const mDist = hungerDist.filter((d) => d.month === month);
      const uniqueRiders = new Set(mRows.map((r) => r.riderId));
      const activeRiders = new Set(mRows.filter((r) => (r.completedDeliveries ?? 0) > 0 || (r.actualWorkingHours ?? 0) > 0).map((r) => r.riderId));
      const completedOrders = mRows.reduce((s, r) => s + (r.completedDeliveries ?? 0), 0);
      const acceptedOrders = mRows.reduce((s, r) => s + (r.acceptedDeliveries ?? 0), 0);
      const workingHours = mRows.reduce((s, r) => s + (r.actualWorkingHours ?? 0), 0);
      const totalKm = mDist.reduce((s, d) => s + (d.totalKm ?? 0), 0);
      const payableKm = mDist.reduce((s, d) => s + (d.payableKm ?? 0), 0);
      const accRates = mRows.map((r) => r.acceptanceRate).filter((v): v is number => v !== null);
      const attRates = mRows.map((r) => r.attendanceRate).filter((v): v is number => v !== null);

      const mKey = `hungerstation_${month}`;
      const mDoc: Omit<MonthlySummary, 'updatedAt'> = {
        summaryKey: mKey,
        platform: 'hungerstation',
        month,
        totalRiders: uniqueRiders.size,
        activeRiders: activeRiders.size,
        completedOrders,
        workingHours: Number(workingHours.toFixed(2)),
        totalKm: Number(totalKm.toFixed(2)),
        payableKm: Number(payableKm.toFixed(2)),
        overdueOrders: 0,
        avgAcceptanceRate: accRates.length ? Number((accRates.reduce((a, b) => a + b, 0) / accRates.length).toFixed(2)) : 0,
        avgCompletionRate: acceptedOrders > 0 ? Number(((completedOrders / acceptedOrders) * 100).toFixed(2)) : 0,
        avgOnTimeRate: 0,
        avgAttendanceRate: attRates.length ? Number((attRates.reduce((a, b) => a + b, 0) / attRates.length).toFixed(2)) : 0,
        createdByUid,
        allowedUids,
      };
      summaryWrites.push({
        collection: 'monthlySummaries',
        docId: mKey,
        data: mDoc as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
      });
    }
  }

  if (hasKeeta) {
    const [keetaDash, keetaVda] = await Promise.all([
      listFirestoreCollection<KeetaDashboardDaily>('keetaDashboardDaily', idToken),
      listFirestoreCollection<KeetaVdaDaily>('keetaVdaDaily', idToken),
    ]);

    const vdaByDate = new Map<string, { totalKm: number; payableKm: number }>();
    for (const v of keetaVda) {
      const cur = vdaByDate.get(v.date) || { totalKm: 0, payableKm: 0 };
      cur.totalKm += v.totalDeliveryDistance ?? 0;
      cur.payableKm += v.payableDistance ?? 0;
      vdaByDate.set(v.date, cur);
    }

    const byDate = new Map<string, KeetaDashboardDaily[]>();
    for (const r of keetaDash) {
      const list = byDate.get(r.date) || [];
      list.push(r);
      byDate.set(r.date, list);
      affectedMonths.add(`keeta:${r.month}`);
    }

    const targetDates = new Set(affectedDates.filter((d) => d.platform === 'keeta').map((d) => d.date));
    for (const date of targetDates) {
      const rows = byDate.get(date) || [];
      const dist = vdaByDate.get(date) || { totalKm: 0, payableKm: 0 };
      const uniqueRiders = new Set(rows.map((r) => r.riderId));
      const activeRiders = new Set(rows.filter((r) => (r.deliveredTasks ?? 0) > 0 || (r.shiftOnlineHours ?? 0) > 0).map((r) => r.riderId));
      const completedOrders = rows.reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);
      const acceptedOrders = rows.reduce((s, r) => s + (r.acceptedTasks ?? 0), 0);
      const rejectedOrders = rows.reduce((s, r) => s + (r.rejectedTasks ?? 0), 0);
      const workingHours = rows.reduce((s, r) => s + (r.shiftOnlineHours ?? 0), 0);
      const validHours = rows.reduce((s, r) => s + (r.shiftValidOnlineTime ?? 0), 0);
      const overdueOrders = rows.reduce((s, r) => s + (r.overdueOrderTasks ?? 0), 0);

      let compWeightedSum = 0;
      let compWeightTotal = 0;
      let onTimeWeightedSum = 0;
      let onTimeWeightTotal = 0;
      let cancelledEstTotal = 0;
      for (const r of rows) {
        if (r.completionRate !== null) {
          const w = r.acceptedTasks !== null && r.acceptedTasks > 0 ? r.acceptedTasks : 1;
          compWeightedSum += r.completionRate * w;
          compWeightTotal += w;
        }
        if (r.onTimeRate !== null) {
          const w = r.deliveredTasks !== null && r.deliveredTasks > 0 ? r.deliveredTasks : 1;
          onTimeWeightedSum += r.onTimeRate * w;
          onTimeWeightTotal += w;
        }
        if (r.cancellationRate !== null && r.acceptedTasks !== null && r.acceptedTasks > 0) {
          cancelledEstTotal += (r.cancellationRate / 100) * r.acceptedTasks;
        }
      }

      const summaryKey = `keeta_${date}`;
      const summaryDoc: Omit<DailySummary, 'updatedAt'> = {
        summaryKey,
        platform: 'keeta',
        date,
        month: date.slice(0, 7),
        totalRiders: uniqueRiders.size,
        activeRiders: activeRiders.size,
        completedOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders: Math.round(cancelledEstTotal),
        workingHours: Number(workingHours.toFixed(2)),
        validHours: Number(validHours.toFixed(2)),
        totalKm: Number(dist.totalKm.toFixed(2)),
        payableKm: Number(dist.payableKm.toFixed(2)),
        overdueOrders,
        avgAcceptanceRate: acceptedOrders + rejectedOrders > 0 ? Number(((acceptedOrders / (acceptedOrders + rejectedOrders)) * 100).toFixed(2)) : 0,
        avgCompletionRate: compWeightTotal > 0 ? Number((compWeightedSum / compWeightTotal).toFixed(2)) : 0,
        avgOnTimeRate: onTimeWeightTotal > 0 ? Number((onTimeWeightedSum / onTimeWeightTotal).toFixed(2)) : 0,
        avgAttendanceRate: uniqueRiders.size > 0 ? Number(((rows.filter((r) => (r.onShift || '').toLowerCase() === 'yes' || (r.onShift || '') === '1' || (r.onShift || '').toLowerCase() === 'true').length / uniqueRiders.size) * 100).toFixed(2)) : 0,
        createdByUid,
        allowedUids,
      };
      summaryWrites.push({
        collection: 'dailySummaries',
        docId: summaryKey,
        data: summaryDoc as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
      });
    }

    for (const key of affectedMonths) {
      if (!key.startsWith('keeta:')) continue;
      const month = key.split(':')[1];
      const mRows = keetaDash.filter((r) => r.month === month);
      const mVda = keetaVda.filter((v) => v.month === month);
      const uniqueRiders = new Set(mRows.map((r) => r.riderId));
      const activeRiders = new Set(mRows.filter((r) => (r.deliveredTasks ?? 0) > 0 || (r.shiftOnlineHours ?? 0) > 0).map((r) => r.riderId));
      const completedOrders = mRows.reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);
      const acceptedOrders = mRows.reduce((s, r) => s + (r.acceptedTasks ?? 0), 0);
      const rejectedOrders = mRows.reduce((s, r) => s + (r.rejectedTasks ?? 0), 0);
      const workingHours = mRows.reduce((s, r) => s + (r.shiftOnlineHours ?? 0), 0);
      const totalKm = mVda.reduce((s, v) => s + (v.totalDeliveryDistance ?? 0), 0);
      const payableKm = mVda.reduce((s, v) => s + (v.payableDistance ?? 0), 0);
      const overdueOrders = mRows.reduce((s, r) => s + (r.overdueOrderTasks ?? 0), 0);

      let compWeightedSum = 0;
      let compWeightTotal = 0;
      let onTimeWeightedSum = 0;
      let onTimeWeightTotal = 0;
      for (const r of mRows) {
        if (r.completionRate !== null) {
          const w = r.acceptedTasks !== null && r.acceptedTasks > 0 ? r.acceptedTasks : 1;
          compWeightedSum += r.completionRate * w;
          compWeightTotal += w;
        }
        if (r.onTimeRate !== null) {
          const w = r.deliveredTasks !== null && r.deliveredTasks > 0 ? r.deliveredTasks : 1;
          onTimeWeightedSum += r.onTimeRate * w;
          onTimeWeightTotal += w;
        }
      }

      const mKey = `keeta_${month}`;
      const mDoc: Omit<MonthlySummary, 'updatedAt'> = {
        summaryKey: mKey,
        platform: 'keeta',
        month,
        totalRiders: uniqueRiders.size,
        activeRiders: activeRiders.size,
        completedOrders,
        workingHours: Number(workingHours.toFixed(2)),
        totalKm: Number(totalKm.toFixed(2)),
        payableKm: Number(payableKm.toFixed(2)),
        overdueOrders,
        avgAcceptanceRate: acceptedOrders + rejectedOrders > 0 ? Number(((acceptedOrders / (acceptedOrders + rejectedOrders)) * 100).toFixed(2)) : 0,
        avgCompletionRate: compWeightTotal > 0 ? Number((compWeightedSum / compWeightTotal).toFixed(2)) : 0,
        avgOnTimeRate: onTimeWeightTotal > 0 ? Number((onTimeWeightedSum / onTimeWeightTotal).toFixed(2)) : 0,
        avgAttendanceRate: mRows.length > 0 ? Number(((mRows.filter((r) => (r.onShift || '').toLowerCase() === 'yes' || (r.onShift || '') === '1' || (r.onShift || '').toLowerCase() === 'true').length / mRows.length) * 100).toFixed(2)) : 0,
        createdByUid,
        allowedUids,
      };
      summaryWrites.push({
        collection: 'monthlySummaries',
        docId: mKey,
        data: mDoc as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
      });
    }
  }

  await commitFirestoreWrites(summaryWrites, idToken);
  return {
    dailyCount: summaryWrites.filter((w) => w.collection === 'dailySummaries').length,
    monthlyCount: summaryWrites.filter((w) => w.collection === 'monthlySummaries').length,
  };
}

export function extractAffectedDates(records: ParsedCollectionRecord[]): Array<{ platform: 'hungerstation' | 'keeta'; date: string }> {
  const set = new Set<string>();
  const out: Array<{ platform: 'hungerstation' | 'keeta'; date: string }> = [];
  for (const r of records) {
    if ('date' in r.data && typeof r.data.date === 'string') {
      const key = `${r.data.platform}:${r.data.date}`;
      if (!set.has(key)) {
        set.add(key);
        out.push({ platform: r.data.platform, date: r.data.date });
      }
    }
  }
  return out;
}
