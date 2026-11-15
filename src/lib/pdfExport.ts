import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ExportColumn } from '../server/exportEngine';
import type { CompanyBrandingDoc } from '../types/fleet';

export async function exportArabicTableToPdf(params: {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  fileName: string;
  branding?: CompanyBrandingDoc | null;
  orientation?: 'landscape' | 'portrait';
  preparer?: string;
  includeLogo?: boolean;
  includeCompanyDetails?: boolean;
}): Promise<void> {
  const orientation = params.orientation || 'landscape';
  const container = document.createElement('div');
  container.dir = 'rtl';
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = orientation === 'portrait' ? '820px' : '1120px';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.padding = '28px';
  container.style.fontFamily = '"IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';

  const brand = params.branding;
  const primaryColor = brand?.primaryColor || '#0f1e36';
  const companyTitle = brand?.companyNameAr || brand?.systemNameAr || 'Fleet Operations Center';
  const logoUrl =
    params.includeLogo !== false && brand?.primaryLogoKey
      ? `/api/branding/logo/${encodeURIComponent(brand.primaryLogoKey)}`
      : '';

  const maxRows = params.rows.slice(0, 100);
  const theadHtml = params.columns
    .map(
      (c) =>
        `<th style="padding:10px 8px;background:${escapeHtml(primaryColor)};color:#ffffff;font-size:12px;text-align:right;border:1px solid #1e293b;">${escapeHtml(c.header)}</th>`
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

  const companyDetailsHtml =
    params.includeCompanyDetails !== false && brand
      ? `<div style="font-size:10px;color:#475569;margin-top:4px;">
          ${[
            brand.crNumber ? `س.ت: ${brand.crNumber}` : '',
            brand.vatNumber ? `الرقم الضريبي: ${brand.vatNumber}` : '',
            brand.phone ? `هاتف: ${brand.phone}` : '',
            brand.city ? `${brand.city}` : '',
          ]
            .filter(Boolean)
            .map(escapeHtml)
            .join(' · ')}
        </div>`
      : '';

  const footerText = brand?.officialFooterText || `${companyTitle} · نظام إدارة العمليات والأسطول`;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid ${escapeHtml(primaryColor)};padding-bottom:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" crossorigin="anonymous" style="height:48px;max-width:120px;object-fit:contain;" />` : ''}
        <div>
          <div style="font-size:12px;font-weight:700;color:${escapeHtml(primaryColor)};">${escapeHtml(companyTitle)}</div>
          <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px;">${escapeHtml(params.title)}</div>
          <div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(params.subtitle)}</div>
          ${companyDetailsHtml}
        </div>
      </div>
      <div style="text-align:left;font-size:10px;color:#475569;">
        <div>تاريخ الإصدار: ${new Date().toISOString().slice(0, 10)}</div>
        ${params.preparer ? `<div>أعدّه: ${escapeHtml(params.preparer)}</div>` : ''}
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${theadHtml}</tr></thead>
      <tbody>${tbodyHtml}</tbody>
    </table>
    <div style="margin-top:16px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#64748b;">
      <span>${escapeHtml(footerText)}</span>
      <span>السجلات المعروضة: ${maxRows.length} من ${params.rows.length}</span>
    </div>
  `;

  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
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
