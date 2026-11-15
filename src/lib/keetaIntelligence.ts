import type {
  AlertItem,
  FilterState,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  OperationalSettings,
} from '../types/fleet';
import type { FleetDataset } from './fleetAnalytics';

export interface KeetaKpiDocEntry {
  id: string;
  sheet: 'Dashboard' | 'VDA' | 'RankPlanProcess' | 'FacialRecognitionDataReport';
  titleAr: string;
  exactColumns: string[];
  formulaAr: string;
  aggregationRule: string;
  nullPolicy: string;
}

export const KEETA_KPI_DICTIONARY: KeetaKpiDocEntry[] = [
  {
    id: 'kt_delivered',
    sheet: 'Dashboard',
    titleAr: 'المهام المسلمة (Delivered Tasks)',
    exactColumns: ['Task Volumes_Delivered Tasks'],
    formulaAr: 'SUM(deliveredTasks)',
    aggregationRule: 'جمع عددي للسجلات غير الفارغة فقط',
    nullPolicy: 'القيم الفارغة أو "-" تبقى null ولا تُعد 0',
  },
  {
    id: 'kt_acceptance_rate',
    sheet: 'Dashboard',
    titleAr: 'معدل القبول (Acceptance Rate)',
    exactColumns: ['Task Volumes_Accepted Tasks', 'Task Volumes_Rejected Tasks'],
    formulaAr: 'SUM(acceptedTasks) / (SUM(acceptedTasks) + SUM(rejectedTasks)) × 100',
    aggregationRule: 'مرجح بإجمالي الطلبات المقبولة والمرفوضة (وليس متوسطًا حسابيًا بسيطًا)',
    nullPolicy: 'يظهر "غير متاح" إذا كان المقام يساوي 0',
  },
  {
    id: 'kt_completion_rate',
    sheet: 'Dashboard',
    titleAr: 'معدل الإنجاز (Completion Rate)',
    exactColumns: ['Task Volumes_Order completion rate (non-delivery related)', 'Task Volumes_Accepted Tasks'],
    formulaAr: 'SUM(completionRate × acceptedTasks) / SUM(acceptedTasks)',
    aggregationRule: 'متوسط مرجح بعدد المهام المقبولة (Weighted by Accepted Tasks)',
    nullPolicy: 'تُستبعد السجلات ذات القيم الفارغة من البسط والمقام',
  },
  {
    id: 'kt_ontime_rate',
    sheet: 'Dashboard',
    titleAr: 'معدل الالتزام بالوقت (On-Time Rate D)',
    exactColumns: ['Delivery Experience_On-time Rate (D)', 'Task Volumes_Delivered Tasks'],
    formulaAr: 'SUM(onTimeRate × deliveredTasks) / SUM(deliveredTasks)',
    aggregationRule: 'متوسط مرجح بالمهام المسلمة (Weighted by Delivered Tasks)',
    nullPolicy: 'تُستبعد السجلات ذات القيم الفارغة من المقام',
  },
  {
    id: 'kt_over55_prop',
    sheet: 'Dashboard',
    titleAr: 'نسبة الطلبات المتجاوزة 55 دقيقة (Prop %)',
    exactColumns: ['Delivery Experience_Delivered Orders Prop. (Over 55min)'],
    formulaAr: 'SUM(deliveredOver55MinProp × deliveredTasks) / SUM(deliveredTasks)',
    aggregationRule: 'نسبة مئوية مرجحة بالمهام المسلمة — لا تُجمع أبدًا كعدد طلبات صحيح',
    nullPolicy: 'مستقلة عن عداد Delivered orders over 55min الموجود في شيت VDA',
  },
  {
    id: 'kt_peabdo',
    sheet: 'Dashboard',
    titleAr: 'ساعات PeAbdo (غير موثق رسميًا)',
    exactColumns: ['Shift_PeAbdo Online Hours'],
    formulaAr: 'حفظ القيمة الخام والمدة بالساعات دون افتراض معادلة ربط بالشفتات',
    aggregationRule: 'جمع/عرض تشغيلي مع وسم "تعريف غير موثق رسميًا"',
    nullPolicy: 'يُمنع فرض مساواتها بفترات 12:00-24:00 أو استبدالها بساعات الشفت',
  },
  {
    id: 'kt_vda_online_day',
    sheet: 'VDA',
    titleAr: 'تاريخ التشغيل الفعلي VDA (Online Day)',
    exactColumns: ['Online Day', 'First online date'],
    formulaAr: 'المفتاح اليومي = Online Day (حقل First online date تعريفي فقط)',
    aggregationRule: 'تحليل الشفتات S1..S6 والمسافة الإجمالية مقابل المستحقة (Payable)',
    nullPolicy: 'لا يتم ضرب Should online days × 8 ساعات نهائيًا',
  },
  {
    id: 'kt_rank_snapshot',
    sheet: 'RankPlanProcess',
    titleAr: 'تقييم الرتب والمكافآت التقديرية',
    exactColumns: ['Current estimated level', 'Estimated reward amount', 'Ranking percentile'],
    formulaAr: 'آخر Snapshot لكل Courier ID لمنع مضاعفة المكافآت عبر التواريخ',
    aggregationRule: 'مقارنة تاريخية عند توفر أكثر من Snapshot مع إبقاء الإجمالي على آخر نسخة',
    nullPolicy: 'الصفوف المكررة للعناوين داخل الشيت تُزال تلقائيًا',
  },
  {
    id: 'kt_facial_mtd',
    sheet: 'FacialRecognitionDataReport',
    titleAr: 'التحقق من الهوية بالوجه (MTD vs Daily)',
    exactColumns: ['Final inspection result', 'Total days triggered MTD', 'Pass rate MTD', 'if_triggered_today'],
    formulaAr: 'حساب MTD على آخر يوم متاح لكل مندوب شهريًا + سجل يومي منفصل',
    aggregationRule: 'يُمنع جمع أو متوسط أرقام MTD المتكررة عبر الأيام لنفس المندوب',
    nullPolicy: 'رصد صريح لنسبة اكتمال حقل if_triggered_today عند وروده فارغًا',
  },
];

