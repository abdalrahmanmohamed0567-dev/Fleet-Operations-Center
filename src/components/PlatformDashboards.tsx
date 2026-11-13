import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtCurrency, fmtKm, fmtNum, fmtPct, type FleetDataset } from '../lib/fleetAnalytics';
import type { FilterState, HungerDailyRecord, KeetaDashboardDaily, KeetaRankSnapshot } from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';

interface PlatformViewProps {
  dataset: FleetDataset;
  filters: FilterState;
  onSelectRider: (platform: 'hungerstation' | 'keeta', riderId: string) => void;
}

export function HungerStationView({ dataset, filters, onSelectRider }: PlatformViewProps) {
  const daily = dataset.hungerDaily.filter((r) => {
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.city && r.city !== filters.city) return false;
    if (filters.contract && r.contractName !== filters.contract) return false;
    if (filters.vehicleType && r.vehicleName !== filters.vehicleType) return false;
    if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const dist = dataset.hungerDistanceDaily.filter((d) => {
    if (filters.date && d.date !== filters.date) return false;
    if (filters.month && d.month !== filters.month) return false;
    if (filters.city && d.city !== filters.city) return false;
    if (filters.contract && d.contractName !== filters.contract) return false;
    if (filters.riderId && !d.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const quality = dataset.hungerQualityMonthly.filter((q) => {
    if (filters.month && q.month !== filters.month) return false;
    if (filters.city && q.city !== filters.city) return false;
    if (filters.contract && q.contractName !== filters.contract) return false;
    if (filters.vehicleType && q.vehicleType !== filters.vehicleType) return false;
    if (filters.riderId && !q.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const wallets = dataset.hungerWalletSnapshots.filter((w) => {
    if (filters.riderId && !w.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

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

  const avgAtt = avgNums(daily.map((r) => r.attendanceRate));
  const avgAcc = avgNums(daily.map((r) => r.acceptanceRate));
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
    { key: 'riderId', header: 'ID المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="font-bold text-slate-900 dark:text-slate-100">فصل الجداول في HungerStation:</span> البيانات اليومية تُقرأ من{' '}
        <span className="font-mono-num font-semibold">Hunger-Daily</span> و<span className="font-mono-num font-semibold">Riders Distance</span>، بينما{' '}
        <span className="font-mono-num font-semibold">Delivery Quality Segmentation</span> و<span className="font-mono-num font-semibold">Riders Wallet</span> تُعالج كلقطات منفصلة شهريًا أو بتاريخ اللقطة دون خلطها باليومي.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
        <KpiCard label="متوسط Delivery Quality Score" value={fmtNum(avgQual, 1)} tone="good" />
      </div>

      {segData.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">توزيع شرائح جودة التسليم (Delivery Quality Segments)</h3>
          <div className="h-56 w-full" dir="ltr">
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
        </div>
      )}

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

export function KeetaView({ dataset, filters, onSelectRider }: PlatformViewProps) {
  const dash = dataset.keetaDashboardDaily.filter((r) => {
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
  });

  const vda = dataset.keetaVdaDaily.filter((v) => {
    if (filters.date && v.date !== filters.date) return false;
    if (filters.month && v.month !== filters.month) return false;
    if (filters.vehicleType && v.vehicleType !== filters.vehicleType) return false;
    if (filters.riderId && !v.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const facial = dataset.keetaFacialRecognitionDaily.filter((f) => {
    if (filters.date && f.date !== filters.date) return false;
    if (filters.month && f.month !== filters.month) return false;
    if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  // RankPlanProcess is a cumulative Snapshot table — filtered strictly by riderId (never summed into daily metrics)
  const rank = dataset.keetaRankSnapshots.filter((rk) => {
    if (filters.riderId && !rk.riderId.includes(filters.riderId.trim()) && !(rk.name || '').toLowerCase().includes(filters.riderId.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const onlineHrs = dash.reduce((s, r) => s + (r.shiftOnlineHours ?? 0), 0);
  const validOnlineHrs = dash.reduce((s, r) => s + (r.shiftValidOnlineTime ?? 0), 0);
  const acceptedTasks = dash.reduce((s, r) => s + (r.acceptedTasks ?? 0), 0);
  const deliveredTasks = dash.reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);
  const rejectedTasks = dash.reduce((s, r) => s + (r.rejectedTasks ?? 0), 0);
  const over55 = dash.reduce((s, r) => s + (r.deliveredOver55Min ?? 0), 0);
  const overdue = dash.reduce((s, r) => s + (r.overdueOrderTasks ?? 0), 0);

  const avgCancel = avgNums(dash.map((r) => r.cancellationRate));
  const avgComp = avgNums(dash.map((r) => r.completionRate));
  const avgOnTime = avgNums(dash.map((r) => r.onTimeRate));
  const avgDeliveryMin = avgNums(dash.map((r) => r.avgDeliveryTimeMinutes));
  const validShifts = vda.reduce((s, v) => s + (v.sumValidShifts ?? 0), 0);
  const shouldOnlineDays = vda.reduce((s, v) => s + (v.shouldOnlineDays ?? 0), 0);
  const vdaPayableKm = vda.reduce((s, v) => s + (v.payableDistance ?? 0), 0);
  const avgFacialPass = avgNums(facial.map((f) => f.passRateMtd));

  // Snapshot-only latest per rider for RankPlanProcess
  const latestRankByRider = new Map<string, KeetaRankSnapshot>();
  [...rank]
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .forEach((rk) => latestRankByRider.set(rk.riderId, rk));
  const latestRankList = Array.from(latestRankByRider.values());
  const latestSnapshotEstReward = latestRankList.reduce((s, rk) => s + (rk.estimatedRewardAmount ?? 0), 0);

  const rankLevels = new Map<string, number>();
  for (const rk of latestRankList) {
    const lvl = rk.currentEstimatedLevel || 'غير مصنف';
    rankLevels.set(lvl, (rankLevels.get(lvl) || 0) + 1);
  }
  const rankChart = Array.from(rankLevels.entries()).map(([level, count]) => ({ level, count }));

  const dashCols: TableColumn<KeetaDashboardDaily>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', sortValue: (r) => r.fullName, render: (r) => <span>{r.fullName || '-'}</span> },
    { key: 'branch', header: 'الفرع / المشرف', render: (r) => <span>{r.branch || '-'} · {r.supervisor || '-'}</span> },
    { key: 'hours', header: 'Online / Valid (س)', align: 'center', sortValue: (r) => r.shiftOnlineHours, render: (r) => <span className="font-mono-num">{fmtNum(r.shiftOnlineHours, 1)} / {fmtNum(r.shiftValidOnlineTime, 1)}</span> },
    { key: 'del', header: 'Delivered', align: 'center', sortValue: (r) => r.deliveredTasks, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.deliveredTasks)}</span> },
    { key: 'acc', header: 'Accepted / Rejected', align: 'center', render: (r) => <span className="font-mono-num">{fmtNum(r.acceptedTasks)} / {fmtNum(r.rejectedTasks)}</span> },
    { key: 'comp', header: 'Completion %', align: 'center', sortValue: (r) => r.completionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.completionRate)}</span> },
    { key: 'ontime', header: 'On-time %', align: 'center', sortValue: (r) => r.onTimeRate, render: (r) => <span className="font-mono-num">{fmtPct(r.onTimeRate)}</span> },
    { key: 'avgMin', header: 'Avg Time (د)', align: 'center', sortValue: (r) => r.avgDeliveryTimeMinutes, render: (r) => <span className="font-mono-num">{fmtNum(r.avgDeliveryTimeMinutes, 1)}</span> },
    { key: 'overdue', header: '>55m / Overdue', align: 'center', sortValue: (r) => r.overdueOrderTasks, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.deliveredOver55Min)} / {fmtNum(r.overdueOrderTasks)}</span> },
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="font-bold text-slate-900 dark:text-slate-100">عزل جداول Keeta حسب النوع:</span> مؤشرات الأداء اليومية أعلاه مستخرجة حصريًا من{' '}
        <span className="font-mono-num font-semibold">Dashboard</span> و<span className="font-mono-num font-semibold">VDA (Online Day)</span> و<span className="font-mono-num font-semibold">FacialRecognitionDataReport</span>، بينما شيت{' '}
        <span className="font-mono-num font-semibold">RankPlanProcess</span> يُعالج كلقطة تصنيف مستقلة أدناه ولا يُجمع مع الجداول اليومية.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Online / Valid Hours" value={`${fmtNum(onlineHrs, 1)} / ${fmtNum(validOnlineHrs, 1)}`} />
        <KpiCard label="Valid Shifts (VDA)" value={fmtNum(validShifts)} subtext={`أيام مطلوبة: ${fmtNum(shouldOnlineDays)}`} />
        <KpiCard label="Delivered Tasks" value={fmtNum(deliveredTasks)} tone="good" />
        <KpiCard label="Accepted / Rejected" value={`${fmtNum(acceptedTasks)} / ${fmtNum(rejectedTasks)}`} />
        <KpiCard label="Cancellation Rate" value={fmtPct(avgCancel)} tone="warn" />
        <KpiCard label="Completion Rate" value={fmtPct(avgComp)} tone="good" />
        <KpiCard label="On-time Rate" value={fmtPct(avgOnTime)} />
        <KpiCard label="Average Delivery Time" value={avgDeliveryMin !== null ? `${avgDeliveryMin.toFixed(1)} دقيقة` : 'غير متاح'} />
        <KpiCard label="Orders > 55m" value={fmtNum(over55)} tone={over55 > 0 ? 'warn' : 'neutral'} />
        <KpiCard label="Overdue Orders" value={fmtNum(overdue)} tone={overdue > 0 ? 'critical' : 'neutral'} />
        <KpiCard label="Payable Distance (VDA)" value={fmtKm(vdaPayableKm)} />
        <KpiCard label="Facial Pass Rate MTD" value={fmtPct(avgFacialPass)} />
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              لقطات التصنيف والمكافآت المعزولة (Keeta RankPlanProcess Snapshots)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              تُعرض آخر لقطة لكل مندوب بصورة مستقلة تمامًا عن الجداول اليومية لتفادي أي تضخيم أو تكرار.
            </p>
          </div>
          <div className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
            عدد المندوبين: <span className="font-bold text-slate-900 dark:text-slate-100">{latestRankList.length}</span> · إجمالي المكافآت المقدرة (آخر لقطة):{' '}
            <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtCurrency(latestRankList.length ? latestSnapshotEstReward : null)}</span>
          </div>
        </div>

        {rankChart.length > 0 && (
          <div className="h-52 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="level" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="عدد المندوبين" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <DataTable
          rows={latestRankList}
          columns={rankCols}
          rowKey={(r) => r.recordKey}
          searchPlaceholder="ابحث في لقطات RankPlanProcess..."
          searchText={(r) => `${r.riderId} ${r.name || ''} ${r.currentEstimatedLevel || ''}`}
          onRowClick={(r) => onSelectRider('keeta', r.riderId)}
          emptyTitle="لا توجد لقطات RankPlanProcess مستوردة"
        />
      </div>
    </div>
  );
}

function avgNums(arr: Array<number | null | undefined>): number | null {
  const valid = arr.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
}
