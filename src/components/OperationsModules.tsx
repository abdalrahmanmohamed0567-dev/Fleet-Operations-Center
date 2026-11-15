import { useState } from 'react';
import {
  fmtCurrency,
  fmtHours,
  fmtKm,
  fmtNum,
  fmtPct,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../lib/fleetAnalytics';
import {
  computeKeetaDashboardAnalytics,
  computeKeetaFacialAnalytics,
  computeKeetaRankAnalytics,
  computeKeetaVdaAnalytics,
} from '../lib/keetaIntelligence';
import type { FilterState, Platform } from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';
import {
  Card,
  PageHeader,
  SectionHeader,
  Select,
  StatusBadge,
  Tabs,
  ToastBanner,
} from './ui/EnterpriseUI';

interface OpsProps {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  filters: FilterState;
  lockedPlatform?: Platform;
  onSelectRider: (platform: Platform, riderId: string) => void;
}

export function DailyOperationsView({ filteredRows, lockedPlatform, onSelectRider }: OpsProps) {
  const cols: TableColumn<UnifiedDailyRow>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    ...(!lockedPlatform
      ? [{ key: 'platform', header: 'المنصة', sortValue: (r: UnifiedDailyRow) => r.platform, render: (r: UnifiedDailyRow) => <span className="font-medium">{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> }]
      : []),
    { key: 'riderId', header: lockedPlatform === 'keeta' ? 'Courier ID' : 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', render: (r) => <span>{r.riderName}</span> },
    { key: 'loc', header: 'المدينة / الفرع', render: (r) => <span>{[r.city, r.branch].filter(Boolean).join(' · ') || '-'}</span> },
    { key: 'orders', header: 'المكتملة', align: 'center', sortValue: (r) => r.completedOrders, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.completedOrders)}</span> },
    { key: 'hours', header: 'ساعات العمل', align: 'center', sortValue: (r) => r.workingHours, render: (r) => <span className="font-mono-num">{fmtHours(r.workingHours)}</span> },
    { key: 'acc', header: 'القبول %', align: 'center', sortValue: (r) => r.acceptanceRate, render: (r) => <span className="font-mono-num">{fmtPct(r.acceptanceRate)}</span> },
    { key: 'comp', header: 'الإنجاز %', align: 'center', sortValue: (r) => r.completionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.completionRate)}</span> },
    { key: 'km', header: 'المسافة (كم)', align: 'center', sortValue: (r) => r.totalKm, render: (r) => <span className="font-mono-num">{fmtKm(r.totalKm)}</span> },
  ];

  const platformLabel = lockedPlatform === 'hungerstation' ? 'HungerStation' : lockedPlatform === 'keeta' ? 'Keeta' : 'الموحدة';

  return (
    <div className="space-y-5">
      <PageHeader
        title={`العمليات اليومية — ${platformLabel}`}
        subtitle="سجل يومي قابل للفرز والبحث مع الحفاظ على دقة الفروقات بين الحقول غير المتاحة والقيم الصفرية."
      />
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

export function RiderPerformanceView({ filteredRows, lockedPlatform, onSelectRider }: OpsProps) {
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

  type AggRow = (typeof aggregated)[number];

  const cols: TableColumn<AggRow>[] = [
    ...(!lockedPlatform
      ? [{ key: 'platform', header: 'المنصة', sortValue: (r: AggRow) => r.platform, render: (r: AggRow) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> }]
      : []),
    { key: 'riderId', header: lockedPlatform === 'keeta' ? 'Courier ID' : 'المعرف', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', sortValue: (r) => r.riderName, render: (r) => <span>{r.riderName}</span> },
    { key: 'days', header: 'أيام النشاط', align: 'center', sortValue: (r) => r.days, render: (r) => <span className="font-mono-num">{r.days}</span> },
    { key: 'orders', header: 'إجمالي الطلبات', align: 'center', sortValue: (r) => r.orders, render: (r) => <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.orders)}</span> },
    { key: 'avgDay', header: 'متوسط/يوم', align: 'center', sortValue: (r) => r.avgOrdersPerDay, render: (r) => <span className="font-mono-num">{r.avgOrdersPerDay}</span> },
    { key: 'hours', header: 'إجمالي الساعات', align: 'center', sortValue: (r) => r.hours, render: (r) => <span className="font-mono-num">{fmtHours(r.hours)}</span> },
    { key: 'acc', header: 'القبول %', align: 'center', sortValue: (r) => r.avgAcc, render: (r) => <span className="font-mono-num">{fmtPct(r.avgAcc)}</span> },
    { key: 'comp', header: 'الإنجاز %', align: 'center', sortValue: (r) => r.avgComp, render: (r) => <span className="font-mono-num">{fmtPct(r.avgComp)}</span> },
    { key: 'km', header: 'المسافة', align: 'center', sortValue: (r) => r.km, render: (r) => <span className="font-mono-num">{fmtKm(r.km)}</span> },
  ];

  const platformLabel = lockedPlatform === 'hungerstation' ? 'HungerStation' : lockedPlatform === 'keeta' ? 'Keeta' : '';

  return (
    <div className="space-y-5">
      <PageHeader
        title={`تقييم أداء المندوبين ${platformLabel ? `— ${platformLabel}` : '(Rider Performance)'}`}
        subtitle="تجميع أداء كل مندوب عبر الفترة المحددة. اضغط على أي صف لفتح ملف Rider 360."
      />
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

export function AttendanceShiftsView({ dataset, filters, lockedPlatform, onSelectRider }: OpsProps) {
  const effPlatform = lockedPlatform || filters.platform;

  const hsRows =
    effPlatform === 'keeta'
      ? []
      : dataset.hungerDaily.filter((r) => {
          if (filters.date && r.date !== filters.date) return false;
          if (filters.month && r.month !== filters.month) return false;
          if (filters.city && r.city !== filters.city) return false;
          if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
          return true;
        });

  const ktVda =
    effPlatform === 'hungerstation'
      ? []
      : dataset.keetaVdaDaily.filter((r) => {
          if (filters.date && r.date !== filters.date) return false;
          if (filters.month && r.month !== filters.month) return false;
          if (filters.vehicleType && r.vehicleType !== filters.vehicleType) return false;
          if (filters.riderId && !r.riderId.includes(filters.riderId.trim())) return false;
          return true;
        });

  const ktDash =
    effPlatform === 'hungerstation'
      ? []
      : dataset.keetaDashboardDaily.filter((r) => {
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

  const vdaStats = computeKeetaVdaAnalytics(ktVda);
  const dashSlotStats = computeKeetaDashboardAnalytics(ktDash).slotBreakdown;

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
    ...ktVda.map((v) => {
      const sSummary = v.shiftsS1ToS6?.length
        ? v.shiftsS1ToS6
            .filter((s) => (s.scheduledShifts ?? 0) > 0 || (s.validShifts ?? 0) > 0)
            .map((s) => `${s.slot}:${s.validShifts ?? 0}/${s.scheduledShifts ?? 0}`)
            .join(' · ')
        : Object.keys(v.shiftWindows || {}).length > 0
          ? `VDA Windows: ${Object.keys(v.shiftWindows || {}).length} حقول`
          : 'VDA';
      return {
        id: v.recordKey,
        platform: 'keeta' as Platform,
        riderId: v.riderId,
        date: v.date,
        shifts: v.sumValidShifts,
        plannedHrs: null as number | null,
        actualHrs: v.shiftOnlineHours,
        attendancePct:
          v.shouldOnlineDays && v.shouldOnlineDays > 0 && v.sumValidShifts !== null
            ? Math.min(100, Number(((v.sumValidShifts / v.shouldOnlineDays) * 100).toFixed(1)))
            : null,
        noShows: null as number | null,
        extraInfo: [
          v.threePlName ? `3PL: ${v.threePlName}` : '',
          v.vdaScore !== null && v.vdaScore !== undefined ? `VDA: ${v.vdaScore}` : '',
          v.ifNewRider ? `جديد: ${v.ifNewRider}` : '',
          sSummary,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }),
  ];

  type AttRow = (typeof combined)[number];

  const cols: TableColumn<AttRow>[] = [
    { key: 'date', header: 'التاريخ (Online Day)', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    ...(!lockedPlatform
      ? [{ key: 'platform', header: 'المنصة', sortValue: (r: AttRow) => r.platform, render: (r: AttRow) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta (VDA)'}</span> }]
      : []),
    { key: 'riderId', header: lockedPlatform === 'keeta' ? 'Courier ID' : 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'shifts', header: 'الشفتات الصالحة', align: 'center', sortValue: (r) => r.shifts, render: (r) => <span className="font-mono-num">{fmtNum(r.shifts)}</span> },
    {
      key: 'planned',
      header: 'الساعات المخططة',
      align: 'center',
      sortValue: (r) => r.plannedHrs,
      render: (r) => (
        <span className="font-mono-num text-slate-600 dark:text-slate-400">
          {r.plannedHrs !== null ? fmtHours(r.plannedHrs) : 'غير متاح في VDA'}
        </span>
      ),
    },
    { key: 'actual', header: 'الساعات الفعلية', align: 'center', sortValue: (r) => r.actualHrs, render: (r) => <span className="font-mono-num">{fmtHours(r.actualHrs)}</span> },
    { key: 'att', header: 'معدل الالتزام %', align: 'center', sortValue: (r) => r.attendancePct, render: (r) => <span className="font-mono-num">{fmtPct(r.attendancePct)}</span> },
    ...(lockedPlatform !== 'keeta'
      ? [{ key: 'noShows', header: 'No Shows', align: 'center' as const, sortValue: (r: AttRow) => r.noShows, render: (r: AttRow) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.noShows)}</span> }]
      : []),
    { key: 'info', header: 'تفاصيل الشفتات و3PL', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.extraInfo}</span> },
  ];

  const title =
    lockedPlatform === 'keeta'
      ? 'VDA والشفتات — Keeta'
      : lockedPlatform === 'hungerstation'
        ? 'الحضور والالتزام بالشفتات — HungerStation'
        : 'الحضور والشفتات (Attendance & Shifts)';

  const subtitle =
    lockedPlatform === 'keeta'
      ? 'تحليل شفتات VDA (S1–S6) وأيام الاتصال المطلوبة والشفتات من لوحة Keeta دون أي ساعات مخططة مفترضة.'
      : lockedPlatform === 'hungerstation'
        ? 'متابعة ساعات العمل المخططة والفعلية وساعات الاستراحة والفقد وحالات الغياب في HungerStation.'
        : 'متابعة ساعات العمل المخططة والفعلية في HungerStation، ومصفوفة شفتات S1–S6 في Keeta VDA.';

  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />

      {effPlatform !== 'hungerstation' && ktVda.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="شفتات VDA الصالحة" value={fmtNum(vdaStats.totalValidShifts, 1)} tone="good" />
            <KpiCard label="أيام الاتصال المطلوبة" value={fmtNum(vdaStats.totalShouldOnlineDays)} />
            <KpiCard label="معدل VDA Score" value={vdaStats.avgVdaScore !== null ? fmtNum(vdaStats.avgVdaScore, 1) : 'غير متاح'} />
            <KpiCard label="Advance Tasks" value={fmtNum(vdaStats.totalAdvanceTasks)} />
            <KpiCard label="Orders >55m (VDA)" value={fmtNum(vdaStats.totalOver55MinCount)} tone={vdaStats.totalOver55MinCount > 0 ? 'warn' : 'neutral'} />
            <KpiCard label="مندوبون جدد (VDA)" value={fmtNum(vdaStats.newRidersCount)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <SectionHeader title="مصفوفة نوافذ الشفتات (VDA S1 – S6)" />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold">الفترة</th>
                      <th className="px-3 py-2 text-center font-semibold">المجدولة</th>
                      <th className="px-3 py-2 text-center font-semibold">الصالحة</th>
                      <th className="px-3 py-2 text-center font-semibold">ساعات الشفت</th>
                      <th className="px-3 py-2 text-center font-semibold">نسبة التحقق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {vdaStats.s1ToS6Matrix.map((s) => (
                      <tr key={s.slot} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-mono-num font-bold text-slate-900 dark:text-slate-100">{s.slot}</td>
                        <td className="px-3 py-2 text-center font-mono-num">{fmtNum(s.scheduledShifts)}</td>
                        <td className="px-3 py-2 text-center font-mono-num text-emerald-700 dark:text-emerald-400">{fmtNum(s.validShifts)}</td>
                        <td className="px-3 py-2 text-center font-mono-num">{fmtHours(s.shiftHours)}</td>
                        <td className="px-3 py-2 text-center font-mono-num">{fmtPct(s.fulfillmentPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {vdaStats.threePlBreakdown.length > 0 && (
              <Card className="space-y-3">
                <SectionHeader title="توزيع الشركاء التشغيليين (3PL Name)" />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 text-right font-semibold">الشريك (3PL)</th>
                        <th className="px-3 py-2 text-center font-semibold">المندوبون</th>
                        <th className="px-3 py-2 text-center font-semibold">المهام المسلمة</th>
                        <th className="px-3 py-2 text-center font-semibold">المسافة المستحقة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {vdaStats.threePlBreakdown.map((tp) => (
                        <tr key={tp.threePlName} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{tp.threePlName}</td>
                          <td className="px-3 py-2 text-center font-mono-num">{fmtNum(tp.riders)}</td>
                          <td className="px-3 py-2 text-center font-mono-num">{fmtNum(tp.delivered)}</td>
                          <td className="px-3 py-2 text-center font-mono-num">{fmtKm(tp.payableKm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {effPlatform !== 'hungerstation' && dashSlotStats.length > 0 && (
        <Card className="space-y-3">
          <SectionHeader title="توزيع فترات الشفتات اليومية 6-Window (من ملخص Shift_Attendance Summary في Keeta Dashboard)" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashSlotStats.map((slot) => (
              <div key={slot.window} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                  <span className="font-mono-num">{slot.window}</span>
                  <span className="font-mono-num text-blue-700 dark:text-blue-400">{fmtHours(slot.totalHours)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono-num text-slate-600 dark:text-slate-400">
                  <span className="text-emerald-700 dark:text-emerald-400">مؤهل: {slot.qualifiedCount}</span>
                  <span className="text-amber-700 dark:text-amber-400">غير مؤهل: {slot.unqualifiedCount}</span>
                  <span>بدون شفت: {slot.noShiftCount}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <DataTable
        rows={combined}
        columns={cols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث بمعرف المندوب أو التاريخ..."
        searchText={(r) => `${r.riderId} ${r.date} ${r.platform} ${r.extraInfo}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />
    </div>
  );
}

export function DeliveryQualityView({ dataset, filters, lockedPlatform, onSelectRider }: OpsProps) {
  const effPlatform = lockedPlatform || filters.platform;
  const [rankDateMode, setRankDateMode] = useState<'latest' | 'all' | string>('latest');

  const qual =
    effPlatform === 'keeta'
      ? []
      : dataset.hungerQualityMonthly.filter((q) => {
          if (filters.month && q.month !== filters.month) return false;
          if (filters.city && q.city !== filters.city) return false;
          if (filters.riderId && !q.riderId.includes(filters.riderId.trim())) return false;
          return true;
        });

  const allRank =
    effPlatform === 'hungerstation'
      ? []
      : dataset.keetaRankSnapshots.filter((rk) => {
          if (
            filters.riderId &&
            !rk.riderId.includes(filters.riderId.trim()) &&
            !(rk.name || '').toLowerCase().includes(filters.riderId.trim().toLowerCase())
          ) {
            return false;
          }
          return true;
        });

  const rankAnalytics = computeKeetaRankAnalytics(allRank);
  const rankRows =
    rankDateMode === 'latest'
      ? rankAnalytics.latestRows
      : rankDateMode === 'all'
        ? allRank
        : allRank.filter((r) => r.snapshotDate === rankDateMode);

  const qualCols: TableColumn<(typeof qual)[number]>[] = [
    { key: 'month', header: 'الشهر', sortValue: (r) => r.month, render: (r) => <span className="font-mono-num">{r.month}</span> },
    { key: 'riderId', header: 'Rider ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'city', header: 'المدينة / المركبة', render: (r) => <span>{r.city || '-'} · {r.vehicleType || '-'}</span> },
    { key: 'ver', header: 'نجاح التحقق %', align: 'center', sortValue: (r) => r.verificationSuccessRate, render: (r) => <span className="font-mono-num">{fmtPct(r.verificationSuccessRate)}</span> },
    { key: 'orders', header: 'مكتملة / في الوقت', align: 'center', render: (r) => <span className="font-mono-num">{fmtNum(r.completedOrders)} / {fmtNum(r.completedOrdersInTime)}</span> },
    { key: 'failed', header: 'إخفاق المندوب', align: 'center', sortValue: (r) => r.failedOrdersByRider, render: (r) => <span className="font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.failedOrdersByRider)}</span> },
    { key: 'score', header: 'Quality Score', align: 'center', sortValue: (r) => r.finalDeliveryQualityScore, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{fmtNum(r.finalDeliveryQualityScore, 1)}</span> },
    {
      key: 'seg',
      header: 'Segment',
      sortValue: (r) => r.segment,
      render: (r) =>
        r.segment ? (
          <StatusBadge label={r.segment} tone="success" />
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
  ];

  const rankCols: TableColumn<(typeof allRank)[number]>[] = [
    { key: 'snap', header: 'تاريخ اللقطة', sortValue: (r) => r.snapshotDate, render: (r) => <span className="font-mono-num">{r.snapshotDate}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'name', header: 'الاسم', render: (r) => <span>{r.name || '-'}</span> },
    {
      key: 'lvl',
      header: 'المستوى المقدر',
      sortValue: (r) => r.currentEstimatedLevel,
      render: (r) =>
        r.currentEstimatedLevel ? (
          <StatusBadge label={r.currentEstimatedLevel} tone="info" />
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    { key: 'pct', header: 'Percentile', align: 'center', sortValue: (r) => r.rankingPercentile, render: (r) => <span className="font-mono-num">{fmtNum(r.rankingPercentile, 1)}</span> },
    { key: 'forced', header: 'Forced Score', align: 'center', sortValue: (r) => r.forcedAssignmentScore, render: (r) => <span className="font-mono-num">{fmtNum(r.forcedAssignmentScore, 1)}</span> },
    { key: 'ot', header: 'On-time %', align: 'center', sortValue: (r) => r.onTimeRate, render: (r) => <span className="font-mono-num">{fmtPct(r.onTimeRate)}</span> },
    { key: 'comp', header: 'Completion %', align: 'center', sortValue: (r) => r.orderCompletionRate, render: (r) => <span className="font-mono-num">{fmtPct(r.orderCompletionRate)}</span> },
    { key: 'early', header: 'Drop-off Early %', align: 'center', sortValue: (r) => r.didntTapDropOffTooEarly, render: (r) => <span className="font-mono-num">{fmtPct(r.didntTapDropOffTooEarly)}</span> },
    { key: 'rew', header: 'المكافأة المقدرة', align: 'center', sortValue: (r) => r.estimatedRewardAmount, render: (r) => <span className="font-mono-num text-emerald-700 dark:text-emerald-400">{fmtCurrency(r.estimatedRewardAmount)}</span> },
  ];

  const title =
    lockedPlatform === 'hungerstation'
      ? 'جودة التسليم الشهرية — HungerStation'
      : lockedPlatform === 'keeta'
        ? 'لقطات التصنيف والمكافآت — Keeta RankPlanProcess'
        : 'جودة التسليم والتصنيف (Delivery Quality)';

  const subtitle =
    lockedPlatform === 'hungerstation'
      ? 'نتائج Delivery Quality Segmentation الشهرية لـ HungerStation (مع تصحيح إزاحة العمود E..P).'
      : lockedPlatform === 'keeta'
        ? 'لقطات Keeta RankPlanProcess المعزولة عن الجداول اليومية مع تتبع التقدم بين اللقطات والمكافآت المقدرة.'
        : 'نتائج Delivery Quality Segmentation وKeeta RankPlanProcess.';

  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />

      {effPlatform !== 'keeta' && (
        <div className="space-y-3">
          <SectionHeader title="HungerStation — Delivery Quality Segmentation" />
          <DataTable
            rows={qual}
            columns={qualCols}
            rowKey={(r) => r.recordKey}
            searchPlaceholder="ابحث بالمعرف أو الشريحة..."
            searchText={(r) => `${r.riderId} ${r.segment || ''} ${r.city || ''}`}
            onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
          />
        </div>
      )}

      {effPlatform !== 'hungerstation' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label={`المندوبون (${rankAnalytics.latestSnapshotDate || '-'})`}
              value={fmtNum(rankAnalytics.uniqueRiders)}
              subtext={`إجمالي السجلات التاريخية: ${rankAnalytics.totalSnapshots}`}
            />
            <KpiCard
              label="إجمالي المكافآت المقدرة (آخر لقطة)"
              value={fmtCurrency(rankAnalytics.uniqueRiders ? rankAnalytics.totalEstimatedRewardLatest : null)}
              tone="good"
            />
            <KpiCard
              label="متوسط Percentile / Forced"
              value={`${rankAnalytics.avgRankingPercentileLatest ?? '-'} / ${rankAnalytics.avgForcedAssignmentScoreLatest ?? '-'}`}
            />
            <KpiCard
              label="التغير بين اللقطات"
              value={
                rankAnalytics.progression.hasHistory
                  ? `+${rankAnalytics.progression.upgradedCount} صعود / -${rankAnalytics.progression.downgradedCount} هبوط`
                  : 'لقطة واحدة فقط'
              }
              subtext={
                rankAnalytics.progression.hasHistory
                  ? `مقارنة ${rankAnalytics.progression.previousDate} ← ${rankAnalytics.latestSnapshotDate}`
                  : 'تظهر المقارنة عند استيراد تاريخ لقطة آخر'
              }
            />
          </div>

          <SectionHeader
            title="Keeta — RankPlanProcess Snapshots"
            actions={
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">عرض اللقطات:</span>
                <div className="w-60">
                  <Select
                    value={rankDateMode}
                    onChange={(e) => setRankDateMode(e.target.value)}
                    className="font-mono-num"
                  >
                    <option value="latest">آخر لقطة لكل مندوب (منع التكرار)</option>
                    {rankAnalytics.snapshotDates.map((d) => (
                      <option key={d} value={d}>لقطة تاريخ {d}</option>
                    ))}
                    <option value="all">كل اللقطات التاريخية ({allRank.length})</option>
                  </Select>
                </div>
              </div>
            }
          />

          <DataTable
            rows={rankRows}
            columns={rankCols}
            rowKey={(r) => r.recordKey}
            searchPlaceholder="ابحث بالمعرف أو الاسم أو المستوى..."
            searchText={(r) => `${r.riderId} ${r.name || ''} ${r.currentEstimatedLevel || ''}`}
            onRowClick={(r) => onSelectRider('keeta', r.riderId)}
          />
        </div>
      )}
    </div>
  );
}

export function DistanceWalletView({ dataset, filters, lockedPlatform, onSelectRider }: OpsProps) {
  const effPlatform = lockedPlatform || filters.platform;

  const distRows = [
    ...(effPlatform === 'keeta'
      ? []
      : dataset.hungerDistanceDaily
          .filter((d) => {
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
          }))),
    ...(effPlatform === 'hungerstation'
      ? []
      : dataset.keetaVdaDaily
          .filter((v) => {
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
          }))),
  ];

  const wallets =
    effPlatform === 'keeta'
      ? []
      : dataset.hungerWalletSnapshots
          .filter((w) => !filters.riderId || w.riderId.includes(filters.riderId.trim()))
          .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

  type DistRow = (typeof distRows)[number];

  const distCols: TableColumn<DistRow>[] = [
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    ...(!lockedPlatform
      ? [{ key: 'platform', header: 'المنصة', sortValue: (r: DistRow) => r.platform, render: (r: DistRow) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta (VDA)'}</span> }]
      : []),
    { key: 'riderId', header: lockedPlatform === 'keeta' ? 'Courier ID' : 'معرف المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
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
      <PageHeader
        title={
          lockedPlatform === 'keeta'
            ? 'مسافات التوصيل — Keeta VDA'
            : lockedPlatform === 'hungerstation'
              ? 'المسافات والمحافظ المالية — HungerStation'
              : 'المسافات والمحافظ المالية (Distance & Wallet)'
        }
        subtitle={
          lockedPlatform === 'keeta'
            ? 'تحليل المسافات الفعلية والمستحقة من تقارير Keeta VDA يوميًا.'
            : 'تحليل المسافات الفعلية والمستحقة وسجل لقطات رصيد المحفظة التاريخي.'
        }
      />

      <DataTable
        rows={distRows}
        columns={distCols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث بالمسافات أو معرف المندوب..."
        searchText={(r) => `${r.riderId} ${r.date} ${r.platform}`}
        onRowClick={(r) => onSelectRider(r.platform, r.riderId)}
      />

      {effPlatform !== 'keeta' && (
        <div className="space-y-3">
          <SectionHeader title="سجل لقطات المحفظة (HungerStation Riders Wallet History)" />
          <DataTable
            rows={wallets}
            columns={walletCols}
            rowKey={(r) => r.recordKey}
            searchPlaceholder="ابحث بمعرف المندوب..."
            searchText={(r) => `${r.riderId} ${r.snapshotDate}`}
            onRowClick={(r) => onSelectRider('hungerstation', r.riderId)}
          />
        </div>
      )}
    </div>
  );
}

export function FacialRecognitionView({ dataset, filters, onSelectRider }: OpsProps) {
  const [viewMode, setViewMode] = useState<'latest_mtd' | 'daily_log'>('latest_mtd');

  const rows = dataset.keetaFacialRecognitionDaily.filter((f) => {
    if (filters.date && f.date !== filters.date) return false;
    if (filters.month && f.month !== filters.month) return false;
    if (filters.city && f.city !== filters.city) return false;
    if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) return false;
    return true;
  });

  const stats = computeKeetaFacialAnalytics(rows);
  const displayedRows = viewMode === 'latest_mtd' ? stats.latestMtdRows : rows;

  const cols: TableColumn<(typeof rows)[number]>[] = [
    { key: 'date', header: 'التاريخ (dt)', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'riderId', header: 'Courier ID', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'city', header: 'المدينة / الشريك', render: (r) => <span>{r.city || '-'} · {r.partnerName || '-'}</span> },
    { key: 'pmm', header: 'PMM', render: (r) => <span>{r.pmm || '-'}</span> },
    {
      key: 'res',
      header: 'النتيجة النهائية',
      sortValue: (r) => r.finalInspectionResult,
      render: (r) => {
        const s = (r.finalInspectionResult || '').toLowerCase();
        const isFail = s.includes('fail') || s.includes('reject') || s.includes('فشل');
        return (
          <StatusBadge
            label={r.finalInspectionResult || 'غير متاح'}
            tone={r.finalInspectionResult ? (isFail ? 'danger' : 'success') : 'neutral'}
          />
        );
      },
    },
    {
      key: 'trigToday',
      header: 'if_triggered_today',
      align: 'center',
      render: (r) => {
        if (r.ifTriggeredToday === null || r.ifTriggeredToday === undefined || r.ifTriggeredToday === '') {
          return <span className="text-xs text-slate-400">غير متاح (فارغ)</span>;
        }
        return (
          <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
            {r.ifTriggeredTodayRaw || (r.ifTriggeredToday === true ? 'نعم' : String(r.ifTriggeredToday))}
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
      <PageHeader
        title="التحقق من الهوية (Keeta Facial Recognition)"
        subtitle="عزل إحصائيات MTD التراكمية (آخر سجل لكل مندوب شهريًا) عن السجل اليومي لتفادي تضخيم الأرقام."
        actions={
          <Tabs
            variant="segmented"
            activeKey={viewMode}
            onChange={setViewMode}
            items={[
              { key: 'latest_mtd', label: 'ملخص MTD (آخر يوم)', count: stats.uniqueRiders },
              { key: 'daily_log', label: 'السجل اليومي الكامل', count: stats.dailyTotalRows },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="متوسط Pass Rate MTD (آخر سجل)"
          value={fmtPct(stats.mtdAvgPassRate)}
          subtext={`مندوبون: ${stats.uniqueRiders} (سجل: ${stats.latestMtdDate || '-'})`}
          tone="good"
        />
        <KpiCard
          label="مندوبون تحت 90% MTD"
          value={fmtNum(stats.mtdBelow90RidersCount)}
          tone={stats.mtdBelow90RidersCount > 0 ? 'warn' : 'good'}
        />
        <KpiCard
          label="إخفاقات الفحص (السجل اليومي)"
          value={fmtNum(stats.dailyFailCount)}
          subtext={`ناجح يومي: ${fmtNum(stats.dailyPassCount)}`}
          tone={stats.dailyFailCount > 0 ? 'critical' : 'good'}
        />
        <KpiCard
          label="اكتمال حقل if_triggered_today"
          value={stats.triggeredFillRatePct !== null ? `${stats.triggeredFillRatePct}%` : 'غير متاح'}
          subtext={`ممتلئ: ${stats.triggeredTodayPopulatedCount} | فارغ: ${stats.triggeredTodayNullCount}`}
          tone={stats.triggeredTodayNullCount > 0 && stats.triggeredTodayPopulatedCount === 0 ? 'warn' : 'neutral'}
        />
      </div>

      {rows.length > 0 && stats.triggeredTodayPopulatedCount === 0 && (
        <ToastBanner
          type="warn"
          message={`ملاحظة جودة البيانات: عمود if_triggered_today ورد فارغًا بالكامل في السجلات المستوردة (${stats.triggeredTodayNullCount} صف)، ولذلك يعتمد النظام على النتيجة النهائية ومعدل Pass rate MTD الموثقين.`}
        />
      )}

      <DataTable
        rows={displayedRows}
        columns={cols}
        rowKey={(r) => r.recordKey}
        searchPlaceholder="ابحث برقم المندوب أو المدينة أو الشريك..."
        searchText={(r) => `${r.riderId} ${r.city || ''} ${r.partnerName || ''} ${r.finalInspectionResult || ''}`}
        onRowClick={(r) => onSelectRider('keeta', r.riderId)}
      />
    </div>
  );
}
