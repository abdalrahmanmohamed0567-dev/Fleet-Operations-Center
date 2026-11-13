import type ExcelJS from 'exceljs';
import type {
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  HungerQualityMonthly,
  HungerWalletSnapshot,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  Platform,
  RejectedRowInfo,
  SheetParseDiagnostic,
} from '../types/fleet.js';

export type ParsedCollectionRecord =
  | { collection: 'hungerDaily'; data: HungerDailyRecord }
  | { collection: 'hungerDistanceDaily'; data: HungerDistanceDailyRecord }
  | { collection: 'hungerWalletSnapshots'; data: HungerWalletSnapshot }
  | { collection: 'hungerQualityMonthly'; data: HungerQualityMonthly }
  | { collection: 'keetaDashboardDaily'; data: KeetaDashboardDaily }
  | { collection: 'keetaVdaDaily'; data: KeetaVdaDaily }
  | { collection: 'keetaRankSnapshots'; data: KeetaRankSnapshot }
  | { collection: 'keetaFacialRecognitionDaily'; data: KeetaFacialRecognitionDaily };

export interface ParsedWorkbookOutput {
  fileName: string;
  fileHash: string;
  platform: Platform;
  sheetsDetected: string[];
  missingExpectedSheets: string[];
  unknownColumns: string[];
  detectedPeriodStart: string | null;
  detectedPeriodEnd: string | null;
  records: ParsedCollectionRecord[];
  sheetDiagnostics: SheetParseDiagnostic[];
  rejectedRows: RejectedRowInfo[];
}

export type Sha256Fn = (input: string | Uint8Array) => string;

export function sanitizeDocIdWithHash(prefix: string, rawParts: string[], sha256: Sha256Fn): string {
  const joined = [prefix, ...rawParts].join('_');
  const cleaned = joined.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  if (cleaned.length <= 110 && cleaned === joined.replace(/:/g, '_')) {
    return cleaned;
  }
  const hash = sha256(joined).slice(0, 12);
  const head = cleaned.slice(0, 95);
  return `${head}_${hash}`;
}

function unwrapCellValue(cell: ExcelJS.Cell | undefined): unknown {
  if (!cell) return null;
  let val: unknown = cell.value;
  if (val && typeof val === 'object') {
    const vObj = val as Record<string, unknown>;
    if ('result' in vObj) {
      val = vObj.result;
    } else if ('richText' in vObj && Array.isArray(vObj.richText)) {
      val = vObj.richText.map((part: { text?: string }) => part.text ?? '').join('');
    } else if ('text' in vObj && typeof vObj.text === 'string') {
      val = vObj.text;
    } else if ('hyperlink' in vObj && typeof vObj.hyperlink === 'string') {
      val = (vObj.text as string) ?? vObj.hyperlink;
    }
  }
  return val;
}

function cellToTrimmedString(cell: ExcelJS.Cell | undefined): string | null {
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    if (Number.isInteger(val)) return val.toFixed(0);
    return String(val);
  }
  const s = String(val).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') {
    return null;
  }
  return s;
}

function extractRiderIdString(cell: ExcelJS.Cell | undefined): string | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;

  let raw = '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    raw = Number.isInteger(val) ? val.toFixed(0) : String(val);
  } else if (typeof val === 'string') {
    raw = val.trim();
    if (/^\d+(\.\d+)?[eE][+\-]?\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n) && Number.isInteger(n)) {
        raw = n.toFixed(0);
      }
    }
  } else {
    raw = String(val).trim();
  }

  if (/^\d+\.0+$/.test(raw)) {
    raw = raw.replace(/\.0+$/, '');
  }

  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (['id', 'rider id', 'rider_id', 'courier id', 'courier_id', '-', 'n/a', 'null', 'nan', 'total', 'الإجمالي'].includes(lower)) {
    return null;
  }
  return raw;
}

function parseIsoDate(cell: ExcelJS.Cell | undefined): string | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;

  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    const yyyy = val.getUTCFullYear();
    const mm = String(val.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(val.getUTCDate()).padStart(2, '0');
    if (yyyy < 1995 || yyyy > 2100) return null;
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    if (val >= 19950101 && val <= 21001231 && Number.isInteger(val)) {
      const s = val.toFixed(0);
      const mm = Number(s.slice(4, 6));
      const dd = Number(s.slice(6, 8));
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      }
    }
    if (val >= 20000 && val <= 90000) {
      const epoch = Date.UTC(1899, 11, 30);
      const dt = new Date(epoch + Math.round(val) * 86400000);
      if (!Number.isNaN(dt.getTime())) {
        const yyyy = dt.getUTCFullYear();
        if (yyyy >= 1995 && yyyy <= 2100) {
          return dt.toISOString().slice(0, 10);
        }
      }
    }
    return null;
  }

  const s = String(val).trim();
  if (!s) return null;

  if (/^\d{8}$/.test(s)) {
    const yyyy = Number(s.slice(0, 4));
    const mm = Number(s.slice(4, 6));
    const dd = Number(s.slice(6, 8));
    if (yyyy >= 1995 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
  }

  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const yyyy = Number(isoMatch[1]);
    const mm = Number(isoMatch[2]);
    const dd = Number(isoMatch[3]);
    if (yyyy >= 1995 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const yyyy = Number(dmyMatch[3]);
    if (yyyy >= 1995 && yyyy <= 2100) {
      let dd = p1;
      let mm = p2;
      if (p2 > 12 && p1 <= 12) {
        mm = p1;
        dd = p2;
      }
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
  }

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 90000) {
      const epoch = Date.UTC(1899, 11, 30);
      const dt = new Date(epoch + Math.round(serial) * 86400000);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

function parseMonthKey(cell: ExcelJS.Cell | undefined, fallbackDate: string): string {
  const raw = cellToTrimmedString(cell);
  if (!raw) return fallbackDate.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsedDate = parseIsoDate(cell);
  if (parsedDate) return parsedDate.slice(0, 7);
  return raw.slice(0, 32);
}

function parseNumberStrict(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    return val;
  }
  const s = String(val).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') {
    return null;
  }
  const hmsMatch = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    const h = Number(hmsMatch[1]);
    const m = Number(hmsMatch[2]);
    const sec = hmsMatch[3] ? Number(hmsMatch[3]) : 0;
    return Number((h + m / 60 + sec / 3600).toFixed(4));
  }
  const cleaned = s.replace(/,/g, '').replace(/%$/, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePercentStrict(cell: ExcelJS.Cell | undefined, fractionScaleDetected = false): number | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    const fmt = String(cell.numFmt || '');
    const isPctFormatted = fmt.includes('%');
    if (isPctFormatted || (fractionScaleDetected && Math.abs(val) <= 1.0001)) {
      return Number((val * 100).toFixed(2));
    }
    return Number(val.toFixed(2));
  }

  const s = String(val).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') {
    return null;
  }
  const hasPct = s.endsWith('%');
  const cleaned = s.replace(/,/g, '').replace(/%$/, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (!hasPct && fractionScaleDetected && Math.abs(n) <= 1.0001) {
    return Number((n * 100).toFixed(2));
  }
  return Number(n.toFixed(2));
}

