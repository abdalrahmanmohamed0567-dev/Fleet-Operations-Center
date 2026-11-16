import {
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildEmailShareHref,
  buildTelegramShareHref,
  buildWhatsAppShareHref,
  canNativeShareImageFile,
  copyPngBlobToClipboard,
  downloadPngBlob,
  generateReportPngImage,
  nativeShareReportPng,
  type GeneratedReportImageResult,
  type ReportImageKpi,
} from '../lib/reportImageExport';
import type { ExportColumn } from '../shared/exportCore';
import type { CompanyBrandingDoc } from '../types/fleet';
import { Button, Select, ToastBanner } from './ui/EnterpriseUI';

interface ReportImageShareModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  fileName: string;
  branding?: CompanyBrandingDoc | null;
  preparer?: string;
  periodLabel?: string;
  kpis?: ReportImageKpi[];
  defaultOrientation?: 'landscape' | 'portrait';
  defaultIncludeLogo?: boolean;
  defaultIncludeCompanyDetails?: boolean;
}

export function ReportImageShareModal({
  open,
  onClose,
  title,
  subtitle,
  columns,
  rows,
  fileName,
  branding,
  preparer,
  periodLabel,
  kpis,
  defaultOrientation,
  defaultIncludeLogo = true,
  defaultIncludeCompanyDetails = true,
}: ReportImageShareModalProps) {
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(
    defaultOrientation || (columns.length >= 7 ? 'landscape' : 'portrait')
  );
  const [maxRows, setMaxRows] = useState<number>(30);
  const [includeCompanyAndLogo, setIncludeCompanyAndLogo] = useState<boolean>(
    defaultIncludeLogo || defaultIncludeCompanyDetails
  );
  const [includeKpis, setIncludeKpis] = useState<boolean>(Boolean(kpis && kpis.length > 0));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeneratedReportImageResult | null>(null);
  const [copiedImage, setCopiedImage] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);

  const supportsNativeFileShare = useMemo(() => canNativeShareImageFile(), []);

  useEffect(() => {
    if (!open) return;
    setOrientation(defaultOrientation || (columns.length >= 7 ? 'landscape' : 'portrait'));
    setIncludeCompanyAndLogo(defaultIncludeLogo || defaultIncludeCompanyDetails);
    setIncludeKpis(Boolean(kpis && kpis.length > 0));
    setToast(null);
    setCopiedImage(false);
  }, [open, defaultOrientation, columns.length, defaultIncludeLogo, defaultIncludeCompanyDetails, kpis]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const renderPreview = async () => {
    setBusy(true);
    setToast(null);
    try {
      const generated = await generateReportPngImage({
        title,
        subtitle,
        columns,
        rows,
        fileName,
        branding,
        orientation,
        preparer,
        periodLabel,
        includeLogo: includeCompanyAndLogo,
        includeCompanyDetails: includeCompanyAndLogo,
        includeKpis,
        kpis,
        maxRows,
      });
      setResult(generated);
    } catch (err) {
      setToast({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر توليد صورة التقرير.',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orientation, maxRows, includeCompanyAndLogo, includeKpis, title, fileName]);

  if (!open) return null;

  const handleDownload = () => {
    if (!result) return;
    downloadPngBlob(result.blob, result.fileName);
    setToast({ type: 'ok', text: `تم تنزيل صورة التقرير (${result.fileName}) بنجاح.` });
  };

  const handleCopyImage = async () => {
    if (!result) return;
    const ok = await copyPngBlobToClipboard(result.blob);
    if (ok) {
      setCopiedImage(true);
      setToast({
        type: 'ok',
        text: 'تم نسخ صورة التقرير إلى الحافظة — يمكنك لصقها مباشرة (Ctrl+V) في واتساب أو تيليجرام.',
      });
      setTimeout(() => setCopiedImage(false), 3000);
    } else {
      downloadPngBlob(result.blob, result.fileName);
      setToast({
        type: 'info',
        text: 'المتصفح لا يدعم نسخ الصور مباشرة للحافظة، لذلك تم تنزيل الصورة لتسهيل إرفاقها.',
      });
    }
  };

  const handleNativeShare = async () => {
    if (!result) return;
    const status = await nativeShareReportPng({
      blob: result.blob,
      fileName: result.fileName,
      title,
      text: result.summaryText,
    });
    if (status === 'shared') {
      setToast({ type: 'ok', text: 'تمت مشاركة صورة التقرير بنجاح.' });
    } else if (status === 'unsupported') {
      setToast({
        type: 'info',
        text: 'المشاركة المباشرة للملفات غير مدعومة في هذا المتصفح، استخدم أزرار واتساب أو تيليجرام أو نسخ الصورة.',
      });
    }
  };

  const handlePrepareSocialShare = async (channelName: string) => {
    if (!result) return;
    const ok = await copyPngBlobToClipboard(result.blob);
    if (ok) {
      setToast({
        type: 'ok',
        text: `تم فتح ${channelName} ونسخ صورة التقرير للحافظة — اضغط لصق (Ctrl+V) داخل المحادثة لإرفاق الصورة مع الملخص.`,
      });
    } else {
      downloadPngBlob(result.blob, result.fileName);
      setToast({
        type: 'info',
        text: `تم فتح ${channelName} وتنزيل صورة التقرير (${result.fileName}) لإرفاقها في المحادثة.`,
      });
    }
  };

  const whatsappHref = result ? buildWhatsAppShareHref(result.summaryText) : '#';
  const telegramHref = result ? buildTelegramShareHref(result.summaryText) : '#';
  const emailHref = result ? buildEmailShareHref(title, result.summaryText) : '#';

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-200/70 dark:border-blue-800/70">
              <ImageIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                تصدير ومشاركة التقرير كصورة رسمية (PNG)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {title}
                {result ? ` · ${result.width}×${result.height} بكسل · ${result.displayedCount}/${result.totalCount} سجل` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Customization Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-semibold">
              <span>التخطيط:</span>
              <Select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
                className="h-8 w-auto min-w-[140px] py-1 text-xs"
              >
                <option value="portrait">عمودي (مناسب للجوال والواتساب)</option>
                <option value="landscape">أفقي عريض (مناسب للجداول الكبيرة)</option>
              </Select>
            </label>

            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-semibold">
              <span>عدد الصفوف:</span>
              <Select
                value={String(maxRows)}
                onChange={(e) => setMaxRows(Number(e.target.value))}
                className="h-8 w-auto min-w-[110px] py-1 text-xs font-mono-num"
              >
                <option value="15">أول 15 سجل</option>
                <option value="30">أول 30 سجل</option>
                <option value="50">أول 50 سجل</option>
                <option value="80">أول 80 سجل</option>
              </Select>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={includeCompanyAndLogo}
                onChange={(e) => setIncludeCompanyAndLogo(e.target.checked)}
                className="rounded"
              />
              <span>الشعار وبيانات الشركة</span>
            </label>

            {kpis && kpis.length > 0 && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={includeKpis}
                  onChange={(e) => setIncludeKpis(e.target.checked)}
                  className="rounded"
                />
                <span>ملخص المؤشرات</span>
              </label>
            )}
          </div>

          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => void renderPreview()}
          >
            تحديث الصورة
          </Button>
        </div>

        {/* Toast Feedback */}
        {toast && (
          <div className="px-5 pt-3">
            <ToastBanner type={toast.type} message={toast.text} onDismiss={() => setToast(null)} />
          </div>
        )}

        {/* Live Image Preview Viewport */}
        <div className="flex-1 overflow-auto erp-scroll bg-slate-100 dark:bg-slate-950 p-4 sm:p-6 flex items-start justify-center min-h-[280px]">
          {busy ? (
            <div className="my-auto flex flex-col items-center gap-3 py-12 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-semibold">جاري تجهيز صورة التقرير عالية الدقة ببيانات الشركة...</span>
            </div>
          ) : result ? (
            <div className="w-full flex justify-center">
              <img
                src={result.dataUrl}
                alt={title}
                className="max-w-full h-auto rounded-lg border border-slate-300 dark:border-slate-700 shadow-lg bg-white"
              />
            </div>
          ) : (
            <div className="my-auto py-12 text-xs text-slate-500">تعذر عرض المعاينة</div>
          )}
        </div>

        {/* Bottom Download & Social Share Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={busy || !result}
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleDownload}
            >
              تنزيل الصورة (PNG)
            </Button>

            <Button
              variant="secondary"
              disabled={busy || !result}
              icon={copiedImage ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              onClick={() => void handleCopyImage()}
            >
              {copiedImage ? 'تم نسخ الصورة' : 'نسخ الصورة (Ctrl+V)'}
            </Button>

            {supportsNativeFileShare && (
              <Button
                variant="accent"
                disabled={busy || !result}
                icon={<Share2 className="h-3.5 w-3.5" />}
                onClick={() => void handleNativeShare()}
              >
                مشاركة عبر الجهاز
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 ml-1">
              مشاركة سريعة:
            </span>

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void handlePrepareSocialShare('واتساب')}
              aria-disabled={busy || !result}
              className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors ${
                busy || !result ? 'pointer-events-none opacity-55' : ''
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>واتساب</span>
            </a>

            <a
              href={telegramHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void handlePrepareSocialShare('تيليجرام')}
              aria-disabled={busy || !result}
              className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 bg-sky-600 text-white hover:bg-sky-700 transition-colors ${
                busy || !result ? 'pointer-events-none opacity-55' : ''
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              <span>تيليجرام</span>
            </a>

            <a
              href={emailHref}
              onClick={() => void handlePrepareSocialShare('البريد الإلكتروني')}
              aria-disabled={busy || !result}
              className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                busy || !result ? 'pointer-events-none opacity-55' : ''
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>إيميل</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
