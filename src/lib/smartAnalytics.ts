import type {
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalSettings,
  Platform,
} from '../types/fleet';
import { extractHungerErrorEvents } from './errorIntelligence';
import {
  computeOverviewMetrics,
  type FleetDataset,
  type OverviewMetrics,
  type UnifiedDailyRow,
} from './fleetAnalytics';

export interface KpiDefinition {
  id: string;
  titleAr: string;
  sourcePlatform: 'both' | 'hungerstation' | 'keeta';
  exactFields: string;
  formulaText: string;
  platformDifferenceNote: string;
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    id: 'totalRiders',
    titleAr: 'إجمالي المندوبين المسجلين',
    sourcePlatform: 'both',
    exactFields: 'Hunger-Daily (Rider ID) + Keeta Dashboard (Courier ID)',
    formulaText: 'عدد المعرفات الفريدة لكل منصة ضمن النطاق المحدد (لا يتم الدمج إلا عبر الربط اليدوي المعتمد).',
    platformDifferenceNote: 'في هنقرستيشن يُعرّف المندوب عبر Rider ID، وفي كيتا عبر Courier ID.',
  },
  {
    id: 'activeRiders',
    titleAr: 'المندوبون النشطون',
    sourcePlatform: 'both',
    exactFields: 'completedOrders > 0 OR workingHours > 0',
    formulaText: 'عدد المندوبين الذين سجلوا طلبًا واحدًا مكتملًا على الأقل أو ساعات عمل فعلية > 0.',
    platformDifferenceNote: 'يمكن ضبط حد النشاط الأدنى في إعدادات النظام (minActiveOrdersPerDay / minActiveHoursPerDay).',
  },
  {
    id: 'completedOrders',
    titleAr: 'الطلبات المكتملة',
    sourcePlatform: 'both',
    exactFields: 'HS: Completed Deliveries | Keeta: Delivered Tasks',
    formulaText: 'مجموع الطلبات/المهام المسلمة بنجاح دون تقدير أو تعويض للقيم الفارغة.',
    platformDifferenceNote: 'متطابق تشغيليًا: Completed Deliveries في هنقر يقابل Delivered Tasks في كيتا.',
  },
  {
    id: 'workingHours',
    titleAr: 'ساعات العمل الفعلية',
    sourcePlatform: 'both',
    exactFields: 'HS: Actual Working Hours | Keeta: Shift Online Hours',
    formulaText: 'مجموع ساعات العمل/الاتصال الفعلية المسجلة داخل الشفتات.',
    platformDifferenceNote: 'كيتا تفصل أيضًا بين Courier App Online Time و Shift Valid Online Time.',
  },
  {
    id: 'attendanceRate',
    titleAr: 'معدل الحضور والالتزام',
    sourcePlatform: 'both',
    exactFields: 'HS: Attendance % | Keeta: On-Shift? / VDA sumValidShifts',
    formulaText: 'متوسط نسب الالتزام للشفتات الصالحة المسجلة.',
    platformDifferenceNote: 'اختلاف جوهري: هنقر توفر نسبة يومية Attendance %، بينما كيتا توفر حالة On-Shift? أو نسبة الشفتات الصالحة في VDA.',
  },
  {
    id: 'acceptanceRate',
    titleAr: 'معدل القبول',
    sourcePlatform: 'both',
    exactFields: 'HS: Acceptance Rate % | Keeta: Accepted / (Accepted + Rejected)',
    formulaText: 'في هنقر يُقرأ الحقل مباشرة؛ وفي كيتا يُحسب فقط عند توفر المقبول والمرفوض بمقام > 0.',
    platformDifferenceNote: 'الرفض في كيتا ينقسم إلى Courier Rejected و Auto Rejected.',
  },
  {
    id: 'completionRate',
    titleAr: 'معدل الإنجاز',
    sourcePlatform: 'both',
    exactFields: 'HS: Completed / Accepted | Keeta: Order completion rate',
    formulaText: 'نسبة الطلبات المسلمة فعليًا من إجمالي الطلبات المقبولة.',
    platformDifferenceNote: 'في كيتا يأتي محسوبًا في العمود مباشرة، وفي هنقر يُحسب من Completed / Accepted.',
  },
  {
    id: 'onTimeRate',
    titleAr: 'معدل الالتزام بالوقت (On-Time)',
    sourcePlatform: 'both',
    exactFields: 'Keeta: On-time Rate % (يومي) | HS: Delivery Quality Segmentation (شهري)',
    formulaText: 'نسبة الطلبات المسلمة ضمن الوقت المستهدف.',
    platformDifferenceNote: 'هنقر لا تدرج On-Time يوميًا في Hunger-Daily بل شهريًا في Delivery Quality Segmentation.',
  },
  {
    id: 'totalKm',
    titleAr: 'المسافة الإجمالية والمستحقة (كم)',
    sourcePlatform: 'both',
    exactFields: 'HS: Riders Distance (Total KM / Payable KM) | Keeta: VDA (Total / Payable)',
    formulaText: 'مجموع الكيلومترات المسجلة يوميًا مع التمييز الصريح بين Total و Payable.',
    platformDifferenceNote: 'تُربط المسافات باليوم والمندوب عبر Online Day في كيتا وDate في هنقر.',
  },
];

