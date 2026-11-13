import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ExportColumn } from '../server/exportEngine';

export async function exportArabicTableToPdf(params: {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  fileName: string;
}): Promise<void> {
  const container = document.createElement('div');
  container.dir = 'rtl';
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = '1120px';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.padding = '28px';
  container.style.fontFamily = '"IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';

  const maxRows = params.rows.slice(0, 80);
  const theadHtml = params.columns
    .map(
      (c) =>
        `<th style="padding:10px 8px;background:#0f172a;color:#ffffff;font-size:12px;text-align:right;border:1px solid #1e293b;">${escapeHtml(c.header)}</th>`
    )
    .join('');

  const tbodyHtml = maxRows
    .map((row, idx) => {
      const bg = idx % 2 === 1 ? '#f8fafc' : '#ffffff';
      const tds = params.columns
        .map((c) => {
          const raw = row[c.key];
          const text = raw === null || raw === undefined || raw === '' ? 'غير متاح' : String(raw);
          return `<td style="padding:8px;background:${bg};font-size:11px;border:1px solid #e2e8f0;text-align:right;">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  container.innerHTML = `
    <div style="border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px;">
      <div style="font-size:20px;font-weight:700;color:#0f172a;">${escapeHtml(params.title)}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${escapeHtml(params.subtitle)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${theadHtml}</tr></thead>
      <tbody>${tbodyHtml}</tbody>
    </table>
    <div style="margin-top:14px;font-size:10px;color:#64748b;">
      Fleet Operations Center · إجمالي السجلات المعروضة: ${maxRows.length} من ${params.rows.length}
    </div>
  `;

  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 1.5, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth - 40;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 20;
    pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight - 40;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 20;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight - 40;
    }

    const cleanName = params.fileName.endsWith('.pdf') ? params.fileName : `${params.fileName}.pdf`;
    pdf.save(cleanName);
  } finally {
    document.body.removeChild(container);
  }
}

function escapeHtml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
