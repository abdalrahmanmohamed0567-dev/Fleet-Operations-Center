import html2canvas from 'html2canvas';
import type { ExportColumn } from '../shared/exportCore';
import type { CompanyBrandingDoc } from '../types/fleet';

export interface ReportImageKpi {
  label: string;
  value: string;
  subtext?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'critical';
}

export interface GenerateReportImageParams {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  fileName: string;
  branding?: CompanyBrandingDoc | null;
  orientation?: 'landscape' | 'portrait';
  preparer?: string;
  periodLabel?: string;
  includeLogo?: boolean;
  includeCompanyDetails?: boolean;
  includeKpis?: boolean;
  kpis?: ReportImageKpi[];
  maxRows?: number;
}

export interface GeneratedReportImageResult {
  dataUrl: string;
  blob: Blob;
  fileName: string;
  summaryText: string;
  width: number;
  height: number;
  displayedCount: number;
  totalCount: number;
}

function escapeHtml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHexColor(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function isolateClonedDocumentForHtml2Canvas(clonedDoc: Document, clonedEl: HTMLElement): void {
  const styleNodes = Array.from(clonedDoc.querySelectorAll('style, link[rel="stylesheet"]'));
  for (const node of styleNodes) {
    if (node.tagName === 'LINK') {
      const href = (node as HTMLLinkElement).getAttribute('href') || '';
      if (href.includes('fonts.googleapis.com')) continue;
    }
    node.parentNode?.removeChild(node);
  }

  if ('adoptedStyleSheets' in clonedDoc) {
    try {
      clonedDoc.adoptedStyleSheets = [];
    } catch {
      // Ignore if adoptedStyleSheets is read-only
    }
  }

  clonedDoc.documentElement.removeAttribute('class');
  clonedDoc.documentElement.style.cssText =
    'background:#ffffff;color:#0f172a;margin:0;padding:0;color-scheme:light;';

  clonedDoc.body.removeAttribute('class');
  clonedDoc.body.style.cssText =
    'background:#ffffff;color:#0f172a;margin:0;padding:0;font-family:"IBM Plex Sans Arabic","Plus Jakarta Sans",Arial,sans-serif;';

  clonedDoc.body.replaceChildren(clonedEl);
  clonedEl.style.position = 'static';
  clonedEl.style.left = '0';
  clonedEl.style.top = '0';
}

function isNumericOrCodeLike(val: string): boolean {
  if (!val || val === 'غير متاح' || val === '-') return false;
  return /^[0-9.,:%/+\-\s]+$/.test(val.trim());
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function buildReportShareSummaryText(params: {
  title: string;
  subtitle?: string;
  branding?: CompanyBrandingDoc | null;
  kpis?: ReportImageKpi[];
  periodLabel?: string;
  totalRows: number;
}): string {
  const company = params.branding?.company;
  const companyName = company?.companyNameAr || params.branding?.branding?.systemNameAr || 'Fleet Operations Center';
  const issueDate = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `*${companyName}*`,
    `📊 *${params.title}*`,
  ];

  if (params.subtitle) {
    lines.push(params.subtitle);
  }
  if (params.periodLabel) {
    lines.push(`🗓️ الفترة: ${params.periodLabel}`);
  }
  lines.push(`📅 تاريخ الإصدار: ${issueDate} | إجمالي السجلات: ${params.totalRows}`);

  if (params.kpis && params.kpis.length > 0) {
    lines.push('');
    lines.push('*أبرز المؤشرات:*');
    for (const k of params.kpis.slice(0, 5)) {
      lines.push(`• ${k.label}: *${k.value}*${k.subtext ? ` (${k.subtext})` : ''}`);
    }
  }

  const contactBits = [
    company?.crNumber ? `س.ت: ${company.crNumber}` : '',
    company?.phone ? `هاتف: ${company.phone}` : '',
    company?.city ? company.city : '',
  ].filter(Boolean);

  if (contactBits.length > 0) {
    lines.push('');
    lines.push(contactBits.join(' | '));
  }

  return lines.join('\n');
}

export async function generateReportPngImage(
  params: GenerateReportImageParams
): Promise<GeneratedReportImageResult> {
  const orientation = params.orientation || (params.columns.length >= 7 ? 'landscape' : 'portrait');
  const maxRowsLimit = Math.max(5, Math.min(80, params.maxRows ?? 30));
  const displayedRows = params.rows.slice(0, maxRowsLimit);

  const brand = params.branding;
  const primaryColor = sanitizeHexColor(brand?.branding?.primaryColor, '#0f1e36');
  const secondaryColor = sanitizeHexColor(brand?.branding?.secondaryColor, '#2563eb');
  const companyAr =
    brand?.company?.companyNameAr || brand?.branding?.systemNameAr || 'شركة العمليات اللوجستية للأساطيل';
  const companyEn = brand?.company?.companyNameEn || brand?.branding?.systemNameEn || 'FLEET OPERATIONS CENTER';

  const logoKey =
    brand?.branding?.primaryLogoKey || brand?.branding?.alternateLogoKey || brand?.branding?.iconLogoKey || '';
  const logoDataUrl =
    params.includeLogo !== false && logoKey
      ? await fetchImageAsDataUrl(`/api/branding/logo/${encodeURIComponent(logoKey)}`)
      : null;

  const containerWidth = orientation === 'portrait' ? 920 : 1220;
  const nowDate = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const container = document.createElement('div');
  container.dir = 'rtl';
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${containerWidth}px`;
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = '"IBM Plex Sans Arabic", "Plus Jakarta Sans", Arial, sans-serif';
  container.style.boxSizing = 'border-box';
  container.style.margin = '0';
  container.style.padding = '0';
  container.style.lineHeight = '1.45';
  container.style.colorScheme = 'light';

  const includeCompany = params.includeCompanyDetails !== false;
  const companyMetaItems = includeCompany
    ? [
        brand?.company?.crNumber ? `س.ت: ${brand.company.crNumber}` : '',
        brand?.company?.vatNumber ? `الرقم الضريبي: ${brand.company.vatNumber}` : '',
        brand?.company?.phone ? `هاتف: ${brand.company.phone}` : '',
        brand?.company?.email ? `البريد: ${brand.company.email}` : '',
        [brand?.company?.city, brand?.company?.country].filter(Boolean).join(' - '),
        brand?.company?.responsibleManager ? `المسؤول: ${brand.company.responsibleManager}` : '',
      ].filter(Boolean)
    : [];

  const activeKpis =
    params.includeKpis !== false && params.kpis && params.kpis.length > 0 ? params.kpis.slice(0, 5) : [];

  const kpiCardsHtml =
    activeKpis.length > 0
      ? `<div style="display:grid;grid-template-columns:repeat(${activeKpis.length},minmax(0,1fr));gap:10px;margin-bottom:18px;">
          ${activeKpis
            .map((k) => {
              const topColor =
                k.tone === 'good'
                  ? '#059669'
                  : k.tone === 'warn'
                    ? '#d97706'
                    : k.tone === 'critical'
                      ? '#dc2626'
                      : secondaryColor;
              const valColor =
                k.tone === 'good'
                  ? '#065f46'
                  : k.tone === 'warn'
                    ? '#92400e'
                    : k.tone === 'critical'
                      ? '#991b1b'
                      : '#0f172a';
              return `
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid ${topColor};border-radius:10px;padding:10px 12px;box-sizing:border-box;">
                  <div style="font-size:10.5px;font-weight:600;color:#475569;margin-bottom:4px;">${escapeHtml(k.label)}</div>
                  <div style="font-size:17px;font-weight:700;color:${valColor};font-family:'JetBrains Mono','IBM Plex Sans Arabic',monospace;direction:ltr;text-align:right;">${escapeHtml(k.value)}</div>
                  ${k.subtext ? `<div style="font-size:10px;color:#64748b;margin-top:3px;">${escapeHtml(k.subtext)}</div>` : ''}
                </div>
              `;
            })
            .join('')}
        </div>`
      : '';

  const colFontSize = params.columns.length >= 9 ? '10.5px' : '11.5px';
  const cellPad = params.columns.length >= 9 ? '8px 7px' : '9px 10px';

  const theadHtml = params.columns
    .map(
      (c) =>
        `<th style="padding:10px 9px;background:${primaryColor};color:#ffffff;font-size:${colFontSize};font-weight:700;text-align:right;border-bottom:2px solid ${secondaryColor};white-space:nowrap;">${escapeHtml(c.header)}</th>`
    )
    .join('');

  const tbodyHtml =
    displayedRows.length === 0
      ? `<tr><td colspan="${Math.max(1, params.columns.length)}" style="padding:28px;text-align:center;color:#64748b;font-size:13px;background:#ffffff;">لا توجد سجلات لعرضها في هذا التقرير.</td></tr>`
      : displayedRows
          .map((row, idx) => {
            const bg = idx % 2 === 1 ? '#f8fafc' : '#ffffff';
            const tds = params.columns
              .map((c) => {
                const raw = row[c.key];
                const text = raw === null || raw === undefined || raw === '' ? '—' : String(raw);
                const numeric = isNumericOrCodeLike(text);
                const cellStyle = numeric
                  ? `padding:${cellPad};background:${bg};font-size:${colFontSize};color:#0f172a;font-weight:600;border-top:1px solid #e2e8f0;text-align:right;font-family:'JetBrains Mono','IBM Plex Sans Arabic',monospace;direction:ltr;unicode-bidi:isolate;`
                  : `padding:${cellPad};background:${bg};font-size:${colFontSize};color:#1e293b;border-top:1px solid #e2e8f0;text-align:right;`;
                return `<td style="${cellStyle}">${escapeHtml(text)}</td>`;
              })
              .join('');
            return `<tr>${tds}</tr>`;
          })
          .join('');

  const footerPrimaryText =
    (includeCompany && brand?.company?.officialFooterText) ||
    `${companyAr} · ${brand?.branding?.systemNameAr || 'Fleet Operations Center'}`;

  const footerSecondaryItems = includeCompany
    ? [
        brand?.company?.address ? brand.company.address : '',
        brand?.company?.website ? brand.company.website : '',
      ].filter(Boolean)
    : [];

  container.innerHTML = `
    <div style="background:#ffffff;border:1px solid #cbd5e1;overflow:hidden;">
      <!-- Top Brand Accent Bar -->
      <div style="height:6px;background:linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%);"></div>

      <div style="padding:24px 28px 22px 28px;">
        <!-- Corporate Letterhead Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;margin-bottom:18px;">
          <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0;">
            ${
              logoDataUrl
                ? `<div style="flex-shrink:0;padding:8px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;display:flex;align-items:center;justify-content:center;">
                     <img src="${logoDataUrl}" style="height:56px;max-width:130px;object-fit:contain;display:block;" />
                   </div>`
                : `<div style="flex-shrink:0;width:52px;height:52px;border-radius:12px;background:${primaryColor};color:#ffffff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;font-family:'Plus Jakarta Sans',sans-serif;">
                     ${escapeHtml((brand?.company?.shortName || 'FOC').slice(0, 4))}
                   </div>`
            }
            <div style="min-width:0;flex:1;">
              ${
                includeCompany
                  ? `<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;">
                       <span style="font-size:14px;font-weight:700;color:${primaryColor};">${escapeHtml(companyAr)}</span>
                       <span style="font-size:10.5px;font-weight:600;color:#64748b;letter-spacing:0.04em;">${escapeHtml(companyEn)}</span>
                     </div>`
                  : `<div style="font-size:12px;font-weight:700;color:${primaryColor};">${escapeHtml(brand?.branding?.systemNameAr || 'Fleet Operations Center')}</div>`
              }
              <div style="font-size:21px;font-weight:700;color:#0f172a;margin-top:3px;line-height:1.3;">${escapeHtml(params.title)}</div>
              ${
                params.subtitle
                  ? `<div style="font-size:12px;color:#475569;margin-top:3px;">${escapeHtml(params.subtitle)}</div>`
                  : ''
              }
              ${
                companyMetaItems.length > 0
                  ? `<div style="margin-top:8px;padding-top:7px;border-top:1px dashed #cbd5e1;font-size:10.5px;color:#475569;display:flex;flex-wrap:wrap;gap:6px 12px;">
                       ${companyMetaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('<span style="color:#cbd5e1;">|</span>')}
                     </div>`
                  : ''
              }
            </div>
          </div>

          <!-- Structured Issue Metadata Box -->
          <div style="flex-shrink:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:210px;font-size:10.5px;color:#334155;">
            <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
              <span style="color:#64748b;">تاريخ الإصدار:</span>
              <span style="font-weight:700;font-family:'JetBrains Mono',monospace;direction:ltr;">${nowDate} · ${nowTime}</span>
            </div>
            ${
              params.periodLabel
                ? `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
                     <span style="color:#64748b;">الفترة:</span>
                     <span style="font-weight:600;">${escapeHtml(params.periodLabel)}</span>
                   </div>`
                : ''
            }
            ${
              params.preparer
                ? `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
                     <span style="color:#64748b;">أعدّه:</span>
                     <span style="font-weight:600;">${escapeHtml(params.preparer)}</span>
                   </div>`
                : ''
            }
            <div style="display:flex;justify-content:space-between;gap:12px;">
              <span style="color:#64748b;">إجمالي السجلات:</span>
              <span style="font-weight:700;color:${primaryColor};font-family:'JetBrains Mono',monospace;">${params.rows.length}</span>
            </div>
          </div>
        </div>

        <!-- Executive KPI Strip -->
        ${kpiCardsHtml}

        <!-- Structured Data Table -->
        <div style="border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;table-layout:auto;">
            <thead>
              <tr>${theadHtml}</tr>
            </thead>
            <tbody>
              ${tbodyHtml}
            </tbody>
          </table>
        </div>

        ${
          params.rows.length > displayedRows.length
            ? `<div style="margin-top:10px;padding:7px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:10.5px;color:#1e40af;display:flex;justify-content:space-between;align-items:center;">
                 <span>ملاحظة: تم عرض أول ${displayedRows.length} سجل من إجمالي ${params.rows.length} سجل للحفاظ على دقة ووضوح الصورة عند المشاركة.</span>
                 <span style="font-family:'JetBrains Mono',monospace;font-weight:700;">${displayedRows.length} / ${params.rows.length}</span>
               </div>`
            : ''
        }

        <!-- Official Branded Footer -->
        <div style="margin-top:18px;padding-top:12px;border-top:2px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:10.5px;color:#475569;">
          <div>
            <div style="font-weight:700;color:${primaryColor};">${escapeHtml(footerPrimaryText)}</div>
            ${
              footerSecondaryItems.length > 0
                ? `<div style="font-size:10px;color:#64748b;margin-top:2px;">${escapeHtml(footerSecondaryItems.join(' · '))}</div>`
                : ''
            }
          </div>
          <div style="text-align:left;font-size:10px;color:#64748b;font-family:'JetBrains Mono','IBM Plex Sans Arabic',monospace;">
            <span>السجلات المعروضة: ${displayedRows.length} من ${params.rows.length}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: containerWidth + 80,
      onclone: (clonedDoc, clonedEl) => {
        isolateClonedDocumentForHtml2Canvas(clonedDoc, clonedEl);
      },
    });

    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('تعذر تحويل التقرير إلى ملف صورة PNG.'));
        },
        'image/png',
        1.0
      );
    });

    const cleanFileName = params.fileName.toLowerCase().endsWith('.png')
      ? params.fileName
      : `${params.fileName.replace(/\.(pdf|xlsx|csv)$/i, '')}.png`;

    const summaryText = buildReportShareSummaryText({
      title: params.title,
      subtitle: params.subtitle,
      branding: brand,
      kpis: activeKpis,
      periodLabel: params.periodLabel,
      totalRows: params.rows.length,
    });

    return {
      dataUrl,
      blob,
      fileName: cleanFileName,
      summaryText,
      width: canvas.width,
      height: canvas.height,
      displayedCount: displayedRows.length,
      totalCount: params.rows.length,
    };
  } finally {
    document.body.removeChild(container);
  }
}

export function downloadPngBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== 'function' ||
      typeof ClipboardItem === 'undefined'
    ) {
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export function canNativeShareImageFile(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      return false;
    }
    const testFile = new File([new Uint8Array([0])], 'report.png', { type: 'image/png' });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

export async function nativeShareReportPng(params: {
  blob: Blob;
  fileName: string;
  title: string;
  text: string;
}): Promise<'shared' | 'cancelled' | 'unsupported'> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      return 'unsupported';
    }
    const file = new File([params.blob], params.fileName, { type: 'image/png' });
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      return 'unsupported';
    }
    await navigator.share({
      files: [file],
      title: params.title,
      text: params.text,
    });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unsupported';
  }
}

export function buildWhatsAppShareHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildTelegramShareHref(text: string, pageUrl?: string): string {
  const targetUrl = pageUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://t.me');
  return `https://t.me/share/url?url=${encodeURIComponent(targetUrl)}&text=${encodeURIComponent(text)}`;
}

export function buildEmailShareHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
