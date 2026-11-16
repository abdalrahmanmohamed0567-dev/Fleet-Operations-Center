import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from '../lib/erpDb';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ClipboardCheck,
  LayoutDashboard,
  Plus,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { computeAllDocumentExpiries, writeErpAuditLog } from '../lib/erpHelpers';
import { db } from '../lib/firebase';
import type { FleetDataset } from '../lib/fleetAnalytics';
import { hasPermission, isKeetaActive } from '../shared/rbacCore';
import {
  buildEffectiveFormSchema,
  sanitizeCustomFieldsForFirestore,
  validateDynamicFormValues,
} from '../lib/dynamicSchemaEngine';
import type {
  DynamicFieldDefinition,
  DynamicFormDefinition,
  EntityNoteStatus,
  EntityNoteTargetType,
  EntityNoteTask,
  OperationalCase,
  OperationalCasePriority,
  OperationalSettings,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderMaster,
  RoleTemplate,
  UserProfile,
  VehicleAssignment,
  VehicleMaintenanceRecord,
  VehicleMaster,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { KpiCard } from './KpiCard';
import {
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  Tabs,
  Textarea,
  ToastBanner,
  type BadgeTone,
} from './ui/EnterpriseUI';

interface ExecutiveAdminModuleProps {
  riders: RiderMaster[];
  vehicles: VehicleMaster[];
  assignments: VehicleAssignment[];
  maintenance: VehicleMaintenanceRecord[];
  platformAccounts: PlatformAccount[];
  platformCatalog: PlatformCatalogEntry[];
  privateDocs: PrivateDocumentRecord[];
  operationalCases: OperationalCase[];
  entityNotesTasks: EntityNoteTask[];
  dataset: FleetDataset;
  settings: OperationalSettings;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  usersList: UserProfile[];
  allowedUids: string[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  onNavigate: (nav: string) => void;
  onOpenRider360: (internalRiderId: string) => void;
  onRefresh: () => Promise<void>;
}

const NOTE_STATUS_META: Record<EntityNoteStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'مفتوحة', tone: 'danger' },
  in_progress: { label: 'قيد المتابعة', tone: 'warning' },
  closed: { label: 'مغلقة', tone: 'success' },
};

const PRIORITY_LABELS: Record<OperationalCasePriority, { label: string; tone: BadgeTone }> = {
  critical: { label: 'حرج', tone: 'danger' },
  high: { label: 'مرتفع', tone: 'warning' },
  medium: { label: 'متوسط', tone: 'info' },
  low: { label: 'منخفض', tone: 'neutral' },
};

const TARGET_TYPE_LABELS: Record<EntityNoteTargetType, string> = {
  general: 'متابعة عامة / إدارة',
  rider: 'مندوب',
  vehicle: 'مركبة',
  platform_account: 'حساب تطبيق',
};