export interface KeetaCrossSheetLinkage {
  totalUniqueRiders: number;
  dashboardRiderCount: number;
  vdaRiderCount: number;
  rankRiderCount: number;
  facialRiderCount: number;
  inAll4SheetsCount: number;
  inDashboardAndVdaCount: number;
  dashboardOnlyIds: string[];
  vdaNotInDashboardIds: string[];
  rankNotInDashboardIds: string[];
  facialNotInDashboardIds: string[];
  missingVdaForDashboardIds: string[];
  missingRankForDashboardIds: string[];
  missingFacialForDashboardIds: string[];
  nameDiscrepancies: Array<{ riderId: string; dashboardName: string; rankName: string }>;
  rowsWithParsedSlotsCount: number;
}

export function computeKeetaCrossSheetLinkage(dataset: FleetDataset): KeetaCrossSheetLinkage {
  const dashIds = new Set(dataset.keetaDashboardDaily.map((r) => r.riderId));
  const vdaIds = new Set(dataset.keetaVdaDaily.map((r) => r.riderId));
  const rankIds = new Set(dataset.keetaRankSnapshots.map((r) => r.riderId));
  const facialIds = new Set(dataset.keetaFacialRecognitionDaily.map((r) => r.riderId));

  const allIds = new Set([...dashIds, ...vdaIds, ...rankIds, ...facialIds]);
  let inAll4SheetsCount = 0;
  let inDashboardAndVdaCount = 0;
  for (const id of allIds) {
    if (dashIds.has(id) && vdaIds.has(id)) inDashboardAndVdaCount++;
    if (dashIds.has(id) && vdaIds.has(id) && rankIds.has(id) && facialIds.has(id)) inAll4SheetsCount++;
  }

  const dashNames = new Map<string, string>();
  let rowsWithParsedSlotsCount = 0;
  for (const r of dataset.keetaDashboardDaily) {
    if (r.fullName && r.fullName !== r.riderId && !dashNames.has(r.riderId)) {
      dashNames.set(r.riderId, r.fullName.trim());
    }
    if (r.parsedShiftSlots && r.parsedShiftSlots.length > 0) {
      rowsWithParsedSlotsCount++;
    }
  }

  const nameDiscrepancies: Array<{ riderId: string; dashboardName: string; rankName: string }> = [];
  const seenMismatch = new Set<string>();
  const sortedRankForName = [...dataset.keetaRankSnapshots].sort((a, b) =>
    b.snapshotDate.localeCompare(a.snapshotDate)
  );
  for (const s of sortedRankForName) {
    if (!s.name || seenMismatch.has(s.riderId)) continue;
    const dName = dashNames.get(s.riderId);
    if (dName && dName.toLowerCase() !== s.name.trim().toLowerCase()) {
      seenMismatch.add(s.riderId);
      nameDiscrepancies.push({ riderId: s.riderId, dashboardName: dName, rankName: s.name.trim() });
    }
  }

  return {
    totalUniqueRiders: allIds.size,
    dashboardRiderCount: dashIds.size,
    vdaRiderCount: vdaIds.size,
    rankRiderCount: rankIds.size,
    facialRiderCount: facialIds.size,
    inAll4SheetsCount,
    inDashboardAndVdaCount,
    dashboardOnlyIds: Array.from(dashIds).filter((id) => !vdaIds.has(id) && !rankIds.has(id) && !facialIds.has(id)),
    vdaNotInDashboardIds: Array.from(vdaIds).filter((id) => !dashIds.has(id)),
    rankNotInDashboardIds: Array.from(rankIds).filter((id) => !dashIds.has(id)),
    facialNotInDashboardIds: Array.from(facialIds).filter((id) => !dashIds.has(id)),
    missingVdaForDashboardIds: Array.from(dashIds).filter((id) => !vdaIds.has(id)),
    missingRankForDashboardIds: Array.from(dashIds).filter((id) => !rankIds.has(id)),
    missingFacialForDashboardIds: Array.from(dashIds).filter((id) => !facialIds.has(id)),
    nameDiscrepancies,
    rowsWithParsedSlotsCount,
  };
}

