import ExcelJS from 'exceljs';
import { buildExcelReportArrayBuffer, type ExportColumn } from '../shared/exportCore.js';

export type { ExportColumn };

export async function buildExcelReportBuffer(params: {
  title: string;
  sheetName: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  metadataLines?: string[];
}): Promise<Buffer> {
  const arrBuf = await buildExcelReportArrayBuffer({
    ...params,
    createWorkbook: () => new ExcelJS.Workbook(),
  });
  return Buffer.from(arrBuf);
}
