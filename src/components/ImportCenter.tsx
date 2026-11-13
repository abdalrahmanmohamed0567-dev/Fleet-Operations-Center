import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  commitExcelInBrowser,
  exportExcelInBrowser,
  hasClientPreview,
  previewExcelInBrowser,
} from '../lib/clientExcelFallback';
import { listDriveExcelFiles, type DriveFileItem } from '../lib/driveClient';
import { auth, getDriveAccessToken, refreshDriveTokenWithPopup } from '../lib/firebase';
import { ApiHtmlFallbackError, safeParseJsonResponse } from '../lib/safeFetch';
import type {
  ImportBatch,
  ImportPreviewResult,
  OperationalSettings,
  UserProfile,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';

interface ImportCenterProps {
  currentUser: UserProfile;
  importBatches: ImportBatch[];
  settings?: OperationalSettings;
  onCommitted: () => Promise<void>;
}

function downloadRejectedCsv(file: ImportPreviewResult) {
  const headers = ['الشيت', 'رقم الصف', 'معرف المندوب الخام', 'سبب الرفض', 'اسم الملف'];
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
      [r.sheetName, r.rowNumber, r.riderIdRaw || '', r.reason, file.fileName].map(esc).join(',')
    ),
  ];
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const baseName = file.fileName.replace(/\.xlsx?$/i, '');
  a.href = url;
  a.download = `rejected_${baseName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportCenter({
  currentUser,
  importBatches,
  settings,
  onCommitted,
}: ImportCenterProps) {
  const role = currentUser.role;
  const canImport = role === 'owner' || role === 'admin' || role === 'operations_manager';

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

  const batchByHash = useMemo(() => {
    const map = new Map<string, ImportBatch>();
    for (const b of importBatches) {
      if (b.fileHash && !map.has(b.fileHash)) {
        map.set(b.fileHash, b);
      }
    }
    return map;
  }, [importBatches]);

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
      setErrorMsg('يرجى إضافة ملف HungerStation أو Keeta من جهازك أو من Google Drive أولاً.');
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
      const baseName = file.fileName.replace(/\.xlsx?$/i, '');
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
          { key: 'reason', header: 'سبب الرفض', width: 48 },
        ],
        rows: file.rejectedSample.map((r) => ({
          sheetName: r.sheetName,
          rowNumber: r.rowNumber,
          riderIdRaw: r.riderIdRaw || '(فارغ)',
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
        <span className="font-medium text-slate-800 dark:text-slate-200">
          {r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
        </span>
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
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {r.importedByEmail || '-'}
        </span>
      ),
    },
  ];

  const totalStagedCount = stagedFiles.length + selectedDriveIds.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            مركز استيراد تقارير Excel متعدد الملفات
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            كشف تلقائي للمنصة من الشيتات والأعمدة · تنظيف العناوين المكررة والصفوف الفارغة · استيراد Idempotent يمنع التكرار
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <span>
            الحد الأقصى للدفعة: <strong className="font-mono-num text-slate-900 dark:text-white">{maxFiles} ملفات</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>
            تحديث السجلات المتغيرة: <strong className="text-slate-900 dark:text-white">{allowUpdates ? 'مسموح' : 'جديد فقط'}</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>
            تدقيق التواريخ: <strong className="text-slate-900 dark:text-white">{strictDates ? 'صارم' : 'مرن'}</strong>
          </span>
        </div>
      </div>

      {!canImport && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
          صلاحياتك الحالية ({role}) مخصصة للعرض فقط. الاستيراد متاح لمالك النظام، المدير، ومدير العمليات.
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-200">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Multi-File Local Uploads */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              رفع ملفات Excel من الجهاز (دفعة متعددة)
            </h3>
            <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
              {totalStagedCount} / {maxFiles} ملفات محددة
            </span>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center transition-colors hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60 dark:hover:border-slate-500 dark:hover:bg-slate-800">
            <FileSpreadsheet className="h-7 w-7 text-slate-700 dark:text-slate-300" />
            <span className="mt-2 text-xs font-bold text-slate-900 dark:text-white">
              اختر ملف أو عدة ملفات HungerStation / Keeta (.xlsx)
            </span>
            <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              يتم التعرف على المنصة تلقائيًا لكل ملف ويمكنك إرفاق حتى {maxFiles} ملفات في العملية الواحدة
            </span>
            <input
              type="file"
              multiple
              accept=".xlsx,.xls"
              disabled={!canImport}
              onChange={(e) => {
                handleAddLocalFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          {stagedFiles.length > 0 ? (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
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
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              الشيتات المدعومة تلقائيًا: Hunger-Daily، Riders Wallet، Riders Distance، Delivery Quality Segmentation، Dashboard، VDA، RankPlanProcess، Facial recognition.
            </div>
          )}
        </div>

        {/* Google Drive Integration */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                استيراد مباشر من Google Drive
              </h3>
            </div>
            <button
              type="button"
              disabled={!canImport || driveLoading}
              onClick={handleLoadDriveFiles}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>{driveLoading ? 'جاري الجلب...' : 'استعراض ملفات Drive'}</span>
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={driveQuery}
              onChange={(e) => setDriveQuery(e.target.value)}
              placeholder="بحث باسم الملف في Google Drive..."
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:bg-slate-800"
            />
          </div>

          {driveFiles.length > 0 ? (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
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
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              اضغط &quot;استعراض ملفات Drive&quot; لعرض ملفات Excel (.xlsx) المخزنة في حسابك.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        {(stagedFiles.length > 0 || selectedDriveIds.length > 0) ? (
          <button
            type="button"
            onClick={() => {
              setStagedFiles([]);
              setSelectedDriveIds([]);
              setPreviewData(null);
            }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            مسح قائمة الملفات المحددة
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          disabled={!canImport || previewLoading || totalStagedCount === 0}
          onClick={handlePreview}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {previewLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span>
            {previewLoading
              ? 'جاري تحليل وفحص الملفات...'
              : `تحليل ومعاينة البيانات (${totalStagedCount}) قبل الحفظ`}
          </span>
        </button>
      </div>

      {/* Preview Diagnostics */}
      {previewData && (
        <div className="rounded-xl border border-slate-300 bg-white p-6 space-y-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                نتائج المعاينة والتحقق قبل الحفظ ({previewData.files.length} ملف)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                راجع أعداد السجلات الجديدة والمحدثة والمكررة والمرفوضة وبصمة SHA-256 قبل تأكيد الإدراج في Cloud Firestore
              </p>
            </div>
            <button
              type="button"
              disabled={commitLoading}
              onClick={handleCommit}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {commitLoading ? 'جاري الحفظ وتحديث الملخصات...' : 'تأكيد الاستيراد والحفظ الدائم'}
              </span>
            </button>
          </div>

          {previewData.files.map((file) => {
            const duplicateHashBatch = batchByHash.get(file.fileHash);
            return (
              <div
                key={file.fileHash + file.fileName}
                className="space-y-4 border-b border-slate-200 pb-5 last:border-b-0 last:pb-0 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {file.fileName} · المنصة المكتشفة:{' '}
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {file.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 font-mono-num dark:text-slate-400">
                      الفترة: {file.detectedPeriodStart || 'غير محدد'} →{' '}
                      {file.detectedPeriodEnd || 'غير محدد'} · الشيتات:{' '}
                      {file.sheetsDetected.join('، ')} · البصمة: {file.fileHash.slice(0, 12)}
                    </div>
                  </div>
                </div>

                {duplicateHashBatch && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                    <div>
                      <span className="font-bold">تحذير تكرار ملف: </span>
                      تم استيراد ملف مطابق تمامًا مسبقًا بنفس البصمة الرقمية (SHA-256) باسم &quot;
                      {duplicateHashBatch.fileName}&quot; للفترة (
                      {duplicateHashBatch.detectedPeriodStart || '-'} →{' '}
                      {duplicateHashBatch.detectedPeriodEnd || '-'}). سيتجاهل النظام السجلات المكررة تلقائيًا عند التأكيد.
                    </div>
                  </div>
                )}

                {!allowUpdates && file.updatedCount > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      ملاحظة سياسة الاستيراد: الإعداد الحالي يعطل تعديل السجلات السابقة؛ يوجد {file.updatedCount} سجل متغير مقارنة بالبيانات المخزنة.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      إجمالي السجلات الصالحة
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-slate-900 dark:text-white">
                      {file.totalValid}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/50 dark:bg-emerald-950/30">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400">سجلات جديدة</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-emerald-800 dark:text-emerald-300">
                      {file.newCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      تحديث بيانات متغيرة
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-amber-800 dark:text-amber-300">
                      {file.updatedCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      مكرر مطابق (يُتجاهل)
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-slate-700 dark:text-slate-300">
                      {file.duplicateCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/30">
                    <div className="text-xs text-red-700 dark:text-red-400">سجلات مرفوضة</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-red-800 dark:text-red-300">
                      {file.rejectedCount}
                    </div>
                  </div>
                </div>

                {file.missingExpectedSheets.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
                    تنبيه شيتات ناقصة: لم يتم العثور على الشيتات التالية في هذا الملف:{' '}
                    {file.missingExpectedSheets.join('، ')}
                  </div>
                )}

                {file.unknownColumns.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    أعمدة غير معروفة محفوظة باسمها الأصلي (دون تخمين):{' '}
                    <span className="font-mono-num">{file.unknownColumns.join(' | ')}</span>
                  </div>
                )}

                {/* Sheet diagnostics */}
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2 text-right">الشيت</th>
                        <th className="px-3 py-2 text-center">صالح</th>
                        <th className="px-3 py-2 text-center">عناوين مكررة محذوفة</th>
                        <th className="px-3 py-2 text-center">صفوف فارغة محذوفة</th>
                        <th className="px-3 py-2 text-center">مرفوض</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {file.sheetDiagnostics.map((sd) => (
                        <tr key={sd.sheetName}>
                          <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                            {sd.sheetName}
                          </td>
                          <td className="px-3 py-2 text-center font-mono-num text-emerald-700 dark:text-emerald-400">
                            {sd.validCount}
                          </td>
                          <td className="px-3 py-2 text-center font-mono-num text-slate-600 dark:text-slate-400">
                            {sd.duplicateHeadersSkipped}
                          </td>
                          <td className="px-3 py-2 text-center font-mono-num text-slate-600 dark:text-slate-400">
                            {sd.emptyRowsSkipped}
                          </td>
                          <td className="px-3 py-2 text-center font-mono-num text-red-700 dark:text-red-400">
                            {sd.rejectedCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {file.rejectedSample.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-800/50 dark:bg-red-950/20">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-red-800 dark:text-red-300">
                        عينة من السجلات المرفوضة وسبب الرفض ({file.rejectedSample.length} سجل معروض):
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => downloadRejectedCsv(file)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>تصدير المرفوضات (CSV)</span>
                        </button>
                        <button
                          type="button"
                          disabled={exportingRejectedHash === file.fileHash}
                          onClick={() => handleExportRejectedExcel(file)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>
                            {exportingRejectedHash === file.fileHash
                              ? 'جاري التصدير...'
                              : 'تصدير المرفوضات (Excel)'}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 text-xs text-red-900 dark:text-red-200">
                      {file.rejectedSample.map((rej, idx) => (
                        <div key={idx} className="font-mono-num">
                          [{rej.sheetName} · صف {rej.rowNumber}] معرف: {rej.riderIdRaw || '(فارغ)'} —{' '}
                          {rej.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {file.previewRows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2 text-right">الشيت</th>
                          <th className="px-3 py-2 text-right">معرف المندوب</th>
                          <th className="px-3 py-2 text-right">التاريخ / الفترة</th>
                          <th className="px-3 py-2 text-right">ملخص السجل</th>
                          <th className="px-3 py-2 text-center">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {file.previewRows.slice(0, 12).map((pr) => (
                          <tr key={pr.recordKey}>
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
                            <td className="px-3 py-2 text-center font-semibold">
                              {pr.changeStatus === 'new' ? (
                                <span className="text-emerald-700 dark:text-emerald-400">جديد</span>
                              ) : pr.changeStatus === 'update' ? (
                                <span className="text-amber-700 dark:text-amber-400">تحديث</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">مكرر</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Import History */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          سجل عمليات الاستيراد السابقة
        </h3>
        <DataTable
          rows={importBatches}
          columns={batchCols}
          rowKey={(r) => r.batchId}
          searchPlaceholder="ابحث باسم الملف أو البريد..."
          searchText={(r) => `${r.fileName} ${r.platform} ${r.importedByEmail || ''}`}
          emptyTitle="لا توجد عمليات استيراد مسجلة بعد"
          emptySubtitle="ابدأ برفع ملف HungerStation أو Keeta أعلاه لبناء السجل التاريخي."
        />
      </div>
    </div>
  );
}