export interface KeetaSlotSummary {
  window: string;
  totalRows: number;
  qualifiedCount: number;
  unqualifiedCount: number;
  noShiftCount: number;
  totalHours: number;
}

export interface KeetaDashboardAnalytics {
  rowCount: number;
  uniqueRiders: number;
  activeRiders: number;
  onShiftRows: number;
  validDayRows: number;
  onShiftRate: number | null;
  validDayRate: number | null;
  deliveredTasks: number;
  acceptedTasks: number;
  restaurantArrivals: number;
  largeOrderTasksCompleted: number;
  rejectedTasks: number;
  rejectedCourier: number;
  rejectedAuto: number;
  appOnlineHours: number;
  shiftValidOnlineHours: number;
  shiftOnlineHours: number;
  shiftPeAbdoOnlineHours: number;
  acceptanceRate: number | null;
  completionRate: number | null;
  onTimeRate: number | null;
  largeOrderOnTimeRate: number | null;
  cancellationRate: number | null;
  avgDeliveryTimeMinutes: number | null;
  deliveredOver55MinPropWeighted: number | null;
  overdueOrderTasks: number;
  severelyOverdueOrderTasks: number;
  slotBreakdown: KeetaSlotSummary[];
  branchBreakdown: Array<{
    branch: string;
    riders: number;
    delivered: number;
    rejectedCourier: number;
    onTimeRate: number | null;
    completionRate: number | null;
  }>;
  supervisorBreakdown: Array<{
    supervisor: string;
    riders: number;
    delivered: number;
    onTimeRate: number | null;
    overdue: number;
  }>;
  dailySeries: Array<{
    date: string;
    delivered: number;
    accepted: number;
    rejected: number;
    onTimeRate: number | null;
    completionRate: number | null;
    activeRiders: number;
  }>;
}