export interface PeriodWindowSummary {
  label: string;
  status: 'complete' | 'incomplete';
  incompleteReason?: string;
  currentRangeLabel: string;
  previousRangeLabel: string;
  currentDaysCount: number;
  previousDaysCount: number;
  current?: OverviewMetrics;
  previous?: OverviewMetrics;
  ordersDeltaPct?: number | null;
  hoursDeltaPct?: number | null;
  activeRidersDeltaPct?: number | null;
  completionDeltaPts?: number | null;
  acceptanceDeltaPts?: number | null;
}

function pctDelta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

function ptsDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Number((cur - prev).toFixed(1));
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function computePeriodComparisons(
  rows: UnifiedDailyRow[],
  settings: OperationalSettings
): {
  daily: PeriodWindowSummary;
  weekly: PeriodWindowSummary;
  monthly: PeriodWindowSummary;
} {
  const allDates = Array.from(new Set(rows.map((r) => r.date).filter(Boolean))).sort();
  const allMonths = Array.from(new Set(rows.map((r) => r.month).filter(Boolean))).sort();

  // 1. Today vs Yesterday (Latest operational day vs Immediate prior operational day)
  let daily: PeriodWindowSummary;
  if (allDates.length < 2) {
    daily = {
      label: 'آخر يوم تشغيل مقابل اليوم السابق',
      status: 'incomplete',
      incompleteReason: 'فترة مرجعية غير مكتملة: يلزم توفر يومي تشغيل على الأقل للمقارنة اليومية.',
      currentRangeLabel: allDates[0] || 'غير متاح',
      previousRangeLabel: 'غير متاح',
      currentDaysCount: allDates.length,
      previousDaysCount: 0,
    };
  } else {
    const curDate = allDates[allDates.length - 1];
    const prevDate = allDates[allDates.length - 2];
    const curMetrics = computeOverviewMetrics(rows.filter((r) => r.date === curDate), settings);
    const prevMetrics = computeOverviewMetrics(rows.filter((r) => r.date === prevDate), settings);
    daily = {
      label: 'آخر يوم تشغيل مقابل اليوم السابق',
      status: 'complete',
      currentRangeLabel: curDate,
      previousRangeLabel: prevDate,
      currentDaysCount: 1,
      previousDaysCount: 1,
      current: curMetrics,
      previous: prevMetrics,
      ordersDeltaPct: pctDelta(curMetrics.completedOrders, prevMetrics.completedOrders),
      hoursDeltaPct: pctDelta(curMetrics.workingHours, prevMetrics.workingHours),
      activeRidersDeltaPct: pctDelta(curMetrics.activeRiders, prevMetrics.activeRiders),
      completionDeltaPts: ptsDelta(curMetrics.completionRate, prevMetrics.completionRate),
      acceptanceDeltaPts: ptsDelta(curMetrics.acceptanceRate, prevMetrics.acceptanceRate),
    };
  }

  // 2. Weekly Comparison (Strictly requires 7 distinct active days in BOTH current 7-day window and prior 7-day window)
  let weekly: PeriodWindowSummary;
  if (allDates.length === 0) {
    weekly = {
      label: 'الأسبوع الأخير (7 أيام) مقابل الأسبوع السابق',
      status: 'incomplete',
      incompleteReason: 'فترة مرجعية غير مكتملة: لا توجد تواريخ تشغيل كافية.',
      currentRangeLabel: 'غير متاح',
      previousRangeLabel: 'غير متاح',
      currentDaysCount: 0,
      previousDaysCount: 0,
    };
  } else {
    const latestDate = allDates[allDates.length - 1];
    const curStart = addDaysIso(latestDate, -6);
    const prevEnd = addDaysIso(latestDate, -7);
    const prevStart = addDaysIso(latestDate, -13);

    const curWeekRows = rows.filter((r) => r.date >= curStart && r.date <= latestDate);
    const prevWeekRows = rows.filter((r) => r.date >= prevStart && r.date <= prevEnd);
    const curDays = new Set(curWeekRows.map((r) => r.date)).size;
    const prevDays = new Set(prevWeekRows.map((r) => r.date)).size;

    if (curDays < 7 || prevDays < 7) {
      weekly = {
        label: 'الأسبوع الأخير (7 أيام) مقابل الأسبوع السابق',
        status: 'incomplete',
        incompleteReason: `فترة مرجعية غير مكتملة: يتوفر ${curDays} أيام في النافذة الحالية و ${prevDays} أيام في السابقة (المطلوب 7 أيام مكتملة لكل فترة لعدم تضليل الإدارة بأرقام ناقصة).`,
        currentRangeLabel: `${curStart} ← ${latestDate}`,
        previousRangeLabel: `${prevStart} ← ${prevEnd}`,
        currentDaysCount: curDays,
        previousDaysCount: prevDays,
      };
    } else {
      const curMetrics = computeOverviewMetrics(curWeekRows, settings);
      const prevMetrics = computeOverviewMetrics(prevWeekRows, settings);
      weekly = {
        label: 'الأسبوع الأخير (7 أيام) مقابل الأسبوع السابق',
        status: 'complete',
        currentRangeLabel: `${curStart} ← ${latestDate}`,
        previousRangeLabel: `${prevStart} ← ${prevEnd}`,
        currentDaysCount: curDays,
        previousDaysCount: prevDays,
        current: curMetrics,
        previous: prevMetrics,
        ordersDeltaPct: pctDelta(curMetrics.completedOrders, prevMetrics.completedOrders),
        hoursDeltaPct: pctDelta(curMetrics.workingHours, prevMetrics.workingHours),
        activeRidersDeltaPct: pctDelta(curMetrics.activeRiders, prevMetrics.activeRiders),
        completionDeltaPts: ptsDelta(curMetrics.completionRate, prevMetrics.completionRate),
        acceptanceDeltaPts: ptsDelta(curMetrics.acceptanceRate, prevMetrics.acceptanceRate),
      };
    }
  }

  // 3. Monthly Comparison (Strictly requires >= 2 months AND >= 15 active days in BOTH months)
  let monthly: PeriodWindowSummary;
  if (allMonths.length < 2) {
    monthly = {
      label: 'الشهر الأخير مقابل الشهر السابق',
      status: 'incomplete',
      incompleteReason: 'فترة مرجعية غير مكتملة: يتوفر شهر واحد فقط في البيانات الحالية.',
      currentRangeLabel: allMonths[0] || 'غير متاح',
      previousRangeLabel: 'غير متاح',
      currentDaysCount: allDates.length,
      previousDaysCount: 0,
    };
  } else {
    const curMonth = allMonths[allMonths.length - 1];
    const prevMonth = allMonths[allMonths.length - 2];
    const curMonthRows = rows.filter((r) => r.month === curMonth);
    const prevMonthRows = rows.filter((r) => r.month === prevMonth);
    const curDays = new Set(curMonthRows.map((r) => r.date)).size;
    const prevDays = new Set(prevMonthRows.map((r) => r.date)).size;

    if (curDays < 15 || prevDays < 15) {
      monthly = {
        label: 'الشهر الأخير مقابل الشهر السابق',
        status: 'incomplete',
        incompleteReason: `فترة مرجعية غير مكتملة: شهر ${curMonth} يحتوي ${curDays} يومًا وشهر ${prevMonth} يحتوي ${prevDays} يومًا (يلزم 15 يومًا على الأقل في كل شهر).`,
        currentRangeLabel: curMonth,
        previousRangeLabel: prevMonth,
        currentDaysCount: curDays,
        previousDaysCount: prevDays,
      };
    } else {
      const curMetrics = computeOverviewMetrics(curMonthRows, settings);
      const prevMetrics = computeOverviewMetrics(prevMonthRows, settings);
      monthly = {
        label: 'الشهر الأخير مقابل الشهر السابق',
        status: 'complete',
        currentRangeLabel: curMonth,
        previousRangeLabel: prevMonth,
        currentDaysCount: curDays,
        previousDaysCount: prevDays,
        current: curMetrics,
        previous: prevMetrics,
        ordersDeltaPct: pctDelta(curMetrics.completedOrders, prevMetrics.completedOrders),
        hoursDeltaPct: pctDelta(curMetrics.workingHours, prevMetrics.workingHours),
        activeRidersDeltaPct: pctDelta(curMetrics.activeRiders, prevMetrics.activeRiders),
        completionDeltaPts: ptsDelta(curMetrics.completionRate, prevMetrics.completionRate),
        acceptanceDeltaPts: ptsDelta(curMetrics.acceptanceRate, prevMetrics.acceptanceRate),
      };
    }
  }

  return { daily, weekly, monthly };
}

