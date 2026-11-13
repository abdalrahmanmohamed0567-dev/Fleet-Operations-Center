import { BookOpen, Building2, Plus, Save, Shield, Trash2, UserPlus } from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { KPI_DEFINITIONS } from '../lib/smartAnalytics';
import type { AuditLog, OperationalSettings, UserProfile, UserRole } from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';

export function SystemSettingsView({
  settings,
  auditLogs,
  currentUser,
  allowedUids,
  onRefresh,
}: {
  settings: OperationalSettings;
  auditLogs: AuditLog[];
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}) {
  const canEdit =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager';

  const [form, setForm] = useState({
    minDailyWorkingHours: settings.minDailyWorkingHours,
    minDailyOrders: settings.minDailyOrders,
    maxOverdueRatePct: settings.maxOverdueRatePct,
    maxCancellationRatePct: settings.maxCancellationRatePct,
    minAcceptanceRatePct: settings.minAcceptanceRatePct,
    minCompletionRatePct: settings.minCompletionRatePct,
    minOnTimeRatePct: settings.minOnTimeRatePct,
    minAttendanceRatePct: settings.minAttendanceRatePct,
    minFacialPassRatePct: settings.minFacialPassRatePct,
    minWalletBalance: settings.minWalletBalance,
    minDeliveryQualityScore: settings.minDeliveryQualityScore,
    errorRepeatRiderThreshold: settings.errorRepeatRiderThreshold ?? 2,
    errorSpikeDailyThreshold: settings.errorSpikeDailyThreshold ?? 5,
    errorSpikeMultiplierPct: settings.errorSpikeMultiplierPct ?? 150,
    errorSpreadRidersThreshold: settings.errorSpreadRidersThreshold ?? 5,
    errorBranchConcentrationPct: settings.errorBranchConcentrationPct ?? 40,
    alertOnNewErrorCode: settings.alertOnNewErrorCode ?? true,
    scoreWeightProductivity: settings.scoreWeightProductivity ?? 25,
    scoreWeightHours: settings.scoreWeightHours ?? 15,
    scoreWeightCommitment: settings.scoreWeightCommitment ?? 20,
    scoreWeightQuality: settings.scoreWeightQuality ?? 20,
    scoreWeightAcceptance: settings.scoreWeightAcceptance ?? 10,
    scoreWeightCancellation: settings.scoreWeightCancellation ?? 10,
    minActiveOrdersPerDay: settings.minActiveOrdersPerDay ?? 1,
    minActiveHoursPerDay: settings.minActiveHoursPerDay ?? 1,
    caseOverdueDays: settings.caseOverdueDays ?? 3,
    importMaxFiles: settings.importMaxFiles ?? 10,
    importAllowUpdates: settings.importAllowUpdates ?? true,
    importStrictDates: settings.importStrictDates ?? true,
  });

  const [branches, setBranches] = useState<string[]>(
    Array.isArray(settings.configuredBranches) ? settings.configuredBranches : []
  );
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const weightsSum =
    Number(form.scoreWeightProductivity || 0) +
    Number(form.scoreWeightHours || 0) +
    Number(form.scoreWeightCommitment || 0) +
    Number(form.scoreWeightQuality || 0) +
    Number(form.scoreWeightAcceptance || 0) +
    Number(form.scoreWeightCancellation || 0);

  const handleAddBranch = () => {
    const clean = newBranch.trim();
    if (!clean || !canEdit) return;
    if (branches.includes(clean)) {
      setMsg('هذا الفرع مسجل بالفعل.');
      return;
    }
    if (branches.length >= 30) {
      setMsg('الحد الأقصى للفروع المعتمدة هو 30 فرعًا.');
      return;
    }
    setBranches((prev) => [...prev, clean]);
    setNewBranch('');
    setMsg(null);
  };

  const handleRemoveBranch = (branchName: string) => {
    if (!canEdit) return;
    setBranches((prev) => prev.filter((b) => b !== branchName));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      const clampedMaxFiles = Math.min(10, Math.max(1, Math.round(form.importMaxFiles || 10)));
      const cleanBranches = branches.map((b) => b.trim()).filter(Boolean).slice(0, 30);

      await setDoc(
        doc(db, 'operationalSettings', 'default'),
        {
          settingsId: 'default',
          ...form,
          importMaxFiles: clampedMaxFiles,
          configuredBranches: cleanBranches,
          createdByUid: settings.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          updatedByEmail: currentUser.email,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'SETTINGS_UPDATED',
        targetCollection: 'operationalSettings',
        targetId: 'default',
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `تحديث الإعدادات المؤسسية: ساعات=${form.minDailyWorkingHours} | طلبات=${form.minDailyOrders} | مجموع أوزان التقييم=${weightsSum}% | فروع=${cleanBranches.length} | حد الاستيراد=${clampedMaxFiles}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setMsg('تم حفظ الإعدادات التشغيلية وأوزان التقييم وسياسات النظام بنجاح.');
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'operationalSettings/default');
      } catch (wrapped) {
        setMsg(wrapped instanceof Error ? wrapped.message : 'فشل حفظ الإعدادات.');
      }
    } finally {
      setBusy(false);
    }
  };

  const logCols: TableColumn<AuditLog>[] = [
    {
      key: 'action',
      header: 'الإجراء',
      sortValue: (r) => r.action,
      render: (r) => (
        <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
          {r.action}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'الهدف',
      render: (r) => (
        <span className="font-mono-num text-xs text-slate-700 dark:text-slate-300">
          {r.targetCollection}/{r.targetId}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'المستخدم',
      render: (r) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">{r.actorEmail}</span>
      ),
    },
    {
      key: 'details',
      header: 'التفاصيل',
      render: (r) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">{r.details}</span>
      ),
    },
  ];

  type NumericSettingKey = Exclude<
    keyof typeof form,
    'alertOnNewErrorCode' | 'importAllowUpdates' | 'importStrictDates'
  >;

  const kpiFields: Array<{ key: NumericSettingKey; label: string; step?: string }> = [
    { key: 'minDailyWorkingHours', label: 'الحد الأدنى لساعات العمل اليومية', step: '0.5' },
    { key: 'minDailyOrders', label: 'الحد الأدنى للطلبات اليومية', step: '1' },
    { key: 'minAttendanceRatePct', label: 'الحد الأدنى لمعدل الحضور (%)', step: '1' },
    { key: 'minAcceptanceRatePct', label: 'الحد الأدنى لمعدل القبول (%)', step: '1' },
    { key: 'minCompletionRatePct', label: 'الحد الأدنى لمعدل الإنجاز (%)', step: '1' },
    { key: 'minOnTimeRatePct', label: 'الحد الأدنى للتسليم في الوقت (%)', step: '1' },
    { key: 'maxOverdueRatePct', label: 'الحد الأقصى للتأخير (%)', step: '0.5' },
    { key: 'maxCancellationRatePct', label: 'الحد الأقصى للإلغاء (%)', step: '0.5' },
    { key: 'minFacialPassRatePct', label: 'الحد الأدنى لاجتياز التحقق من الهوية (%)', step: '1' },
    { key: 'minWalletBalance', label: 'الحد الأدنى المسموح لرصيد المحفظة (ر.س)', step: '10' },
    { key: 'minDeliveryQualityScore', label: 'الحد الأدنى لتقييم جودة التسليم', step: '1' },
  ];

  const weightFields: Array<{ key: NumericSettingKey; label: string }> = [
    { key: 'scoreWeightProductivity', label: 'وزن الإنتاجية والطلبات (%)' },
    { key: 'scoreWeightHours', label: 'وزن ساعات العمل (%)' },
    { key: 'scoreWeightCommitment', label: 'وزن الالتزام والحضور (%)' },
    { key: 'scoreWeightQuality', label: 'وزن جودة التسليم والوقت (%)' },
    { key: 'scoreWeightAcceptance', label: 'وزن معدل القبول (%)' },
    { key: 'scoreWeightCancellation', label: 'وزن انضباط الإلغاءات (%)' },
  ];

  const policyFields: Array<{ key: NumericSettingKey; label: string; step?: string; min?: number }> = [
    { key: 'minActiveOrdersPerDay', label: 'الحد الأدنى للطلبات لاعتبار المندوب نشطًا', step: '1', min: 0 },
    { key: 'minActiveHoursPerDay', label: 'الحد الأدنى للساعات لاعتبار المندوب نشطًا', step: '0.5', min: 0 },
    { key: 'caseOverdueDays', label: 'مهلة إغلاق الحالات التشغيلية (أيام SLA)', step: '1', min: 1 },
  ];

  const errorFields: Array<{ key: NumericSettingKey; label: string; step?: string }> = [
    { key: 'errorRepeatRiderThreshold', label: 'حد تكرار نفس الكود للمندوب (عدد المرات)', step: '1' },
    { key: 'errorSpikeDailyThreshold', label: 'الحد الأدنى لعدّ القفزة اليومية لكود الخطأ', step: '1' },
    { key: 'errorSpikeMultiplierPct', label: 'نسبة تضاعف القفزة عن المتوسط التاريخي (%)', step: '10' },
    { key: 'errorSpreadRidersThreshold', label: 'حد انتشار الكود (عدد المندوبين المتأثرين)', step: '1' },
    { key: 'errorBranchConcentrationPct', label: 'حد تركز الكود في مدينة/فرع واحد (%)', step: '5' },
  ];

  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono-num text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-500 dark:focus:bg-slate-800';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          إعدادات النظام المؤسسية وأهداف الأداء (System Settings)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          تتحكم هذه القيم مباشرة في مركز التنبيهات، معادلة التقييم الموزون للمندوبين، طابور التدخل اليومي، وسياسات استيراد Excel.
        </p>
      </div>

      {msg && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {msg}
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-6 dark:border-slate-700 dark:bg-slate-900"
      >
        {/* 1. General KPI Thresholds */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            حدود الأداء والتشغيل العامة (KPI Thresholds)
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpiFields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {f.label}
                </label>
                <input
                  type="number"
                  step={f.step || '1'}
                  disabled={!canEdit}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 2. Scoring Weights */}
        <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                أوزان معادلة التقييم الموزون للمندوبين (Performance Scoring Weights)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                في حال غياب مؤشر في إحدى المنصتين (مثل درجة الجودة اليومية) يعاد توزيع الأوزان نسبيًا على المحاور المتاحة فقط.
              </p>
            </div>
            <div
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold font-mono-num ${
                weightsSum === 100
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300'
              }`}
            >
              مجموع الأوزان: {weightsSum}% {weightsSum !== 100 ? '(يُفضل 100% — ستُطبّع تلقائيًا)' : '✓ متوازن'}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {weightFields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {f.label}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  disabled={!canEdit}
                  value={form[f.key]}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      [f.key]: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 3. Activity Definitions & Case SLA */}
        <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            تعريفات نشاط المندوب والمهل الزمنية للحالات (Activity & Case SLA)
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {policyFields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {f.label}
                </label>
                <input
                  type="number"
                  min={f.min ?? 0}
                  step={f.step || '1'}
                  disabled={!canEdit}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 4. HungerStation Error Code Alert Thresholds */}
        <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            عتبات التنبيه الذكية لأكواد أخطاء HungerStation
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {errorFields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {f.label}
                </label>
                <input
                  type="number"
                  step={f.step || '1'}
                  disabled={!canEdit}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            ))}
            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={form.alertOnNewErrorCode}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, alertOnNewErrorCode: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 dark:border-slate-600"
                />
                <span>تفعيل التنبيه عند ظهور كود غير موثق (New / Unknown Code)</span>
              </label>
            </div>
          </div>
        </div>

        {/* 5. Configured Branches & Import Policy */}
        <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-5 lg:grid-cols-2 dark:border-slate-800">
          {/* Branches */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  الفروع المعتمدة (Configured Branches)
                </h3>
              </div>
              <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                {branches.length} / 30
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                disabled={!canEdit}
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddBranch();
                  }
                }}
                placeholder="أدخل اسم الفرع (مثال: الرياض - الشمال)..."
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                disabled={!canEdit || branches.length >= 30}
                onClick={handleAddBranch}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>إضافة</span>
              </button>
            </div>
            {branches.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <div
                    key={b}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <span>{b}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBranch(b)}
                        className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        title="حذف الفرع"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                لم يتم تقييد قائمة فروع يدوية؛ يقرأ النظام الفروع تلقائيًا من ملفات Excel المستوردة.
              </p>
            )}
          </div>

          {/* Import Policy */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              سياسات مركز الاستيراد (Import Policy)
            </h3>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                الحد الأقصى لعدد ملفات Excel في الدفعة الواحدة (1 - 10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                step="1"
                disabled={!canEdit}
                value={form.importMaxFiles}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    importMaxFiles: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className={inputCls}
              />
            </div>
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={form.importAllowUpdates}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, importAllowUpdates: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 dark:border-slate-600"
                />
                <span>السماح بتحديث السجلات عند اختلاف قيمها عن الاستيراد السابق (Checksum Update)</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={form.importStrictDates}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, importStrictDates: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 dark:border-slate-600"
                />
                <span>تفعيل التحقق الصارم من صيغ التواريخ ورفض الصفوف غير المؤرخة</span>
              </label>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <Save className="h-4 w-4" />
              <span>{busy ? 'جاري الحفظ...' : 'حفظ الإعدادات التشغيلية'}</span>
            </button>
          </div>
        )}
      </form>

      {/* KPI Definitions & Platform Parity Reference */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-700 dark:text-slate-300" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              مرجع تعريفات المؤشرات وفروقات المنصات (KPI Dictionary &amp; Governance)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              توثيق الحقول الفعلية والمعادلات المعتمدة في HungerStation وKeeta لضمان تطابق التقارير التشغيلية والمالية.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5 text-right">المؤشر</th>
                <th className="px-3 py-2.5 text-right">الحقول المصدرية الفعلية</th>
                <th className="px-3 py-2.5 text-right">المعادلة المعتمدة</th>
                <th className="px-3 py-2.5 text-right">ملاحظة الاختلاف بين المنصتين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {KPI_DEFINITIONS.map((def) => (
                <tr key={def.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {def.titleAr}
                  </td>
                  <td className="px-3 py-2.5 font-mono-num text-slate-700 dark:text-slate-300">
                    {def.exactFields}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                    {def.formulaText}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {def.platformDifferenceNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Log */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          سجل المراجعة والتدقيق (Audit Log)
        </h3>
        <DataTable
          rows={auditLogs}
          columns={logCols}
          rowKey={(r) => r.logId}
          searchPlaceholder="ابحث في سجل المراجعة..."
          searchText={(r) => `${r.action} ${r.actorEmail} ${r.details}`}
        />
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner (مالك النظام)',
  admin: 'Admin (مدير النظام)',
  operations_manager: 'Operations Manager (مدير العمليات)',
  supervisor: 'Supervisor (مشرف)',
  viewer: 'Viewer (مشاهد)',
};

export function UserManagementView({
  usersList,
  currentUser,
  allowedUids,
  onRefresh,
}: {
  usersList: UserProfile[];
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}) {
  const isAdmin = currentUser.role === 'owner' || currentUser.role === 'admin';
  const [confirmUser, setConfirmUser] = useState<{
    user: UserProfile;
    nextRole: UserRole;
    nextActive: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleUpdateRole = async () => {
    if (!confirmUser || !isAdmin) return;
    setBusy(true);
    setMsg(null);
    try {
      const target = confirmUser.user;
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await updateDoc(doc(db, 'users', target.uid), {
        role: confirmUser.nextRole,
        active: confirmUser.nextActive,
        updatedAt: serverTimestamp(),
      });
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'USER_ROLE_UPDATED',
        targetCollection: 'users',
        targetId: target.uid,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `تعديل صلاحية ${target.email} إلى ${confirmUser.nextRole} | التفعيل: ${confirmUser.nextActive ? 'مفعّل' : 'معطّل'}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setConfirmUser(null);
      setMsg(`تم تحديث صلاحيات ${target.email} بنجاح.`);
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${confirmUser.user.uid}`);
      } catch (wrapped) {
        setMsg(wrapped instanceof Error ? wrapped.message : 'فشل تحديث صلاحيات المستخدم.');
      }
    } finally {
      setBusy(false);
    }
  };

  const cols: TableColumn<UserProfile>[] = [
    {
      key: 'name',
      header: 'الاسم',
      sortValue: (r) => r.displayName,
      render: (r) => (
        <span className="font-semibold text-slate-900 dark:text-white">{r.displayName}</span>
      ),
    },
    {
      key: 'email',
      header: 'البريد الإلكتروني',
      sortValue: (r) => r.email,
      render: (r) => (
        <span className="font-mono-num text-xs text-slate-700 dark:text-slate-300">{r.email}</span>
      ),
    },
    {
      key: 'role',
      header: 'الدور الوظيفي',
      sortValue: (r) => r.role,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-200">
          {ROLE_LABELS[r.role] || r.role}
        </span>
      ),
    },
    {
      key: 'active',
      header: 'حالة الحساب',
      align: 'center',
      render: (r) => (
        <span
          className={`font-semibold ${
            r.active
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-red-700 dark:text-red-400'
          }`}
        >
          {r.active ? 'مفعّل' : 'معطّل / بانتظار التفعيل'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'إدارة الصلاحية',
      render: (r) => {
        const isBootOwner = r.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
        if (!isAdmin || isBootOwner) {
          return (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {isBootOwner ? 'مالك رئيسي محمي' : 'للعرض فقط'}
            </span>
          );
        }
        return (
          <div className="flex items-center gap-2">
            <select
              value={r.role}
              onChange={(e) =>
                setConfirmUser({
                  user: r,
                  nextRole: e.target.value as UserRole,
                  nextActive: r.active,
                })
              }
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="admin">Admin</option>
              <option value="operations_manager">Operations Manager</option>
              <option value="supervisor">Supervisor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="button"
              onClick={() =>
                setConfirmUser({ user: r, nextRole: r.role, nextActive: !r.active })
              }
              className={`rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                r.active
                  ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/60'
              }`}
            >
              {r.active ? 'تعطيل' : 'تفعيل'}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            إدارة المستخدمين والصلاحيات (RBAC)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            الأدوار المدعومة: Owner · Admin · Operations Manager · Supervisor · Viewer. أي مستخدم جديد يسجل بحساب Google يظهر هنا للتفعيل وتحديد دوره.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Shield className="h-4 w-4 text-slate-700 dark:text-slate-300" />
          <span>محمي بقواعد Firestore Zero-Trust</span>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {msg}
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
          تعديل صلاحيات المستخدمين متاح فقط لدور Owner و Admin.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <UserPlus className="h-4 w-4 text-slate-500 shrink-0 dark:text-slate-400" />
        <span>
          لإضافة مشرف أو مشاهد جديد، اطلب منه تسجيل الدخول عبر زر Google Sign-In وسيظهر حسابه فورًا في الجدول أدناه لتفعيله وتعيين دوره.
        </span>
      </div>

      <DataTable
        rows={usersList}
        columns={cols}
        rowKey={(r) => r.uid}
        searchPlaceholder="ابحث بالاسم أو البريد أو الدور..."
        searchText={(r) => `${r.displayName} ${r.email} ${r.role}`}
      />

      <ConfirmModal
        open={Boolean(confirmUser)}
        title="تأكيد تعديل صلاحية المستخدم"
        description={
          confirmUser
            ? `هل تريد تحديث صلاحية ${confirmUser.user.email} إلى "${ROLE_LABELS[confirmUser.nextRole]}" وحالة التفعيل إلى "${confirmUser.nextActive ? 'مفعّل' : 'معطّل'}"؟`
            : ''
        }
        busy={busy}
        onConfirm={handleUpdateRole}
        onCancel={() => setConfirmUser(null)}
      />
    </div>
  );
}
