import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Plus,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { FleetDataset, UnifiedDailyRow } from '../lib/fleetAnalytics';
import { buildInterventionQueue, type InterventionCandidate } from '../lib/smartAnalytics';
import {
  buildEffectiveFormSchema,
  sanitizeCustomFieldsForFirestore,
  validateDynamicFormValues,
} from '../lib/dynamicSchemaEngine';
import type {
  DynamicFieldDefinition,
  DynamicFormDefinition,
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalCasePriority,
  OperationalCaseStatus,
  OperationalSettings,
  Platform,
  UserProfile,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { KpiCard } from './KpiCard';
import {
  Button,
  FormField,
  Input,
  PageHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  Tabs,
  Textarea,
  ToastBanner,
  type BadgeTone,
} from './ui/EnterpriseUI';

interface OperationsControlCenterProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  operationalCases: OperationalCase[];
  settings: OperationalSettings;
  usersList: UserProfile[];
  currentUser: UserProfile;
  allowedUids: string[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  lockedPlatform?: Platform;
  onSelectRider: (platform: Platform, riderId: string) => void;
  onRefresh: () => Promise<void>;
}

const STATUS_LABELS: Record<OperationalCaseStatus, string> = {
  new: 'جديدة',
  under_review: 'قيد المراجعة',
  in_progress: 'قيد المعالجة',
  resolved: 'تمت المعالجة',
  closed: 'مغلقة',
};

const STATUS_TONES: Record<OperationalCaseStatus, BadgeTone> = {
  new: 'warning',
  under_review: 'info',
  in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
};

const PRIORITY_LABELS: Record<OperationalCasePriority, string> = {
  critical: 'حرج',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
};

const PRIORITY_TONES: Record<OperationalCasePriority, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

function isCaseOverdue(c: OperationalCase, overdueDays: number): boolean {
  if (c.status === 'resolved' || c.status === 'closed') return false;
  const today = new Date().toISOString().slice(0, 10);
  if (c.dueDate && c.dueDate < today) return true;
  const regMs = new Date(`${c.registeredDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  return Number.isFinite(regMs) && (todayMs - regMs) / 86400000 >= overdueDays;
}

export function OperationsControlCenter({
  dataset,
  filteredRows,
  dictionaryEntries,
  operationalCases,
  settings,
  usersList,
  currentUser,
  allowedUids,
  dynamicFields = [],
  dynamicForms = [],
  lockedPlatform,
  onSelectRider,
  onRefresh,
}: OperationsControlCenterProps) {
  const canManage =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager' ||
    currentUser.role === 'supervisor';

  const canReopenClosed =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager';

  const [tab, setTab] = useState<'queue' | 'cases'>('queue');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [caseViewFilter, setCaseViewFilter] = useState<'all' | 'open' | 'overdue' | 'mine' | 'closed'>('open');

  // Case Editor Drawer State (Create or Update)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<OperationalCase | null>(null);
  const [caseCustomValues, setCaseCustomValues] = useState<Record<string, unknown>>({});
  const [caseCustomErrors, setCaseCustomErrors] = useState<Record<string, string>>({});
  const [formPlatform, setFormPlatform] = useState<Platform>(lockedPlatform || 'hungerstation');
  const [formRiderId, setFormRiderId] = useState('');
  const [formRiderName, setFormRiderName] = useState('');
  const [formBranch, setFormBranch] = useState('');
  const [formIssueType, setFormIssueType] = useState('low_orders');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<OperationalCasePriority>('high');
  const [formStatus, setFormStatus] = useState<OperationalCaseStatus>('new');
  const [formAssignee, setFormAssignee] = useState('');
  const [formActionTaken, setFormActionTaken] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formSourceRef, setFormSourceRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const overdueDays = settings.caseOverdueDays ?? 3;

  const scopedCases = useMemo(
    () => (lockedPlatform ? operationalCases.filter((c) => c.platform === lockedPlatform) : operationalCases),
    [operationalCases, lockedPlatform]
  );

  const interventionQueue = useMemo(() => {
    const raw = buildInterventionQueue(dataset, filteredRows, dictionaryEntries, settings, scopedCases);
    return lockedPlatform ? raw.filter((c) => c.platform === lockedPlatform) : raw;
  }, [dataset, filteredRows, dictionaryEntries, settings, scopedCases, lockedPlatform]);

  const filteredQueue = useMemo(() => {
    if (reasonFilter === 'all') return interventionQueue;
    return interventionQueue.filter((c) => c.reasonType === reasonFilter);
  }, [interventionQueue, reasonFilter]);

  const openCases = scopedCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved');
  const overdueCases = scopedCases.filter((c) => isCaseOverdue(c, overdueDays));
  const resolvedClosedCases = scopedCases.filter((c) => c.status === 'resolved' || c.status === 'closed');

  const filteredCases = useMemo(() => {
    return scopedCases
      .filter((c) => {
        if (caseViewFilter === 'open') return c.status !== 'closed' && c.status !== 'resolved';
        if (caseViewFilter === 'overdue') return isCaseOverdue(c, overdueDays);
        if (caseViewFilter === 'mine') return (c.assigneeEmail || '').toLowerCase() === currentUser.email.toLowerCase();
        if (caseViewFilter === 'closed') return c.status === 'closed' || c.status === 'resolved';
        return true;
      })
      .sort((a, b) => b.registeredDate.localeCompare(a.registeredDate));
  }, [scopedCases, caseViewFilter, overdueDays, currentUser.email]);

  const opCaseSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'ops_case', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );

  const openNewCaseFromCandidate = (cand: InterventionCandidate) => {
    if (cand.existingCase) {
      openEditCase(cand.existingCase);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const dueDt = new Date(Date.now() + overdueDays * 86400000).toISOString().slice(0, 10);
    setEditingCase(null);
    setCaseCustomValues({});
    setCaseCustomErrors({});
    setFormPlatform(cand.platform);
    setFormRiderId(cand.riderId);
    setFormRiderName(cand.riderName);
    setFormBranch(cand.branchOrCity !== '-' ? cand.branchOrCity : '');
    setFormIssueType(cand.reasonType);
    setFormTitle(`${cand.reasonLabel} — ${cand.riderName}`);
    setFormDescription(cand.metricSummary);
    setFormPriority(cand.severity === 'critical' ? 'critical' : cand.severity === 'high' ? 'high' : 'medium');
    setFormStatus('new');
    setFormAssignee(currentUser.email);
    setFormActionTaken('');
    setFormNotes('');
    setFormDueDate(dueDt);
    setFormSourceRef(`${cand.platform}:${cand.riderId}:${today}`);
    setDrawerOpen(true);
    setMsg(null);
  };

  const openBlankCase = () => {
    const dueDt = new Date(Date.now() + overdueDays * 86400000).toISOString().slice(0, 10);
    setEditingCase(null);
    setCaseCustomValues({});
    setCaseCustomErrors({});
    setFormPlatform(lockedPlatform || 'hungerstation');
    setFormRiderId('');
    setFormRiderName('');
    setFormBranch('');
    setFormIssueType('manual_followup');
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormStatus('new');
    setFormAssignee(currentUser.email);
    setFormActionTaken('');
    setFormNotes('');
    setFormDueDate(dueDt);
    setFormSourceRef('manual');
    setDrawerOpen(true);
    setMsg(null);
  };

  const openEditCase = (c: OperationalCase) => {
    setEditingCase(c);
    setCaseCustomValues(c.customFields ? { ...c.customFields } : {});
    setCaseCustomErrors({});
    setFormPlatform(c.platform);
    setFormRiderId(c.riderId);
    setFormRiderName(c.riderName || '');
    setFormBranch(c.branch || '');
    setFormIssueType(c.issueType);
    setFormTitle(c.title);
    setFormDescription(c.description || '');
    setFormPriority(c.priority);
    setFormStatus(c.status);
    setFormAssignee(c.assigneeEmail || '');
    setFormActionTaken(c.actionTaken || '');
    setFormNotes(c.notes || '');
    setFormDueDate(c.dueDate || '');
    setFormSourceRef(c.sourceRef || '');
    setDrawerOpen(true);
    setMsg(null);
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !formRiderId.trim() || !formTitle.trim()) return;
    const dynErrs = validateDynamicFormValues(
      Array.from(opCaseSchema.fieldsById.values()),
      opCaseSchema.placements,
      caseCustomValues,
      currentUser
    );
    if (Object.keys(dynErrs).length > 0) {
      setCaseCustomErrors(dynErrs);
      setMsg({ type: 'err', text: Object.values(dynErrs)[0] || 'يرجى استكمال الحقول المخصصة المطلوبة.' });
      return;
    }
    setCaseCustomErrors({});

    setBusy(true);
    setMsg(null);
    const today = new Date().toISOString().slice(0, 10);
    const caseId =
      editingCase?.caseId ||
      `opcase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sanitizedCustom = sanitizeCustomFieldsForFirestore(caseCustomValues);

    const payload: Record<string, unknown> = {
      caseId,
      riderId: formRiderId.trim().slice(0, 64),
      platform: formPlatform,
      riderName: formRiderName.trim().slice(0, 150),
      branch: formBranch.trim().slice(0, 120),
      issueType: formIssueType.trim().slice(0, 120),
      title: formTitle.trim().slice(0, 200),
      description: formDescription.trim().slice(0, 1200),
      priority: formPriority,
      status: formStatus,
      assigneeEmail: formAssignee.trim().slice(0, 200),
      actionTaken: formActionTaken.trim().slice(0, 800),
      notes: formNotes.trim().slice(0, 1500),
      registeredDate: editingCase?.registeredDate || today,
      dueDate: formDueDate.trim().slice(0, 10),
      closedDate: formStatus === 'closed' || formStatus === 'resolved' ? today : '',
      sourceRef: formSourceRef.trim().slice(0, 200),
      updatedByEmail: currentUser.email.slice(0, 200),
      createdByUid: editingCase?.createdByUid || currentUser.uid,
      allowedUids: allowedUids.length > 0 ? allowedUids : [currentUser.uid],
      createdAt: editingCase?.createdAt ? editingCase.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (Object.keys(sanitizedCustom).length > 0 || editingCase?.customFields) {
      payload.customFields = sanitizedCustom;
    }

    try {
      await setDoc(doc(db, 'operationalCases', caseId), payload, { merge: Boolean(editingCase) });
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: editingCase ? 'OPERATIONAL_CASE_UPDATED' : 'OPERATIONAL_CASE_CREATED',
        targetCollection: 'operationalCases',
        targetId: caseId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `${editingCase ? 'تحديث' : 'فتح'} حالة تشغيلية للمندوب ${formRiderId.trim()} (${STATUS_LABELS[formStatus]})`,
        allowedUids: payload.allowedUids,
        createdAt: serverTimestamp(),
      });
      setDrawerOpen(false);
      setMsg({ type: 'ok', text: `تم حفظ الحالة التشغيلية (${caseId}) بنجاح.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `operationalCases/${caseId}`);
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'تعذر حفظ الحالة التشغيلية.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const queueCols: TableColumn<InterventionCandidate>[] = [
    {
      key: 'sev',
      header: 'الأولوية',
      sortValue: (r) => (r.severity === 'critical' ? 3 : r.severity === 'high' ? 2 : 1),
      render: (r) => (
        <StatusBadge
          label={r.severity === 'critical' ? 'حرج' : r.severity === 'high' ? 'مرتفع' : 'متوسط'}
          tone={r.severity === 'critical' ? 'danger' : r.severity === 'high' ? 'warning' : 'neutral'}
        />
      ),
    },
    {
      key: 'rider',
      header: 'المندوب',
      sortValue: (r) => r.riderId,
      render: (r) => (
        <button
          type="button"
          onClick={() => onSelectRider(r.platform, r.riderId)}
          className="text-right hover:underline"
        >
          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.riderName}</div>
        </button>
      ),
    },
    {
      key: 'platform',
      header: 'المنصة / الفرع',
      render: (r) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'} · {r.branchOrCity}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'سبب التدخل',
      sortValue: (r) => r.reasonLabel,
      render: (r) => <span className="font-semibold text-slate-900 dark:text-slate-100">{r.reasonLabel}</span>,
    },
    {
      key: 'metric',
      header: 'المؤشر المرصود',
      render: (r) => <span className="font-mono-num text-xs text-slate-700 dark:text-slate-300">{r.metricSummary}</span>,
    },
    {
      key: 'date',
      header: 'آخر تاريخ',
      sortValue: (r) => r.latestDate,
      render: (r) => <span className="font-mono-num text-xs">{r.latestDate}</span>,
    },
    {
      key: 'action',
      header: 'المتابعة',
      align: 'center',
      render: (r) =>
        canManage ? (
          <Button
            size="sm"
            variant={r.existingCase ? 'accent' : 'secondary'}
            onClick={() => openNewCaseFromCandidate(r)}
          >
            {r.existingCase ? `تحديث (${STATUS_LABELS[r.existingCase.status]})` : 'فتح حالة تشغيلية'}
          </Button>
        ) : (
          <span className="text-xs text-slate-400">عرض فقط</span>
        ),
    },
  ];

  const caseCols: TableColumn<OperationalCase>[] = [
    {
      key: 'priority',
      header: 'الأولوية',
      sortValue: (c) => c.priority,
      render: (c) => <StatusBadge label={PRIORITY_LABELS[c.priority]} tone={PRIORITY_TONES[c.priority]} />,
    },
    {
      key: 'title',
      header: 'الحالة والمندوب',
      sortValue: (c) => c.title,
      render: (c) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{c.title}</div>
          <button
            type="button"
            onClick={() => onSelectRider(c.platform, c.riderId)}
            className="text-[11px] font-mono-num text-blue-700 dark:text-blue-400 hover:underline"
          >
            {c.platform === 'hungerstation' ? 'HS' : 'Keeta'}:{c.riderId} {c.branch ? `· ${c.branch}` : ''}
          </button>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'مرحلة المعالجة',
      sortValue: (c) => c.status,
      render: (c) => {
        const overdue = isCaseOverdue(c, overdueDays);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge label={STATUS_LABELS[c.status]} tone={STATUS_TONES[c.status]} />
            {overdue && <StatusBadge label="متأخرة" tone="danger" />}
          </div>
        );
      },
    },
    {
      key: 'assignee',
      header: 'المسؤول',
      sortValue: (c) => c.assigneeEmail || '',
      render: (c) => <span className="font-mono-num text-xs">{c.assigneeEmail || 'غير معين'}</span>,
    },
    {
      key: 'dates',
      header: 'التسجيل / الاستحقاق',
      sortValue: (c) => c.registeredDate,
      render: (c) => (
        <div className="font-mono-num text-xs">
          <div>{c.registeredDate}</div>
          {c.dueDate && <div className="text-[11px] text-slate-500 dark:text-slate-400">استحقاق: {c.dueDate}</div>}
        </div>
      ),
    },
    {
      key: 'action',
      header: 'الإجراء المتخذ',
      render: (c) => <span className="text-xs text-slate-600 dark:text-slate-300">{c.actionTaken || c.notes || '-'}</span>,
    },
    {
      key: 'edit',
      header: 'إدارة',
      align: 'center',
      render: (c) =>
        canManage ? (
          <Button size="sm" variant="secondary" onClick={() => openEditCase(c)}>
            متابعة
          </Button>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
  ];

  const title =
    lockedPlatform === 'hungerstation'
      ? 'التحكم التشغيلي والحالات — HungerStation'
      : lockedPlatform === 'keeta'
        ? 'التحكم التشغيلي والحالات — Keeta'
        : 'مركز التحكم التشغيلي والحالات (Operations Control Center)';

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle="رصد يومي للمندوبين المتطلبين لتدخل فوري مع نظام متكامل لإدارة دورة حياة الحالات التشغيلية."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openBlankCase}>
              فتح حالة تشغيلية يدوية
            </Button>
          ) : undefined
        }
      />

      {msg && (
        <ToastBanner type={msg.type} message={msg.text} onDismiss={() => setMsg(null)} />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="مرشحو التدخل اليومي"
          value={String(interventionQueue.length)}
          tone={interventionQueue.length > 0 ? 'warn' : 'good'}
          subtext={`حرجة: ${interventionQueue.filter((c) => c.severity === 'critical').length}`}
        />
        <KpiCard
          label="حالات تشغيلية مفتوحة"
          value={String(openCases.length)}
          tone={openCases.length > 0 ? 'warn' : 'good'}
        />
        <KpiCard
          label="حالات متأخرة (Overdue)"
          value={String(overdueCases.length)}
          tone={overdueCases.length > 0 ? 'critical' : 'good'}
          subtext={`تجاوزت ${overdueDays} أيام`}
        />
        <KpiCard label="حالات تمت معالجتها / مغلقة" value={String(resolvedClosedCases.length)} tone="good" />
      </div>

      {/* Mode Switcher & Sub-Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          variant="underline"
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'queue',
              label: 'طابور التدخل اليومي',
              count: interventionQueue.length,
              icon: <AlertTriangle className="h-3.5 w-3.5" />,
            },
            {
              key: 'cases',
              label: 'سجل الحالات التشغيلية',
              count: scopedCases.length,
              icon: <ClipboardCheck className="h-3.5 w-3.5" />,
            },
          ]}
        />

        {tab === 'queue' ? (
          <div className="w-full sm:w-64">
            <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
              <option value="all">كل أسباب التدخل</option>
              <option value="low_hours">انخفاض ساعات العمل</option>
              <option value="low_orders">انخفاض الطلبات</option>
              <option value="high_rejection_cancel">ارتفاع الرفض أو الإلغاء</option>
              <option value="poor_attendance">ضعف الالتزام بالورديات</option>
              {lockedPlatform !== 'hungerstation' && (
                <>
                  <option value="repeated_overdue">تكرار التأخير Overdue</option>
                  <option value="facial_failure">فشل التحقق من الهوية</option>
                </>
              )}
              {lockedPlatform !== 'keeta' && (
                <option value="error_codes">أكواد أخطاء هنقرستيشن</option>
              )}
            </Select>
          </div>
        ) : (
          <Tabs
            variant="segmented"
            activeKey={caseViewFilter}
            onChange={setCaseViewFilter}
            items={[
              { key: 'open', label: 'المفتوحة' },
              { key: 'overdue', label: 'المتأخرة', count: overdueCases.length },
              { key: 'mine', label: 'المعيّنة لي' },
              { key: 'closed', label: 'المغلقة/المعالجة' },
              { key: 'all', label: 'الكل' },
            ]}
          />
        )}
      </div>

      {tab === 'queue' ? (
        <DataTable
          rows={filteredQueue}
          columns={queueCols}
          rowKey={(r) => r.id}
          searchPlaceholder="ابحث بالمندوب أو السبب أو الفرع..."
          searchText={(r) => `${r.riderId} ${r.riderName} ${r.reasonLabel} ${r.branchOrCity}`}
          emptyTitle="لا توجد حالات تتطلب تدخلًا وفق الفلتر الحالي"
          emptySubtitle="جميع المؤشرات ضمن الحدود المستهدفة في الإعدادات."
        />
      ) : (
        <DataTable
          rows={filteredCases}
          columns={caseCols}
          rowKey={(c) => c.caseId}
          searchPlaceholder="ابحث بعنوان الحالة أو المندوب أو المسؤول..."
          searchText={(c) => `${c.caseId} ${c.riderId} ${c.title} ${c.assigneeEmail || ''} ${c.branch || ''}`}
          emptyTitle="لا توجد حالات تشغيلية في هذا التصنيف"
          emptySubtitle="افتح حالة جديدة من طابور التدخل اليومي أو عبر زر فتح حالة يدوية."
        />
      )}

      {/* Case Workflow SlideDrawer */}
      <SlideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title={editingCase ? `إدارة الحالة: ${editingCase.caseId}` : 'فتح حالة تشغيلية جديدة'}
        subtitle={
          editingCase
            ? `${editingCase.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'} · المندوب ${editingCase.riderId}`
            : 'توثيق حالة متابعة وتعيين المسؤول وتاريخ الاستحقاق (SLA)'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="opcase-workflow-form"
              variant="primary"
              loading={busy}
              disabled={busy || (editingCase?.status === 'closed' && !canReopenClosed)}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {busy ? 'جاري الحفظ...' : 'حفظ الحالة'}
            </Button>
          </>
        }
      >
        {editingCase?.status === 'closed' && !canReopenClosed && (
          <ToastBanner
            type="warn"
            message="الحالة مغلقة. إعادة فتح أو تعديل حالة مغلقة متاح فقط لمدير العمليات أو الإدارة."
          />
        )}

        <form id="opcase-workflow-form" onSubmit={handleSaveCase} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="المنصة">
              <Select
                value={formPlatform}
                disabled={Boolean(editingCase || lockedPlatform)}
                onChange={(e) => setFormPlatform(e.target.value as Platform)}
              >
                {(!lockedPlatform || lockedPlatform === 'hungerstation') && (
                  <option value="hungerstation">HungerStation</option>
                )}
                {(!lockedPlatform || lockedPlatform === 'keeta') && (
                  <option value="keeta">Keeta</option>
                )}
              </Select>
            </FormField>

            <FormField label="معرف المندوب" required>
              <Input
                type="text"
                required
                disabled={Boolean(editingCase)}
                value={formRiderId}
                onChange={(e) => setFormRiderId(e.target.value)}
                className="font-mono-num"
              />
            </FormField>

            <FormField label="تاريخ الاستحقاق (SLA)">
              <Input
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
                className="font-mono-num"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="عنوان الحالة" required>
              <Input
                type="text"
                required
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="مثال: انخفاض عدد الطلبات أو تكرار كود خطأ"
              />
            </FormField>

            <FormField label="المسؤول عن المتابعة">
              <Input
                type="text"
                list="ops-users-emails"
                value={formAssignee}
                onChange={(e) => setFormAssignee(e.target.value)}
                placeholder="البريد الإلكتروني للمشرف..."
                className="font-mono-num"
              />
              <datalist id="ops-users-emails">
                {usersList.filter((u) => u.active).map((u) => (
                  <option key={u.uid} value={u.email} />
                ))}
              </datalist>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="الأولوية">
              <Select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value as OperationalCasePriority)}
              >
                <option value="critical">حرج (Critical)</option>
                <option value="high">مرتفع (High)</option>
                <option value="medium">متوسط (Medium)</option>
                <option value="low">منخفض (Low)</option>
              </Select>
            </FormField>

            <FormField label="مرحلة المعالجة">
              <Select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as OperationalCaseStatus)}
              >
                <option value="new">جديدة (New)</option>
                <option value="under_review">قيد المراجعة (Under Review)</option>
                <option value="in_progress">قيد المعالجة (In Progress)</option>
                <option value="resolved">تمت المعالجة (Resolved)</option>
                <option value="closed">مغلقة (Closed)</option>
              </Select>
            </FormField>

            <FormField label="الفرع / المدينة">
              <Input
                type="text"
                value={formBranch}
                onChange={(e) => setFormBranch(e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="وصف المؤشر / المشكلة">
            <Textarea
              rows={3}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="الإجراء المتخذ">
              <Input
                type="text"
                value={formActionTaken}
                onChange={(e) => setFormActionTaken(e.target.value)}
                placeholder="التواصل الهاتفي / تنبيه المشرف / إعادة جدولة..."
              />
            </FormField>

            <FormField label="ملاحظات الإشراف">
              <Input
                type="text"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="تفاصيل المتابعة أو سبب الإغلاق..."
              />
            </FormField>
          </div>
          <DynamicFieldsRenderer
            formId="ops_case"
            entityId={editingCase?.caseId || 'opcase_draft'}
            entityLabel={formTitle || formRiderId || 'حالة تشغيلية'}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={caseCustomValues}
            onChange={setCaseCustomValues}
            user={currentUser}
            mode="form"
            errors={caseCustomErrors}
            contextValues={{ ...caseCustomValues }}
            title="حقول مخصصة للحالة التشغيلية"
          />
        </form>
      </SlideDrawer>
    </div>
  );
}
