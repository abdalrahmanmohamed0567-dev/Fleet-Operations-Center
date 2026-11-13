import { CloudUpload, Download, FileText, Printer, RotateCcw, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { exportExcelInBrowser } from '../lib/clientExcelFallback';
import { computeErrorCodeIntelligence, generateErrorIntelligenceAlerts } from '../lib/errorIntelligence';
import { auth, getDriveAccessToken, refreshDriveTokenWithPopup } from '../lib/firebase';
import {
  buildUnifiedDailyRows,
  fmtNum,
  fmtPct,
  generateOperationalAlerts,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../lib/fleetAnalytics';
import { exportArabicTableToPdf } from '../lib/pdfExport';
import { ApiHtmlFallbackError, safeParseJsonResponse } from '../lib/safeFetch';
import {
  computeBranchScorecards,
  computeRiderPerformanceScore,
  detectOperationalAnomalies,
} from '../lib/smartAnalytics';
import type { ExportColumn } from '../shared/exportCore';
import type {
  AlertItem,
  ErrorCodeDictionaryEntry,
  FilterState,
  OperationalCase,
  OperationalSettings,
  Platform,
  RiderErrorCase,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';

interface AlertsViewProps {
  dataset: FleetDataset;
  dictionaryEntries?: ErrorCodeDictionaryEntry[];
  riderErrorCases?: RiderErrorCase[];
  settings: OperationalSettings;
  filters: FilterState;
  onSelectRider: (platform: Platform, riderId: string) => void;
  onGoToSettings: () => void;
}

export function AlertsCenterView({
  dataset,
  dictionaryEntries = [],
  riderErrorCases = [],
  settings,
  filters,
  onSelectRider,
  onGoToSettings,
}: AlertsViewProps) {
  const [sevFilter, setSevFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [catFilter, setCatFilter] = useState<string>('');

  const alerts = useMemo(() => {
    const opsAlerts = generateOperationalAlerts(dataset, settings, filters);
    if (filters.platform === 'keeta') return opsAlerts;
    const errorReport = computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, filters);
    const errorAlerts = generateErrorIntelligenceAlerts(errorReport, settings);
    return [...errorAlerts, ...opsAlerts].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }, [dataset, dictionaryEntries, riderErrorCases, settings, filters]);

  const categories = useMemo(() => Array.from(new Set(alerts.map((a) => a.category))).sort(), [alerts]);
  const visible = alerts.filter((a) => {
    if (sevFilter !== 'all' && a.severity !== sevFilter) return false;
    if (catFilter && a.category !== catFilter) return false;
    return true;
  });

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  const cols: TableColumn<AlertItem>[] = [
    {
      key: 'sev',
      header: 'الخطورة',
      sortValue: (r) => r.severity,
      render: (r) => (
        <span className={`font-semibold ${r.severity === 'critical' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
          {r.severity === 'critical' ? 'حرج' : 'تحذير'}
        </span>
      ),
    },
    { key: 'cat', header: 'التصنيف', sortValue: (r) => r.category, render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.category}</span> },
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    { key: 'platform', header: 'المنصة', sortValue: (r) => r.platform, render: (r) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> },
    { key: 'riderId', header: 'المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'title', header: 'المشكلة المكتشفة', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-200">{r.title}</span> },
    { key: 'desc', header: 'التفاصيل والمؤشر', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.description}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">مركز التنبيهات التشغيلية (Alerts Center)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            يتم توليد التنبيهات ديناميكيًا وفق حدود الأهداف المضبوطة في إعدادات النظام (دون أي حدود ثابتة في الكود).
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSettings}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>تعديل حدود التنبيهات</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="إجمالي التنبيهات" value={fmtNum(alerts.length)} />
        <KpiCard label="تنبيهات حرجة" value={fmtNum(criticalCount)} tone={criticalCount > 0 ? 'critical' : 'good'} />
        <KpiCard label="تحذيرات أداء" value={fmtNum(warningCount)} tone={warningCount > 0 ? 'warn' : 'good'} />
        <KpiCard label="هدف الطلبات / الساعات" value={`${settings.minDailyOrders} / ${settings.minDailyWorkingHours} س`} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {(['all', 'critical', 'warning'] as const).map((sv) => (
            <button
              key={sv}
              type="button"
              onClick={() => setSevFilter(sv)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                sevFilter === sv
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {sv === 'all' ? 'الكل' : sv === 'critical' ? 'حرج فقط' : 'تحذيرات فقط'}
            </button>
          ))}
        </div>

        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
        >
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <DataTable
        rows={visible}
        columns={cols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث برقم المندوب أو وصف التنبيه..."
        searchText={(r) => `${r.riderId} ${r.title} ${r.description} ${r.category}`}
        emptyTitle="لا توجد تنبيهات تشغيلية مطابقة"
        emptySubtitle="جميع السجلات ضمن الحدود التشغيلية المحددة أو لم يتم استيراد بيانات بعد."
        onRowClick={(r) => {
          if (r.riderId && r.riderId !== '-') {
            onSelectRider(r.platform, r.riderId);
          }
        }}
      />
    </div>
  );
}

export type ReportKind =
  | 'executive_report'
  | 'daily_operations'
  | 'monthly_performance'
  | 'rider_ranking'
  | 'branch_performance'
  | 'supervisor_performance'
  | 'error_code_analysis'
  | 'attendance_report'
  | 'delivery_quality'
  | 'platform_comparison';

const REPORT_DEFS: Array<{ key: ReportKind; label: string; note: string }> = [
  {
    key: 'executive_report',
    label: '1. ملخص الإدارة العليا الرسمي',
    note: 'التقرير التنفيذي الرسمي القابل للطباعة والتصدير متضمنًا الأداء الموحد والفروع والانحرافات والحالات.',
  },
  {
    key: 'daily_operations',
    label: '2. العمليات اليومية',
    note: 'تقرير مقارن يومي للطلبات المكتملة وساعات العمل/الاتصال والمسافات عبر المنصتين.',
  },
  {
    key: 'monthly_performance',
    label: '3. الأداء الشهري',
    note: 'تجميع الأداء الشهري لإجمالي الطلبات والساعات والمندوبين النشطين ومؤشرات الجودة.',
  },
  {
    key: 'rider_ranking',
    label: '4. ترتيب المندوبين',
    note: 'ترتيب المندوبين وفق معادلة التقييم الموزون (Performance Score 0-100) وإجمالي الطلبات.',
  },
  {
    key: 'branch_performance',
    label: '5. أداء الفروع والمدن',
    note: 'مقارنة الفروع والمدن في عدد المندوبين والطلبات والساعات ومعدل الإنتاجية اليومي.',
  },
  {
    key: 'supervisor_performance',
    label: '6. أداء المشرفين',
    note: 'أداء فرق المشرفين حسب بيانات Keeta Dashboard وتوزيع المناديب التابعين.',
  },
  {
    key: 'error_code_analysis',
    label: '7. تحليل أكواد الأخطاء',
    note: 'تقرير أكواد أخطاء HungerStation وتكرارها وشدتها وعدد المندوبين المتأثرين.',
  },
  {
    key: 'attendance_report',
    label: '8. الحضور والشفتات',
    note: 'تقرير الالتزام والحضور اليومي (HS Attendance Rate مقابل Keeta On-Shift % وساعات العمل).',
  },
  {
    key: 'delivery_quality',
    label: '9. جودة التسليم والتصنيف',
    note: 'جودة التسليم (HS Quality Score/Segment الشهري مقابل Keeta On-Time % وOverdue).',
  },
  {
    key: 'platform_comparison',
    label: '10. مقارنة المنصتين',
    note: 'مقارنة شاملة بين HungerStation وKeeta مع توضيح تطابق أو اختلاف التعريفات الإحصائية.',
  },
];

export function ReportsExportsView({
  dataset,
  dictionaryEntries = [],
  riderErrorCases = [],
  operationalCases = [],
  settings,
}: {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries?: ErrorCodeDictionaryEntry[];
  riderErrorCases?: RiderErrorCase[];
  operationalCases?: OperationalCase[];
  settings: OperationalSettings;
}) {
  const [reportKind, setReportKind] = useState<ReportKind>('executive_report');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
  const [cityFilter, setCityFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState('');
  const [riderQuery, setRiderQuery] = useState('');

  const [exportBusy, setExportBusy] = useState(false);
  const [driveConfirmOpen, setDriveConfirmOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const allUnified = useMemo(() => buildUnifiedDailyRows(dataset), [dataset]);

  const inlineOptions = useMemo(() => {
    const months = Array.from(new Set(allUnified.map((r) => r.month).filter(Boolean))).sort().reverse();
    const cities = Array.from(new Set(allUnified.map((r) => r.city).filter(Boolean))).sort();
    const branches = Array.from(new Set(allUnified.map((r) => r.branch).filter(Boolean))).sort();
    const supervisors = Array.from(new Set(allUnified.map((r) => r.supervisor).filter(Boolean))).sort();
    return { months, cities, branches, supervisors };
  }, [allUnified]);

  const internalIdByPlatformRider = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of dataset.riderMappings) {
      map.set(`${m.platform}:${m.platformRiderId}`, m.internalRiderId);
    }
    return map;
  }, [dataset.riderMappings]);

  const reportRows = useMemo(() => {
    const q = riderQuery.trim().toLowerCase();
    return allUnified.filter((r) => {
      if (platformFilter !== 'all' && r.platform !== platformFilter) return false;
      if (monthFilter && r.month !== monthFilter) return false;
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      if (cityFilter && r.city !== cityFilter) return false;
      if (branchFilter && r.branch !== branchFilter) return false;
      if (supervisorFilter && r.supervisor !== supervisorFilter) return false;
      if (
        q &&
        !r.riderId.toLowerCase().includes(q) &&
        !r.riderName.toLowerCase().includes(q) &&
        !(internalIdByPlatformRider.get(`${r.platform}:${r.riderId}`) || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allUnified, internalIdByPlatformRider, platformFilter, monthFilter, startDate, endDate, cityFilter, branchFilter, supervisorFilter, riderQuery]);

  const reportFiltersForErrors: FilterState = useMemo(
    () => ({
      date: '',
      month: monthFilter,
      platform: platformFilter,
      city: cityFilter,
      branch: branchFilter,
      contract: '',
      supervisor: supervisorFilter,
      vehicleType: '',
      riderId: riderQuery,
    }),
    [monthFilter, platformFilter, cityFilter, branchFilter, supervisorFilter, riderQuery]
  );

  const errorIntel = useMemo(
    () => computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, reportFiltersForErrors),
    [dataset, dictionaryEntries, riderErrorCases, reportFiltersForErrors]
  );

  // Executive Brief live calculations
  const executiveSummary = useMemo(() => {
    const totalOrders = reportRows.reduce((s, r) => s + (r.completedOrders ?? 0), 0);
    const totalHours = reportRows.reduce((s, r) => s + (r.workingHours ?? 0), 0);
    const totalKm = reportRows.reduce((s, r) => s + (r.totalKm ?? 0), 0);
    const activeRiders = new Set(reportRows.filter((r) => r.isActive).map((r) => `${r.platform}:${r.riderId}`)).size;
    const totalRiders = new Set(reportRows.map((r) => `${r.platform}:${r.riderId}`)).size;
    const dates = Array.from(new Set(reportRows.map((r) => r.date))).sort();
    const attVals = reportRows.map((r) => r.attendanceRate).filter((v): v is number => v !== null);
    const avgAttendance = attVals.length ? Number((attVals.reduce((a, b) => a + b, 0) / attVals.length).toFixed(1)) : null;

    // Group by rider for weighted score ranking
    const byRider = new Map<string, UnifiedDailyRow[]>();
    for (const r of reportRows) {
      const k = `${r.platform}:${r.riderId}`;
      const list = byRider.get(k) || [];
      list.push(r);
      byRider.set(k, list);
    }
    const riderScores = Array.from(byRider.values()).map((rows) => {
      const sample = rows[0];
      const hsQual =
        sample.platform === 'hungerstation'
          ? dataset.hungerQualityMonthly.find((q) => q.riderId === sample.riderId)?.finalDeliveryQualityScore ?? null
          : null;
      const score = computeRiderPerformanceScore(
        sample.platform,
        sample.riderId,
        rows,
        settings,
        hsQual
      );
      return {
        platform: sample.platform,
        riderId: sample.riderId,
        riderName: sample.riderName,
        branch: sample.branch || sample.city || '-',
        orders: rows.reduce((s, x) => s + (x.completedOrders ?? 0), 0),
        days: rows.length,
        score: score.totalScore,
        band: score.band,
      };
    });
    riderScores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.orders - a.orders);

    const branchCards = computeBranchScorecards(reportRows, settings);
    const anomalies = detectOperationalAnomalies(reportRows);
    const openCases = operationalCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved');
    const overdueCases = openCases.filter((c) => c.dueDate && c.dueDate < new Date().toISOString().slice(0, 10));

    return {
      periodStart: dates[0] || '-',
      periodEnd: dates[dates.length - 1] || '-',
      distinctDays: dates.length,
      totalRiders,
      activeRiders,
      totalOrders,
      totalHours: Number(totalHours.toFixed(1)),
      totalKm: Number(totalKm.toFixed(1)),
      avgAttendance,
      topPerformers: riderScores.slice(0, 5),
      bottomPerformers: [...riderScores].reverse().slice(0, 5),
      branchCards: branchCards.slice(0, 8),
      anomaliesCount: anomalies.length,
      openCasesCount: openCases.length,
      overdueCasesCount: overdueCases.length,
      errorEventsCount: errorIntel.totalErrorEvents,
      riderScores,
    };
  }, [reportRows, dataset.hungerQualityMonthly, settings, operationalCases, errorIntel.totalErrorEvents]);

  const reportPayload = useMemo(() => {
    const def = REPORT_DEFS.find((d) => d.key === reportKind)!;
    let columns: ExportColumn[] = [];
    let rows: Array<Record<string, unknown>> = [];

    if (reportKind === 'executive_report') {
      columns = [
        { header: 'البند التنفيذي', key: 'section', width: 28 },
        { header: 'القيمة / المؤشر', key: 'value', width: 26 },
        { header: 'ملاحظات الإدارة التشغيلية', key: 'detail', width: 45 },
      ];
      rows = [
        { section: 'نطاق الفترة المغطاة', value: `${executiveSummary.periodStart} → ${executiveSummary.periodEnd}`, detail: `${executiveSummary.distinctDays} يوم تشغيلي` },
        { section: 'إجمالي المندوبين / النشطون', value: `${executiveSummary.activeRiders} / ${executiveSummary.totalRiders}`, detail: 'بحسب الفلاتر المطبقة' },
        { section: 'إجمالي الطلبات المكتملة', value: executiveSummary.totalOrders, detail: 'HungerStation + Keeta' },
        { section: 'إجمالي ساعات العمل / الاتصال', value: executiveSummary.totalHours, detail: 'ساعة مسجلة' },
        { section: 'إجمالي المسافة المقطوعة (كم)', value: executiveSummary.totalKm, detail: 'HS Distance + Keeta VDA' },
        { section: 'متوسط نسبة الحضور', value: executiveSummary.avgAttendance !== null ? `${executiveSummary.avgAttendance}%` : 'غير متاح', detail: 'معدل السجلات المتوفرة' },
        { section: 'حالات أخطاء HungerStation', value: executiveSummary.errorEventsCount, detail: `${errorIntel.distinctCodesCount} أكواد مختلفة` },
        { section: 'الحالات التشغيلية المفتوحة / المتأخرة', value: `${executiveSummary.openCasesCount} / ${executiveSummary.overdueCasesCount}`, detail: 'من مركز التحكم التشغيلي' },
        { section: 'الانحرافات الأدائيّة المرصودة', value: executiveSummary.anomaliesCount, detail: 'تراجع حاد ≥35% أو انخفاض متتالي' },
        ...executiveSummary.branchCards.map((b) => ({
          section: `فرع: ${b.branchName}`,
          value: `${b.completedOrders} طلب (${b.avgOrdersPerRider} طلب/مندوب)`,
          detail: `الإنجاز ${b.completionRate ?? '-'}% · المندوبون ${b.activeRidersCount}/${b.ridersCount} · الحالة: ${b.healthStatus}`,
        })),
      ];
    } else if (reportKind === 'daily_operations' || reportKind === 'monthly_performance') {
      const isMonthly = reportKind === 'monthly_performance';
      columns = [
        { header: isMonthly ? 'الشهر' : 'التاريخ', key: 'period', width: 16 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوبون النشطون', key: 'activeRiders', width: 18 },
        { header: 'الطلبات المكتملة', key: 'orders', width: 18 },
        { header: 'ساعات العمل/الاتصال', key: 'hours', width: 20 },
        { header: 'المسافة الإجمالية (كم)', key: 'totalKm', width: 20 },
        { header: 'المسافة المستحقة (كم)', key: 'payableKm', width: 20 },
      ];
      const map = new Map<string, { period: string; platform: string; riders: Set<string>; orders: number; hours: number; totalKm: number; payableKm: number }>();
      for (const r of reportRows) {
        const p = isMonthly ? r.month : r.date;
        const k = `${p}:${r.platform}`;
        const cur = map.get(k) || {
          period: p,
          platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
          riders: new Set<string>(),
          orders: 0,
          hours: 0,
          totalKm: 0,
          payableKm: 0,
        };
        if (r.isActive) cur.riders.add(r.riderId);
        cur.orders += r.completedOrders ?? 0;
        cur.hours += r.workingHours ?? 0;
        cur.totalKm += r.totalKm ?? 0;
        cur.payableKm += r.payableKm ?? 0;
        map.set(k, cur);
      }
      rows = Array.from(map.values())
        .sort((a, b) => b.period.localeCompare(a.period))
        .map((x) => ({
          period: x.period,
          platform: x.platform,
          activeRiders: x.riders.size,
          orders: x.orders,
          hours: Number(x.hours.toFixed(1)),
          totalKm: Number(x.totalKm.toFixed(1)),
          payableKm: Number(x.payableKm.toFixed(1)),
        }));
    } else if (reportKind === 'rider_ranking') {
      columns = [
        { header: 'المنصة', key: 'platform', width: 15 },
        { header: 'معرف المندوب', key: 'riderId', width: 18 },
        { header: 'الاسم', key: 'riderName', width: 22 },
        { header: 'الفرع / المدينة', key: 'branch', width: 18 },
        { header: 'الأيام', key: 'days', width: 10 },
        { header: 'إجمالي الطلبات', key: 'orders', width: 16 },
        { header: 'متوسط/يوم', key: 'avgOrders', width: 14 },
        { header: 'التقييم الموزون (100)', key: 'score', width: 18 },
        { header: 'التصنيف', key: 'band', width: 14 },
      ];
      rows = executiveSummary.riderScores.map((x) => ({
        platform: x.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
        riderId: x.riderId,
        riderName: x.riderName,
        branch: x.branch,
        days: x.days,
        orders: x.orders,
        avgOrders: Number((x.orders / Math.max(1, x.days)).toFixed(1)),
        score: x.score,
        band: x.band,
      }));
    } else if (reportKind === 'branch_performance') {
      columns = [
        { header: 'الفرع / المدينة', key: 'branchName', width: 24 },
        { header: 'إجمالي المندوبين', key: 'ridersCount', width: 16 },
        { header: 'النشطون', key: 'activeRidersCount', width: 14 },
        { header: 'الطلبات المكتملة', key: 'completedOrders', width: 18 },
        { header: 'متوسط الطلبات/مندوب', key: 'avgOrdersPerRider', width: 18 },
        { header: 'معدل الإنجاز %', key: 'completionRate', width: 14 },
        { header: 'ساعات العمل', key: 'workingHours', width: 16 },
        { header: 'حالة التشغيل', key: 'healthStatus', width: 16 },
      ];
      rows = executiveSummary.branchCards.map((b) => ({
        branchName: b.branchName,
        ridersCount: b.ridersCount,
        activeRidersCount: b.activeRidersCount,
        completedOrders: b.completedOrders,
        avgOrdersPerRider: b.avgOrdersPerRider,
        completionRate: b.completionRate !== null ? `${b.completionRate}%` : 'غير متاح',
        workingHours: b.workingHours,
        healthStatus: b.healthStatus,
      }));
    } else if (reportKind === 'supervisor_performance') {
      columns = [
        { header: 'المشرف', key: 'supervisor', width: 24 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوبون', key: 'riders', width: 14 },
        { header: 'الطلبات المكتملة', key: 'orders', width: 18 },
        { header: 'ساعات العمل', key: 'hours', width: 16 },
      ];
      const map = new Map<string, { supervisor: string; platform: string; riders: Set<string>; orders: number; hours: number }>();
      for (const r of reportRows) {
        if (!r.supervisor) continue;
        const k = `${r.supervisor}:${r.platform}`;
        const cur = map.get(k) || {
          supervisor: r.supervisor,
          platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
          riders: new Set<string>(),
          orders: 0,
          hours: 0,
        };
        cur.riders.add(r.riderId);
        cur.orders += r.completedOrders ?? 0;
        cur.hours += r.workingHours ?? 0;
        map.set(k, cur);
      }
      rows = Array.from(map.values())
        .sort((a, b) => b.orders - a.orders)
        .map((x) => ({
          supervisor: x.supervisor,
          platform: x.platform,
          riders: x.riders.size,
          orders: x.orders,
          hours: Number(x.hours.toFixed(1)),
        }));
    } else if (reportKind === 'error_code_analysis') {
      columns = [
        { header: 'الكود الموحد', key: 'normalizedCode', width: 18 },
        { header: 'الوصف المعتمد', key: 'displayTitle', width: 28 },
        { header: 'الخطورة', key: 'severity', width: 14 },
        { header: 'مرات الظهور', key: 'occurrences', width: 14 },
        { header: 'المندوبون المتأثرون', key: 'riders', width: 18 },
        { header: 'تكرار لنفس المندوب', key: 'repeated', width: 18 },
        { header: 'أعلى مدينة', key: 'topCity', width: 16 },
        { header: 'أول / آخر ظهور', key: 'range', width: 24 },
      ];
      rows = errorIntel.codes.map((c) => ({
        normalizedCode: c.normalizedCode,
        displayTitle: c.displayTitle,
        severity: c.severity,
        occurrences: c.occurrenceCount,
        riders: c.affectedRidersCount,
        repeated: c.repeatedRidersCount,
        topCity: c.cityBreakdown[0]?.name || '-',
        range: `${c.firstSeenDate} → ${c.lastSeenDate}`,
      }));
    } else if (reportKind === 'platform_comparison') {
      columns = [
        { header: 'المؤشر', key: 'metric', width: 28 },
        { header: 'HungerStation', key: 'hs', width: 20 },
        { header: 'Keeta', key: 'keeta', width: 20 },
        { header: 'تطابق التعريف / ملاحظة المقارنة', key: 'parityNote', width: 42 },
      ];
      const hs = reportRows.filter((r) => r.platform === 'hungerstation');
      const kt = reportRows.filter((r) => r.platform === 'keeta');
      const sum = (arr: UnifiedDailyRow[], fn: (r: UnifiedDailyRow) => number | null) =>
        arr.reduce((s, r) => s + (fn(r) ?? 0), 0);
      const avg = (arr: UnifiedDailyRow[], fn: (r: UnifiedDailyRow) => number | null) => {
        const vals = arr.map(fn).filter((v): v is number => v !== null);
        return vals.length ? `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}%` : 'غير متاح';
      };

      rows = [
        { metric: 'إجمالي المندوبين', hs: new Set(hs.map((r) => r.riderId)).size, keeta: new Set(kt.map((r) => r.riderId)).size, parityNote: 'متطابق (معرف مستقل لكل منصة)' },
        { metric: 'الطلبات المكتملة / المسلمة', hs: sum(hs, (r) => r.completedOrders), keeta: sum(kt, (r) => r.completedOrders), parityNote: 'متطابق (Completed Deliveries vs Delivered Tasks)' },
        { metric: 'ساعات العمل / الاتصال', hs: Number(sum(hs, (r) => r.workingHours).toFixed(1)), keeta: Number(sum(kt, (r) => r.workingHours).toFixed(1)), parityNote: 'اختلاف طفيف: Actual Working Hours مقابل Shift Online Hours' },
        { metric: 'معدل الالتزام / الحضور', hs: avg(hs, (r) => r.attendanceRate), keeta: avg(kt, (r) => r.attendanceRate), parityNote: 'اختلاف تعريف: HS Attendance Rate% مقابل نسبة On-Shift؟ في كيتا' },
        { metric: 'معدل الإنجاز (Completion %)', hs: avg(hs, (r) => r.completionRate), keeta: avg(kt, (r) => r.completionRate), parityNote: 'HS محسوب (Completed/Accepted) مقابل Keeta Completion Rate' },
        { metric: 'المسافة الإجمالية (Total KM)', hs: Number(sum(hs, (r) => r.totalKm).toFixed(1)), keeta: Number(sum(kt, (r) => r.totalKm).toFixed(1)), parityNote: 'متطابق (Riders Distance مقابل VDA Total Distance)' },
        { metric: 'المسافة المستحقة (Payable KM)', hs: Number(sum(hs, (r) => r.payableKm).toFixed(1)), keeta: Number(sum(kt, (r) => r.payableKm).toFixed(1)), parityNote: 'متطابق (Payable KM مقابل VDA Payable distance)' },
      ];
    } else if (reportKind === 'attendance_report') {
      columns = [
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوب', key: 'riderId', width: 18 },
        { header: 'ساعات العمل', key: 'hours', width: 15 },
        { header: 'الحضور %', key: 'att', width: 15 },
      ];
      rows = reportRows.map((r) => ({
        date: r.date,
        platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
        riderId: r.riderId,
        hours: r.workingHours ?? 'غير متاح',
        att: r.attendanceRate !== null ? `${r.attendanceRate}%` : 'غير متاح',
      }));
    } else {
      // delivery_quality
      columns = [
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوب', key: 'riderId', width: 18 },
        { header: 'الفترة', key: 'period', width: 14 },
        { header: 'Quality Score / On-Time %', key: 'score', width: 22 },
        { header: 'Segment / Overdue', key: 'extra', width: 22 },
      ];
      rows = [
        ...(platformFilter !== 'keeta'
          ? dataset.hungerQualityMonthly
              .filter((q) => (!monthFilter || q.month === monthFilter) && (!cityFilter || q.city === cityFilter))
              .map((q) => ({
                platform: 'HungerStation',
                riderId: q.riderId,
                period: q.month,
                score: q.finalDeliveryQualityScore ?? 'غير متاح',
                extra: q.segment || '-',
              }))
          : []),
        ...(platformFilter !== 'hungerstation'
          ? dataset.keetaDashboardDaily
              .filter((k) => (!monthFilter || k.month === monthFilter) && (!startDate || k.date >= startDate) && (!endDate || k.date <= endDate))
              .map((k) => ({
                platform: 'Keeta',
                riderId: k.riderId,
                period: k.date,
                score: k.onTimeRate !== null ? `${k.onTimeRate}%` : 'غير متاح',
                extra: `Overdue: ${k.overdueOrderTasks ?? 0}`,
              }))
          : []),
      ];
    }

    return { def, columns, rows };
  }, [reportKind, reportRows, dataset, executiveSummary, errorIntel, platformFilter, monthFilter, startDate, endDate, cityFilter]);

  const handleExportExcel = async (saveToDrive = false) => {
    if (!auth.currentUser) return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      let driveToken = getDriveAccessToken();
      if (saveToDrive && !driveToken) {
        driveToken = await refreshDriveTokenWithPopup();
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      };
      if (saveToDrive && driveToken) {
        headers['X-Drive-Access-Token'] = driveToken;
      }

      const fileName = `fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const exportPayload = {
        title: `Fleet Operations Center — ${reportPayload.def.label}`,
        sheetName: reportKind,
        columns: reportPayload.columns,
        rows: reportPayload.rows,
        metadataLines: [reportPayload.def.note, `تاريخ التصدير: ${new Date().toISOString().slice(0, 10)}`],
        saveToDrive,
        fileName,
      };

      try {
        const res = await fetch('/api/export/excel', {
          method: 'POST',
          headers,
          body: JSON.stringify(exportPayload),
        });

        const resContentType = (res.headers.get('content-type') || '').toLowerCase();
        if (resContentType.includes('text/html') || res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503) {
          throw new ApiHtmlFallbackError();
        }

        if (!res.ok) {
          const err = await safeParseJsonResponse<{ error?: string }>(res);
          throw new Error(err.error || 'تعذر تصدير التقرير.');
        }

        if (saveToDrive) {
          const json = await safeParseJsonResponse<{ driveFile?: { name?: string } }>(res);
          setExportMsg(`تم حفظ التقرير "${json.driveFile?.name || fileName}" في Google Drive بنجاح.`);
          setDriveConfirmOpen(false);
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
          setExportMsg(`تم تنزيل ملف Excel (${fileName}) بنجاح.`);
        }
      } catch (apiErr) {
        if (apiErr instanceof ApiHtmlFallbackError || apiErr instanceof TypeError) {
          const fallbackRes = await exportExcelInBrowser(exportPayload);
          if (saveToDrive) {
            setExportMsg(`تم حفظ التقرير "${fallbackRes.driveFile?.name || fileName}" في Google Drive بنجاح.`);
            setDriveConfirmOpen(false);
          } else {
            setExportMsg(`تم تنزيل ملف Excel (${fileName}) بنجاح.`);
          }
        } else {
          throw apiErr;
        }
      }
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'فشل التصدير.');
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportPdf = async () => {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const fileName = `fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await exportArabicTableToPdf({
        title: `Fleet Operations Center — ${reportPayload.def.label}`,
        subtitle: reportPayload.def.note,
        columns: reportPayload.columns,
        rows: reportPayload.rows,
        fileName,
      });
      setExportMsg(`تم تصدير ملف PDF (${fileName}) بنجاح.`);
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'فشل تصدير PDF.');
    } finally {
      setExportBusy(false);
    }
  };

  const tableCols: TableColumn<Record<string, unknown>>[] = reportPayload.columns.map((c) => ({
    key: c.key,
    header: c.header,
    sortValue: (r) => r[c.key] as string | number | null,
    render: (r) => {
      const v = r[c.key];
      return (
        <span className={typeof v === 'number' ? 'font-mono-num font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}>
          {v === null || v === undefined ? 'غير متاح' : String(v)}
        </span>
      );
    },
  }));

  const resetInlineFilters = () => {
    setStartDate('');
    setEndDate('');
    setMonthFilter('');
    setPlatformFilter('all');
    setCityFilter('');
    setBranchFilter('');
    setSupervisorFilter('');
    setRiderQuery('');
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">مركز التقارير والذكاء التجاري (BI Reports Center)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{reportPayload.def.note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>طباعة التقرير الرسمي</span>
          </button>
          <button
            type="button"
            disabled={exportBusy || reportPayload.rows.length === 0}
            onClick={() => handleExportExcel(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            disabled={exportBusy || reportPayload.rows.length === 0}
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>تصدير PDF</span>
          </button>
          <button
            type="button"
            disabled={exportBusy || reportPayload.rows.length === 0}
            onClick={() => setDriveConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            <span>حفظ في Google Drive</span>
          </button>
        </div>
      </div>

      {exportMsg && (
        <div className="no-print rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200">
          {exportMsg}
        </div>
      )}

      {/* Inline Report Filters */}
      <div className="no-print rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">نطاق وفلاتر التقرير</span>
          <button
            type="button"
            onClick={resetInlineFilters}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            <span>إعادة ضبط</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8 text-xs">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="من تاريخ"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 font-mono-num text-slate-800 dark:text-slate-200"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="إلى تاريخ"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 font-mono-num text-slate-800 dark:text-slate-200"
          />
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="">كل الأشهر</option>
            {inlineOptions.months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as 'all' | Platform)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="all">كل المنصات</option>
            <option value="hungerstation">HungerStation</option>
            <option value="keeta">Keeta</option>
          </select>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="">كل المدن</option>
            {inlineOptions.cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="">كل الفروع</option>
            {inlineOptions.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={supervisorFilter}
            onChange={(e) => setSupervisorFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="">كل المشرفين</option>
            {inlineOptions.supervisors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="text"
            value={riderQuery}
            onChange={(e) => setRiderQuery(e.target.value)}
            placeholder="معرف أو اسم المندوب..."
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      {/* 10 Report Selector Tabs */}
      <div className="no-print flex flex-wrap gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
        {REPORT_DEFS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setReportKind(r.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              reportKind === r.key
                ? 'bg-slate-900 dark:bg-blue-600 text-white'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Formal Printable Executive Brief View */}
      {reportKind === 'executive_report' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="text-[11px] font-mono-num font-bold tracking-wider text-slate-500 dark:text-slate-400">
                FLEET OPERATIONS CENTER — FORMAL EXECUTIVE BRIEF
              </div>
              <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                ملخص الإدارة العليا الرسمي لأداء الأسطول
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                الفترة المغطاة: <span className="font-mono-num font-semibold">{executiveSummary.periodStart}</span> →{' '}
                <span className="font-mono-num font-semibold">{executiveSummary.periodEnd}</span> ({executiveSummary.distinctDays} يوم تشغيلي)
              </p>
            </div>
            <div className="text-left text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              <div>تاريخ الإصدار: {new Date().toISOString().slice(0, 10)}</div>
              <div>المصدر: HungerStation &amp; Keeta Official Reports</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <KpiCard label="الطلبات المكتملة" value={fmtNum(executiveSummary.totalOrders)} tone="good" />
            <KpiCard label="المندوبون النشطون" value={`${executiveSummary.activeRiders} / ${executiveSummary.totalRiders}`} />
            <KpiCard label="ساعات العمل / الاتصال" value={fmtNum(executiveSummary.totalHours, 1)} />
            <KpiCard label="متوسط الحضور" value={fmtPct(executiveSummary.avgAttendance)} />
            <KpiCard
              label="حالات الأخطاء / المفتوحة"
              value={`${executiveSummary.errorEventsCount} / ${executiveSummary.openCasesCount}`}
              tone={executiveSummary.overdueCasesCount > 0 ? 'critical' : 'warn'}
              subtext={`متأخرة SLA: ${executiveSummary.overdueCasesCount}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">أعلى 5 مندوبين حسب التقييم الموزون</h4>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {executiveSummary.topPerformers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">لا توجد بيانات كافية</div>
                ) : (
                  executiveSummary.topPerformers.map((r) => (
                    <div key={`${r.platform}:${r.riderId}`} className="flex items-center justify-between px-3 py-2">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{r.riderName}</span>{' '}
                        <span className="font-mono-num text-slate-500">({r.riderId})</span>
                      </div>
                      <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                        {r.score}/100 · {r.orders} طلب
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">أدنى 5 مندوبين للمتابعة والتدخل</h4>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {executiveSummary.bottomPerformers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">لا توجد بيانات كافية</div>
                ) : (
                  executiveSummary.bottomPerformers.map((r) => (
                    <div key={`${r.platform}:${r.riderId}`} className="flex items-center justify-between px-3 py-2">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{r.riderName}</span>{' '}
                        <span className="font-mono-num text-slate-500">({r.riderId})</span>
                      </div>
                      <span className="font-mono-num font-bold text-red-700 dark:text-red-400">
                        {r.score}/100 · {r.orders} طلب
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <DataTable
        rows={reportPayload.rows}
        columns={tableCols}
        rowKey={(_, idx) => `${reportKind}_${idx}`}
        searchPlaceholder="تصفية سريعة داخل التقرير..."
        searchText={(r) => Object.values(r).join(' ')}
      />

      <ConfirmModal
        open={driveConfirmOpen}
        title="تأكيد حفظ التقرير في Google Drive"
        description={`سيتم إنشاء ملف Excel جديد باسم "fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.xlsx" ورفعه إلى حسابك في Google Drive (${reportPayload.rows.length} صف). هل تريد المتابعة؟`}
        confirmLabel="رفع وحفظ في Drive"
        busy={exportBusy}
        onConfirm={() => handleExportExcel(true)}
        onCancel={() => setDriveConfirmOpen(false)}
      />
    </div>
  );
}
