import {
  AlertTriangle,
  ArrowUpLeft,
  CheckCircle2,
  ClipboardList,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
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
import type {
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalSettings,
  Platform,
} from '../types/fleet';
import { KpiCard } from './KpiCard';

interface OverviewDashboardProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  operationalCases: OperationalCase[];
  settings: OperationalSettings;
  onGoToImport: () => void;
  onGoToOperations: () => void;
  onGoToErrors: () => void;
  onSelectRider: (platform: Platform, riderId: string) => void;
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
  onGoToImport,
  onGoToOperations,
  onGoToErrors,
  onSelectRider,
}: OverviewDashboardProps) {
  const [periodTab, setPeriodTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [drilldownKey, setDrilldownKey] = useState<DrilldownKey | null>(null);

  const metrics = useMemo(
    () => computeOverviewMetrics(filteredRows, settings),
    [filteredRows, settings]
  );

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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">لا توجد بيانات تشغيلية مطابقة للفلاتر الحالية</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          قم برفع تقارير HungerStation أو Keeta من مركز الاستيراد لعرض مؤشرات القيادة والبيانات التحليلية.
        </p>
        <button
          type="button"
          onClick={onGoToImport}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Upload className="h-4 w-4" />
          <span>الانتقال إلى مركز الاستيراد</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Executive Command Summary Strip (Answers 4 Executive Questions) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>1. الوضع التشغيلي الآن</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(metrics.activeRiders)} نشط · {fmtNum(metrics.completedOrders)} طلب
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            نسبة الإنجاز {fmtPct(metrics.completionRate)} · الحضور {fmtPct(metrics.attendanceRate)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>2. الالتزام بالأهداف</span>
            <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(riderScores.filter((r) => (r.totalScore ?? 0) >= 72).length)} متفوق ·{' '}
            <span className="text-red-700 dark:text-red-400">{fmtNum(metrics.lowPerformanceRidersCount)} دون الهدف</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            الفروع: {branches.filter((b) => b.healthStatus === 'يحتاج تدخل').length} فرع/مدينة تتطلب تدخلًا
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToErrors}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>3. مواطن الخلل والشذوذ</span>
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(anomalies.length)} هبوط حاد · {fmtNum(metrics.overdueOrders)} متأخر
          </div>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>فحص مركز أكواد الأخطاء</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>

        <button
          type="button"
          onClick={onGoToOperations}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>4. تدخل الإدارة اليوم</span>
            <ClipboardList className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(openCasesCount)} حالة مفتوحة ({fmtNum(criticalCasesCount)} حرجة)
          </div>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>إدارة طابور التدخل والحالات</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>
      </div>

      {/* Period Comparisons with Strict Completeness Guard */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">مقارنات الفترات المرجعية</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              تظهر المقارنة فقط عند اكتمال نافذتي المقارنة لحماية الإدارة من قراءة نسب مضللة على فترات ناقصة.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-1">
            {[
              { id: 'daily', label: 'يوم مقابل يوم' },
              { id: 'weekly', label: 'أسبوع مقابل أسبوع' },
              { id: 'monthly', label: 'شهر مقابل شهر' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPeriodTab(t.id as 'daily' | 'weekly' | 'monthly')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  periodTab === t.id
                    ? 'bg-slate-900 dark:bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {activePeriod.status === 'incomplete' ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">فترة مرجعية غير مكتملة — تم حجب المقارنة الإجمالية</div>
              <p className="mt-1">{activePeriod.incompleteReason}</p>
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
      </div>

      {/* 14 Clickable Executive KPIs */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">المؤشرات التشغيلية التنفيذية (اضغط على أي مؤشر للتنقيب والتفاصيل)</span>
          <span>14 مؤشرًا فعليًا</span>
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">الطلبات المكتملة اليومية حسب المنصة</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">HungerStation · Keeta</span>
          </div>
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="hungerOrders" name="HungerStation" fill="#d97706" radius={[4, 4, 0, 0]} />
                <Bar dataKey="keetaOrders" name="Keeta" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">اتجاه ساعات العمل والاتصال اليومية</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">الساعات المسجلة يوميًا</span>
          </div>
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="hungerHours" name="HungerStation (س)" stroke="#d97706" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="keetaHours" name="Keeta (س)" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top & Bottom Riders + Branch Health */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Top Performers */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">أعلى المندوبين أداءً (وفق النتيجة الموزونة)</h3>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">أفضل {topPerformers.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right">المندوب</th>
                  <th className="px-3 py-2 text-right">المنصة</th>
                  <th className="px-3 py-2 text-center">الطلبات</th>
                  <th className="px-3 py-2 text-center">متوسط/يوم</th>
                  <th className="px-3 py-2 text-center">التقييم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topPerformers.map((r) => (
                  <tr
                    key={`top:${r.platform}:${r.riderId}`}
                    onClick={() => onSelectRider(r.platform, r.riderId)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
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
        </div>

        {/* Bottom Performers */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">الأقل أداءً (يتطلبون متابعة إشرافية)</h3>
            <span className="text-xs text-red-700 dark:text-red-400 font-semibold">أولوية المتابعة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right">المندوب</th>
                  <th className="px-3 py-2 text-right">المنصة</th>
                  <th className="px-3 py-2 text-center">الطلبات</th>
                  <th className="px-3 py-2 text-center">متوسط/يوم</th>
                  <th className="px-3 py-2 text-center">التقييم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bottomPerformers.map((r) => (
                  <tr
                    key={`bot:${r.platform}:${r.riderId}`}
                    onClick={() => onSelectRider(r.platform, r.riderId)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
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
        </div>
      </div>

      {/* Branches Scorecards + Anomalies */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">أداء الفروع والمدن الفعلية</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{branches.length} فرع / مدينة</span>
          </div>
          {branches.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">لا توجد بيانات فروع مسجلة في هذا النطاق.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-right">الفرع / المدينة</th>
                    <th className="px-3 py-2 text-center">المندوبون</th>
                    <th className="px-3 py-2 text-center">الطلبات</th>
                    <th className="px-3 py-2 text-center">الإنجاز %</th>
                    <th className="px-3 py-2 text-center">الوضع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {branches.slice(0, 8).map((b) => (
                    <tr key={b.branchName}>
                      <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{b.branchName}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{b.activeRidersCount}/{b.ridersCount}</td>
                      <td className="px-3 py-2 text-center font-mono-num font-semibold">{fmtNum(b.completedOrders)}</td>
                      <td className="px-3 py-2 text-center font-mono-num">{fmtPct(b.completionRate)}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`font-semibold ${
                            b.healthStatus === 'يحتاج تدخل'
                              ? 'text-red-700 dark:text-red-400'
                              : b.healthStatus === 'ممتاز'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {b.healthStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">رصد التراجع المفاجئ والانخفاض المتتالي</h3>
            <TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          {anomalies.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">لا توجد أنماط هبوط حاد أو تراجع متتالي خلال هذا النطاق.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {anomalies.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectRider(a.platform, a.riderId)}
                  className="w-full text-right rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-bold ${a.severity === 'critical' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      {a.title}
                    </span>
                    <span className="font-mono-num text-slate-500 dark:text-slate-400">
                      {a.platform === 'hungerstation' ? 'HS' : 'Keeta'} · {a.riderId}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI Drilldown Drawer / Modal */}
      {drilldownData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{drilldownData.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{drilldownData.note}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrilldownKey(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {drilldownData.def && (
              <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-5 py-3 text-xs space-y-1">
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

            <div className="flex-1 overflow-auto p-5">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-right">التاريخ</th>
                    <th className="px-3 py-2 text-right">المنصة</th>
                    <th className="px-3 py-2 text-right">المندوب</th>
                    <th className="px-3 py-2 text-center">الطلبات</th>
                    <th className="px-3 py-2 text-center">الساعات</th>
                    <th className="px-3 py-2 text-center">الحضور %</th>
                    <th className="px-3 py-2 text-center">الإنجاز %</th>
                    <th className="px-3 py-2 text-center">المسافة</th>
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
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
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
              {drilldownData.rows.length > 60 && (
                <div className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
                  يتم عرض أول 60 سجلًا من أصل {drilldownData.rows.length}. استخدم التبويبات التشغيلية لعرض السجل الكامل.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3">
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">{current}</span>
        <span className={`text-xs font-mono-num font-semibold ${positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {delta}
        </span>
      </div>
      <div className="mt-1 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">السابق: {previous}</div>
      {range && <div className="mt-0.5 text-[10px] font-mono-num text-slate-400 dark:text-slate-500 truncate">{range}</div>}
    </div>
  );
}
