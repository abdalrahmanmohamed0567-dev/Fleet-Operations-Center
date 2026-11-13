import crypto from 'crypto';
import ExcelJS from 'exceljs';
import {
  parseExcelCore,
  sanitizeDocIdWithHash,
  type ParsedCollectionRecord,
  type ParsedWorkbookOutput,
} from '../shared/excelParserCore.js';

export type { ParsedCollectionRecord, ParsedWorkbookOutput };

function sha256(input: string | Uint8Array): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sanitizeDocId(prefix: string, rawParts: string[]): string {
  return sanitizeDocIdWithHash(prefix, rawParts, sha256);
}

export async function parseExcelBuffer(params: {
  buffer: Buffer;
  fileName: string;
  batchId: string;
  createdByUid: string;
  allowedUids: string[];
  importDateIso?: string;
}): Promise<ParsedWorkbookOutput> {
  return parseExcelCore({
    data: params.buffer,
    fileName: params.fileName,
    batchId: params.batchId,
    createdByUid: params.createdByUid,
    allowedUids: params.allowedUids,
    importDateIso: params.importDateIso,
    createWorkbook: () => new ExcelJS.Workbook(),
    sha256,
  });
}
