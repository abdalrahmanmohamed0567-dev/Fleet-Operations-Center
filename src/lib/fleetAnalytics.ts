import type {
  AlertItem,
  FilterState,
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  HungerQualityMonthly,
  HungerWalletSnapshot,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  OperationalSettings,
  Platform,
  RiderIdentityMapping,
  RiderMaster,
} from '../types/fleet';

export interface FleetDataset {
  hungerDaily: HungerDailyRecord[];
  hungerDistanceDaily: HungerDistanceDailyRecord[];
  hungerWalletSnapshots: HungerWalletSnapshot[];
  hungerQualityMonthly: HungerQualityMonthly[];
  keetaDashboardDaily: KeetaDashboardDaily[];
  keetaVdaDaily: KeetaVdaDaily[];
  keetaRankSnapshots: KeetaRankSnapshot[];
  keetaFacialRecognitionDaily: KeetaFacialRecognitionDaily[];
  riderMaster: RiderMaster[];
  riderMappings: RiderIdentityMapping[];
}

export function fmtNum(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'غير متاح';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'غير متاح';
  return `${val.toFixed(1)}%`;
}

export function fmtHours(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'غير متاح';
  return `${val.toFixed(1)} س`;
}

export function fmtKm(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'غير متاح';
  return `${val.toFixed(1)} كم`;
}

export function fmtCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'غير متاح';
  return `${val.toFixed(2)} ر.س`;
}

export interface UnifiedDailyRow {
  platform: Platform;
  riderId: string;
  riderName: string;
  date: string;
  month: string;
  city: string;
  branch: string;
  contractName: string;
  supervisor: string;
  vehicleType: string;
  completedOrders: number | null;
  acceptedOrders: number | null;
  rejectedOrders: number | null;
  cancelledOrders: number | null;
  workingHours: number | null;
  validHours: number | null;
  attendanceRate: number | null;
  acceptanceRate: number | null;
  completionRate: number | null;
  onTimeRate: number | null;
  overdueOrders: number | null;
  totalKm: number | null;
  payableKm: number | null;
  isActive: boolean;
}

export function buildUnifiedDailyRows(dataset: FleetDataset): UnifiedDailyRow[] {
  const distLookup = new Map<string, HungerDistanceDailyRecord>();
  for (const d of dataset.hungerDistanceDaily) {
    distLookup.set(`${d.riderId}:${d.date}`, d);
  }

  const vdaLookup = new Map<string, KeetaVdaDaily>();
  for (const v of dataset.keetaVdaDaily) {
    vdaLookup.set(`${v.riderId}:${v.date}`, v);
  }

  const rows: UnifiedDailyRow[] = [];

  for (const h of dataset.hungerDaily) {
    const dist = distLookup.get(`${h.riderId}:${h.date}`);
    const completed = h.completedDeliveries;
    const accepted = h.acceptedDeliveries;
    const rejected =
      h.declinedDeliveries !== null || h.notAcceptedDeliveries !== null
        ? (h.declinedDeliveries ?? 0) + (h.notAcceptedDeliveries ?? 0)
        : null;
    const compRate =
      completed !== null && accepted !== null && accepted > 0
        ? Number(((completed / accepted) * 100).toFixed(2))
        : null;

    rows.push({
      platform: 'hungerstation',
      riderId: h.riderId,
      riderName: h.riderId,
      date: h.date,
      month: h.month,
      city: h.city || '',
      branch: '',
      contractName: h.contractName || '',
      supervisor: '',
      vehicleType: h.vehicleName || '',
      completedOrders: completed,
      acceptedOrders: accepted,
      rejectedOrders: rejected,
      cancelledOrders: h.cancelledDeliveries,
      workingHours: h.actualWorkingHours,
      validHours: h.plannedWorkingHours,
      attendanceRate: h.attendanceRate,
      acceptanceRate: h.acceptanceRate,
      completionRate: compRate,
      onTimeRate: null, // Not in Hunger-Daily (only in monthly Delivery Quality Segmentation)
      overdueOrders: null,
      totalKm: dist ? dist.totalKm : null,
      payableKm: dist ? dist.payableKm : null,
      isActive: (completed ?? 0) > 0 || (h.actualWorkingHours ?? 0) > 0,
    });
  }

  for (const k of dataset.keetaDashboardDaily) {
    const vda = vdaLookup.get(`${k.riderId}:${k.date}`);
    const acc = k.acceptedTasks;
    const rej = k.rejectedTasks;
    const accRate =
      acc !== null && rej !== null && acc + rej > 0
        ? Number(((acc / (acc + rej)) * 100).toFixed(2))
        : null;
    const onShiftFlag = (k.onShift || '').trim().toLowerCase();
    const attRate =
      onShiftFlag === ''
        ? null
        : onShiftFlag === 'yes' || onShiftFlag === '1' || onShiftFlag === 'true'
          ? 100
          : 0;
    const cancelledEst =
      k.cancellationRate !== null && acc !== null
        ? Math.round((k.cancellationRate / 100) * acc)
        : null;

    rows.push({
      platform: 'keeta',
      riderId: k.riderId,
      riderName: k.fullName || k.riderId,
      date: k.date,
      month: k.month,
      city: k.headquarters || '',
      branch: k.branch || '',
      contractName: k.courierType || '',
      supervisor: k.supervisor || '',
      vehicleType: k.vehicleType || vda?.vehicleType || '',
      completedOrders: k.deliveredTasks,
      acceptedOrders: k.acceptedTasks,
      rejectedOrders: k.rejectedTasks,
      cancelledOrders: cancelledEst,
      workingHours: k.shiftOnlineHours,
      validHours: k.shiftValidOnlineTime,
      attendanceRate: attRate,
      acceptanceRate: accRate,
      completionRate: k.completionRate,
      onTimeRate: k.onTimeRate,
      overdueOrders: k.overdueOrderTasks,
      totalKm: vda ? vda.totalDeliveryDistance : null,
      payableKm: vda ? vda.payableDistance : null,
      isActive: (k.deliveredTasks ?? 0) > 0 || (k.shiftOnlineHours ?? 0) > 0,
    });
  }

  return rows;
}

