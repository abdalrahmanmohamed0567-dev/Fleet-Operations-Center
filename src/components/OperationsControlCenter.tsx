import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { FleetDataset, UnifiedDailyRow } from '../lib/fleetAnalytics';
import { buildInterventionQueue, type InterventionCandidate } from '../lib/smartAnalytics';
import type {
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalCasePriority,
  OperationalCaseStatus,
  OperationalSettings,
  Platform,
  UserProfile,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';

interface OperationsControlCenterProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  operationalCases: OperationalCase[];
  settings: OperationalSettings;
  usersList: UserProfile[];
  currentUser: UserProfile;
  allowedUids: string[];
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

const PRIORITY_LABELS: Record<OperationalCasePriority, string> = {
  critical: 'حرج',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
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

  // Case Editor Modal State (Create or Update)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<OperationalCase | null>(null);
  const [formPlatform, setFormPlatform] = useState<Platform>('hungerstation');
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

  const interventionQueue = useMemo(
    () => buildInterventionQueue(dataset, filteredRows, dictionaryEntries, settings, operationalCases),
    [dataset, filteredRows, dictionaryEntries, settings, operationalCases]
  );

  const filteredQueue = useMemo(() => {
    if (reasonFilter === 'all') return interventionQueue;
    return interventionQueue.filter((c) => c.reasonType === reasonFilter);
  }, [interventionQueue, reasonFilter]);

  const openCases = operationalCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved');
  const overdueCases = operationalCases.filter((c) => isCaseOverdue(c, overdueDays));
  const resolvedClosedCases = operationalCases.filter((c) => c.status === 'resolved' || c.status === 'closed');

  const filteredCases = useMemo(() => {
    return operationalCases
      .filter((c) => {
        if (caseViewFilter === 'open') return c.status !== 'closed' && c.status !== 'resolved';
        if (caseViewFilter === 'overdue') return isCaseOverdue(c, overdueDays);
        if (caseViewFilter === 'mine') return (c.assigneeEmail || '').toLowerCase() === currentUser.email.toLowerCase();
        if (caseViewFilter === 'closed') return c.status === 'closed' || c.status === 'resolved';
        return true;
      })
      .sort((a, b) => b.registeredDate.localeCompare(a.registeredDate));
  }, [operationalCases, caseViewFilter, overdueDays, currentUser.email]);

  const openNewCaseFromCandidate = (cand: InterventionCandidate) => {
    if (cand.existingCase) {
      openEditCase(cand.existingCase);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const dueDt = new Date(Date.now() + overdueDays * 86400000).toISOString().slice(0, 10);
    setEditingCase(null);
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
    setModalOpen(true);
    setMsg(null);
  };

  const openBlankCase = () => {
    const dueDt = new Date(Date.now() + overdueDays * 86400000).toISOString().slice(0, 10);
    setEditingCase(null);
    setFormPlatform('hungerstation');
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
    setModalOpen(true);
    setMsg(null);
  };

  const openEditCase = (c: OperationalCase) => {
    setEditingCase(c);
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
    setModalOpen(true);
    setMsg(null);
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !formRiderId.trim() || !formTitle.trim()) return;
    setBusy(true);
    setMsg(null);
    const today = new Date().toISOString().slice(0, 10);
    const caseId =
      editingCase?.caseId ||
      `opcase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      setModalOpen(false);
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
        <span
          className={`font-semibold ${
            r.severity === 'critical'
              ? 'text-red-700 dark:text-red-400'
              : r.severity === 'high'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-slate-700 dark:text-slate-300'
          }`}
        >
          {r.severity === 'critical' ? 'حرج' : r.severity === 'high' ? 'مرتفع' : 'متوسط'}
        </span>
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
        <span>
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
      render: (r) => <span className="font-mono-num text-xs">{r.metricSummary}</span>,
    },
    {
      key: 'date',
      header: 'آخر تاريخ',
      sortValue: (r) => r.latestDate,
      render: (r) => <span className="font-mono-num">{r.latestDate}</span>,
    },
    {
      key: 'action',
      header: 'المتابعة',
      align: 'center',
      render: (r) =>
        canManage ? (
          <button
            type="button"
            onClick={() => openNewCaseFromCandidate(r)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
              r.existingCase
                ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-900 hover:text-white dark:hover:bg-blue-600'
            }`}
          >
            {r.existingCase ? `تحديث (${STATUS_LABELS[r.existingCase.status]})` : 'فتح حالة تشغيلية'}
          </button>
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
      render: (c) => (
        <span
          className={`font-semibold ${
            c.priority === 'critical'
              ? 'text-red-700 dark:text-red-400'
              : c.priority === 'high'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-slate-700 dark:text-slate-300'
          }`}
        >
          {PRIORITY_LABELS[c.priority]}
        </span>
      ),
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
          <div className="space-y-0.5">
            <span
              className={`font-semibold ${
                c.status === 'resolved' || c.status === 'closed'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : c.status === 'in_progress'
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {STATUS_LABELS[c.status]}
            </span>
            {overdue && <div className="text-[10px] font-bold text-red-700 dark:text-red-400">متأخرة عن الموعد</div>}
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
          <button
            type="button"
            onClick={() => openEditCase(c)}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-900 hover:text-white dark:hover:bg-blue-600"
          >
            متابعة
          </button>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">مركز التحكم التشغيلي والحالات (Operations Control Center)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            رصد يومي للمندوبين المتطلبين لتدخل فوري مع نظام متكامل لإدارة دورة حياة الحالات التشغيلية.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openBlankCase}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>فتح حالة تشغيلية يدوية</span>
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            msg.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200'
              : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200'
          }`}
        >
          {msg.text}
        </div>
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

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('queue')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'queue'
                ? 'bg-slate-900 dark:bg-blue-600 text-white'
                : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>طابور التدخل اليومي ({interventionQueue.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('cases')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              tab === 'cases'
                ? 'bg-slate-900 dark:bg-blue-600 text-white'
                : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>سجل الحالات التشغيلية ({operationalCases.length})</span>
          </button>
        </div>

        {tab === 'queue' ? (
          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100"
          >
            <option value="all">كل أسباب التدخل (7 محاور)</option>
            <option value="low_hours">انخفاض ساعات العمل</option>
            <option value="low_orders">انخفاض الطلبات</option>
            <option value="high_rejection_cancel">ارتفاع الرفض أو الإلغاء</option>
            <option value="repeated_overdue">تكرار التأخير Overdue</option>
            <option value="poor_attendance">ضعف الالتزام بالورديات</option>
            <option value="error_codes">أكواد أخطاء هنقرستيشن</option>
            <option value="facial_failure">فشل التحقق من الهوية</option>
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'open', label: 'المفتوحة' },
              { id: 'overdue', label: `المتأخرة (${overdueCases.length})` },
              { id: 'mine', label: 'المعيّنة لي' },
              { id: 'closed', label: 'المغلقة/المعالجة' },
              { id: 'all', label: 'الكل' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCaseViewFilter(f.id as typeof caseViewFilter)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  caseViewFilter === f.id
                    ? 'bg-slate-900 dark:bg-blue-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
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

      {/* Case Workflow Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {editingCase ? `إدارة الحالة: ${editingCase.caseId}` : 'فتح حالة تشغيلية جديدة'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editingCase?.status === 'closed' && !canReopenClosed && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>الحالة مغلقة. إعادة فتح أو تعديل حالة مغلقة متاح فقط لمدير العمليات أو الإدارة.</span>
              </div>
            )}

            <form onSubmit={handleSaveCase} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">المنصة</label>
                  <select
                    value={formPlatform}
                    disabled={Boolean(editingCase)}
                    onChange={(e) => setFormPlatform(e.target.value as Platform)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    <option value="hungerstation">HungerStation</option>
                    <option value="keeta">Keeta</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">معرف المندوب</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingCase)}
                    value={formRiderId}
                    onChange={(e) => setFormRiderId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">تاريخ الاستحقاق (SLA)</label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">عنوان الحالة</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="مثال: انخفاض عدد الطلبات أو تكرار كود خطأ"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">المسؤول عن المتابعة</label>
                  <input
                    type="text"
                    list="ops-users-emails"
                    value={formAssignee}
                    onChange={(e) => setFormAssignee(e.target.value)}
                    placeholder="البريد الإلكتروني للمشرف..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono-num text-slate-900 dark:text-slate-100"
                  />
                  <datalist id="ops-users-emails">
                    {usersList.filter((u) => u.active).map((u) => (
                      <option key={u.uid} value={u.email} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">الأولوية</label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value as OperationalCasePriority)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    <option value="critical">حرج (Critical)</option>
                    <option value="high">مرتفع (High)</option>
                    <option value="medium">متوسط (Medium)</option>
                    <option value="low">منخفض (Low)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">مرحلة المعالجة</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as OperationalCaseStatus)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    <option value="new">جديدة (New)</option>
                    <option value="under_review">قيد المراجعة (Under Review)</option>
                    <option value="in_progress">قيد المعالجة (In Progress)</option>
                    <option value="resolved">تمت المعالجة (Resolved)</option>
                    <option value="closed">مغلقة (Closed)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">الفرع / المدينة</label>
                  <input
                    type="text"
                    value={formBranch}
                    onChange={(e) => setFormBranch(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">وصف المؤشر / المشكلة</label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">الإجراء المتخذ</label>
                  <input
                    type="text"
                    value={formActionTaken}
                    onChange={(e) => setFormActionTaken(e.target.value)}
                    placeholder="التواصل الهاتفي / تنبيه المشرف / إعادة جدولة..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">ملاحظات الإشراف</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="تفاصيل المتابعة أو سبب الإغلاق..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busy || (editingCase?.status === 'closed' && !canReopenClosed)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{busy ? 'جاري الحفظ...' : 'حفظ الحالة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
