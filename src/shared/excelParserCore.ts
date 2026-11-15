import type ExcelJS from 'exceljs';
import type {
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  HungerQualityMonthly,
  HungerWalletSnapshot,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaShiftSlot,
  KeetaVdaDaily,
  KeetaVdaShiftWindowEntry,
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

function rawCellString(cell: ExcelJS.Cell | undefined): string | null {
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  return s === '' ? null : s;
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
  if (['id', 'rider id', 'rider_id', 'courier id', 'courier_id', '-', '--', 'n/a', 'null', 'nan', 'total', 'الإجمالي'].includes(lower)) {
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
  if (!s || s === '-' || s === '--') return null;

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

/**
 * Parses Keeta human-readable duration strings ("1 day(s), 2 hr", "15 hr, 1 min", "40 min, 12 sec", "0 sec", "HH:MM:SS")
 * into exact total seconds. Returns null for empty / "-" / N/A.
 */
export function parseDurationTextSeconds(rawText: string | null | undefined): number | null {
  if (!rawText) return null;
  const s = rawText.trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') {
    return null;
  }

  const hmsMatch = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    const h = Number(hmsMatch[1]);
    const m = Number(hmsMatch[2]);
    const sec = hmsMatch[3] ? Number(hmsMatch[3]) : 0;
    return h * 3600 + m * 60 + sec;
  }

  const hasUnit = /(?:day|hr|hour|min|minute|sec|second)/i.test(s);
  if (hasUnit) {
    let totalSec = 0;
    let matchedAny = false;
    const dayMatches = s.match(/(\d+(?:\.\d+)?)\s*(?:day\(s\)|days|day|d)\b/gi);
    if (dayMatches) {
      for (const m of dayMatches) {
        const n = parseFloat(m);
        if (Number.isFinite(n)) {
          totalSec += n * 86400;
          matchedAny = true;
        }
      }
    }
    const hrMatches = s.match(/(\d+(?:\.\d+)?)\s*(?:hr\(s\)|hrs|hr|hours|hour|h)\b/gi);
    if (hrMatches) {
      for (const m of hrMatches) {
        const n = parseFloat(m);
        if (Number.isFinite(n)) {
          totalSec += n * 3600;
          matchedAny = true;
        }
      }
    }
    const minMatches = s.match(/(\d+(?:\.\d+)?)\s*(?:min\(s\)|mins|min|minutes|minute|m)\b/gi);
    if (minMatches) {
      for (const m of minMatches) {
        const n = parseFloat(m);
        if (Number.isFinite(n)) {
          totalSec += n * 60;
          matchedAny = true;
        }
      }
    }
    const secMatches = s.match(/(\d+(?:\.\d+)?)\s*(?:sec\(s\)|secs|sec|seconds|second|s)\b/gi);
    if (secMatches) {
      for (const m of secMatches) {
        const n = parseFloat(m);
        if (Number.isFinite(n)) {
          totalSec += n;
          matchedAny = true;
        }
      }
    }
    if (matchedAny) return totalSec;
  }

  return null;
}

export function parseDurationHoursStrict(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const val = unwrapCellValue(cell);
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Number(val.toFixed(4)) : null;
  }
  const s = String(val).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') {
    return null;
  }
  const sec = parseDurationTextSeconds(s);
  if (sec !== null) {
    return Number((sec / 3600).toFixed(4));
  }
  const cleaned = s.replace(/,/g, '').replace(/(?:hours?|hrs?)$/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

export function parseAttendanceSummarySlots(rawSummary: string | null | undefined): KeetaShiftSlot[] {
  if (!rawSummary) return [];
  const trimmed = rawSummary.trim();
  if (!trimmed || trimmed === '-' || trimmed === '--') return [];

  const parts = trimmed
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);

  const classifyQualification = (statusText: string, qualText?: string): string | null => {
    const combined = `${qualText || ''} ${statusText}`.toLowerCase();
    if (combined.includes('unqualified') || combined.includes('not qualified')) return 'unqualified';
    if (combined.includes('qualified')) return 'qualified';
    if (combined.includes('no shift') || combined.includes('off-shift') || combined.includes('off shift')) {
      return 'no_shifts';
    }
    return statusText.trim() || null;
  };

  const slots: KeetaShiftSlot[] = [];
  for (const part of parts) {
    // Format 1: "00:00-03:00 (Qualified, 2h)"
    const parenMatch = part.match(/^(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})\s*\(([^)]+)\)$/);
    if (parenMatch) {
      const window = parenMatch[1].replace(/\s+/g, '');
      const inner = parenMatch[2].trim();
      const commaIdx = inner.indexOf(',');
      const status = (commaIdx >= 0 ? inner.slice(0, commaIdx) : inner).trim();
      const durationRaw = (commaIdx >= 0 ? inner.slice(commaIdx + 1) : '').trim();
      const sec = parseDurationTextSeconds(durationRaw);
      slots.push({
        window,
        status,
        durationRaw,
        durationMinutes: sec !== null ? Number((sec / 60).toFixed(2)) : null,
        durationHours: sec !== null ? Number((sec / 3600).toFixed(4)) : null,
        qualification: classifyQualification(status),
      });
      continue;
    }

    // Format 2: "00:00-03:00: 1.5h (Qualified)"
    const colonMatch = part.match(/^(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})\s*:\s*(.+?)\s*(?:\(([^)]+)\))?$/);
    if (colonMatch) {
      const window = colonMatch[1].replace(/\s+/g, '');
      const durationRaw = colonMatch[2].trim();
      const status = (colonMatch[3] || '').trim() || 'On-Shift';
      const sec = parseDurationTextSeconds(durationRaw);
      slots.push({
        window,
        status,
        durationRaw,
        durationMinutes: sec !== null ? Number((sec / 60).toFixed(2)) : null,
        durationHours: sec !== null ? Number((sec / 3600).toFixed(4)) : null,
        qualification: classifyQualification(status),
      });
      continue;
    }

    // Format 3: Real Keeta CSV comma-separated e.g.
    // "00:00-03:00,Off-Shift,2 hr, 1 min" or "12:00-16:00,On-Shift,3 hr, 52 min,qualified"
    const csvMatch = part.match(/^(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})\s*,\s*(.+)$/);
    if (csvMatch) {
      const window = csvMatch[1].replace(/\s+/g, '');
      const tokens = csvMatch[2]
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const status = tokens[0] || '';
      const durationParts: string[] = [];
      let qualToken = '';
      for (const tok of tokens.slice(1)) {
        if (/^(qualified|unqualified|not qualified|no shifts?)$/i.test(tok)) {
          qualToken = tok;
        } else {
          durationParts.push(tok);
        }
      }
      const durationRaw = durationParts.join(', ');
      const sec = parseDurationTextSeconds(durationRaw);
      slots.push({
        window,
        status,
        durationRaw,
        durationMinutes: sec !== null ? Number((sec / 60).toFixed(2)) : null,
        durationHours: sec !== null ? Number((sec / 3600).toFixed(4)) : null,
        qualification: classifyQualification(status, qualToken),
      });
      continue;
    }

    if (/^\d+\/\d+$/.test(part)) {
      slots.push({
        window: 'summary',
        status: part,
        durationRaw: '',
        durationMinutes: null,
        durationHours: null,
        qualification: null,
      });
    }
  }
  return slots;
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
  const sec = parseDurationTextSeconds(s);
  if (sec !== null) {
    return Number((sec / 3600).toFixed(4));
  }
  const cleaned = s.replace(/,/g, '').replace(/(?:%|km|sar|ر\.س)$/i, '').trim();
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
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') {
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
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nan') return null;
  const hmsMatch = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    const a = Number(hmsMatch[1]);
    const b = Number(hmsMatch[2]);
    const c = hmsMatch[3] ? Number(hmsMatch[3]) : 0;
    return Number((a * 60 + b + c / 60).toFixed(2));
  }
  const sec = parseDurationTextSeconds(s);
  if (sec !== null) {
    return Number((sec / 60).toFixed(2));
  }
  const n = Number(s.replace(/min|mins|m/gi, '').trim());
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseBooleanOrString(cell: ExcelJS.Cell | undefined): { value: boolean | string | null; raw: string | null } {
  const raw = cellToTrimmedString(cell);
  if (!raw) return { value: null, raw: null };
  const lower = raw.toLowerCase();
  if (['yes', 'true', '1', 'y', 'نعم', 'triggered'].includes(lower)) return { value: true, raw };
  if (['no', 'false', '0', 'n', 'لا', 'not triggered'].includes(lower)) return { value: false, raw };
  return { value: raw, raw };
}

