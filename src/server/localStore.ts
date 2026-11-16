import fs from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.resolve(process.cwd(), process.env.PRIVATE_VAULT_DIR || '.private_vault');
const DB_ROOT = path.resolve(VAULT_ROOT, 'db');

export const VALID_COLLECTIONS = [
  'users',
  'roleTemplates',
  'operationalSettings',
  'platformCatalog',
  'companyBranding',
  'documentTypes',
  'privateDocuments',
  'riderMaster',
  'riderIdentityMapping',
  'platformAccounts',
  'vehicles',
  'vehicleAssignments',
  'vehicleMaintenance',
  'entityNotesTasks',
  'importBatches',
  'hungerDaily',
  'hungerDistanceDaily',
  'hungerWalletSnapshots',
  'hungerQualityMonthly',
  'keetaDashboardDaily',
  'keetaVdaDaily',
  'keetaRankSnapshots',
  'keetaFacialRecognitionDaily',
  'dailySummaries',
  'monthlySummaries',
  'operationalCases',
  'riderNotes',
  'hungerErrorDictionary',
  'hungerRiderErrorCases',
  'auditLogs',
  'systemSections',
  'systemPages',
  'dynamicFields',
  'dynamicForms',
  'dynamicFormVersions',
  'customEntityRecords',
  'savedViews',
  'userPreferences',
  'notificationRules',
  'trashItems',
  'configSnapshots',
  'customReportTemplates',
] as const;

export type ValidCollectionName = (typeof VALID_COLLECTIONS)[number];
const VALID_COL_SET = new Set<string>(VALID_COLLECTIONS);
const ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidCollectionName(col: string): col is ValidCollectionName {
  return VALID_COL_SET.has(col);
}

export function isValidDocId(docId: string): boolean {
  return typeof docId === 'string' && ID_REGEX.test(docId);
}

const collectionLocks = new Map<string, Promise<unknown>>();

function withCollectionLock<T>(collection: string, fn: () => Promise<T>): Promise<T> {
  const prev = collectionLocks.get(collection) || Promise.resolve();
  const next = prev.then(fn, fn);
  collectionLocks.set(
    collection,
    next.catch(() => undefined)
  );
  return next;
}

function collectionFilePath(collection: string): string {
  if (!isValidCollectionName(collection)) {
    throw new Error(`مجموعة بيانات غير صالحة: ${collection}`);
  }
  const target = path.resolve(DB_ROOT, `${collection}.json`);
  if (!target.startsWith(DB_ROOT + path.sep)) {
    throw new Error('مسار قاعدة البيانات غير مصرح به.');
  }
  return target;
}

async function readCollectionMapUnsafe(collection: string): Promise<Record<string, Record<string, unknown>>> {
  const filePath = collectionFilePath(collection);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, unknown>>;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeCollectionMapUnsafe(
  collection: string,
  map: Record<string, Record<string, unknown>>
): Promise<void> {
  await fs.mkdir(DB_ROOT, { recursive: true });
  const filePath = collectionFilePath(collection);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(map, null, 2), { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

export function resolveServerTimestamps(val: unknown, nowIso: string): unknown {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((item) => resolveServerTimestamps(item, nowIso));
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.__serverTimestamp === true || '__timestampValue' in obj) {
      return typeof obj.__timestampValue === 'string' ? obj.__timestampValue : nowIso;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = resolveServerTimestamps(v, nowIso);
      }
    }
    return out;
  }
  return val;
}

export async function getLocalDoc(collection: string, docId: string): Promise<Record<string, unknown> | null> {
  if (!isValidCollectionName(collection) || !isValidDocId(docId)) return null;
  const map = await readCollectionMapUnsafe(collection);
  return map[docId] ? { ...map[docId] } : null;
}

export async function listLocalCollection<T = Record<string, unknown>>(collection: string): Promise<T[]> {
  if (!isValidCollectionName(collection)) return [];
  const map = await readCollectionMapUnsafe(collection);
  return Object.values(map) as unknown as T[];
}

export interface QueryFilterClause {
  field: string;
  op: '==' | 'array-contains' | 'in';
  value: unknown;
}

