import { safeParseJsonResponse } from './safeFetch';

export type Timestamp = string;

const SESSION_STORAGE_KEY = 'foc_session_token';

export function readStoredSessionToken(): string | null {
  try {
    const val = localStorage.getItem(SESSION_STORAGE_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredSessionToken(token: string | null): void {
  try {
    if (token && token.trim().length > 0) {
      localStorage.setItem(SESSION_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

export interface ErpDocRef {
  __kind: 'doc';
  collection: string;
  id: string;
  path: string;
}

export interface ErpCollectionRef {
  __kind: 'collection';
  collection: string;
  path: string;
}

export interface ErpWhereConstraint {
  __kind: 'where';
  field: string;
  op: '==' | 'array-contains' | 'in';
  value: unknown;
}

export interface ErpQueryRef {
  __kind: 'query';
  collection: string;
  filters: Array<{ field: string; op: '==' | 'array-contains' | 'in'; value: unknown }>;
}

export interface ServerTimestampSentinel {
  __serverTimestamp: true;
}

export const erpDbClient = { __erpLocalDb: true };

export function doc(
  parent: unknown,
  firstSegment: string,
  ...moreSegments: string[]
): ErpDocRef {
  if (
    parent &&
    typeof parent === 'object' &&
    '__kind' in parent &&
    (parent as { __kind?: string }).__kind === 'collection'
  ) {
    const col = (parent as ErpCollectionRef).collection;
    const id = firstSegment || `doc_${Date.now().toString(36)}`;
    return { __kind: 'doc', collection: col, id, path: `${col}/${id}` };
  }
  const all = [firstSegment, ...moreSegments].filter(Boolean);
  const col = all[0] || '';
  const id = all[1] || `doc_${Date.now().toString(36)}`;
  return { __kind: 'doc', collection: col, id, path: `${col}/${id}` };
}

export function collection(_db: unknown, colName: string): ErpCollectionRef {
  return { __kind: 'collection', collection: colName, path: colName };
}

export function where(
  field: string,
  op: '==' | 'array-contains' | 'in',
  value: unknown
): ErpWhereConstraint {
  return { __kind: 'where', field, op, value };
}

export function query(
  target: ErpCollectionRef | ErpQueryRef,
  ...constraints: ErpWhereConstraint[]
): ErpQueryRef {
  const existing = target.__kind === 'query' ? target.filters : [];
  const nextFilters = [
    ...existing,
    ...constraints
      .filter((c) => c && c.__kind === 'where')
      .map((c) => ({ field: c.field, op: c.op, value: c.value })),
  ];
  return {
    __kind: 'query',
    collection: target.collection,
    filters: nextFilters,
  };
}

export function serverTimestamp(): ServerTimestampSentinel {
  return { __serverTimestamp: true };
}

async function authedDbFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = readStoredSessionToken();
  if (!token) {
    throw new Error('انتهت الجلسة أو لم يتم تسجيل الدخول.');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  };
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...init, headers });
  const json = await safeParseJsonResponse<T & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(json?.error || `خطأ في قاعدة البيانات (HTTP ${res.status})`);
  }
  return json;
}

export interface ErpDocSnapshot<T = Record<string, unknown>> {
  id: string;
  exists: () => boolean;
  data: () => T;
}

export interface ErpQuerySnapshot<T = Record<string, unknown>> {
  empty: boolean;
  size: number;
  docs: Array<ErpDocSnapshot<T>>;
}

export async function getDoc<T = Record<string, unknown>>(
  ref: ErpDocRef
): Promise<ErpDocSnapshot<T>> {
  const res = await authedDbFetch<{ exists: boolean; id: string; data: T | null }>(
    `/api/db/doc/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`
  );
  return {
    id: res.id || ref.id,
    exists: () => Boolean(res.exists && res.data !== null),
    data: () => res.data as T,
  };
}

export async function getDocFromServer<T = Record<string, unknown>>(
  ref: ErpDocRef
): Promise<ErpDocSnapshot<T>> {
  return getDoc<T>(ref);
}

export async function getDocs<T = Record<string, unknown>>(
  target: ErpCollectionRef | ErpQueryRef
): Promise<ErpQuerySnapshot<T>> {
  const filters = target.__kind === 'query' ? target.filters : [];
  const res = await authedDbFetch<{ docs: Array<{ id: string; data: T }> }>('/api/db/query', {
    method: 'POST',
    body: JSON.stringify({ collection: target.collection, filters }),
  });
  const docs: Array<ErpDocSnapshot<T>> = (res.docs || []).map((entry) => ({
    id: entry.id,
    exists: () => true,
    data: () => entry.data,
  }));
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
  };
}

export async function setDoc(
  ref: ErpDocRef,
  data: Record<string, unknown>,
  options?: { merge?: boolean }
): Promise<void> {
  await authedDbFetch(`/api/db/doc/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`, {
    method: 'POST',
    body: JSON.stringify({ data, merge: Boolean(options?.merge) }),
  });
}

export async function updateDoc(
  ref: ErpDocRef,
  patch: Record<string, unknown>
): Promise<void> {
  await authedDbFetch(`/api/db/doc/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: patch }),
  });
}

export async function deleteDoc(ref: ErpDocRef): Promise<void> {
  await authedDbFetch(`/api/db/doc/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`, {
    method: 'DELETE',
  });
}

export interface ErpWriteBatch {
  set: (ref: ErpDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => ErpWriteBatch;
  update: (ref: ErpDocRef, data: Record<string, unknown>) => ErpWriteBatch;
  delete: (ref: ErpDocRef) => ErpWriteBatch;
  commit: () => Promise<void>;
}

export function writeBatch(_db?: unknown): ErpWriteBatch {
  const ops: Array<{
    type: 'set' | 'update' | 'delete';
    collection: string;
    docId: string;
    data?: Record<string, unknown>;
    merge?: boolean;
  }> = [];

  const batch: ErpWriteBatch = {
    set(ref, data, options) {
      ops.push({
        type: 'set',
        collection: ref.collection,
        docId: ref.id,
        data,
        merge: Boolean(options?.merge),
      });
      return batch;
    },
    update(ref, data) {
      ops.push({
        type: 'update',
        collection: ref.collection,
        docId: ref.id,
        data,
      });
      return batch;
    },
    delete(ref) {
      ops.push({
        type: 'delete',
        collection: ref.collection,
        docId: ref.id,
      });
      return batch;
    },
    async commit() {
      if (ops.length === 0) return;
      const chunkSize = 200;
      for (let i = 0; i < ops.length; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        await authedDbFetch('/api/db/batch', {
          method: 'POST',
          body: JSON.stringify({ ops: chunk }),
        });
      }
    },
  };

  return batch;
}