function normHeader(h: string): string {
  return h
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stripKeetaPrefix(h: string): string {
  return normHeader(h)
    .replace(/^(?:shift|task volumes|delivery experience)_/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Inspects numeric values AND numeric strings (such as CSV unformatted "0.2708530357")
 * while skipping "%"-suffixed strings (e.g. "42.86%") so mixed CSV/XLSX percentage columns detect scale cleanly.
 */
function detectFractionScale(ws: ExcelJS.Worksheet, startRow: number, colIndex: number): boolean {
  let sampleCount = 0;
  let leOneCount = 0;
  let gtOneCount = 0;
  const maxScan = Math.min(ws.rowCount, startRow + 60);
  for (let r = startRow; r <= maxScan; r++) {
    const cell = ws.getRow(r).getCell(colIndex);
    const val = unwrapCellValue(cell);
    if (typeof val === 'number' && Number.isFinite(val)) {
      sampleCount++;
      if (val > 1.0001) gtOneCount++;
      else if (val > 0) leOneCount++;
      const fmt = String(cell.numFmt || '');
      if (fmt.includes('%')) return true;
    } else if (typeof val === 'string') {
      const s = val.trim();
      if (!s || s === '-' || s === '--' || s.endsWith('%')) continue;
      const n = Number(s.replace(/,/g, ''));
      if (Number.isFinite(n)) {
        sampleCount++;
        if (n > 1.0001) gtOneCount++;
        else if (n > 0) leOneCount++;
      }
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
  const hNorms = headers.map(normHeader).filter(Boolean);
  const hStripped = headers.map(stripKeetaPrefix).filter(Boolean);
  const hSet = new Set([...hNorms, ...hStripped]);

  if (
    s === 'dashboard' ||
    ((hSet.has('courier id') || hSet.has('courier_id')) &&
      (hSet.has('shift attendance summary') ||
        hSet.has('attendance summary based on valid online duration') ||
        hSet.has('shift_attendance summary based on valid online duration') ||
        hSet.has('delivered tasks') ||
        hSet.has('task volumes_delivered tasks')))
  ) {
    return 'keeta_dashboard';
  }
  if (
    s === 'vda' ||
    ((hSet.has('online day') || hSet.has('onlline day')) &&
      (hSet.has('sum of valid shifts') || hSet.has('total delivery distance') || hSet.has('vda')))
  ) {
    return 'keeta_vda';
  }
  if (
    s === 'rankplanprocess' ||
    s.includes('rankplan') ||
    (hSet.has('current estimated level') && hSet.has('ranking percentile'))
  ) {
    return 'keeta_rank';
  }
  if (
    s === 'facialrecognitiondatareport' ||
    s.includes('facialrecognition') ||
    s.includes('facial recognition') ||
    hSet.has('final inspection result')
  ) {
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
  if (
    s === 'delivery quality segmentation' ||
    s.includes('quality segmentation') ||
    hSet.has('final delivery quality score') ||
    hSet.has('total verification requests')
  ) {
    return 'hunger_quality';
  }
  return 'unknown';
}

const KNOWN_ALIASES_BY_ROLE: Record<SheetRole, string[]> = {
  keeta_dashboard: [
    'date', 'courier id', 'courier_id', 'courier first name', 'courier_first_name',
    'courier last name', 'courier_last_name', 'vehicle type', 'vehicle_type',
    'headquarters', 'branch', 'supervisor', 'courier type', 'courier_type',
    'shift attendance summary', 'shift_attendance summary based on valid online duration',
    'attendance summary based on valid online duration',
    'on-shift?', 'shift_on-shift?', 'on_shift',
    'valid day?', 'shift_valid day?', 'valid_day',
    'courier app online time', 'shift_courier app online time',
    'shift valid online time', 'shift_valid online time', 'valid online time',
    'shift online hours', 'shift_online hours',
    // Intentionally NOT in knownAliases so Shift_PeAbdo Online Hours continues to be flagged as unverified/unknown column in diagnostics & tests while still parsed!
    'accepted tasks', 'task volumes_accepted tasks',
    'tasks with restaurant arrivals', 'task volumes_tasks with restaurant arrivals',
    'delivered tasks', 'task volumes_delivered tasks',
    'large order tasks completed', 'task volumes_large order tasks completed',
    'rejected tasks', 'task volumes_rejected tasks',
    'rejected tasks (courier)', 'task volumes_rejected tasks (courier)',
    'rejected tasks (auto)', 'task volumes_rejected tasks (auto)',
    'cancellation rate from delivery issues', 'task volumes_cancellation rate from delivery issues',
    'order completion rate', 'task volumes_order completion rate (non-delivery related)', 'order completion rate (non-delivery related)',
    'on-time rate', 'on-time rate (d)', 'delivery experience_on-time rate (d)',
    'large order on-time rate', 'delivery experience_large order on-time rate',
    'average delivery time', 'avg delivery time of delivered orders', 'delivery experience_avg delivery time of delivered orders',
    'delivered orders over 55min', 'delivered orders prop. (over 55min)', 'delivery experience_delivered orders prop. (over 55min)',
    'overdue order tasks', 'delivery experience_overdue order tasks',
    'severely overdue order tasks', 'delivery experience_severely overdue order tasks',
  ],
  keeta_vda: [
    'rider id', 'rider_id', 'courier id', 'courier_id', 'vehicle type', 'vehicle_type',
    'first online date', 'first_online_date', 'online day', 'onlline day', 'online_day',
    '3pl id', '3pl_id', '3pl name', '3pl_name', 'pmm', 'if_new_rider', 'if new rider',
    'shift online hours', 'shift_online_hours', 'sum of valid shifts', 'sum_of_valid_shifts',
    'should online days', 'should_online_days', 'total delivered tasks', 'total_delivered_tasks',
    'sum of delivered advance tasks', 'sum_of_delivered_advance_tasks', 'delivered advance tasks',
    'on-time d tasks', 'on_time_d_tasks', 'on-time (d) tasks',
    'cancellation(d)', 'cancellation (d)', 'cancellation_d',
    'delivered orders over 55min', 'delivered_orders_over_55min',
    'accepted orders', 'accepted_orders', 'vda',
    'total delivery distance', 'total_delivery_distance', 'payable distance', 'payable_distance',
    'scheduled shifts s1', 'scheduled shifts s2', 'scheduled shifts s3', 'scheduled shifts s4', 'scheduled shifts s5', 'scheduled shifts s6',
    'shift hours s1', 'shift hours s2', 'shift hours s3', 'shift hours s4', 'shift hours s5', 'shift hours s6',
    'valid shifts s1', 'valid shifts s2', 'valid shifts s3', 'valid shifts s4', 'valid shifts s5', 'valid shifts s6',
  ],
  keeta_rank: [
    'courier id', 'courier_id', 'rider id', 'rider_id', 'name', 'courier name',
    'current estimated level', 'current_estimated_level',
    'ranking percentile', 'ranking_percentile',
    'forced assignment score', 'forced_assignment_score',
    'estimated reward amount', 'estimated_reward_amount',
    'on-time rate', 'on_time_rate',
    'order completion rate', 'order_completion_rate',
    "didn't tap drop-off too early", 'didnt tap drop-off too early', 'didnt_tap_drop_off_too_early',
    'order volume', 'order_volume',
    'snapshot date', 'date',
  ],
  keeta_facial: [
    'date', 'dt', 'city', 'courier id', 'courier_id', 'rider id', 'rider_id',
    'partner id', 'partner_id', 'partner name', 'partner_name', 'pmm',
    'if_triggered_today', 'if triggered today',
    'final inspection result', 'final_inspection_result',
    'total days triggered mtd', 'total_days_triggered_mtd',
    'total days passed mtd', 'total_days_passed_mtd',
    'pass rate mtd', 'pass_rate_mtd',
    'over 90% pass rate', 'if over 90% pass rate this month', 'over_90_pass_rate',
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

const EXPECTED_CANONICAL_COLUMNS_BY_ROLE: Record<SheetRole, string[]> = {
  keeta_dashboard: [
    'Date', 'Courier ID', 'Courier first name', 'Courier last name', 'Vehicle type',
    'Headquarters', 'Branch', 'Supervisor', 'Courier Type',
    'Shift_Attendance summary based on valid online duration', 'Shift_On-Shift?', 'Shift_Valid Day?',
    'Shift_Courier App Online Time', 'Shift_Valid Online Time', 'Shift Online Hours',
    'Task Volumes_Accepted Tasks', 'Task Volumes_Tasks with restaurant arrivals',
    'Task Volumes_Delivered Tasks', 'Task Volumes_Large Order Tasks Completed',
    'Task Volumes_Rejected Tasks', 'Task Volumes_Rejected Tasks (Courier)', 'Task Volumes_Rejected Tasks (Auto)',
    'Task Volumes_Cancellation Rate from Delivery Issues', 'Task Volumes_Order completion rate (non-delivery related)',
    'Delivery Experience_On-time Rate (D)', 'Delivery Experience_Large order on-time rate',
    'Delivery Experience_Avg Delivery Time of Delivered Orders',
    'Delivery Experience_Delivered Orders Prop. (Over 55min)',
    'Delivery Experience_Overdue Order Tasks', 'Delivery Experience_Severely Overdue Order Tasks',
  ],
  keeta_vda: [
    'Rider ID', 'Vehicle Type', 'First online date', 'Online Day', '3PL ID', '3PL Name', 'PMM', 'if_new_rider',
    'Shift Online hours', 'Sum of Valid Shifts', 'Should online days', 'Total delivered tasks',
    'Sum of Delivered Advance Tasks', 'On-time D tasks', 'Cancellation(D)', 'Delivered orders over 55min',
    'Accepted orders', 'VDA', 'Total Delivery Distance', 'Payable distance',
    'Scheduled shifts S1..S6', 'Shift hours S1..S6', 'Valid shifts S1..S6',
  ],
  keeta_rank: [
    'Courier ID', 'Name', 'Current estimated level', 'Ranking percentile',
    'Forced assignment score', 'Estimated reward amount', 'On-time rate',
    'Order completion rate', "Didn't tap drop-off too early", 'Order volume',
  ],
  keeta_facial: [
    'Date / dt', 'City', 'Courier ID', 'Partner ID', 'Partner name', 'PMM',
    'if_triggered_today', 'Final inspection result', 'Total days triggered MTD',
    'Total days passed MTD', 'Pass rate MTD', 'Over 90% pass rate',
  ],
  hunger_daily: ['ID', 'City Name', 'Contract Name', 'Working Days', 'Completed Deliveries', 'Actual Working Hours'],
  hunger_wallet: ['Rider Id', 'Current Wallet'],
  hunger_distance: ['Created Date', 'Rider Id', 'Total KM', 'Payable KM'],
  hunger_quality: ['Month', 'Rider ID', 'Final Delivery Quality Score', 'Segment'],
  unknown: [],
};

interface HeaderLookup {
  exactMap: Map<string, number>;
  strippedMap: Map<string, number>;
  headers: string[];
}

function buildHeaderLookup(headers: string[]): HeaderLookup {
  const exactMap = new Map<string, number>();
  const strippedMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = normHeader(h);
    if (key && !exactMap.has(key)) {
      exactMap.set(key, idx + 1);
    }
    const skey = stripKeetaPrefix(h);
    if (skey && !strippedMap.has(skey)) {
      strippedMap.set(skey, idx + 1);
    }
  });
  return { exactMap, strippedMap, headers };
}

function findCol(lookup: HeaderLookup, aliases: string[]): number | undefined {
  for (const a of aliases) {
    const found = lookup.exactMap.get(normHeader(a));
    if (found) return found;
  }
  for (const a of aliases) {
    const found = lookup.strippedMap.get(stripKeetaPrefix(a));
    if (found) return found;
  }
  return undefined;
}

function detectHeaderRowIndex(ws: ExcelJS.Worksheet): number {
  const maxScan = Math.min(ws.rowCount, 10);
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const colCount = Math.max(ws.columnCount, row.cellCount, 16);
    const vals = rowToRawStrings(row, colCount);
    const role = classifySheet(ws.name, vals);
    let score = role !== 'unknown' ? 5 : 0;
    const normVals = vals.map(normHeader).filter(Boolean);
    for (const v of normVals) {
      if (
        v.includes('courier id') || v.includes('rider id') || v === 'id' ||
        v === 'date' || v === 'dt' || v === 'online day' || v === 'working days' ||
        v.includes('delivered') || v.includes('on-time') || v.includes('shift') || v.includes('final inspection')
      ) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

/**
 * RFC-4180 compliant CSV parser handling UTF-8 BOM, quoted multiline values, escaped "" quotes, and trailing empty rows.
 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r') {
        if (clean[i + 1] === '\n') i++;
        row.push(field.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

function isZipXlsxBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function isLegacyOleXlsBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function isProbablyCsvText(bytes: Uint8Array, fileName: string): boolean {
  if (isZipXlsxBytes(bytes)) return false;
  if (fileName.toLowerCase().endsWith('.csv')) return true;
  const sampleLen = Math.min(bytes.length, 4096);
  let commas = 0;
  let newlines = 0;
  let nulls = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = bytes[i];
    if (b === 0) nulls++;
    if (b === 0x2c) commas++;
    if (b === 0x0a) newlines++;
  }
  return nulls === 0 && (commas >= 2 || newlines >= 1);
}

function extractDateFromFileName(fileName: string): string | null {
  const m = fileName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = fileName.match(/(\d{8})/);
  if (m2) {
    const s = m2[1];
    const yyyy = Number(s.slice(0, 4));
    const mm = Number(s.slice(4, 6));
    const dd = Number(s.slice(6, 8));
    if (yyyy >= 2000 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
  }
  return null;
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

  if (isLegacyOleXlsBytes(bytes)) {
    throw new Error('صيغة XLS الثنائية القديمة غير مدعومة مباشرة؛ يرجى حفظ الملف بصيغة XLSX أو CSV ثم إعادة رفعه.');
  }

  const workbook = createWorkbook();
  if (isProbablyCsvText(bytes, fileName)) {
    const csvText = new TextDecoder('utf-8').decode(bytes);
    const csvRows = parseCsvRows(csvText);
    if (csvRows.length === 0) {
      throw new Error('ملف CSV المرفوع فارغ أو لا يحتوي على صفوف صالحة.');
    }
    const headerCandidate = csvRows[0] || [];
    const roleGuess = classifySheet(fileName.replace(/\.[^.]+$/, ''), headerCandidate);
    const inferredName =
      roleGuess === 'keeta_dashboard'
        ? 'Dashboard'
        : roleGuess === 'keeta_vda'
          ? 'VDA'
          : roleGuess === 'keeta_rank'
            ? 'RankPlanProcess'
            : roleGuess === 'keeta_facial'
              ? 'FacialRecognitionDataReport'
              : roleGuess === 'hunger_daily'
                ? 'Hunger-Daily'
                : roleGuess === 'hunger_wallet'
                  ? 'Riders Wallet'
                  : roleGuess === 'hunger_distance'
                    ? 'Riders Distance'
                    : roleGuess === 'hunger_quality'
                      ? 'Delivery Quality Segmentation'
                      : 'CSV_Sheet';
    const ws = workbook.addWorksheet(inferredName);
    ws.addRows(csvRows);
  } else {
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }

  const sheetsDetected: string[] = [];
  const classifiedSheets: Array<{ ws: ExcelJS.Worksheet; role: SheetRole; headers: string[]; headerRowIndex: number }> = [];
  let hungerVotes = 0;
  let keetaVotes = 0;

  for (const ws of workbook.worksheets) {
    sheetsDetected.push(ws.name);
    if (ws.rowCount === 0) continue;
    const headerRowIndex = detectHeaderRowIndex(ws);
    const headerRow = ws.getRow(headerRowIndex);
    const colCount = Math.max(ws.columnCount, headerRow.cellCount, 16);
    const headers = rowToRawStrings(headerRow, colCount);
    const role = classifySheet(ws.name, headers);
    classifiedSheets.push({ ws, role, headers, headerRowIndex });
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
  const fileDateFallback = extractDateFromFileName(fileName);

  let minDate: string | null = null;
  let maxDate: string | null = null;
  const trackDate = (d: string | null) => {
    if (!d) return;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  };

  for (const { ws, role, headers, headerRowIndex } of classifiedSheets) {
    const colCount = Math.max(ws.columnCount, headers.length);
    const hMap = buildHeaderLookup(headers);
    const detectedColumns = headers.map((h) => h.trim()).filter(Boolean);

    const knownSet = new Set(KNOWN_ALIASES_BY_ROLE[role].map(normHeader));
    const knownStrippedSet = new Set(KNOWN_ALIASES_BY_ROLE[role].map(stripKeetaPrefix));
    const missingColumns: string[] = [];

    if (role !== 'unknown') {
      for (const expectedCol of EXPECTED_CANONICAL_COLUMNS_BY_ROLE[role]) {
        if (expectedCol.includes('..')) continue;
        if (expectedCol.includes(' / ')) {
          const alts = expectedCol.split(' / ').map((a) => a.trim());
          if (!alts.some((a) => findCol(hMap, [a]))) {
            missingColumns.push(expectedCol);
          }
        } else if (!findCol(hMap, [expectedCol])) {
          missingColumns.push(expectedCol);
        }
      }
    }

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
      totalRowsScanned: Math.max(0, ws.rowCount - headerRowIndex),
      emptyRowsSkipped: 0,
      duplicateHeadersSkipped: 0,
      validCount: 0,
      newCount: 0,
      updatedCount: 0,
      duplicateCount: 0,
      withinFileDuplicateConflicts: 0,
      rejectedCount: 0,
      unknownColumns: [],
      expectedColumns: EXPECTED_CANONICAL_COLUMNS_BY_ROLE[role],
      detectedColumns,
      missingColumns,
    };

    if (role === 'unknown') {
      sheetDiagnostics.push(diag);
      continue;
    }

    const extraColEntries: Array<{ colIndex: number; rawHeader: string }> = [];
    const originalHeadersMap: Record<string, string> = {};
    headers.forEach((rawH, idx) => {
      const trimmed = rawH.trim();
      if (!trimmed) return;
      const nh = normHeader(trimmed);
      const nsk = stripKeetaPrefix(trimmed);
      originalHeadersMap[`col_${idx + 1}`] = trimmed;
      const isVdaShiftDynamic =
        role === 'keeta_vda' &&
        /^(scheduled[_\s]shifts|shift[_\s]hours|valid[_\s]shifts)[_\s]*s[1-6]$/i.test(trimmed);
      const isPeAbdoCol = nh === 'shift_peabdo online hours';
      if (isPeAbdoCol || (!knownSet.has(nh) && !knownStrippedSet.has(nsk) && !isVdaShiftDynamic)) {
        diag.unknownColumns.push(trimmed);
        unknownColumnsGlobal.add(`${ws.name}: ${trimmed}`);
        extraColEntries.push({ colIndex: idx + 1, rawHeader: trimmed });
      }
    });

    const fracFlags = new Map<number, boolean>();
    const checkFrac = (col: number | undefined) => {
      if (col && !fracFlags.has(col)) {
        fracFlags.set(col, detectFractionScale(ws, headerRowIndex + 1, col));
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
              ? findCol(hMap, ['rider id', 'rider_id', 'courier id', 'courier_id'])
              : findCol(hMap, ['courier id', 'courier_id', 'rider id', 'rider_id']);

    const cDate =
      role === 'hunger_daily'
        ? findCol(hMap, ['working days'])
        : role === 'hunger_distance'
          ? findCol(hMap, ['created date'])
          : role === 'keeta_vda'
            ? findCol(hMap, ['online day', 'onlline day', 'online_day'])
            : role === 'keeta_dashboard'
              ? findCol(hMap, ['date'])
              : role === 'keeta_facial'
                ? findCol(hMap, ['date', 'dt'])
                : undefined;

    for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
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
          columnName: cId ? headers[cId - 1] || 'Courier/Rider ID' : 'Courier/Rider ID',
          rawValue: rawAttempt,
          reason: 'معرف المندوب مفقود أو غير صالح',
        });
        continue;
      }

      if (role === 'hunger_daily') {
        const isoDate = parseIsoDate(cDate ? row.getCell(cDate) : undefined);
        if (!isoDate) {
          diag.rejectedCount++;
          const rawDate = cDate ? String(unwrapCellValue(row.getCell(cDate)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: cDate ? headers[cDate - 1] || 'Working Days' : 'Working Days',
            rawValue: rawDate,
            reason: 'تاريخ Working Days غير صالح',
          });
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
          const rawDate = cDate ? String(unwrapCellValue(row.getCell(cDate)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: cDate ? headers[cDate - 1] || 'Created Date' : 'Created Date',
            rawValue: rawDate,
            reason: 'تاريخ Created Date غير صالح',
          });
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
          const rawWallet = cWallet ? String(unwrapCellValue(row.getCell(cWallet)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: 'Current Wallet',
            rawValue: rawWallet,
            reason: 'قيمة Current Wallet مفقودة أو غير رقمية',
          });
          continue;
        }
        const snapshotDate = maxDate || fileDateFallback || fallbackImportDate;
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
              city: 2, contract: 3, vehicle: 5, totalVer: 6, succVer: 7, verRate: 8,
              gross: 9, comp: 10, compInTime: 11, failed: 12, onTimeScore: 13, failScore: 14,
              finalScore: 15, segment: 16,
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
          const rawDate = cDate ? String(unwrapCellValue(row.getCell(cDate)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: cDate ? headers[cDate - 1] || 'Date' : 'Date',
            rawValue: rawDate,
            reason: 'تاريخ Date غير صالح',
          });
          continue;
        }
        trackDate(isoDate);

        const cCancel = findCol(hMap, ['task volumes_cancellation rate from delivery issues', 'cancellation rate from delivery issues']);
        const cComp = findCol(hMap, ['task volumes_order completion rate (non-delivery related)', 'order completion rate (non-delivery related)', 'order completion rate']);
        const cOnTime = findCol(hMap, ['delivery experience_on-time rate (d)', 'on-time rate (d)', 'on-time rate']);
        const cLargeOnTime = findCol(hMap, ['delivery experience_large order on-time rate', 'large order on-time rate']);
        const cOver55Prop = findCol(hMap, ['delivery experience_delivered orders prop. (over 55min)', 'delivered orders prop. (over 55min)']);
        const cOver55Count = findCol(hMap, ['delivered orders over 55min']);
        [cCancel, cComp, cOnTime, cLargeOnTime, cOver55Prop].forEach(checkFrac);

        const firstName = cellToTrimmedString(findCol(hMap, ['courier first name']) ? row.getCell(findCol(hMap, ['courier first name'])!) : undefined) ?? '';
        const lastName = cellToTrimmedString(findCol(hMap, ['courier last name']) ? row.getCell(findCol(hMap, ['courier last name'])!) : undefined) ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || riderId;

        const cAttendanceSum = findCol(hMap, [
          'shift_attendance summary based on valid online duration',
          'attendance summary based on valid online duration',
          'shift attendance summary',
        ]);
        const shiftAttendanceSummary = cellToTrimmedString(cAttendanceSum ? row.getCell(cAttendanceSum) : undefined) ?? '';
        const parsedShiftSlots = parseAttendanceSummarySlots(shiftAttendanceSummary);

        const cAppOnline = findCol(hMap, ['shift_courier app online time', 'courier app online time']);
        const cValidOnline = findCol(hMap, ['shift_valid online time', 'shift valid online time', 'valid online time']);
        const cShiftHrs = findCol(hMap, ['shift online hours', 'shift_online hours']);
        const cPeAbdo = findCol(hMap, ['shift_peabdo online hours']);

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
          shiftAttendanceSummary,
          parsedShiftSlots,
          onShift: cellToTrimmedString(findCol(hMap, ['shift_on-shift?', 'on-shift?', 'on_shift']) ? row.getCell(findCol(hMap, ['shift_on-shift?', 'on-shift?', 'on_shift'])!) : undefined) ?? '',
          validDay: cellToTrimmedString(findCol(hMap, ['shift_valid day?', 'valid day?', 'valid_day']) ? row.getCell(findCol(hMap, ['shift_valid day?', 'valid day?', 'valid_day'])!) : undefined) ?? '',
          appOnlineTime: parseDurationHoursStrict(cAppOnline ? row.getCell(cAppOnline) : undefined),
          appOnlineTimeRaw: rawCellString(cAppOnline ? row.getCell(cAppOnline) : undefined),
          shiftValidOnlineTime: parseDurationHoursStrict(cValidOnline ? row.getCell(cValidOnline) : undefined),
          shiftValidOnlineTimeRaw: rawCellString(cValidOnline ? row.getCell(cValidOnline) : undefined),
          shiftOnlineHours: parseDurationHoursStrict(cShiftHrs ? row.getCell(cShiftHrs) : undefined),
          shiftPeAbdoOnlineHours: parseDurationHoursStrict(cPeAbdo ? row.getCell(cPeAbdo) : undefined),
          shiftPeAbdoOnlineHoursRaw: rawCellString(cPeAbdo ? row.getCell(cPeAbdo) : undefined),
          acceptedTasks: parseNumberStrict(findCol(hMap, ['task volumes_accepted tasks', 'accepted tasks']) ? row.getCell(findCol(hMap, ['task volumes_accepted tasks', 'accepted tasks'])!) : undefined),
          restaurantArrivals: parseNumberStrict(findCol(hMap, ['task volumes_tasks with restaurant arrivals', 'tasks with restaurant arrivals']) ? row.getCell(findCol(hMap, ['task volumes_tasks with restaurant arrivals', 'tasks with restaurant arrivals'])!) : undefined),
          deliveredTasks: parseNumberStrict(findCol(hMap, ['task volumes_delivered tasks', 'delivered tasks']) ? row.getCell(findCol(hMap, ['task volumes_delivered tasks', 'delivered tasks'])!) : undefined),
          largeOrderTasksCompleted: parseNumberStrict(findCol(hMap, ['task volumes_large order tasks completed', 'large order tasks completed']) ? row.getCell(findCol(hMap, ['task volumes_large order tasks completed', 'large order tasks completed'])!) : undefined),
          rejectedTasks: parseNumberStrict(findCol(hMap, ['task volumes_rejected tasks', 'rejected tasks']) ? row.getCell(findCol(hMap, ['task volumes_rejected tasks', 'rejected tasks'])!) : undefined),
          rejectedTasksCourier: parseNumberStrict(findCol(hMap, ['task volumes_rejected tasks (courier)', 'rejected tasks (courier)']) ? row.getCell(findCol(hMap, ['task volumes_rejected tasks (courier)', 'rejected tasks (courier)'])!) : undefined),
          rejectedTasksAuto: parseNumberStrict(findCol(hMap, ['task volumes_rejected tasks (auto)', 'rejected tasks (auto)']) ? row.getCell(findCol(hMap, ['task volumes_rejected tasks (auto)', 'rejected tasks (auto)'])!) : undefined),
          cancellationRate: parsePercentStrict(cCancel ? row.getCell(cCancel) : undefined, fracFlags.get(cCancel || 0)),
          completionRate: parsePercentStrict(cComp ? row.getCell(cComp) : undefined, fracFlags.get(cComp || 0)),
          onTimeRate: parsePercentStrict(cOnTime ? row.getCell(cOnTime) : undefined, fracFlags.get(cOnTime || 0)),
          largeOrderOnTimeRate: parsePercentStrict(cLargeOnTime ? row.getCell(cLargeOnTime) : undefined, fracFlags.get(cLargeOnTime || 0)),
          avgDeliveryTimeMinutes: parseMinutesStrict(
            findCol(hMap, ['delivery experience_avg delivery time of delivered orders', 'avg delivery time of delivered orders', 'average delivery time'])
              ? row.getCell(findCol(hMap, ['delivery experience_avg delivery time of delivered orders', 'avg delivery time of delivered orders', 'average delivery time'])!)
              : undefined
          ),
          deliveredOver55Min: cOver55Count && cOver55Count !== cOver55Prop ? parseNumberStrict(row.getCell(cOver55Count)) : null,
          deliveredOver55MinProp: cOver55Prop ? parsePercentStrict(row.getCell(cOver55Prop), fracFlags.get(cOver55Prop)) : null,
          overdueOrderTasks: parseNumberStrict(findCol(hMap, ['delivery experience_overdue order tasks', 'overdue order tasks']) ? row.getCell(findCol(hMap, ['delivery experience_overdue order tasks', 'overdue order tasks'])!) : undefined),
          severelyOverdueOrderTasks: parseNumberStrict(findCol(hMap, ['delivery experience_severely overdue order tasks', 'severely overdue order tasks']) ? row.getCell(findCol(hMap, ['delivery experience_severely overdue order tasks', 'severely overdue order tasks'])!) : undefined),
          originalHeaders: originalHeadersMap,
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
          const rawDate = cDate ? String(unwrapCellValue(row.getCell(cDate)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: cDate ? headers[cDate - 1] || 'Online Day' : 'Online Day',
            rawValue: rawDate,
            reason: 'تاريخ Online Day غير صالح',
          });
          continue;
        }
        trackDate(isoDate);

        const shiftWindows: Record<string, string | number | null> = {};
        const shiftsS1ToS6: KeetaVdaShiftWindowEntry[] = [];
        for (let s = 1; s <= 6; s++) {
          const slotName = `S${s}` as KeetaVdaShiftWindowEntry['slot'];
          const cSched = findCol(hMap, [`Scheduled shifts S${s}`, `Scheduled shifts s${s}`, `scheduled_shifts_s${s}`]);
          const cHrs = findCol(hMap, [`Shift hours S${s}`, `Shift hours s${s}`, `shift_hours_s${s}`]);
          const cVal = findCol(hMap, [`Valid shifts S${s}`, `Valid shifts s${s}`, `valid_shifts_s${s}`]);

          const scheduledShifts = cSched ? parseNumberStrict(row.getCell(cSched)) : null;
          const shiftHours = cHrs ? parseDurationHoursStrict(row.getCell(cHrs)) : null;
          const validShifts = cVal ? parseNumberStrict(row.getCell(cVal)) : null;

          if (cSched) shiftWindows[`Scheduled shifts S${s}`] = scheduledShifts !== null ? scheduledShifts : cellToTrimmedString(row.getCell(cSched));
          if (cHrs) shiftWindows[`Shift hours S${s}`] = shiftHours !== null ? shiftHours : cellToTrimmedString(row.getCell(cHrs));
          if (cVal) shiftWindows[`Valid shifts S${s}`] = validShifts !== null ? validShifts : cellToTrimmedString(row.getCell(cVal));

          shiftsS1ToS6.push({ slot: slotName, scheduledShifts, shiftHours, validShifts });
        }

        const cCancelD = findCol(hMap, ['cancellation(d)', 'cancellation (d)', 'cancellation_d']);
        const cVda = findCol(hMap, ['vda']);
        checkFrac(cCancelD);

        const rawExtraColumns: Record<string, string | number | null> = {};
        for (const extra of extraColEntries) {
          const cell = row.getCell(extra.colIndex);
          const num = parseNumberStrict(cell);
          rawExtraColumns[extra.rawHeader] = num !== null ? num : cellToTrimmedString(cell);
        }

        const cFirstOnline = findCol(hMap, ['first online date', 'first_online_date']);
        const firstOnlineDate = cFirstOnline ? parseIsoDate(row.getCell(cFirstOnline)) : null;

        const recordKey = sanitizeDocIdWithHash('kt_vda', [riderId, isoDate], sha256);
        const payload: Omit<KeetaVdaDaily, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          firstOnlineDate,
          vehicleType: cellToTrimmedString(findCol(hMap, ['vehicle type']) ? row.getCell(findCol(hMap, ['vehicle type'])!) : undefined) ?? '',
          threePlId: cellToTrimmedString(findCol(hMap, ['3pl id', '3pl_id']) ? row.getCell(findCol(hMap, ['3pl id', '3pl_id'])!) : undefined) ?? '',
          threePlName: cellToTrimmedString(findCol(hMap, ['3pl name', '3pl_name']) ? row.getCell(findCol(hMap, ['3pl name', '3pl_name'])!) : undefined) ?? '',
          pmm: cellToTrimmedString(findCol(hMap, ['pmm']) ? row.getCell(findCol(hMap, ['pmm'])!) : undefined) ?? '',
          ifNewRider: cellToTrimmedString(findCol(hMap, ['if_new_rider', 'if new rider']) ? row.getCell(findCol(hMap, ['if_new_rider', 'if new rider'])!) : undefined) ?? '',
          shiftOnlineHours: parseDurationHoursStrict(findCol(hMap, ['shift online hours', 'shift_online_hours']) ? row.getCell(findCol(hMap, ['shift online hours', 'shift_online_hours'])!) : undefined),
          sumValidShifts: parseNumberStrict(findCol(hMap, ['sum of valid shifts', 'sum_of_valid_shifts']) ? row.getCell(findCol(hMap, ['sum of valid shifts', 'sum_of_valid_shifts'])!) : undefined),
          shouldOnlineDays: parseNumberStrict(findCol(hMap, ['should online days', 'should_online_days']) ? row.getCell(findCol(hMap, ['should online days', 'should_online_days'])!) : undefined),
          totalDeliveredTasks: parseNumberStrict(findCol(hMap, ['total delivered tasks', 'total_delivered_tasks']) ? row.getCell(findCol(hMap, ['total delivered tasks', 'total_delivered_tasks'])!) : undefined),
          sumDeliveredAdvanceTasks: parseNumberStrict(findCol(hMap, ['sum of delivered advance tasks', 'sum_of_delivered_advance_tasks', 'delivered advance tasks']) ? row.getCell(findCol(hMap, ['sum of delivered advance tasks', 'sum_of_delivered_advance_tasks', 'delivered advance tasks'])!) : undefined),
          onTimeDTasks: parseNumberStrict(findCol(hMap, ['on-time d tasks', 'on_time_d_tasks', 'on-time (d) tasks']) ? row.getCell(findCol(hMap, ['on-time d tasks', 'on_time_d_tasks', 'on-time (d) tasks'])!) : undefined),
          cancellationD: cCancelD ? parseNumberStrict(row.getCell(cCancelD)) : null,
          deliveredOver55Min: parseNumberStrict(findCol(hMap, ['delivered orders over 55min', 'delivered_orders_over_55min']) ? row.getCell(findCol(hMap, ['delivered orders over 55min', 'delivered_orders_over_55min'])!) : undefined),
          acceptedOrders: parseNumberStrict(findCol(hMap, ['accepted orders', 'accepted_orders']) ? row.getCell(findCol(hMap, ['accepted orders', 'accepted_orders'])!) : undefined),
          vdaScore: cVda ? parseNumberStrict(row.getCell(cVda)) : null,
          totalDeliveryDistance: parseNumberStrict(findCol(hMap, ['total delivery distance', 'total_delivery_distance']) ? row.getCell(findCol(hMap, ['total delivery distance', 'total_delivery_distance'])!) : undefined),
          payableDistance: parseNumberStrict(findCol(hMap, ['payable distance', 'payable_distance']) ? row.getCell(findCol(hMap, ['payable distance', 'payable_distance'])!) : undefined),
          shiftWindows,
          shiftsS1ToS6,
          originalHeaders: originalHeadersMap,
          rawExtraColumns,
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
        const cOnTime = findCol(hMap, ['on-time rate', 'on_time_rate']);
        const cComp = findCol(hMap, ['order completion rate', 'order_completion_rate']);
        const cEarly = findCol(hMap, ["didn't tap drop-off too early", 'didnt tap drop-off too early', 'didnt_tap_drop_off_too_early']);
        const cSnapDate = findCol(hMap, ['snapshot date', 'date']);
        [cOnTime, cComp, cEarly].forEach(checkFrac);

        const rowSnapDate = cSnapDate ? parseIsoDate(row.getCell(cSnapDate)) : null;
        const snapshotDate = rowSnapDate || maxDate || fileDateFallback || fallbackImportDate;

        const rawExtraColumns: Record<string, string | number | null> = {};
        for (const extra of extraColEntries) {
          const cell = row.getCell(extra.colIndex);
          const num = parseNumberStrict(cell);
          rawExtraColumns[extra.rawHeader] = num !== null ? num : cellToTrimmedString(cell);
        }

        const recordKey = sanitizeDocIdWithHash('kt_rank', [riderId, snapshotDate], sha256);
        const payload: Omit<KeetaRankSnapshot, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          snapshotDate,
          snapshotMonth: snapshotDate.slice(0, 7),
          name: cellToTrimmedString(findCol(hMap, ['name', 'courier name']) ? row.getCell(findCol(hMap, ['name', 'courier name'])!) : undefined) ?? '',
          currentEstimatedLevel: cellToTrimmedString(findCol(hMap, ['current estimated level', 'current_estimated_level']) ? row.getCell(findCol(hMap, ['current estimated level', 'current_estimated_level'])!) : undefined) ?? '',
          rankingPercentile: parseNumberStrict(findCol(hMap, ['ranking percentile', 'ranking_percentile']) ? row.getCell(findCol(hMap, ['ranking percentile', 'ranking_percentile'])!) : undefined),
          forcedAssignmentScore: parseNumberStrict(findCol(hMap, ['forced assignment score', 'forced_assignment_score']) ? row.getCell(findCol(hMap, ['forced assignment score', 'forced_assignment_score'])!) : undefined),
          estimatedRewardAmount: parseNumberStrict(findCol(hMap, ['estimated reward amount', 'estimated_reward_amount']) ? row.getCell(findCol(hMap, ['estimated reward amount', 'estimated_reward_amount'])!) : undefined),
          onTimeRate: parsePercentStrict(cOnTime ? row.getCell(cOnTime) : undefined, fracFlags.get(cOnTime || 0)),
          orderCompletionRate: parsePercentStrict(cComp ? row.getCell(cComp) : undefined, fracFlags.get(cComp || 0)),
          didntTapDropOffTooEarly: parsePercentStrict(cEarly ? row.getCell(cEarly) : undefined, fracFlags.get(cEarly || 0)),
          orderVolume: parseNumberStrict(findCol(hMap, ['order volume', 'order_volume']) ? row.getCell(findCol(hMap, ['order volume', 'order_volume'])!) : undefined),
          originalHeaders: originalHeadersMap,
          rawExtraColumns,
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
          const rawDate = cDate ? String(unwrapCellValue(row.getCell(cDate)) ?? '') : '';
          rejectedRows.push({
            sheetName: ws.name,
            rowNumber: r,
            riderIdRaw: riderId,
            columnName: cDate ? headers[cDate - 1] || 'Date/dt' : 'Date/dt',
            rawValue: rawDate,
            reason: 'تاريخ Date في التحقق من الهوية غير صالح',
          });
          continue;
        }
        trackDate(isoDate);

        const cPassRate = findCol(hMap, ['pass rate mtd', 'pass_rate_mtd']);
        checkFrac(cPassRate);

        const cTriggered = findCol(hMap, ['if_triggered_today', 'if triggered today']);
        const triggered = parseBooleanOrString(cTriggered ? row.getCell(cTriggered) : undefined);

        const rawExtraColumns: Record<string, string | number | null> = {};
        for (const extra of extraColEntries) {
          const cell = row.getCell(extra.colIndex);
          const num = parseNumberStrict(cell);
          rawExtraColumns[extra.rawHeader] = num !== null ? num : cellToTrimmedString(cell);
        }

        const recordKey = sanitizeDocIdWithHash('kt_face', [riderId, isoDate], sha256);
        const payload: Omit<KeetaFacialRecognitionDaily, 'rowChecksum' | 'importedAt' | 'updatedAt'> = {
          recordKey,
          platform: 'keeta',
          riderId,
          date: isoDate,
          month: isoDate.slice(0, 7),
          city: cellToTrimmedString(findCol(hMap, ['city']) ? row.getCell(findCol(hMap, ['city'])!) : undefined) ?? '',
          partnerId: cellToTrimmedString(findCol(hMap, ['partner id', 'partner_id']) ? row.getCell(findCol(hMap, ['partner id', 'partner_id'])!) : undefined) ?? '',
          partnerName: cellToTrimmedString(findCol(hMap, ['partner name', 'partner_name']) ? row.getCell(findCol(hMap, ['partner name', 'partner_name'])!) : undefined) ?? '',
          pmm: cellToTrimmedString(findCol(hMap, ['pmm']) ? row.getCell(findCol(hMap, ['pmm'])!) : undefined) ?? '',
          ifTriggeredToday: triggered.value,
          ifTriggeredTodayRaw: triggered.raw,
          finalInspectionResult: cellToTrimmedString(findCol(hMap, ['final inspection result', 'final_inspection_result']) ? row.getCell(findCol(hMap, ['final inspection result', 'final_inspection_result'])!) : undefined) ?? '',
          totalDaysTriggeredMtd: parseNumberStrict(findCol(hMap, ['total days triggered mtd', 'total_days_triggered_mtd']) ? row.getCell(findCol(hMap, ['total days triggered mtd', 'total_days_triggered_mtd'])!) : undefined),
          totalDaysPassedMtd: parseNumberStrict(findCol(hMap, ['total days passed mtd', 'total_days_passed_mtd']) ? row.getCell(findCol(hMap, ['total days passed mtd', 'total_days_passed_mtd'])!) : undefined),
          passRateMtd: parsePercentStrict(cPassRate ? row.getCell(cPassRate) : undefined, fracFlags.get(cPassRate || 0)),
          over90PassRate: cellToTrimmedString(findCol(hMap, ['over 90% pass rate', 'if over 90% pass rate this month', 'over_90_pass_rate']) ? row.getCell(findCol(hMap, ['over 90% pass rate', 'if over 90% pass rate this month', 'over_90_pass_rate'])!) : undefined) ?? '',
          originalHeaders: originalHeadersMap,
          rawExtraColumns,
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
  const withinFileConflictCountBySheet = new Map<string, number>();

  for (const rec of records) {
    const uniqueId = `${rec.collection}:${rec.data.recordKey}`;
    const prev = dedupedMap.get(uniqueId);
    if (prev) {
      const sheet = rec.data.sourceSheet;
      withinFileDupCountBySheet.set(sheet, (withinFileDupCountBySheet.get(sheet) || 0) + 1);
      if (prev.data.rowChecksum !== rec.data.rowChecksum) {
        withinFileConflictCountBySheet.set(sheet, (withinFileConflictCountBySheet.get(sheet) || 0) + 1);
      }
    }
    dedupedMap.set(uniqueId, rec);
  }

  for (const d of sheetDiagnostics) {
    const dup = withinFileDupCountBySheet.get(d.sheetName) || 0;
    const conflict = withinFileConflictCountBySheet.get(d.sheetName) || 0;
    if (dup > 0) {
      d.duplicateCount += dup;
      d.validCount = Math.max(0, d.validCount - dup);
    }
    if (conflict > 0) {
      d.withinFileDuplicateConflicts = conflict;
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