export function filterKeetaDashboardRows(
  rows: KeetaDashboardDaily[],
  filters: Pick<FilterState, 'date' | 'month' | 'city' | 'branch' | 'supervisor' | 'vehicleType' | 'riderId'> & { courierType?: string }
): KeetaDashboardDaily[] {
  return rows.filter((r) => {
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.city && (r.headquarters || '') !== filters.city) return false;
    if (filters.branch && (r.branch || '') !== filters.branch) return false;
    if (filters.supervisor && (r.supervisor || '') !== filters.supervisor) return false;
    if (filters.vehicleType && (r.vehicleType || '') !== filters.vehicleType) return false;
    if (filters.courierType && (r.courierType || '') !== filters.courierType) return false;
    if (filters.riderId) {
      const q = filters.riderId.trim().toLowerCase();
      if (!r.riderId.toLowerCase().includes(q) && !(r.fullName || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function isAffirmative(val: string | undefined): boolean {
  const s = (val || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'valid' || s === 'نعم';
}

function computeWeightedPct(
  items: Array<{ rate: number | null | undefined; weight: number | null | undefined }>
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  let fallbackSum = 0;
  let fallbackCount = 0;
  for (const item of items) {
    if (item.rate === null || item.rate === undefined || Number.isNaN(item.rate)) continue;
    fallbackSum += item.rate;
    fallbackCount++;
    if (item.weight !== null && item.weight !== undefined && item.weight > 0) {
      weightedSum += item.rate * item.weight;
      totalWeight += item.weight;
    }
  }
  if (totalWeight > 0) return Number((weightedSum / totalWeight).toFixed(2));
  if (fallbackCount > 0) return Number((fallbackSum / fallbackCount).toFixed(2));
  return null;
}

export function computeKeetaDashboardAnalytics(rows: KeetaDashboardDaily[]): KeetaDashboardAnalytics {
  const uniqueRiders = new Set(rows.map((r) => r.riderId)).size;
  const activeRiders = new Set(rows.filter((r) => (r.deliveredTasks ?? 0) > 0 || (r.shiftOnlineHours ?? 0) > 0).map((r) => r.riderId)).size;

  let onShiftRows = 0;
  let validDayRows = 0;
  let deliveredTasks = 0;
  let acceptedTasks = 0;
  let restaurantArrivals = 0;
  let largeOrderTasksCompleted = 0;
  let rejectedTasks = 0;
  let rejectedCourier = 0;
  let rejectedAuto = 0;
  let appOnlineHours = 0;
  let shiftValidOnlineHours = 0;
  let shiftOnlineHours = 0;
  let shiftPeAbdoOnlineHours = 0;
  let overdueOrderTasks = 0;
  let severelyOverdueOrderTasks = 0;

  const slotMap = new Map<string, KeetaSlotSummary>();
  const branchMap = new Map<string, KeetaDashboardDaily[]>();
  const supMap = new Map<string, KeetaDashboardDaily[]>();
  const dateMap = new Map<string, KeetaDashboardDaily[]>();

  for (const r of rows) {
    if (isAffirmative(r.onShift)) onShiftRows++;
    if (isAffirmative(r.validDay)) validDayRows++;
    deliveredTasks += r.deliveredTasks ?? 0;
    acceptedTasks += r.acceptedTasks ?? 0;
    restaurantArrivals += r.restaurantArrivals ?? 0;
    largeOrderTasksCompleted += r.largeOrderTasksCompleted ?? 0;
    rejectedTasks += r.rejectedTasks ?? 0;
    rejectedCourier += r.rejectedTasksCourier ?? 0;
    rejectedAuto += r.rejectedTasksAuto ?? 0;
    appOnlineHours += r.appOnlineTime ?? 0;
    shiftValidOnlineHours += r.shiftValidOnlineTime ?? 0;
    shiftOnlineHours += r.shiftOnlineHours ?? 0;
    const peAbdoVal =
      r.shiftPeAbdoOnlineHours !== undefined && r.shiftPeAbdoOnlineHours !== null
        ? r.shiftPeAbdoOnlineHours
        : typeof r.rawExtraColumns?.['Shift_PeAbdo Online Hours'] === 'number'
          ? (r.rawExtraColumns['Shift_PeAbdo Online Hours'] as number)
          : 0;
    shiftPeAbdoOnlineHours += peAbdoVal;
    overdueOrderTasks += r.overdueOrderTasks ?? 0;
    severelyOverdueOrderTasks += r.severelyOverdueOrderTasks ?? 0;

    for (const slot of r.parsedShiftSlots || []) {
      const cur = slotMap.get(slot.window) || {
        window: slot.window,
        totalRows: 0,
        qualifiedCount: 0,
        unqualifiedCount: 0,
        noShiftCount: 0,
        totalHours: 0,
      };
      cur.totalRows++;
      if (slot.qualification === 'qualified') cur.qualifiedCount++;
      else if (slot.qualification === 'unqualified') cur.unqualifiedCount++;
      else if (slot.qualification === 'no_shifts') cur.noShiftCount++;
      cur.totalHours = Number((cur.totalHours + (slot.durationHours ?? 0)).toFixed(2));
      slotMap.set(slot.window, cur);
    }

    const br = r.branch || 'غير محدد';
    const bArr = branchMap.get(br) || [];
    bArr.push(r);
    branchMap.set(br, bArr);

    const sup = r.supervisor || 'غير محدد';
    const sArr = supMap.get(sup) || [];
    sArr.push(r);
    supMap.set(sup, sArr);

    const dArr = dateMap.get(r.date) || [];
    dArr.push(r);
    dateMap.set(r.date, dArr);
  }

  const branchBreakdown = Array.from(branchMap.entries())
    .map(([branch, bRows]) => ({
      branch,
      riders: new Set(bRows.map((x) => x.riderId)).size,
      delivered: bRows.reduce((s, x) => s + (x.deliveredTasks ?? 0), 0),
      rejectedCourier: bRows.reduce((s, x) => s + (x.rejectedTasksCourier ?? 0), 0),
      onTimeRate: computeWeightedPct(bRows.map((x) => ({ rate: x.onTimeRate, weight: x.deliveredTasks }))),
      completionRate: computeWeightedPct(bRows.map((x) => ({ rate: x.completionRate, weight: x.acceptedTasks }))),
    }))
    .sort((a, b) => b.delivered - a.delivered);

  const supervisorBreakdown = Array.from(supMap.entries())
    .map(([supervisor, sRows]) => ({
      supervisor,
      riders: new Set(sRows.map((x) => x.riderId)).size,
      delivered: sRows.reduce((s, x) => s + (x.deliveredTasks ?? 0), 0),
      onTimeRate: computeWeightedPct(sRows.map((x) => ({ rate: x.onTimeRate, weight: x.deliveredTasks }))),
      overdue: sRows.reduce((s, x) => s + (x.overdueOrderTasks ?? 0), 0),
    }))
    .sort((a, b) => b.delivered - a.delivered);

  const dailySeries = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dRows]) => ({
      date,
      delivered: dRows.reduce((s, x) => s + (x.deliveredTasks ?? 0), 0),
      accepted: dRows.reduce((s, x) => s + (x.acceptedTasks ?? 0), 0),
      rejected: dRows.reduce((s, x) => s + (x.rejectedTasks ?? 0), 0),
      onTimeRate: computeWeightedPct(dRows.map((x) => ({ rate: x.onTimeRate, weight: x.deliveredTasks }))),
      completionRate: computeWeightedPct(dRows.map((x) => ({ rate: x.completionRate, weight: x.acceptedTasks }))),
      activeRiders: new Set(dRows.filter((x) => (x.deliveredTasks ?? 0) > 0 || (x.shiftOnlineHours ?? 0) > 0).map((x) => x.riderId)).size,
    }));

  return {
    rowCount: rows.length,
    uniqueRiders,
    activeRiders,
    onShiftRows,
    validDayRows,
    onShiftRate: rows.length > 0 ? Number(((onShiftRows / rows.length) * 100).toFixed(2)) : null,
    validDayRate: rows.length > 0 ? Number(((validDayRows / rows.length) * 100).toFixed(2)) : null,
    deliveredTasks,
    acceptedTasks,
    restaurantArrivals,
    largeOrderTasksCompleted,
    rejectedTasks,
    rejectedCourier,
    rejectedAuto,
    appOnlineHours: Number(appOnlineHours.toFixed(1)),
    shiftValidOnlineHours: Number(shiftValidOnlineHours.toFixed(1)),
    shiftOnlineHours: Number(shiftOnlineHours.toFixed(1)),
    shiftPeAbdoOnlineHours: Number(shiftPeAbdoOnlineHours.toFixed(1)),
    acceptanceRate: acceptedTasks + rejectedTasks > 0 ? Number(((acceptedTasks / (acceptedTasks + rejectedTasks)) * 100).toFixed(2)) : null,
    completionRate: computeWeightedPct(rows.map((r) => ({ rate: r.completionRate, weight: r.acceptedTasks }))),
    onTimeRate: computeWeightedPct(rows.map((r) => ({ rate: r.onTimeRate, weight: r.deliveredTasks }))),
    largeOrderOnTimeRate: computeWeightedPct(rows.map((r) => ({ rate: r.largeOrderOnTimeRate, weight: r.largeOrderTasksCompleted }))),
    cancellationRate: computeWeightedPct(rows.map((r) => ({ rate: r.cancellationRate, weight: r.acceptedTasks }))),
    avgDeliveryTimeMinutes: computeWeightedPct(rows.map((r) => ({ rate: r.avgDeliveryTimeMinutes, weight: r.deliveredTasks }))),
    deliveredOver55MinPropWeighted: computeWeightedPct(rows.map((r) => ({ rate: r.deliveredOver55MinProp, weight: r.deliveredTasks }))),
    overdueOrderTasks,
    severelyOverdueOrderTasks,
    slotBreakdown: Array.from(slotMap.values()).sort((a, b) => a.window.localeCompare(b.window)),
    branchBreakdown,
    supervisorBreakdown,
    dailySeries,
  };
}

export interface KeetaVdaAnalytics {
  rowCount: number;
  uniqueRiders: number;
  newRidersCount: number;
  totalOnlineHours: number;
  totalValidShifts: number;
  totalShouldOnlineDays: number;
  totalDeliveredTasks: number;
  totalAdvanceTasks: number;
  totalAcceptedOrders: number;
  totalOnTimeDTasks: number;
  totalCancellationD: number;
  totalOver55MinCount: number;
  totalDistanceKm: number;
  payableDistanceKm: number;
  avgVdaScore: number | null;
  s1ToS6Matrix: Array<{
    slot: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
    scheduledShifts: number;
    validShifts: number;
    shiftHours: number;
    fulfillmentPct: number | null;
  }>;
  threePlBreakdown: Array<{ threePlName: string; riders: number; delivered: number; payableKm: number }>;
}

export function computeKeetaVdaAnalytics(rows: KeetaVdaDaily[]): KeetaVdaAnalytics {
  const uniqueRiders = new Set(rows.map((r) => r.riderId)).size;
  const newRiderSet = new Set(
    rows
      .filter((r) => {
        const v = (r.ifNewRider || '').trim().toLowerCase();
        return v === 'yes' || v === '1' || v === 'true' || v === 'new';
      })
      .map((r) => r.riderId)
  );

  const slots: Array<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'> = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const slotAcc = new Map<string, { scheduled: number; valid: number; hours: number }>();
  slots.forEach((s) => slotAcc.set(s, { scheduled: 0, valid: 0, hours: 0 }));

  const threePlMap = new Map<string, { riders: Set<string>; delivered: number; payableKm: number }>();

  let totalOnlineHours = 0;
  let totalValidShifts = 0;
  let totalShouldOnlineDays = 0;
  let totalDeliveredTasks = 0;
  let totalAdvanceTasks = 0;
  let totalAcceptedOrders = 0;
  let totalOnTimeDTasks = 0;
  let totalCancellationD = 0;
  let totalOver55MinCount = 0;
  let totalDistanceKm = 0;
  let payableDistanceKm = 0;
  let vdaSum = 0;
  let vdaCount = 0;

  for (const r of rows) {
    totalOnlineHours += r.shiftOnlineHours ?? 0;
    totalValidShifts += r.sumValidShifts ?? 0;
    totalShouldOnlineDays += r.shouldOnlineDays ?? 0;
    totalDeliveredTasks += r.totalDeliveredTasks ?? 0;
    totalAdvanceTasks += r.sumDeliveredAdvanceTasks ?? 0;
    totalAcceptedOrders += r.acceptedOrders ?? 0;
    totalOnTimeDTasks += r.onTimeDTasks ?? 0;
    totalCancellationD += r.cancellationD ?? 0;
    totalOver55MinCount += r.deliveredOver55Min ?? 0;
    totalDistanceKm += r.totalDeliveryDistance ?? 0;
    payableDistanceKm += r.payableDistance ?? 0;
    if (r.vdaScore !== null && r.vdaScore !== undefined) {
      vdaSum += r.vdaScore;
      vdaCount++;
    }

    if (r.shiftsS1ToS6 && r.shiftsS1ToS6.length > 0) {
      for (const entry of r.shiftsS1ToS6) {
        const cur = slotAcc.get(entry.slot)!;
        cur.scheduled += entry.scheduledShifts ?? 0;
        cur.valid += entry.validShifts ?? 0;
        cur.hours += entry.shiftHours ?? 0;
      }
    } else if (r.shiftWindows) {
      for (const slot of slots) {
        const cur = slotAcc.get(slot)!;
        const sched = r.shiftWindows[`Scheduled shifts ${slot}`];
        const valid = r.shiftWindows[`Valid shifts ${slot}`];
        const hrs = r.shiftWindows[`Shift hours ${slot}`];
        if (typeof sched === 'number') cur.scheduled += sched;
        if (typeof valid === 'number') cur.valid += valid;
        if (typeof hrs === 'number') cur.hours += hrs;
      }
    }

    const tp = r.threePlName || r.threePlId || 'غير محدد';
    const curTp = threePlMap.get(tp) || { riders: new Set<string>(), delivered: 0, payableKm: 0 };
    curTp.riders.add(r.riderId);
    curTp.delivered += r.totalDeliveredTasks ?? 0;
    curTp.payableKm += r.payableDistance ?? 0;
    threePlMap.set(tp, curTp);
  }

  return {
    rowCount: rows.length,
    uniqueRiders,
    newRidersCount: newRiderSet.size,
    totalOnlineHours: Number(totalOnlineHours.toFixed(1)),
    totalValidShifts: Number(totalValidShifts.toFixed(1)),
    totalShouldOnlineDays,
    totalDeliveredTasks,
    totalAdvanceTasks,
    totalAcceptedOrders,
    totalOnTimeDTasks,
    totalCancellationD,
    totalOver55MinCount,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    payableDistanceKm: Number(payableDistanceKm.toFixed(1)),
    avgVdaScore: vdaCount > 0 ? Number((vdaSum / vdaCount).toFixed(2)) : null,
    s1ToS6Matrix: slots.map((slot) => {
      const a = slotAcc.get(slot)!;
      return {
        slot,
        scheduledShifts: a.scheduled,
        validShifts: a.valid,
        shiftHours: Number(a.hours.toFixed(1)),
        fulfillmentPct: a.scheduled > 0 ? Number(((a.valid / a.scheduled) * 100).toFixed(1)) : null,
      };
    }),
    threePlBreakdown: Array.from(threePlMap.entries())
      .map(([threePlName, v]) => ({
        threePlName,
        riders: v.riders.size,
        delivered: v.delivered,
        payableKm: Number(v.payableKm.toFixed(1)),
      }))
      .sort((a, b) => b.delivered - a.delivered),
  };
}

export interface KeetaRankAnalytics {
  totalSnapshots: number;
  snapshotDates: string[];
  latestSnapshotDate: string | null;
  uniqueRiders: number;
  latestRows: KeetaRankSnapshot[];
  totalEstimatedRewardLatest: number;
  avgRankingPercentileLatest: number | null;
  avgForcedAssignmentScoreLatest: number | null;
  levelDistribution: Array<{ level: string; count: number }>;
  progression: {
    hasHistory: boolean;
    previousDate: string | null;
    upgradedCount: number;
    downgradedCount: number;
    unchangedCount: number;
  };
}

export function computeKeetaRankAnalytics(snapshots: KeetaRankSnapshot[]): KeetaRankAnalytics {
  const snapshotDates = Array.from(new Set(snapshots.map((s) => s.snapshotDate))).sort().reverse();
  const latestSnapshotDate = snapshotDates[0] || null;
  const latestByRider = new Map<string, KeetaRankSnapshot>();
  const sortedAsc = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  for (const s of sortedAsc) {
    latestByRider.set(s.riderId, s);
  }
  const latestRows = Array.from(latestByRider.values()).sort(
    (a, b) => (b.rankingPercentile ?? -1) - (a.rankingPercentile ?? -1)
  );

  const levelMap = new Map<string, number>();
  let totalReward = 0;
  let pctSum = 0;
  let pctCnt = 0;
  let forcedSum = 0;
  let forcedCnt = 0;

  for (const r of latestRows) {
    const lvl = (r.currentEstimatedLevel || 'غير مصنف').trim();
    levelMap.set(lvl, (levelMap.get(lvl) || 0) + 1);
    totalReward += r.estimatedRewardAmount ?? 0;
    if (r.rankingPercentile !== null) {
      pctSum += r.rankingPercentile;
      pctCnt++;
    }
    if (r.forcedAssignmentScore !== null) {
      forcedSum += r.forcedAssignmentScore;
      forcedCnt++;
    }
  }

  let upgradedCount = 0;
  let downgradedCount = 0;
  let unchangedCount = 0;
  const previousDate = snapshotDates[1] || null;
  if (snapshotDates.length >= 2 && latestSnapshotDate && previousDate) {
    const prevMap = new Map(snapshots.filter((s) => s.snapshotDate === previousDate).map((s) => [s.riderId, s]));
    const curMap = new Map(snapshots.filter((s) => s.snapshotDate === latestSnapshotDate).map((s) => [s.riderId, s]));
    for (const [id, cur] of curMap.entries()) {
      const prev = prevMap.get(id);
      if (!prev) continue;
      const curPct = cur.rankingPercentile ?? 0;
      const prevPct = prev.rankingPercentile ?? 0;
      if (curPct > prevPct + 0.5) upgradedCount++;
      else if (curPct < prevPct - 0.5) downgradedCount++;
      else unchangedCount++;
    }
  }

  return {
    totalSnapshots: snapshots.length,
    snapshotDates,
    latestSnapshotDate,
    uniqueRiders: latestRows.length,
    latestRows,
    totalEstimatedRewardLatest: Number(totalReward.toFixed(2)),
    avgRankingPercentileLatest: pctCnt > 0 ? Number((pctSum / pctCnt).toFixed(2)) : null,
    avgForcedAssignmentScoreLatest: forcedCnt > 0 ? Number((forcedSum / forcedCnt).toFixed(2)) : null,
    levelDistribution: Array.from(levelMap.entries())
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => b.count - a.count),
    progression: {
      hasHistory: snapshotDates.length >= 2,
      previousDate,
      upgradedCount,
      downgradedCount,
      unchangedCount,
    },
  };
}

export interface KeetaFacialAnalytics {
  dailyTotalRows: number;
  uniqueRiders: number;
  latestMtdRows: KeetaFacialRecognitionDaily[];
  latestMtdDate: string | null;
  mtdAvgPassRate: number | null;
  mtdTotalTriggeredDays: number;
  mtdTotalPassedDays: number;
  mtdBelow90RidersCount: number;
  dailyPassCount: number;
  dailyFailCount: number;
  dailyOtherCount: number;
  triggeredTodayPopulatedCount: number;
  triggeredTodayNullCount: number;
  triggeredTodayTrueCount: number;
  triggeredFillRatePct: number | null;
}

export function computeKeetaFacialAnalytics(rows: KeetaFacialRecognitionDaily[]): KeetaFacialAnalytics {
  const latestByRiderMonth = new Map<string, KeetaFacialRecognitionDaily>();
  const sortedAsc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let latestMtdDate: string | null = null;

  let dailyPassCount = 0;
  let dailyFailCount = 0;
  let dailyOtherCount = 0;
  let triggeredTodayPopulatedCount = 0;
  let triggeredTodayNullCount = 0;
  let triggeredTodayTrueCount = 0;

  for (const r of sortedAsc) {
    if (!latestMtdDate || r.date > latestMtdDate) latestMtdDate = r.date;
    latestByRiderMonth.set(`${r.riderId}:${r.month}`, r);

    const res = (r.finalInspectionResult || '').trim().toLowerCase();
    if (res.includes('fail') || res.includes('reject') || res.includes('فشل')) dailyFailCount++;
    else if (res.includes('pass') || res.includes('نجح')) dailyPassCount++;
    else dailyOtherCount++;

    if (r.ifTriggeredToday === null || r.ifTriggeredToday === undefined || r.ifTriggeredToday === '') {
      triggeredTodayNullCount++;
    } else {
      triggeredTodayPopulatedCount++;
      if (r.ifTriggeredToday === true || String(r.ifTriggeredToday).toLowerCase() === 'yes') {
        triggeredTodayTrueCount++;
      }
    }
  }

  // Deduplicate strictly to the latest month record per rider (never sum repeated MTD snapshots across dates)
  const latestPerRider = new Map<string, KeetaFacialRecognitionDaily>();
  for (const r of latestByRiderMonth.values()) {
    const prev = latestPerRider.get(r.riderId);
    if (!prev || r.date > prev.date) latestPerRider.set(r.riderId, r);
  }
  const latestMtdRows = Array.from(latestPerRider.values()).sort((a, b) => (a.passRateMtd ?? 999) - (b.passRateMtd ?? 999));

  let mtdPassSum = 0;
  let mtdPassCnt = 0;
  let mtdTotalTriggeredDays = 0;
  let mtdTotalPassedDays = 0;
  let mtdBelow90RidersCount = 0;

  for (const r of latestMtdRows) {
    if (r.passRateMtd !== null) {
      mtdPassSum += r.passRateMtd;
      mtdPassCnt++;
      if (r.passRateMtd < 90) mtdBelow90RidersCount++;
    }
    mtdTotalTriggeredDays += r.totalDaysTriggeredMtd ?? 0;
    mtdTotalPassedDays += r.totalDaysPassedMtd ?? 0;
  }

  return {
    dailyTotalRows: rows.length,
    uniqueRiders: latestMtdRows.length,
    latestMtdRows,
    latestMtdDate,
    mtdAvgPassRate: mtdPassCnt > 0 ? Number((mtdPassSum / mtdPassCnt).toFixed(2)) : null,
    mtdTotalTriggeredDays,
    mtdTotalPassedDays,
    mtdBelow90RidersCount,
    dailyPassCount,
    dailyFailCount,
    dailyOtherCount,
    triggeredTodayPopulatedCount,
    triggeredTodayNullCount,
    triggeredTodayTrueCount,
    triggeredFillRatePct: rows.length > 0 ? Number(((triggeredTodayPopulatedCount / rows.length) * 100).toFixed(1)) : null,
  };
}

export function generateKeetaIntelligenceAlerts(
  dataset: FleetDataset,
  settings: OperationalSettings,
  filters: FilterState
): AlertItem[] {
  const alerts: AlertItem[] = [];
  const dashFiltered = filterKeetaDashboardRows(dataset.keetaDashboardDaily, filters);

  for (const r of dashFiltered) {
    if ((r.rejectedTasksCourier ?? 0) >= 3) {
      alerts.push({
        id: `kt_rej_c_${r.recordKey}`,
        severity: (r.rejectedTasksCourier ?? 0) >= 6 ? 'critical' : 'warning',
        category: 'رفض المندوب (Keeta)',
        title: `رفض طلبات متكرر من المندوب (${r.rejectedTasksCourier})`,
        description: `رفض المندوب ${r.rejectedTasksCourier} طلبًا مقابل ${r.rejectedTasksAuto ?? 0} تلقائيًا في فرع ${r.branch || '-'}`,
        platform: 'keeta',
        riderId: r.riderId,
        riderName: r.fullName,
        date: r.date,
        metricValue: r.rejectedTasksCourier ?? 0,
        thresholdValue: 3,
        branchOrCity: r.branch,
      });
    }
    if ((r.severelyOverdueOrderTasks ?? 0) > 0) {
      alerts.push({
        id: `kt_sev_od_${r.recordKey}`,
        severity: 'critical',
        category: 'تأخير حاد (Keeta)',
        title: `طلبات متأخرة بشدة (${r.severelyOverdueOrderTasks})`,
        description: `سُجّل ${r.severelyOverdueOrderTasks} تأخير شديد ونسبة >55د: ${r.deliveredOver55MinProp !== null && r.deliveredOver55MinProp !== undefined ? `${r.deliveredOver55MinProp}%` : 'غير متاح'}`,
        platform: 'keeta',
        riderId: r.riderId,
        riderName: r.fullName,
        date: r.date,
        metricValue: r.severelyOverdueOrderTasks ?? 0,
        thresholdValue: 0,
        branchOrCity: r.branch,
      });
    }
  }

  const rankAnalytics = computeKeetaRankAnalytics(dataset.keetaRankSnapshots);
  for (const s of rankAnalytics.latestRows) {
    if (filters.riderId && !s.riderId.includes(filters.riderId.trim())) continue;
    if (s.didntTapDropOffTooEarly !== null && s.didntTapDropOffTooEarly < 95) {
      alerts.push({
        id: `kt_dropoff_${s.recordKey}`,
        severity: s.didntTapDropOffTooEarly < 90 ? 'critical' : 'warning',
        category: 'انضباط التسليم (RankPlan)',
        title: 'مؤشر عدم الإغلاق المبكر منخفض',
        description: `نسبة "Didn't tap drop-off too early" = ${s.didntTapDropOffTooEarly}% (المستوى ${s.currentEstimatedLevel || '-'})`,
        platform: 'keeta',
        riderId: s.riderId,
        riderName: s.name,
        date: s.snapshotDate,
        metricValue: `${s.didntTapDropOffTooEarly}%`,
        thresholdValue: '95%',
      });
    }
  }

  const facialAnalytics = computeKeetaFacialAnalytics(
    dataset.keetaFacialRecognitionDaily.filter((f) => {
      if (filters.date && f.date !== filters.date) return false;
      if (filters.month && f.month !== filters.month) return false;
      if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) return false;
      return true;
    })
  );
  for (const f of facialAnalytics.latestMtdRows) {
    const resLower = (f.finalInspectionResult || '').toLowerCase();
    const isFail = resLower.includes('fail') || resLower.includes('reject') || resLower.includes('فشل');
    if (isFail || (f.passRateMtd !== null && f.passRateMtd < settings.minFacialPassRatePct)) {
      alerts.push({
        id: `kt_face_mtd_${f.recordKey}`,
        severity: 'critical',
        category: 'التحقق من الهوية MTD',
        title: isFail ? 'رسوب فحص الوجه' : `نسبة اجتياز MTD (${f.passRateMtd}%) دون المستهدف`,
        description: `النتيجة: ${f.finalInspectionResult || '-'} | اجتاز ${f.totalDaysPassedMtd ?? '-'} من ${f.totalDaysTriggeredMtd ?? '-'} يوم MTD`,
        platform: 'keeta',
        riderId: f.riderId,
        date: f.date,
        metricValue: `${f.passRateMtd ?? '-'}%`,
        thresholdValue: `${settings.minFacialPassRatePct}%`,
        branchOrCity: f.city || f.partnerName,
      });
    }
  }

  return alerts.sort((a, b) => (a.severity !== b.severity ? (a.severity === 'critical' ? -1 : 1) : b.date.localeCompare(a.date)));
}
