import type ExcelJS from 'exceljs';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import {
  parseExcelCore,
  type ParsedCollectionRecord,
  type ParsedWorkbookOutput,
} from '../shared/excelParserCore';
import { buildExcelReportArrayBuffer, type ExportColumn } from '../shared/exportCore';
import type {
  DailySummary,
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  ImportPreviewResult,
  KeetaDashboardDaily,
  KeetaVdaDaily,
  MonthlySummary,
  UserProfile,
} from '../types/fleet';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  getDriveAccessToken,
  handleFirestoreError,
  OperationType,
  refreshDriveTokenWithPopup,
} from './firebase';

// Standard FIPS 180-4 synchronous SHA-256 (UTF-8 / Uint8Array) matching Node crypto
function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = dv.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
      const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

async function getBrowserExcelJS(): Promise<typeof ExcelJS> {
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof ExcelJS;
    Workbook?: typeof ExcelJS.Workbook;
  };
  const globalExcel = (globalThis as unknown as { ExcelJS?: typeof ExcelJS }).ExcelJS;
  const resolved = (mod?.Workbook ? mod : mod?.default) || globalExcel;
  if (!resolved || !resolved.Workbook) {
    throw new Error('تعذر تحميل مكتبة معالجة ملفات Excel في المتصفح.');
  }
  return resolved as typeof ExcelJS;
}

interface ClientCachedPreview {
  parsedList: ParsedWorkbookOutput[];
  previewResults: ImportPreviewResult[];
}

const clientPreviewStore = new Map<string, ClientCachedPreview>();

