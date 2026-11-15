import assert from 'node:assert/strict';
import {
  scopeDatasetToPlatform,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../src/lib/fleetAnalytics';
import {
  buildInterventionQueue,
  computePeriodComparisons,
  computeRiderPerformanceScore,
  detectOperationalAnomalies,
} from '../src/lib/smartAnalytics';
import type {
  ErrorCodeDictionaryEntry,
  HungerDailyRecord,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  OperationalCase,
  OperationalSettings,
  RiderIdentityMapping,
} from '../src/types/fleet';

const baseSettings: OperationalSettings = {
  settingsId: 'default',
  minDailyWorkingHours: 8,
  minDailyOrders: 12,
  maxOverdueRatePct: 8,
  maxCancellationRatePct: 5,
  minAcceptanceRatePct: 85,
  minCompletionRatePct: 92,
  minOnTimeRatePct: 88,
  minAttendanceRatePct: 90,
  minFacialPassRatePct: 90,
  minWalletBalance: 0,
  minDeliveryQualityScore: 80,
  errorRepeatRiderThreshold: 2,
  errorSpikeDailyThreshold: 5,
  errorSpikeMultiplierPct: 150,
  errorSpreadRidersThreshold: 5,
  errorBranchConcentrationPct: 40,
  alertOnNewErrorCode: true,
  scoreWeightProductivity: 25,
  scoreWeightHours: 15,
  scoreWeightCommitment: 20,
  scoreWeightQuality: 20,
  scoreWeightAcceptance: 10,
  scoreWeightCancellation: 10,
  minActiveOrdersPerDay: 1,
  minActiveHoursPerDay: 1,
  caseOverdueDays: 3,
  configuredBranches: ['الرياض - الشمال', 'جدة'],
  importMaxFiles: 10,
  importAllowUpdates: true,
  importStrictDates: true,
  createdByUid: 'test_owner',
  allowedUids: ['test_owner'],
};

function makeUnifiedRow(overrides: Partial<UnifiedDailyRow> & { date: string }): UnifiedDailyRow {
  return {
    platform: 'keeta',
    riderId: 'R001',
    riderName: 'مندوب تجريبي',
    month: overrides.date.slice(0, 7),
    city: 'الرياض',
    branch: 'الرياض - الشمال',
    contractName: 'C1',
    supervisor: 'S1',
    vehicleType: 'car',
    completedOrders: 15,
    acceptedOrders: 16,
    rejectedOrders: 0,
    cancelledOrders: 0,
    workingHours: 9,
    validHours: 9,
    attendanceRate: 95,
    acceptanceRate: 95,
    completionRate: 96,
    onTimeRate: 94,
    overdueOrders: 0,
    totalKm: 100,
    payableKm: 95,
    isActive: true,
    ...overrides,
  };
}

// 1. Test computePeriodComparisons completeness & exact delta math
{
  // 1A: 3 days => daily complete, weekly & monthly incomplete
  const rows3Days = [
    makeUnifiedRow({ date: '2026-10-01', completedOrders: 10, workingHours: 8 }),
    makeUnifiedRow({ date: '2026-10-02', completedOrders: 12, workingHours: 9 }),
    makeUnifiedRow({ date: '2026-10-03', completedOrders: 15, workingHours: 10 }),
  ];
  const comp3 = computePeriodComparisons(rows3Days, baseSettings);
  assert.equal(comp3.daily.status, 'complete');
  assert.equal(comp3.daily.ordersDeltaPct, 25); // (15 - 12) / 12 = 25%
  assert.equal(comp3.weekly.status, 'incomplete');
  assert.ok(comp3.weekly.incompleteReason?.includes('فترة مرجعية غير مكتملة'));
  assert.equal(comp3.monthly.status, 'incomplete');

  // 1B: 14 consecutive days => weekly complete with exact math
  const rows14Days: UnifiedDailyRow[] = [];
  for (let d = 1; d <= 14; d++) {
    const dayStr = String(d).padStart(2, '0');
    rows14Days.push(
      makeUnifiedRow({
        date: `2026-10-${dayStr}`,
        completedOrders: d <= 7 ? 10 : 15,
        workingHours: d <= 7 ? 8 : 10,
      })
    );
  }
  const comp14 = computePeriodComparisons(rows14Days, baseSettings);
  assert.equal(comp14.weekly.status, 'complete');
  assert.equal(comp14.weekly.currentDaysCount, 7);
  assert.equal(comp14.weekly.previousDaysCount, 7);
  assert.equal(comp14.weekly.ordersDeltaPct, 50); // (105 - 70) / 70 = 50%
  assert.equal(comp14.weekly.hoursDeltaPct, 25); // (70 - 56) / 56 = 25%
  assert.equal(comp14.monthly.status, 'incomplete');

  // 1C: Two months with >= 15 days each => monthly complete
  const rows2Months: UnifiedDailyRow[] = [];
  for (let d = 1; d <= 16; d++) {
    const dayStr = String(d).padStart(2, '0');
    rows2Months.push(makeUnifiedRow({ date: `2026-09-${dayStr}`, completedOrders: 10, workingHours: 8 }));
    rows2Months.push(makeUnifiedRow({ date: `2026-10-${dayStr}`, completedOrders: 12, workingHours: 8 }));
  }
  const comp2m = computePeriodComparisons(rows2Months, baseSettings);
  assert.equal(comp2m.monthly.status, 'complete');
  assert.equal(comp2m.monthly.ordersDeltaPct, 20); // (192 - 160) / 160 = 20%
}

// 2. Test computeRiderPerformanceScore: normalization & missing platform metrics
{
  // Full Keeta rider meeting/exceeding targets
  const fullRows = [
    makeUnifiedRow({
      platform: 'keeta',
      riderId: 'K100',
      date: '2026-10-10',
      completedOrders: 12, // 100% of minDailyOrders=12
      acceptedOrders: 20,
      cancelledOrders: 0, // 100% cancellation discipline
      workingHours: 8, // 100% of minDailyWorkingHours=8
      attendanceRate: 100,
      acceptanceRate: 100,
      completionRate: 100,
      onTimeRate: 100,
    }),
  ];
  const scoreFull = computeRiderPerformanceScore('keeta', 'K100', fullRows, baseSettings);
  assert.equal(scoreFull.totalScore, 100);
  assert.equal(scoreFull.band, 'ممتاز');
  assert.equal(scoreFull.components.length, 6);

  // Non-100 weights (e.g., 50 + 50 + 0 + 0 + 0 + 0 = 100 vs 20 + 20 = 40 -> 50%/50% effective weights)
  const nonHundredSettings: OperationalSettings = {
    ...baseSettings,
    scoreWeightProductivity: 20,
    scoreWeightHours: 20,
    scoreWeightCommitment: 0,
    scoreWeightQuality: 0,
    scoreWeightAcceptance: 0,
    scoreWeightCancellation: 0,
  };
  const halfRows = [
    makeUnifiedRow({
      date: '2026-10-10',
      completedOrders: 6, // 50% of 12
      workingHours: 8, // 100% of 8
    }),
  ];
  const scoreNorm = computeRiderPerformanceScore('keeta', 'K100', halfRows, nonHundredSettings);
  assert.equal(scoreNorm.totalScore, 75); // (50 * 0.5) + (100 * 0.5) = 75
  assert.equal(scoreNorm.components.length, 2);
  assert.equal(scoreNorm.components[0].effectiveWeightPct, 50);

  // HungerStation with missing attendance, acceptance, quality, and 0 accepted orders -> proportional reweighting on productivity + hours only
  const sparseHsRows = [
    makeUnifiedRow({
      platform: 'hungerstation',
      riderId: 'H0048',
      date: '2026-10-10',
      completedOrders: 12, // subScore 100, weight 25
      workingHours: 4, // subScore 50, weight 15
      acceptedOrders: 0, // cancellation subScore becomes null
      attendanceRate: null,
      acceptanceRate: null,
      completionRate: null,
      onTimeRate: null,
    }),
  ];
  const scoreSparse = computeRiderPerformanceScore('hungerstation', 'H0048', sparseHsRows, baseSettings, null);
  assert.equal(scoreSparse.components.length, 2);
  // 25/(25+15)=62.5% * 100 + 15/40=37.5% * 50 = 62.5 + 18.75 = 81.25 -> 81.3
  assert.ok(scoreSparse.totalScore !== null && Math.abs(scoreSparse.totalScore - 81.3) <= 0.2);
}

// 3. Test detectOperationalAnomalies: sharp drop & 3-day negative trend
{
  const anomalyRows: UnifiedDailyRow[] = [
    makeUnifiedRow({ riderId: 'A1', date: '2026-10-01', completedOrders: 20 }),
    makeUnifiedRow({ riderId: 'A1', date: '2026-10-02', completedOrders: 20 }),
    makeUnifiedRow({ riderId: 'A1', date: '2026-10-03', completedOrders: 18 }),
    makeUnifiedRow({ riderId: 'A1', date: '2026-10-04', completedOrders: 12 }),
    makeUnifiedRow({ riderId: 'A1', date: '2026-10-05', completedOrders: 6 }),
  ];
  // Prior avg (Oct 1-2) = 20; Recent 3 (Oct 3-5) avg = 12 (-40% drop -> warning) AND 18 > 12 > 6 (33% drop? actually (18-6)/18 = 66.7% >= 30% -> negative_trend)
  const anomalies = detectOperationalAnomalies(anomalyRows);
  assert.ok(anomalies.some((a) => a.riderId === 'A1' && a.type === 'productivity_drop'));
  assert.ok(anomalies.some((a) => a.riderId === 'A1' && a.type === 'negative_trend'));
}

// 4. Test buildInterventionQueue: all 7 triggers + existingCase open vs closed matching
{
  const filteredRows: UnifiedDailyRow[] = [
    makeUnifiedRow({
      platform: 'keeta',
      riderId: 'K_ISSUES',
      riderName: 'مندوب متعثر',
      date: '2026-10-14',
      workingHours: 4, // triggers low_hours (< 8)
      completedOrders: 4, // triggers low_orders (< 12)
      attendanceRate: 70, // triggers poor_attendance (< 90)
      acceptedOrders: 20,
      cancelledOrders: 4, // 20% > 5% -> triggers high_rejection_cancel
      rejectedOrders: 5,
      overdueOrders: 2, // 2/4 = 50% > 8% && >= 2 -> triggers repeated_overdue
    }),
  ];

  const hungerDaily: HungerDailyRecord[] = [
    {
      recordKey: 'hs_H_ERR_2026-10-13',
      platform: 'hungerstation',
      riderId: 'H_ERR',
      date: '2026-10-13',
      month: '2026-10',
      city: 'الرياض',
      errorCodes: 'E101',
      shifts: 1,
      plannedWorkingHours: 8,
      actualWorkingHours: 8,
      avgWorkingHoursPerDay: 8,
      attendanceRate: 100,
      breakHours: 0,
      lostHours: 0,
      acceptanceRate: 95,
      contactRate: 95,
      noShows: 0,
      noShowPct: 0,
      notifiedDeliveries: 15,
      completedDeliveries: 14,
      acceptedDeliveries: 14,
      stackedDeliveries: 0,
      declinedDeliveries: 0,
      cancelledDeliveries: 0,
      deductionDeliveries: 0,
      notAcceptedDeliveries: 0,
      manualUndispatched: 0,
      chatResponsePct: 95,
      sourceFile: 'hs.xlsx',
      sourceSheet: 'Hunger-Daily',
      sourceRowNumber: 4,
      importBatchId: 'b1',
      rowChecksum: 'chk0',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
    {
      recordKey: 'hs_H_ERR_2026-10-14',
      platform: 'hungerstation',
      riderId: 'H_ERR',
      date: '2026-10-14',
      month: '2026-10',
      city: 'الرياض',
      errorCodes: 'E101', // 2 events across 2 days -> meets errorRepeatRiderThreshold = 2
      shifts: 1,
      plannedWorkingHours: 8,
      actualWorkingHours: 8,
      avgWorkingHoursPerDay: 8,
      attendanceRate: 100,
      breakHours: 0,
      lostHours: 0,
      acceptanceRate: 95,
      contactRate: 95,
      noShows: 0,
      noShowPct: 0,
      notifiedDeliveries: 15,
      completedDeliveries: 14,
      acceptedDeliveries: 14,
      stackedDeliveries: 0,
      declinedDeliveries: 0,
      cancelledDeliveries: 0,
      deductionDeliveries: 0,
      notAcceptedDeliveries: 0,
      manualUndispatched: 0,
      chatResponsePct: 95,
      sourceFile: 'hs.xlsx',
      sourceSheet: 'Hunger-Daily',
      sourceRowNumber: 5,
      importBatchId: 'b1',
      rowChecksum: 'chk1',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
  ];

  const facialRows: KeetaFacialRecognitionDaily[] = [
    {
      recordKey: 'kf_K_FACE_2026-10-14',
      platform: 'keeta',
      riderId: 'K_FACE',
      date: '2026-10-14',
      month: '2026-10',
      city: 'جدة',
      finalInspectionResult: 'Fail',
      totalDaysTriggeredMtd: 5,
      totalDaysPassedMtd: 2,
      passRateMtd: 40,
      sourceFile: 'keeta.xlsx',
      sourceSheet: 'Facial recognition',
      sourceRowNumber: 8,
      importBatchId: 'b2',
      rowChecksum: 'chk2',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
  ];

  const dataset: FleetDataset = {
    hungerDaily,
    hungerDistanceDaily: [],
    hungerWalletSnapshots: [],
    hungerQualityMonthly: [],
    keetaDashboardDaily: [],
    keetaVdaDaily: [],
    keetaRankSnapshots: [],
    keetaFacialRecognitionDaily: facialRows,
    riderMaster: [],
    riderMappings: [],
  };

  const dict: ErrorCodeDictionaryEntry[] = [];
  const cases: OperationalCase[] = [
    {
      caseId: 'case_open_1',
      riderId: 'K_ISSUES',
      platform: 'keeta',
      issueType: 'low_hours',
      title: 'متابعة ساعات',
      priority: 'medium',
      status: 'in_progress',
      registeredDate: '2026-10-14',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
    {
      caseId: 'case_closed_2',
      riderId: 'K_ISSUES',
      platform: 'keeta',
      issueType: 'low_orders',
      title: 'متابعة طلبات',
      priority: 'high',
      status: 'closed',
      registeredDate: '2026-10-14',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
  ];

  const queue = buildInterventionQueue(dataset, filteredRows, dict, baseSettings, cases);
  const reasonsFound = new Set(queue.map((q) => q.reasonType));
  assert.ok(reasonsFound.has('low_hours'));
  assert.ok(reasonsFound.has('low_orders'));
  assert.ok(reasonsFound.has('poor_attendance'));
  assert.ok(reasonsFound.has('high_rejection_cancel'));
  assert.ok(reasonsFound.has('repeated_overdue'));
  assert.ok(reasonsFound.has('error_codes'));
  assert.ok(reasonsFound.has('facial_failure'));

  const lowHoursCandidate = queue.find((q) => q.reasonType === 'low_hours');
  const lowOrdersCandidate = queue.find((q) => q.reasonType === 'low_orders');
  assert.equal(lowHoursCandidate?.existingCase?.caseId, 'case_open_1');
  assert.equal(lowOrdersCandidate?.existingCase, undefined);

  // 5. Test scopeDatasetToPlatform strict isolation
  const keetaDailyRow: KeetaDashboardDaily = {
    recordKey: 'kd_K100_2026-10-14',
    platform: 'keeta',
    riderId: 'K100',
    date: '2026-10-14',
    month: '2026-10',
    firstName: 'Ahmed',
    lastName: 'Ali',
    fullName: 'Ahmed Ali',
    branch: 'الرياض - الشمال',
    onShift: 'Yes',
    validDay: 'Yes',
    appOnlineTime: 480,
    shiftValidOnlineTime: 460,
    shiftOnlineHours: 8,
    acceptedTasks: 10,
    restaurantArrivals: 10,
    deliveredTasks: 10,
    largeOrderTasksCompleted: 1,
    rejectedTasks: 0,
    rejectedTasksCourier: 0,
    rejectedTasksAuto: 0,
    cancellationRate: 0,
    completionRate: 100,
    onTimeRate: 95,
    largeOrderOnTimeRate: 100,
    avgDeliveryTimeMinutes: 24,
    deliveredOver55Min: 0,
    overdueOrderTasks: 0,
    severelyOverdueOrderTasks: 0,
    sourceFile: 'keeta.xlsx',
    sourceSheet: 'Dashboard',
    sourceRowNumber: 2,
    importBatchId: 'b2',
    rowChecksum: 'chk_kd1',
    createdByUid: 'u1',
    allowedUids: ['u1'],
  };
  const mappings: RiderIdentityMapping[] = [
    {
      mappingId: 'map_hs',
      internalRiderId: 'INT001',
      platform: 'hungerstation',
      platformRiderId: 'H_ERR',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
    {
      mappingId: 'map_kt',
      internalRiderId: 'INT001',
      platform: 'keeta',
      platformRiderId: 'K100',
      createdByUid: 'u1',
      allowedUids: ['u1'],
    },
  ];
  const mixedDataset: FleetDataset = {
    ...dataset,
    keetaDashboardDaily: [keetaDailyRow],
    riderMappings: mappings,
  };

  const hsScoped = scopeDatasetToPlatform(mixedDataset, 'hungerstation');
  assert.equal(hsScoped.hungerDaily.length, 2);
  assert.equal(hsScoped.keetaDashboardDaily.length, 0);
  assert.equal(hsScoped.keetaFacialRecognitionDaily.length, 0);
  assert.equal(hsScoped.keetaVdaDaily.length, 0);
  assert.equal(hsScoped.keetaRankSnapshots.length, 0);
  assert.deepEqual(hsScoped.riderMappings.map((m) => m.platform), ['hungerstation']);

  const ktScoped = scopeDatasetToPlatform(mixedDataset, 'keeta');
  assert.equal(ktScoped.hungerDaily.length, 0);
  assert.equal(ktScoped.hungerDistanceDaily.length, 0);
  assert.equal(ktScoped.hungerWalletSnapshots.length, 0);
  assert.equal(ktScoped.hungerQualityMonthly.length, 0);
  assert.equal(ktScoped.keetaDashboardDaily.length, 1);
  assert.equal(ktScoped.keetaFacialRecognitionDaily.length, 1);
  assert.deepEqual(ktScoped.riderMappings.map((m) => m.platform), ['keeta']);

  const globalScoped = scopeDatasetToPlatform(mixedDataset, 'global');
  assert.equal(globalScoped.hungerDaily.length, 2);
  assert.equal(globalScoped.keetaDashboardDaily.length, 1);
  assert.equal(globalScoped.riderMappings.length, 2);
}

console.log('✅ Enterprise analytics verification passed (period comparisons, weighted scoring, anomaly detection, 7-trigger intervention queue, platform isolation).');