export async function queryLocalCollection(
  collection: string,
  filters: QueryFilterClause[] = []
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  if (!isValidCollectionName(collection)) return [];
  const map = await readCollectionMapUnsafe(collection);
  const results: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const [id, docData] of Object.entries(map)) {
    let matches = true;
    for (const f of filters) {
      const actual = docData[f.field];
      if (f.op === '==') {
        if (actual !== f.value) {
          matches = false;
          break;
        }
      } else if (f.op === 'array-contains') {
        if (!Array.isArray(actual) || !actual.includes(f.value)) {
          matches = false;
          break;
        }
      } else if (f.op === 'in') {
        if (!Array.isArray(f.value) || !f.value.includes(actual)) {
          matches = false;
          break;
        }
      }
    }
    if (matches) {
      results.push({ id, data: docData });
    }
  }
  return results;
}

export async function setLocalDoc(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  options?: { merge?: boolean }
): Promise<Record<string, unknown>> {
  if (!isValidCollectionName(collection)) throw new Error(`مجموعة غير صالحة: ${collection}`);
  if (!isValidDocId(docId)) throw new Error(`معرف سجل غير صالح: ${docId}`);

  return withCollectionLock(collection, async () => {
    const map = await readCollectionMapUnsafe(collection);
    const nowIso = new Date().toISOString();
    const resolved = resolveServerTimestamps(data, nowIso) as Record<string, unknown>;
    const nextDoc =
      options?.merge && map[docId]
        ? { ...map[docId], ...resolved }
        : { ...resolved };
    map[docId] = nextDoc;
    await writeCollectionMapUnsafe(collection, map);
    return nextDoc;
  });
}

export async function updateLocalDoc(
  collection: string,
  docId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!isValidCollectionName(collection)) throw new Error(`مجموعة غير صالحة: ${collection}`);
  if (!isValidDocId(docId)) throw new Error(`معرف سجل غير صالح: ${docId}`);

  return withCollectionLock(collection, async () => {
    const map = await readCollectionMapUnsafe(collection);
    if (!map[docId]) {
      throw new Error(`السجل غير موجود (${collection}/${docId}).`);
    }
    const nowIso = new Date().toISOString();
    const resolved = resolveServerTimestamps(patch, nowIso) as Record<string, unknown>;
    const updated = { ...map[docId], ...resolved };
    map[docId] = updated;
    await writeCollectionMapUnsafe(collection, map);
    return updated;
  });
}

export async function deleteLocalDoc(collection: string, docId: string): Promise<void> {
  if (!isValidCollectionName(collection) || !isValidDocId(docId)) return;
  await withCollectionLock(collection, async () => {
    const map = await readCollectionMapUnsafe(collection);
    if (docId in map) {
      delete map[docId];
      await writeCollectionMapUnsafe(collection, map);
    }
  });
}

export interface LocalBatchOp {
  type: 'set' | 'update' | 'delete';
  collection: string;
  docId: string;
  data?: Record<string, unknown>;
  merge?: boolean;
  serverTimestampFields?: string[];
  preserveTimestampFields?: Record<string, string>;
}

export async function commitLocalBatch(ops: LocalBatchOp[]): Promise<void> {
  if (ops.length === 0) return;
  const byCol = new Map<string, LocalBatchOp[]>();
  for (const op of ops) {
    if (!isValidCollectionName(op.collection)) throw new Error(`مجموعة غير صالحة: ${op.collection}`);
    if (!isValidDocId(op.docId)) throw new Error(`معرف غير صالح: ${op.docId}`);
    const list = byCol.get(op.collection) || [];
    list.push(op);
    byCol.set(op.collection, list);
  }

  for (const [col, colOps] of byCol.entries()) {
    await withCollectionLock(col, async () => {
      const map = await readCollectionMapUnsafe(col);
      const nowIso = new Date().toISOString();
      for (const op of colOps) {
        if (op.type === 'delete') {
          delete map[op.docId];
        } else if (op.type === 'update') {
          const existing = map[op.docId] || {};
          const resolved = resolveServerTimestamps(op.data || {}, nowIso) as Record<string, unknown>;
          map[op.docId] = { ...existing, ...resolved };
        } else {
          const resolved = resolveServerTimestamps(op.data || {}, nowIso) as Record<string, unknown>;
          if (op.serverTimestampFields) {
            for (const f of op.serverTimestampFields) {
              resolved[f] = nowIso;
            }
          }
          if (op.preserveTimestampFields) {
            for (const [k, v] of Object.entries(op.preserveTimestampFields)) {
              resolved[k] = v;
            }
          }
          map[op.docId] = op.merge && map[op.docId] ? { ...map[op.docId], ...resolved } : resolved;
        }
      }
      await writeCollectionMapUnsafe(col, map);
    });
  }
}

