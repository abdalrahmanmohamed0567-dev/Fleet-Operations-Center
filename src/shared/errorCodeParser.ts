/**
 * Pure, isomorphic HungerStation Error Code Parser & Normalizer.
 *
 * Design guarantees:
 * 1. Never drops or mutates the Raw Error Code (`rawCode`).
 * 2. Empty / placeholder tokens ('', '-', '--', 'N/A', 'null', 'none', '0', 'لا يوجد')
 *    are NEVER counted as errors.
 * 3. Safe multi-code splitting: detects real list delimiters (comma, Arabic comma,
 *    semicolon, pipe, newline, spaced slash/ampersand, or slash between distinct
 *    multi-char code tokens) without breaking composite single codes such as
 *    `ERR-101`, `TGA_01`, `CODE/A`, `E-04: Network Timeout`.
 * 4. Produces deterministic Firestore-safe `codeKey` (`^[a-zA-Z0-9_-]+$`, <= 128 chars)
 *    even when a raw code contains spaces, colons, Arabic text, or punctuation.
 */

export interface ParsedErrorCodeToken {
  rawCode: string;
  normalizedCode: string;
  codeKey: string;
}

export interface ErrorDelimiterProfile {
  detectedDelimiters: string[];
  multiCodeRowsCount: number;
  knownStandaloneCodes: Set<string>;
}

const EMPTY_ERROR_SENTINELS = new Set([
  '',
  '-',
  '--',
  '---',
  '—',
  'null',
  'n/a',
  'na',
  'nan',
  'none',
  'nil',
  'no error',
  'no errors',
  'no_error',
  'no-error',
  '0',
  '0.0',
  'لا يوجد',
  'بدون',
  'لايوجد',
]);

export function isNoErrorSentinel(val: string | null | undefined): boolean {
  if (val === null || val === undefined) return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return EMPTY_ERROR_SENTINELS.has(trimmed.toLowerCase());
}

/**
 * Pure synchronous deterministic 64-bit FNV-1a hex digest (16 hex chars)
 * safe for both Browser and Node.js runtimes.
 */
function deterministicHex64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${p1}${p2}`;
}

export function normalizeErrorCode(rawToken: string): string {
  return rawToken.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function makeErrorCodeKey(normalizedCode: string): string {
  const clean = normalizedCode
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  const hash = deterministicHex64(normalizedCode);
  return clean ? `err_${clean}_${hash}` : `err_${hash}`;
}

export function makeRiderErrorCaseId(riderId: string, date: string, codeKey: string): string {
  const hash = deterministicHex64(`${riderId}|${date}|${codeKey}`);
  const rPart = riderId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28);
  const dPart = date.replace(/[^0-9-]/g, '').slice(0, 10);
  return `ecase_${rPart}_${dPart}_${hash}`.slice(0, 128);
}

/**
 * Inspect actual `Error Codes` cell strings from the dataset to discover
 * which multi-code separators actually occur and which single-code tokens exist.
 */
export function inspectErrorCodeDatasetFormat(rawCells: Array<string | null | undefined>): ErrorDelimiterProfile {
  const delimiters = new Set<string>();
  const knownStandaloneCodes = new Set<string>();
  let multiCodeRowsCount = 0;

  for (const cell of rawCells) {
    if (isNoErrorSentinel(cell)) continue;
    const s = cell!.trim();
    const hasStructural = /[,،;|\r\n]|\s+[\/&]\s+/.test(s);
    if (!hasStructural && !s.includes('/')) {
      knownStandaloneCodes.add(normalizeErrorCode(s));
    }
    if (s.includes(',') || s.includes('،')) delimiters.add('comma');
    if (s.includes(';')) delimiters.add('semicolon');
    if (s.includes('|')) delimiters.add('pipe');
    if (/[\r\n]/.test(s)) delimiters.add('newline');
    if (/\s+\/\s+/.test(s)) delimiters.add('spaced_slash');
    if (/\s+&\s+/.test(s)) delimiters.add('spaced_amp');
    if (hasStructural) multiCodeRowsCount++;
  }

  return {
    detectedDelimiters: Array.from(delimiters),
    multiCodeRowsCount,
    knownStandaloneCodes,
  };
}

function shouldSplitUnspacedSlash(token: string, profile?: ErrorDelimiterProfile): boolean {
  if (!token.includes('/')) return false;
  const parts = token.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;

  // Never split composite single codes where one side is a 1-char flag/suffix like CODE/A or E-01/1
  if (parts.some((p) => p.length < 2)) return false;

  // If the dataset already contains all parts as standalone codes, it is a list
  if (profile && parts.every((p) => profile.knownStandaloneCodes.has(normalizeErrorCode(p)))) {
    return true;
  }

  // Or if every side independently looks like a structured numeric/alphanumeric code (e.g. ERR101/ERR202 or 101/202)
  return parts.every((p) => /^(?:[A-Z]{1,6}[-_]?\d+|\d{2,6})$/i.test(p));
}

/**
 * Parse raw Error Codes cell value into unique normalized tokens per row,
 * preserving verbatim `rawCode` on every token.
 */
export function parseRawErrorCodes(
  rawInput: string | null | undefined,
  profile?: ErrorDelimiterProfile
): ParsedErrorCodeToken[] {
  if (isNoErrorSentinel(rawInput)) return [];

  const trimmed = rawInput!.trim();

  // Stage 1: Split only on unambiguous structural separators
  const primaryParts = trimmed
    .split(/[\r\n,;،|]+|\s+[\/&]\s+/)
    .map((part) => part.trim())
    .filter((part) => !isNoErrorSentinel(part));

  // Stage 2: Check optional unspaced slash only if safe per profile / strict code pattern
  const expandedParts: string[] = [];
  for (const part of primaryParts) {
    if (shouldSplitUnspacedSlash(part, profile)) {
      const subParts = part
        .split('/')
        .map((s) => s.trim())
        .filter((s) => !isNoErrorSentinel(s));
      expandedParts.push(...subParts);
    } else {
      expandedParts.push(part);
    }
  }

  const seenNormalized = new Set<string>();
  const tokens: ParsedErrorCodeToken[] = [];
  for (const rawCode of expandedParts) {
    const normalizedCode = normalizeErrorCode(rawCode);
    if (!normalizedCode || isNoErrorSentinel(normalizedCode)) continue;
    if (seenNormalized.has(normalizedCode)) continue;
    seenNormalized.add(normalizedCode);
    tokens.push({
      rawCode,
      normalizedCode,
      codeKey: makeErrorCodeKey(normalizedCode),
    });
  }

  return tokens;
}
