import type ExcelJS from 'exceljs';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

export async function buildExcelReportArrayBuffer(params: {
  title: string;
  sheetName: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  metadataLines?: string[];
  createWorkbook: () => ExcelJS.Workbook;
}): Promise<ArrayBuffer> {
  const wb = params.createWorkbook();
  wb.creator = 'Fleet Operations Center';
  wb.created = new Date();

  const ws = wb.addWorksheet(params.sheetName.slice(0, 31), {
    views: [{ rightToLeft: true }],
  });

  ws.mergeCells(1, 1, 1, Math.max(1, params.columns.length));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = params.title;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(1).height = 28;

  let startRow = 2;
  if (params.metadataLines && params.metadataLines.length > 0) {
    ws.mergeCells(2, 1, 2, Math.max(1, params.columns.length));
    const metaCell = ws.getCell(2, 1);
    metaCell.value = params.metadataLines.join(' | ');
    metaCell.font = { name: 'Arial', size: 10, color: { argb: 'FF334155' } };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    metaCell.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(2).height = 20;
    startRow = 3;
  }

  const headerRow = ws.getRow(startRow);
  params.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getColumn(idx + 1).width = col.width || 18;
  });
  headerRow.height = 24;

  params.rows.forEach((rowObj, rIdx) => {
    const r = ws.getRow(startRow + 1 + rIdx);
    params.columns.forEach((col, cIdx) => {
      const val = rowObj[col.key];
      const cell = r.getCell(cIdx + 1);
      cell.value = val === null || val === undefined ? 'غير متاح' : (val as ExcelJS.CellValue);
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: typeof val === 'number' ? 'center' : 'right', vertical: 'middle' };
      if (rIdx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
    r.height = 20;
  });

  const buffer = await wb.xlsx.writeBuffer();
  if (buffer instanceof ArrayBuffer) return buffer;
  const u8 = new Uint8Array(buffer);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
