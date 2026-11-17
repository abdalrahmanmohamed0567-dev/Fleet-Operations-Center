import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  Check,
  Copy,
  Download,
  FileDown,
  MessageCircle,
  Printer,
  Send,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DAMAGE_LIABILITY_LABELS,
  DAMAGE_SEVERITY_LABELS,
  VEHICLE_SOURCE_LABELS,
  VEHICLE_STATUS_LABELS,
} from '../../lib/erpHelpers';
import {
  buildTelegramShareHref,
  buildWhatsAppShareHref,
  copyPngBlobToClipboard,
  downloadPngBlob,
  isolateClonedDocumentForHtml2Canvas,
} from '../../lib/reportImageExport';
import type {
  CompanyBrandingDoc,
  FleetConfigSettings,
  RiderMaster,
  VehicleDamageClaim,
  VehicleHandoverRecord,
  VehicleMaster,
  VehicleReturnRecord,
} from '../../types/fleet';
import { Button, ToastBanner } from '../ui/EnterpriseUI';

export type FleetProtocolTarget =
  | { kind: 'handover'; handover: VehicleHandoverRecord; vehicle?: VehicleMaster; rider?: RiderMaster }
  | {
      kind: 'return';
      returnRecord: VehicleReturnRecord;
      vehicle?: VehicleMaster;
      rider?: RiderMaster;
      damageClaim?: VehicleDamageClaim;
    }
  | {
      kind: 'vehicle_dossier';
      vehicle: VehicleMaster;
      rider?: RiderMaster;
      totalMaintCost: number;
      totalClaimCost: number;
      custodyCount: number;
    };

interface FleetProtocolPrintModalProps {
  open: boolean;
  target: FleetProtocolTarget | null;
  branding?: CompanyBrandingDoc | null;
  fleetConfig?: FleetConfigSettings | null;
  preparerEmail?: string;
  onClose: () => void;
}