export interface ScoreComponentBreakdown {
  key: string;
  label: string;
  configuredWeight: number;
  effectiveWeightPct: number;
  rawValueLabel: string;
  subScore: number;
  weightedPoints: number;
}

export interface RiderPerformanceScore {
  platform: Platform;
  riderId: string;
  riderName: string;
  city: string;
  branch: string;
  daysActive: number;
  totalOrders: number;
  totalHours: number;
  avgOrdersPerDay: number;
  avgHoursPerDay: number;
  totalScore: number | null;
  band: 'ممتاز' | 'جيد جدًا' | 'متوسط' | 'يحتاج متابعة' | 'غير كافٍ';
  components: ScoreComponentBreakdown[];
  formulaNote: string;
}

function avgValid(arr: Array<number | null | undefined>): number | null {
  const valid = arr.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function computeRiderPerformanceScore(
  platform: Platform,
  riderId: string,
  rows: UnifiedDailyRow[],
  settings: OperationalSettings,
  hungerQualityScore: number | null = null
): RiderPerformanceScore {
  const riderName = rows.find((r) => r.riderName && r.riderName !== r.riderId)?.riderName || riderId;
  const city = rows.find((r) => r.city)?.city || '';
  const branch = rows.find((r) => r.branch)?.branch || '';

  if (rows.length === 0) {
    return {
      platform,
      riderId,
      riderName,
      city,
      branch,
      daysActive: 0,
      totalOrders: 0,
      totalHours: 0,
      avgOrdersPerDay: 0,
      avgHoursPerDay: 0,
      totalScore: null,
      band: 'غير كافٍ',
      components: [],
      formulaNote: 'لا توجد سجلات يومية للمندوب ضمن النطاق المحدد.',
    };
  }

  const daysActive = rows.length;
  const totalOrders = rows.reduce((s, r) => s + (r.completedOrders ?? 0), 0);
  const totalHours = rows.reduce((s, r) => s + (r.workingHours ?? 0), 0);
  const avgOrdersPerDay = Number((totalOrders / daysActive).toFixed(1));
  const avgHoursPerDay = Number((totalHours / daysActive).toFixed(1));

  const avgAttendance = avgValid(rows.map((r) => r.attendanceRate));
  const avgAcceptance = avgValid(rows.map((r) => r.acceptanceRate));
  const avgCompletion = avgValid(rows.map((r) => r.completionRate));
  const avgOnTime = avgValid(rows.map((r) => r.onTimeRate));

  const totalCancelled = rows.reduce((s, r) => s + (r.cancelledOrders ?? 0), 0);
  const totalAccepted = rows.reduce((s, r) => s + (r.acceptedOrders ?? 0), 0);
  const cancelRate =
    totalAccepted > 0
      ? (totalCancelled / totalAccepted) * 100
      : null;

  const qualityRaw =
    platform === 'hungerstation'
      ? hungerQualityScore ?? avgCompletion
      : avgOnTime !== null && avgCompletion !== null
        ? (avgOnTime * 0.6 + avgCompletion * 0.4)
        : avgOnTime ?? avgCompletion;

  const rawComponents: Array<{
    key: string;
    label: string;
    weight: number;
    rawValueLabel: string;
    subScore: number | null;
  }> = [
    {
      key: 'productivity',
      label: 'الإنتاجية (الطلبات اليومية)',
      weight: settings.scoreWeightProductivity ?? 25,
      rawValueLabel: `${avgOrdersPerDay} / ${settings.minDailyOrders} طلب`,
      subScore:
        settings.minDailyOrders > 0
          ? Math.min(100, Number(((avgOrdersPerDay / settings.minDailyOrders) * 100).toFixed(1)))
          : 100,
    },
    {
      key: 'hours',
      label: 'ساعات العمل اليومية',
      weight: settings.scoreWeightHours ?? 15,
      rawValueLabel: `${avgHoursPerDay} / ${settings.minDailyWorkingHours} س`,
      subScore:
        settings.minDailyWorkingHours > 0
          ? Math.min(100, Number(((avgHoursPerDay / settings.minDailyWorkingHours) * 100).toFixed(1)))
          : 100,
    },
    {
      key: 'commitment',
      label: 'الالتزام والحضور',
      weight: settings.scoreWeightCommitment ?? 20,
      rawValueLabel: avgAttendance !== null ? `${avgAttendance.toFixed(1)}%` : 'غير متاح',
      subScore: avgAttendance !== null ? Math.min(100, Math.max(0, Number(avgAttendance.toFixed(1)))) : null,
    },
    {
      key: 'quality',
      label: 'جودة التسليم والوقت',
      weight: settings.scoreWeightQuality ?? 20,
      rawValueLabel: qualityRaw !== null ? `${qualityRaw.toFixed(1)}` : 'غير متاح',
      subScore: qualityRaw !== null ? Math.min(100, Math.max(0, Number(qualityRaw.toFixed(1)))) : null,
    },
    {
      key: 'acceptance',
      label: 'معدل القبول',
      weight: settings.scoreWeightAcceptance ?? 10,
      rawValueLabel: avgAcceptance !== null ? `${avgAcceptance.toFixed(1)}%` : 'غير متاح',
      subScore: avgAcceptance !== null ? Math.min(100, Math.max(0, Number(avgAcceptance.toFixed(1)))) : null,
    },
    {
      key: 'cancellation',
      label: 'انضباط الإلغاءات',
      weight: settings.scoreWeightCancellation ?? 10,
      rawValueLabel: cancelRate !== null ? `${cancelRate.toFixed(1)}% إلغاء` : 'غير متاح',
      subScore:
        cancelRate !== null
          ? Math.max(0, Math.min(100, Number((100 - (cancelRate / Math.max(1, settings.maxCancellationRatePct)) * 25).toFixed(1))))
          : null,
    },
  ];

  const active = rawComponents.filter((c) => c.subScore !== null && c.weight > 0);
  const activeWeightSum = active.reduce((s, c) => s + c.weight, 0);

  if (active.length === 0 || activeWeightSum <= 0) {
    return {
      platform,
      riderId,
      riderName,
      city,
      branch,
      daysActive,
      totalOrders,
      totalHours: Number(totalHours.toFixed(1)),
      avgOrdersPerDay,
      avgHoursPerDay,
      totalScore: null,
      band: 'غير كافٍ',
      components: [],
      formulaNote: 'الأوزان أو المؤشرات المتاحة غير كافية لحساب التقييم.',
    };
  }

  const components: ScoreComponentBreakdown[] = active.map((c) => {
    const effectiveWeightPct = Number(((c.weight / activeWeightSum) * 100).toFixed(1));
    const weightedPoints = Number((((c.subScore as number) * c.weight) / activeWeightSum).toFixed(1));
    return {
      key: c.key,
      label: c.label,
      configuredWeight: c.weight,
      effectiveWeightPct,
      rawValueLabel: c.rawValueLabel,
      subScore: c.subScore as number,
      weightedPoints,
    };
  });

  const totalScore = Number(
    Math.min(100, Math.max(0, components.reduce((s, c) => s + c.weightedPoints, 0))).toFixed(1)
  );

  const band: RiderPerformanceScore['band'] =
    totalScore >= 85
      ? 'ممتاز'
      : totalScore >= 72
        ? 'جيد جدًا'
        : totalScore >= 58
          ? 'متوسط'
          : 'يحتاج متابعة';

  return {
    platform,
    riderId,
    riderName,
    city,
    branch,
    daysActive,
    totalOrders,
    totalHours: Number(totalHours.toFixed(1)),
    avgOrdersPerDay,
    avgHoursPerDay,
    totalScore,
    band,
    components,
    formulaNote:
      'يُحسب التقييم عبر المتوسط المرجح للمحاور المتوفرة فعليًا للمندوب مع إعادة موازنة الأوزان تلقائيًا إذا غاب حقل في المنصة دون افتراض قيم وهمية.',
  };
}

export interface RiderAnomalyAlert {
  id: string;
  platform: Platform;
  riderId: string;
  riderName: string;
  branch: string;
  type: 'productivity_drop' | 'negative_trend';
  title: string;
  description: string;
  latestDate: string;
  severity: 'critical' | 'warning';
}

export function detectOperationalAnomalies(rows: UnifiedDailyRow[]): RiderAnomalyAlert[] {
  const byRider = new Map<string, UnifiedDailyRow[]>();
  for (const r of rows) {
    const k = `${r.platform}:${r.riderId}`;
    const arr = byRider.get(k) || [];
    arr.push(r);
    byRider.set(k, arr);
  }

  const anomalies: RiderAnomalyAlert[] = [];

  for (const rRows of byRider.values()) {
    const sorted = [...rRows].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 4) continue;

    const latest = sorted[sorted.length - 1];
    const recent3 = sorted.slice(-3);
    const prior = sorted.slice(0, -3);

    const priorAvg = avgValid(prior.map((x) => x.completedOrders));
    const recentAvg = avgValid(recent3.map((x) => x.completedOrders));

    if (priorAvg !== null && priorAvg >= 5 && recentAvg !== null) {
      const dropPct = ((priorAvg - recentAvg) / priorAvg) * 100;
      if (dropPct >= 35) {
        anomalies.push({
          id: `drop_${latest.platform}_${latest.riderId}`,
          platform: latest.platform,
          riderId: latest.riderId,
          riderName: latest.riderName,
          branch: latest.branch || latest.city || '-',
          type: 'productivity_drop',
          title: `هبوط إنتاجية حاد (-${dropPct.toFixed(0)}%)`,
          description: `انخفض متوسط الطلبات في آخر 3 أيام (${recentAvg.toFixed(1)}) مقارنة بمتوسط الفترة السابقة (${priorAvg.toFixed(1)}).`,
          latestDate: latest.date,
          severity: dropPct >= 50 ? 'critical' : 'warning',
        });
      }
    }

    const o0 = recent3[0].completedOrders;
    const o1 = recent3[1].completedOrders;
    const o2 = recent3[2].completedOrders;
    if (o0 !== null && o1 !== null && o2 !== null && o0 > o1 && o1 > o2 && o0 >= 6 && (o0 - o2) / o0 >= 0.3) {
      anomalies.push({
        id: `trend_${latest.platform}_${latest.riderId}`,
        platform: latest.platform,
        riderId: latest.riderId,
        riderName: latest.riderName,
        branch: latest.branch || latest.city || '-',
        type: 'negative_trend',
        title: 'اتجاه هبوطي متواصل (3 أيام متتالية)',
        description: `تراجع متواصل في الطلبات: ${o0} ← ${o1} ← ${o2} حتى تاريخ ${latest.date}.`,
        latestDate: latest.date,
        severity: 'warning',
      });
    }
  }

  return anomalies.sort((a, b) => (a.severity !== b.severity ? (a.severity === 'critical' ? -1 : 1) : b.latestDate.localeCompare(a.latestDate)));
}