function parseMinutesStrict(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Number(val.toFixed(2)) : null;
  }
  const s = String(val).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') return null;
  const hmsMatch = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    const a = Number(hmsMatch[1]);
    const b = Number(hmsMatch[2]);
    const c = hmsMatch[3] ? Number(hmsMatch[3]) : 0;
    return Number((a * 60 + b + c / 60).toFixed(2));
  }
  const n = Number(s.replace(/min|m/gi, '').trim());
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowToRawStrings(row: ExcelJS.Row, colCount: number): string[] {
  const out: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    const val = unwrapCellValue(cell);
    out.push(val === null || val === undefined ? '' : String(val).trim());
  }
  return out;
}

function isRowEmpty(row: ExcelJS.Row, colCount: number): boolean {
  for (let c = 1; c <= colCount; c++) {
    const val = unwrapCellValue(row.getCell(c));
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      return false;
    }
  }
  return true;
}

function isRepeatedHeaderRow(row: ExcelJS.Row, headers: string[]): boolean {
  const rowVals = rowToRawStrings(row, headers.length);
  let matches = 0;
  let nonEmpty = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i] || '');
    const v = normHeader(rowVals[i] || '');
    if (v !== '') nonEmpty++;
    if (h !== '' && v !== '' && h === v) {
      matches++;
    }
  }
  if (nonEmpty === 0) return false;
  return matches >= 3 || (matches >= 2 && matches / nonEmpty >= 0.5);
}

function detectFractionScale(ws: ExcelJS.Worksheet, startRow: number, colIndex: number): boolean {
  let sampleCount = 0;
  let leOneCount = 0;
  let gtOneCount = 0;
  const maxScan = Math.min(ws.rowCount, startRow + 40);
  for (let r = startRow; r <= maxScan; r++) {
    const cell = ws.getRow(r).getCell(colIndex);
    const val = unwrapCellValue(cell);
    if (typeof val === 'number' && Number.isFinite(val)) {
      sampleCount++;
      if (val > 1.0001) gtOneCount++;
      else if (val > 0) leOneCount++;
      const fmt = String(cell.numFmt || '');
      if (fmt.includes('%')) return true;
    }
  }
  return sampleCount > 0 && gtOneCount === 0 && leOneCount > 0;
}

type SheetRole =
  | 'keeta_dashboard'
  | 'keeta_vda'
  | 'keeta_rank'
  | 'keeta_facial'
  | 'hunger_daily'
  | 'hunger_wallet'
  | 'hunger_distance'
  | 'hunger_quality'
  | 'unknown';

function classifySheet(sheetName: string, headers: string[]): SheetRole {
  const s = normHeader(sheetName);
  const hSet = new Set(headers.map(normHeader).filter(Boolean));

  if (s === 'dashboard' || (hSet.has('courier id') && (hSet.has('shift attendance summary') || hSet.has('delivered tasks')))) {
    return 'keeta_dashboard';
  }
  if (s === 'vda' || (hSet.has('online day') && (hSet.has('sum of valid shifts') || hSet.has('total delivery distance')))) {
    return 'keeta_vda';
  }
  if (s === 'rankplanprocess' || s.includes('rankplan') || (hSet.has('current estimated level') && hSet.has('ranking percentile'))) {
    return 'keeta_rank';
  }
  if (s === 'facialrecognitiondatareport' || s.includes('facialrecognition') || hSet.has('final inspection result')) {
    return 'keeta_facial';
  }
  if (s === 'hunger-daily' || s === 'hunger daily' || (hSet.has('working days') && hSet.has('planned working hours'))) {
    return 'hunger_daily';
  }
  if (s === 'riders wallet' || (hSet.has('current wallet') && hSet.has('rider id'))) {
    return 'hunger_wallet';
  }
  if (s === 'riders distance' || (hSet.has('total km') && hSet.has('payable km'))) {
    return 'hunger_distance';
  }
  if (s === 'delivery quality segmentation' || s.includes('quality segmentation') || hSet.has('final delivery quality score') || hSet.has('total verification requests')) {
    return 'hunger_quality';
  }
  return 'unknown';
}

function buildHeaderMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = normHeader(h);
    if (key && !map.has(key)) {
      map.set(key, idx + 1);
    }
  });
  return map;
}

function findCol(map: Map<string, number>, aliases: string[]): number | undefined {
  for (const a of aliases) {
    const found = map.get(normHeader(a));
    if (found) return found;
  }
  return undefined;
}

