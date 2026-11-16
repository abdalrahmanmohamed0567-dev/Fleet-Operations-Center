import { BookOpen, Building2, Car, FolderLock, Globe, Plus, Save, Shield, Trash2, UserPlus } from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from '../lib/erpDb';
import { useMemo, useState } from 'react';
import { writeErpAuditLog } from '../lib/erpHelpers';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  DEFAULT_DOCUMENT_TYPES,
  getUserAllowedPlatforms,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { KPI_DEFINITIONS } from '../lib/smartAnalytics';
import { getMergedPlatformCatalog, hasPermission, isKeetaActive, isSuperAdminUser } from '../shared/rbacCore';
import type {
  AuditLog,
  DocumentTypeConfig,
  OperationalSettings,
  Platform,
  PlatformCatalogEntry,
  RoleTemplate,
  UserProfile,
  UserRole,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import {
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  StatusBadge,
  ToastBanner,
} from './ui/EnterpriseUI';

export function SystemSettingsView({
  settings,
  auditLogs,
  currentUser,
  allowedUids,
  platformCatalog = [],
  documentTypes = [],
  roleTemplates = [],
  onOpenRbac,
  onRefresh,
}: {
  settings: OperationalSettings;
  auditLogs: AuditLog[];
  currentUser: UserProfile;
  allowedUids: string[];
  platformCatalog?: PlatformCatalogEntry[];
  documentTypes?: DocumentTypeConfig[];
  roleTemplates?: RoleTemplate[];
  onOpenRbac?: () => void;
  onRefresh: () => Promise<void>;
}) {
  const canEdit =
    hasPermission(currentUser, roleTemplates, 'settings', 'edit') ||
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager';
  const canManagePlatforms =
    hasPermission(currentUser, roleTemplates, 'platforms', 'edit') || isSuperAdminUser(currentUser);

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
  const [vehicleTypes, setVehicleTypes] = useState<string[]>(
    Array.isArray(settings.customVehicleTypes) && settings.customVehicleTypes.length > 0
      ? settings.customVehicleTypes
      : ['سيارة سيدان', 'سيارة فان', 'دراجة نارية', 'بيك أب']
  );
  const [newVehicleType, setNewVehicleType] = useState('');
  const [expiryDaysStr, setExpiryDaysStr] = useState<string>(
    Array.isArray(settings.expiryAlertDays) && settings.expiryAlertDays.length > 0
      ? settings.expiryAlertDays.join(', ')
      : '90, 60, 30, 7, 0'
  );

  // Platform Catalog & Document Types Manager state
  const [newPlatName, setNewPlatName] = useState('');
  const [newPlatNameAr, setNewPlatNameAr] = useState('');
  const [newDocNameAr, setNewDocNameAr] = useState('');
  const [newDocScope, setNewDocScope] = useState<'rider' | 'vehicle' | 'handover'>('rider');
  const [newDocExpiry, setNewDocExpiry] = useState(true);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  const mergedCatalog = useMemo(
    () => getMergedPlatformCatalog(platformCatalog, settings),
    [platformCatalog, settings]
  );
  const keetaActive = isKeetaActive(settings, platformCatalog);

  const mergedDocTypes = useMemo(() => {
    const byId = new Map<string, DocumentTypeConfig>();
    for (const def of DEFAULT_DOCUMENT_TYPES) {
      byId.set(def.typeId, { ...def, createdByUid: '', allowedUids: [] });
    }
    for (const dt of documentTypes) {
      byId.set(dt.typeId, dt);
    }
    return Array.from(byId.values());
  }, [documentTypes]);

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
      setMsg({ type: 'warn', text: 'هذا الفرع مسجل بالفعل.' });
      return;
    }
    if (branches.length >= 30) {
      setMsg({ type: 'warn', text: 'الحد الأقصى للفروع المعتمدة هو 30 فرعًا.' });
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

  const handleAddVehicleType = () => {
    const clean = newVehicleType.trim();
    if (!clean || !canEdit || vehicleTypes.includes(clean)) return;
    setVehicleTypes((prev) => [...prev, clean].slice(0, 30));
    setNewVehicleType('');
  };

  const handleRemoveVehicleType = (vt: string) => {
    if (!canEdit) return;
    setVehicleTypes((prev) => prev.filter((x) => x !== vt));
  };

  const handleToggleKeetaFlag = async (enable: boolean) => {
    if (!canManagePlatforms) return;
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(
        doc(db, 'operationalSettings', 'default'),
        {
          settingsId: 'default',
          keetaEnabled: enable,
          keetaHidden: !enable,
          createdByUid: settings.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          updatedByEmail: currentUser.email,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        doc(db, 'platformCatalog', 'keeta'),
        {
          platformId: 'keeta',
          name: 'Keeta',
          nameAr: 'كيتا',
          enabled: enable,
          hiddenFromUi: !enable,
          operationalImportEnabled: enable,
          supportsExcelImport: true,
          isBuiltIn: true,
          description: enable
            ? 'مفعّلة تشغيليًا بموافقة الإدارة.'
            : 'مخفية مؤقتًا بأمر الإدارة مع الاحتفاظ الكامل بالبيانات التاريخية ومنطق التحليل.',
          createdByUid: currentUser.uid,
          allowedUids: safeAllowed,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeErpAuditLog({
        action: enable ? 'PLATFORM_KEETA_ENABLED' : 'PLATFORM_KEETA_SUPPRESSED',
        targetCollection: 'platformCatalog',
        targetId: 'keeta',
        entityType: 'platform',
        details: enable ? 'إعادة تفعيل منصة Keeta في النظام' : 'إخفاء وتعطيل منصة Keeta مؤقتًا عبر Feature Flag',
        oldValue: { keetaActive },
        newValue: { keetaEnabled: enable, keetaHidden: !enable },
        user: currentUser,
        allowedUids: safeAllowed,
      });
      setMsg({
        type: 'ok',
        text: enable ? 'تم تفعيل وإظهار منصة Keeta بنجاح.' : 'تم إخفاء وتعطيل منصة Keeta مؤقتًا مع حفظ كافة البيانات التاريخية.',
      });
      await onRefresh();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل تحديث حالة منصة Keeta.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePlatformEntry = async (entry: PlatformCatalogEntry) => {
    if (!canManagePlatforms) return;
    if (entry.platformId === 'keeta') {
      await handleToggleKeetaFlag(!keetaActive);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      const nextEnabled = !entry.enabled;
      await setDoc(
        doc(db, 'platformCatalog', entry.platformId),
        {
          ...entry,
          enabled: nextEnabled,
          hiddenFromUi: !nextEnabled,
          createdByUid: entry.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeErpAuditLog({
        action: 'PLATFORM_TOGGLED',
        targetCollection: 'platformCatalog',
        targetId: entry.platformId,
        entityType: 'platform',
        details: `${nextEnabled ? 'تفعيل' : 'تعطيل'} منصة ${entry.nameAr} (${entry.platformId})`,
        user: currentUser,
        allowedUids: safeAllowed,
      });
      await onRefresh();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل تحديث المنصة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAddCustomPlatform = async () => {
    if (!canManagePlatforms || !newPlatName.trim()) return;
    const pid = newPlatName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    if (!pid) return;
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(doc(db, 'platformCatalog', pid), {
        platformId: pid,
        name: newPlatName.trim().slice(0, 80),
        nameAr: (newPlatNameAr.trim() || newPlatName.trim()).slice(0, 80),
        enabled: true,
        hiddenFromUi: false,
        operationalImportEnabled: false,
        supportsExcelImport: false,
        isBuiltIn: false,
        description: 'منصة توصيل مضافة من إعدادات النظام.',
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeErpAuditLog({
        action: 'PLATFORM_CREATED',
        targetCollection: 'platformCatalog',
        targetId: pid,
        entityType: 'platform',
        details: `إضافة منصة جديدة: ${newPlatName.trim()}`,
        user: currentUser,
        allowedUids: safeAllowed,
      });
      setNewPlatName('');
      setNewPlatNameAr('');
      setMsg({ type: 'ok', text: 'تمت إضافة المنصة الجديدة إلى سجل التطبيقات.' });
      await onRefresh();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل إضافة المنصة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAddDocType = async () => {
    if (!canEdit || !newDocNameAr.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const typeId = `doc_${Date.now().toString(36)}`;
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(doc(db, 'documentTypes', typeId), {
        typeId,
        nameAr: newDocNameAr.trim().slice(0, 100),
        nameEn: newDocNameAr.trim().slice(0, 100),
        entityScope: newDocScope,
        requiresExpiry: newDocExpiry,
        active: true,
        isDefault: false,
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeErpAuditLog({
        action: 'DOCUMENT_TYPE_CREATED',
        targetCollection: 'documentTypes',
        targetId: typeId,
        entityType: 'documentType',
        details: `إضافة نوع مستند مخصص: ${newDocNameAr.trim()} (${newDocScope})`,
        user: currentUser,
        allowedUids: safeAllowed,
      });
      setNewDocNameAr('');
      await onRefresh();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل إضافة نوع المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDocType = async (dt: DocumentTypeConfig) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(
        doc(db, 'documentTypes', dt.typeId),
        {
          ...dt,
          active: !dt.active,
          createdByUid: dt.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await onRefresh();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل تعديل نوع المستند.' });
    } finally {
      setBusy(false);
    }
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
      const parsedDays = expiryDaysStr
        .split(/[,،\s]+/)
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
      const finalExpiryDays = parsedDays.length > 0 ? Array.from(new Set(parsedDays)).sort((a, b) => b - a) : [90, 60, 30, 7, 0];

      await setDoc(
        doc(db, 'operationalSettings', 'default'),
        {
          settingsId: 'default',
          ...form,
          importMaxFiles: clampedMaxFiles,
          configuredBranches: cleanBranches,
          customVehicleTypes: vehicleTypes,
          expiryAlertDays: finalExpiryDays,
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
        details: `تحديث الإعدادات المؤسسية: ساعات=${form.minDailyWorkingHours} | طلبات=${form.minDailyOrders} | تنبيهات الانتهاء=${finalExpiryDays.join('/')} | فروع=${cleanBranches.length}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setMsg({ type: 'ok', text: 'تم حفظ الإعدادات التشغيلية، نوافذ التنبيه، وأنواع المركبات بنجاح.' });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'operationalSettings/default');
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'فشل حفظ الإعدادات.' });
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
        <span className="font-mono-num text-xs text-slate-700 dark:text-slate-300">{r.actorEmail}</span>
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="إعدادات النظام المؤسسية وأهداف الأداء (System Settings)"
        subtitle="تتحكم هذه القيم مباشرة في مركز التنبيهات، معادلة التقييم الموزون للمندوبين، طابور التدخل اليومي، وسياسات استيراد Excel."
      />

      {msg && (
        <ToastBanner type={msg.type} message={msg.text} onDismiss={() => setMsg(null)} />
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <Card padding="lg" className="space-y-6">
          {/* 1. General KPI Thresholds */}
          <div className="space-y-3">
            <SectionHeader title="حدود الأداء والتشغيل العامة (KPI Thresholds)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {kpiFields.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <Input
                    type="number"
                    step={f.step || '1'}
                    disabled={!canEdit}
                    value={form[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                    className="font-mono-num"
                  />
                </FormField>
              ))}
            </div>
          </div>

          {/* 2. Scoring Weights */}
          <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <SectionHeader
              title="أوزان معادلة التقييم الموزون للمندوبين (Performance Scoring Weights)"
              subtitle="في حال غياب مؤشر في إحدى المنصتين (مثل درجة الجودة اليومية) يعاد توزيع الأوزان نسبيًا على المحاور المتاحة فقط."
              actions={
                <StatusBadge
                  tone={weightsSum === 100 ? 'success' : 'warning'}
                  label={`مجموع الأوزان: ${weightsSum}% ${weightsSum !== 100 ? '(يُفضل 100% — ستُطبّع تلقائيًا)' : '✓ متوازن'}`}
                  className="font-mono-num"
                />
              }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {weightFields.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <Input
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
                    className="font-mono-num"
                  />
                </FormField>
              ))}
            </div>
          </div>

          {/* 3. Activity Definitions & Case SLA */}
          <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <SectionHeader title="تعريفات نشاط المندوب والمهل الزمنية للحالات (Activity & Case SLA)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {policyFields.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <Input
                    type="number"
                    min={f.min ?? 0}
                    step={f.step || '1'}
                    disabled={!canEdit}
                    value={form[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                    className="font-mono-num"
                  />
                </FormField>
              ))}
            </div>
          </div>

          {/* 4. HungerStation Error Code Alert Thresholds */}
          <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <SectionHeader title="عتبات التنبيه الذكية لأكواد أخطاء HungerStation" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {errorFields.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <Input
                    type="number"
                    step={f.step || '1'}
                    disabled={!canEdit}
                    value={form[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                    className="font-mono-num"
                  />
                </FormField>
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
              <SectionHeader
                title="الفروع المعتمدة (Configured Branches)"
                actions={
                  <span className="inline-flex items-center gap-1 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                    <Building2 className="h-3.5 w-3.5" />
                    {branches.length} / 30
                  </span>
                }
              />
              <div className="flex gap-2">
                <Input
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
                />
                <Button
                  variant="secondary"
                  disabled={!canEdit || branches.length >= 30}
                  onClick={handleAddBranch}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  إضافة
                </Button>
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
              <SectionHeader title="سياسات مركز الاستيراد (Import Policy)" />
              <FormField label="الحد الأقصى لعدد ملفات Excel في الدفعة الواحدة (1 - 10)">
                <Input
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
                  className="font-mono-num"
                />
              </FormField>
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

          {/* 6. ERP Expiry Windows & Vehicle Types */}
          <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-5 lg:grid-cols-2 dark:border-slate-800">
            <div className="space-y-3">
              <SectionHeader
                title="أنواع المركبات المعتمدة (Vehicle Types)"
                actions={<Car className="h-4 w-4 text-slate-400" />}
              />
              <div className="flex gap-2">
                <Input
                  type="text"
                  disabled={!canEdit}
                  value={newVehicleType}
                  onChange={(e) => setNewVehicleType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddVehicleType();
                    }
                  }}
                  placeholder="إضافة نوع مركبة (مثال: فان مبرد)..."
                />
                <Button
                  variant="secondary"
                  disabled={!canEdit}
                  onClick={handleAddVehicleType}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  إضافة
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {vehicleTypes.map((vt) => (
                  <div
                    key={vt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <span>{vt}</span>
                    {canEdit && (
                      <button type="button" onClick={() => handleRemoveVehicleType(vt)} className="text-slate-400 hover:text-red-600">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <FormField
                label="نوافذ تنبيه انتهاء الإقامات والرخص والمركبات (أيام)"
                hint="أدخل الأيام مفصولة بفاصلة"
              >
                <Input
                  type="text"
                  disabled={!canEdit}
                  value={expiryDaysStr}
                  onChange={(e) => setExpiryDaysStr(e.target.value)}
                  placeholder="90, 60, 30, 7, 0"
                  className="font-mono-num"
                />
              </FormField>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                أدخل الأيام مفصولة بفاصلة لتوليد تنبيهات انتهاء الإقامات ورخص القيادة والاستمارات والتأمين والفحص الدوري.
              </p>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                disabled={busy}
                icon={<Save className="h-4 w-4" />}
              >
                {busy ? 'جاري الحفظ...' : 'حفظ الإعدادات التشغيلية'}
              </Button>
            </div>
          )}
        </Card>
      </form>

      {/* Platform Catalog & Feature Flags Manager (including Reversible Keeta Suppression) */}
      <Card padding="lg" className="space-y-4">
        <SectionHeader
          title="إدارة المنصات والخصائص (Platform Feature Flags)"
          subtitle="تفعيل أو إخفاء المنصات بدون حذف بياناتها التاريخية، وإضافة منصات توصيل جديدة."
          className="border-b border-slate-100 pb-3 dark:border-slate-800"
          actions={
            canManagePlatforms ? (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-slate-400 hidden sm:block" />
                <Button
                  size="sm"
                  variant={keetaActive ? 'secondary' : 'accent'}
                  disabled={busy}
                  onClick={() => handleToggleKeetaFlag(!keetaActive)}
                >
                  {keetaActive ? 'إخفاء وتعطيل منصة Keeta مؤقتًا' : 'إعادة تفعيل وإظهار منصة Keeta'}
                </Button>
              </div>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mergedCatalog.map((p) => {
            const active = p.platformId === 'keeta' ? keetaActive : Boolean(p.enabled && !p.hiddenFromUi);
            return (
              <div key={p.platformId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 text-xs">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-white">
                    {p.nameAr} <span className="font-mono-num text-[11px] font-normal text-slate-500">({p.platformId})</span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{p.description || p.name}</div>
                </div>
                {canManagePlatforms ? (
                  <Button
                    size="sm"
                    variant={active ? 'secondary' : 'ghost'}
                    disabled={busy}
                    onClick={() => handleTogglePlatformEntry(p)}
                  >
                    <StatusBadge label={active ? 'مفعّلة' : 'معطلة / مخفية'} tone={active ? 'success' : 'neutral'} />
                  </Button>
                ) : (
                  <StatusBadge label={active ? 'مفعّلة' : 'معطلة / مخفية'} tone={active ? 'success' : 'neutral'} />
                )}
              </div>
            );
          })}
        </div>

        {canManagePlatforms && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="flex-1 min-w-[200px]">
              <Input
                type="text"
                value={newPlatName}
                onChange={(e) => setNewPlatName(e.target.value)}
                placeholder="Platform English Name (e.g. Careem Food)"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <Input
                type="text"
                value={newPlatNameAr}
                onChange={(e) => setNewPlatNameAr(e.target.value)}
                placeholder="الاسم بالعربية (مثال: كريم فود)"
              />
            </div>
            <Button
              variant="primary"
              disabled={busy || !newPlatName.trim()}
              onClick={handleAddCustomPlatform}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              إضافة منصة جديدة
            </Button>
          </div>
        )}
      </Card>

      {/* Document Types Configuration */}
      <Card padding="lg" className="space-y-4">
        <SectionHeader
          title="إدارة أنواع المستندات (Document Types Configuration)"
          subtitle="تحديد المستندات المطلوبة في الموارد البشرية والأسطول وعهدة المركبات وتاريخ انتهاء كل نوع."
          actions={<FolderLock className="h-4 w-4 text-slate-400" />}
        />

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          {mergedDocTypes.map((dt) => (
            <div key={dt.typeId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">{dt.nameAr}</div>
                <div className="text-[11px] text-slate-500">
                  {dt.targetEntity === 'rider' ? 'مندوب HR' : dt.targetEntity === 'vehicle' ? 'مركبة' : 'عهدة تسليم'} ·{' '}
                  {dt.requiresExpiry ? 'له تاريخ انتهاء' : 'بدون انتهاء'}
                </div>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleToggleDocType(dt)}
                  className="shrink-0"
                >
                  <StatusBadge label={dt.active ? 'مفعّل' : 'معطّل'} tone={dt.active ? 'success' : 'neutral'} />
                </button>
              ) : (
                <StatusBadge label={dt.active ? 'مفعّل' : 'معطّل'} tone={dt.active ? 'success' : 'neutral'} />
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
            <div className="flex-1 min-w-[200px]">
              <Input
                type="text"
                value={newDocNameAr}
                onChange={(e) => setNewDocNameAr(e.target.value)}
                placeholder="اسم نوع مستند جديد (مثال: كرت تشغيل بلدية)..."
              />
            </div>
            <div className="w-48">
              <Select
                value={newDocScope}
                onChange={(e) => setNewDocScope(e.target.value as 'rider' | 'vehicle' | 'handover')}
              >
                <option value="rider">مستندات المندوب HR</option>
                <option value="vehicle">مستندات المركبة</option>
                <option value="handover">نموذج تسليم/استلام</option>
              </Select>
            </div>
            <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer px-2">
              <input
                type="checkbox"
                checked={newDocExpiry}
                onChange={(e) => setNewDocExpiry(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>يتطلب تاريخ انتهاء</span>
            </label>
            <Button
              variant="primary"
              disabled={busy || !newDocNameAr.trim()}
              onClick={handleAddDocType}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              إضافة نوع مستند
            </Button>
          </div>
        )}
      </Card>

      {onOpenRbac && (
        <Card className="border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-blue-900 dark:text-blue-200 font-medium">
            لإدارة الأدوار المخصصة، مصفوفة الصلاحيات التفصيلية (13 وحدة × 6 إجراءات)، ونطاق الفروع والمنصات لكل مستخدم انتقل إلى مركز الصلاحيات RBAC.
          </div>
          <Button variant="accent" icon={<Shield className="h-3.5 w-3.5" />} onClick={onOpenRbac}>
            فتح مصفوفة الصلاحيات المتقدمة
          </Button>
        </Card>
      )}

      {/* KPI Definitions & Platform Parity Reference */}
      <Card padding="lg" className="space-y-4">
        <SectionHeader
          title="مرجع تعريفات المؤشرات وفروقات المنصات (KPI Dictionary & Governance)"
          subtitle="توثيق الحقول الفعلية والمعادلات المعتمدة في HungerStation وKeeta لضمان تطابق التقارير التشغيلية والمالية."
          actions={<BookOpen className="h-4 w-4 text-slate-400" />}
        />

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-right font-semibold">المؤشر</th>
                <th className="px-3 py-2.5 text-right font-semibold">الحقول المصدرية الفعلية</th>
                <th className="px-3 py-2.5 text-right font-semibold">المعادلة المعتمدة</th>
                <th className="px-3 py-2.5 text-right font-semibold">ملاحظة الاختلاف بين المنصتين</th>
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
      </Card>

      {/* Audit Log */}
      <div className="space-y-3">
        <SectionHeader title="سجل المراجعة والتدقيق (Audit Log)" />
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
  admin: 'Admin (مدير النظام الأعلى)',
  operations_manager: 'Operations Manager (مدير العمليات)',
  hr_manager: 'HR Manager (مدير الموارد البشرية)',
  hr_employee: 'HR Employee (موظف موارد بشرية)',
  fleet_manager: 'Fleet Manager (مدير الأسطول)',
  fleet_employee: 'Fleet Employee (موظف أسطول)',
  supervisor: 'Supervisor (مشرف تطبيقات وميدان)',
  accountant: 'Accountant (المحاسبة والمالية)',
  viewer: 'Viewer (مطلع تقارير)',
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
    nextPlatforms: Platform[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const encodePlatforms = (platforms: Platform[]): 'both' | 'hungerstation' | 'keeta' => {
    const hasHs = platforms.includes('hungerstation');
    const hasKt = platforms.includes('keeta');
    if (hasHs && hasKt) return 'both';
    return hasHs ? 'hungerstation' : 'keeta';
  };

  const decodePlatforms = (code: string): Platform[] => {
    if (code === 'hungerstation') return ['hungerstation'];
    if (code === 'keeta') return ['keeta'];
    return ['hungerstation', 'keeta'];
  };

  const handleUpdateRole = async () => {
    if (!confirmUser || !isAdmin) return;
    setBusy(true);
    setMsg(null);
    try {
      const target = confirmUser.user;
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      const effectivePlatforms: Platform[] =
        confirmUser.nextRole === 'owner' || confirmUser.nextRole === 'admin'
          ? ['hungerstation', 'keeta']
          : confirmUser.nextPlatforms.length > 0
            ? confirmUser.nextPlatforms
            : ['hungerstation', 'keeta'];

      await updateDoc(doc(db, 'users', target.uid), {
        role: confirmUser.nextRole,
        active: confirmUser.nextActive,
        allowedPlatforms: effectivePlatforms,
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
        details: `تعديل صلاحية ${target.email} إلى ${confirmUser.nextRole} | المنصات: ${effectivePlatforms.join('+')} | التفعيل: ${confirmUser.nextActive ? 'مفعّل' : 'معطّل'}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setConfirmUser(null);
      setMsg({ type: 'ok', text: `تم تحديث صلاحيات ونطاق المنصات لـ ${target.email} بنجاح.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${confirmUser.user.uid}`);
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'فشل تحديث صلاحيات المستخدم.' });
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
      key: 'platforms',
      header: 'المنصات المصرح بها',
      render: (r) => {
        const plats = getUserAllowedPlatforms(r);
        const label =
          plats.length === 2
            ? 'HungerStation + Keeta'
            : plats[0] === 'hungerstation'
              ? 'HungerStation فقط'
              : 'Keeta فقط';
        return <StatusBadge label={label} tone={plats.length === 2 ? 'info' : 'neutral'} className="font-mono-num" />;
      },
    },
    {
      key: 'active',
      header: 'حالة الحساب',
      align: 'center',
      render: (r) => (
        <StatusBadge
          label={r.active ? 'مفعّل' : 'معطّل / بانتظار التفعيل'}
          tone={r.active ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'actions',
      header: 'إدارة الصلاحية والمنصات',
      render: (r) => {
        const isBootOwner = r.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
        if (!isAdmin || isBootOwner) {
          return (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {isBootOwner ? 'مالك رئيسي محمي' : 'للعرض فقط'}
            </span>
          );
        }
        const curPlats = getUserAllowedPlatforms(r);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <Select
                value={r.role}
                onChange={(e) =>
                  setConfirmUser({
                    user: r,
                    nextRole: e.target.value as UserRole,
                    nextActive: r.active,
                    nextPlatforms: curPlats,
                  })
                }
                className="h-8 text-xs"
              >
                <option value="admin">Admin</option>
                <option value="operations_manager">Operations Manager</option>
                <option value="hr_manager">HR Manager</option>
                <option value="hr_employee">HR Employee</option>
                <option value="fleet_manager">Fleet Manager</option>
                <option value="fleet_employee">Fleet Employee</option>
                <option value="supervisor">Supervisor</option>
                <option value="accountant">Accountant</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>
            <div className="w-32">
              <Select
                value={encodePlatforms(curPlats)}
                disabled={r.role === 'owner' || r.role === 'admin'}
                onChange={(e) =>
                  setConfirmUser({
                    user: r,
                    nextRole: r.role,
                    nextActive: r.active,
                    nextPlatforms: decodePlatforms(e.target.value),
                  })
                }
                title="تحديد المنصات المصرح بها"
                className="h-8 text-xs"
              >
                <option value="both">HS + Keeta</option>
                <option value="hungerstation">HS فقط</option>
                <option value="keeta">Keeta فقط</option>
              </Select>
            </div>
            <Button
              size="sm"
              variant={r.active ? 'danger' : 'secondary'}
              onClick={() =>
                setConfirmUser({
                  user: r,
                  nextRole: r.role,
                  nextActive: !r.active,
                  nextPlatforms: curPlats,
                })
              }
            >
              {r.active ? 'تعطيل' : 'تفعيل'}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="إدارة المستخدمين والصلاحيات (RBAC)"
        subtitle="الأدوار المدعومة: Owner · Admin · Operations Manager · Supervisor · Viewer. أي مستخدم جديد يسجل بحساب Google يظهر هنا للتفعيل وتحديد دوره."
        actions={
          <StatusBadge
            tone="info"
            icon={<Shield className="h-3.5 w-3.5" />}
            label="محمي بقواعد Firestore Zero-Trust"
          />
        }
      />

      {msg && (
        <ToastBanner type={msg.type} message={msg.text} onDismiss={() => setMsg(null)} />
      )}

      {!isAdmin && (
        <ToastBanner type="warn" message="تعديل صلاحيات المستخدمين متاح فقط لدور Owner و Admin." />
      )}

      <Card padding="sm" className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
        <UserPlus className="h-4 w-4 text-slate-500 shrink-0 dark:text-slate-400" />
        <span>
          لإضافة مشرف أو مشاهد جديد، اطلب منه تسجيل الدخول عبر زر Google Sign-In وسيظهر حسابه فورًا في الجدول أدناه لتفعيله وتعيين دوره.
        </span>
      </Card>

      <DataTable
        rows={usersList}
        columns={cols}
        rowKey={(r) => r.uid}
        searchPlaceholder="ابحث بالاسم أو البريد أو الدور..."
        searchText={(r) => `${r.displayName} ${r.email} ${r.role}`}
      />

      <ConfirmModal
        open={Boolean(confirmUser)}
        title="تأكيد تعديل صلاحية ونطاق المستخدم"
        description={
          confirmUser
            ? `هل تريد تحديث صلاحية ${confirmUser.user.email} إلى "${ROLE_LABELS[confirmUser.nextRole]}" — المنصات: "${
                confirmUser.nextRole === 'owner' || confirmUser.nextRole === 'admin'
                  ? 'HungerStation + Keeta'
                  : confirmUser.nextPlatforms.map((p) => (p === 'hungerstation' ? 'HungerStation' : 'Keeta')).join(' + ')
              }" — وحالة التفعيل: "${confirmUser.nextActive ? 'مفعّل' : 'معطّل'}"؟`
            : ''
        }
        busy={busy}
        onConfirm={handleUpdateRole}
        onCancel={() => setConfirmUser(null)}
      />
    </div>
  );
}
