import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardPlus,
  FileSearch,
  GitCompare,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  computeErrorCodeIntelligence,
  generateErrorIntelligenceAlerts,
  type AffectedRiderCodeSummary,
  type ErrorCodeAggregate,
  type HungerErrorEvent,
  type PerCodeCorrelationRow,
} from '../lib/errorIntelligence';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { fmtNum, fmtPct, type FleetDataset } from '../lib/fleetAnalytics';
import { makeErrorCodeKey, normalizeErrorCode } from '../shared/errorCodeParser';
import type {
  AlertItem,
  ErrorCodeDictionaryEntry,
  ErrorCodeSeverity,
  FilterState,
  OperationalCase,
  OperationalSettings,
  Platform,
  RiderErrorCase,
  UserProfile,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
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
  StatusBadge,
  Tabs,
  Textarea,
  ToastBanner,
  type BadgeTone,
} from './ui/EnterpriseUI';

type SubTab = 'dashboard' | 'detail' | 'correlation' | 'traceability' | 'dictionary';

interface ErrorIntelligenceCenterProps {
  dataset: FleetDataset;
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  riderErrorCases: RiderErrorCase[];
  operationalCases?: OperationalCase[];
  settings: OperationalSettings;
  filters: FilterState;
  currentUser: UserProfile;
  allowedUids: string[];
  onSelectRider: (platform: Platform, riderId: string) => void;
  onGoToSettings: () => void;
  onGoToOperations?: () => void;
  onRefresh: () => Promise<void>;
}

const SEVERITY_LABELS: Record<ErrorCodeSeverity, string> = {
  critical: 'حرج (Critical)',
  high: 'مرتفع (High)',
  medium: 'متوسط (Medium)',
  low: 'منخفض (Low)',
  unknown: 'غير محدد (Unknown)',
};

function severityBadgeTone(sev: ErrorCodeSeverity): BadgeTone {
  if (sev === 'critical') return 'danger';
  if (sev === 'high' || sev === 'medium') return 'warning';
  if (sev === 'low') return 'success';
  return 'neutral';
}

const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح للمتابعة',
  in_review: 'قيد المراجعة',
  resolved: 'تمت المعالجة',
};