async function fetchExistingMetaMap(
  collections: Set<string>,
  user: UserProfile
): Promise<Map<string, { rowChecksum: string; importedAt?: Timestamp; createdByUid?: string }>> {
  const map = new Map<string, { rowChecksum: string; importedAt?: Timestamp; createdByUid?: string }>();
  const isBootOwner = user.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;

  for (const colName of collections) {
    try {
      const ref = collection(db, colName);
      const q = isBootOwner ? ref : query(ref, where('allowedUids', 'array-contains', user.uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data() as { rowChecksum?: string; importedAt?: Timestamp; createdByUid?: string };
        map.set(`${colName}:${d.id}`, {
          rowChecksum: String(data.rowChecksum || ''),
          importedAt: data.importedAt,
          createdByUid: data.createdByUid,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colName);
    }
  }
  return map;
}

async function getAllowedTeamUids(callerUid: string, isBootOwner: boolean): Promise<string[]> {
  try {
    const usersRef = collection(db, 'users');
    const q = isBootOwner
      ? usersRef
      : query(usersRef, where('managedByAdminUids', 'array-contains', callerUid));
    const snap = await getDocs(q);
    const activeUids = snap.docs
      .map((d) => d.data() as { active?: boolean; uid?: string })
      .filter((u) => Boolean(u.active) && typeof u.uid === 'string')
      .map((u) => String(u.uid));
    return Array.from(new Set([callerUid, ...activeUids])).slice(0, 20);
  } catch {
    return [callerUid];
  }
}

export async function previewExcelInBrowser(params: {
  localFiles: File[];
  driveFiles: Array<{ id: string; name: string }>;
  user: UserProfile;
}): Promise<{ previewId: string; files: ImportPreviewResult[] }> {
  const ExcelJSClass = await getBrowserExcelJS();
  const isBootOwner = params.user.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
  const allowedUids = await getAllowedTeamUids(params.user.uid, isBootOwner);

  const items: Array<{ data: ArrayBuffer; fileName: string; sourceType: 'local' | 'google_drive'; driveFileId?: string }> = [];

  for (const f of params.localFiles) {
    items.push({
      data: await f.arrayBuffer(),
      fileName: f.name,
      sourceType: 'local',
    });
  }

  if (params.driveFiles.length > 0) {
    let driveToken = getDriveAccessToken();
    if (!driveToken) {
      driveToken = await refreshDriveTokenWithPopup();
    }
    if (!driveToken) {
      throw new Error('يلزم تفويض Google Drive لقراءة الملفات المحددة.');
    }
    for (const df of params.driveFiles) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(df.id)}?alt=media`, {
        headers: { Authorization: `Bearer ${driveToken}` },
      });
      if (!res.ok) {
        throw new Error(`تعذر تحميل الملف "${df.name}" من Google Drive.`);
      }
      items.push({
        data: await res.arrayBuffer(),
        fileName: df.name,
        sourceType: 'google_drive',
        driveFileId: df.id,
      });
    }
  }

  const parsedList: ParsedWorkbookOutput[] = [];
  const previewResults: ImportPreviewResult[] = [];
  const previewId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parsed = await parseExcelCore({
      data: item.data,
      fileName: item.fileName,
      batchId,
      createdByUid: params.user.uid,
      allowedUids,
      createWorkbook: () => new ExcelJSClass.Workbook(),
      sha256: sha256Hex,
    });
    parsedList.push(parsed);

    const targetCols = new Set(parsed.records.map((r) => r.collection));
    const existingMap = await fetchExistingMetaMap(targetCols, params.user);

    let newCount = 0;
    let updatedCount = 0;
    let duplicateCount = 0;
    const sheetStatMap = new Map(parsed.sheetDiagnostics.map((s) => [s.sheetName, s]));
    const previewRows: ImportPreviewResult['previewRows'] = [];

    for (const rec of parsed.records) {
      const existing = existingMap.get(`${rec.collection}:${rec.data.recordKey}`);
      const diag = sheetStatMap.get(rec.data.sourceSheet);
      let changeStatus: 'new' | 'update' | 'duplicate' = 'new';

      if (!existing) {
        newCount++;
        if (diag) diag.newCount++;
      } else if (existing.rowChecksum === rec.data.rowChecksum) {
        changeStatus = 'duplicate';
        duplicateCount++;
        if (diag) diag.duplicateCount++;
      } else {
        changeStatus = 'update';
        updatedCount++;
        if (diag) diag.updatedCount++;
      }

      if (previewRows.length < 40) {
        const dateOrPeriod =
          'date' in rec.data
            ? rec.data.date
            : 'snapshotDate' in rec.data
              ? rec.data.snapshotDate
              : 'month' in rec.data
                ? rec.data.month
                : '-';
        previewRows.push({
          sheetName: rec.data.sourceSheet,
          recordKey: rec.data.recordKey,
          riderId: rec.data.riderId,
          dateOrPeriod,
          summaryText:
            rec.collection === 'hungerDaily'
              ? `طلبات مكتملة: ${rec.data.completedDeliveries ?? 'غير متاح'} | ساعات: ${rec.data.actualWorkingHours ?? 'غير متاح'}`
              : rec.collection === 'keetaDashboardDaily'
                ? `مهام مسلمة: ${rec.data.deliveredTasks ?? 'غير متاح'} | ساعات: ${rec.data.shiftOnlineHours ?? 'غير متاح'}`
                : rec.collection === 'hungerWalletSnapshots'
                  ? `الرصيد: ${rec.data.currentWallet}`
                  : rec.collection === 'hungerDistanceDaily'
                    ? `KM: ${rec.data.totalKm ?? 'غير متاح'} | مستحق: ${rec.data.payableKm ?? 'غير متاح'}`
                    : rec.collection === 'keetaVdaDaily'
                      ? `مسافة: ${rec.data.totalDeliveryDistance ?? 'غير متاح'} | شفتات صالحة: ${rec.data.sumValidShifts ?? 'غير متاح'}`
                      : rec.collection === 'hungerQualityMonthly'
                        ? `النتيجة: ${rec.data.finalDeliveryQualityScore ?? 'غير متاح'} | ${rec.data.segment || '-'}`
                        : rec.collection === 'keetaRankSnapshots'
                          ? `المستوى: ${rec.data.currentEstimatedLevel || '-'} | مكافأة: ${rec.data.estimatedRewardAmount ?? 'غير متاح'}`
                          : `النتيجة: ${rec.data.finalInspectionResult || '-'} | نسبة النجاح: ${rec.data.passRateMtd ?? 'غير متاح'}%`,
          changeStatus,
        });
      }
    }

    const withinFileDupes = parsed.sheetDiagnostics.reduce((acc, s) => acc + s.duplicateCount, 0);
    const totalDupes = Math.max(duplicateCount, withinFileDupes);

    previewResults.push({
      previewId,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      platform: parsed.platform,
      sourceType: item.sourceType,
      driveFileId: item.driveFileId,
      detectedPeriodStart: parsed.detectedPeriodStart,
      detectedPeriodEnd: parsed.detectedPeriodEnd,
      sheetsDetected: parsed.sheetsDetected,
      missingExpectedSheets: parsed.missingExpectedSheets,
      unknownColumns: parsed.unknownColumns,
      totalValid: parsed.records.length,
      newCount,
      updatedCount,
      duplicateCount: totalDupes,
      rejectedCount: parsed.rejectedRows.length,
      sheetDiagnostics: parsed.sheetDiagnostics,
      rejectedSample: parsed.rejectedRows.slice(0, 50),
      previewRows,
    });
  }

  clientPreviewStore.set(previewId, { parsedList, previewResults });
  return { previewId, files: previewResults };
}

export function hasClientPreview(previewId: string): boolean {
  return clientPreviewStore.has(previewId);
}

interface PendingBatchOp {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
}

async function commitBatchedOps(ops: PendingBatchOp[]): Promise<void> {
  const chunkSize = 400;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const op of chunk) {
      batch.set(doc(db, op.collection, op.docId), op.data);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, chunk[0]?.collection || 'importBatches');
    }
  }
}

async function recomputeSummariesClient(params: {
  affectedDates: Array<{ platform: 'hungerstation' | 'keeta'; date: string }>;
  user: UserProfile;
  allowedUids: string[];
}) {
  const { affectedDates, user, allowedUids } = params;
  if (affectedDates.length === 0) return;

  const isBootOwner = user.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
  const loadCol = async <T>(colName: string): Promise<T[]> => {
    try {
      const ref = collection(db, colName);
      const q = isBootOwner ? ref : query(ref, where('allowedUids', 'array-contains', user.uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as T);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colName);
    }
  };

  const summaryOps: PendingBatchOp[] = [];
  const hasHunger = affectedDates.some((d) => d.platform === 'hungerstation');
  const hasKeeta = affectedDates.some((d) => d.platform === 'keeta');

  if (hasHunger) {
    const [hungerDaily, hungerDist] = await Promise.all([
      loadCol<HungerDailyRecord>('hungerDaily'),
      loadCol<HungerDistanceDailyRecord>('hungerDistanceDaily'),
    ]);

    const distByDate = new Map<string, { totalKm: number; payableKm: number }>();
    for (const d of hungerDist) {
      const cur = distByDate.get(d.date) || { totalKm: 0, payableKm: 0 };
      cur.totalKm += d.totalKm ?? 0;
      cur.payableKm += d.payableKm ?? 0;
      distByDate.set(d.date, cur);
    }

    const byDate = new Map<string, HungerDailyRecord[]>();
    const months = new Set<string>();
    for (const r of hungerDaily) {
      const list = byDate.get(r.date) || [];
      list.push(r);
      byDate.set(r.date, list);
      months.add(r.month);
    }

    for (const date of new Set(affectedDates.filter((d) => d.platform === 'hungerstation').map((d) => d.date))) {
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
      const docData: Omit<DailySummary, 'updatedAt'> & { updatedAt: unknown } = {
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
        createdByUid: user.uid,
        allowedUids,
        updatedAt: serverTimestamp(),
      };
      summaryOps.push({ collection: 'dailySummaries', docId: summaryKey, data: docData });
    }

    for (const month of months) {
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
      const mDoc: Omit<MonthlySummary, 'updatedAt'> & { updatedAt: unknown } = {
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
        createdByUid: user.uid,
        allowedUids,
        updatedAt: serverTimestamp(),
      };
      summaryOps.push({ collection: 'monthlySummaries', docId: mKey, data: mDoc });
    }
  }

  if (hasKeeta) {
    const [keetaDash, keetaVda] = await Promise.all([
      loadCol<KeetaDashboardDaily>('keetaDashboardDaily'),
      loadCol<KeetaVdaDaily>('keetaVdaDaily'),
    ]);

    const vdaByDate = new Map<string, { totalKm: number; payableKm: number }>();
    for (const v of keetaVda) {
      const cur = vdaByDate.get(v.date) || { totalKm: 0, payableKm: 0 };
      cur.totalKm += v.totalDeliveryDistance ?? 0;
      cur.payableKm += v.payableDistance ?? 0;
      vdaByDate.set(v.date, cur);
    }

    const byDate = new Map<string, KeetaDashboardDaily[]>();
    const months = new Set<string>();
    for (const r of keetaDash) {
      const list = byDate.get(r.date) || [];
      list.push(r);
      byDate.set(r.date, list);
      months.add(r.month);
    }

    for (const date of new Set(affectedDates.filter((d) => d.platform === 'keeta').map((d) => d.date))) {
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
      const compRates = rows.map((r) => r.completionRate).filter((v): v is number => v !== null);
      const onTimeRates = rows.map((r) => r.onTimeRate).filter((v): v is number => v !== null);
      const cancelRates = rows.map((r) => r.cancellationRate).filter((v): v is number => v !== null);

      const summaryKey = `keeta_${date}`;
      const docData: Omit<DailySummary, 'updatedAt'> & { updatedAt: unknown } = {
        summaryKey,
        platform: 'keeta',
        date,
        month: date.slice(0, 7),
        totalRiders: uniqueRiders.size,
        activeRiders: activeRiders.size,
        completedOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders: cancelRates.length ? Math.round((cancelRates.reduce((a, b) => a + b, 0) / 100 / cancelRates.length) * acceptedOrders) : 0,
        workingHours: Number(workingHours.toFixed(2)),
        validHours: Number(validHours.toFixed(2)),
        totalKm: Number(dist.totalKm.toFixed(2)),
        payableKm: Number(dist.payableKm.toFixed(2)),
        overdueOrders,
        avgAcceptanceRate: acceptedOrders + rejectedOrders > 0 ? Number(((acceptedOrders / (acceptedOrders + rejectedOrders)) * 100).toFixed(2)) : 0,
        avgCompletionRate: compRates.length ? Number((compRates.reduce((a, b) => a + b, 0) / compRates.length).toFixed(2)) : 0,
        avgOnTimeRate: onTimeRates.length ? Number((onTimeRates.reduce((a, b) => a + b, 0) / onTimeRates.length).toFixed(2)) : 0,
        avgAttendanceRate: uniqueRiders.size > 0 ? Number(((rows.filter((r) => (r.onShift || '').toLowerCase() === 'yes' || (r.onShift || '') === '1' || (r.onShift || '').toLowerCase() === 'true').length / uniqueRiders.size) * 100).toFixed(2)) : 0,
        createdByUid: user.uid,
        allowedUids,
        updatedAt: serverTimestamp(),
      };
      summaryOps.push({ collection: 'dailySummaries', docId: summaryKey, data: docData });
    }

    for (const month of months) {
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
      const compRates = mRows.map((r) => r.completionRate).filter((v): v is number => v !== null);
      const onTimeRates = mRows.map((r) => r.onTimeRate).filter((v): v is number => v !== null);

      const mKey = `keeta_${month}`;
      const mDoc: Omit<MonthlySummary, 'updatedAt'> & { updatedAt: unknown } = {
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
        avgCompletionRate: compRates.length ? Number((compRates.reduce((a, b) => a + b, 0) / compRates.length).toFixed(2)) : 0,
        avgOnTimeRate: onTimeRates.length ? Number((onTimeRates.reduce((a, b) => a + b, 0) / onTimeRates.length).toFixed(2)) : 0,
        avgAttendanceRate: mRows.length > 0 ? Number(((mRows.filter((r) => (r.onShift || '').toLowerCase() === 'yes' || (r.onShift || '') === '1' || (r.onShift || '').toLowerCase() === 'true').length / mRows.length) * 100).toFixed(2)) : 0,
        createdByUid: user.uid,
        allowedUids,
        updatedAt: serverTimestamp(),
      };
      summaryOps.push({ collection: 'monthlySummaries', docId: mKey, data: mDoc });
    }
  }

  if (summaryOps.length > 0) {
    await commitBatchedOps(summaryOps);
  }
}

export async function commitExcelInBrowser(params: {
  previewId: string;
  user: UserProfile;
}): Promise<{ batches: Array<{ batchId: string; fileName: string; inserted: number; updated: number; skippedDuplicates: number }> }> {
  const cached = clientPreviewStore.get(params.previewId);
  if (!cached) {
    throw new Error('انتهت صلاحية جلسة المعاينة، يرجى إعادة معاينة الملف.');
  }

  const isBootOwner = params.user.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
  const allowedUids = await getAllowedTeamUids(params.user.uid, isBootOwner);
  const committedBatches: Array<{ batchId: string; fileName: string; inserted: number; updated: number; skippedDuplicates: number }> = [];
  const allAffectedDates: Array<{ platform: 'hungerstation' | 'keeta'; date: string }> = [];

  for (let i = 0; i < cached.parsedList.length; i++) {
    const parsed = cached.parsedList[i];
    const previewMeta = cached.previewResults[i];
    const targetCols = new Set(parsed.records.map((r) => r.collection));
    const existingMap = await fetchExistingMetaMap(targetCols, params.user);

    const ops: PendingBatchOp[] = [];
    let inserted = 0;
    let updated = 0;
    let skippedDuplicates = 0;

    for (const rec of parsed.records) {
      const existing = existingMap.get(`${rec.collection}:${rec.data.recordKey}`);
      if (existing && existing.rowChecksum === rec.data.rowChecksum) {
        skippedDuplicates++;
        continue;
      }

      const { importedAt: _i, updatedAt: _u, ...cleanData } = rec.data as unknown as Record<string, unknown>;
      if (existing && existing.importedAt) {
        updated++;
        ops.push({
          collection: rec.collection,
          docId: rec.data.recordKey,
          data: {
            ...cleanData,
            createdByUid: existing.createdByUid || params.user.uid,
            allowedUids,
            importedAt: existing.importedAt,
            updatedAt: serverTimestamp(),
          },
        });
      } else {
        inserted++;
        ops.push({
          collection: rec.collection,
          docId: rec.data.recordKey,
          data: {
            ...cleanData,
            createdByUid: params.user.uid,
            allowedUids,
            importedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
      }
    }

    const batchId = parsed.records[0]?.data.importBatchId || `batch_${Date.now()}_${i}`;
    ops.push({
      collection: 'importBatches',
      docId: batchId,
      data: {
        batchId,
        fileName: parsed.fileName,
        fileHash: parsed.fileHash,
        platform: parsed.platform,
        sourceType: previewMeta.sourceType,
        driveFileId: previewMeta.driveFileId || '',
        detectedPeriodStart: parsed.detectedPeriodStart || '',
        detectedPeriodEnd: parsed.detectedPeriodEnd || '',
        sheetsDetected: parsed.sheetsDetected.slice(0, 20),
        unknownColumns: parsed.unknownColumns.slice(0, 100),
        validCount: inserted + updated,
        duplicateCount: skippedDuplicates,
        rejectedCount: parsed.rejectedRows.length,
        updatedCount: updated,
        status: 'committed',
        importedByEmail: params.user.email,
        createdByUid: params.user.uid,
        allowedUids,
        createdAt: serverTimestamp(),
      },
    });

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ops.push({
      collection: 'auditLogs',
      docId: logId,
      data: {
        logId,
        action: 'IMPORT_COMMITTED',
        targetCollection: 'importBatches',
        targetId: batchId,
        actorUid: params.user.uid,
        actorEmail: params.user.email,
        details: `ملف: ${parsed.fileName} | المنصة: ${parsed.platform} | جديد: ${inserted} | محدث: ${updated} | مكرر متجاهل: ${skippedDuplicates} | مرفوض: ${parsed.rejectedRows.length}`,
        allowedUids,
        createdAt: serverTimestamp(),
      },
    });

    await commitBatchedOps(ops);
    for (const rec of parsed.records) {
      if ('date' in rec.data && typeof rec.data.date === 'string') {
        allAffectedDates.push({ platform: rec.data.platform, date: rec.data.date });
      }
    }
    committedBatches.push({ batchId, fileName: parsed.fileName, inserted, updated, skippedDuplicates });
  }

  await recomputeSummariesClient({ affectedDates: allAffectedDates, user: params.user, allowedUids });
  clientPreviewStore.delete(params.previewId);
  return { batches: committedBatches };
}

export async function exportExcelInBrowser(params: {
  title: string;
  sheetName: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  metadataLines?: string[];
  saveToDrive?: boolean;
  fileName: string;
}): Promise<{ driveFile?: { id: string; name: string } }> {
  const ExcelJSClass = await getBrowserExcelJS();
  const arrBuf = await buildExcelReportArrayBuffer({
    title: params.title,
    sheetName: params.sheetName,
    columns: params.columns,
    rows: params.rows,
    metadataLines: params.metadataLines,
    createWorkbook: () => new ExcelJSClass.Workbook(),
  });

  const safeName = (params.fileName || 'fleet_report.xlsx').replace(/[^a-zA-Z0-9._\-\u0600-\u06FF ]/g, '_');
  const finalName = safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`;

  if (params.saveToDrive) {
    let driveToken = getDriveAccessToken();
    if (!driveToken) {
      driveToken = await refreshDriveTokenWithPopup();
    }
    if (!driveToken) {
      throw new Error('يلزم تسجيل الدخول وتفويض Google Drive لحفظ الملف.');
    }

    const boundary = `fleet_boundary_${Date.now()}`;
    const metadataPart = JSON.stringify({
      name: finalName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const enc = new TextEncoder();
    const part1 = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n` +
        `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    );
    const part2 = new Uint8Array(arrBuf);
    const part3 = enc.encode(`\r\n--${boundary}--`);
    const body = new Blob([part1, part2, part3], { type: `multipart/related; boundary=${boundary}` });

    const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${driveToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!driveRes.ok) {
      throw new Error(`فشل رفع التقرير إلى Google Drive: ${await driveRes.text()}`);
    }
    const created = (await driveRes.json()) as { id: string; name: string };
    return { driveFile: created };
  }

  const blob = new Blob([arrBuf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  a.click();
  URL.revokeObjectURL(url);
  return {};
}