export interface BranchScorecard {
  branchName: string;
  cityName: string;
  ridersCount: number;
  activeRidersCount: number;
  completedOrders: number;
  workingHours: number;
  avgOrdersPerRider: number;
  completionRate: number | null;
  acceptanceRate: number | null;
  overdueOrders: number;
  healthStatus: 'ممتاز' | 'مستقر' | 'يحتاج تدخل';
}

export function computeBranchScorecards(
  rows: UnifiedDailyRow[],
  settings: OperationalSettings
): BranchScorecard[] {
  const byBranch = new Map<string, UnifiedDailyRow[]>();
  for (const r of rows) {
    const label = r.branch || r.city || '';
    if (!label) continue;
    const arr = byBranch.get(label) || [];
    arr.push(r);
    byBranch.set(label, arr);
  }

  const out: BranchScorecard[] = [];
  for (const [branchName, bRows] of byBranch.entries()) {
    const riders = new Set(bRows.map((x) => `${x.platform}:${x.riderId}`));
    const active = new Set(bRows.filter((x) => x.isActive).map((x) => `${x.platform}:${x.riderId}`));
    const completedOrders = bRows.reduce((s, x) => s + (x.completedOrders ?? 0), 0);
    const workingHours = Number(bRows.reduce((s, x) => s + (x.workingHours ?? 0), 0).toFixed(1));
    const overdueOrders = bRows.reduce((s, x) => s + (x.overdueOrders ?? 0), 0);
    const comp = avgValid(bRows.map((x) => x.completionRate));
    const acc = avgValid(bRows.map((x) => x.acceptanceRate));
    const avgOrdersPerRider = active.size > 0 ? Number((completedOrders / active.size).toFixed(1)) : 0;

    const overdueRatio = completedOrders > 0 ? (overdueOrders / completedOrders) * 100 : 0;
    const needsIntervention =
      (comp !== null && comp < settings.minCompletionRatePct) ||
      (acc !== null && acc < settings.minAcceptanceRatePct) ||
      overdueRatio > settings.maxOverdueRatePct;

    const excellent =
      (comp === null || comp >= settings.minCompletionRatePct + 3) &&
      (acc === null || acc >= settings.minAcceptanceRatePct + 3) &&
      overdueRatio <= settings.maxOverdueRatePct / 2;

    out.push({
      branchName,
      cityName: bRows.find((x) => x.city)?.city || '-',
      ridersCount: riders.size,
      activeRidersCount: active.size,
      completedOrders,
      workingHours,
      avgOrdersPerRider,
      completionRate: comp !== null ? Number(comp.toFixed(1)) : null,
      acceptanceRate: acc !== null ? Number(acc.toFixed(1)) : null,
      overdueOrders,
      healthStatus: needsIntervention ? 'يحتاج تدخل' : excellent ? 'ممتاز' : 'مستقر',
    });
  }

  return out.sort((a, b) => b.completedOrders - a.completedOrders);
}

