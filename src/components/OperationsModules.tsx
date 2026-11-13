import {
  fmtCurrency,
  fmtHours,
  fmtKm,
  fmtNum,
  fmtPct,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../lib/fleetAnalytics';
import type { FilterState, Platform } from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';

interface OpsProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  filters: FilterState;
  onSelectRider: (platform: Platform, riderId: string) => void;
}

export function DailyOperationsView({ filteredRows, onSelectRider }: OpsProps) {
  const cols: TableColumn<UnifiedDailyRow>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'platform', header: 'المنصة', sortValue: (r) => r.platform, render: (r) => <span className="font-medium">{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> },
    { key: 'riderId', header: 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', render: (r) => <span>{r.riderName}</span> },
    { key: 'loc', header: 'المدينة / الفرع', render: (r) => <span>{[r.city, r.branch].filter(Boolean).join(' · ') || '-'}</span> },
    { key: 'orders', header: 'المكتملة', align: 'center', sortValue: (r) => r.completedOrders, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.completedOrders)}</span> },
    { key: 'hours', header: 'ساعات العمل', align: 'center', sortValue: (r) => r.workingHours, render: (r) => <span className="font-mono-num">{fmtHours(r.workingHours)}</span> },
    { key: 'acc', header: 'القبول %', align: 'center', sortValue: (r) => r.acceptanceRate, render: (r) => <span className="font-mono-num">{fmtPct(r.acceptanceRate)}</span> },
    { key: 'comp', header: 'الإنجاز %', align: 'center', sortValue: (r) => r.completionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.completionRate)}</span> },
    { key: 'km', header: 'المسافة (كم)', align: 'center', sortValue: (r) => r.totalKm, render: (r) => <span className="font-mono-num">{fmtKm(r.totalKm)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">العمليات اليومية الموحدة (Daily Operations)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">سجل يومي موحد قابل للفرز والبحث مع الحفاظ على دقة الفروقات بين الحقول غير المتاحة والقيم الصفرية.</p>
      </div>
      <DataTable
        rows={filteredRows}
        columns={cols}
        rowKey={(r, i) => `${r.platform}:${r.riderId}:${r.date}:${i}`}
        searchPlaceholder="ابحث برقم المندوب أو الاسم أو التاريخ..."
        searchText={(r) => `${r.riderId} ${r.riderName} ${r.date} ${r.city} ${r.branch}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />
    </div>
  );
}

export function RiderPerformanceView({ filteredRows, onSelectRider }: OpsProps) {
  const byRider = new Map<
    string,
    {
      platform: Platform;
      riderId: string;
      riderName: string;
      city: string;
      branch: string;
      days: number;
      orders: number;
      hours: number;
      km: number;
      accSum: number;
      accCnt: number;
      compSum: number;
      compCnt: number;
    }
  >();

  for (const r of filteredRows) {
    const k = `${r.platform}:${r.riderId}`;
    const cur = byRider.get(k) || {
      platform: r.platform,
      riderId: r.riderId,
      riderName: r.riderName,
      city: r.city,
      branch: r.branch,
      days: 0,
      orders: 0,
      hours: 0,
      km: 0,
      accSum: 0,
      accCnt: 0,
      compSum: 0,
      compCnt: 0,
    };
    cur.days += 1;
    cur.orders += r.completedOrders ?? 0;
    cur.hours += r.workingHours ?? 0;
    cur.km += r.totalKm ?? 0;
    if (r.acceptanceRate !== null) {
      cur.accSum += r.acceptanceRate;
      cur.accCnt++;
    }
    if (r.completionRate !== null) {
      cur.compSum += r.completionRate;
      cur.compCnt++;
    }
    byRider.set(k, cur);
  }

  const aggregated = Array.from(byRider.values()).map((x) => ({
    ...x,
    avgOrdersPerDay: Number((x.orders / x.days).toFixed(1)),
    avgAcc: x.accCnt > 0 ? Number((x.accSum / x.accCnt).toFixed(1)) : null,
    avgComp: x.compCnt > 0 ? Number((x.compSum / x.compCnt).toFixed(1)) : null,
  }));

  const cols: TableColumn<(typeof aggregated)[number]>[] = [
    { key: 'platform', header: 'المنصة', sortValue: (r) => r.platform, render: (r) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> },
    { key: 'riderId', header: 'المعرف', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', sortValue: (r) => r.riderName, render: (r) => <span>{r.riderName}</span> },
    { key: 'days', header: 'أيام النشاط', align: 'center', sortValue: (r) => r.days, render: (r) => <span className="font-mono-num">{r.days}</span> },
    { key: 'orders', header: 'إجمالي الطلبات', align: 'center', sortValue: (r) => r.orders, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.orders)}</span> },
    { key: 'avgDay', header: 'متوسط/يوم', align: 'center', sortValue: (r) => r.avgOrdersPerDay, render: (r) => <span className="font-mono-num">{r.avgOrdersPerDay}</span> },
    { key: 'hours', header: 'إجمالي الساعات', align: 'center', sortValue: (r) => r.hours, render: (r) => <span className="font-mono-num">{fmtHours(r.hours)}</span> },
    { key: 'acc', header: 'القبول %', align: 'center', sortValue: (r) => r.avgAcc, render: (r) => <span className="font-mono-num">{fmtPct(r.avgAcc)}</span> },
    { key: 'comp', header: 'الإنجاز %', align: 'center', sortValue: (r) => r.avgComp, render: (r) => <span className="font-mono-num">{fmtPct(r.avgComp)}</span> },
    { key: 'km', header: 'المسافة', align: 'center', sortValue: (r) => r.km, render: (r) => <span className="font-mono-num">{fmtKm(r.km)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">تقييم أداء المندوبين (Rider Performance)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">تجميع أداء كل مندوب عبر الفترة المحددة. اضغط على أي صف لفتح ملف Rider 360.</p>
      </div>
      <DataTable
        rows={aggregated}
        columns={cols}
        rowKey={(r) => `${r.platform}:${r.riderId}`}
        searchPlaceholder="ابحث بالمندوب أو المدينة..."
        searchText={(r) => `${r.riderId} ${r.riderName} ${r.city} ${r.branch}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />
    </div>
  );
}

export function AttendanceShiftsView({ dataset, filters, onSelectRider }: OpsProps) {
  const hsRows = dataset.hungerDaily.filter((r) => {
    if (filters.platform === 'keeta') return false;
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.city && r.city !== filters.city) return false;
    if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const ktVda = dataset.keetaVdaDaily.filter((r) => {
    if (filters.platform === 'hungerstation') return false;
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const combined = [
    ...hsRows.map((h) => ({
      id: h.recordKey,
      platform: 'hungerstation' as Platform,
      riderId: h.riderId,
      date: h.date,
      shifts: h.shifts,
      plannedHrs: h.plannedWorkingHours,
      actualHrs: h.actualWorkingHours,
      attendancePct: h.attendanceRate,
      noShows: h.noShows,
      extraInfo: `Break: ${fmtHours(h.breakHours)} · Lost: ${fmtHours(h.lostHours)}`,
    })),
    ...ktVda.map((v) => ({
      id: v.recordKey,
      platform: 'keeta' as Platform,
      riderId: v.riderId,
      date: v.date,
      shifts: v.sumValidShifts,
      plannedHrs: v.shouldOnlineDays !== null ? v.shouldOnlineDays * 8 : null,
      actualHrs: v.shiftOnlineHours,
      attendancePct: v.shouldOnlineDays && v.shouldOnlineDays > 0 && v.sumValidShifts !== null ? Math.min(100, Number(((v.sumValidShifts / v.shouldOnlineDays) * 100).toFixed(1))) : null,
      noShows: null,
      extraInfo: Object.keys(v.shiftWindows || {}).length > 0 ? `VDA Windows: ${Object.keys(v.shiftWindows || {}).length} حقول` : 'VDA',
    })),
  ];

  const cols: TableColumn<(typeof combined)[number]>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'platform', header: 'المنصة', sortValue: (r) => r.platform, render: (r) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta (VDA)'}</span> },
    { key: 'riderId', header: 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'shifts', header: 'الشفتات الصالحة', align: 'center', sortValue: (r) => r.shifts, render: (r) => <span className="font-mono-num">{fmtNum(r.shifts)}</span> },
    { key: 'actual', header: 'الساعات الفعلية', align: 'center', sortValue: (r) => r.actualHrs, render: (r) => <span className="font-mono-num">{fmtHours(r.actualHrs)}</span> },
    { key: 'att', header: 'معدل الالتزام %', align: 'center', sortValue: (r) => r.attendancePct, render: (r) => <span className="font-mono-num">{fmtPct(r.attendancePct)}</span> },
    { key: 'noShows', header: 'No Shows', align: 'center', sortValue: (r) => r.noShows, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.noShows)}</span> },
    { key: 'info', header: 'تفاصيل الشفتات', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.extraInfo}</span> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">الحضور والشفتات (Attendance &amp; Shifts)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">متابعة ساعات العمل المخططة والفعلية وحالات الغياب في HungerStation، وجدول شفتات S1-S6 في Keeta VDA.</p>
      </div>
      <DataTable
        rows={combined}
        columns={cols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث بمعرف المندوب أو التاريخ..."
        searchText={(r) => `${r.riderId} ${r.date} ${r.platform}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />
    </div>
  );
}

export function DeliveryQualityView({ dataset, filters, onSelectRider }: OpsProps) {
  const qual = dataset.hungerQualityMonthly.filter((q) => {
    if (filters.platform === 'keeta') return false;
    if (filters.month && q.month !== filters.month) return false;
    if (filters.city && q.city !== filters.city) return false;
    if (filters.riderId && !q.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const rank = dataset.keetaRankSnapshots.filter((rk) => {
    if (filters.platform === 'hungerstation') return false;
    if (filters.riderId && !rk.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const qualCols: TableColumn<(typeof qual)[number]>[] = [
    { key: 'month', header: 'الشهر', sortValue: (r) => r.month, render: (r) => <span className="font-mono-num">{r.month}</span> },
    { key: 'riderId', header: 'Rider ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'city', header: 'المدينة / المركبة', render: (r) => <span>{r.city || '-'} · {r.vehicleType || '-'}</span> },
    { key: 'ver', header: 'نجاح التحقق %', align: 'center', sortValue: (r) => r.verificationSuccessRate, render: (r) => <span className="font-mono-num">{fmtPct(r.verificationSuccessRate)}</span> },
    { key: 'orders', header: 'مكتملة / في الوقت', align: 'center', render: (r) => <span className="font-mono-num">{fmtNum(r.completedOrders)} / {fmtNum(r.completedOrdersInTime)}</span> },
    { key: 'failed', header: 'إخفاق المندوب', align: 'center', sortValue: (r) => r.failedOrdersByRider, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.failedOrdersByRider)}</span> },
    { key: 'score', header: 'Quality Score', align: 'center', sortValue: (r) => r.finalDeliveryQualityScore, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtNum(r.finalDeliveryQualityScore, 1)}</span> },
    { key: 'seg', header: 'Segment', sortValue: (r) => r.segment, render: (r) => <span className="font-semibold text-emerald-700 dark:text-emerald-400">{r.segment || '-'}</span> },
  ];

  const rankCols: TableColumn<(typeof rank)[number]>[] = [
    { key: 'snap', header: 'تاريخ اللقطة', render: (r) => <span className="font-mono-num">{r.snapshotDate}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', render: (r) => <span>{r.name || '-'}</span> },
    { key: 'lvl', header: 'المستوى المقدر', sortValue: (r) => r.currentEstimatedLevel, render: (r) => <span className="font-semibold text-slate-900 dark:text-slate-100">{r.currentEstimatedLevel || '-'}</span> },
    { key: 'pct', header: 'Percentile', align: 'center', sortValue: (r) => r.rankingPercentile, render: (r) => <span className="font-mono-num">{fmtNum(r.rankingPercentile, 1)}</span> },
    { key: 'ot', header: 'On-time %', align: 'center', sortValue: (r) => r.onTimeRate, render: (r) => <span className="font-mono-num">{fmtPct(r.onTimeRate)}</span> },
    { key: 'comp', header: 'Completion %', align: 'center', sortValue: (r) => r.orderCompletionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.orderCompletionRate)}</span> },
    { key: 'rew', header: 'المكافأة المقدرة', align: 'center', sortValue: (r) => r.estimatedRewardAmount, render: (r) => <span className="font-mono-num text-emerald-700 dark:text-emerald-400">{fmtCurrency(r.estimatedRewardAmount)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">جودة التسليم والتصنيف (Delivery Quality)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">نتائج Delivery Quality Segmentation (مع تصحيح إزاحة العمود E..P) وKeeta RankPlanProcess.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">HungerStation — Delivery Quality Segmentation</h3>
        <DataTable
          rows={qual}
          columns={qualCols}
          rowKey={(r) => r.recordKey}
          searchPlaceholder="ابحث بالمعرف أو الشريحة..."
          searchText={(r) => `${r.riderId} ${r.segment || ''} ${r.city || ''}`}
          onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Keeta — RankPlanProcess Snapshot</h3>
        <DataTable
          rows={rank}
          columns={rankCols}
          rowKey={(r) => r.recordKey}
          searchPlaceholder="ابحث بالمعرف أو الاسم أو المستوى..."
          searchText={(r) => `${r.riderId} ${r.name || ''} ${r.currentEstimatedLevel || ''}`}
          onRowClick={(r) => onSelectRider('keeta', r.riderId)}
        />
      </div>
    </div>
  );
}

export function DistanceWalletView({ dataset, filters, onSelectRider }: OpsProps) {
  const distRows = [
    ...dataset.hungerDistanceDaily
      .filter((d) => {
        if (filters.platform === 'keeta') return false;
        if (filters.date && d.date !== filters.date) return false;
        if (filters.month && d.month !== filters.month) return false;
        if (filters.riderId && !d.riderId.includes(filters.riderId.trim())) return false;
        return true;
      })
      .map((d) => ({
        id: d.recordKey,
        platform: 'hungerstation' as Platform,
        riderId: d.riderId,
        date: d.date,
        totalKm: d.totalKm,
        payableKm: d.payableKm,
        avgKm: d.avgKm,
        orders: d.completedDeliveries,
      })),
    ...dataset.keetaVdaDaily
      .filter((v) => {
        if (filters.platform === 'hungerstation') return false;
        if (filters.date && v.date !== filters.date) return false;
        if (filters.month && v.month !== filters.month) return false;
        if (filters.riderId && !v.riderId.includes(filters.riderId.trim())) return false;
        return true;
      })
      .map((v) => ({
        id: v.recordKey,
        platform: 'keeta' as Platform,
        riderId: v.riderId,
        date: v.date,
        totalKm: v.totalDeliveryDistance,
        payableKm: v.payableDistance,
        avgKm: v.totalDeliveredTasks && v.totalDeliveredTasks > 0 && v.totalDeliveryDistance !== null ? Number((v.totalDeliveryDistance / v.totalDeliveredTasks).toFixed(2)) : null,
        orders: v.totalDeliveredTasks,
      })),
  ];

  const wallets = dataset.hungerWalletSnapshots
    .filter((w) => !filters.riderId || w.riderId.includes(filters.riderId.trim()))
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

  const distCols: TableColumn<(typeof distRows)[number]>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'platform', header: 'المنصة', sortValue: (r) => r.platform, render: (r) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta (VDA)'}</span> },
    { key: 'riderId', header: 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'total', header: 'Total KM', align: 'center', sortValue: (r) => r.totalKm, render: (r) => <span className="font-mono-num">{fmtKm(r.totalKm)}</span> },
    { key: 'payable', header: 'Payable KM', align: 'center', sortValue: (r) => r.payableKm, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtKm(r.payableKm)}</span> },
    { key: 'avg', header: 'AVG KM / طلب', align: 'center', sortValue: (r) => r.avgKm, render: (r) => <span className="font-mono-num">{fmtNum(r.avgKm, 2)}</span> },
    { key: 'orders', header: 'الطلبات', align: 'center', sortValue: (r) => r.orders, render: (r) => <span className="font-mono-num">{fmtNum(r.orders)}</span> },
  ];

  const walletCols: TableColumn<(typeof wallets)[number]>[] = [
    { key: 'snap', header: 'تاريخ اللقطة', sortValue: (r) => r.snapshotDate, render: (r) => <span className="font-mono-num">{r.snapshotDate}</span> },
    { key: 'riderId', header: 'Rider ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    {
      key: 'bal',
      header: 'Current Wallet',
      align: 'center',
      sortValue: (r) => r.currentWallet,
      render: (r) => (
        <span className={`font-mono-num font-bold ${r.currentWallet < 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {fmtCurrency(r.currentWallet)}
        </span>
      ),
    },
    { key: 'src', header: 'ملف المصدر', render: (r) => <span className="text-xs text-slate-500 dark:text-slate-400">{r.sourceFile}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">المسافات والمحافظ المالية (Distance &amp; Wallet)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">تحليل المسافات الفعلية والمستحقة وسجل لقطات رصيد المحفظة التاريخي.</p>
      </div>

      <DataTable
        rows={distRows}
        columns={distCols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث بالمسافات أو معرف المندوب..."
        searchText={(r) => `${r.riderId} ${r.date} ${r.platform}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">سجل لقطات المحفظة (HungerStation Riders Wallet History)</h3>
        <DataTable
          rows={wallets}
          columns={walletCols}
          rowKey={(r) => r.recordKey}
          searchPlaceholder="ابحث بمعرف المندوب..."
          searchText={(r) => `${r.riderId} ${r.snapshotDate}`}
          onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
        />
      </div>
    </div>
  );
}

export function FacialRecognitionView({ dataset, filters, onSelectRider }: OpsProps) {
  const rows = dataset.keetaFacialRecognitionDaily.filter((f) => {
    if (filters.date && f.date !== filters.date) return false;
    if (filters.month && f.month !== filters.month) return false;
    if (filters.city && f.city !== filters.city) return false;
    if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const passed = rows.filter((r) => {
    const s = (r.finalInspectionResult || '').toLowerCase();
    return s.includes('pass') || s.includes('ok') || s.includes('ناجح');
  }).length;
  const failed = rows.filter((r) => {
    const s = (r.finalInspectionResult || '').toLowerCase();
    return s.includes('fail') || s.includes('reject') || s.includes('فشل');
  }).length;
  const over90 = rows.filter((r) => (r.passRateMtd ?? 0) >= 90).length;

  const cols: TableColumn<(typeof rows)[number]>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'city', header: 'المدينة / الشريك', render: (r) => <span>{r.city || '-'} · {r.partnerName || '-'}</span> },
    { key: 'pmm', header: 'PMM', render: (r) => <span>{r.pmm || '-'}</span> },
    {
      key: 'res',
      header: 'النتيجة النهائية',
      sortValue: (r) => r.finalInspectionResult,
      render: (r) => {
        const s = (r.finalInspectionResult || '').toLowerCase();
        const isFail = s.includes('fail') || s.includes('reject');
        return (
          <span className={`font-semibold ${isFail ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {r.finalInspectionResult || 'غير متاح'}
          </span>
        );
      },
    },
    { key: 'trig', header: 'أيام التفعيل / الاجتياز MTD', align: 'center', render: (r) => <span className="font-mono-num">{fmtNum(r.totalDaysTriggeredMtd)} / {fmtNum(r.totalDaysPassedMtd)}</span> },
    { key: 'rate', header: 'Pass Rate MTD', align: 'center', sortValue: (r) => r.passRateMtd, render: (r) => <span className="font-mono-num font-semibold">{fmtPct(r.passRateMtd)}</span> },
    { key: 'o90', header: 'Over 90%', align: 'center', render: (r) => <span>{r.over90PassRate || '-'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">التحقق من الهوية (Keeta Facial Recognition)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">مراقبة نتائج الفحص النهائي ونسبة الاجتياز MTD دون الاعتماد على حقل if_triggered_today الفارغ.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="إجمالي السجلات" value={fmtNum(rows.length)} />
        <KpiCard label="حالات ناجحة" value={fmtNum(passed)} tone="good" />
        <KpiCard label="حالات فاشلة / مرفوضة" value={fmtNum(failed)} tone={failed > 0 ? 'critical' : 'neutral'} />
        <KpiCard label="فوق 90% Pass Rate" value={fmtNum(over90)} />
      </div>
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.recordKey}
        searchPlaceholder="ابحث برقم المندوب أو المدينة أو الشريك..."
        searchText={(r) => `${r.riderId} ${r.city || ''} ${r.partnerName || ''} ${r.finalInspectionResult || ''}`}
        onRowClick={(r) => onSelectRider('keeta', r.riderId)}
      />
    </div>
  );
}