export function ExecutiveAdminModule({
  riders,
  vehicles,
  maintenance,
  platformAccounts,
  platformCatalog,
  privateDocs,
  operationalCases,
  entityNotesTasks,
  dataset,
  settings,
  currentUser,
  roleTemplates,
  usersList,
  allowedUids,
  dynamicFields = [],
  dynamicForms = [],
  onNavigate,
  onOpenRider360,
  onRefresh,
}: ExecutiveAdminModuleProps) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | EntityNoteStatus>('all');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<EntityNoteTask | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EntityNoteTask | null>(null);
  const [noteCustomValues, setNoteCustomValues] = useState<Record<string, unknown>>({});
  const [noteCustomErrors, setNoteCustomErrors] = useState<Record<string, string>>({});

  const adminNoteSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'admin_note', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );

  const [form, setForm] = useState({
    entityType: 'general' as EntityNoteTargetType,
    entityId: '',
    title: '',
    content: '',
    priority: 'medium' as OperationalCasePriority,
    assigneeUid: '',
    dueDate: '',
    actionTaken: '',
  });

  const canAdd = hasPermission(currentUser, roleTemplates, 'executive', 'add') || hasPermission(currentUser, roleTemplates, 'operations', 'add');
  const canEdit = hasPermission(currentUser, roleTemplates, 'executive', 'edit') || hasPermission(currentUser, roleTemplates, 'operations', 'edit');
  const canApprove = hasPermission(currentUser, roleTemplates, 'executive', 'approve');
  const canDelete = hasPermission(currentUser, roleTemplates, 'executive', 'delete');

  const keetaActive = isKeetaActive(settings, platformCatalog);

  const visibleAccounts = useMemo(
    () => platformAccounts.filter((a) => (a.platformId.toLowerCase() === 'keeta' ? keetaActive : true)),
    [platformAccounts, keetaActive]
  );

  const allExpiries = useMemo(
    () => computeAllDocumentExpiries({ riders, vehicles, privateDocs, settings }),
    [riders, vehicles, privateDocs, settings]
  );

  const kpis = useMemo(() => {
    const activeRiders = riders.filter((r) => r.status === 'active' || r.status === 'ready').length;
    const assignedVehicles = vehicles.filter((v) => v.status === 'assigned').length;
    const availableVehicles = vehicles.filter((v) => v.status === 'available').length;
    const maintVehicles = vehicles.filter((v) => v.status === 'maintenance').length;
    const totalMaintCost = maintenance.reduce((s, m) => s + (Number(m.cost) || 0), 0);
    const activeAccounts = visibleAccounts.filter((a) => a.accountStatus === 'active').length;
    const conflictAccounts = visibleAccounts.filter((a) => a.linkingStatus === 'conflict_review').length;

    const hsOrders = dataset.hungerDaily.reduce((s, r) => s + (r.completedDeliveries || 0), 0);
    const hsRidersCount = new Set(dataset.hungerDaily.map((r) => r.riderId)).size;
    const criticalExpiries = allExpiries.filter((e) => ['expired', 'due_today', 'within_7', 'within_30'].includes(e.urgency)).length;
    const openNotes = entityNotesTasks.filter((n) => n.status !== 'closed').length;
    const openOpCases = operationalCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length;

    return {
      totalRiders: riders.length,
      activeRiders,
      totalVehicles: vehicles.length,
      assignedVehicles,
      availableVehicles,
      maintVehicles,
      totalMaintCost,
      activeAccounts,
      conflictAccounts,
      hsOrders,
      hsRidersCount,
      criticalExpiries,
      openNotes,
      openOpCases,
    };
  }, [riders, vehicles, maintenance, visibleAccounts, dataset.hungerDaily, allExpiries, entityNotesTasks, operationalCases]);

  const filteredTasks = useMemo(
    () => entityNotesTasks.filter((t) => statusFilter === 'all' || t.status === statusFilter),
    [entityNotesTasks, statusFilter]
  );

  const handleCreateNoteTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    if (!form.title.trim() || !form.content.trim()) {
      setToast({ type: 'err', msg: 'عنوان الملاحظة والتفاصيل حقول إلزامية.' });
      return;
    }

    const dynErrs = validateDynamicFormValues(
      Array.from(adminNoteSchema.fieldsById.values()),
      adminNoteSchema.placements,
      noteCustomValues,
      currentUser
    );
    if (Object.keys(dynErrs).length > 0) {
      setNoteCustomErrors(dynErrs);
      setToast({ type: 'err', msg: Object.values(dynErrs)[0] || 'يرجى استكمال الحقول المخصصة.' });
      return;
    }
    setNoteCustomErrors({});

    let entityId = form.entityId.trim() || 'GENERAL';
    let entityLabel = 'متابعة إدارية عامة';
    if (form.entityType === 'rider') {
      const r = riders.find((x) => x.internalRiderId === form.entityId);
      entityId = r?.internalRiderId || form.entityId || 'UNKNOWN';
      entityLabel = r ? `${r.fullName} (${r.internalRiderId})` : entityId;
    } else if (form.entityType === 'vehicle') {
      const v = vehicles.find((x) => x.vehicleInternalId === form.entityId);
      entityId = v?.vehicleInternalId || form.entityId || 'UNKNOWN';
      entityLabel = v ? `${v.plateNumber} (${v.make} ${v.model})` : entityId;
    } else if (form.entityType === 'platform_account') {
      const a = visibleAccounts.find((x) => x.accountId === form.entityId);
      entityId = a?.accountId || form.entityId || 'UNKNOWN';
      entityLabel = a ? `${a.platformName}: ${a.platformRiderId}` : entityId;
    }

    const assignee = usersList.find((u) => u.uid === form.assigneeUid);

    setBusy(true);
    try {
      const noteTaskId = `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const sanitizedCustom = sanitizeCustomFieldsForFirestore(noteCustomValues);
      const payload: Record<string, unknown> = {
        noteTaskId,
        entityType: form.entityType,
        entityId,
        entityLabel,
        title: form.title.trim().slice(0, 180),
        content: form.content.trim().slice(0, 1500),
        priority: form.priority,
        status: 'open',
        createdByUid: currentUser.uid,
        createdByEmail: currentUser.email,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (assignee) {
        payload.assigneeUid = assignee.uid;
        payload.assigneeEmail = assignee.email;
      }
      if (form.dueDate) payload.dueDate = form.dueDate;
      if (form.actionTaken.trim()) payload.actionTaken = form.actionTaken.trim().slice(0, 800);
      if (Object.keys(sanitizedCustom).length > 0) payload.customFields = sanitizedCustom;

      await setDoc(doc(db, 'entityNotesTasks', noteTaskId), payload);

      await writeErpAuditLog({
        action: 'EXECUTIVE_NOTE_TASK_CREATED',
        targetCollection: 'entityNotesTasks',
        targetId: noteTaskId,
        entityType: form.entityType,
        details: `إنشاء متابعة/ملاحظة: ${form.title} (${entityLabel})`,
        newValue: { title: form.title, priority: form.priority, entityLabel },
        user: currentUser,
        allowedUids,
      });

      setTaskModalOpen(false);
      setNoteCustomValues({});
      setForm({
        entityType: 'general',
        entityId: '',
        title: '',
        content: '',
        priority: 'medium',
        assigneeUid: '',
        dueDate: '',
        actionTaken: '',
      });
      setToast({ type: 'ok', msg: 'تم حفظ الملاحظة / مهمة المتابعة بنجاح.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ الملاحظة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCloseOrReopen = async (task: EntityNoteTask, nextStatus: EntityNoteStatus, note?: string) => {
    if (nextStatus === 'closed' && !canApprove && !canEdit) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (nextStatus === 'closed') {
        patch.closedAt = new Date().toISOString().slice(0, 10);
        patch.closedByEmail = currentUser.email;
        if (note) patch.resolutionNote = note.slice(0, 800);
      }
      await updateDoc(doc(db, 'entityNotesTasks', task.noteTaskId), patch);
      await writeErpAuditLog({
        action: nextStatus === 'closed' ? 'EXECUTIVE_NOTE_TASK_CLOSED' : 'EXECUTIVE_NOTE_TASK_UPDATED',
        targetCollection: 'entityNotesTasks',
        targetId: task.noteTaskId,
        entityType: task.entityType,
        details: `تحديث حالة المتابعة "${task.title}" إلى ${NOTE_STATUS_META[nextStatus].label}`,
        oldValue: task.status,
        newValue: nextStatus,
        user: currentUser,
        allowedUids,
      });
      setCloseTarget(null);
      setResolutionNote('');
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تحديث الحالة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTarget || !canDelete) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'entityNotesTasks', deleteTarget.noteTaskId));
      await writeErpAuditLog({
        action: 'EXECUTIVE_NOTE_TASK_DELETED',
        targetCollection: 'entityNotesTasks',
        targetId: deleteTarget.noteTaskId,
        entityType: deleteTarget.entityType,
        details: `حذف المتابعة: ${deleteTarget.title}`,
        user: currentUser,
        allowedUids,
      });
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل الحذف.' });
    } finally {
      setBusy(false);
    }
  };

  const taskCols: TableColumn<EntityNoteTask>[] = [
    {
      key: 'title',
      header: 'الملاحظة / المهمة',
      sortValue: (t) => t.title,
      render: (t) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs truncate">{t.content}</div>
        </div>
      ),
    },
    {
      key: 'entity',
      header: 'الكيان المرتبط',
      render: (t) => (
        <div className="text-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">{TARGET_TYPE_LABELS[t.entityType]}</div>
          {t.entityType === 'rider' ? (
            <button type="button" onClick={() => onOpenRider360(t.entityId)} className="font-semibold text-blue-700 dark:text-blue-400 hover:underline">
              {t.entityLabel || t.entityId}
            </button>
          ) : (
            <span className="font-semibold text-slate-800 dark:text-slate-200">{t.entityLabel || t.entityId}</span>
          )}
        </div>
      ),
    },
    {
      key: 'assignee',
      header: 'المسؤول / الاستحقاق',
      render: (t) => (
        <div className="text-xs">
          <div>{t.assigneeEmail || 'غير معيّن'}</div>
          <div className="font-mono-num text-[11px] text-slate-500">{t.dueDate || 'بدون موعد'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة والأولوية',
      sortValue: (t) => t.status,
      render: (t) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge label={NOTE_STATUS_META[t.status].label} tone={NOTE_STATUS_META[t.status].tone} />
          <StatusBadge label={PRIORITY_LABELS[t.priority].label} tone={PRIORITY_LABELS[t.priority].tone} />
        </div>
      ),
    },
    {
      key: 'act',
      header: 'الإجراءات',
      render: (t) => (
        <div className="flex items-center gap-1.5">
          {t.status === 'open' && canEdit && (
            <Button size="sm" variant="secondary" onClick={() => void handleCloseOrReopen(t, 'in_progress')}>
              قيد التنفيذ
            </Button>
          )}
          {t.status !== 'closed' && (canApprove || canEdit) && (
            <Button
              size="sm"
              variant="accent"
              onClick={() => {
                setCloseTarget(t);
                setResolutionNote('');
              }}
            >
              إغلاق
            </Button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteTarget(t)}
              aria-label="حذف المتابعة"
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة الإدارة التنفيذية والتحكم الشامل"
        subtitle="نظرة موحدة على الموارد البشرية · التطبيقات والمنصات المفعّلة · الأسطول والمركبات · التنبيهات · الملاحظات والمتابعة"
        actions={
          <>
            {canAdd && (
              <Button
                variant="primary"
                onClick={() => {
                  setNoteCustomValues({});
                  setNoteCustomErrors({});
                  setTaskModalOpen(true);
                }}
                icon={<Plus className="h-4 w-4" />}
              >
                إضافة ملاحظة / متابعة
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void onRefresh()}
              disabled={busy}
              icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
            >
              تحديث
            </Button>
          </>
        }
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      {/* Executive Pillar KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="الموارد البشرية (المندوبون)"
          value={kpis.totalRiders.toLocaleString('en-US')}
          subtext={`نشط/جاهز: ${kpis.activeRiders} · انتهاءات: ${kpis.criticalExpiries}`}
          tone={kpis.criticalExpiries > 0 ? 'warn' : 'good'}
          statusText={kpis.criticalExpiries > 0 ? 'تنبيه' : 'سليم'}
          onClick={() => onNavigate('hr_dashboard')}
        />
        <KpiCard
          label="التطبيقات النشطة (هنقر & المنصات)"
          value={kpis.hsOrders.toLocaleString('en-US')}
          subtext={`طلب مكتمل · نشط: ${kpis.activeAccounts} · تعارضات: ${kpis.conflictAccounts}`}
          tone={kpis.conflictAccounts > 0 ? 'critical' : 'neutral'}
          statusText={kpis.conflictAccounts > 0 ? 'تعارض' : 'نشط'}
          onClick={() => onNavigate('hungerstation')}
        />
        <KpiCard
          label="الأسطول والمركبات"
          value={kpis.totalVehicles.toLocaleString('en-US')}
          subtext={`مسلمة: ${kpis.assignedVehicles} · متاحة: ${kpis.availableVehicles} · صيانة: ${kpis.maintVehicles}`}
          tone={kpis.maintVehicles > 0 ? 'warn' : 'good'}
          statusText={kpis.maintVehicles > 0 ? 'صيانة' : 'جاهز'}
          onClick={() => onNavigate('fleet_dashboard')}
        />
        <KpiCard
          label="المتابعة والحالات المفتوحة"
          value={String(kpis.openNotes + kpis.openOpCases)}
          subtext={`مهام تنفيذية: ${kpis.openNotes} · حالات تشغيلية: ${kpis.openOpCases}`}
          tone={kpis.openNotes + kpis.openOpCases > 0 ? 'warn' : 'good'}
          statusText={kpis.openNotes + kpis.openOpCases > 0 ? 'مفتوحة' : 'مكتملة'}
        />
      </div>

      {/* 4 System Pillars Quick Access */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigate('hr_dashboard')}
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
        >
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400">
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>1. الموارد البشرية (HR)</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            ملفات المندوبين، أرقام EMP، الخزينة الخاصة للمستندات، ومراقبة انتهاء الإقامات والرخص.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('hungerstation')}
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
        >
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400">
            <Truck className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>2. عمليات HungerStation</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            لوحة التشغيل، مركز أكواد الأخطاء، المسافات والمحافظ، الجودة الشهرية، واستيراد Excel.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('apps_active')}
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
        >
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400">
            <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>3. إدارة التطبيقات والربط</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            حسابات المندوبين في المنصات المفعّلة ومحرك الربط الحتمي وكشف التعارضات.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('fleet_dashboard')}
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
        >
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400">
            <Car className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" />
            <span>4. إدارة الأسطول والصيانة</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            السيارات، تسليم واستلام العهد بدون تداخل، الصيانة، والوثائق ({kpis.totalMaintCost.toLocaleString('en-US')} ر.س).
          </p>
        </button>
      </div>

      {/* Expiry Watch + Notes & Tasks Workspace */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="h-fit">
          <SectionHeader
            title="أولويات انتهاء الوثائق"
            subtitle="متابعة عتبات 90 / 60 / 30 / 7 / 0 يوم"
            actions={
              <Button size="sm" variant="ghost" onClick={() => onNavigate('hr_expiries')}>
                التفاصيل
              </Button>
            }
          />
          {allExpiries.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="لا توجد انتهاءات قريبة" subtitle="جميع وثائق المندوبين والمركبات سارية حاليًا." />
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {allExpiries.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{item.entityName}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                      {item.docCategory} · {item.expiryDate}
                    </div>
                  </div>
                  <StatusBadge
                    label={item.daysRemaining < 0 ? `منتهي (${Math.abs(item.daysRemaining)}ي)` : `${item.daysRemaining} يوم`}
                    tone={item.daysRemaining <= 7 ? 'danger' : item.daysRemaining <= 30 ? 'warning' : 'neutral'}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <ClipboardCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>نظام الملاحظات والمتابعة الإدارية ({entityNotesTasks.length})</span>
            </h3>
            <Tabs
              activeKey={statusFilter}
              onChange={(k) => setStatusFilter(k)}
              items={[
                { key: 'all', label: 'الكل' },
                { key: 'open', label: 'مفتوحة' },
                { key: 'in_progress', label: 'قيد المتابعة' },
                { key: 'closed', label: 'مغلقة' },
              ]}
            />
          </div>

          <DataTable
            tableId="executive_tasks"
            rows={filteredTasks}
            columns={taskCols}
            rowKey={(t) => t.noteTaskId}
            searchPlaceholder="ابحث في الملاحظات ومهام المتابعة..."
            searchText={(t) => `${t.title} ${t.content} ${t.entityLabel || ''} ${t.assigneeEmail || ''}`}
            pageSize={8}
          />
        </div>
      </div>

      {/* RTL SLIDE-OVER DRAWER: NEW NOTE / TASK */}
      <SlideDrawer
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        title="إضافة ملاحظة أو مهمة متابعة إدارية"
        subtitle="اربط الملاحظة بمندوب أو مركبة أو حساب تطبيق أو أنشئ متابعة إدارية عامة"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTaskModalOpen(false)} disabled={busy}>
              إلغاء
            </Button>
            <Button type="submit" form="exec-note-form" variant="primary" loading={busy}>
              حفظ المتابعة
            </Button>
          </>
        }
      >
        <form id="exec-note-form" onSubmit={(e) => void handleCreateNoteTask(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="نوع الكيان">
              <Select
                value={form.entityType}
                onChange={(e) => setForm({ ...form, entityType: e.target.value as EntityNoteTargetType, entityId: '' })}
              >
                <option value="general">متابعة عامة</option>
                <option value="rider">مندوب</option>
                <option value="vehicle">مركبة</option>
                <option value="platform_account">حساب تطبيق</option>
              </Select>
            </FormField>

            {form.entityType !== 'general' && (
              <FormField label="الكيان المستهدف">
                <Select value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}>
                  <option value="">-- اختر --</option>
                  {form.entityType === 'rider' &&
                    riders.map((r) => (
                      <option key={r.internalRiderId} value={r.internalRiderId}>
                        {r.fullName} ({r.internalRiderId})
                      </option>
                    ))}
                  {form.entityType === 'vehicle' &&
                    vehicles.map((v) => (
                      <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                        {v.plateNumber} ({v.make} {v.model})
                      </option>
                    ))}
                  {form.entityType === 'platform_account' &&
                    visibleAccounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.platformName} — {a.platformRiderId}
                      </option>
                    ))}
                </Select>
              </FormField>
            )}

            <FormField label="عنوان المتابعة" required className="sm:col-span-2">
              <Input
                type="text"
                required
                placeholder="مثال: متابعة تجديد الإقامة أو مراجعة عهدة المركبة"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </FormField>

            <FormField label="الأولوية">
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as OperationalCasePriority })}
              >
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </Select>
            </FormField>

            <FormField label="تاريخ الاستحقاق">
              <Input
                type="date"
                className="font-mono-num"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </FormField>

            {usersList.length > 0 && (
              <FormField label="تعيين لمستخدم" className="sm:col-span-2">
                <Select value={form.assigneeUid} onChange={(e) => setForm({ ...form, assigneeUid: e.target.value })}>
                  <option value="">-- بدون تعيين محدد --</option>
                  {usersList
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.email})
                      </option>
                    ))}
                </Select>
              </FormField>
            )}
          </div>

          <FormField label="تفاصيل الملاحظة / الإجراء المطلوب" required>
            <Textarea
              rows={4}
              required
              placeholder="اكتب وصفًا واضحًا للملاحظة والإجراء المطلوب..."
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </FormField>

          <DynamicFieldsRenderer
            formId="admin_note"
            entityId="note_draft"
            entityLabel={form.title || 'متابعة إدارية'}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={noteCustomValues}
            onChange={setNoteCustomValues}
            user={currentUser}
            mode="form"
            errors={noteCustomErrors}
            contextValues={{ ...noteCustomValues }}
            title="حقول مخصصة للمتابعة الإدارية"
          />
        </form>
      </SlideDrawer>

      {/* RTL SLIDE-OVER DRAWER: CLOSE NOTE / TASK */}
      <SlideDrawer
        open={Boolean(closeTarget)}
        onClose={() => setCloseTarget(null)}
        title={`إغلاق المتابعة: ${closeTarget?.title || ''}`}
        subtitle="توثيق القرار النهائي والإجراء المتخذ قبل الإغلاق"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseTarget(null)} disabled={busy}>
              إلغاء
            </Button>
            <Button type="submit" form="exec-close-form" variant="primary" loading={busy}>
              اعتماد الإغلاق
            </Button>
          </>
        }
      >
        {closeTarget && (
          <form
            id="exec-close-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCloseOrReopen(closeTarget, 'closed', resolutionNote);
            }}
            className="space-y-4"
          >
            <FormField label="ملخص الإجراء والقرار المتخذ" required>
              <Textarea
                rows={4}
                required
                placeholder="اكتب ملخص الحل أو النتيجة النهائية..."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
            </FormField>
          </form>
        )}
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="حذف ملاحظة / متابعة"
        description={`هل تريد حذف "${deleteTarget?.title || ''}" نهائيًا؟`}
        danger
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteTask()}
      />
    </div>
  );
}
