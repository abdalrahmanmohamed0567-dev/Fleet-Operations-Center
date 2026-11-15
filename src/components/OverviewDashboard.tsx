import {
  AlertTriangle,
  ArrowUpLeft,
  CheckCircle2,
  ClipboardList,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
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
  computeOverviewMetrics,
  fmtHours,
  fmtKm,
  fmtNum,
  fmtPct,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../lib/fleetAnalytics';
import {
  computeBranchScorecards,
  computePeriodComparisons,
  computeRiderPerformanceScore,
  detectOperationalAnomalies,
  KPI_DEFINITIONS,
  type PeriodWindowSummary,
} from '../lib/smartAnalytics';
import { isKeetaActive } from '../shared/rbacCore';
import type {
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalSettings,
  Platform,
  PlatformCatalogEntry,
} from '../types/fleet';
import { KpiCard } from './KpiCard';
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
  SlideDrawer,
  StatusBadge,
  Tabs,
} from './ui/EnterpriseUI';

interface OverviewDashboardProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  operationalCases: OperationalCase[];
  settings: OperationalSettings;
  platformCatalog?: PlatformCatalogEntry[];
  onGoToImport: () => void;
  onGoToOperations: () => void;
  onGoToErrors: () => void;
  onSelectRider: (platform: Platform, riderId: string) => void;
  onOpenPlatformWorkspace?: (platform: Platform) => void;
}

type DrilldownKey =
  | 'totalRiders'
  | 'activeRiders'
  | 'completedOrders'
  | 'workingHours'
  | 'avgOrders'
  | 'avgHours'
  | 'attendance'
  | 'acceptance'
  | 'completion'
  | 'onTime'
  | 'overdue'
  | 'totalKm'
  | 'payableKm'
  | 'lowPerf';