export async function parseExcelCore(params: {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  batchId: string;
  createdByUid: string;
  allowedUids: string[];
  importDateIso?: string;
  createWorkbook: () => ExcelJS.Workbook;
  sha256: Sha256Fn;
}): Promise<ParsedWorkbookOutput> {
  const { data, fileName, batchId, createdByUid, allowedUids, createWorkbook, sha256 } = params;
  const fallbackImportDate = params.importDateIso || new Date().toISOString().slice(0, 10);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const fileHash = sha256(bytes);

  const workbook = createWorkbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  const sheetsDetected: string[] = [];
  const classifiedSheets: Array<{ ws: ExcelJS.Worksheet; role: SheetRole; headers: string[] }> = [];
  let hungerVotes = 0;
  let keetaVotes = 0;

  for (const ws of workbook.worksheets) {
    sheetsDetected.push(ws.name);
    if (ws.rowCount === 0) continue;
    const colCount = Math.max(ws.columnCount, ws.getRow(1).cellCount, 16);
    const headers = rowToRawStrings(ws.getRow(1), colCount);
    const role = classifySheet(ws.name, headers);
    classifiedSheets.push({ ws, role, headers });
    if (role.startsWith('hunger_')) hungerVotes++;
    if (role.startsWith('keeta_')) keetaVotes++;
  }

  if (hungerVotes === 0 && keetaVotes === 0) {
    throw new Error('تعذر التعرف على المنصة (HungerStation أو Keeta) من أسماء الشيتات والأعمدة داخل الملف.');
  }

  const platform: Platform = keetaVotes >= hungerVotes ? 'keeta' : 'hungerstation';
  const expectedSheets =
    platform === 'keeta'
      ? [
          { role: 'keeta_dashboard' as SheetRole, name: 'Dashboard' },
          { role: 'keeta_vda' as SheetRole, name: 'VDA' },
          { role: 'keeta_rank' as SheetRole, name: 'RankPlanProcess' },
          { role: 'keeta_facial' as SheetRole, name: 'FacialRecognitionDataReport' },
        ]
      : [
          { role: 'hunger_daily' as SheetRole, name: 'Hunger-Daily' },
          { role: 'hunger_wallet' as SheetRole, name: 'Riders Wallet' },
          { role: 'hunger_distance' as SheetRole, name: 'Riders Distance' },
          { role: 'hunger_quality' as SheetRole, name: 'Delivery Quality Segmentation' },
        ];

  const presentRoles = new Set(classifiedSheets.map((s) => s.role));
  const missingExpectedSheets = expectedSheets.filter((e) => !presentRoles.has(e.role)).map((e) => e.name);

  const records: ParsedCollectionRecord[] = [];
  const sheetDiagnostics: SheetParseDiagnostic[] = [];
  const rejectedRows: RejectedRowInfo[] = [];
  const unknownColumnsGlobal = new Set<string>();

  let minDate: string | null = null;
  let maxDate: string | null = null;
  const trackDate = (d: string | null) => {
    if (!d) return;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  };

  for (const { ws, role, headers } of classifiedSheets) {
    const colCount = Math.max(ws.columnCount, headers.length);
    const hMap = buildHeaderMap(headers);

    const diag: SheetParseDiagnostic = {
      sheetName: ws.name,
      targetCollection:
        role === 'hunger_daily'
          ? 'hungerDaily'
          : role === 'hunger_distance'
            ? 'hungerDistanceDaily'
            : role === 'hunger_wallet'
              ? 'hungerWalletSnapshots'
              : role === 'hunger_quality'
                ? 'hungerQualityMonthly'
                : role === 'keeta_dashboard'
                  ? 'keetaDashboardDaily'
                  : role === 'keeta_vda'
                    ? 'keetaVdaDaily'
                    : role === 'keeta_rank'
                      ? 'keetaRankSnapshots'
                      : role === 'keeta_facial'
                        ? 'keetaFacialRecognitionDaily'
                        : 'unmapped',
      totalRowsScanned: Math.max(0, ws.rowCount - 1),
      emptyRowsSkipped: 0,
      duplicateHeadersSkipped: 0,
      validCount: 0,
      newCount: 0,
      updatedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      unknownColumns: [],
    };

    if (role === 'unknown') {
      sheetDiagnostics.push(diag);
      continue;
    }

    const knownAliasesByRole: Record<SheetRole, string[]> = {
      keeta_dashboard: [
        'date', 'courier id', 'courier first name', 'courier last name', 'vehicle type',
        'headquarters', 'branch', 'supervisor', 'courier type', 'shift attendance summary',
        'on-shift?', 'valid day?', 'courier app online time', 'shift valid online time',
        'shift online hours', 'accepted tasks', 'tasks with restaurant arrivals',
        'delivered tasks', 'large order tasks completed', 'rejected tasks',
        'rejected tasks (courier)', 'rejected tasks (auto)', 'cancellation rate from delivery issues',
        'order completion rate', 'on-time rate', 'large order on-time rate',
        'average delivery time', 'delivered orders over 55min', 'overdue order tasks',
        'severely overdue order tasks',
      ],
      keeta_vda: [
        'rider id', 'vehicle type', 'online day', 'first online date', 'shift online hours',
        'sum of valid shifts', 'should online days', 'total delivered tasks', 'on-time d tasks',
        'cancellation(d)', 'delivered orders over 55min', 'accepted orders',
        'total delivery distance', 'payable distance',
        'scheduled shifts s1', 'scheduled shifts s2', 'scheduled shifts s3', 'scheduled shifts s4', 'scheduled shifts s5', 'scheduled shifts s6',
        'shift hours s1', 'shift hours s2', 'shift hours s3', 'shift hours s4', 'shift hours s5', 'shift hours s6',
        'valid shifts s1', 'valid shifts s2', 'valid shifts s3', 'valid shifts s4', 'valid shifts s5', 'valid shifts s6',
      ],
      keeta_rank: [
        'courier id', 'name', 'current estimated level', 'ranking percentile',
        'forced assignment score', 'estimated reward amount', 'on-time rate',
        'order completion rate', "didn't tap drop-off too early", 'order volume',
      ],
      keeta_facial: [
        'date', 'city', 'courier id', 'partner id', 'partner name', 'pmm',
        'if_triggered_today', 'final inspection result', 'total days triggered mtd',
        'total days passed mtd', 'pass rate mtd', 'over 90% pass rate',
      ],
      hunger_daily: [
        'id', 'city name', 'contract name', 'vehicle name', 'batch number', 'tga status',
        'error codes', 'shifts', 'working days', 'planned working hours', 'actual working hours',
        'avg. working hours per day', 'attendance rate', 'break hours', 'lost hours',
        'acceptance rate', 'contact rate', 'no shows', 'no show %', 'notified deliveries',
        'completed deliveries', 'accepted deliveries', 'stacked deliveries', 'declined deliveries',
        'cancelled deliveries', 'deduction deliveries', 'not accepted deliveries',
        'manual undispatched', 'rider-customer chat response %',
      ],
      hunger_wallet: ['rider id', 'current wallet'],
      hunger_distance: ['created date', 'city name', 'contract name', 'rider id', 'total km', 'payable km', 'avg km', 'completed deliveries'],
      hunger_quality: [
        'month', 'city', 'contract', 'rider id', 'vehicle type', 'total verification requests',
        'successful verification requests', 'verification success rate', 'gross orders',
        'completed orders', 'completed orders in time', 'failed orders by rider',
        'on-time delivery score', 'fail rate score', 'final delivery quality score', 'segment',
      ],
      unknown: [],
    };

    const knownSet = new Set(knownAliasesByRole[role].map(normHeader));
    const extraColEntries: Array<{ colIndex: number; rawHeader: string }> = [];
    headers.forEach((rawH, idx) => {
      const trimmed = rawH.trim();
      if (!trimmed) return;
      const nh = normHeader(trimmed);
      const isVdaShiftDynamic = role === 'keeta_vda' && /^(scheduled shifts|shift hours|valid shifts)\s*s[1-6]$/i.test(trimmed);
      if (!knownSet.has(nh) && !isVdaShiftDynamic) {
        diag.unknownColumns.push(trimmed);
        unknownColumnsGlobal.add(`${ws.name}: ${trimmed}`);
        extraColEntries.push({ colIndex: idx + 1, rawHeader: trimmed });
      }
    });

    const fracFlags = new Map<number, boolean>();
    const checkFrac = (col: number | undefined) => {
      if (col && !fracFlags.has(col)) {
        fracFlags.set(col, detectFractionScale(ws, 2, col));
      }
    };

    const qualityColEHeader = (headers[4] || '').trim();
    const qualityColFHeader = normHeader(headers[5] || '');
    const isQualityShifted =
      role === 'hunger_quality' &&
      (qualityColEHeader === '' || qualityColFHeader === 'total verification requests' || qualityColFHeader === 'vehicle type');

    const cId =
      role === 'hunger_daily'
        ? findCol(hMap, ['id'])
        : role === 'hunger_wallet' || role === 'hunger_distance'
          ? findCol(hMap, ['rider id'])
          : role === 'hunger_quality'
            ? 4
            : role === 'keeta_vda'
              ? findCol(hMap, ['rider id', 'courier id'])
              : findCol(hMap, ['courier id', 'rider id']);

    const cDate =
      role === 'hunger_daily'
        ? findCol(hMap, ['working days'])
        : role === 'hunger_distance'
          ? findCol(hMap, ['created date'])
          : role === 'keeta_vda'
            ? findCol(hMap, ['online day'])
            : role === 'keeta_dashboard' || role === 'keeta_facial'
              ? findCol(hMap, ['date'])
              : undefined;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (isRowEmpty(row, colCount)) {
        diag.emptyRowsSkipped++;
        continue;
      }
      if (isRepeatedHeaderRow(row, headers)) {
        diag.duplicateHeadersSkipped++;
        continue;
      }

      const riderId = extractRiderIdString(cId ? row.getCell(cId) : undefined);
      if (!riderId) {
        diag.rejectedCount++;
        const rawAttempt = cId ? String(unwrapCellValue(row.getCell(cId)) ?? '') : '';
        rejectedRows.push({
          sheetName: ws.name,
          rowNumber: r,
          riderIdRaw: rawAttempt,
          reason: 'معرف المندوب مفقود أو غير صالح',
        });
        continue;
      }

      if (role === 'hunger_daily') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'تاريخ Working Days غير صالح' });
          continue;
        }
        trackDate(isoDate);

        const cAttendance = findCol(hMap, ['attendance rate']);
        const cAccept = findCol(hMap, ['acceptance rate']);
        const cContact = findCol(hMap, ['contact rate']);
        const cNoShowPct = findCol(hMap, ['no show %']);
        const cChatPct = findCol(hMap, ['rider-customer chat response %']);
        [cAttendance, cAccept, cContact, cNoShowPct, cChatPct].forEach(checkFrac);

        const recordKey = sanitizeDocIdWithHash('hs_daily', [riderId, isoDate], sha256);
        const payload: Omit<HungerDailyRecord, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'hungerstation',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          city: cellToTrimmedString(findCol(hMap, ['city name']) ? row.getCell(findCol(hMap, ['city name'])!) : undefined) ?? '',
          contractName: cellToTrimmedString(findCol(hMap, ['contract name']) ? row.getCell(findCol(hMap, ['contract name'])!) : undefined) ?? '',
          vehicleName: cellToTrimmedString(findCol(hMap, ['vehicle name']) ? row.getCell(findCol(hMap, ['vehicle name'])!) : undefined) ?? '',
          batchNumber: cellToTrimmedString(findCol(hMap, ['batch number']) ? row.getCell(findCol(hMap, ['batch number'])!) : undefined) ?? '',
          tgaStatus: cellToTrimmedString(findCol(hMap, ['tga status']) ? row.getCell(findCol(hMap, ['tga status'])!) : undefined) ?? '',
          errorCodes: (cellToTrimmedString(findCol(hMap, ['error codes', 'error code']) ? row.getCell(findCol(hMap, ['error codes', 'error code'])!) : undefined) ?? '').slice(0, 500),
          shifts: parseNumberStrict(findCol(hMap, ['shifts']) ? row.getCell(findCol(hMap, ['shifts'])!) : undefined),
          plannedWorkingHours: parseNumberStrict(findCol(hMap, ['planned working hours']) ? row.getCell(findCol(hMap, ['planned working hours'])!) : undefined),
          actualWorkingHours: parseNumberStrict(findCol(hMap, ['actual working hours']) ? row.getCell(findCol(hMap, ['actual working hours'])!) : undefined),
          avgWorkingHoursPerDay: parseNumberStrict(findCol(hMap, ['avg. working hours per day']) ? row.getCell(findCol(hMap, ['avg. working hours per day'])!) : undefined),
          attendanceRate: parsePercentStrict(cAttendance ? row.getCell(cAttendance) : undefined, fracFlags.get(cAttendance || 0)),
          breakHours: parseNumberStrict(findCol(hMap, ['break hours']) ? row.getCell(findCol(hMap, ['break hours'])!) : undefined),
          lostHours: parseNumberStrict(findCol(hMap, ['lost hours']) ? row.getCell(findCol(hMap, ['lost hours'])!) : undefined),
          acceptanceRate: parsePercentStrict(cAccept ? row.getCell(cAccept) : undefined, fracFlags.get(cAccept || 0)),
          contactRate: parsePercentStrict(cContact ? row.getCell(cContact) : undefined, fracFlags.get(cContact || 0)),
          noShows: parseNumberStrict(findCol(hMap, ['no shows']) ? row.getCell(findCol(hMap, ['no shows'])!) : undefined),
          noShowPct: parsePercentStrict(cNoShowPct ? row.getCell(cNoShowPct) : undefined, fracFlags.get(cNoShowPct || 0)),
          notifiedDeliveries: parseNumberStrict(findCol(hMap, ['notified deliveries']) ? row.getCell(findCol(hMap, ['notified deliveries'])!) : undefined),
          completedDeliveries: parseNumberStrict(findCol(hMap, ['completed deliveries']) ? row.getCell(findCol(hMap, ['completed deliveries'])!) : undefined),
          acceptedDeliveries: parseNumberStrict(findCol(hMap, ['accepted deliveries']) ? row.getCell(findCol(hMap, ['accepted deliveries'])!) : undefined),
          stackedDeliveries: parseNumberStrict(findCol(hMap, ['stacked deliveries']) ? row.getCell(findCol(hMap, ['stacked deliveries'])!) : undefined),
          declinedDeliveries: parseNumberStrict(findCol(hMap, ['declined deliveries']) ? row.getCell(findCol(hMap, ['declined deliveries'])!) : undefined),
          cancelledDeliveries: parseNumberStrict(findCol(hMap, ['cancelled deliveries']) ? row.getCell(findCol(hMap, ['cancelled deliveries'])!) : undefined),
          deductionDeliveries: parseNumberStrict(findCol(hMap, ['deduction deliveries']) ? row.getCell(findCol(hMap, ['deduction deliveries'])!) : undefined),
          notAcceptedDeliveries: parseNumberStrict(findCol(hMap, ['not accepted deliveries']) ? row.getCell(findCol(hMap, ['not accepted deliveries'])!) : undefined),
          manualUndispatched: parseNumberStrict(findCol(hMap, ['manual undispatched']) ? row.getCell(findCol(hMap, ['manual undispatched'])!) : undefined),
          chatResponsePct: parsePercentStrict(cChatPct ? row.getCell(cChatPct) : undefined, fracFlags.get(cChatPct || 0)),
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'hungerDaily', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'hunger_distance') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'تاريخ Created Date غير صالح' });
          continue;
        }
        trackDate(isoDate);
        const recordKey = sanitizeDocIdWithHash('hs_dist', [riderId, isoDate], sha256);
        const payload: Omit<HungerDistanceDailyRecord, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'hungerstation',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          city: cellToTrimmedString(findCol(hMap, ['city name']) ? row.getCell(findCol(hMap, ['city name'])!) : undefined) ?? '',
          contractName: cellToTrimmedString(findCol(hMap, ['contract name']) ? row.getCell(findCol(hMap, ['contract name'])!) : undefined) ?? '',
          totalKm: parseNumberStrict(findCol(hMap, ['total km']) ? row.getCell(findCol(hMap, ['total km'])!) : undefined),
          payableKm: parseNumberStrict(findCol(hMap, ['payable km']) ? row.getCell(findCol(hMap, ['payable km'])!) : undefined),
          avgKm: parseNumberStrict(findCol(hMap, ['avg km']) ? row.getCell(findCol(hMap, ['avg km'])!) : undefined),
          completedDeliveries: parseNumberStrict(findCol(hMap, ['completed deliveries']) ? row.getCell(findCol(hMap, ['completed deliveries'])!) : undefined),
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'hungerDistanceDaily', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'hunger_wallet') {
        const cWallet = findCol(hMap, ['current wallet']);
        const walletVal = parseNumberStrict(cWallet ? row.getCell(cWallet) : undefined);
        if (walletVal === null) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'قيمة Current Wallet مفقودة أو غير رقمية' });
          continue;
        }
        const snapshotDate = maxDate || fallbackImportDate;
        const recordKey = sanitizeDocIdWithHash('hs_wallet', [riderId, snapshotDate], sha256);
        const payload: Omit<HungerWalletSnapshot, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'hungerstation',
          riderId,
          snapshotDate,
          currentWallet: Number(walletVal.toFixed(2)),
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'hungerWalletSnapshots', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'hunger_quality') {
        const monthVal = parseMonthKey(row.getCell(1), fallbackImportDate);
        const cVerRate = isQualityShifted ? 8 : (findCol(hMap, ['verification success rate']) ?? 8);
        checkFrac(cVerRate);

        const colIdx = isQualityShifted
          ? {
              city: 2,
              contract: 3,
              vehicle: 5,
              totalVer: 6,
              succVer: 7,
              verRate: 8,
              gross: 9,
              comp: 10,
              compInTime: 11,
              failed: 12,
              onTimeScore: 13,
              failScore: 14,
              finalScore: 15,
              segment: 16,
            }
          : {
              city: findCol(hMap, ['city']) ?? 2,
              contract: findCol(hMap, ['contract']) ?? 3,
              vehicle: findCol(hMap, ['vehicle type']) ?? 5,
              totalVer: findCol(hMap, ['total verification requests']) ?? 6,
              succVer: findCol(hMap, ['successful verification requests']) ?? 7,
              verRate: findCol(hMap, ['verification success rate']) ?? 8,
              gross: findCol(hMap, ['gross orders']) ?? 9,
              comp: findCol(hMap, ['completed orders']) ?? 10,
              compInTime: findCol(hMap, ['completed orders in time']) ?? 11,
              failed: findCol(hMap, ['failed orders by rider']) ?? 12,
              onTimeScore: findCol(hMap, ['on-time delivery score']) ?? 13,
              failScore: findCol(hMap, ['fail rate score']) ?? 14,
              finalScore: findCol(hMap, ['final delivery quality score']) ?? 15,
              segment: findCol(hMap, ['segment']) ?? 16,
            };

        const recordKey = sanitizeDocIdWithHash('hs_qual', [riderId, monthVal], sha256);
        const payload: Omit<HungerQualityMonthly, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'hungerstation',
          riderId,
          month: monthVal,
          city: cellToTrimmedString(row.getCell(colIdx.city)) ?? '',
          contractName: cellToTrimmedString(row.getCell(colIdx.contract)) ?? '',
          vehicleType: cellToTrimmedString(row.getCell(colIdx.vehicle)) ?? '',
          totalVerificationRequests: parseNumberStrict(row.getCell(colIdx.totalVer)),
          successfulVerificationRequests: parseNumberStrict(row.getCell(colIdx.succVer)),
          verificationSuccessRate: parsePercentStrict(row.getCell(colIdx.verRate), fracFlags.get(colIdx.verRate)),
          grossOrders: parseNumberStrict(row.getCell(colIdx.gross)),
          completedOrders: parseNumberStrict(row.getCell(colIdx.comp)),
          completedOrdersInTime: parseNumberStrict(row.getCell(colIdx.compInTime)),
          failedOrdersByRider: parseNumberStrict(row.getCell(colIdx.failed)),
          onTimeDeliveryScore: parseNumberStrict(row.getCell(colIdx.onTimeScore)),
          failRateScore: parseNumberStrict(row.getCell(colIdx.failScore)),
          finalDeliveryQualityScore: parseNumberStrict(row.getCell(colIdx.finalScore)),
          segment: cellToTrimmedString(row.getCell(colIdx.segment)) ?? '',
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'hungerQualityMonthly', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'keeta_dashboard') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'تاريخ Date غير صالح' });
          continue;
        }
        trackDate(isoDate);

        const cCancel = findCol(hMap, ['cancellation rate from delivery issues']);
        const cComp = findCol(hMap, ['order completion rate']);
        const cOnTime = findCol(hMap, ['on-time rate']);
        const cLargeOnTime = findCol(hMap, ['large order on-time rate']);
        [cCancel, cComp, cOnTime, cLargeOnTime].forEach(checkFrac);

        const firstName = cellToTrimmedString(findCol(hMap, ['courier first name']) ? row.getCell(findCol(hMap, ['courier first name'])!) : undefined) ?? '';
        const lastName = cellToTrimmedString(findCol(hMap, ['courier last name']) ? row.getCell(findCol(hMap, ['courier last name'])!) : undefined) ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || riderId;

        const rawExtraColumns: Record<string, string | number | null> = {};
        for (const extra of extraColEntries) {
          const cell = row.getCell(extra.colIndex);
          const num = parseNumberStrict(cell);
          rawExtraColumns[extra.rawHeader] = num !== null ? num : cellToTrimmedString(cell);
        }

        const recordKey = sanitizeDocIdWithHash('kt_dash', [riderId, isoDate], sha256);
        const payload: Omit<KeetaDashboardDaily, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          firstName,
          lastName,
          fullName,
          vehicleType: cellToTrimmedString(findCol(hMap, ['vehicle type']) ? row.getCell(findCol(hMap, ['vehicle type'])!) : undefined) ?? '',
          headquarters: cellToTrimmedString(findCol(hMap, ['headquarters']) ? row.getCell(findCol(hMap, ['headquarters'])!) : undefined) ?? '',
          branch: cellToTrimmedString(findCol(hMap, ['branch']) ? row.getCell(findCol(hMap, ['branch'])!) : undefined) ?? '',
          supervisor: cellToTrimmedString(findCol(hMap, ['supervisor']) ? row.getCell(findCol(hMap, ['supervisor'])!) : undefined) ?? '',
          courierType: cellToTrimmedString(findCol(hMap, ['courier type']) ? row.getCell(findCol(hMap, ['courier type'])!) : undefined) ?? '',
          shiftAttendanceSummary: cellToTrimmedString(findCol(hMap, ['shift attendance summary']) ? row.getCell(findCol(hMap, ['shift attendance summary'])!) : undefined) ?? '',
          onShift: cellToTrimmedString(findCol(hMap, ['on-shift?']) ? row.getCell(findCol(hMap, ['on-shift?'])!) : undefined) ?? '',
          validDay: cellToTrimmedString(findCol(hMap, ['valid day?']) ? row.getCell(findCol(hMap, ['valid day?'])!) : undefined) ?? '',
          appOnlineTime: parseNumberStrict(findCol(hMap, ['courier app online time']) ? row.getCell(findCol(hMap, ['courier app online time'])!) : undefined),
          shiftValidOnlineTime: parseNumberStrict(findCol(hMap, ['shift valid online time']) ? row.getCell(findCol(hMap, ['shift valid online time'])!) : undefined),
          shiftOnlineHours: parseNumberStrict(findCol(hMap, ['shift online hours']) ? row.getCell(findCol(hMap, ['shift online hours'])!) : undefined),
          acceptedTasks: parseNumberStrict(findCol(hMap, ['accepted tasks']) ? row.getCell(findCol(hMap, ['accepted tasks'])!) : undefined),
          restaurantArrivals: parseNumberStrict(findCol(hMap, ['tasks with restaurant arrivals']) ? row.getCell(findCol(hMap, ['tasks with restaurant arrivals'])!) : undefined),
          deliveredTasks: parseNumberStrict(findCol(hMap, ['delivered tasks']) ? row.getCell(findCol(hMap, ['delivered tasks'])!) : undefined),
          largeOrderTasksCompleted: parseNumberStrict(findCol(hMap, ['large order tasks completed']) ? row.getCell(findCol(hMap, ['large order tasks completed'])!) : undefined),
          rejectedTasks: parseNumberStrict(findCol(hMap, ['rejected tasks']) ? row.getCell(findCol(hMap, ['rejected tasks'])!) : undefined),
          rejectedTasksCourier: parseNumberStrict(findCol(hMap, ['rejected tasks (courier)']) ? row.getCell(findCol(hMap, ['rejected tasks (courier)'])!) : undefined),
          rejectedTasksAuto: parseNumberStrict(findCol(hMap, ['rejected tasks (auto)']) ? row.getCell(findCol(hMap, ['rejected tasks (auto)'])!) : undefined),
          cancellationRate: parsePercentStrict(cCancel ? row.getCell(cCancel) : undefined, fracFlags.get(cCancel || 0)),
          completionRate: parsePercentStrict(cComp ? row.getCell(cComp) : undefined, fracFlags.get(cComp || 0)),
          onTimeRate: parsePercentStrict(cOnTime ? row.getCell(cOnTime) : undefined, fracFlags.get(cOnTime || 0)),
          largeOrderOnTimeRate: parsePercentStrict(cLargeOnTime ? row.getCell(cLargeOnTime) : undefined, fracFlags.get(cLargeOnTime || 0)),
          avgDeliveryTimeMinutes: parseMinutesStrict(findCol(hMap, ['average delivery time']) ? row.getCell(findCol(hMap, ['average delivery time'])!) : undefined),
          deliveredOver55Min: parseNumberStrict(findCol(hMap, ['delivered orders over 55min']) ? row.getCell(findCol(hMap, ['delivered orders over 55min'])!) : undefined),
          overdueOrderTasks: parseNumberStrict(findCol(hMap, ['overdue order tasks']) ? row.getCell(findCol(hMap, ['overdue order tasks'])!) : undefined),
          severelyOverdueOrderTasks: parseNumberStrict(findCol(hMap, ['severely overdue order tasks']) ? row.getCell(findCol(hMap, ['severely overdue order tasks'])!) : undefined),
          rawExtraColumns,
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'keetaDashboardDaily', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'keeta_vda') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'تاريخ Online Day غير صالح' });
          continue;
        }
        trackDate(isoDate);

        const shiftWindows: Record<string, string | number | null> = {};
        for (let s = 1; s <= 6; s++) {
          for (const prefix of ['Scheduled shifts', 'Shift hours', 'Valid shifts']) {
            const col = findCol(hMap, [`${prefix} S${s}`, `${prefix} s${s}`]);
            if (col) {
              const num = parseNumberStrict(row.getCell(col));
              shiftWindows[`${prefix} S${s}`] = num !== null ? num : cellToTrimmedString(row.getCell(col));
            }
          }
        }

        const recordKey = sanitizeDocIdWithHash('kt_vda', [riderId, isoDate], sha256);
        const payload: Omit<KeetaVdaDaily, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          vehicleType: cellToTrimmedString(findCol(hMap, ['vehicle type']) ? row.getCell(findCol(hMap, ['vehicle type'])!) : undefined) ?? '',
          shiftOnlineHours: parseNumberStrict(findCol(hMap, ['shift online hours']) ? row.getCell(findCol(hMap, ['shift online hours'])!) : undefined),
          sumValidShifts: parseNumberStrict(findCol(hMap, ['sum of valid shifts']) ? row.getCell(findCol(hMap, ['sum of valid shifts'])!) : undefined),
          shouldOnlineDays: parseNumberStrict(findCol(hMap, ['should online days']) ? row.getCell(findCol(hMap, ['should online days'])!) : undefined),
          totalDeliveredTasks: parseNumberStrict(findCol(hMap, ['total delivered tasks']) ? row.getCell(findCol(hMap, ['total delivered tasks'])!) : undefined),
          onTimeDTasks: parseNumberStrict(findCol(hMap, ['on-time d tasks']) ? row.getCell(findCol(hMap, ['on-time d tasks'])!) : undefined),
          cancellationD: parseNumberStrict(findCol(hMap, ['cancellation(d)']) ? row.getCell(findCol(hMap, ['cancellation(d)'])!) : undefined),
          deliveredOver55Min: parseNumberStrict(findCol(hMap, ['delivered orders over 55min']) ? row.getCell(findCol(hMap, ['delivered orders over 55min'])!) : undefined),
          acceptedOrders: parseNumberStrict(findCol(hMap, ['accepted orders']) ? row.getCell(findCol(hMap, ['accepted orders'])!) : undefined),
          totalDeliveryDistance: parseNumberStrict(findCol(hMap, ['total delivery distance']) ? row.getCell(findCol(hMap, ['total delivery distance'])!) : undefined),
          payableDistance: parseNumberStrict(findCol(hMap, ['payable distance']) ? row.getCell(findCol(hMap, ['payable distance'])!) : undefined),
          shiftWindows,
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'keetaVdaDaily', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'keeta_rank') {
        const cOnTime = findCol(hMap, ['on-time rate']);
        const cComp = findCol(hMap, ['order completion rate']);
        const cEarly = findCol(hMap, ["didn't tap drop-off too early"]);
        [cOnTime, cComp, cEarly].forEach(checkFrac);

        const snapshotDate = maxDate || fallbackImportDate;
        const recordKey = sanitizeDocIdWithHash('kt_rank', [riderId, snapshotDate], sha256);
        const payload: Omit<KeetaRankSnapshot, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          snapshotDate,
          name: cellToTrimmedString(findCol(hMap, ['name']) ? row.getCell(findCol(hMap, ['name'])!) : undefined) ?? '',
          currentEstimatedLevel: cellToTrimmedString(findCol(hMap, ['current estimated level']) ? row.getCell(findCol(hMap, ['current estimated level'])!) : undefined) ?? '',
          rankingPercentile: parseNumberStrict(findCol(hMap, ['ranking percentile']) ? row.getCell(findCol(hMap, ['ranking percentile'])!) : undefined),
          forcedAssignmentScore: parseNumberStrict(findCol(hMap, ['forced assignment score']) ? row.getCell(findCol(hMap, ['forced assignment score'])!) : undefined),
          estimatedRewardAmount: parseNumberStrict(findCol(hMap, ['estimated reward amount']) ? row.getCell(findCol(hMap, ['estimated reward amount'])!) : undefined),
          onTimeRate: parsePercentStrict(cOnTime ? row.getCell(cOnTime) : undefined, fracFlags.get(cOnTime || 0)),
          orderCompletionRate: parsePercentStrict(cComp ? row.getCell(cComp) : undefined, fracFlags.get(cComp || 0)),
          didntTapDropOffTooEarly: parsePercentStrict(cEarly ? row.getCell(cEarly) : undefined, fracFlags.get(cEarly || 0)),
          orderVolume: parseNumberStrict(findCol(hMap, ['order volume']) ? row.getCell(findCol(hMap, ['order volume'])!) : undefined),
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'keetaRankSnapshots', data: { ...payload, rowChecksum } });
        diag.validCount++;
      } else if (role === 'keeta_facial') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          rejectedRows.push({ sheetName: ws.name, rowNumber: r, riderIdRaw: riderId, reason: 'تاريخ Date في التحقق من الهوية غير صالح' });
          continue;
        }
        trackDate(isoDate);

        const cPassRate = findCol(hMap, ['pass rate mtd']);
        checkFrac(cPassRate);

        const recordKey = sanitizeDocIdWithHash('kt_face', [riderId, isoDate], sha256);
        const payload: Omit<KeetaFacialRecognitionDaily, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          city: cellToTrimmedString(findCol(hMap, ['city']) ? row.getCell(findCol(hMap, ['city'])!) : undefined) ?? '',
          partnerId: cellToTrimmedString(findCol(hMap, ['partner id']) ? row.getCell(findCol(hMap, ['partner id'])!) : undefined) ?? '',
          partnerName: cellToTrimmedString(findCol(hMap, ['partner name']) ? row.getCell(findCol(hMap, ['partner name'])!) : undefined) ?? '',
          pmm: cellToTrimmedString(findCol(hMap, ['pmm']) ? row.getCell(findCol(hMap, ['pmm'])!) : undefined) ?? '',
          finalInspectionResult: cellToTrimmedString(findCol(hMap, ['final inspection result']) ? row.getCell(findCol(hMap, ['final inspection result'])!) : undefined) ?? '',
          totalDaysTriggeredMtd: parseNumberStrict(findCol(hMap, ['total days triggered mtd']) ? row.getCell(findCol(hMap, ['total days triggered mtd'])!) : undefined),
          totalDaysPassedMtd: parseNumberStrict(findCol(hMap, ['total days passed mtd']) ? row.getCell(findCol(hMap, ['total days passed mtd'])!) : undefined),
          passRateMtd: parsePercentStrict(cPassRate ? row.getCell(cPassRate) : undefined, fracFlags.get(cPassRate || 0)),
          over90PassRate: cellToTrimmedString(findCol(hMap, ['over 90% pass rate']) ? row.getCell(findCol(hMap, ['over 90% pass rate'])!) : undefined) ?? '',
          sourceFile: fileName,
          sourceSheet: ws.name,
          sourceRowNumber: r,
          importBatchId: batchId,
          createdByUid,
          allowedUids,
        };
        const rowChecksum = sha256(JSON.stringify({ ...payload, importBatchId: '', sourceRowNumber: 0, sourceFile: '' }));
        records.push({ collection: 'keetaFacialRecognitionDaily', data: { ...payload, rowChecksum } });
        diag.validCount++;
      }
    }

    sheetDiagnostics.push(diag);
  }

  const dedupedMap = new Map<string, ParsedCollectionRecord>();
  const withinFileDupCountBySheet = new Map<string, number>();
  for (const rec of records) {
    const uniqueId = `${rec.collection}:${rec.data.recordKey}`;
    if (dedupedMap.has(uniqueId)) {
      const sheet = rec.data.sourceSheet;
      withinFileDupCountBySheet.set(sheet, (withinFileDupCountBySheet.get(sheet) || 0) + 1);
    }
    dedupedMap.set(uniqueId, rec);
  }

  for (const d of sheetDiagnostics) {
    const dup = withinFileDupCountBySheet.get(d.sheetName) || 0;
    if (dup > 0) {
      d.duplicateCount += dup;
      d.validCount = Math.max(0, d.validCount - dup);
    }
  }

  return {
    fileName,
    fileHash,
    platform,
    sheetsDetected,
    missingExpectedSheets,
    unknownColumns: Array.from(unknownColumnsGlobal),
    detectedPeriodStart: minDate,
    detectedPeriodEnd: maxDate,
    records: Array.from(dedupedMap.values()),
    sheetDiagnostics,
    rejectedRows,
  };
}