export type InterventionReasonType =
  | 'low_hours'
  | 'low_orders'
  | 'high_rejection_cancel'
  | 'repeated_overdue'
  | 'poor_attendance'
  | 'error_codes'
  | 'facial_failure';

export interface InterventionCandidate {
  id: string;
  platform: Platform;
  riderId: string;
  riderName: string;
  branchOrCity: string;
  latestDate: string;
  reasonType: InterventionReasonType;
  reasonLabel: string;
  severity: 'critical' | 'high' | 'medium';
  metricSummary: string;
  existingCase?: OperationalCase;
}

const REASON_LABELS: Record<InterventionReasonType, string> = {
  low_hours: 'انخفاض ساعات العمل',
  low_orders: 'انخفاض عدد الطلبات',
  high_rejection_cancel: 'ارتفاع الرفض أو الإلغاء',
  repeated_overdue: 'تكرار التأخير (Overdue)',
  poor_attendance: 'ضعف الالتزام بالورديات',
  error_codes: 'تكرار أكواد أخطاء هنقرستيشن',
  facial_failure: 'فشل أو تدني التحقق من الهوية',
};

export function buildInterventionQueue(
  dataset: FleetDataset,
  filteredRows: UnifiedDailyRow[],
  dictionaryEntries: ErrorCodeDictionaryEntry[],
  settings: OperationalSettings,
  operationalCases: OperationalCase[]
): InterventionCandidate[] {
  const byRider = new Map<string, UnifiedDailyRow[]>();
  for (const r of filteredRows) {
    const k = `${r.platform}:${r.riderId}`;
    const arr = byRider.get(k) || [];
    arr.push(r);
    byRider.set(k, arr);
  }

  const openCaseByKey = new Map<string, OperationalCase>();
  for (const c of operationalCases) {
    if (c.status === 'closed' || c.status === 'resolved') continue;
    openCaseByKey.set(`${c.platform}:${c.riderId}:${c.issueType}`, c);
  }

  const candidates: InterventionCandidate[] = [];

  for (const rows of byRider.values()) {
    const sample = rows[0];
    const sortedDates = rows.map((x) => x.date).sort();
    const latestDate = sortedDates[sortedDates.length - 1] || '';
    const branchOrCity = sample.branch || sample.city || '-';

    const avgHrs = avgValid(rows.map((x) => x.workingHours));
    const avgOrd = avgValid(rows.map((x) => x.completedOrders));
    const avgAtt = avgValid(rows.map((x) => x.attendanceRate));

    const totalAccepted = rows.reduce((s, x) => s + (x.acceptedOrders ?? 0), 0);
    const totalCancelled = rows.reduce((s, x) => s + (x.cancelledOrders ?? 0), 0);
    const totalRejected = rows.reduce((s, x) => s + (x.rejectedOrders ?? 0), 0);
    const totalOverdue = rows.reduce((s, x) => s + (x.overdueOrders ?? 0), 0);
    const totalCompleted = rows.reduce((s, x) => s + (x.completedOrders ?? 0), 0);

    const pushCandidate = (
      reasonType: InterventionReasonType,
      severity: InterventionCandidate['severity'],
      metricSummary: string
    ) => {
      candidates.push({
        id: `${sample.platform}_${sample.riderId}_${reasonType}`,
        platform: sample.platform,
        riderId: sample.riderId,
        riderName: sample.riderName || sample.riderId,
        branchOrCity,
        latestDate,
        reasonType,
        reasonLabel: REASON_LABELS[reasonType],
        severity,
        metricSummary,
        existingCase: openCaseByKey.get(`${sample.platform}:${sample.riderId}:${reasonType}`),
      });
    };

    if (avgHrs !== null && avgHrs < settings.minDailyWorkingHours) {
      pushCandidate(
        'low_hours',
        avgHrs < settings.minDailyWorkingHours * 0.6 ? 'critical' : 'medium',
        `متوسط ${avgHrs.toFixed(1)} س/يوم (الهدف ${settings.minDailyWorkingHours} س)`
      );
    }

    if (avgOrd !== null && avgOrd < settings.minDailyOrders) {
      pushCandidate(
        'low_orders',
        avgOrd < settings.minDailyOrders * 0.5 ? 'high' : 'medium',
        `متوسط ${avgOrd.toFixed(1)} طلب/يوم (الهدف ${settings.minDailyOrders})`
      );
    }

    if (avgAtt !== null && avgAtt < settings.minAttendanceRatePct) {
      pushCandidate(
        'poor_attendance',
        avgAtt < settings.minAttendanceRatePct - 15 ? 'critical' : 'high',
        `الالتزام بالورديات ${avgAtt.toFixed(1)}% (الحد ${settings.minAttendanceRatePct}%)`
      );
    }

    const cancelPct = totalAccepted > 0 ? (totalCancelled / totalAccepted) * 100 : null;
    const rejectPct =
      totalAccepted + totalRejected > 0 ? (totalRejected / (totalAccepted + totalRejected)) * 100 : null;
    if ((cancelPct !== null && cancelPct > settings.maxCancellationRatePct) || (rejectPct !== null && rejectPct > 100 - settings.minAcceptanceRatePct)) {
      pushCandidate(
        'high_rejection_cancel',
        'high',
        `إلغاء: ${cancelPct !== null ? `${cancelPct.toFixed(1)}%` : '-'} · رفض: ${rejectPct !== null ? `${rejectPct.toFixed(1)}%` : '-'}`
      );
    }

    const overduePct = totalCompleted > 0 ? (totalOverdue / totalCompleted) * 100 : null;
    if (overduePct !== null && overduePct > settings.maxOverdueRatePct && totalOverdue >= 2) {
      pushCandidate(
        'repeated_overdue',
        overduePct > settings.maxOverdueRatePct * 1.5 ? 'critical' : 'high',
        `${totalOverdue} طلب متأخر (${overduePct.toFixed(1)}%)`
      );
    }
  }

  // HungerStation Error Codes
  const { events } = extractHungerErrorEvents(dataset.hungerDaily, dataset, dictionaryEntries, []);
  const errByRider = new Map<string, { count: number; codes: Set<string>; latest: string; city: string; hasCritical: boolean }>();
  for (const e of events) {
    const sev = e.dictionaryEntry?.severity;
    const cur = errByRider.get(e.riderId) || { count: 0, codes: new Set(), latest: e.date, city: e.city || '-', hasCritical: false };
    cur.count += 1;
    cur.codes.add(e.normalizedCode);
    if (e.date > cur.latest) cur.latest = e.date;
    if (sev === 'critical' || sev === 'high') cur.hasCritical = true;
    errByRider.set(e.riderId, cur);
  }
  const repeatThresh = settings.errorRepeatRiderThreshold ?? 2;
  for (const [riderId, info] of errByRider.entries()) {
    if (info.count >= repeatThresh || info.hasCritical) {
      candidates.push({
        id: `hungerstation_${riderId}_error_codes`,
        platform: 'hungerstation',
        riderId,
        riderName: riderId,
        branchOrCity: info.city,
        latestDate: info.latest,
        reasonType: 'error_codes',
        reasonLabel: REASON_LABELS.error_codes,
        severity: info.hasCritical ? 'critical' : 'high',
        metricSummary: `${info.count} خطأ (${Array.from(info.codes).slice(0, 2).join(', ')})`,
        existingCase: openCaseByKey.get(`hungerstation:${riderId}:error_codes`),
      });
    }
  }

  // Keeta Facial Recognition failures
  const latestFacialByRider = new Map<string, (typeof dataset.keetaFacialRecognitionDaily)[number]>();
  for (const f of dataset.keetaFacialRecognitionDaily) {
    const prev = latestFacialByRider.get(f.riderId);
    if (!prev || f.date > prev.date) latestFacialByRider.set(f.riderId, f);
  }
  for (const f of latestFacialByRider.values()) {
    const resLower = (f.finalInspectionResult || '').toLowerCase();
    const isFail = resLower.includes('fail') || resLower.includes('reject') || resLower.includes('فشل');
    if (isFail || (f.passRateMtd !== null && f.passRateMtd < settings.minFacialPassRatePct)) {
      candidates.push({
        id: `keeta_${f.riderId}_facial_failure`,
        platform: 'keeta',
        riderId: f.riderId,
        riderName: f.riderId,
        branchOrCity: f.city || f.partnerName || '-',
        latestDate: f.date,
        reasonType: 'facial_failure',
        reasonLabel: REASON_LABELS.facial_failure,
        severity: isFail ? 'critical' : 'high',
        metricSummary: `${f.finalInspectionResult || 'تدني النسبة'} · MTD: ${f.passRateMtd !== null ? `${f.passRateMtd}%` : '-'}`,
        existingCase: openCaseByKey.get(`keeta:${f.riderId}:facial_failure`),
      });
    }
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  return candidates.sort((a, b) =>
    a.severity !== b.severity ? rank[a.severity] - rank[b.severity] : b.latestDate.localeCompare(a.latestDate)
  );
}
