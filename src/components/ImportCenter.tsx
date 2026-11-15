import {
  CheckCircle2,
  Cloud,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  commitExcelInBrowser,
  exportExcelInBrowser,
  hasClientPreview,
  previewExcelInBrowser,
} from '../lib/clientExcelFallback';
import { listDriveExcelFiles, type DriveFileItem } from '../lib/driveClient';
import { auth, getDriveAccessToken, refreshDriveTokenWithPopup } from '../lib/firebase';
import { ApiHtmlFallbackError, safeParseJsonResponse } from '../lib/safeFetch';
import { isKeetaActive } from '../shared/rbacCore';
import type {
  ImportBatch,
  ImportPreviewResult,
  OperationalSettings,
  Platform,
  PlatformCatalogEntry,
  UserProfile,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import {
  Button,
  Card,
  Input,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Tabs,
  ToastBanner,
} from './ui/EnterpriseUI';

interface ImportCenterProps {
  currentUser: UserProfile;
  importBatches: ImportBatch[];
  settings?: OperationalSettings;
  platformCatalog?: PlatformCatalogEntry[];
  lockedPlatform?: Platform;
  onCommitted: () => Promise<void>;
}

function downloadRejectedCsv(file: ImportPreviewResult) {
  const headers = ['الشيت', 'رقم الصف', 'معرف المندوب الخام', 'العمود', 'القيمة الخام', 'سبب الرفض', 'اسم الملف'];
  const esc = (val: string | number) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.map(esc).join(','),
    ...file.rejectedSample.map((r) =>
      [r.sheetName, r.rowNumber, r.riderIdRaw || '', r.columnName || '', r.rawValue || '', r.reason, file.fileName]
        .map(esc)
        .join(',')
    ),
  ];
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const baseName = file.fileName.replace(/\.(xlsx?|csv)$/i, '');
  a.href = url;
  a.download = `rejected_${baseName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportCenter({
  currentUser,
  importBatches,
  settings,
  platformCatalog = [],
  lockedPlatform,
  onCommitted,
}: ImportCenterProps) {
  const role = currentUser.role;
  const keetaActive = isKeetaActive(settings, platformCatalog);
  const keetaLockedOut = lockedPlatform === 'keeta' && !keetaActive;
  const canImport =
    !keetaLockedOut &&
    (role === 'owner' || role === 'admin' || role === 'operations_manager');

  const maxFiles = Math.min(10, Math.max(1, settings?.importMaxFiles ?? 10));
  const allowUpdates = settings?.importAllowUpdates ?? true;
  const strictDates = settings?.importStrictDates ?? true;

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [selectedDriveIds, setSelectedDriveIds] = useState<string[]>([]);
  const [driveQuery, setDriveQuery] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [exportingRejectedHash, setExportingRejectedHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    previewId: string;
    files: ImportPreviewResult[];
  } | null>(null);
  const [previewSheetTabByFile, setPreviewSheetTabByFile] = useState<Record<string, string>>({});
  const [expandedSheetDiagByFile, setExpandedSheetDiagByFile] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setStagedFiles([]);
    setSelectedDriveIds([]);
    setPreviewData(null);
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [lockedPlatform]);

  const scopedBatches = useMemo(() => {
    const base = keetaActive ? importBatches : importBatches.filter((b) => b.platform !== 'keeta');
    return lockedPlatform ? base.filter((b) => b.platform === lockedPlatform) : base;
  }, [importBatches, lockedPlatform, keetaActive]);

  const batchByHash = useMemo(() => {
    const map = new Map<string, ImportBatch>();
    for (const b of scopedBatches) {
      if (b.fileHash && !map.has(b.fileHash)) {
        map.set(b.fileHash, b);
      }
    }
    return map;
  }, [scopedBatches]);

  const handleAddLocalFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    const incoming = Array.from(fileList);
    setStagedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}_${f.lastModified}`));
      const merged = [...prev];
      const availableSlots = Math.max(0, maxFiles - selectedDriveIds.length);
      for (const f of incoming) {
        const key = `${f.name}_${f.size}_${f.lastModified}`;
        if (!existingKeys.has(key) && merged.length < availableSlots) {
          merged.push(f);
          existingKeys.add(key);
        }
      }
      if (prev.length + incoming.length > availableSlots) {
        setErrorMsg(`الحد الأقصى للملفات في الدفعة الواحدة هو ${maxFiles} ملفات حسب سياسة الاستيراد.`);
      }
      return merged;
    });
  };

  const removeStagedFile = (idx: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLoadDriveFiles = async () => {
    setErrorMsg(null);
    setDriveLoading(true);
    try {
      const files = await listDriveExcelFiles(driveQuery);
      setDriveFiles(files);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل ملفات Google Drive.');
    } finally {
      setDriveLoading(false);
    }
  };

  const toggleDriveSelection = (id: string) => {
    setErrorMsg(null);
    setSelectedDriveIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (stagedFiles.length + prev.length >= maxFiles) {
        setErrorMsg(`الحد الأقصى للملفات في الدفعة الواحدة هو ${maxFiles} ملفات.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const handlePreview = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPreviewData(null);

    const selectedDrive = driveFiles.filter((d) => selectedDriveIds.includes(d.id));
    const totalCount = stagedFiles.length + selectedDrive.length;

    if (totalCount === 0) {
      const targetName =
        lockedPlatform === 'hungerstation'
          ? 'HungerStation'
          : lockedPlatform === 'keeta'
            ? 'Keeta'
            : 'HungerStation أو Keeta';
      setErrorMsg(`يرجى إضافة ملف ${targetName} من جهازك أو من Google Drive أولاً.`);
      return;
    }

    if (totalCount > maxFiles) {
      setErrorMsg(`تجاوزت الحد الأقصى المسموح (${maxFiles} ملفات لكل دفعة).`);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setErrorMsg('يرجى تسجيل الدخول أولاً.');
      return;
    }

    setPreviewLoading(true);
    try {
      const idToken = await user.getIdToken();
      let driveToken = getDriveAccessToken();
      if (selectedDrive.length > 0 && !driveToken) {
        driveToken = await refreshDriveTokenWithPopup();
      }

      const formData = new FormData();
      if (lockedPlatform) {
        formData.append('expectedPlatform', lockedPlatform);
      }
      for (const f of stagedFiles) {
        formData.append('files', f);
      }
      if (selectedDrive.length > 0) {
        formData.append(
          'driveFiles',
          JSON.stringify(selectedDrive.map((d) => ({ id: d.id, name: d.name })))
        );
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${idToken}`,
      };
      if (driveToken) {
        headers['X-Drive-Access-Token'] = driveToken;
      }

      let json: { previewId: string; files: ImportPreviewResult[]; error?: string };
      try {
        const res = await fetch('/api/import/preview', {
          method: 'POST',
          headers,
          body: formData,
        });
        json = await safeParseJsonResponse<{
          previewId: string;
          files: ImportPreviewResult[];
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(json.error || 'فشل تحليل ملفات Excel.');
        }
      } catch (apiErr) {
        if (apiErr instanceof ApiHtmlFallbackError || apiErr instanceof TypeError) {
          json = await previewExcelInBrowser({
            localFiles: stagedFiles,
            driveFiles: selectedDrive.map((d) => ({ id: d.id, name: d.name })),
            user: currentUser,
            expectedPlatform: lockedPlatform,
          });
        } else {
          throw apiErr;
        }
      }
      setPreviewData({ previewId: json.previewId, files: json.files });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء معاينة الملفات.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!previewData || !auth.currentUser) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setCommitLoading(true);
    try {
      let batchesResult: Array<{
        fileName: string;
        inserted: number;
        updated: number;
        skippedDuplicates: number;
      }>;

      if (hasClientPreview(previewData.previewId)) {
        const cliRes = await commitExcelInBrowser({
          previewId: previewData.previewId,
          user: currentUser,
        });
        batchesResult = cliRes.batches;
      } else {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch('/api/import/commit', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ previewId: previewData.previewId }),
        });
        const json = await safeParseJsonResponse<{
          batches?: Array<{
            fileName: string;
            inserted: number;
            updated: number;
            skippedDuplicates: number;
          }>;
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(json.error || 'تعذر حفظ البيانات في قاعدة البيانات.');
        }
        batchesResult = json.batches || [];
      }

      const summaryTxt = batchesResult
        .map(
          (b) =>
            `${b.fileName}: جديد (${b.inserted}) · محدث (${b.updated}) · مكرر متجاهل (${b.skippedDuplicates})`
        )
        .join(' | ');

      setSuccessMsg(`تمت عملية الاستيراد والحساب بنجاح — ${summaryTxt}`);
      setPreviewData(null);
      setStagedFiles([]);
      setSelectedDriveIds([]);
      await onCommitted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تأكيد الاستيراد.');
    } finally {
      setCommitLoading(false);
    }
  };

  const handleExportRejectedExcel = async (file: ImportPreviewResult) => {
    setExportingRejectedHash(file.fileHash);
    try {
      const baseName = file.fileName.replace(/\.(xlsx?|csv)$/i, '');
      await exportExcelInBrowser({
        title: `تقرير السجلات المرفوضة — ${file.fileName}`,
        sheetName: 'Rejected Rows',
        fileName: `rejected_${baseName}.xlsx`,
        metadataLines: [
          `الملف: ${file.fileName}`,
          `المنصة: ${file.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}`,
          `إجمالي المرفوضات بالملف: ${file.rejectedCount} (المعروض في العينة: ${file.rejectedSample.length})`,
        ],
        columns: [
          { key: 'sheetName', header: 'الشيت', width: 28 },
          { key: 'rowNumber', header: 'رقم الصف', width: 12 },
          { key: 'riderIdRaw', header: 'معرف المندوب الخام', width: 22 },
          { key: 'columnName', header: 'العمود', width: 24 },
          { key: 'rawValue', header: 'القيمة الخام', width: 24 },
          { key: 'reason', header: 'سبب الرفض', width: 48 },
        ],
        rows: file.rejectedSample.map((r) => ({
          sheetName: r.sheetName,
          rowNumber: r.rowNumber,
          riderIdRaw: r.riderIdRaw || '(فارغ)',
          columnName: r.columnName || '-',
          rawValue: r.rawValue || '-',
          reason: r.reason,
        })),
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تصدير ملف السجلات المرفوضة.');
    } finally {
      setExportingRejectedHash(null);
    }
  };

  const batchCols: TableColumn<ImportBatch>[] = [
    {
      key: 'fileName',
      header: 'اسم الملف',
      sortValue: (r) => r.fileName,
      render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.fileName}</span>,
    },
    {
      key: 'platform',
      header: 'المنصة',
      sortValue: (r) => r.platform,
      render: (r) => (
        <StatusBadge
          label={r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
          tone={r.platform === 'hungerstation' ? 'info' : 'neutral'}
        />
      ),
    },
    {
      key: 'sourceType',
      header: 'المصدر',
      render: (r) => (
        <span className="text-slate-700 dark:text-slate-300">
          {r.sourceType === 'google_drive' ? 'Google Drive' : 'رفع محلي'}
        </span>
      ),
    },
    {
      key: 'period',
      header: 'الفترة المكتشفة',
      render: (r) => (
        <span className="font-mono-num text-xs text-slate-700 dark:text-slate-300">
          {r.detectedPeriodStart || '-'} → {r.detectedPeriodEnd || '-'}
        </span>
      ),
    },
    {
      key: 'valid',
      header: 'صحيح / محدث',
      sortValue: (r) => r.validCount,
      align: 'center',
      render: (r) => (
        <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">
          {r.validCount}
        </span>
      ),
    },
    {
      key: 'dup',
      header: 'مكرر متجاهل',
      sortValue: (r) => r.duplicateCount,
      align: 'center',
      render: (r) => (
        <span className="font-mono-num text-slate-600 dark:text-slate-400">{r.duplicateCount}</span>
      ),
    },
    {
      key: 'rej',
      header: 'مرفوض',
      sortValue: (r) => r.rejectedCount,
      align: 'center',
      render: (r) => (
        <span
          className={`font-mono-num font-semibold ${
            r.rejectedCount > 0
              ? 'text-red-700 dark:text-red-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {r.rejectedCount}
        </span>
      ),
    },
    {
      key: 'by',
      header: 'بواسطة',
      render: (r) => (
        <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
          {r.importedByEmail || '-'}
        </span>
      ),
    },
  ];

  const totalStagedCount = stagedFiles.length + selectedDriveIds.length;

  const pageTitle =
    lockedPlatform === 'hungerstation'
      ? 'مركز استيراد تقارير HungerStation'
      : lockedPlatform === 'keeta'
        ? 'مركز استيراد تقارير Keeta'
        : 'مركز استيراد تقارير Excel متعدد الملفات';

  const pageSubtitle =
    lockedPlatform === 'hungerstation'
      ? 'استيراد مخصص لملفات HungerStation فقط (يُرفض أي ملف خاص بمنصة أخرى تلقائيًا) · استيراد Idempotent يمنع التكرار'
      : lockedPlatform === 'keeta'
        ? 'استيراد مخصص لملفات Keeta فقط (يُرفض أي ملف خاص بمنصة أخرى تلقائيًا) · استيراد Idempotent يمنع التكرار'
        : 'كشف تلقائي للمنصة من الشيتات والأعمدة · تنظيف العناوين المكررة والصفوف الفارغة · استيراد Idempotent يمنع التكرار';

  return (
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs text-slate-600 dark:text-slate-300">
            <span>
              الحد الأقصى للدفعة: <strong className="font-mono-num text-slate-900 dark:text-white">{maxFiles} ملفات</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>
              تحديث السجلات المتغيرة: <strong className="text-slate-900 dark:text-white">{allowUpdates ? 'مسموح' : 'جديد فقط'}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>
              تدقيق التواريخ: <strong className="text-slate-900 dark:text-white">{strictDates ? 'صارم' : 'مرن'}</strong>
            </span>
          </div>
        }
      />

      {keetaLockedOut && (
        <ToastBanner
          type="warn"
          message="تم تعطيل عمليات واستيراد Keeta مؤقتًا عبر إعدادات المنصات (Feature Flag). يمكن إعادة التفعيل من إعدادات النظام والمنصات دون فقدان البيانات التاريخية."
        />
      )}

      {!keetaLockedOut && !canImport && (
        <ToastBanner
          type="warn"
          message={`صلاحياتك الحالية (${role}) مخصصة للعرض فقط. الاستيراد متاح لمالك النظام، المدير، ومدير العمليات.`}
        />
      )}

      {errorMsg && (
        <ToastBanner type="err" message={errorMsg} onDismiss={() => setErrorMsg(null)} />
      )}

      {successMsg && (
        <ToastBanner type="ok" message={successMsg} onDismiss={() => setSuccessMsg(null)} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Multi-File Local Uploads */}
        <Card className="space-y-4">
          <SectionHeader
            title="رفع ملفات Excel من الجهاز (دفعة متعددة)"
            actions={
              <span className="font-mono-num text-xs font-semibold text-slate-500 dark:text-slate-400">
                {totalStagedCount} / {maxFiles} ملفات محددة
              </span>
            }
          />

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 p-6 text-center transition-colors hover:border-blue-400 dark:hover:border-blue-600 hover:bg-slate-100/70 dark:hover:bg-slate-800/60">
            <FileSpreadsheet className="h-7 w-7 text-slate-700 dark:text-slate-300" />
            <span className="mt-2 text-xs font-bold text-slate-900 dark:text-white">
              {lockedPlatform === 'hungerstation'
                ? 'اختر ملف أو عدة ملفات HungerStation (.xlsx / .csv)'
                : lockedPlatform === 'keeta'
                  ? 'اختر ملف أو عدة ملفات Keeta (.xlsx / .csv)'
                  : 'اختر ملف أو عدة ملفات HungerStation / Keeta (.xlsx / .csv)'}
            </span>
            <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {lockedPlatform
                ? `يتم التحقق الصارم من مطابقة الشيتات والأعمدة لمنصة ${lockedPlatform === 'hungerstation' ? 'HungerStation' : 'Keeta'} حتى ${maxFiles} ملفات`
                : `يتم التعرف على المنصة تلقائيًا لكل ملف (.xlsx / .xls / .csv) ويمكنك إرفاق حتى ${maxFiles} ملفات في العملية الواحدة`}
            </span>
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.csv"
              disabled={!canImport}
              onChange={(e) => {
                handleAddLocalFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          {stagedFiles.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
              {stagedFiles.map((f, idx) => (
                <div
                  key={`${f.name}_${f.size}_${idx}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {f.name}
                    </span>
                    <span className="font-mono-num text-slate-400 dark:text-slate-500 shrink-0">
                      ({(f.size / 1024).toFixed(0)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStagedFile(idx)}
                    title="إزالة الملف"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              {lockedPlatform === 'hungerstation'
                ? 'الشيتات المدعومة لـ HungerStation: Hunger-Daily، Riders Wallet، Riders Distance، Delivery Quality Segmentation.'
                : lockedPlatform === 'keeta'
                  ? 'الشيتات المدعومة لـ Keeta: Dashboard، VDA (Online Day)، RankPlanProcess، Facial recognition.'
                  : 'الشيتات المدعومة تلقائيًا: Hunger-Daily، Riders Wallet، Riders Distance، Delivery Quality Segmentation، Dashboard، VDA، RankPlanProcess، Facial recognition.'}
            </div>
          )}
        </Card>

        {/* Google Drive Integration */}
        <Card className="space-y-4">
          <SectionHeader
            title="استيراد مباشر من Google Drive"
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={driveLoading}
                disabled={!canImport || driveLoading}
                onClick={handleLoadDriveFiles}
                icon={<FolderOpen className="h-3.5 w-3.5" />}
              >
                {driveLoading ? 'جاري الجلب...' : 'استعراض ملفات Drive'}
              </Button>
            }
          />

          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-slate-400 shrink-0" />
            <Input
              type="text"
              value={driveQuery}
              onChange={(e) => setDriveQuery(e.target.value)}
              placeholder="بحث باسم الملف في Google Drive..."
            />
          </div>

          {driveFiles.length > 0 ? (
            <div className="max-h-48 overflow-y-auto erp-scroll divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
              {driveFiles.map((df) => {
                const checked = selectedDriveIds.includes(df.id);
                return (
                  <label
                    key={df.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs ${
                      checked
                        ? 'bg-slate-100 font-semibold text-slate-900 dark:bg-slate-800 dark:text-white'
                        : 'hover:bg-slate-50 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDriveSelection(df.id)}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      <span className="truncate">{df.name}</span>
                    </div>
                    <span className="font-mono-num text-slate-400 dark:text-slate-500 shrink-0">
                      {df.modifiedTime ? df.modifiedTime.slice(0, 10) : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 text-center text-xs text-slate-500 dark:text-slate-400">
              اضغط &quot;استعراض ملفات Drive&quot; لعرض ملفات Excel وCSV (.xlsx / .xls / .csv) المخزنة في حسابك.
            </div>
          )}
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        {(stagedFiles.length > 0 || selectedDriveIds.length > 0) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStagedFiles([]);
              setSelectedDriveIds([]);
              setPreviewData(null);
            }}
          >
            مسح قائمة الملفات المحددة
          </Button>
        ) : (
          <div />
        )}
        <Button
          variant="primary"
          size="lg"
          loading={previewLoading}
          disabled={!canImport || previewLoading || totalStagedCount === 0}
          onClick={handlePreview}
          icon={<Upload className="h-4 w-4" />}
        >
          {previewLoading
            ? 'جاري تحليل وفحص الملفات...'
            : `تحليل ومعاينة البيانات (${totalStagedCount}) قبل الحفظ`}
        </Button>
      </div>

      {/* Preview Diagnostics */}
      {previewData && (
        <Card padding="lg" className="space-y-5">
          <SectionHeader
            title={`نتائج المعاينة والتحقق قبل الحفظ (${previewData.files.length} ملف)`}
            subtitle="راجع أعداد السجلات الجديدة والمحدثة والمكررة والمرفوضة وبصمة SHA-256 قبل تأكيد الإدراج في Cloud Firestore"
            className="border-b border-slate-200 dark:border-slate-800 pb-4"
            actions={
              <Button
                variant="accent"
                size="lg"
                loading={commitLoading}
                disabled={commitLoading}
                onClick={handleCommit}
                icon={<CheckCircle2 className="h-4 w-4" />}
              >
                {commitLoading ? 'جاري الحفظ وتحديث الملخصات...' : 'تأكيد الاستيراد والحفظ الدائم'}
              </Button>
            }
          />

          {previewData.files.map((file) => {
            const duplicateHashBatch = batchByHash.get(file.fileHash);
            return (
              <div
                key={file.fileHash + file.fileName}
                className="space-y-4 border-b border-slate-200 dark:border-slate-800 pb-5 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <span>{file.fileName}</span>
                      <StatusBadge
                        label={file.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
                        tone="success"
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono-num dark:text-slate-400">
                      الفترة: {file.detectedPeriodStart || 'غير محدد'} →{' '}
                      {file.detectedPeriodEnd || 'غير محدد'} · الشيتات:{' '}
                      {file.sheetsDetected.join('، ')} · البصمة: {file.fileHash.slice(0, 12)}
                    </div>
                  </div>
                </div>

                {duplicateHashBatch && (
                  <ToastBanner
                    type="warn"
                    message={`تحذير تكرار ملف: تم استيراد ملف مطابق تمامًا مسبقًا بنفس البصمة الرقمية (SHA-256) باسم "${duplicateHashBatch.fileName}" للفترة (${duplicateHashBatch.detectedPeriodStart || '-'} → ${duplicateHashBatch.detectedPeriodEnd || '-'}). سيتجاهل النظام السجلات المكررة تلقائيًا عند التأكيد.`}
                  />
                )}

                {!allowUpdates && file.updatedCount > 0 && (
                  <ToastBanner
                    type="info"
                    message={`ملاحظة سياسة الاستيراد: الإعداد الحالي يعطل تعديل السجلات السابقة؛ يوجد ${file.updatedCount} سجل متغير مقارنة بالبيانات المخزنة.`}
                  />
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      إجمالي السجلات الصالحة
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-slate-900 dark:text-white">
                      {file.totalValid}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400">سجلات جديدة</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-emerald-800 dark:text-emerald-300">
                      {file.newCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 p-3">
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      تحديث بيانات متغيرة
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-amber-800 dark:text-amber-300">
                      {file.updatedCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      مكرر مطابق (يُتجاهل)
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-slate-700 dark:text-slate-300">
                      {file.duplicateCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50/70 dark:bg-red-950/30 p-3">
                    <div className="text-xs text-red-700 dark:text-red-400">سجلات مرفوضة</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-red-800 dark:text-red-300">
                      {file.rejectedCount}
                    </div>
                  </div>
                </div>

                {file.missingExpectedSheets.length > 0 && (
                  <ToastBanner
                    type="warn"
                    message={`تنبيه شيتات ناقصة: لم يتم العثور على الشيتات التالية في هذا الملف: ${file.missingExpectedSheets.join('، ')}`}
                  />
                )}

                {file.unknownColumns.length > 0 && (
                  <ToastBanner
                    type="info"
                    message={`أعمدة غير معروفة محفوظة باسمها الأصلي (دون تخمين): ${file.unknownColumns.join(' | ')}`}
                  />
                )}

                {/* Sheet diagnostics & column integrity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      تشخيص الشيتات ومطابقة الأعمدة (Column Integrity)
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedSheetDiagByFile((prev) => ({
                          ...prev,
                          [file.fileHash]: !prev[file.fileHash],
                        }))
                      }
                    >
                      {expandedSheetDiagByFile[file.fileHash]
                        ? 'إخفاء تفاصيل الأعمدة'
                        : 'عرض الأعمدة المكتشفة والمفقودة'}
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-right font-semibold">الشيت</th>
                          <th className="px-3 py-2 text-center font-semibold">صالح</th>
                          <th className="px-3 py-2 text-center font-semibold">أعمدة متوقعة / مكتشفة</th>
                          <th className="px-3 py-2 text-center font-semibold">عناوين مكررة محذوفة</th>
                          <th className="px-3 py-2 text-center font-semibold">تضارب مكرر بالملف</th>
                          <th className="px-3 py-2 text-center font-semibold">صفوف فارغة محذوفة</th>
                          <th className="px-3 py-2 text-center font-semibold">مرفوض</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {file.sheetDiagnostics.map((sd) => {
                          const expCount = sd.expectedColumns?.length ?? 0;
                          const detCount = sd.detectedColumns?.length ?? 0;
                          const missCount = sd.missingColumns?.length ?? 0;
                          const dupConflicts = sd.withinFileDuplicateConflicts ?? 0;
                          return (
                            <tr key={sd.sheetName} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                                {sd.sheetName}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num text-emerald-700 dark:text-emerald-400">
                                {sd.validCount}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num">
                                <span className="text-slate-800 dark:text-slate-200">
                                  {detCount}/{expCount || detCount}
                                </span>
                                {missCount > 0 && (
                                  <span className="mr-1 text-amber-700 dark:text-amber-400">
                                    (ناقص {missCount})
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num text-slate-600 dark:text-slate-400">
                                {sd.duplicateHeadersSkipped}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num text-amber-700 dark:text-amber-400">
                                {dupConflicts}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num text-slate-600 dark:text-slate-400">
                                {sd.emptyRowsSkipped}
                              </td>
                              <td className="px-3 py-2 text-center font-mono-num text-red-700 dark:text-red-400">
                                {sd.rejectedCount}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {expandedSheetDiagByFile[file.fileHash] && (
                    <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 text-xs">
                      {file.sheetDiagnostics.map((sd) => (
                        <div key={`col_${sd.sheetName}`} className="space-y-1 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0 dark:border-slate-800">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{sd.sheetName}</div>
                          {sd.detectedColumns && sd.detectedColumns.length > 0 && (
                            <div className="text-slate-600 dark:text-slate-300">
                              <span className="font-semibold">الأعمدة المكتشفة ({sd.detectedColumns.length}): </span>
                              <span className="font-mono-num">{sd.detectedColumns.join(' · ')}</span>
                            </div>
                          )}
                          {sd.missingColumns && sd.missingColumns.length > 0 && (
                            <div className="text-amber-800 dark:text-amber-300">
                              <span className="font-semibold">أعمدة متوقعة غير موجودة في هذا الملف ({sd.missingColumns.length}): </span>
                              <span className="font-mono-num">{sd.missingColumns.join(' · ')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {file.rejectedSample.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-3.5 space-y-2.5 dark:border-red-800/50 dark:bg-red-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-red-800 dark:text-red-300">
                        عينة من السجلات المرفوضة وسبب الرفض ({file.rejectedSample.length} سجل معروض من أصل {file.rejectedCount}):
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => downloadRejectedCsv(file)}
                          icon={<Download className="h-3.5 w-3.5" />}
                        >
                          تصدير المرفوضات (CSV)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={exportingRejectedHash === file.fileHash}
                          disabled={exportingRejectedHash === file.fileHash}
                          onClick={() => handleExportRejectedExcel(file)}
                          icon={<Download className="h-3.5 w-3.5" />}
                        >
                          {exportingRejectedHash === file.fileHash
                            ? 'جاري التصدير...'
                            : 'تصدير المرفوضات (Excel)'}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-red-200/80 bg-white/85 px-3 py-2 text-[11px] text-red-900 dark:border-red-800/40 dark:bg-slate-900/70 dark:text-red-200">
                      إرشاد التصحيح: صدّر ملف المرفوضات وصحّح العمود المذكور (مثل التاريخ أو معرف المندوب) ثم أعد رفع الملف؛ السجلات الصالحة المخزنة سابقًا سيتم تجاهلها تلقائيًا بفضل نظام Idempotency.
                    </div>
                    <div className="max-h-40 overflow-y-auto erp-scroll space-y-1 text-xs text-red-900 dark:text-red-200">
                      {file.rejectedSample.map((rej, idx) => (
                        <div key={idx} className="font-mono-num">
                          [{rej.sheetName} · صف {rej.rowNumber}] معرف: {rej.riderIdRaw || '(فارغ)'}
                          {rej.columnName ? ` · العمود: ${rej.columnName}` : ''}
                          {rej.rawValue ? ` (القيمة: ${rej.rawValue})` : ''} — {rej.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {file.previewRows.length > 0 && (() => {
                  const previewSheets = Array.from(new Set(file.previewRows.map((p) => p.sheetName)));
                  const selectedSheetTab = previewSheetTabByFile[file.fileHash] || 'all';
                  const visiblePreview =
                    selectedSheetTab === 'all'
                      ? file.previewRows.slice(0, 20)
                      : file.previewRows.filter((p) => p.sheetName === selectedSheetTab).slice(0, 20);
                  return (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          معاينة الصفوف قبل الحفظ ({visiblePreview.length} من {file.previewRows.length})
                        </span>
                        {previewSheets.length > 1 && (
                          <Tabs
                            variant="segmented"
                            activeKey={selectedSheetTab}
                            onChange={(sn) =>
                              setPreviewSheetTabByFile((prev) => ({ ...prev, [file.fileHash]: sn }))
                            }
                            items={[
                              { key: 'all', label: 'الكل' },
                              ...previewSheets.map((sn) => ({ key: sn, label: sn })),
                            ]}
                          />
                        )}
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                            <tr>
                              <th className="px-3 py-2 text-right font-semibold">الشيت</th>
                              <th className="px-3 py-2 text-right font-semibold">معرف المندوب</th>
                              <th className="px-3 py-2 text-right font-semibold">التاريخ / الفترة</th>
                              <th className="px-3 py-2 text-right font-semibold">ملخص السجل</th>
                              <th className="px-3 py-2 text-center font-semibold">الحالة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {visiblePreview.map((pr) => (
                              <tr key={pr.recordKey} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                  {pr.sheetName}
                                </td>
                                <td className="px-3 py-2 font-mono-num font-semibold text-slate-900 dark:text-white">
                                  {pr.riderId}
                                </td>
                                <td className="px-3 py-2 font-mono-num text-slate-700 dark:text-slate-300">
                                  {pr.dateOrPeriod}
                                </td>
                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                  {pr.summaryText}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {pr.changeStatus === 'new' ? (
                                    <StatusBadge label="جديد" tone="success" />
                                  ) : pr.changeStatus === 'update' ? (
                                    <StatusBadge label="تحديث" tone="warning" />
                                  ) : (
                                    <StatusBadge label="مكرر" tone="neutral" />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </Card>
      )}

      {/* Import History */}
      <div className="space-y-3">
        <SectionHeader
          title={
            lockedPlatform === 'hungerstation'
              ? 'سجل عمليات استيراد HungerStation'
              : lockedPlatform === 'keeta'
                ? 'سجل عمليات استيراد Keeta'
                : 'سجل عمليات الاستيراد السابقة'
          }
        />
        <DataTable
          rows={scopedBatches}
          columns={batchCols}
          rowKey={(r) => r.batchId}
          searchPlaceholder="ابحث باسم الملف أو البريد..."
          searchText={(r) => `${r.fileName} ${r.platform} ${r.importedByEmail || ''}`}
          emptyTitle="لا توجد عمليات استيراد مسجلة بعد"
          emptySubtitle={
            lockedPlatform === 'hungerstation'
              ? 'ابدأ برفع ملف HungerStation أعلاه لبناء السجل التاريخي.'
              : lockedPlatform === 'keeta'
                ? 'ابدأ برفع ملف Keeta أعلاه لبناء السجل التاريخي.'
                : 'ابدأ برفع ملف HungerStation أو Keeta أعلاه لبناء السجل التاريخي.'
          }
        />
      </div>
    </div>
  );
}