export function ErrorIntelligenceCenter({
  dataset,
  dictionaryEntries,
  riderErrorCases,
  operationalCases = [],
  settings,
  filters,
  currentUser,
  allowedUids,
  onSelectRider,
  onGoToSettings,
  onGoToOperations,
  onRefresh,
}: ErrorIntelligenceCenterProps) {
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [selectedCodeKey, setSelectedCodeKey] = useState<string>('');
  const [geoView, setGeoView] = useState<'city' | 'branch'>('city');

  const canEditDict =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager' ||
    currentUser.role === 'supervisor';
  const canDeleteDict = currentUser.role === 'owner' || currentUser.role === 'admin';

  const [dictForm, setDictForm] = useState({
    normalizedCode: '',
    rawExamples: '',
    arabicDescription: '',
    englishDescription: '',
    category: 'غير مصنف',
    severity: 'unknown' as ErrorCodeSeverity,
    recommendedAction: '',
    verifiedStatus: 'verified' as 'verified' | 'unverified',
    notes: '',
  });
  const [dictBusy, setDictBusy] = useState(false);
  const [dictMsg, setDictMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [opCaseBusyKey, setOpCaseBusyKey] = useState<string | null>(null);
  const [opCaseMsg, setOpCaseMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ErrorCodeDictionaryEntry | null>(null);

  const report = useMemo(
    () => computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, filters),
    [dataset, dictionaryEntries, riderErrorCases, filters]
  );

  const smartAlerts = useMemo(
    () => generateErrorIntelligenceAlerts(report, settings),
    [report, settings]
  );

  const openOpCaseRiders = useMemo(() => {
    const map = new Map<string, OperationalCase>();
    for (const c of operationalCases) {
      if (c.status !== 'closed' && c.status !== 'resolved') {
        map.set(`${c.platform}:${c.riderId}`, c);
      }
    }
    return map;
  }, [operationalCases]);

  const activeDetail: ErrorCodeAggregate | null = useMemo(() => {
    if (report.codes.length === 0) return null;
    if (selectedCodeKey) {
      const found = report.codes.find((c) => c.codeKey === selectedCodeKey);
      if (found) return found;
    }
    return report.codes[0];
  }, [report.codes, selectedCodeKey]);

  const openCodeDetail = (codeKey: string) => {
    setSelectedCodeKey(codeKey);
    setSubTab('detail');
  };

  const openCodeInDictionary = (agg: ErrorCodeAggregate) => {
    const existing = agg.dictionary;
    setDictForm({
      normalizedCode: agg.normalizedCode,
      rawExamples: existing?.rawExamples || agg.rawExamples.join(', ').slice(0, 400),
      arabicDescription: existing?.arabicDescription === 'Unknown Code' ? '' : (existing?.arabicDescription || ''),
      englishDescription: existing?.englishDescription || '',
      category: existing?.category || 'غير مصنف',
      severity: existing?.severity || 'medium',
      recommendedAction: existing?.recommendedAction || '',
      verifiedStatus: existing?.verifiedStatus || 'verified',
      notes: existing?.notes || '',
    });
    setDictMsg(null);
    setSubTab('dictionary');
  };

  const editDictionaryEntry = (entry: ErrorCodeDictionaryEntry) => {
    setDictForm({
      normalizedCode: entry.normalizedCode,
      rawExamples: entry.rawExamples || '',
      arabicDescription: entry.arabicDescription,
      englishDescription: entry.englishDescription || '',
      category: entry.category || 'غير مصنف',
      severity: entry.severity,
      recommendedAction: entry.recommendedAction || '',
      verifiedStatus: entry.verifiedStatus,
      notes: entry.notes || '',
    });
    setDictMsg(null);
    setSubTab('dictionary');
  };

  const handleCreateOperationalCaseFromError = async (params: {
    key: string;
    riderId: string;
    riderName: string;
    branch: string;
    normalizedCode: string;
    rawRef: string;
    severity?: ErrorCodeSeverity;
    recommendedAction?: string;
  }) => {
    if (!canEditDict) return;
    setOpCaseBusyKey(params.key);
    setOpCaseMsg(null);
    const today = new Date().toISOString().slice(0, 10);
    const dueDays = settings.caseOverdueDays ?? 3;
    const dueDt = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
    const caseId = `opcase_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
    const priority =
      params.severity === 'critical'
        ? 'critical'
        : params.severity === 'high'
          ? 'high'
          : 'medium';

    try {
      await setDoc(doc(db, 'operationalCases', caseId), {
        caseId,
        riderId: params.riderId.slice(0, 64),
        platform: 'hungerstation',
        riderName: (params.riderName || params.riderId).slice(0, 150),
        branch: (params.branch || '').slice(0, 120),
        issueType: 'hungerstation_error_code',
        title: `متابعة كود خطأ ${params.normalizedCode} للمندوب ${params.riderId}`.slice(0, 200),
        description: `مرجع خام: ${params.rawRef}${params.recommendedAction ? ` | إجراء مقترح: ${params.recommendedAction}` : ''}`.slice(0, 1200),
        priority,
        status: 'new',
        assigneeEmail: currentUser.email.slice(0, 200),
        actionTaken: '',
        notes: '',
        registeredDate: today,
        dueDate: dueDt,
        closedDate: '',
        sourceRef: `error:${params.normalizedCode}`,
        updatedByEmail: currentUser.email.slice(0, 200),
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'OPERATIONAL_CASE_CREATED',
        targetCollection: 'operationalCases',
        targetId: caseId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `إنشاء حالة متابعة تشغيلية من كود الخطأ ${params.normalizedCode} للمندوب ${params.riderId}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });

      setOpCaseMsg({ type: 'ok', text: `تم إنشاء حالة متابعة تشغيلية للمندوب ${params.riderId} (${caseId}).` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `operationalCases/${caseId}`);
      } catch (wrapped) {
        setOpCaseMsg({
          type: 'err',
          text: wrapped instanceof Error ? wrapped.message : 'تعذر إنشاء الحالة التشغيلية.',
        });
      }
    } finally {
      setOpCaseBusyKey(null);
    }
  };

  const handleSaveDictionary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditDict) return;
    const normCode = normalizeErrorCode(dictForm.normalizedCode);
    if (!normCode || !dictForm.arabicDescription.trim()) {
      setDictMsg({ type: 'err', text: 'يرجى إدخال الكود الموحد والوصف المعتمد باللغة العربية.' });
      return;
    }
    const codeKey = makeErrorCodeKey(normCode);
    const existingEntry = dictionaryEntries.find((d) => d.codeKey === codeKey);
    setDictBusy(true);
    setDictMsg(null);

    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(
        doc(db, 'hungerErrorDictionary', codeKey),
        {
          codeKey,
          normalizedCode: normCode.slice(0, 200),
          rawExamples: dictForm.rawExamples.trim().slice(0, 400),
          arabicDescription: dictForm.arabicDescription.trim().slice(0, 500),
          englishDescription: dictForm.englishDescription.trim().slice(0, 500),
          category: dictForm.category.trim().slice(0, 120) || 'غير مصنف',
          severity: dictForm.severity,
          recommendedAction: dictForm.recommendedAction.trim().slice(0, 800),
          verifiedStatus: dictForm.verifiedStatus,
          notes: dictForm.notes.trim().slice(0, 1000),
          updatedByEmail: currentUser.email.slice(0, 200),
          createdByUid: existingEntry?.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          createdAt: existingEntry?.createdAt ? existingEntry.createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: Boolean(existingEntry) }
      );

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: existingEntry ? 'ERROR_DICT_UPDATED' : 'ERROR_DICT_CREATED',
        targetCollection: 'hungerErrorDictionary',
        targetId: codeKey,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `${existingEntry ? 'تحديث' : 'توثيق'} كود الخطأ ${normCode} (${dictForm.severity} · ${dictForm.verifiedStatus})`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });

      setDictMsg({ type: 'ok', text: `تم حفظ تعريف الكود ${normCode} في قاموس الأخطاء بنجاح.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `hungerErrorDictionary/${codeKey}`);
      } catch (wrapped) {
        setDictMsg({
          type: 'err',
          text: wrapped instanceof Error ? wrapped.message : 'تعذر حفظ تعريف الكود.',
        });
      }
    } finally {
      setDictBusy(false);
    }
  };

  const confirmDeleteDictEntry = async () => {
    if (!deleteTarget || !canDeleteDict) return;
    setDictBusy(true);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await deleteDoc(doc(db, 'hungerErrorDictionary', deleteTarget.codeKey));
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'ERROR_DICT_DELETED',
        targetCollection: 'hungerErrorDictionary',
        targetId: deleteTarget.codeKey,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `حذف تعريف الكود ${deleteTarget.normalizedCode} من قاموس الأخطاء`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setDeleteTarget(null);
      setDictMsg({ type: 'ok', text: `تم حذف ${deleteTarget.normalizedCode} من القاموس.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `hungerErrorDictionary/${deleteTarget.codeKey}`);
      } catch (wrapped) {
        setDictMsg({
          type: 'err',
          text: wrapped instanceof Error ? wrapped.message : 'تعذر حذف التعريف.',
        });
      }
    } finally {
      setDictBusy(false);
    }
  };

  const codeSummaryCols: TableColumn<ErrorCodeAggregate>[] = [
    {
      key: 'code',
      header: 'الكود الموحد',
      sortValue: (r) => r.normalizedCode,
      render: (r) => (
        <div>
          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.normalizedCode}</div>
          <div className="text-[11px] font-mono-num text-slate-400 truncate max-w-[180px]">
            Raw: {r.rawExamples.join(' | ')}
          </div>
        </div>
      ),
    },
    {
      key: 'desc',
      header: 'الوصف المعتمد',
      sortValue: (r) => r.displayTitle,
      render: (r) => (
        <div>
          <div className={`text-xs font-semibold ${r.isVerified ? 'text-slate-900 dark:text-slate-100' : 'text-amber-700 dark:text-amber-400'}`}>
            {r.displayTitle}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.category}</div>
        </div>
      ),
    },
    {
      key: 'sev',
      header: 'الخطورة',
      sortValue: (r) => r.severity,
      render: (r) => <StatusBadge label={SEVERITY_LABELS[r.severity]} tone={severityBadgeTone(r.severity)} />,
    },
    {
      key: 'occ',
      header: 'مرات الظهور',
      align: 'center',
      sortValue: (r) => r.occurrenceCount,
      render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtNum(r.occurrenceCount)}</span>,
    },
    {
      key: 'riders',
      header: 'المندوبون المتأثرون',
      align: 'center',
      sortValue: (r) => r.affectedRidersCount,
      render: (r) => <span className="font-mono-num text-slate-800 dark:text-slate-200">{fmtNum(r.affectedRidersCount)}</span>,
    },
    {
      key: 'repeat',
      header: 'تكرار لنفس المندوب',
      align: 'center',
      sortValue: (r) => r.repeatedRidersCount,
      render: (r) => (
        <span className={`font-mono-num font-semibold ${r.repeatedRidersCount > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {fmtNum(r.repeatedRidersCount)} ({fmtPct(r.repeatSharePct)})
        </span>
      ),
    },
    {
      key: 'firstLast',
      header: 'أول / آخر ظهور',
      sortValue: (r) => r.lastSeenDate,
      render: (r) => (
        <span className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
          {r.firstSeenDate} → {r.lastSeenDate}
        </span>
      ),
    },
    {
      key: 'topCity',
      header: 'أعلى مدينة تأثرًا',
      render: (r) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {r.cityBreakdown[0] ? `${r.cityBreakdown[0].name} (${r.cityBreakdown[0].count})` : '-'}
        </span>
      ),
    },
  ];

  const alertCols: TableColumn<AlertItem>[] = [
    {
      key: 'sev',
      header: 'المستوى',
      sortValue: (r) => r.severity,
      render: (r) => (
        <StatusBadge
          label={r.severity === 'critical' ? 'حرج' : 'تحذير'}
          tone={r.severity === 'critical' ? 'danger' : 'warning'}
        />
      ),
    },
    { key: 'cat', header: 'نوع التنبيه', sortValue: (r) => r.category, render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-200">{r.category}</span> },
    { key: 'title', header: 'التنبيه', render: (r) => <span className="font-semibold text-slate-900 dark:text-slate-100">{r.title}</span> },
    { key: 'desc', header: 'التفاصيل', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300 whitespace-normal block max-w-md">{r.description}</span> },
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num text-xs">{r.date}</span> },
  ];

  const detailRiderCols: TableColumn<AffectedRiderCodeSummary>[] = [
    { key: 'riderId', header: 'ID المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم / المعرف الداخلي', render: (r) => <span>{r.riderName} {r.internalRiderId ? `(${r.internalRiderId})` : ''}</span> },
    { key: 'loc', header: 'المدينة / الفرع', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.city} · {r.branch}</span> },
    {
      key: 'occ',
      header: 'التكرار',
      align: 'center',
      sortValue: (r) => r.occurrences,
      render: (r) => (
        <span className={`font-mono-num font-bold ${r.occurrences >= 2 ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
          {fmtNum(r.occurrences)}
        </span>
      ),
    },
    { key: 'dates', header: 'التواريخ المسجلة', render: (r) => <span className="font-mono-num text-xs text-slate-600 dark:text-slate-300">{r.dates.join(', ')}</span> },
    {
      key: 'case',
      header: 'حالة المتابعة',
      render: (r) => (
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {r.latestCaseStatus ? CASE_STATUS_LABELS[r.latestCaseStatus] || r.latestCaseStatus : 'لم تُسجّل متابعة'}
        </span>
      ),
    },
    ...(canEditDict
      ? [
          {
            key: 'createOpCase',
            header: 'إجراء',
            render: (r: AffectedRiderCodeSummary) => {
              const existingOp = openOpCaseRiders.get(`hungerstation:${r.riderId}`);
              if (existingOp) {
                return (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToOperations?.();
                    }}
                  >
                    حالة مفتوحة
                  </Button>
                );
              }
              const busyKey = `detail_${r.riderId}`;
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={opCaseBusyKey === busyKey}
                  icon={<ClipboardPlus className="h-3.5 w-3.5" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!activeDetail) return;
                    void handleCreateOperationalCaseFromError({
                      key: busyKey,
                      riderId: r.riderId,
                      riderName: r.riderName,
                      branch: r.branch,
                      normalizedCode: activeDetail.normalizedCode,
                      rawRef: `${activeDetail.normalizedCode} (${r.occurrences} مرات)`,
                      severity: activeDetail.severity,
                      recommendedAction: activeDetail.recommendedAction,
                    });
                  }}
                >
                  إنشاء حالة متابعة
                </Button>
              );
            },
          } as TableColumn<AffectedRiderCodeSummary>,
        ]
      : []),
  ];

  const corrCols: TableColumn<PerCodeCorrelationRow>[] = [
    { key: 'code', header: 'الكود', sortValue: (r) => r.normalizedCode, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.normalizedCode}</span> },
    { key: 'title', header: 'الوصف', render: (r) => <span className="text-xs">{r.displayTitle}</span> },
    { key: 'rows', header: 'أيام الظهور', align: 'center', sortValue: (r) => r.rowCount, render: (r) => <span className="font-mono-num">{fmtNum(r.rowCount)}</span> },
    {
      key: 'orders',
      header: 'متوسط الطلبات (الفرق عن السليم)',
      align: 'center',
      sortValue: (r) => r.avgCompletedDeliveries,
      render: (r) => (
        <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
          {fmtNum(r.avgCompletedDeliveries, 1)}{' '}
          {r.deltaOrdersVsClean !== null && (
            <span className={r.deltaOrdersVsClean < 0 ? 'text-red-700 dark:text-red-400 text-xs' : 'text-emerald-700 dark:text-emerald-400 text-xs'}>
              ({r.deltaOrdersVsClean >= 0 ? '+' : ''}{r.deltaOrdersVsClean.toFixed(1)})
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'att',
      header: 'متوسط الحضور % (الفرق)',
      align: 'center',
      sortValue: (r) => r.avgAttendanceRate,
      render: (r) => (
        <span className="font-mono-num">
          {fmtPct(r.avgAttendanceRate)}{' '}
          {r.deltaAttendanceVsClean !== null && (
            <span className={r.deltaAttendanceVsClean < 0 ? 'text-red-700 dark:text-red-400 text-xs' : 'text-emerald-700 dark:text-emerald-400 text-xs'}>
              ({r.deltaAttendanceVsClean >= 0 ? '+' : ''}{r.deltaAttendanceVsClean.toFixed(1)}%)
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'hrs',
      header: 'متوسط ساعات العمل (الفرق)',
      align: 'center',
      sortValue: (r) => r.avgWorkingHours,
      render: (r) => (
        <span className="font-mono-num">
          {fmtNum(r.avgWorkingHours, 1)} س{' '}
          {r.deltaHoursVsClean !== null && (
            <span className={r.deltaHoursVsClean < 0 ? 'text-red-700 dark:text-red-400 text-xs' : 'text-emerald-700 dark:text-emerald-400 text-xs'}>
              ({r.deltaHoursVsClean >= 0 ? '+' : ''}{r.deltaHoursVsClean.toFixed(1)})
            </span>
          )}
        </span>
      ),
    },
    { key: 'acc', header: 'معدل القبول %', align: 'center', sortValue: (r) => r.avgAcceptanceRate, render: (r) => <span className="font-mono-num">{fmtPct(r.avgAcceptanceRate)}</span> },
    { key: 'can', header: 'نسبة الإلغاء %', align: 'center', sortValue: (r) => r.cancellationRatePct, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtPct(r.cancellationRatePct)}</span> },
  ];

  const traceCols: TableColumn<HungerErrorEvent>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'rider', header: 'المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId} · {r.riderName}</span> },
    { key: 'norm', header: 'الكود الموحد', sortValue: (r) => r.normalizedCode, render: (r) => <span className="font-mono-num font-bold text-red-700 dark:text-red-400">{r.normalizedCode}</span> },
    { key: 'rawCode', header: 'Raw Code', render: (r) => <span className="font-mono-num text-xs">{r.rawCode}</span> },
    { key: 'rawCell', header: 'الخلية الأصلية (Raw Cell)', render: (r) => <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400 max-w-[160px] truncate block">{r.rawCell}</span> },
    {
      key: 'src',
      header: 'مصدر السجل (File / Sheet / Row)',
      render: (r) => (
        <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
          {r.sourceFile || '-'} / {r.sourceSheet || '-'} #{r.sourceRowNumber || '-'}
        </span>
      ),
    },
    ...(canEditDict
      ? [
          {
            key: 'action',
            header: 'متابعة',
            render: (r: HungerErrorEvent) => {
              const existingOp = openOpCaseRiders.get(`hungerstation:${r.riderId}`);
              if (existingOp) {
                return (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToOperations?.();
                    }}
                  >
                    حالة مفتوحة
                  </Button>
                );
              }
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={opCaseBusyKey === r.eventKey}
                  icon={<ClipboardPlus className="h-3.5 w-3.5" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCreateOperationalCaseFromError({
                      key: r.eventKey,
                      riderId: r.riderId,
                      riderName: r.riderName,
                      branch: r.branch,
                      normalizedCode: r.normalizedCode,
                      rawRef: `${r.rawCell} (${r.sourceFile} #${r.sourceRowNumber})`,
                      severity: r.dictionaryEntry?.severity,
                      recommendedAction: r.dictionaryEntry?.recommendedAction,
                    });
                  }}
                >
                  إنشاء حالة متابعة
                </Button>
              );
            },
          } as TableColumn<HungerErrorEvent>,
        ]
      : []),
  ];

  const dictCols: TableColumn<ErrorCodeDictionaryEntry>[] = [
    { key: 'code', header: 'الكود الموحد', sortValue: (r) => r.normalizedCode, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.normalizedCode}</span> },
    { key: 'ar', header: 'الوصف العربي المعتمد', render: (r) => <span className="font-semibold text-slate-900 dark:text-slate-100">{r.arabicDescription}</span> },
    { key: 'cat', header: 'التصنيف', sortValue: (r) => r.category, render: (r) => <span className="text-xs text-slate-700 dark:text-slate-300">{r.category || '-'}</span> },
    { key: 'sev', header: 'الشدة', sortValue: (r) => r.severity, render: (r) => <StatusBadge label={SEVERITY_LABELS[r.severity]} tone={severityBadgeTone(r.severity)} /> },
    {
      key: 'status',
      header: 'حالة التحقق',
      align: 'center',
      sortValue: (r) => r.verifiedStatus,
      render: (r) => (
        <StatusBadge
          label={r.verifiedStatus === 'verified' ? 'موثق' : 'غير موثق'}
          tone={r.verifiedStatus === 'verified' ? 'success' : 'warning'}
        />
      ),
    },
    { key: 'action', header: 'الإجراء التشغيلي المقترح', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300 whitespace-normal block max-w-xs">{r.recommendedAction || '-'}</span> },
    {
      key: 'ops',
      header: 'إدارة',
      render: (r) => (
        <div className="flex items-center gap-2">
          {canEditDict && (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                editDictionaryEntry(r);
              }}
            >
              تعديل
            </Button>
          )}
          {canDeleteDict && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(r);
              }}
              className="rounded-lg p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              title="حذف"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const topChartData = report.top10Codes.map((c) => ({
    code: c.normalizedCode,
    occurrences: c.occurrenceCount,
    riders: c.affectedRidersCount,
  }));

  const geoChartData =
    geoView === 'city'
      ? report.cityDistribution.slice(0, 10).map((c) => ({ name: c.city, errors: c.errors, riders: c.affectedRiders }))
      : report.branchDistribution.slice(0, 10).map((b) => ({ name: b.branch, errors: b.errors, riders: b.affectedRiders }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="مركز تحليل ومراقبة أكواد أخطاء هنقرستيشن"
        subtitle="تحليل حتمي لعمود Error Codes في Hunger-Daily مع حفظ القيمة الأصلية وتوحيد الأكواد دون افتراض معانٍ غير موثقة."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success" className="font-mono-num" label={`موثق: ${report.verifiedCodesCount}`} />
            <StatusBadge tone={report.unknownCodesCount > 0 ? 'warning' : 'neutral'} className="font-mono-num" label={`غير موثق: ${report.unknownCodesCount}`} />
            <StatusBadge
              tone="info"
              className="font-mono-num"
              label={
                report.delimiterProfile.detectedDelimiters.length > 0
                  ? `فواصل: ${report.delimiterProfile.detectedDelimiters.join(', ')}`
                  : 'تنسيق مفرد'
              }
            />
          </div>
        }
      />

      <Tabs<SubTab>
        variant="underline"
        activeKey={subTab}
        onChange={setSubTab}
        items={[
          { key: 'dashboard', label: 'لوحة مراقبة الأخطاء', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
          { key: 'detail', label: 'تفاصيل كود الخطأ', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
          { key: 'correlation', label: 'التحليل والارتباط التشغيلي', icon: <GitCompare className="h-3.5 w-3.5" /> },
          { key: 'traceability', label: 'تتبع السجلات الخام', count: report.events.length, icon: <FileSearch className="h-3.5 w-3.5" /> },
          { key: 'dictionary', label: 'قاموس الأكواد', count: dictionaryEntries.length, icon: <BookOpen className="h-3.5 w-3.5" /> },
        ]}
      />

      {opCaseMsg && (
        <ToastBanner
          type={opCaseMsg.type}
          message={opCaseMsg.text}
          onDismiss={() => setOpCaseMsg(null)}
        />
      )}

      {/* SUBTAB 1: ERROR INTELLIGENCE DASHBOARD */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              label="إجمالي حالات الأخطاء"
              value={fmtNum(report.totalErrorEvents)}
              tone={report.totalErrorEvents > 0 ? 'warn' : 'good'}
            />
            <KpiCard
              label="الأكواد المختلفة"
              value={fmtNum(report.distinctCodesCount)}
              subtext={`موثق ${report.verifiedCodesCount} · غير موثق ${report.unknownCodesCount}`}
            />
            <KpiCard
              label="المندوبون المتأثرون"
              value={fmtNum(report.affectedRidersCount)}
              subtext={`بتكرار لنفس الكود: ${report.repeatedRidersTotalCount}`}
              tone={report.repeatedRidersTotalCount > 0 ? 'critical' : 'neutral'}
            />
            <KpiCard
              label="السجلات المتأثرة (أيام)"
              value={fmtNum(report.affectedRowsCount)}
              subtext={`من أصل ${fmtNum(report.totalHungerDailyRows)} سجل يومي`}
            />
            <KpiCard
              label="معدل السجلات ذات الأخطاء"
              value={fmtPct(report.errorRowRatePct)}
              tone={report.errorRowRatePct > 10 ? 'critical' : 'neutral'}
            />
            <KpiCard
              label="تنبيهات الأخطاء الذكية"
              value={fmtNum(smartAlerts.length)}
              tone={smartAlerts.some((a) => a.severity === 'critical') ? 'critical' : smartAlerts.length > 0 ? 'warn' : 'good'}
            />
          </div>

          <Card>
            <SectionHeader
              title="مقارنة معدلات الأخطاء بين الفترات"
              subtitle={
                report.periodComparison.hasComparison
                  ? `مقارنة (${report.periodComparison.currentLabel}) مقابل (${report.periodComparison.previousLabel})`
                  : 'يلزم توفر يومين أو شهرين على الأقل في بيانات Hunger-Daily لإجراء مقارنة فترية.'
              }
              actions={
                report.periodComparison.hasComparison && (
                  <div className="flex flex-wrap items-center gap-6 font-mono-num text-xs">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">حالات الفترة الحالية / السابقة</div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{fmtNum(report.periodComparison.currentErrors)} / {fmtNum(report.periodComparison.previousErrors)}</span>
                        {report.periodComparison.errorDeltaPct !== null && (
                          <StatusBadge
                            tone={report.periodComparison.errorDeltaPct > 0 ? 'danger' : 'success'}
                            label={`${report.periodComparison.errorDeltaPct > 0 ? '+' : ''}${report.periodComparison.errorDeltaPct}%`}
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">معدل الأيام المتأثرة (الحالي / السابق)</div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{fmtPct(report.periodComparison.currentErrorRatePct)} / {fmtPct(report.periodComparison.previousErrorRatePct)}</span>
                        <StatusBadge
                          tone={report.periodComparison.rateDeltaPts > 0 ? 'danger' : 'success'}
                          label={`${report.periodComparison.rateDeltaPts > 0 ? '+' : ''}${report.periodComparison.rateDeltaPts} نقطة`}
                        />
                      </div>
                    </div>
                  </div>
                )
              }
            />
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="space-y-4">
              <SectionHeader title="أكثر 10 أكواد خطأ تكرارًا" />
              {topChartData.length === 0 ? (
                <EmptyState title="لا توجد أكواد أخطاء مسجلة في النطاق المحدد" />
              ) : (
                <div className="h-72 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                      <XAxis dataKey="code" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="occurrences" name="مرات الظهور" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="riders" name="المندوبون" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="space-y-4">
              <SectionHeader title="التوزيع اليومي لحالات الأخطاء" />
              {report.dailyDistribution.length === 0 ? (
                <EmptyState title="لا توجد بيانات يومية متاحة" />
              ) : (
                <div className="h-72 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={report.dailyDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="errors" name="حالات الأخطاء" stroke="#dc2626" strokeWidth={2} />
                      <Line type="monotone" dataKey="affectedRows" name="السجلات المتأثرة" stroke="#2563eb" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2 space-y-4">
              <SectionHeader
                title="توزيع الأخطاء حسب المدينة والفرع"
                actions={
                  <Tabs
                    variant="segmented"
                    activeKey={geoView}
                    onChange={setGeoView}
                    items={[
                      { key: 'city', label: 'حسب المدينة' },
                      { key: 'branch', label: 'حسب الفرع (Master)' },
                    ]}
                  />
                }
              />
              {geoChartData.length === 0 ? (
                <EmptyState title="لا توجد بيانات توزيع جغرافي" />
              ) : (
                <div className="h-64 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={geoChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="errors" name="حالات الأخطاء" fill="#0f1e36" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="riders" name="المندوبون" fill="#d97706" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  الأكواد الجديدة / غير الموثقة ({report.newCodes.length})
                </h3>
                <div className="mt-2 max-h-32 overflow-y-auto erp-scroll divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.newCodes.length === 0 ? (
                    <div className="py-3 text-slate-400">جميع الأكواد المرصودة موثقة ومستقرة.</div>
                  ) : (
                    report.newCodes.slice(0, 8).map((c) => (
                      <button
                        key={c.codeKey}
                        type="button"
                        onClick={() => openCodeDetail(c.codeKey)}
                        className="flex w-full items-center justify-between py-2 px-1.5 text-right rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{c.normalizedCode}</span>
                        <StatusBadge tone="warning" className="font-mono-num" label={`${c.occurrenceCount}×`} />
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  الأكواد المتكررة لنفس المندوب ({report.repeatedCodes.length})
                </h3>
                <div className="mt-2 max-h-32 overflow-y-auto erp-scroll divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.repeatedCodes.length === 0 ? (
                    <div className="py-3 text-slate-400">لا توجد أكواد متكررة لنفس المندوب.</div>
                  ) : (
                    report.repeatedCodes.slice(0, 8).map((c) => (
                      <button
                        key={c.codeKey}
                        type="button"
                        onClick={() => openCodeDetail(c.codeKey)}
                        className="flex w-full items-center justify-between py-2 px-1.5 text-right rounded hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{c.normalizedCode}</span>
                        <StatusBadge tone="danger" className="font-mono-num" label={`${c.repeatedRidersCount} مندوب`} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-3">
            <SectionHeader
              title="جدول جميع أكواد الأخطاء (اضغط على أي صف لعرض صفحة التفاصيل)"
              actions={<span className="text-xs text-slate-500 dark:text-slate-400">الأكواد غير المسجلة في القاموس تظهر كـ Unknown Code</span>}
            />
            <DataTable
              rows={report.codes}
              columns={codeSummaryCols}
              rowKey={(r) => r.codeKey}
              searchPlaceholder="ابحث بالكود أو الوصف أو التصنيف..."
              searchText={(r) => `${r.normalizedCode} ${r.rawExamples.join(' ')} ${r.displayTitle} ${r.category}`}
              onRowClick={(r) => openCodeDetail(r.codeKey)}
              emptyTitle="لا توجد أكواد أخطاء في بيانات Hunger-Daily الحالية"
              emptySubtitle="عند استيراد ملفات HungerStation تحتوي على قيم غير فارغة في عمود Error Codes ستظهر التحليلات هنا تلقائيًا."
            />
          </div>

          <div className="space-y-3">
            <SectionHeader
              title={`التنبيهات الذكية لأكواد الأخطاء (${smartAlerts.length})`}
              subtitle="تُحتسب تلقائيًا وفق عتبات إعدادات النظام (التكرار، القفزة اليومية، الانتشار، التركز، والأكواد الجديدة)."
              actions={
                <Button size="sm" variant="secondary" onClick={onGoToSettings}>
                  ضبط حدود تنبيهات الأخطاء
                </Button>
              }
            />
            <DataTable
              rows={smartAlerts}
              columns={alertCols}
              rowKey={(r) => r.id}
              searchPlaceholder="ابحث في تنبيهات الأكواد..."
              searchText={(r) => `${r.category} ${r.title} ${r.description} ${r.riderId}`}
              onRowClick={(r) => {
                if (r.riderId && r.riderId !== '-') {
                  onSelectRider('hungerstation', r.riderId);
                }
              }}
              emptyTitle="لا توجد تنبيهات نشطة لأكواد الأخطاء"
              emptySubtitle="جميع المؤشرات ضمن الحدود المضبوطة في إعدادات النظام."
            />
          </div>
        </div>
      )}

      {/* SUBTAB 2: ERROR CODE DETAIL VIEW */}
      {subTab === 'detail' && (
        <div className="space-y-6">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={() => setSubTab('dashboard')}
              >
                العودة للوحة الأكواد
              </Button>
              <Select
                value={activeDetail?.codeKey || ''}
                onChange={(e) => setSelectedCodeKey(e.target.value)}
                className="min-w-[260px] font-mono-num font-semibold"
              >
                {report.codes.length === 0 ? (
                  <option value="">لا توجد أكواد</option>
                ) : (
                  report.codes.map((c) => (
                    <option key={c.codeKey} value={c.codeKey}>
                      {c.normalizedCode} — {c.displayTitle} ({c.occurrenceCount})
                    </option>
                  ))
                )}
              </Select>
            </div>
            {activeDetail && canEditDict && (
              <Button
                size="sm"
                variant="primary"
                icon={<BookOpen className="h-3.5 w-3.5" />}
                onClick={() => openCodeInDictionary(activeDetail)}
              >
                {activeDetail.isVerified ? 'تعديل تعريف الكود' : 'توثيق وتصنيف في القاموس'}
              </Button>
            )}
          </Card>

          {!activeDetail ? (
            <EmptyState title="لا توجد أكواد أخطاء مسجلة حاليًا لعرض تفاصيلها" />
          ) : (
            <>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100">{activeDetail.normalizedCode}</span>
                      <StatusBadge label={SEVERITY_LABELS[activeDetail.severity]} tone={severityBadgeTone(activeDetail.severity)} />
                      <StatusBadge
                        label={activeDetail.isVerified ? 'تعريف موثق' : 'Unknown Code (بانتظار التوثيق)'}
                        tone={activeDetail.isVerified ? 'success' : 'warning'}
                      />
                    </div>
                    <div className="text-base font-bold text-slate-800 dark:text-slate-200">{activeDetail.displayTitle}</div>
                    {activeDetail.dictionary?.englishDescription && (
                      <div className="text-xs font-mono-num text-slate-500 dark:text-slate-400">{activeDetail.dictionary.englishDescription}</div>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      التصنيف: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeDetail.category}</span> · القيم الأصلية الخام:{' '}
                      <span className="font-mono-num text-slate-700 dark:text-slate-300">{activeDetail.rawExamples.join(' | ')}</span>
                    </div>
                  </div>

                  <div>
                    {activeDetail.trendDirection === 'up' ? (
                      <StatusBadge tone="danger" icon={<TrendingUp className="h-3.5 w-3.5" />} label="اتجاه متصاعد" />
                    ) : activeDetail.trendDirection === 'down' ? (
                      <StatusBadge tone="success" icon={<TrendingDown className="h-3.5 w-3.5" />} label="اتجاه متناقص" />
                    ) : (
                      <StatusBadge tone="neutral" label="اتجاه مستقر" />
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs">
                  <div className="font-bold text-slate-800 dark:text-slate-200 mb-1">الإجراء التشغيلي المقترح:</div>
                  <div className="text-slate-700 dark:text-slate-300">
                    {activeDetail.recommendedAction || 'لم يُحدد إجراء تشغيلي بعد — يُنصح بالتحقق من معنى الكود وتوثيقه في القاموس.'}
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard label="عدد مرات الظهور" value={fmtNum(activeDetail.occurrenceCount)} />
                <KpiCard label="المندوبون المتأثرون" value={fmtNum(activeDetail.affectedRidersCount)} />
                <KpiCard
                  label="مندوبون بتكرار (2+)"
                  value={fmtNum(activeDetail.repeatedRidersCount)}
                  tone={activeDetail.repeatedRidersCount > 0 ? 'critical' : 'neutral'}
                />
                <KpiCard label="أول ظهور" value={activeDetail.firstSeenDate || '-'} />
                <KpiCard label="آخر ظهور" value={activeDetail.lastSeenDate || '-'} />
                <KpiCard label="عدد أيام الظهور" value={fmtNum(activeDetail.activeDaysCount)} />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2 space-y-4">
                  <SectionHeader title={`اتجاه تكرار الكود يوميًا (${activeDetail.normalizedCode})`} />
                  <div className="h-64 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activeDetail.dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="count" name="عدد الحالات" stroke="#2563eb" strokeWidth={2} />
                        <Line type="monotone" dataKey="riders" name="المندوبون" stroke="#0d9488" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="space-y-4 text-xs">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-1.5">أكثر المدن تأثرًا</h4>
                    <div className="space-y-1">
                      {activeDetail.cityBreakdown.map((b) => (
                        <div key={b.name} className="flex justify-between">
                          <span className="text-slate-700 dark:text-slate-300">{b.name}</span>
                          <span className="font-mono-num font-semibold">{b.count} ({b.sharePct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-1.5">أكثر الفروع تأثرًا</h4>
                    <div className="space-y-1">
                      {activeDetail.branchBreakdown.map((b) => (
                        <div key={b.name} className="flex justify-between">
                          <span className="text-slate-700 dark:text-slate-300">{b.name}</span>
                          <span className="font-mono-num font-semibold">{b.count} ({b.sharePct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-1.5">العقود والمركبات</h4>
                    <div className="space-y-1">
                      {activeDetail.contractBreakdown.slice(0, 4).map((b) => (
                        <div key={b.name} className="flex justify-between">
                          <span className="text-slate-700 dark:text-slate-300">عقد: {b.name}</span>
                          <span className="font-mono-num">{b.count} ({b.sharePct}%)</span>
                        </div>
                      ))}
                      {activeDetail.vehicleBreakdown.slice(0, 4).map((b) => (
                        <div key={b.name} className="flex justify-between">
                          <span className="text-slate-700 dark:text-slate-300">مركبة: {b.name}</span>
                          <span className="font-mono-num">{b.count} ({b.sharePct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              <div className="space-y-3">
                <SectionHeader title={`قائمة المندوبين المتأثرين بالكود ${activeDetail.normalizedCode} (اضغط لفتح Rider 360°)`} />
                <DataTable
                  rows={activeDetail.affectedRiders}
                  columns={detailRiderCols}
                  rowKey={(r) => r.riderId}
                  searchPlaceholder="ابحث برقم المندوب أو الاسم أو المدينة..."
                  searchText={(r) => `${r.riderId} ${r.riderName} ${r.city} ${r.branch}`}
                  onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* SUBTAB 3: OPERATIONAL CORRELATION */}
      {subTab === 'correlation' && (
        <div className="space-y-6">
          <ToastBanner
            type="warn"
            message="ملاحظة تحليلية (ارتباط وليس سببية مطلقة): يقارن هذا القسم مؤشرات الأداء اليومية لنفس (المندوب + التاريخ) في الأيام التي ظهر بها كود خطأ مقارنة بالأيام الخالية من الأخطاء."
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <SectionHeader
                title="أيام ظهرت فيها أكواد أخطاء"
                actions={
                  <StatusBadge
                    tone="danger"
                    className="font-mono-num"
                    label={`${fmtNum(report.correlation.withErrors.rowCount)} سجل · ${fmtNum(report.correlation.withErrors.riderCount)} مندوب`}
                  />
                }
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط الطلبات المكتملة</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtNum(report.correlation.withErrors.avgCompletedDeliveries, 1)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط الحضور %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withErrors.avgAttendanceRate)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط ساعات العمل</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtNum(report.correlation.withErrors.avgWorkingHours, 1)} س
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط القبول %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withErrors.avgAcceptanceRate)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">معدل الإلغاءات %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-red-700 dark:text-red-400">
                    {fmtPct(report.correlation.withErrors.cancellationRatePct)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">نسبة الرفض / عدم القبول</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-amber-700 dark:text-amber-400">
                    {fmtPct(report.correlation.withErrors.declineRatePct)}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="space-y-3">
              <SectionHeader
                title="أيام خالية من أكواد الأخطاء (الأساس المرجعي)"
                actions={
                  <StatusBadge
                    tone="success"
                    className="font-mono-num"
                    label={`${fmtNum(report.correlation.withoutErrors.rowCount)} سجل · ${fmtNum(report.correlation.withoutErrors.riderCount)} مندوب`}
                  />
                }
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط الطلبات المكتملة</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtNum(report.correlation.withoutErrors.avgCompletedDeliveries, 1)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط الحضور %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withoutErrors.avgAttendanceRate)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط ساعات العمل</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtNum(report.correlation.withoutErrors.avgWorkingHours, 1)} س
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">متوسط القبول %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withoutErrors.avgAcceptanceRate)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">معدل الإلغاءات %</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withoutErrors.cancellationRatePct)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="text-slate-500 dark:text-slate-400">نسبة الرفض / عدم القبول</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {fmtPct(report.correlation.withoutErrors.declineRatePct)}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <DataTable
            rows={report.correlation.perCode}
            columns={corrCols}
            rowKey={(r) => r.codeKey}
            searchPlaceholder="ابحث بالكود لمراجعة ارتباطه بمؤشرات الأداء..."
            searchText={(r) => `${r.normalizedCode} ${r.displayTitle}`}
            onRowClick={(r) => openCodeDetail(r.codeKey)}
            emptyTitle="لا توجد بيانات ارتباط متاحة"
          />
        </div>
      )}

      {/* SUBTAB 4: RAW ERROR EVENTS TRACEABILITY */}
      {subTab === 'traceability' && (
        <div className="space-y-4">
          <ToastBanner
            type="info"
            message="سجل التدقيق الكامل للأخطاء الخام (Raw Error Events): يعرض القيمة النصية الكاملة للخلية في Excel، الكود المفصول، اسم الملف، اسم الشيت، ورقم الصف الأصلي، مع إمكانية فتح حالة متابعة تشغيلية بنقرة واحدة."
          />
          <DataTable
            rows={report.events}
            columns={traceCols}
            rowKey={(r) => r.eventKey}
            searchPlaceholder="ابحث برقم المندوب، الكود الخام، أو اسم الملف..."
            searchText={(r) => `${r.riderId} ${r.riderName} ${r.normalizedCode} ${r.rawCell} ${r.sourceFile}`}
            onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
            emptyTitle="لا توجد أحداث أخطاء خام في النطاق المحدد"
          />
        </div>
      )}

      {/* SUBTAB 5: ERROR CODE DICTIONARY MANAGEMENT */}
      {subTab === 'dictionary' && (
        <div className="space-y-6">
          {dictMsg && (
            <ToastBanner
              type={dictMsg.type}
              message={dictMsg.text}
              onDismiss={() => setDictMsg(null)}
            />
          )}

          {report.codes.some((c) => !c.isVerified) && (
            <Card padding="sm" className="space-y-2.5 border-amber-200 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                <span>أكواد مكتشفة في البيانات بحالة Unknown Code وتحتاج توثيقًا بعد التحقق من معناها:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {report.codes
                  .filter((c) => !c.isVerified)
                  .map((c) => (
                    <Button
                      key={c.codeKey}
                      size="sm"
                      variant="secondary"
                      icon={<Plus className="h-3 w-3" />}
                      onClick={() => openCodeInDictionary(c)}
                      className="font-mono-num"
                    >
                      {c.normalizedCode} ({c.occurrenceCount})
                    </Button>
                  ))}
              </div>
            </Card>
          )}

          {canEditDict && (
            <Card>
              <form onSubmit={handleSaveDictionary} className="space-y-4">
                <SectionHeader
                  title="إضافة / تحديث تعريف كود في القاموس (Error Code Dictionary)"
                  subtitle="لا يتم تخمين المعنى تلقائيًا — يُوثّق الوصف بعد التحقق التشغيلي."
                />

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="الكود الموحد (Normalized Code)" required>
                    <Input
                      required
                      value={dictForm.normalizedCode}
                      onChange={(e) => setDictForm((p) => ({ ...p, normalizedCode: e.target.value }))}
                      placeholder="مثال: ERR-101"
                      className="font-mono-num"
                    />
                  </FormField>
                  <FormField label="أمثلة القيم الخام (Raw Examples)">
                    <Input
                      value={dictForm.rawExamples}
                      onChange={(e) => setDictForm((p) => ({ ...p, rawExamples: e.target.value }))}
                      placeholder="err-101, ERR-101"
                      className="font-mono-num"
                    />
                  </FormField>
                  <FormField label="التصنيف (Category)">
                    <Input
                      value={dictForm.category}
                      onChange={(e) => setDictForm((p) => ({ ...p, category: e.target.value }))}
                      placeholder="التأخير / التطبيق / المركبة"
                    />
                  </FormField>
                  <FormField label="مستوى الخطورة (Severity)">
                    <Select
                      value={dictForm.severity}
                      onChange={(e) => setDictForm((p) => ({ ...p, severity: e.target.value as ErrorCodeSeverity }))}
                    >
                      <option value="critical">حرج (Critical)</option>
                      <option value="high">مرتفع (High)</option>
                      <option value="medium">متوسط (Medium)</option>
                      <option value="low">منخفض (Low)</option>
                      <option value="unknown">غير محدد (Unknown)</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField label="الوصف العربي المعتمد" required>
                    <Input
                      required
                      value={dictForm.arabicDescription}
                      onChange={(e) => setDictForm((p) => ({ ...p, arabicDescription: e.target.value }))}
                      placeholder="الوصف التشغيلي المعتمد بعد التحقق"
                    />
                  </FormField>
                  <FormField label="الوصف الإنجليزي (اختياري)">
                    <Input
                      value={dictForm.englishDescription}
                      onChange={(e) => setDictForm((p) => ({ ...p, englishDescription: e.target.value }))}
                      placeholder="English verified description"
                    />
                  </FormField>
                  <FormField label="حالة التحقق">
                    <Select
                      value={dictForm.verifiedStatus}
                      onChange={(e) => setDictForm((p) => ({ ...p, verifiedStatus: e.target.value as 'verified' | 'unverified' }))}
                    >
                      <option value="verified">موثق (Verified)</option>
                      <option value="unverified">غير موثق (Unverified)</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <FormField label="الإجراء التشغيلي المقترح">
                    <Textarea
                      rows={2}
                      value={dictForm.recommendedAction}
                      onChange={(e) => setDictForm((p) => ({ ...p, recommendedAction: e.target.value }))}
                      placeholder="الخطوات الواجب اتخاذها عند ظهور هذا الكود..."
                    />
                  </FormField>
                  <FormField label="ملاحظات إضافية">
                    <Textarea
                      rows={2}
                      value={dictForm.notes}
                      onChange={(e) => setDictForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="مصدر التحقق أو ملاحظات الفريق..."
                    />
                  </FormField>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={dictBusy}
                    icon={<Save className="h-3.5 w-3.5" />}
                  >
                    حفظ في قاموس الأكواد
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <DataTable
            rows={dictionaryEntries}
            columns={dictCols}
            rowKey={(r) => r.codeKey}
            searchPlaceholder="ابحث في قاموس الأكواد..."
            searchText={(r) => `${r.normalizedCode} ${r.arabicDescription} ${r.englishDescription || ''} ${r.category || ''}`}
            emptyTitle="قاموس الأكواد فارغ حاليًا"
            emptySubtitle="استخدم النموذج أعلاه أو أزرار الأكواد المكتشفة لتوثيق معاني الأكواد وإجراءاتها التشغيلية."
          />

          <ConfirmModal
            open={Boolean(deleteTarget)}
            title="تأكيد حذف تعريف الكود"
            description={
              deleteTarget
                ? `هل تريد حذف تعريف الكود "${deleteTarget.normalizedCode}" من قاموس الأخطاء؟ سيعود الكود للظهور بحالة Unknown Code حتى يُوثق مجددًا.`
                : ''
            }
            danger
            busy={dictBusy}
            onConfirm={confirmDeleteDictEntry}
            onCancel={() => setDeleteTarget(null)}
          />
        </div>
      )}
    </div>
  );
}