export function OverviewDashboard({
  dataset,
  filteredRows,
  operationalCases,
  settings,
  platformCatalog = [],
  onGoToImport,
  onGoToOperations,
  onGoToErrors,
  onSelectRider,
  onOpenPlatformWorkspace,
}: OverviewDashboardProps) {
  const [periodTab, setPeriodTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [drilldownKey, setDrilldownKey] = useState<DrilldownKey | null>(null);
  const keetaActive = isKeetaActive(settings, platformCatalog);

  const metrics = useMemo(
    () => computeOverviewMetrics(filteredRows, settings),
    [filteredRows, settings]
  );

  const platformComparison = useMemo(() => {
    const hsRows = filteredRows.filter((r) => r.platform === 'hungerstation');
    const ktRows = filteredRows.filter((r) => r.platform === 'keeta');
    const hsMetrics = computeOverviewMetrics(hsRows, settings);
    const ktMetrics = computeOverviewMetrics(ktRows, settings);
    const hsCasesOpen = operationalCases.filter(
      (c) => c.platform === 'hungerstation' && c.status !== 'closed' && c.status !== 'resolved'
    ).length;
    const ktCasesOpen = operationalCases.filter(
      (c) => c.platform === 'keeta' && c.status !== 'closed' && c.status !== 'resolved'
    ).length;
    return { hsMetrics, ktMetrics, hsCasesOpen, ktCasesOpen };
  }, [filteredRows, settings, operationalCases]);

  const periods = useMemo(
    () => computePeriodComparisons(filteredRows, settings),
    [filteredRows, settings]
  );

  const dailySeries = useMemo(() => {
    const byDateMap = new Map<
      string,
      { date: string; hungerOrders: number; keetaOrders: number; hungerHours: number; keetaHours: number }
    >();
    for (const r of filteredRows) {
      const entry = byDateMap.get(r.date) || {
        date: r.date,
        hungerOrders: 0,
        keetaOrders: 0,
        hungerHours: 0,
        keetaHours: 0,
      };
      if (r.platform === 'hungerstation') {
        entry.hungerOrders += r.completedOrders ?? 0;
        entry.hungerHours += r.workingHours ?? 0;
      } else {
        entry.keetaOrders += r.completedOrders ?? 0;
        entry.keetaHours += r.workingHours ?? 0;
      }
      byDateMap.set(r.date, entry);
    }
    return Array.from(byDateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        hungerHours: Number(d.hungerHours.toFixed(1)),
        keetaHours: Number(d.keetaHours.toFixed(1)),
      }));
  }, [filteredRows]);

  const riderScores = useMemo(() => {
    const byRider = new Map<string, UnifiedDailyRow[]>();
    for (const r of filteredRows) {
      const k = `${r.platform}:${r.riderId}`;
      const arr = byRider.get(k) || [];
      arr.push(r);
      byRider.set(k, arr);
    }
    const qualByRider = new Map<string, number>();
    for (const q of dataset.hungerQualityMonthly) {
      if (q.finalDeliveryQualityScore !== null) {
        qualByRider.set(q.riderId, q.finalDeliveryQualityScore);
      }
    }
    return Array.from(byRider.entries())
      .map(([, rows]) => {
        const s = rows[0];
        return computeRiderPerformanceScore(
          s.platform,
          s.riderId,
          rows,
          settings,
          s.platform === 'hungerstation' ? qualByRider.get(s.riderId) ?? null : null
        );
      })
      .filter((x) => x.totalScore !== null);
  }, [filteredRows, dataset.hungerQualityMonthly, settings]);

  const topPerformers = useMemo(
    () => [...riderScores].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0)).slice(0, 6),
    [riderScores]
  );

  const bottomPerformers = useMemo(
    () => [...riderScores].sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0)).slice(0, 6),
    [riderScores]
  );

  const branches = useMemo(
    () => computeBranchScorecards(filteredRows, settings),
    [filteredRows, settings]
  );

  const anomalies = useMemo(() => detectOperationalAnomalies(filteredRows), [filteredRows]);

  const openCasesCount = operationalCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length;
  const criticalCasesCount = operationalCases.filter(
    (c) => c.status !== 'closed' && c.status !== 'resolved' && c.priority === 'critical'
  ).length;

  const activePeriod: PeriodWindowSummary = periods[periodTab];

  const drilldownData = useMemo(() => {
    if (!drilldownKey) return null;
    const defMap: Record<DrilldownKey, { title: string; defId: string; rows: UnifiedDailyRow[]; note: string }> = {
      totalRiders: {
        title: 'تفاصيل إجمالي المندوبين في النطاق',
        defId: 'totalRiders',
        rows: filteredRows,
        note: `إجمالي السجلات اليومية: ${filteredRows.length} سجل عبر ${metrics.totalRiders} معرف منصة فريد.`,
      },
      activeRiders: {
        title: 'تفاصيل المندوبين النشطين',
        defId: 'activeRiders',
        rows: filteredRows.filter((r) => r.isActive),
        note: `${metrics.activeRiders} مندوب حققوا طلبًا أو ساعات عمل > 0.`,
      },
      completedOrders: {
        title: 'سجلات الطلبات المكتملة',
        defId: 'completedOrders',
        rows: [...filteredRows].sort((a, b) => (b.completedOrders ?? 0) - (a.completedOrders ?? 0)),
        note: `إجمالي ${fmtNum(metrics.completedOrders)} طلب مكتمل.`,
      },
      workingHours: {
        title: 'سجلات ساعات العمل الفعلية',
        defId: 'workingHours',
        rows: [...filteredRows].sort((a, b) => (b.workingHours ?? 0) - (a.workingHours ?? 0)),
        note: `إجمالي ${fmtHours(metrics.workingHours)} مسجلة.`,
      },
      avgOrders: {
        title: 'تفاصيل متوسط الطلبات لكل مندوب نشط',
        defId: 'completedOrders',
        rows: filteredRows.filter((r) => r.isActive).sort((a, b) => (b.completedOrders ?? 0) - (a.completedOrders ?? 0)),
        note: `متوسط ${fmtNum(metrics.avgOrdersPerActiveRider, 1)} طلب/مندوب نشط.`,
      },
      avgHours: {
        title: 'تفاصيل متوسط ساعات العمل لكل مندوب',
        defId: 'workingHours',
        rows: [...filteredRows].sort((a, b) => (b.workingHours ?? 0) - (a.workingHours ?? 0)),
        note: `متوسط ${fmtHours(metrics.avgHoursPerRider)}.`,
      },
      attendance: {
        title: 'تفاصيل الالتزام والحضور',
        defId: 'attendanceRate',
        rows: filteredRows.filter((r) => r.attendanceRate !== null).sort((a, b) => (a.attendanceRate ?? 0) - (b.attendanceRate ?? 0)),
        note: `الحد الأدنى المستهدف: ${settings.minAttendanceRatePct}%.`,
      },
      acceptance: {
        title: 'تفاصيل معدل القبول',
        defId: 'acceptanceRate',
        rows: filteredRows.filter((r) => r.acceptanceRate !== null).sort((a, b) => (a.acceptanceRate ?? 0) - (b.acceptanceRate ?? 0)),
        note: `الحد الأدنى المستهدف: ${settings.minAcceptanceRatePct}%.`,
      },
      completion: {
        title: 'تفاصيل معدل الإنجاز',
        defId: 'completionRate',
        rows: filteredRows.filter((r) => r.completionRate !== null).sort((a, b) => (a.completionRate ?? 0) - (b.completionRate ?? 0)),
        note: `الحد الأدنى المستهدف: ${settings.minCompletionRatePct}%.`,
      },
      onTime: {
        title: 'تفاصيل الالتزام بوقت التسليم (On-Time)',
        defId: 'onTimeRate',
        rows: filteredRows.filter((r) => r.onTimeRate !== null).sort((a, b) => (a.onTimeRate ?? 0) - (b.onTimeRate ?? 0)),
        note: `الحد المستهدف: ${settings.minOnTimeRatePct}% (متاح يوميًا في كيتا).`,
      },
      overdue: {
        title: 'الطلبات المتأخرة (Overdue)',
        defId: 'onTimeRate',
        rows: filteredRows.filter((r) => (r.overdueOrders ?? 0) > 0).sort((a, b) => (b.overdueOrders ?? 0) - (a.overdueOrders ?? 0)),
        note: `إجمالي ${fmtNum(metrics.overdueOrders)} طلب متأخر.`,
      },
      totalKm: {
        title: 'تفاصيل المسافة الإجمالية (Total KM)',
        defId: 'totalKm',
        rows: filteredRows.filter((r) => r.totalKm !== null).sort((a, b) => (b.totalKm ?? 0) - (a.totalKm ?? 0)),
        note: `إجمالي ${fmtKm(metrics.totalKm)}.`,
      },
      payableKm: {
        title: 'تفاصيل المسافة المستحقة (Payable KM)',
        defId: 'totalKm',
        rows: filteredRows.filter((r) => r.payableKm !== null).sort((a, b) => (b.payableKm ?? 0) - (a.payableKm ?? 0)),
        note: `إجمالي ${fmtKm(metrics.payableKm)}.`,
      },
      lowPerf: {
        title: 'المندوبون دون الأهداف التشغيلية',
        defId: 'activeRiders',
        rows: filteredRows.filter(
          (r) =>
            (r.completedOrders !== null && r.completedOrders < settings.minDailyOrders) ||
            (r.workingHours !== null && r.workingHours < settings.minDailyWorkingHours)
        ),
        note: `${metrics.lowPerformanceRidersCount} مندوب يحتاجون متابعة قيادية.`,
      },
    };
    const meta = defMap[drilldownKey];
    const def = KPI_DEFINITIONS.find((d) => d.id === meta.defId);
    return { ...meta, def };
  }, [drilldownKey, filteredRows, metrics, settings]);

  if (filteredRows.length === 0) {
    return (
      <EmptyState
        title="لا توجد بيانات تشغيلية مطابقة للفلاتر الحالية"
        subtitle={
          keetaActive
            ? 'قم برفع تقارير HungerStation أو Keeta من مركز الاستيراد لعرض مؤشرات القيادة والبيانات التحليلية.'
            : 'قم برفع تقارير HungerStation من مركز الاستيراد لعرض مؤشرات القيادة والبيانات التحليلية.'
        }
        icon={<Upload className="h-5 w-5" />}
        action={
          <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={onGoToImport}>
            الانتقال إلى مركز الاستيراد
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Executive Command Summary Strip (Answers 4 Executive Questions) */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>1. الوضع التشغيلي الآن</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(metrics.activeRiders)} نشط · {fmtNum(metrics.completedOrders)} طلب
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            نسبة الإنجاز <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">{fmtPct(metrics.completionRate)}</span> · الحضور{' '}
            <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">{fmtPct(metrics.attendanceRate)}</span>
          </p>
        </Card>

        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>2. الالتزام بالأهداف</span>
            <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(riderScores.filter((r) => (r.totalScore ?? 0) >= 72).length)} متفوق ·{' '}
            <span className="text-red-700 dark:text-red-400">{fmtNum(metrics.lowPerformanceRidersCount)} دون الهدف</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            الفروع: <span className="font-mono-num font-semibold">{branches.filter((b) => b.healthStatus === 'يحتاج تدخل').length}</span> فرع/مدينة تتطلب تدخلًا
          </p>
        </Card>

        <button
          type="button"
          onClick={onGoToErrors}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>3. مواطن الخلل والشذوذ</span>
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(anomalies.length)} هبوط حاد · {fmtNum(metrics.overdueOrders)} متأخر
          </div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>فحص مركز أكواد الأخطاء</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>

        <button
          type="button"
          onClick={onGoToOperations}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>4. تدخل الإدارة اليوم</span>
            <ClipboardList className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(openCasesCount)} حالة مفتوحة ({fmtNum(criticalCasesCount)} حرجة)
          </div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>إدارة طابور التدخل والحالات</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>
      </div>

      {/* Exclusive Global Platform-to-Platform Executive Comparison */}
      <Card className="space-y-4">
        <SectionHeader
          title={
            keetaActive
              ? 'مقارنة المنصتين التنفيذية (HungerStation vs Keeta)'
              : 'ملخص الأداء التنفيذي لمنصة HungerStation'
          }
          subtitle={
            keetaActive
              ? 'متاحة حصريًا في المركز التنفيذي العام لمدير التشغيل دون أي خلط للمعرفات أو السجلات بين المنصتين.'
              : 'عرض المؤشرات التشغيلية المجمعة للمنصات المفعّلة حاليًا.'
          }
          actions={
            onOpenPlatformWorkspace && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenPlatformWorkspace('hungerstation')}
                >
                  <span>فتح مساحة HungerStation</span>
                  <ArrowUpLeft className="h-3.5 w-3.5" />
                </Button>
                {keetaActive && (
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => onOpenPlatformWorkspace('keeta')}
                  >
                    <span>فتح مساحة Keeta</span>
                    <ArrowUpLeft className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )
          }
        />

        <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5 text-right font-semibold">المؤشر المقارن</th>
                <th className="px-3.5 py-2.5 text-center font-semibold text-amber-800 dark:text-amber-300">HungerStation</th>
                {keetaActive && <th className="px-3.5 py-2.5 text-center font-semibold text-blue-800 dark:text-blue-300">Keeta</th>}
                <th className="px-3.5 py-2.5 text-center font-semibold">إجمالي الشركة / المجمع</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">تطابق التعريف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">المندوبون (النشطون / الإجمالي)</td>
                <td className="px-3.5 py-2 text-center font-mono-num">{fmtNum(platformComparison.hsMetrics.activeRiders)} / {fmtNum(platformComparison.hsMetrics.totalRiders)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num">{fmtNum(platformComparison.ktMetrics.activeRiders)} / {fmtNum(platformComparison.ktMetrics.totalRiders)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtNum(metrics.activeRiders)} / {fmtNum(metrics.totalRiders)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">معرف منفصل لكل منصة</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">الطلبات المكتملة / المسلمة</td>
                <td className="px-3.5 py-2 text-center font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(platformComparison.hsMetrics.completedOrders)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(platformComparison.ktMetrics.completedOrders)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtNum(metrics.completedOrders)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">{keetaActive ? 'Completed Deliveries ⇄ Delivered Tasks' : 'Completed Deliveries'}</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">ساعات العمل / الاتصال</td>
                <td className="px-3.5 py-2 text-center font-mono-num">{fmtHours(platformComparison.hsMetrics.workingHours)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num">{fmtHours(platformComparison.ktMetrics.workingHours)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtHours(metrics.workingHours)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">{keetaActive ? 'Actual Working Hours ⇄ Shift Online Hours' : 'Actual Working Hours'}</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">معدل الحضور والالتزام %</td>
                <td className="px-3.5 py-2 text-center font-mono-num">{fmtPct(platformComparison.hsMetrics.attendanceRate)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num">{fmtPct(platformComparison.ktMetrics.attendanceRate)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold">{fmtPct(metrics.attendanceRate)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">{keetaActive ? 'HS Attendance% ⇄ Keeta On-Shift?' : 'HS Attendance %'}</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">معدل القبول / الإنجاز %</td>
                <td className="px-3.5 py-2 text-center font-mono-num">{fmtPct(platformComparison.hsMetrics.acceptanceRate)} / {fmtPct(platformComparison.hsMetrics.completionRate)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num">{fmtPct(platformComparison.ktMetrics.acceptanceRate)} / {fmtPct(platformComparison.ktMetrics.completionRate)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold">{fmtPct(metrics.acceptanceRate)} / {fmtPct(metrics.completionRate)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">متكافئ</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">المسافة المستحقة (Payable KM)</td>
                <td className="px-3.5 py-2 text-center font-mono-num">{fmtKm(platformComparison.hsMetrics.payableKm)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num">{fmtKm(platformComparison.ktMetrics.payableKm)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold">{fmtKm(metrics.payableKm)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">{keetaActive ? 'Riders Distance ⇄ Keeta VDA' : 'Riders Distance'}</td>
              </tr>
              <tr className="h-[42px] hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">الحالات التشغيلية المفتوحة</td>
                <td className="px-3.5 py-2 text-center font-mono-num text-amber-700 dark:text-amber-400">{fmtNum(platformComparison.hsCasesOpen)}</td>
                {keetaActive && <td className="px-3.5 py-2 text-center font-mono-num text-amber-700 dark:text-amber-400">{fmtNum(platformComparison.ktCasesOpen)}</td>}
                <td className="px-3.5 py-2 text-center font-mono-num font-bold">{fmtNum(openCasesCount)}</td>
                <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">معزولة حسب المنصة</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Period Comparisons with Strict Completeness Guard */}
      <Card className="space-y-4">
        <SectionHeader
          title="مقارنات الفترات المرجعية"
          subtitle="تظهر المقارنة فقط عند اكتمال نافذتي المقارنة لحماية الإدارة من قراءة نسب مضللة على فترات ناقصة."
          actions={
            <Tabs
              variant="segmented"
              activeKey={periodTab}
              onChange={(k) => setPeriodTab(k)}
              items={[
                { key: 'daily', label: 'يوم مقابل يوم' },
                { key: 'weekly', label: 'أسبوع مقابل أسبوع' },
                { key: 'monthly', label: 'شهر مقابل شهر' },
              ]}
            />
          }
        />

        {activePeriod.status === 'incomplete' ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">فترة مرجعية غير مكتملة — تم حجب المقارنة الإجمالية</div>
              <p className="mt-1 leading-relaxed">{activePeriod.incompleteReason}</p>
              <div className="mt-1.5 font-mono-num text-[11px] opacity-80">
                النطاق الحالي: {activePeriod.currentRangeLabel} ({activePeriod.currentDaysCount} يوم) · المرجعي:{' '}
                {activePeriod.previousRangeLabel} ({activePeriod.previousDaysCount} يوم)
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <PeriodMetricCell
              label="الطلبات المكتملة"
              current={fmtNum(activePeriod.current?.completedOrders)}
              previous={fmtNum(activePeriod.previous?.completedOrders)}
              delta={activePeriod.ordersDeltaPct !== null && activePeriod.ordersDeltaPct !== undefined ? `${activePeriod.ordersDeltaPct > 0 ? '+' : ''}${activePeriod.ordersDeltaPct}%` : '—'}
              positive={(activePeriod.ordersDeltaPct ?? 0) >= 0}
              range={`${activePeriod.currentRangeLabel} vs ${activePeriod.previousRangeLabel}`}
            />
            <PeriodMetricCell
              label="المندوبون النشطون"
              current={fmtNum(activePeriod.current?.activeRiders)}
              previous={fmtNum(activePeriod.previous?.activeRiders)}
              delta={activePeriod.activeRidersDeltaPct !== null && activePeriod.activeRidersDeltaPct !== undefined ? `${activePeriod.activeRidersDeltaPct > 0 ? '+' : ''}${activePeriod.activeRidersDeltaPct}%` : '—'}
              positive={(activePeriod.activeRidersDeltaPct ?? 0) >= 0}
            />
            <PeriodMetricCell
              label="ساعات العمل"
              current={fmtHours(activePeriod.current?.workingHours)}
              previous={fmtHours(activePeriod.previous?.workingHours)}
              delta={activePeriod.hoursDeltaPct !== null && activePeriod.hoursDeltaPct !== undefined ? `${activePeriod.hoursDeltaPct > 0 ? '+' : ''}${activePeriod.hoursDeltaPct}%` : '—'}
              positive={(activePeriod.hoursDeltaPct ?? 0) >= 0}
            />
            <PeriodMetricCell
              label="معدل الإنجاز"
              current={fmtPct(activePeriod.current?.completionRate)}
              previous={fmtPct(activePeriod.previous?.completionRate)}
              delta={activePeriod.completionDeltaPts !== null && activePeriod.completionDeltaPts !== undefined ? `${activePeriod.completionDeltaPts > 0 ? '+' : ''}${activePeriod.completionDeltaPts} نقطة` : '—'}
              positive={(activePeriod.completionDeltaPts ?? 0) >= 0}
            />
            <PeriodMetricCell
              label="معدل القبول"
              current={fmtPct(activePeriod.current?.acceptanceRate)}
              previous={fmtPct(activePeriod.previous?.acceptanceRate)}
              delta={activePeriod.acceptanceDeltaPts !== null && activePeriod.acceptanceDeltaPts !== undefined ? `${activePeriod.acceptanceDeltaPts > 0 ? '+' : ''}${activePeriod.acceptanceDeltaPts} نقطة` : '—'}
              positive={(activePeriod.acceptanceDeltaPts ?? 0) >= 0}
            />
          </div>
        )}
      </Card>

      {/* 14 Clickable Executive KPIs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-bold text-slate-800 dark:text-slate-200">المؤشرات التشغيلية التنفيذية (اضغط على أي مؤشر للتنقيب والتفاصيل)</span>
          <StatusBadge label="14 مؤشرًا فعليًا" tone="neutral" className="font-mono-num" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <KpiCard
            label="إجمالي المندوبين"
            value={fmtNum(metrics.totalRiders)}
            subtext="حسب الفلتر الحالي"
            onClick={() => setDrilldownKey('totalRiders')}
          />
          <KpiCard
            label="المندوبون النشطون"
            value={fmtNum(metrics.activeRiders)}
            subtext={metrics.totalRiders > 0 ? `${((metrics.activeRiders / metrics.totalRiders) * 100).toFixed(1)}% من الأسطول` : undefined}
            tone="good"
            onClick={() => setDrilldownKey('activeRiders')}
          />
          <KpiCard
            label="الطلبات المكتملة"
            value={fmtNum(metrics.completedOrders)}
            tone="good"
            onClick={() => setDrilldownKey('completedOrders')}
          />
          <KpiCard
            label="ساعات العمل الفعلية"
            value={fmtHours(metrics.workingHours)}
            onClick={() => setDrilldownKey('workingHours')}
          />
          <KpiCard
            label="متوسط الطلبات / نشط"
            value={fmtNum(metrics.avgOrdersPerActiveRider, 1)}
            onClick={() => setDrilldownKey('avgOrders')}
          />
          <KpiCard
            label="متوسط الساعات / مندوب"
            value={fmtHours(metrics.avgHoursPerRider)}
            onClick={() => setDrilldownKey('avgHours')}
          />
          <KpiCard
            label="الالتزام والحضور"
            value={fmtPct(metrics.attendanceRate)}
            tone={metrics.attendanceRate !== null && metrics.attendanceRate < settings.minAttendanceRatePct ? 'warn' : 'good'}
            onClick={() => setDrilldownKey('attendance')}
          />
          <KpiCard
            label="معدل قبول الطلبات"
            value={fmtPct(metrics.acceptanceRate)}
            tone={metrics.acceptanceRate !== null && metrics.acceptanceRate < settings.minAcceptanceRatePct ? 'warn' : 'good'}
            onClick={() => setDrilldownKey('acceptance')}
          />
          <KpiCard
            label="معدل إنجاز الطلبات"
            value={fmtPct(metrics.completionRate)}
            tone={metrics.completionRate !== null && metrics.completionRate < settings.minCompletionRatePct ? 'warn' : 'good'}
            onClick={() => setDrilldownKey('completion')}
          />
          <KpiCard
            label="التسليم في الوقت"
            value={fmtPct(metrics.onTimeRate)}
            subtext="كيتا يومي"
            tone={metrics.onTimeRate !== null && metrics.onTimeRate < settings.minOnTimeRatePct ? 'warn' : 'good'}
            onClick={() => setDrilldownKey('onTime')}
          />
          <KpiCard
            label="الطلبات المتأخرة"
            value={fmtNum(metrics.overdueOrders)}
            tone={metrics.overdueOrders > 0 ? 'critical' : 'neutral'}
            onClick={() => setDrilldownKey('overdue')}
          />
          <KpiCard
            label="المسافات الإجمالية"
            value={fmtKm(metrics.totalKm)}
            onClick={() => setDrilldownKey('totalKm')}
          />
          <KpiCard
            label="المسافات المستحقة"
            value={fmtKm(metrics.payableKm)}
            onClick={() => setDrilldownKey('payableKm')}
          />
          <KpiCard
            label="دون الهدف التشغيلي"
            value={fmtNum(metrics.lowPerformanceRidersCount)}
            tone={metrics.lowPerformanceRidersCount > 0 ? 'critical' : 'good'}
            statusText={metrics.lowPerformanceRidersCount > 0 ? 'يتطلب متابعة' : 'مستقر'}
            onClick={() => setDrilldownKey('lowPerf')}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <SectionHeader
            title="الطلبات المكتملة اليومية حسب المنصة"
            actions={<span className="text-xs text-slate-500 dark:text-slate-400">{keetaActive ? 'HungerStation · Keeta' : 'HungerStation'}</span>}
          />
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="hungerOrders" name="HungerStation" fill="#d97706" radius={[4, 4, 0, 0]} />
                {keetaActive && <Bar dataKey="keetaOrders" name="Keeta" fill="#2563eb" radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="space-y-4">
          <SectionHeader
            title="اتجاه ساعات العمل والاتصال اليومية"
            actions={<span className="text-xs text-slate-500 dark:text-slate-400">الساعات المسجلة يوميًا</span>}
          />
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="hungerHours" name="HungerStation (س)" stroke="#d97706" strokeWidth={2} dot={false} />
                {keetaActive && <Line type="monotone" dataKey="keetaHours" name="Keeta (س)" stroke="#0d9488" strokeWidth={2} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Top & Bottom Riders */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="space-y-3">
          <SectionHeader
            title="أعلى المندوبين أداءً (وفق النتيجة الموزونة)"
            actions={<StatusBadge tone="success" label={`أفضل ${topPerformers.length}`} />}
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">المندوب</th>
                  <th className="px-3 py-2 text-right font-semibold">المنصة</th>
                  <th className="px-3 py-2 text-center font-semibold">الطلبات</th>
                  <th className="px-3 py-2 text-center font-semibold">متوسط/يوم</th>
                  <th className="px-3 py-2 text-center font-semibold">التقييم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topPerformers.map((r) => (
                  <tr
                    key={`top:${r.platform}:${r.riderId}`}
                    onClick={() => onSelectRider(r.platform, r.riderId)}
                    className="h-[42px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{r.riderName}</div>
                      <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{r.riderId}</div>
                    </td>
                    <td className="px-3 py-2">{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.totalOrders)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{r.avgOrdersPerDay}</td>
                    <td className="px-3 py-2 text-center font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                      {r.totalScore}/100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader
            title="الأقل أداءً (يتطلبون متابعة إشرافية)"
            actions={<StatusBadge tone="danger" label="أولوية المتابعة" />}
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">المندوب</th>
                  <th className="px-3 py-2 text-right font-semibold">المنصة</th>
                  <th className="px-3 py-2 text-center font-semibold">الطلبات</th>
                  <th className="px-3 py-2 text-center font-semibold">متوسط/يوم</th>
                  <th className="px-3 py-2 text-center font-semibold">التقييم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bottomPerformers.map((r) => (
                  <tr
                    key={`bot:${r.platform}:${r.riderId}`}
                    onClick={() => onSelectRider(r.platform, r.riderId)}
                    className="h-[42px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{r.riderName}</div>
                      <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{r.riderId}</div>
                    </td>
                    <td className="px-3 py-2">{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.totalOrders)}</td>
                    <td className="px-3 py-2 text-center font-mono-num text-amber-700 dark:text-amber-400">{r.avgOrdersPerDay}</td>
                    <td className="px-3 py-2 text-center font-mono-num font-bold text-red-700 dark:text-red-400">
                      {r.totalScore}/100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Branches Scorecards + Anomalies */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="space-y-3">
          <SectionHeader
            title="أداء الفروع والمدن الفعلية"
            actions={<span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">{branches.length} فرع / مدينة</span>}
          />
          {branches.length === 0 ? (
            <EmptyState title="لا توجد بيانات فروع مسجلة في هذا النطاق" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold">الفرع / المدينة</th>
                    <th className="px-3 py-2 text-center font-semibold">المندوبون</th>
                    <th className="px-3 py-2 text-center font-semibold">الطلبات</th>
                    <th className="px-3 py-2 text-center font-semibold">الإنجاز %</th>
                    <th className="px-3 py-2 text-center font-semibold">الوضع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {branches.slice(0, 8).map((b) => (
                    <tr key={b.branchName} className="h-[42px] hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{b.branchName}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{b.activeRidersCount}/{b.ridersCount}</td>
                      <td className="px-3 py-2 text-center font-mono-num font-semibold">{fmtNum(b.completedOrders)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtPct(b.completionRate)}</td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge
                          label={b.healthStatus}
                          tone={
                            b.healthStatus === 'يحتاج تدخل'
                              ? 'danger'
                              : b.healthStatus === 'ممتاز'
                                ? 'success'
                                : 'info'
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <SectionHeader
            title="رصد التراجع المفاجئ والانخفاض المتتالي"
            actions={<TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          />
          {anomalies.length === 0 ? (
            <EmptyState title="لا توجد أنماط هبوط حاد أو تراجع متتالي خلال هذا النطاق" />
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto erp-scroll">
              {anomalies.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectRider(a.platform, a.riderId)}
                  className="w-full text-right rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <StatusBadge
                      label={a.title}
                      tone={a.severity === 'critical' ? 'danger' : 'warning'}
                    />
                    <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                      {a.platform === 'hungerstation' ? 'HS' : 'Keeta'} · {a.riderId}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{a.description}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* KPI Drilldown RTL SlideDrawer */}
      <SlideDrawer
        open={Boolean(drilldownData)}
        onClose={() => setDrilldownKey(null)}
        title={drilldownData?.title || 'تفاصيل المؤشر'}
        subtitle={drilldownData?.note}
        size="xl"
        footer={
          <Button variant="secondary" onClick={() => setDrilldownKey(null)}>
            إغلاق
          </Button>
        }
      >
        {drilldownData && (
          <div className="space-y-4">
            {drilldownData.def && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-4 text-xs space-y-1.5">
                <div>
                  <span className="font-bold text-slate-700 dark:text-slate-300">الحقول المصدرية: </span>
                  <span className="font-mono-num text-slate-600 dark:text-slate-400">{drilldownData.def.exactFields}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 dark:text-slate-300">المعادلة: </span>
                  <span className="text-slate-600 dark:text-slate-400">{drilldownData.def.formulaText}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 dark:text-slate-300">فرق المنصتين: </span>
                  <span className="text-slate-600 dark:text-slate-400">{drilldownData.def.platformDifferenceNote}</span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
                    <th className="px-3 py-2.5 text-right font-semibold">المنصة</th>
                    <th className="px-3 py-2.5 text-right font-semibold">المندوب</th>
                    <th className="px-3 py-2.5 text-center font-semibold">الطلبات</th>
                    <th className="px-3 py-2.5 text-center font-semibold">الساعات</th>
                    <th className="px-3 py-2.5 text-center font-semibold">الحضور %</th>
                    <th className="px-3 py-2.5 text-center font-semibold">الإنجاز %</th>
                    <th className="px-3 py-2.5 text-center font-semibold">المسافة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {drilldownData.rows.slice(0, 60).map((r, i) => (
                    <tr
                      key={`${r.platform}:${r.riderId}:${r.date}:${i}`}
                      onClick={() => {
                        setDrilldownKey(null);
                        onSelectRider(r.platform, r.riderId);
                      }}
                      className="h-[42px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-3 py-2 font-mono-num">{r.date}</td>
                      <td className="px-3 py-2">{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</td>
                      <td className="px-3 py-2 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                        {r.riderId} {r.riderName !== r.riderId ? `(${r.riderName})` : ''}
                      </td>
                      <td className="px-3 py-2 text-center font-mono-num font-semibold">{fmtNum(r.completedOrders)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtHours(r.workingHours)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.attendanceRate)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.completionRate)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtKm(r.totalKm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {drilldownData.rows.length > 60 && (
              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                يتم عرض أول 60 سجلًا من أصل <span className="font-mono-num font-semibold">{drilldownData.rows.length}</span>. استخدم التبويبات التشغيلية لعرض السجل الكامل.
              </div>
            )}
          </div>
        )}
      </SlideDrawer>
    </div>
  );
}

function PeriodMetricCell({
  label,
  current,
  previous,
  delta,
  positive,
  range,
}: {
  label: string;
  current: string;
  previous: string;
  delta: string;
  positive: boolean;
  range?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-1">
      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">{current}</span>
        <StatusBadge label={delta} tone={positive ? 'success' : 'danger'} className="font-mono-num" />
      </div>
      <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">السابق: {previous}</div>
      {range && <div className="text-[10px] font-mono-num text-slate-400 dark:text-slate-500 truncate">{range}</div>}
    </div>
  );
}