export async function batchCheckLocalExisting(
  items: Array<{ collection: string; docId: string }>
): Promise<Map<string, { rowChecksum: string; importedAt?: string; createdAt?: string; createdByUid?: string }>> {
  const result = new Map<string, { rowChecksum: string; importedAt?: string; createdAt?: string; createdByUid?: string }>();
  const byCol = new Map<string, string[]>();
  for (const item of items) {
    if (!isValidCollectionName(item.collection) || !isValidDocId(item.docId)) continue;
    const arr = byCol.get(item.collection) || [];
    arr.push(item.docId);
    byCol.set(item.collection, arr);
  }
  for (const [col, ids] of byCol.entries()) {
    const map = await readCollectionMapUnsafe(col);
    for (const id of ids) {
      const found = map[id];
      if (found) {
        result.set(`${col}:${id}`, {
          rowChecksum: String(found.rowChecksum || ''),
          importedAt: found.importedAt ? String(found.importedAt) : undefined,
          createdAt: found.createdAt ? String(found.createdAt) : undefined,
          createdByUid: found.createdByUid ? String(found.createdByUid) : undefined,
        });
      }
    }
  }
  return result;
}

export async function getCollectionCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const col of VALID_COLLECTIONS) {
    const map = await readCollectionMapUnsafe(col);
    counts[col] = Object.keys(map).length;
  }
  return counts;
}

export async function exportAllLocalCollections(): Promise<Record<string, Record<string, Record<string, unknown>>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const col of VALID_COLLECTIONS) {
    out[col] = await readCollectionMapUnsafe(col);
  }
  return out;
}

export async function importAllLocalCollections(
  collectionsMap: Record<string, unknown>,
  mode: 'replace' | 'merge' = 'replace'
): Promise<Record<string, number>> {
  const restoredCounts: Record<string, number> = {};
  for (const col of VALID_COLLECTIONS) {
    const incomingRaw = collectionsMap[col];
    await withCollectionLock(col, async () => {
      let nextMap: Record<string, Record<string, unknown>> =
        mode === 'merge' ? await readCollectionMapUnsafe(col) : {};

      if (incomingRaw && typeof incomingRaw === 'object') {
        if (Array.isArray(incomingRaw)) {
          for (const item of incomingRaw) {
            if (!item || typeof item !== 'object') continue;
            const obj = item as Record<string, unknown>;
            const inferredId = String(
              obj.id ||
                obj.uid ||
                obj.internalRiderId ||
                obj.vehicleInternalId ||
                obj.recordKey ||
                obj.batchId ||
                obj.roleId ||
                obj.docId ||
                obj.accountId ||
                obj.assignmentId ||
                obj.maintenanceId ||
                obj.fieldId ||
                obj.formId ||
                obj.sectionId ||
                obj.pageId ||
                obj.recordId ||
                obj.ruleId ||
                obj.trashId ||
                obj.snapshotId ||
                obj.templateId ||
                obj.viewId ||
                obj.logId ||
                obj.mappingId ||
                obj.caseId ||
                obj.noteId ||
                obj.settingsId ||
                obj.brandingId ||
                obj.platformId ||
                obj.typeId ||
                ''
            );
            if (isValidDocId(inferredId)) {
              nextMap[inferredId] = obj;
            }
          }
        } else {
          for (const [docId, docVal] of Object.entries(incomingRaw as Record<string, unknown>)) {
            if (isValidDocId(docId) && docVal && typeof docVal === 'object' && !Array.isArray(docVal)) {
              nextMap[docId] = docVal as Record<string, unknown>;
            }
          }
        }
      }
      await writeCollectionMapUnsafe(col, nextMap);
      restoredCounts[col] = Object.keys(nextMap).length;
    });
  }
  return restoredCounts;
}

export async function clearAllLocalCollections(): Promise<string[]> {
  const cleared: string[] = [];
  for (const col of VALID_COLLECTIONS) {
    await withCollectionLock(col, async () => {
      await writeCollectionMapUnsafe(col, {});
      cleared.push(col);
    });
  }
  return cleared;
}