export function filterUnifiedRows(rows: UnifiedDailyRow[], filters: FilterState): UnifiedDailyRow[] {
  return rows.filter((r) => {
    if (filters.platform !== 'all' && r.platform !== filters.platform) return false;
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.city && r.city !== filters.city) return false;
    if (filters.branch && r.branch !== filters.branch) return false;
    if (filters.contract && r.contractName !== filters.contract) return false;
    if (filters.supervisor && r.supervisor !== filters.supervisor) return false;
    if (filters.vehicleType && r.vehicleType !== filters.vehicleType) return false;
    if (filters.riderId && !r.riderId.includes(filters.riderId.trim()) && !r.riderName.toLowerCase().includes(filters.riderId.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
}

export function extractFilterOptions(rows: UnifiedDailyRow[]) {
  const dates = new Set<string>();
  const months = new Set<string>();
  const cities = new Set<string>();
  const branches = new Set<string>();
  const contracts = new Set<string>();
  const supervisors = new Set<string>();
  const vehicles = new Set<string>();

  for (const r of rows) {
    if (r.date) dates.add(r.date);
    if (r.month) months.add(r.month);
    if (r.city) cities.add(r.city);
    if (r.branch) branches.add(r.branch);
    if (r.contractName) contracts.add(r.contractName);
    if (r.supervisor) supervisors.add(r.supervisor);
    if (r.vehicleType) vehicles.add(r.vehicleType);
  }

  return {
    dates: Array.from(dates).sort().reverse(),
    months: Array.from(months).sort().reverse(),
    cities: Array.from(cities).sort(),
    branches: Array.from(branches).sort(),
    contracts: Array.from(contracts).sort(),
    supervisors: Array.from(supervisors).sort(),
    vehicles: Array.from(vehicles).sort(),
  };
}

export interface OverviewMetrics {
  totalRiders: number;
  activeRiders: number;
  completedOrders: number;
  workingHours: number;
  avgOrdersPerActiveRider: number | null;
  avgHoursPerRider: number | null;
  attendanceRate: number | null;
  acceptanceRate: number | null;
  completionRate: number | null;
  onTimeRate: number | null;
  overdueOrders: number;
  totalKm: number;
  payableKm: number;
  lowPerformanceRidersCount: number;
}

function avgOfNonNull(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
}

function weightedPctOfRows(
  pairs: Array<{ rate: number | null; weight: number | null }>
): number | null {
  let wSum = 0;
  let wTotal = 0;
  for (const p of pairs) {
    if (p.rate === null || Number.isNaN(p.rate)) continue;
    if (p.weight !== null && p.weight > 0) {
      wSum += p.rate * p.weight;
      wTotal += p.weight;
    }
  }
  if (wTotal > 0) return Number((wSum / wTotal).toFixed(2));
  return avgOfNonNull(pairs.map((p) => p.rate));
}

export function computeOverviewMetrics(
  rows: UnifiedDailyRow[],
  settings: OperationalSettings
): OverviewMetrics {
  const uniqueRiders = new Set(rows.map((r) => `${r.platform}:${r.riderId}`));
  const activeRiderKeys = new Set(rows.filter((r) => r.isActive).map((r) => `${r.platform}:${r.riderId}`));

  const completedOrders = rows.reduce((s, r) => s + (r.completedOrders ?? 0), 0);
  const workingHours = rows.reduce((s, r) => s + (r.workingHours ?? 0), 0);
  const overdueOrders = rows.reduce((s, r) => s + (r.overdueOrders ?? 0), 0);
  const totalKm = rows.reduce((s, r) => s + (r.totalKm ?? 0), 0);
  const payableKm = rows.reduce((s, r) => s + (r.payableKm ?? 0), 0);

  const totalAccepted = rows.reduce((s, r) => s + (r.acceptedOrders ?? 0), 0);
  const totalRejected = rows.reduce((s, r) => s + (r.rejectedOrders ?? 0), 0);
  const hasCountsForAcceptance = rows.some((r) => r.acceptedOrders !== null && r.rejectedOrders !== null);
  const acceptanceRate =
    hasCountsForAcceptance && totalAccepted + totalRejected > 0
      ? Number(((totalAccepted / (totalAccepted + totalRejected)) * 100).toFixed(2))
      : avgOfNonNull(rows.map((r) => r.acceptanceRate));

  const completionRate = weightedPctOfRows(
    rows.map((r) => ({ rate: r.completionRate, weight: r.acceptedOrders }))
  );
  const onTimeRate = weightedPctOfRows(
    rows.map((r) => ({ rate: r.onTimeRate, weight: r.completedOrders }))
  );

  // Per-rider performance check against configured settings
  const byRider = new Map<string, UnifiedDailyRow[]>();
  for (const r of rows) {
    const key = `${r.platform}:${r.riderId}`;
    const arr = byRider.get(key) || [];
    arr.push(r);
    byRider.set(key, arr);
  }

  let lowPerf = 0;
  for (const rRows of byRider.values()) {
    const avgOrders = avgOfNonNull(rRows.map((x) => x.completedOrders));
    const avgHrs = avgOfNonNull(rRows.map((x) => x.workingHours));
    const avgAcc = avgOfNonNull(rRows.map((x) => x.acceptanceRate));
    const avgComp = avgOfNonNull(rRows.map((x) => x.completionRate));
    const avgOnTime = avgOfNonNull(rRows.map((x) => x.onTimeRate));

    if (
      (avgOrders !== null && avgOrders < settings.minDailyOrders) ||
      (avgHrs !== null && avgHrs < settings.minDailyWorkingHours) ||
      (avgAcc !== null && avgAcc < settings.minAcceptanceRatePct) ||
      (avgComp !== null && avgComp < settings.minCompletionRatePct) ||
      (avgOnTime !== null && avgOnTime < settings.minOnTimeRatePct)
    ) {
      lowPerf++;
    }
  }

  return {
    totalRiders: uniqueRiders.size,
    activeRiders: activeRiderKeys.size,
    completedOrders,
    workingHours: Number(workingHours.toFixed(1)),
    avgOrdersPerActiveRider:
      activeRiderKeys.size > 0 ? Number((completedOrders / activeRiderKeys.size).toFixed(1)) : null,
    avgHoursPerRider:
      uniqueRiders.size > 0 ? Number((workingHours / uniqueRiders.size).toFixed(1)) : null,
    attendanceRate: avgOfNonNull(rows.map((r) => r.attendanceRate)),
    acceptanceRate,
    completionRate,
    onTimeRate,
    overdueOrders,
    totalKm: Number(totalKm.toFixed(1)),
    payableKm: Number(payableKm.toFixed(1)),
    lowPerformanceRidersCount: lowPerf,
  };
}

export function generateOperationalAlerts(
  dataset: FleetDataset,
  settings: OperationalSettings,
  filters: FilterState
): AlertItem[] {
  const alerts: AlertItem[] = [];

  // 1. HungerStation daily operational alerts
  for (const h of dataset.hungerDaily) {
    if (filters.platform !== 'all' && filters.platform !== 'hungerstation') continue;
    if (filters.date && h.date !== filters.date) continue;
    if (filters.month && h.month !== filters.month) continue;
    if (filters.city && h.city !== filters.city) continue;
    if (filters.contract && h.contractName !== filters.contract) continue;
    if (filters.riderId && !h.riderId.includes(filters.riderId.trim())) continue;

    if (h.actualWorkingHours !== null && h.actualWorkingHours > 0 && h.actualWorkingHours < settings.minDailyWorkingHours) {
      alerts.push({
        id: `hs_hrs_${h.recordKey}`,
        severity: 'warning',
        category: 'ساعات العمل',
        title: 'ساعات عمل منخفضة عن الهدف',
        description: `ساعات العمل الفعلية (${h.actualWorkingHours} س) أقل من الحد المطلوب (${settings.minDailyWorkingHours} س)`,
        platform: 'hungerstation',
        riderId: h.riderId,
        date: h.date,
        metricValue: h.actualWorkingHours,
        thresholdValue: settings.minDailyWorkingHours,
        branchOrCity: h.city,
      });
    }

    if ((h.actualWorkingHours ?? 0) > 0 && (h.completedDeliveries ?? 0) === 0) {
      alerts.push({
        id: `hs_zero_ord_${h.recordKey}`,
        severity: 'critical',
        category: 'نشاط دون طلبات',
        title: 'مندوب متصل دون طلبات مكتملة',
        description: `المندوب سجّل ${h.actualWorkingHours} ساعة عمل بدون أي طلب مكتمل`,
        platform: 'hungerstation',
        riderId: h.riderId,
        date: h.date,
        metricValue: 0,
        thresholdValue: settings.minDailyOrders,
        branchOrCity: h.city,
      });
    } else if (h.completedDeliveries !== null && h.completedDeliveries < settings.minDailyOrders) {
      alerts.push({
        id: `hs_low_ord_${h.recordKey}`,
        severity: 'warning',
        category: 'حجم الطلبات',
        title: 'انخفاض الطلبات عن الهدف اليومي',
        description: `الطلبات المكتملة (${h.completedDeliveries}) أقل من الهدف (${settings.minDailyOrders})`,
        platform: 'hungerstation',
        riderId: h.riderId,
        date: h.date,
        metricValue: h.completedDeliveries,
        thresholdValue: settings.minDailyOrders,
        branchOrCity: h.city,
      });
    }

    if (h.acceptanceRate !== null && h.acceptanceRate < settings.minAcceptanceRatePct) {
      alerts.push({
        id: `hs_acc_${h.recordKey}`,
        severity: 'warning',
        category: 'معدل القبول',
        title: 'انخفاض معدل القبول',
        description: `معدل القبول (${h.acceptanceRate}%) أقل من الحد الأدنى (${settings.minAcceptanceRatePct}%)`,
        platform: 'hungerstation',
        riderId: h.riderId,
        date: h.date,
        metricValue: `${h.acceptanceRate}%`,
        thresholdValue: `${settings.minAcceptanceRatePct}%`,
        branchOrCity: h.city,
      });
    }

    if (h.attendanceRate !== null && h.attendanceRate < settings.minAttendanceRatePct) {
      alerts.push({
        id: `hs_att_${h.recordKey}`,
        severity: 'critical',
        category: 'الحضور والشفتات',
        title: 'عدم التزام بالحضور أو غياب',
        description: `معدل الحضور (${h.attendanceRate}%)، حالات الغياب: ${h.noShows ?? 0}`,
        platform: 'hungerstation',
        riderId: h.riderId,
        date: h.date,
        metricValue: `${h.attendanceRate}%`,
        thresholdValue: `${settings.minAttendanceRatePct}%`,
        branchOrCity: h.city,
      });
    }

    if (h.acceptedDeliveries && h.acceptedDeliveries > 0 && h.cancelledDeliveries !== null) {
      const cancelPct = Number(((h.cancelledDeliveries / h.acceptedDeliveries) * 100).toFixed(1));
      if (cancelPct > settings.maxCancellationRatePct) {
        alerts.push({
          id: `hs_can_${h.recordKey}`,
          severity: 'critical',
          category: 'الإلغاءات',
          title: 'ارتفاع نسبة الإلغاءات',
          description: `نسبة الإلغاء (${cancelPct}%) تتجاوز الحد الأقصى (${settings.maxCancellationRatePct}%)`,
          platform: 'hungerstation',
          riderId: h.riderId,
          date: h.date,
          metricValue: `${cancelPct}%`,
          thresholdValue: `${settings.maxCancellationRatePct}%`,
          branchOrCity: h.city,
        });
      }
    }
  }

  // 2. HungerStation wallet & quality alerts
  for (const w of dataset.hungerWalletSnapshots) {
    if (filters.platform !== 'all' && filters.platform !== 'hungerstation') continue;
    if (filters.riderId && !w.riderId.includes(filters.riderId.trim())) continue;
    if (w.currentWallet < settings.minWalletBalance) {
      alerts.push({
        id: `hs_wal_${w.recordKey}`,
        severity: 'critical',
        category: 'المحفظة المالية',
        title: 'رصيد محفظة سالب أو دون الحد',
        description: `رصيد المحفظة الحالي (${w.currentWallet} ر.س) أقل من الحد المسموح (${settings.minWalletBalance} ر.س)`,
        platform: 'hungerstation',
        riderId: w.riderId,
        date: w.snapshotDate,
        metricValue: w.currentWallet,
        thresholdValue: settings.minWalletBalance,
      });
    }
  }

  for (const q of dataset.hungerQualityMonthly) {
    if (filters.platform !== 'all' && filters.platform !== 'hungerstation') continue;
    if (filters.month && q.month !== filters.month) continue;
    if (filters.riderId && !q.riderId.includes(filters.riderId.trim())) continue;
    if (q.finalDeliveryQualityScore !== null && q.finalDeliveryQualityScore < settings.minDeliveryQualityScore) {
      alerts.push({
        id: `hs_qual_${q.recordKey}`,
        severity: 'warning',
        category: 'جودة التسليم',
        title: 'انخفاض تقييم جودة التسليم',
        description: `النتيجة النهائية (${q.finalDeliveryQualityScore}) أقل من المستهدف (${settings.minDeliveryQualityScore}) — التصنيف: ${q.segment || 'غير مصنف'}`,
        platform: 'hungerstation',
        riderId: q.riderId,
        date: q.month,
        metricValue: q.finalDeliveryQualityScore,
        thresholdValue: settings.minDeliveryQualityScore,
        branchOrCity: q.city,
      });
    }
  }

  // 3. Keeta dashboard & facial alerts
  for (const k of dataset.keetaDashboardDaily) {
    if (filters.platform !== 'all' && filters.platform !== 'keeta') continue;
    if (filters.date && k.date !== filters.date) continue;
    if (filters.month && k.month !== filters.month) continue;
    if (filters.branch && k.branch !== filters.branch) continue;
    if (filters.supervisor && k.supervisor !== filters.supervisor) continue;
    if (filters.riderId && !k.riderId.includes(filters.riderId.trim())) continue;

    if (k.shiftOnlineHours !== null && k.shiftOnlineHours > 0 && k.shiftOnlineHours < settings.minDailyWorkingHours) {
      alerts.push({
        id: `kt_hrs_${k.recordKey}`,
        severity: 'warning',
        category: 'ساعات العمل',
        title: 'ساعات اتصال منخفضة',
        description: `ساعات الشفت (${k.shiftOnlineHours} س) أقل من المستهدف (${settings.minDailyWorkingHours} س)`,
        platform: 'keeta',
        riderId: k.riderId,
        riderName: k.fullName,
        date: k.date,
        metricValue: k.shiftOnlineHours,
        thresholdValue: settings.minDailyWorkingHours,
        branchOrCity: k.branch,
      });
    }

    if ((k.shiftOnlineHours ?? 0) > 0 && (k.deliveredTasks ?? 0) === 0) {
      alerts.push({
        id: `kt_zero_${k.recordKey}`,
        severity: 'critical',
        category: 'نشاط دون طلبات',
        title: 'مندوب متصل دون طلبات مسلمة',
        description: `ساعات الاتصال ${k.shiftOnlineHours} س مع 0 مهام مسلمة`,
        platform: 'keeta',
        riderId: k.riderId,
        riderName: k.fullName,
        date: k.date,
        metricValue: 0,
        thresholdValue: settings.minDailyOrders,
        branchOrCity: k.branch,
      });
    } else if (k.deliveredTasks !== null && k.deliveredTasks < settings.minDailyOrders) {
      alerts.push({
        id: `kt_low_${k.recordKey}`,
        severity: 'warning',
        category: 'حجم الطلبات',
        title: 'انخفاض المهام المسلمة عن الهدف',
        description: `المهام المسلمة (${k.deliveredTasks}) أقل من الهدف (${settings.minDailyOrders})`,
        platform: 'keeta',
        riderId: k.riderId,
        riderName: k.fullName,
        date: k.date,
        metricValue: k.deliveredTasks,
        thresholdValue: settings.minDailyOrders,
        branchOrCity: k.branch,
      });
    }

    if (k.onTimeRate !== null && k.onTimeRate < settings.minOnTimeRatePct) {
      alerts.push({
        id: `kt_late_${k.recordKey}`,
        severity: 'critical',
        category: 'التأخير',
        title: 'انخفاض معدل التسليم في الوقت',
        description: `معدل الالتزام بالوقت (${k.onTimeRate}%) أقل من الحد (${settings.minOnTimeRatePct}%) — متأخرات: ${k.overdueOrderTasks ?? 0}`,
        platform: 'keeta',
        riderId: k.riderId,
        riderName: k.fullName,
        date: k.date,
        metricValue: `${k.onTimeRate}%`,
        thresholdValue: `${settings.minOnTimeRatePct}%`,
        branchOrCity: k.branch,
      });
    }

    if (k.cancellationRate !== null && k.cancellationRate > settings.maxCancellationRatePct) {
      alerts.push({
        id: `kt_can_${k.recordKey}`,
        severity: 'critical',
        category: 'الإلغاءات',
        title: 'ارتفاع معدل الإلغاء',
        description: `معدل الإلغاء (${k.cancellationRate}%) أعلى من الحد الأقصى (${settings.maxCancellationRatePct}%)`,
        platform: 'keeta',
        riderId: k.riderId,
        riderName: k.fullName,
        date: k.date,
        metricValue: `${k.cancellationRate}%`,
        thresholdValue: `${settings.maxCancellationRatePct}%`,
        branchOrCity: k.branch,
      });
    }
  }

  for (const f of dataset.keetaFacialRecognitionDaily) {
    if (filters.platform !== 'all' && filters.platform !== 'keeta') continue;
    if (filters.date && f.date !== filters.date) continue;
    if (filters.month && f.month !== filters.month) continue;
    if (filters.riderId && !f.riderId.includes(filters.riderId.trim())) continue;

    const resLower = (f.finalInspectionResult || '').toLowerCase();
    const failed = resLower.includes('fail') || resLower.includes('reject') || resLower.includes('فشل');
    if (failed || (f.passRateMtd !== null && f.passRateMtd < settings.minFacialPassRatePct)) {
      alerts.push({
        id: `kt_face_${f.recordKey}`,
        severity: 'critical',
        category: 'التحقق من الهوية',
        title: failed ? 'نتيجة فاشلة في التحقق من الهوية' : 'انخفاض نسبة اجتياز التحقق من الهوية',
        description: `النتيجة: ${f.finalInspectionResult || 'غير متاح'} | نسبة الاجتياز MTD: ${f.passRateMtd !== null ? `${f.passRateMtd}%` : 'غير متاح'}`,
        platform: 'keeta',
        riderId: f.riderId,
        date: f.date,
        metricValue: f.finalInspectionResult || `${f.passRateMtd}%`,
        thresholdValue: `${settings.minFacialPassRatePct}%`,
        branchOrCity: f.city,
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.date.localeCompare(a.date);
  });
}

export function scopeDatasetToPlatform(
  dataset: FleetDataset,
  scope: 'hungerstation' | 'keeta' | 'global'
): FleetDataset {
  if (scope === 'global') {
    return dataset;
  }
  if (scope === 'hungerstation') {
    return {
      hungerDaily: dataset.hungerDaily,
      hungerDistanceDaily: dataset.hungerDistanceDaily,
      hungerWalletSnapshots: dataset.hungerWalletSnapshots,
      hungerQualityMonthly: dataset.hungerQualityMonthly,
      keetaDashboardDaily: [],
      keetaVdaDaily: [],
      keetaRankSnapshots: [],
      keetaFacialRecognitionDaily: [],
      riderMaster: dataset.riderMaster,
      riderMappings: dataset.riderMappings.filter((m) => m.platform === 'hungerstation'),
    };
  }
  return {
    hungerDaily: [],
    hungerDistanceDaily: [],
    hungerWalletSnapshots: [],
    hungerQualityMonthly: [],
    keetaDashboardDaily: dataset.keetaDashboardDaily,
    keetaVdaDaily: dataset.keetaVdaDaily,
    keetaRankSnapshots: dataset.keetaRankSnapshots,
    keetaFacialRecognitionDaily: dataset.keetaFacialRecognitionDaily,
    riderMaster: dataset.riderMaster,
    riderMappings: dataset.riderMappings.filter((m) => m.platform === 'keeta'),
  };
}
