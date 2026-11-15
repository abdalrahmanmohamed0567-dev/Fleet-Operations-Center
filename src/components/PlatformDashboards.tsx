import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  Link2,
  ScanFace,
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
import { DEFAULT_OPERATIONAL_SETTINGS } from '../lib/firebase';
import {
  buildUnifiedDailyRows,
  filterUnifiedRows,
  fmtCurrency,
  fmtHours,
  fmtKm,
  fmtNum,
  fmtPct,
  scopeDatasetToPlatform,
  type FleetDataset,
} from '../lib/fleetAnalytics';
import {
  KEETA_KPI_DICTIONARY,
  computeKeetaCrossSheetLinkage,
  computeKeetaDashboardAnalytics,
  computeKeetaFacialAnalytics,
  computeKeetaRankAnalytics,
  computeKeetaVdaAnalytics,
} from '../lib/keetaIntelligence';
import {
  computePeriodComparisons,
  computeRiderPerformanceScore,
  detectOperationalAnomalies,
  type PeriodWindowSummary,
} from '../lib/smartAnalytics';
import type {
  FilterState,
  HungerDailyRecord,
  KeetaDashboardDaily,
  KeetaRankSnapshot,
  OperationalCase,
  OperationalSettings,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
  StatusBadge,
  Tabs,
  ToastBanner,
} from './ui/EnterpriseUI';

interface PlatformViewProps {
  dataset: FleetDataset;
  filters: FilterState;
  operationalCases?: OperationalCase[];
  settings?: OperationalSettings;
  onSelectRider: (platform: 'hungerstation' | 'keeta', riderId: string) => void;
  onGoToErrors?: () => void;
  onGoToOperations?: () => void;
  onGoToImport?: () => void;
  onGoToFacial?: () => void;
}

const FALLBACK_SETTINGS: OperationalSettings = {
  ...DEFAULT_OPERATIONAL_SETTINGS,
  createdByUid: '',
  allowedUids: [],
};