export function FleetProtocolPrintModal({
  open,
  target,
  branding,
  fleetConfig,
  preparerEmail,
  onClose,
}: FleetProtocolPrintModalProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setToast(null);
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const meta = useMemo(() => {
    if (!target) return null;
    if (target.kind === 'handover') {
      const h = target.handover;
      return {
        title: `محضر تسليم مركبة وعهدة رسمي (${h.handoverNumber})`,
        fileName: `handover_${h.handoverNumber}_${h.plateNumber}`.replace(/\s+/g, '_'),
        summary: `محضر تسليم المركبة ${h.plateNumber} (${h.handoverNumber}) للمندوب ${h.riderName} بتاريخ ${h.handoverDate} · العداد: ${h.odometer ?? '—'} كم`,
      };
    }
    if (target.kind === 'return') {
      const r = target.returnRecord;
      return {
        title: `محضر استلام وفحص إرجاع مركبة (${r.returnNumber})`,
        fileName: `return_${r.returnNumber}_${r.plateNumber}`.replace(/\s+/g, '_'),
        summary: `محضر استلام المركبة ${r.plateNumber} (${r.returnNumber}) من المندوب ${r.riderName} بتاريخ ${r.returnDate} · العداد: ${r.odometerAtReturn ?? '—'} كم · ${r.damageDetected ? 'مرصود أضرار' : 'سليمة'}`,
      };
    }
    const v = target.vehicle;
    return {
      title: `البطاقة التعريفية والتشغيلية للمركبة (${v.plateNumber})`,
      fileName: `vehicle_dossier_${v.vehicleInternalId}_${v.plateNumber}`.replace(/\s+/g, '_'),
      summary: `ملف المركبة ${v.plateNumber} (${v.make} ${v.model}) · الحالة: ${VEHICLE_STATUS_LABELS[v.status] || v.status} · تكلفة الصيانة والأضرار: ${(target.totalMaintCost + target.totalClaimCost).toLocaleString('en-US')} ر.س`,
    };
  }, [target]);

  if (!open || !target || !meta) return null;

  const primaryColor = branding?.branding?.primaryColor || '#0F1E36';
  const companyTitle =
    branding?.company?.companyNameAr || branding?.branding?.systemNameAr || 'Fleet Operations Center';
  const showLogo = fleetConfig?.companyReportHeader?.showLogo !== false && Boolean(branding?.branding?.primaryLogoKey);
  const logoUrl = showLogo && branding?.branding?.primaryLogoKey
    ? `/api/branding/logo/${encodeURIComponent(branding.branding.primaryLogoKey)}`
    : '';
  const disclaimer =
    fleetConfig?.companyReportHeader?.footerDisclaimerAr ||
    branding?.company?.officialFooterText ||
    `${companyTitle} · وثيقة تشغيلية رسمية صادرة من مركز إدارة الأسطول`;

  const renderCanvas = async (): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> => {
    if (!sheetRef.current) throw new Error('تعذر قراءة نموذج الطباعة.');
    const canvas = await html2canvas(sheetRef.current, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      onclone: (clonedDoc, clonedEl) => {
        isolateClonedDocumentForHtml2Canvas(clonedDoc, clonedEl);
      },
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذر تحويل المحضر إلى صورة PNG.'))), 'image/png');
    });
    return { canvas, blob };
  };

  const handleDownloadPng = async () => {
    setBusy(true);
    setToast(null);
    try {
      const { blob } = await renderCanvas();
      downloadPngBlob(blob, `${meta.fileName}.png`);
      setToast({ type: 'ok', text: `تم تنزيل صورة المحضر (${meta.fileName}.png) بنجاح.` });
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'فشل تنزيل الصورة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPng = async () => {
    setBusy(true);
    setToast(null);
    try {
      const { blob } = await renderCanvas();
      const ok = await copyPngBlobToClipboard(blob);
      if (ok) {
        setCopied(true);
        setToast({ type: 'ok', text: 'تم نسخ صورة المحضر إلى الحافظة — يمكنك لصقها مباشرة في واتساب أو تيليجرام.' });
        setTimeout(() => setCopied(false), 3000);
      } else {
        downloadPngBlob(blob, `${meta.fileName}.png`);
        setToast({ type: 'info', text: 'تم تنزيل الصورة لإرفاقها يدويًا في المحادثة.' });
      }
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'فشل نسخ الصورة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPdf = async () => {
    setBusy(true);
    setToast(null);
    try {
      const { canvas } = await renderCanvas();
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgW = pdfW - 40;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let pos = 20;
      pdf.addImage(imgData, 'PNG', 20, pos, imgW, imgH);
      heightLeft -= pdfH - 40;
      while (heightLeft > 0) {
        pos = heightLeft - imgH + 20;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 20, pos, imgW, imgH);
        heightLeft -= pdfH - 40;
      }
      pdf.save(`${meta.fileName}.pdf`);
      setToast({ type: 'ok', text: `تم تنزيل ملف PDF الرسمي (${meta.fileName}.pdf) بنجاح.` });
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'فشل تصدير PDF.' });
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSocialPrepare = async (channel: string) => {
    try {
      const { blob } = await renderCanvas();
      const ok = await copyPngBlobToClipboard(blob);
      if (!ok) downloadPngBlob(blob, `${meta.fileName}.png`);
      setToast({
        type: 'ok',
        text: ok
          ? `تم نسخ صورة المحضر وفتح ${channel} — الصق الصورة (Ctrl+V) داخل المحادثة.`
          : `تم تنزيل صورة المحضر وفتح ${channel}.`,
      });
    } catch {
      // allow social link navigation to proceed
    }
  };

  const checklist =
    target.kind === 'handover'
      ? target.handover.checklist || []
      : target.kind === 'return'
        ? target.returnRecord.checklist || []
        : [];
  const accessories =
    target.kind === 'handover'
      ? target.handover.accessories || []
      : target.kind === 'return'
        ? target.returnRecord.accessories || []
        : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div
        dir="rtl"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{meta.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              معاينة رسمية قابلة للطباعة أو التنزيل كصورة PNG / PDF ومشاركتها عبر القنوات التشغيلية
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق المعاينة"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={busy} icon={<Download className="h-3.5 w-3.5" />} onClick={() => void handleDownloadPng()}>
              تنزيل كصورة PNG
            </Button>
            <Button size="sm" variant="secondary" loading={busy} icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void handleDownloadPdf()}>
              تصدير PDF رسمي
            </Button>
            <Button size="sm" variant="secondary" loading={busy} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void handleCopyPng()}>
              {copied ? 'تم النسخ' : 'نسخ الصورة'}
            </Button>
            <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={handlePrint}>
              طباعة
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={buildWhatsAppShareHref(meta.summary)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void handleSocialPrepare('واتساب')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>واتساب</span>
            </a>
            <a
              href={buildTelegramShareHref(meta.summary)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void handleSocialPrepare('تيليجرام')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100"
            >
              <Send className="h-3.5 w-3.5" />
              <span>تيليجرام</span>
            </a>
          </div>
        </div>

        {toast && (
          <div className="px-5 pt-3">
            <ToastBanner type={toast.type} message={toast.text} onDismiss={() => setToast(null)} />
          </div>
        )}

        {/* Printable Sheet Preview (Always Crisp White Paper Layout for Print & PNG) */}
        <div className="overflow-auto bg-slate-100 dark:bg-slate-950 p-5">
          <div
            ref={sheetRef}
            dir="rtl"
            className="mx-auto w-full max-w-[780px] rounded-lg border border-slate-300 bg-white p-7 text-slate-900 shadow-sm"
            style={{ fontFamily: '"IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif' }}
          >
            {/* Official Header */}
            <div
              className="flex items-start justify-between gap-4 pb-4 mb-5"
              style={{ borderBottom: `3px solid ${primaryColor}` }}
            >
              <div className="flex items-center gap-3">
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt={companyTitle}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    className="h-12 max-w-[120px] object-contain"
                  />
                )}
                <div>
                  <div className="text-xs font-bold" style={{ color: primaryColor }}>
                    {companyTitle}
                  </div>
                  <h1 className="text-lg font-bold text-slate-900 mt-0.5">{meta.title}</h1>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {[
                      branding?.company?.crNumber ? `س.ت: ${branding.company.crNumber}` : '',
                      branding?.company?.vatNumber ? `الرقم الضريبي: ${branding.company.vatNumber}` : '',
                      branding?.company?.phone ? `هاتف: ${branding.company.phone}` : '',
                      branding?.company?.city || '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'إدارة العمليات والأسطول المؤسسي'}
                  </div>
                </div>
              </div>
              <div className="text-left text-[11px] text-slate-500 font-mono-num shrink-0">
                <div>تاريخ الإصدار: {new Date().toISOString().slice(0, 10)}</div>
                {preparerEmail && <div>المُصدر: {preparerEmail}</div>}
              </div>
            </div>

            {/* Body Specifics */}
            {target.kind === 'handover' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['رقم محضر التسليم', target.handover.handoverNumber],
                    ['تاريخ ووقت التسليم', `${target.handover.handoverDate} ${target.handover.handoverTime || ''}`],
                    ['رقم العهدة', target.handover.custodyId],
                    ['رقم اللوحة', target.handover.plateNumber],
                    ['المركبة', target.vehicle ? `${target.vehicle.make} ${target.vehicle.model} (${target.vehicle.year || ''})` : target.handover.vehicleInternalId],
                    ['المندوب المستلم', `${target.handover.riderName} (${target.handover.riderId})`],
                    ['قراءة العداد عند التسليم', `${target.handover.odometer ?? '—'} كم`],
                    ['مستوى الوقود', target.handover.fuelLevel || '—'],
                    ['إقرار المندوب', target.handover.riderAcknowledged ? 'مُقر وموافق على الاستلام' : 'غير مُقر'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[10px] text-slate-500">{k}</div>
                      <div className="font-bold text-slate-900 font-mono-num mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded border border-slate-200 p-3 text-xs">
                  <div className="text-[10px] font-bold text-slate-500 mb-1">الحالة العامة للمركبة عند التسليم</div>
                  <div className="text-slate-800">{target.handover.overallCondition}</div>
                  {target.handover.notes && <div className="text-slate-600 mt-1">ملاحظات: {target.handover.notes}</div>}
                </div>
              </div>
            )}

            {target.kind === 'return' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['رقم محضر الاستلام', target.returnRecord.returnNumber],
                    ['تاريخ ووقت الفحص', `${target.returnRecord.returnDate} ${target.returnRecord.returnTime || ''}`],
                    ['الاعتماد والحالة', target.returnRecord.status === 'completed' ? 'مغلق ومعتمد' : 'بانتظار الاعتماد'],
                    ['رقم اللوحة', target.returnRecord.plateNumber],
                    ['المركبة', target.vehicle ? `${target.vehicle.make} ${target.vehicle.model}` : target.returnRecord.vehicleInternalId],
                    ['المندوب المُسلِّم', `${target.returnRecord.riderName} (${target.returnRecord.riderId})`],
                    ['العداد عند الاستلام', `${target.returnRecord.odometerAtReturn ?? '—'} كم`],
                    ['المسافة المقطوعة بالعهدة', target.returnRecord.distanceDriven !== null && target.returnRecord.distanceDriven !== undefined ? `${target.returnRecord.distanceDriven.toLocaleString('en-US')} كم` : '—'],
                    ['مستوى الوقود', target.returnRecord.fuelLevelAtReturn || '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[10px] text-slate-500">{k}</div>
                      <div className="font-bold text-slate-900 font-mono-num mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>

                <div
                  className={`rounded border p-3 text-xs ${
                    target.returnRecord.damageDetected
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  <div className="font-bold">
                    {target.returnRecord.damageDetected ? 'تنبيه: تم رصد أضرار أثناء الفحص' : 'نتيجة الفحص: المركبة سليمة من الأضرار'}
                  </div>
                  <div className="mt-1">الحالة العامة: {target.returnRecord.overallCondition}</div>
                  {target.returnRecord.damageSummary && (
                    <div className="mt-1">تفاصيل الضرر: {target.returnRecord.damageSummary}</div>
                  )}
                  {target.damageClaim && (
                    <div className="mt-1 font-mono-num">
                      بلاغ الضرر: {target.damageClaim.claimNumber} · الشدة:{' '}
                      {DAMAGE_SEVERITY_LABELS[target.damageClaim.severity] || target.damageClaim.severity} · المسؤولية:{' '}
                      {DAMAGE_LIABILITY_LABELS[target.damageClaim.liability] || target.damageClaim.liability} · التكلفة:{' '}
                      {(target.damageClaim.actualRepairCost ?? target.damageClaim.estimatedRepairCost ?? 0).toLocaleString('en-US')} ر.س
                    </div>
                  )}
                </div>
              </div>
            )}

            {target.kind === 'vehicle_dossier' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['المعرف الداخلي', target.vehicle.vehicleInternalId],
                    ['رقم اللوحة', target.vehicle.plateNumber],
                    ['الحالة التشغيلية', VEHICLE_STATUS_LABELS[target.vehicle.status] || target.vehicle.status],
                    ['الشركة والموديل', `${target.vehicle.make} ${target.vehicle.model} (${target.vehicle.year || '—'})`],
                    ['رقم الهيكل (VIN)', target.vehicle.vin || '—'],
                    ['مصدر الملكية', VEHICLE_SOURCE_LABELS[target.vehicle.sourceType || 'owned']],
                    ['الفرع والمدينة', [target.vehicle.city, target.vehicle.branch].filter(Boolean).join(' / ') || '—'],
                    ['المندوب المستلم حاليًا', target.rider ? `${target.rider.fullName} (${target.rider.internalRiderId})` : 'غير مسلمة'],
                    ['العداد الحالي', `${target.vehicle.currentOdometer ?? '—'} كم`],
                    ['انتهاء الاستمارة', target.vehicle.istimaraExpiryDate || '—'],
                    ['انتهاء التأمين', target.vehicle.insuranceExpiryDate || '—'],
                    ['انتهاء الفحص الدوري', target.vehicle.periodicInspectionExpiryDate || '—'],
                    ['عدد العهد المسجلة', String(target.custodyCount)],
                    ['إجمالي تكاليف الصيانة', `${target.totalMaintCost.toLocaleString('en-US')} ر.س`],
                    ['إجمالي تكاليف الأضرار', `${target.totalClaimCost.toLocaleString('en-US')} ر.س`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[10px] text-slate-500">{k}</div>
                      <div className="font-bold text-slate-900 font-mono-num mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Checklist & Accessories Tables (for Handover / Return) */}
            {(checklist.length > 0 || accessories.length > 0) && (
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {checklist.length > 0 && (
                  <div>
                    <div className="font-bold text-slate-800 mb-1.5">قائمة الفحص الفني</div>
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="border border-slate-700 px-2 py-1 text-right">البند</th>
                          <th className="border border-slate-700 px-2 py-1 text-center">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checklist.map((item) => (
                          <tr key={item.itemKey} className="odd:bg-white even:bg-slate-50">
                            <td className="border border-slate-200 px-2 py-1">{item.labelAr}</td>
                            <td className="border border-slate-200 px-2 py-1 text-center font-semibold">
                              {item.status === 'ok' ? 'سليم' : item.status === 'issue' ? 'ملاحظة' : 'غير منطبق'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {accessories.length > 0 && (
                  <div>
                    <div className="font-bold text-slate-800 mb-1.5">العهد والملحقات</div>
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="border border-slate-700 px-2 py-1 text-right">الملحق</th>
                          <th className="border border-slate-700 px-2 py-1 text-center">التوفر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accessories.map((acc) => (
                          <tr key={acc.accessoryKey} className="odd:bg-white even:bg-slate-50">
                            <td className="border border-slate-200 px-2 py-1">{acc.labelAr}</td>
                            <td className="border border-slate-200 px-2 py-1 text-center font-semibold">
                              {acc.present
                                ? `متوفر${acc.condition === 'worn' ? ' (مستهلك)' : acc.condition === 'damaged' ? ' (تالف)' : ' (جيد)'}`
                                : 'غير متوفر'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Signatures Block for Handover / Return */}
            {(target.kind === 'handover' || target.kind === 'return') && (
              <div className="mt-7 grid grid-cols-3 gap-4 border-t border-slate-200 pt-4 text-center text-[11px]">
                <div>
                  <div className="font-bold text-slate-700">توقيع / إقرار المندوب</div>
                  <div className="mt-6 border-b border-dashed border-slate-400 mx-4" />
                  <div className="mt-1 text-slate-500">
                    {target.kind === 'handover' ? target.handover.riderName : target.returnRecord.riderName}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-700">مشرف / فاحص الأسطول</div>
                  <div className="mt-6 border-b border-dashed border-slate-400 mx-4" />
                  <div className="mt-1 text-slate-500 font-mono-num">
                    {target.kind === 'handover' ? target.handover.supervisorName : target.returnRecord.inspectorName}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-700">اعتماد إدارة الأسطول</div>
                  <div className="mt-6 border-b border-dashed border-slate-400 mx-4" />
                  <div className="mt-1 text-slate-500 font-mono-num">
                    {target.kind === 'handover'
                      ? target.handover.approvedByEmail || 'معتمد إلكترونيًا'
                      : target.returnRecord.approvedByEmail || 'قيد المراجعة'}
                  </div>
                </div>
              </div>
            )}

            {/* Official Footer */}
            <div className="mt-6 border-t border-slate-200 pt-2.5 flex items-center justify-between text-[10px] text-slate-500">
              <span>{disclaimer}</span>
              <span className="font-mono-num">Fleet Operations Center</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