export function HungerStationView({
  dataset,
  filters,
  operationalCases = [],
  settings = FALLBACK_SETTINGS,
  onSelectRider,
  onGoToErrors,
  onGoToOperations,
  onGoToImport,
}: PlatformViewProps) {
  const [periodTab, setPeriodTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const hsDataset = useMemo(() => scopeDatasetToPlatform(dataset, 'hungerstation'), [dataset]);

  const daily = useMemo(
    () =>
      hsDataset.hungerDaily.filter((r) => {
        if (filters.date && r.date !== filters.date) return false;
        if (filters.month && r.month !== filters.month) return false;
        if (filters.city && r.city !== filters.city) return false;
        if (filters.contract && r.contractName !== filters.contract) return false;
        if (filters.vehicleType && r.vehicleName !== filters.vehicleType) return false;
        if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [hsDataset.hungerDaily, filters]
  );

  const dist = useMemo(
    () =>
      hsDataset.hungerDistanceDaily.filter((d) => {
        if (filters.date && d.date !== filters.date) return false;
        if (filters.month && d.month !== filters.month) return false;
        if (filters.city && d.city !== filters.city) return false;
        if (filters.contract && d.contractName !== filters.contract) return false;
        if (filters.riderId && !d.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [hsDataset.hungerDistanceDaily, filters]
  );

  const quality = useMemo(
    () =>
      hsDataset.hungerQualityMonthly.filter((q) => {
        if (filters.month && q.month !== filters.month) return false;
        if (filters.city && q.city !== filters.city) return false;
        if (filters.contract && q.contractName !== filters.contract) return false;
        if (filters.vehicleType && q.vehicleType !== filters.vehicleType) return false;
        if (filters.riderId && !q.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [hsDataset.hungerQualityMonthly, filters]
  );

  const wallets = useMemo(
    () =>
      hsDataset.hungerWalletSnapshots.filter((w) => {
        if (filters.riderId && !w.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [hsDataset.hungerWalletSnapshots, filters.riderId]
  );

  const hsUnified = useMemo(
    () =>
      filterUnifiedRows(buildUnifiedDailyRows(hsDataset), {
        ...filters,
        platform: 'hungerstation',
      }),
    [hsDataset, filters]
  );

  const periods = useMemo(
    () => computePeriodComparisons(hsUnified, settings),
    [hsUnified, settings]
  );

  const hsScores = useMemo(() => {
    const byRider = new Map<string, typeof hsUnified>();
    for (const r of hsUnified) {
      const arr = byRider.get(r.riderId) || [];
      arr.push(r);
      byRider.set(r.riderId, arr);
    }
    const qualByRider = new Map<string, number>();
    for (const q of hsDataset.hungerQualityMonthly) {
      if (q.finalDeliveryQualityScore !== null) {
        qualByRider.set(q.riderId, q.finalDeliveryQualityScore);
      }
    }
    return Array.from(byRider.entries())
      .map(([rid, rows]) =>
        computeRiderPerformanceScore('hungerstation', rid, rows, settings, qualByRider.get(rid) ?? null)
      )
      .filter((x) => x.totalScore !== null);
  }, [hsUnified, hsDataset.hungerQualityMonthly, settings]);

  const topHs = useMemo(
    () => [...hsScores].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0)).slice(0, 5),
    [hsScores]
  );
  const bottomHs = useMemo(
    () => [...hsScores].sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0)).slice(0, 5),
    [hsScores]
  );
  const hsAnomalies = useMemo(() => detectOperationalAnomalies(hsUnified), [hsUnified]);

  const hsDailyTrend = useMemo(() => {
    const map = new Map<string, { date: string; completed: number; hours: number }>();
    for (const r of daily) {
      const cur = map.get(r.date) || { date: r.date, completed: 0, hours: 0 };
      cur.completed += r.completedDeliveries ?? 0;
      cur.hours += r.actualWorkingHours ?? 0;
      map.set(r.date, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, hours: Number(d.hours.toFixed(1)) }));
  }, [daily]);

  const completed = daily.reduce((s, r) => s + (r.completedDeliveries ?? 0), 0);
  const accepted = daily.reduce((s, r) => s + (r.acceptedDeliveries ?? 0), 0);
  const declined = daily.reduce((s, r) => s + (r.declinedDeliveries ?? 0) + (r.notAcceptedDeliveries ?? 0), 0);
  const cancelled = daily.reduce((s, r) => s + (r.cancelledDeliveries ?? 0), 0);
  const plannedHrs = daily.reduce((s, r) => s + (r.plannedWorkingHours ?? 0), 0);
  const actualHrs = daily.reduce((s, r) => s + (r.actualWorkingHours ?? 0), 0);
  const breakHrs = daily.reduce((s, r) => s + (r.breakHours ?? 0), 0);
  const lostHrs = daily.reduce((s, r) => s + (r.lostHours ?? 0), 0);
  const shifts = daily.reduce((s, r) => s + (r.shifts ?? 0), 0);
  const noShows = daily.reduce((s, r) => s + (r.noShows ?? 0), 0);
  const totalKm = dist.reduce((s, d) => s + (d.totalKm ?? 0), 0);
  const payableKm = dist.reduce((s, d) => s + (d.payableKm ?? 0), 0);
  const activeHsRiders = new Set(hsUnified.filter((r) => r.isActive).map((r) => r.riderId)).size;
  const totalHsRiders = new Set(hsUnified.map((r) => r.riderId)).size;
  const errorRowCount = daily.filter((r) => Boolean(r.errorCodes && r.errorCodes.trim())).length;

  const hsCases = operationalCases.filter((c) => c.platform === 'hungerstation');
  const hsOpenCases = hsCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length;
  const hsCriticalCases = hsCases.filter(
    (c) => c.status !== 'closed' && c.status !== 'resolved' && c.priority === 'critical'
  ).length;

  const avgAtt = avgNums(daily.map((r) => r.attendanceRate));
  const avgAcc = avgNums(daily.map((r) => (r.attendanceRate !== null ? r.acceptanceRate : r.acceptanceRate)));
  const avgChat = avgNums(daily.map((r) => r.chatResponsePct));
  const avgQual = avgNums(quality.map((q) => q.finalDeliveryQualityScore));

  // Latest wallet per rider
  const latestWalletMap = new Map<string, number>();
  [...wallets]
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .forEach((w) => latestWalletMap.set(w.riderId, w.currentWallet));
  const totalWallet = Array.from(latestWalletMap.values()).reduce((a, b) => a + b, 0);

  // Segment distribution
  const segCounts = new Map<string, number>();
  for (const q of quality) {
    const seg = q.segment || 'غير مصنف';
    segCounts.set(seg, (segCounts.get(seg) || 0) + 1);
  }
  const segData = Array.from(segCounts.entries()).map(([segment, count]) => ({ segment, count }));

  const dailyCols: TableColumn<HungerDailyRecord>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'riderId', header: 'Rider ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'city', header: 'المدينة', sortValue: (r) => r.city, render: (r) => <span>{r.city || '-'}</span> },
    { key: 'contract', header: 'العقد', render: (r) => <span>{r.contractName || '-'}</span> },
    { key: 'comp', header: 'مكتملة', align: 'center', sortValue: (r) => r.completedDeliveries, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.completedDeliveries)}</span> },
    { key: 'acc', header: 'مقبولة', align: 'center', sortValue: (r) => r.acceptedDeliveries, render: (r) => <span className="font-mono-num">{fmtNum(r.acceptedDeliveries)}</span> },
    { key: 'dec', header: 'مرفوضة', align: 'center', sortValue: (r) => r.declinedDeliveries, render: (r) => <span className="font-mono-num">{fmtNum(r.declinedDeliveries)}</span> },
    { key: 'can', header: 'ملغاة', align: 'center', sortValue: (r) => r.cancelledDeliveries, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.cancelledDeliveries)}</span> },
    { key: 'hrs', header: 'فعلي / مخطط', align: 'center', sortValue: (r) => r.actualWorkingHours, render: (r) => <span className="font-mono-num">{fmtNum(r.actualWorkingHours, 1)} / {fmtNum(r.plannedWorkingHours, 1)}</span> },
    { key: 'att', header: 'الحضور %', align: 'center', sortValue: (r) => r.attendanceRate, render: (r) => <span className="font-mono-num">{fmtPct(r.attendanceRate)}</span> },
    { key: 'accRate', header: 'القبول %', align: 'center', sortValue: (r) => r.acceptanceRate, render: (r) => <span className="font-mono-num">{fmtPct(r.acceptanceRate)}</span> },
    { key: 'chat', header: 'المحادثات %', align: 'center', sortValue: (r) => r.chatResponsePct, render: (r) => <span className="font-mono-num">{fmtPct(r.chatResponsePct)}</span> },
  ];

  const activePeriod = periods[periodTab];

  if (daily.length === 0 && quality.length === 0 && wallets.length === 0) {
    return (
      <EmptyState
        title="لا توجد بيانات مستوردة لـ HungerStation في النطاق الحالي"
        subtitle="استورد تقارير HungerStation (Hunger-Daily / Riders Distance / Wallet / Quality Segmentation) من مركز استيراد هنقر."
        icon={<Upload className="h-5 w-5" />}
        action={
          onGoToImport && (
            <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={onGoToImport}>
              الانتقال إلى مركز استيراد HungerStation
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* HungerStation Executive Command Strip */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>الوضع التشغيلي — HungerStation</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(activeHsRiders)}/{fmtNum(totalHsRiders)} نشط · {fmtNum(completed)} طلب
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            الحضور <span className="font-mono-num font-semibold">{fmtPct(avgAtt)}</span> · القبول{' '}
            <span className="font-mono-num font-semibold">{fmtPct(avgAcc)}</span>
          </p>
        </Card>

        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>كفاءة الساعات والجودة الشهرية</span>
            <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtHours(actualHrs)} · جودة {fmtNum(avgQual, 1)}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            غياب (No Shows): <span className="font-mono-num font-semibold">{fmtNum(noShows)}</span> · المحافظ:{' '}
            <span className="font-mono-num font-semibold">{fmtCurrency(latestWalletMap.size ? totalWallet : null)}</span>
          </p>
        </Card>

        <button
          type="button"
          onClick={onGoToErrors}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-amber-400/70 dark:hover:border-amber-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>مركز أكواد الأخطاء والانحرافات</span>
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(errorRowCount)} سجل خطأ · {fmtNum(hsAnomalies.length)} هبوط حاد
          </div>
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
            <span>فتح Error Intelligence</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>

        <button
          type="button"
          onClick={onGoToOperations}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>حالات HungerStation المفتوحة</span>
            <ClipboardList className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(hsOpenCases)} مفتوحة ({fmtNum(hsCriticalCases)} حرجة)
          </div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>متابعة حالات هنقرستيشن</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>
      </div>

      {/* Period Comparisons (HS Only) */}
      <PlatformPeriodComparisonCard
        title="مقارنات الفترات المرجعية — HungerStation"
        periods={periods}
        periodTab={periodTab}
        onTabChange={setPeriodTab}
        activePeriod={activePeriod}
      />

      <ToastBanner
        type="info"
        message="فصل الجداول في HungerStation: البيانات اليومية تُقرأ من Hunger-Daily وRiders Distance، بينما Delivery Quality Segmentation وRiders Wallet تُعالج كلقطات منفصلة شهريًا أو بتاريخ اللقطة دون خلطها باليومي."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="الطلبات المكتملة" value={fmtNum(completed)} tone="good" />
        <KpiCard label="الطلبات المقبولة" value={fmtNum(accepted)} />
        <KpiCard label="المرفوضة / غير المقبولة" value={fmtNum(declined)} tone="warn" />
        <KpiCard label="الطلبات الملغاة" value={fmtNum(cancelled)} tone="critical" />
        <KpiCard label="الساعات الفعلية / المخططة" value={`${fmtNum(actualHrs, 1)} / ${fmtNum(plannedHrs, 1)}`} />
        <KpiCard label="معدل الحضور" value={fmtPct(avgAtt)} />
        <KpiCard label="إجمالي الشفتات" value={fmtNum(shifts)} />
        <KpiCard label="عدم الحضور (No Shows)" value={fmtNum(noShows)} tone={noShows > 0 ? 'critical' : 'neutral'} />
        <KpiCard label="ساعات الفقد / الاستراحة" value={`${fmtNum(lostHrs, 1)} / ${fmtNum(breakHrs, 1)}`} />
        <KpiCard label="معدل القبول" value={fmtPct(avgAcc)} />
        <KpiCard label="الاستجابة للمحادثات" value={fmtPct(avgChat)} />
        <KpiCard label="المسافات (Total / Payable)" value={`${fmtNum(totalKm, 0)} / ${fmtNum(payableKm, 0)} كم`} />
        <KpiCard label="إجمالي أرصدة المحافظ" value={fmtCurrency(latestWalletMap.size ? totalWallet : null)} />
        <KpiCard label="متوسط Quality Score" value={fmtNum(avgQual, 1)} tone="good" />
      </div>

      {/* HS Charts: Daily Trend & Delivery Quality Segmentation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <SectionHeader title="اتجاه الطلبات وساعات العمل اليومية — HungerStation" />
          <div className="h-60 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hsDailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="completed" name="الطلبات المكتملة" stroke="#d97706" strokeWidth={2} />
                <Line type="monotone" dataKey="hours" name="ساعات العمل" stroke="#0f766e" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {segData.length > 0 && (
          <Card className="space-y-4">
            <SectionHeader title="توزيع شرائح جودة التسليم (Delivery Quality Segments)" />
            <div className="h-60 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={segData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                  <XAxis dataKey="segment" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="عدد المندوبين" fill="#d97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {/* HS Top & Bottom Performers + Anomalies */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <PlatformRiderRankCard
          title="أعلى مندوبي HungerStation"
          subtitle="وفق التقييم الموزون"
          accent="good"
          rows={topHs}
          onSelect={(rid) => onSelectRider('hungerstation', rid)}
        />
        <PlatformRiderRankCard
          title="مندوبو هنقر الأقل أداءً"
          subtitle="أولوية المتابعة"
          accent="bad"
          rows={bottomHs}
          onSelect={(rid) => onSelectRider('hungerstation', rid)}
        />
        <PlatformAnomaliesCard
          title="تراجع الأداء المفاجئ — هنقرستيشن"
          anomalies={hsAnomalies}
          onSelect={(rid) => onSelectRider('hungerstation', rid)}
        />
      </div>

      <DataTable
        rows={daily}
        columns={dailyCols}
        rowKey={(r) => r.recordKey}
        searchPlaceholder="ابحث برقم المندوب أو المدينة أو العقد..."
        searchText={(r) => `${r.riderId} ${r.city || ''} ${r.contractName || ''} ${r.date}`}
        onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
      />
    </div>
  );
}

export function KeetaView({
  dataset,
  filters,
  operationalCases = [],
  settings = FALLBACK_SETTINGS,
  onSelectRider,
  onGoToOperations,
  onGoToImport,
  onGoToFacial,
}: PlatformViewProps) {
  const [periodTab, setPeriodTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [showKpiDict, setShowKpiDict] = useState(false);
  const [showLinkagePanel, setShowLinkagePanel] = useState(false);

  const ktDataset = useMemo(() => scopeDatasetToPlatform(dataset, 'keeta'), [dataset]);

  const dash = useMemo(
    () =>
      ktDataset.keetaDashboardDaily.filter((r) => {
        if (filters.date && r.date !== filters.date) return false;
        if (filters.month && r.month !== filters.month) return false;
        if (filters.city && r.headquarters !== filters.city) return false;
        if (filters.branch && r.branch !== filters.branch) return false;
        if (filters.supervisor && r.supervisor !== filters.supervisor) return false;
        if (filters.vehicleType && r.vehicleType !== filters.vehicleType) return false;
        if (filters.riderId && !r.riderId.includes(filters.riderId.trim()) && !(r.fullName || '').toLowerCase().includes(filters.riderId.trim().toLowerCase())) {
          return false;
        }
        return true;
      }),
    [ktDataset.keetaDashboardDaily, filters]
  );

  const vda = useMemo(
    () =>
      ktDataset.keetaVdaDaily.filter((v) => {
        if (filters.date && v.date !== filters.date) return false;
        if (filters.month && v.month !== filters.month) return false;
        if (filters.vehicleType && v.vehicleType !== filters.vehicleType) return false;
        if (filters.riderId && !v.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [ktDataset.keetaVdaDaily, filters]
  );

  const facial = useMemo(
    () =>
      ktDataset.keetaFacialRecognitionDaily.filter((f) => {
        if (filters.date && f.date !== filters.date) return false;
        if (filters.month && f.month !== filters.month) return false;
        if (filters.city && f.city !== filters.city) return false;
        if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) return false;
        return true;
      }),
    [ktDataset.keetaFacialRecognitionDaily, filters]
  );

  // RankPlanProcess is a cumulative Snapshot table — filtered strictly by riderId (never summed into daily metrics)
  const rank = useMemo(
    () =>
      ktDataset.keetaRankSnapshots.filter((rk) => {
        if (filters.riderId && !rk.riderId.includes(filters.riderId.trim()) && !(rk.name || '').toLowerCase().includes(filters.riderId.trim().toLowerCase())) {
          return false;
        }
        return true;
      }),
    [ktDataset.keetaRankSnapshots, filters.riderId]
  );

  const dashStats = useMemo(() => computeKeetaDashboardAnalytics(dash), [dash]);
  const vdaStats = useMemo(() => computeKeetaVdaAnalytics(vda), [vda]);
  const rankStats = useMemo(() => computeKeetaRankAnalytics(rank), [rank]);
  const facialStats = useMemo(() => computeKeetaFacialAnalytics(facial), [facial]);
  const linkage = useMemo(() => computeKeetaCrossSheetLinkage(ktDataset), [ktDataset]);

  const ktUnified = useMemo(
    () =>
      filterUnifiedRows(buildUnifiedDailyRows(ktDataset), {
        ...filters,
        platform: 'keeta',
      }),
    [ktDataset, filters]
  );

  const periods = useMemo(() => computePeriodComparisons(ktUnified, settings), [ktUnified, settings]);

  const ktScores = useMemo(() => {
    const byRider = new Map<string, typeof ktUnified>();
    for (const r of ktUnified) {
      const arr = byRider.get(r.riderId) || [];
      arr.push(r);
      byRider.set(r.riderId, arr);
    }
    return Array.from(byRider.entries())
      .map(([rid, rows]) => computeRiderPerformanceScore('keeta', rid, rows, settings, null))
      .filter((x) => x.totalScore !== null);
  }, [ktUnified, settings]);

  const topKt = useMemo(
    () => [...ktScores].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0)).slice(0, 5),
    [ktScores]
  );
  const bottomKt = useMemo(
    () => [...ktScores].sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0)).slice(0, 5),
    [ktScores]
  );
  const ktAnomalies = useMemo(() => detectOperationalAnomalies(ktUnified), [ktUnified]);

  const ktDailyTrend = useMemo(
    () =>
      dashStats.dailySeries.map((d) => {
        const hrs = dash
          .filter((x) => x.date === d.date)
          .reduce((s, x) => s + (x.shiftOnlineHours ?? 0), 0);
        return {
          date: d.date,
          delivered: d.delivered,
          hours: Number(hrs.toFixed(1)),
        };
      }),
    [dashStats.dailySeries, dash]
  );

  const activeKtRiders = new Set(ktUnified.filter((r) => r.isActive).map((r) => r.riderId)).size;
  const totalKtRiders = new Set(ktUnified.map((r) => r.riderId)).size;

  const ktCases = operationalCases.filter((c) => c.platform === 'keeta');
  const ktOpenCases = ktCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved').length;
  const ktCriticalCases = ktCases.filter(
    (c) => c.status !== 'closed' && c.status !== 'resolved' && c.priority === 'critical'
  ).length;

  const latestRankList = rankStats.latestRows;
  const latestSnapshotEstReward = rankStats.totalEstimatedRewardLatest;
  const rankChart = rankStats.levelDistribution;

  const dashCols: TableColumn<KeetaDashboardDaily>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', sortValue: (r) => r.fullName, render: (r) => <span>{r.fullName || '-'}</span> },
    { key: 'branch', header: 'الفرع / المشرف', render: (r) => <span>{r.branch || '-'} · {r.supervisor || '-'}</span> },
    { key: 'hours', header: 'Shift / Valid / App (س)', align: 'center', sortValue: (r) => r.shiftOnlineHours, render: (r) => <span className="font-mono-num">{fmtNum(r.shiftOnlineHours, 1)} / {fmtNum(r.shiftValidOnlineTime, 1)} / {fmtNum(r.appOnlineTime, 1)}</span> },
    { key: 'del', header: 'Delivered', align: 'center', sortValue: (r) => r.deliveredTasks, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.deliveredTasks)}</span> },
    { key: 'acc', header: 'Accepted / Rej (C/A)', align: 'center', render: (r) => <span className="font-mono-num">{fmtNum(r.acceptedTasks)} / {fmtNum(r.rejectedTasks)} ({fmtNum(r.rejectedTasksCourier)}/{fmtNum(r.rejectedTasksAuto)})</span> },
    { key: 'comp', header: 'Completion %', align: 'center', sortValue: (r) => r.completionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.completionRate)}</span> },
    { key: 'ontime', header: 'On-time %', align: 'center', sortValue: (r) => r.onTimeRate, render: (r) => <span className="font-mono-num">{fmtPct(r.onTimeRate)}</span> },
    { key: 'avgMin', header: 'Avg Time (د)', align: 'center', sortValue: (r) => r.avgDeliveryTimeMinutes, render: (r) => <span className="font-mono-num">{fmtNum(r.avgDeliveryTimeMinutes, 1)}</span> },
    {
      key: 'overdue',
      header: '>55m Prop / Overdue',
      align: 'center',
      sortValue: (r) => r.overdueOrderTasks,
      render: (r) => (
        <span className="font-mono-num text-red-700 dark:text-red-400">
          {r.deliveredOver55MinProp !== null && r.deliveredOver55MinProp !== undefined ? fmtPct(r.deliveredOver55MinProp) : fmtNum(r.deliveredOver55Min)} / {fmtNum(r.overdueOrderTasks)}
        </span>
      ),
    },
  ];

  const rankCols: TableColumn<KeetaRankSnapshot>[] = [
    { key: 'snap', header: 'تاريخ اللقطة', sortValue: (r) => r.snapshotDate, render: (r) => <span className="font-mono-num">{r.snapshotDate}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', render: (r) => <span>{r.name || '-'}</span> },
    { key: 'lvl', header: 'المستوى المقدر', sortValue: (r) => r.currentEstimatedLevel, render: (r) => <span className="font-semibold text-blue-700 dark:text-blue-400">{r.currentEstimatedLevel || '-'}</span> },
    { key: 'pct', header: 'Percentile', align: 'center', sortValue: (r) => r.rankingPercentile, render: (r) => <span className="font-mono-num">{fmtNum(r.rankingPercentile, 1)}</span> },
    { key: 'ot', header: 'On-time %', align: 'center', sortValue: (r) => r.onTimeRate, render: (r) => <span className="font-mono-num">{fmtPct(r.onTimeRate)}</span> },
    { key: 'comp', header: 'Completion %', align: 'center', sortValue: (r) => r.orderCompletionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.orderCompletionRate)}</span> },
    { key: 'rew', header: 'المكافأة المقدرة', align: 'center', sortValue: (r) => r.estimatedRewardAmount, render: (r) => <span className="font-mono-num text-emerald-700 dark:text-emerald-400">{fmtCurrency(r.estimatedRewardAmount)}</span> },
  ];

  const activePeriod = periods[periodTab];

  if (dash.length === 0 && vda.length === 0 && latestRankList.length === 0 && facial.length === 0) {
    return (
      <EmptyState
        title="لا توجد بيانات مستوردة لـ Keeta في النطاق الحالي"
        subtitle="استورد تقارير Keeta (Dashboard / VDA / RankPlanProcess / Facial Recognition) بصيغة XLSX أو CSV من مركز استيراد كيتا."
        icon={<Upload className="h-5 w-5" />}
        action={
          onGoToImport && (
            <Button variant="accent" icon={<Upload className="h-4 w-4" />} onClick={onGoToImport}>
              الانتقال إلى مركز استيراد Keeta
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Keeta Executive Command Strip */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>الوضع التشغيلي المرجح — Keeta</span>
            <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(activeKtRiders)}/{fmtNum(totalKtRiders)} نشط · {fmtNum(dashStats.deliveredTasks)} مهمة
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Acceptance {fmtPct(dashStats.acceptanceRate)} · Completion {fmtPct(dashStats.completionRate)} · On-time {fmtPct(dashStats.onTimeRate)}
          </p>
        </Card>

        <Card padding="sm" className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>الالتزام وساعات الاتصال (App / Shift / Valid)</span>
            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(vdaStats.totalValidShifts)} شفت صالح · {fmtNum(dashStats.overdueOrderTasks)} متأخر
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            Shift: {fmtHours(dashStats.shiftOnlineHours)} | Valid: {fmtHours(dashStats.shiftValidOnlineHours)} | App: {fmtHours(dashStats.appOnlineHours)}
          </p>
        </Card>

        <button
          type="button"
          onClick={onGoToFacial}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>التحقق من الهوية MTD (آخر لقطة/مندوب)</span>
            <ScanFace className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtPct(facialStats.mtdAvgPassRate)} اجتياز · {fmtNum(facialStats.dailyFailCount)} فشل يومي
          </div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>تحت 90%: {facialStats.mtdBelow90RidersCount} مندوب · فحص التفاصيل</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>

        <button
          type="button"
          onClick={onGoToOperations}
          className="text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>حالات Keeta وهبوط الأداء</span>
            <ClipboardList className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {fmtNum(ktOpenCases)} مفتوحة ({fmtNum(ktCriticalCases)} حرجة)
          </div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 inline-flex items-center gap-1">
            <span>انحرافات حادة: {fmtNum(ktAnomalies.length)} · متابعة حالات كيتا</span>
            <ArrowUpLeft className="h-3 w-3" />
          </p>
        </button>
      </div>

      {/* Period Comparisons (Keeta Only) */}
      <PlatformPeriodComparisonCard
        title="مقارنات الفترات المرجعية الموزونة — Keeta"
        periods={periods}
        periodTab={periodTab}
        onTabChange={setPeriodTab}
        activePeriod={activePeriod}
      />

      {/* Cross-Sheet Linkage & KPI Dictionary Controls */}
      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-900 dark:text-slate-100">هندسة Keeta رباعية الشيتات (91 عمودًا):</span>{' '}
          Dashboard ({dashStats.uniqueRiders} مندوب) · VDA ({vdaStats.uniqueRiders}) · RankPlan ({rankStats.uniqueRiders}) · Facial ({facialStats.uniqueRiders}) · تطابق كامل:{' '}
          <span className="font-mono-num font-bold text-blue-700 dark:text-blue-400">{linkage.inAll4SheetsCount}</span>.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={showLinkagePanel ? 'primary' : 'secondary'}
            icon={<Link2 className="h-3.5 w-3.5" />}
            onClick={() => setShowLinkagePanel((v) => !v)}
          >
            {showLinkagePanel ? 'إخفاء تقرير الربط والتكامل' : 'تقرير الربط بين الشيتات'}
          </Button>
          <Button
            size="sm"
            variant={showKpiDict ? 'primary' : 'secondary'}
            icon={<BookOpen className="h-3.5 w-3.5" />}
            onClick={() => setShowKpiDict((v) => !v)}
          >
            {showKpiDict ? 'إخفاء قاموس معادلات كيتا' : 'قاموس معادلات Keeta'}
          </Button>
        </div>
      </Card>

      {showLinkagePanel && (
        <Card className="space-y-4 text-xs border-blue-200 dark:border-blue-900/60">
          <SectionHeader
            title="تقرير تكامل الهويات عبر شيتات Keeta الأربعة"
            subtitle="فحص تطابق Courier ID والأسماء بين Dashboard وVDA وRankPlanProcess وFacialRecognitionDataReport."
            actions={
              <StatusBadge
                tone="info"
                className="font-mono-num"
                label={`الموحدون: ${linkage.totalUniqueRiders} | Dashboard ∩ VDA: ${linkage.inDashboardAndVdaCount}`}
              />
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-slate-500 dark:text-slate-400">بانتظار VDA (Dashboard فقط)</div>
              <div className="mt-1 font-mono-num text-base font-bold text-slate-900 dark:text-slate-100">{linkage.missingVdaForDashboardIds.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-slate-500 dark:text-slate-400">في VDA فقط</div>
              <div className="mt-1 font-mono-num text-base font-bold text-amber-700 dark:text-amber-400">{linkage.vdaNotInDashboardIds.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-slate-500 dark:text-slate-400">RankPlan / Facial دون Dashboard</div>
              <div className="mt-1 font-mono-num text-base font-bold text-amber-700 dark:text-amber-400">
                {linkage.rankNotInDashboardIds.length} / {linkage.facialNotInDashboardIds.length}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-slate-500 dark:text-slate-400">تعارضات الأسماء (Dashboard vs RankPlan)</div>
              <div className="mt-1 font-mono-num text-base font-bold text-red-700 dark:text-red-400">{linkage.nameDiscrepancies.length}</div>
            </div>
          </div>
          {linkage.nameDiscrepancies.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/20 p-3">
              <div className="font-bold text-amber-900 dark:text-amber-200 mb-1">فروقات الأسماء المكتشفة:</div>
              <div className="max-h-28 overflow-y-auto erp-scroll space-y-1 font-mono-num text-slate-700 dark:text-slate-300">
                {linkage.nameDiscrepancies.slice(0, 15).map((d) => (
                  <div key={d.riderId}>
                    {d.riderId}: Dashboard=&quot;{d.dashboardName}&quot; vs RankPlan=&quot;{d.rankName}&quot;
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {showKpiDict && (
        <Card className="space-y-4 text-xs border-emerald-200 dark:border-emerald-900/60">
          <SectionHeader title="قاموس المؤشرات والمعادلات المعتمدة لنظام Keeta" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {KEETA_KPI_DICTIONARY.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">{entry.titleAr}</span>
                  <StatusBadge tone="info" label={entry.sheet} className="font-mono-num" />
                </div>
                <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{entry.exactColumns.join(' , ')}</div>
                <div className="font-semibold text-emerald-800 dark:text-emerald-300">{entry.formulaAr}</div>
                <div className="text-slate-600 dark:text-slate-300">{entry.aggregationRule}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{entry.nullPolicy}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Shift / Valid / App Hours" value={`${fmtNum(dashStats.shiftOnlineHours, 1)} / ${fmtNum(dashStats.shiftValidOnlineHours, 1)} / ${fmtNum(dashStats.appOnlineHours, 1)}`} />
        <KpiCard label="Valid Shifts (VDA)" value={fmtNum(vdaStats.totalValidShifts)} subtext={`أيام مطلوبة: ${fmtNum(vdaStats.totalShouldOnlineDays)}`} />
        <KpiCard label="Delivered Tasks" value={fmtNum(dashStats.deliveredTasks)} tone="good" subtext={`Arrivals: ${fmtNum(dashStats.restaurantArrivals)} · Large: ${fmtNum(dashStats.largeOrderTasksCompleted)}`} />
        <KpiCard label="Accepted / Rejected" value={`${fmtNum(dashStats.acceptedTasks)} / ${fmtNum(dashStats.rejectedTasks)}`} subtext={`مندوب: ${fmtNum(dashStats.rejectedCourier)} | تلقائي: ${fmtNum(dashStats.rejectedAuto)}`} />
        <KpiCard label="Acceptance Rate (Weighted)" value={fmtPct(dashStats.acceptanceRate)} tone="good" />
        <KpiCard label="Completion Rate (Weighted)" value={fmtPct(dashStats.completionRate)} tone="good" />
        <KpiCard label="On-time Rate (Weighted)" value={fmtPct(dashStats.onTimeRate)} subtext={`Large OT: ${fmtPct(dashStats.largeOrderOnTimeRate)}`} />
        <KpiCard label="Cancellation Rate (Weighted)" value={fmtPct(dashStats.cancellationRate)} tone="warn" />
        <KpiCard label="Avg Delivery Time (Weighted)" value={dashStats.avgDeliveryTimeMinutes !== null ? `${dashStats.avgDeliveryTimeMinutes.toFixed(1)} دقيقة` : 'غير متاح'} />
        <KpiCard label=">55m Prop % (Dashboard)" value={fmtPct(dashStats.deliveredOver55MinPropWeighted)} tone={(dashStats.deliveredOver55MinPropWeighted ?? 0) > 5 ? 'warn' : 'neutral'} subtext="نسبة مرجحة بالمهام المسلمة" />
        <KpiCard label="Orders > 55m Count (VDA)" value={fmtNum(vdaStats.totalOver55MinCount)} tone={vdaStats.totalOver55MinCount > 0 ? 'warn' : 'neutral'} subtext={`Overdue: ${fmtNum(dashStats.overdueOrderTasks)} (Severe: ${fmtNum(dashStats.severelyOverdueOrderTasks)})`} />
        <KpiCard label="Payable / Total KM (VDA)" value={`${fmtKm(vdaStats.payableDistanceKm)}`} subtext={`الإجمالي: ${fmtKm(vdaStats.totalDistanceKm)} · PeAbdo: ${fmtNum(dashStats.shiftPeAbdoOnlineHours, 1)} س`} />
      </div>

      {/* 6-Window Shift Slot Utilization (from Dashboard Shift_Attendance Summary) */}
      {dashStats.slotBreakdown.length > 0 && (
        <Card className="space-y-3">
          <SectionHeader
            title="تحليل فترات الشفتات الـ 6 (Shift_Attendance Summary 00:00–24:00)"
            actions={
              <div className="flex items-center gap-2 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>
                  صفوف مفككة: {linkage.rowsWithParsedSlotsCount}/{dash.length} · On-Shift: {fmtPct(dashStats.onShiftRate)} · Valid Day: {fmtPct(dashStats.validDayRate)}
                </span>
              </div>
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {dashStats.slotBreakdown.map((slot) => (
              <div key={slot.window} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 text-xs space-y-1">
                <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{slot.window}</div>
                <div className="font-mono-num text-sm font-bold text-blue-700 dark:text-blue-400">{fmtHours(slot.totalHours)}</div>
                <div className="text-[11px] font-mono-num text-emerald-700 dark:text-emerald-400">مؤهل: {fmtNum(slot.qualifiedCount)}</div>
                <div className="text-[11px] font-mono-num text-amber-700 dark:text-amber-400">غير مؤهل: {fmtNum(slot.unqualifiedCount)}</div>
                <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">بدون شفت: {fmtNum(slot.noShiftCount)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Keeta Daily Trend + RankPlan Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <SectionHeader title="اتجاه المهام وساعات الاتصال اليومية — Keeta" />
          <div className="h-60 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ktDailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="delivered" name="Delivered Tasks" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="hours" name="Shift Online Hours" stroke="#0d9488" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {rankChart.length > 0 && (
          <Card className="space-y-4">
            <SectionHeader
              title="توزيع مستويات RankPlanProcess (آخر لقطة)"
              actions={
                rankStats.progression.hasHistory && (
                  <span className="font-mono-num text-xs font-semibold text-slate-600 dark:text-slate-300">
                    تطور ({rankStats.progression.previousDate} ← {rankStats.latestSnapshotDate}):{' '}
                    <span className="text-emerald-700 dark:text-emerald-400">+{rankStats.progression.upgradedCount}</span> /{' '}
                    <span className="text-red-700 dark:text-red-400">-{rankStats.progression.downgradedCount}</span>
                  </span>
                )
              }
            />
            <div className="h-60 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                  <XAxis dataKey="level" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="عدد المندوبين" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <PlatformRiderRankCard
          title="أعلى مندوبي Keeta أداءً"
          subtitle="وفق التقييم الموزون"
          accent="good"
          rows={topKt}
          onSelect={(rid) => onSelectRider('keeta', rid)}
        />
        <PlatformRiderRankCard
          title="مندوبو كيتا الأقل أداءً"
          subtitle="أولوية المتابعة"
          accent="bad"
          rows={bottomKt}
          onSelect={(rid) => onSelectRider('keeta', rid)}
        />
        <PlatformAnomaliesCard
          title="تراجع الأداء المفاجئ — كيتا"
          anomalies={ktAnomalies}
          onSelect={(rid) => onSelectRider('keeta', rid)}
        />
      </div>

      <DataTable
        rows={dash}
        columns={dashCols}
        rowKey={(r) => r.recordKey}
        searchPlaceholder="ابحث برقم المندوب أو الاسم أو الفرع أو المشرف..."
        searchText={(r) => `${r.riderId} ${r.fullName || ''} ${r.branch || ''} ${r.supervisor || ''}`}
        onRowClick={(r) => onSelectRider('keeta', r.riderId)}
      />

      {/* Isolated Snapshot Section: RankPlanProcess */}
      <Card className="space-y-4">
        <SectionHeader
          title="لقطات التصنيف والمكافآت المعزولة (Keeta RankPlanProcess Snapshots)"
          subtitle="تُعرض آخر لقطة لكل مندوب بصورة مستقلة تمامًا عن الجداول اليومية لتفادي أي تضخيم أو تكرار."
          actions={
            <div className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
              المندوبون: <span className="font-bold text-slate-900 dark:text-slate-100">{latestRankList.length}</span> · المكافآت:{' '}
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtCurrency(latestRankList.length ? latestSnapshotEstReward : null)}</span>
            </div>
          }
        />

        <DataTable
          rows={latestRankList}
          columns={rankCols}
          rowKey={(r) => r.recordKey}
          searchPlaceholder="ابحث في لقطات RankPlanProcess..."
          searchText={(r) => `${r.riderId} ${r.name || ''} ${r.currentEstimatedLevel || ''}`}
          onRowClick={(r) => onSelectRider('keeta', r.riderId)}
          emptyTitle="لا توجد لقطات RankPlanProcess مستوردة"
        />
      </Card>
    </div>
  );
}

function PlatformPeriodComparisonCard({
  title,
  periods,
  periodTab,
  onTabChange,
  activePeriod,
}: {
  title: string;
  periods: ReturnType<typeof computePeriodComparisons>;
  periodTab: 'daily' | 'weekly' | 'monthly';
  onTabChange: (tab: 'daily' | 'weekly' | 'monthly') => void;
  activePeriod: PeriodWindowSummary;
}) {
  void periods;
  return (
    <Card className="space-y-4">
      <SectionHeader
        title={title}
        subtitle="تظهر المقارنة فقط عند اكتمال نافذتي المقارنة لحماية قراءة المؤشرات."
        actions={
          <Tabs
            variant="segmented"
            activeKey={periodTab}
            onChange={onTabChange}
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
            <p className="mt-1">{activePeriod.incompleteReason}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <DeltaCell
            label="الطلبات المكتملة"
            current={fmtNum(activePeriod.current?.completedOrders)}
            previous={fmtNum(activePeriod.previous?.completedOrders)}
            delta={activePeriod.ordersDeltaPct !== null && activePeriod.ordersDeltaPct !== undefined ? `${activePeriod.ordersDeltaPct > 0 ? '+' : ''}${activePeriod.ordersDeltaPct}%` : '—'}
            positive={(activePeriod.ordersDeltaPct ?? 0) >= 0}
          />
          <DeltaCell
            label="المندوبون النشطون"
            current={fmtNum(activePeriod.current?.activeRiders)}
            previous={fmtNum(activePeriod.previous?.activeRiders)}
            delta={activePeriod.activeRidersDeltaPct !== null && activePeriod.activeRidersDeltaPct !== undefined ? `${activePeriod.activeRidersDeltaPct > 0 ? '+' : ''}${activePeriod.activeRidersDeltaPct}%` : '—'}
            positive={(activePeriod.activeRidersDeltaPct ?? 0) >= 0}
          />
          <DeltaCell
            label="ساعات العمل"
            current={fmtHours(activePeriod.current?.workingHours)}
            previous={fmtHours(activePeriod.previous?.workingHours)}
            delta={activePeriod.hoursDeltaPct !== null && activePeriod.hoursDeltaPct !== undefined ? `${activePeriod.hoursDeltaPct > 0 ? '+' : ''}${activePeriod.hoursDeltaPct}%` : '—'}
            positive={(activePeriod.hoursDeltaPct ?? 0) >= 0}
          />
          <DeltaCell
            label="معدل الإنجاز"
            current={fmtPct(activePeriod.current?.completionRate)}
            previous={fmtPct(activePeriod.previous?.completionRate)}
            delta={activePeriod.completionDeltaPts !== null && activePeriod.completionDeltaPts !== undefined ? `${activePeriod.completionDeltaPts > 0 ? '+' : ''}${activePeriod.completionDeltaPts} نقطة` : '—'}
            positive={(activePeriod.completionDeltaPts ?? 0) >= 0}
          />
          <DeltaCell
            label="معدل القبول"
            current={fmtPct(activePeriod.current?.acceptanceRate)}
            previous={fmtPct(activePeriod.previous?.acceptanceRate)}
            delta={activePeriod.acceptanceDeltaPts !== null && activePeriod.acceptanceDeltaPts !== undefined ? `${activePeriod.acceptanceDeltaPts > 0 ? '+' : ''}${activePeriod.acceptanceDeltaPts} نقطة` : '—'}
            positive={(activePeriod.acceptanceDeltaPts ?? 0) >= 0}
          />
        </div>
      )}
    </Card>
  );
}

function DeltaCell({
  label,
  current,
  previous,
  delta,
  positive,
}: {
  label: string;
  current: string;
  previous: string;
  delta: string;
  positive: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-1">
      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">{current}</span>
        <StatusBadge label={delta} tone={positive ? 'success' : 'danger'} className="font-mono-num" />
      </div>
      <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">السابق: {previous}</div>
    </div>
  );
}

function PlatformRiderRankCard({
  title,
  subtitle,
  accent,
  rows,
  onSelect,
}: {
  title: string;
  subtitle: string;
  accent: 'good' | 'bad';
  rows: ReturnType<typeof computeRiderPerformanceScore>[];
  onSelect: (riderId: string) => void;
}) {
  return (
    <Card className="space-y-3">
      <SectionHeader
        title={title}
        actions={<StatusBadge tone={accent === 'good' ? 'success' : 'danger'} label={subtitle} />}
      />
      {rows.length === 0 ? (
        <EmptyState title="لا توجد بيانات كافية للتصنيف" />
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {rows.map((r) => (
            <button
              key={r.riderId}
              type="button"
              onClick={() => onSelect(r.riderId)}
              className="flex w-full items-center justify-between py-2.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-2 transition-colors"
            >
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{r.riderName}</div>
                <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                  {r.riderId} · {fmtNum(r.totalOrders)} طلب
                </div>
              </div>
              <span
                className={`font-mono-num font-bold ${
                  accent === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                }`}
              >
                {r.totalScore}/100
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function PlatformAnomaliesCard({
  title,
  anomalies,
  onSelect,
}: {
  title: string;
  anomalies: ReturnType<typeof detectOperationalAnomalies>;
  onSelect: (riderId: string) => void;
}) {
  return (
    <Card className="space-y-3">
      <SectionHeader
        title={title}
        actions={<TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
      />
      {anomalies.length === 0 ? (
        <EmptyState title="لا توجد أنماط هبوط حاد مرصودة" />
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto erp-scroll">
          {anomalies.slice(0, 6).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.riderId)}
              className="w-full text-right rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-2.5 hover:border-blue-400/70 dark:hover:border-blue-600/70 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <StatusBadge label={a.title} tone={a.severity === 'critical' ? 'danger' : 'warning'} />
                <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{a.riderId}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{a.description}</p>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function avgNums(arr: Array<number | null | undefined>): number | null {
  const valid = arr.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
}
