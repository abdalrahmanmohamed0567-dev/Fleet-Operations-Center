import {
  inspectErrorCodeDatasetFormat,
  makeRiderErrorCaseId,
  parseRawErrorCodes,
  type ErrorDelimiterProfile,
} from '../shared/errorCodeParser';
import type {
  AlertItem,
  ErrorCodeDictionaryEntry,
  ErrorCodeSeverity,
  FilterState,
  HungerDailyRecord,
  RiderErrorCase,
  RiderErrorCaseStatus,
  OperationalSettings,
} from '../types/fleet';
import type { FleetDataset } from './fleetAnalytics';

export interface HungerErrorEvent {
  eventKey: string;
  caseId: string;
  recordKey: string;
  riderId: string;
  riderName: string;
  internalRiderId: string;
  date: string;
  month: string;
  city: string;
  branch: string;
  contractName: string;
  vehicleName: string;
  batchNumber: string;
  tgaStatus: string;
  rawCell: string;
  rawCode: string;
  normalizedCode: string;
  codeKey: string;
  dictionaryEntry: ErrorCodeDictionaryEntry | null;
  caseRecord: RiderErrorCase | null;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  // Linked row KPIs for operational correlation
  completedDeliveries: number | null;
  acceptedDeliveries: number | null;
  notifiedDeliveries: number | null;
  cancelledDeliveries: number | null;
  declinedDeliveries: number | null;
  actualWorkingHours: number | null;
  attendanceRate: number | null;
  acceptanceRate: number | null;
}

export interface BreakdownItem {
  name: string;
  count: number;
  sharePct: number;
}

export interface AffectedRiderCodeSummary {
  riderId: string;
  riderName: string;
  internalRiderId: string;
  city: string;
  branch: string;
  occurrences: number;
  dates: string[];
  firstDate: string;
  lastDate: string;
  rawExamples: string[];
  latestCaseStatus: RiderErrorCaseStatus | null;
  latestNote: string;
}

export interface ErrorCodeAggregate {
  codeKey: string;
  normalizedCode: string;
  rawExamples: string[];
  dictionary: ErrorCodeDictionaryEntry | null;
  isVerified: boolean;
  displayTitle: string;
  category: string;
  severity: ErrorCodeSeverity;
  recommendedAction: string;
  occurrenceCount: number;
  affectedRidersCount: number;
  repeatedRidersCount: number;
  repeatSharePct: number;
  firstSeenDate: string;
  lastSeenDate: string;
  activeDaysCount: number;
  trendDirection: 'up' | 'down' | 'stable';
  dailySeries: Array<{ date: string; count: number; riders: number }>;
  cityBreakdown: BreakdownItem[];
  branchBreakdown: BreakdownItem[];
  contractBreakdown: BreakdownItem[];
  vehicleBreakdown: BreakdownItem[];
  affectedRiders: AffectedRiderCodeSummary[];
}

export interface PeriodComparisonSummary {
  hasComparison: boolean;
  mode: 'month_over_month' | 'half_split' | 'insufficient';
  currentLabel: string;
  previousLabel: string;
  currentErrors: number;
  previousErrors: number;
  errorDeltaPct: number | null;
  currentErrorRatePct: number;
  previousErrorRatePct: number;
  rateDeltaPts: number;
}

export interface CohortKpiStats {
  rowCount: number;
  riderCount: number;
  avgCompletedDeliveries: number | null;
  avgAttendanceRate: number | null;
  avgWorkingHours: number | null;
  avgAcceptanceRate: number | null;
  cancellationRatePct: number | null;
  declineRatePct: number | null;
}

export interface PerCodeCorrelationRow {
  codeKey: string;
  normalizedCode: string;
  displayTitle: string;
  severity: ErrorCodeSeverity;
  rowCount: number;
  riderCount: number;
  avgCompletedDeliveries: number | null;
  deltaOrdersVsClean: number | null;
  avgAttendanceRate: number | null;
  deltaAttendanceVsClean: number | null;
  avgWorkingHours: number | null;
  deltaHoursVsClean: number | null;
  avgAcceptanceRate: number | null;
  cancellationRatePct: number | null;
  declineRatePct: number | null;
}

export interface OperationalCorrelationReport {
  withErrors: CohortKpiStats;
  withoutErrors: CohortKpiStats;
  perCode: PerCodeCorrelationRow[];
}

export interface ErrorIntelligenceReport {
  delimiterProfile: ErrorDelimiterProfile;
  totalHungerDailyRows: number;
  affectedRowsCount: number;
  errorRowRatePct: number;
  totalErrorEvents: number;
  distinctCodesCount: number;
  verifiedCodesCount: number;
  unknownCodesCount: number;
  affectedRidersCount: number;
  repeatedRidersTotalCount: number;
  codes: ErrorCodeAggregate[];
  top10Codes: ErrorCodeAggregate[];
  newCodes: ErrorCodeAggregate[];
  repeatedCodes: ErrorCodeAggregate[];
  dailyDistribution: Array<{
    date: string;
    errors: number;
    affectedRows: number;
    totalRows: number;
    errorRatePct: number;
    distinctCodes: number;
  }>;
  cityDistribution: Array<{ city: string; errors: number; affectedRiders: number; sharePct: number }>;
  branchDistribution: Array<{ branch: string; errors: number; affectedRiders: number; sharePct: number }>;
  periodComparison: PeriodComparisonSummary;
  correlation: OperationalCorrelationReport;
  events: HungerErrorEvent[];
}

export function buildRiderResolver(dataset: FleetDataset) {
  const masterMap = new Map(dataset.riderMaster.map((m) => [m.internalRiderId, m]));
  const hsMappingMap = new Map<string, string>();
  for (const map of dataset.riderMappings) {
    if (map.platform === 'hungerstation') {
      hsMappingMap.set(map.platformRiderId, map.internalRiderId);
    }
  }
  return (riderId: string) => {
    const internalId = hsMappingMap.get(riderId) || '';
    const master = internalId ? masterMap.get(internalId) : undefined;
    return {
      internalRiderId: internalId,
      riderName: master?.fullName || riderId,
      branch: master?.branch || '',
      masterCity: master?.city || '',
    };
  };
}

export function filterHungerDailyRows(
  rows: HungerDailyRecord[],
  dataset: FleetDataset,
  filters: FilterState
): HungerDailyRecord[] {
  const resolveRider = buildRiderResolver(dataset);
  return rows.filter((r) => {
    if (filters.date && r.date !== filters.date) return false;
    if (filters.month && r.month !== filters.month) return false;
    if (filters.city && (r.city || '') !== filters.city) return false;
    if (filters.contract && (r.contractName || '') !== filters.contract) return false;
    if (filters.vehicleType && (r.vehicleName || '') !== filters.vehicleType) return false;
    const resolved = resolveRider(r.riderId);
    if (filters.branch && resolved.branch !== filters.branch) return false;
    if (filters.riderId) {
      const q = filters.riderId.trim().toLowerCase();
      if (
        !r.riderId.toLowerCase().includes(q) &&
        !resolved.riderName.toLowerCase().includes(q) &&
        !resolved.internalRiderId.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

function avgNullable(vals: Array<number | null | undefined>): number | null {
  const valid = vals.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (valid.length === 0) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
}

function buildCohortStats(rows: HungerDailyRecord[]): CohortKpiStats {
  const riders = new Set(rows.map((r) => r.riderId));
  const acceptedSum = rows.reduce((s, r) => s + (r.acceptedDeliveries ?? 0), 0);
  const cancelledSum = rows.reduce((s, r) => s + (r.cancelledDeliveries ?? 0), 0);
  const notifiedSum = rows.reduce((s, r) => s + (r.notifiedDeliveries ?? 0), 0);
  const declinedSum = rows.reduce(
    (s, r) => s + (r.declinedDeliveries ?? 0) + (r.notAcceptedDeliveries ?? 0),
    0
  );

  return {
    rowCount: rows.length,
    riderCount: riders.size,
    avgCompletedDeliveries: avgNullable(rows.map((r) => r.completedDeliveries)),
    avgAttendanceRate: avgNullable(rows.map((r) => r.attendanceRate)),
    avgWorkingHours: avgNullable(rows.map((r) => r.actualWorkingHours)),
    avgAcceptanceRate: avgNullable(rows.map((r) => r.acceptanceRate)),
    cancellationRatePct: acceptedSum > 0 ? Number(((cancelledSum / acceptedSum) * 100).toFixed(2)) : null,
    declineRatePct: notifiedSum > 0 ? Number(((declinedSum / notifiedSum) * 100).toFixed(2)) : null,
  };
}

function toBreakdown(map: Map<string, number>, total: number): BreakdownItem[] {
  return Array.from(map.entries())
    .map(([name, count]) => ({
      name,
      count,
      sharePct: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function extractHungerErrorEvents(
  hungerDailyRows: HungerDailyRecord[],
  dataset: FleetDataset,
  dictionaryEntries: ErrorCodeDictionaryEntry[],
  riderErrorCases: RiderErrorCase[]
): { events: HungerErrorEvent[]; delimiterProfile: ErrorDelimiterProfile } {
  const resolveRider = buildRiderResolver(dataset);
  const dictByCodeKey = new Map(dictionaryEntries.map((d) => [d.codeKey, d]));
  const dictByNorm = new Map(dictionaryEntries.map((d) => [d.normalizedCode, d]));
  const caseMap = new Map(riderErrorCases.map((c) => [c.caseId, c]));

  const delimiterProfile = inspectErrorCodeDatasetFormat(hungerDailyRows.map((r) => r.errorCodes));
  const events: HungerErrorEvent[] = [];

  for (const row of hungerDailyRows) {
    const tokens = parseRawErrorCodes(row.errorCodes, delimiterProfile);
    if (tokens.length === 0) continue;

    const resolved = resolveRider(row.riderId);
    for (const tok of tokens) {
      const dict = dictByCodeKey.get(tok.codeKey) || dictByNorm.get(tok.normalizedCode) || null;
      const caseId = makeRiderErrorCaseId(row.riderId, row.date, tok.codeKey);
      const caseRecord = caseMap.get(caseId) || null;

      events.push({
        eventKey: `${row.recordKey}__${tok.codeKey}`,
        caseId,
        recordKey: row.recordKey,
        riderId: row.riderId,
        riderName: resolved.riderName,
        internalRiderId: resolved.internalRiderId,
        date: row.date,
        month: row.month,
        city: row.city || resolved.masterCity || 'غير محدد',
        branch: resolved.branch || 'غير مربوط بفرع',
        contractName: row.contractName || 'غير محدد',
        vehicleName: row.vehicleName || 'غير محدد',
        batchNumber: row.batchNumber || '',
        tgaStatus: row.tgaStatus || '',
        rawCell: row.errorCodes || '',
        rawCode: tok.rawCode,
        normalizedCode: tok.normalizedCode,
        codeKey: tok.codeKey,
        dictionaryEntry: dict,
        caseRecord,
        sourceFile: row.sourceFile || '',
        sourceSheet: row.sourceSheet || '',
        sourceRowNumber: row.sourceRowNumber || 0,
        completedDeliveries: row.completedDeliveries,
        acceptedDeliveries: row.acceptedDeliveries,
        notifiedDeliveries: row.notifiedDeliveries,
        cancelledDeliveries: row.cancelledDeliveries,
        declinedDeliveries:
          row.declinedDeliveries !== null || row.notAcceptedDeliveries !== null
            ? (row.declinedDeliveries ?? 0) + (row.notAcceptedDeliveries ?? 0)
            : null,
        actualWorkingHours: row.actualWorkingHours,
        attendanceRate: row.attendanceRate,
        acceptanceRate: row.acceptanceRate,
      });
    }
  }

  return { events, delimiterProfile };
}

export function computeErrorCodeIntelligence(
  dataset: FleetDataset,
  dictionaryEntries: ErrorCodeDictionaryEntry[],
  riderErrorCases: RiderErrorCase[],
  filters: FilterState
): ErrorIntelligenceReport {
  const filteredRows = filterHungerDailyRows(dataset.hungerDaily, dataset, filters);
  const { events, delimiterProfile } = extractHungerErrorEvents(
    filteredRows,
    dataset,
    dictionaryEntries,
    riderErrorCases
  );

  // Track rows with vs without errors
  const rowsWithErrorsSet = new Set(events.map((e) => e.recordKey));
  const rowsWithErrorsList = filteredRows.filter((r) => rowsWithErrorsSet.has(r.recordKey));
  const rowsWithoutErrorsList = filteredRows.filter((r) => !rowsWithErrorsSet.has(r.recordKey));
  const rowByKey = new Map(filteredRows.map((r) => [r.recordKey, r]));

  // Group events by codeKey
  const byCode = new Map<string, HungerErrorEvent[]>();
  for (const ev of events) {
    const arr = byCode.get(ev.codeKey) || [];
    arr.push(ev);
    byCode.set(ev.codeKey, arr);
  }

  const allDatesSorted = Array.from(new Set(filteredRows.map((r) => r.date))).sort();
  const midIdx = Math.floor(allDatesSorted.length / 2);
  const recentWindowDates = new Set(
    allDatesSorted.slice(Math.max(0, allDatesSorted.length - Math.min(7, Math.max(1, midIdx))))
  );

  const codes: ErrorCodeAggregate[] = [];
  const repeatedRidersGlobal = new Set<string>();

  for (const [codeKey, codeEvents] of byCode.entries()) {
    const sample = codeEvents[0];
    const dict = sample.dictionaryEntry;
    const isVerified = Boolean(dict && dict.verifiedStatus === 'verified');
    const displayTitle = dict?.arabicDescription?.trim()
      ? dict.arabicDescription.trim()
      : 'Unknown Code';

    const rawExamplesSet = new Set<string>();
    const cityCounts = new Map<string, number>();
    const branchCounts = new Map<string, number>();
    const contractCounts = new Map<string, number>();
    const vehicleCounts = new Map<string, number>();
    const dayMap = new Map<string, { count: number; riders: Set<string> }>();
    const riderMap = new Map<
      string,
      {
        riderId: string;
        riderName: string;
        internalRiderId: string;
        city: string;
        branch: string;
        occurrences: number;
        dates: Set<string>;
        rawExamples: Set<string>;
        latestCaseStatus: RiderErrorCaseStatus | null;
        latestCaseDate: string;
        latestNote: string;
      }
    >();

    for (const ev of codeEvents) {
      rawExamplesSet.add(ev.rawCode);
      cityCounts.set(ev.city, (cityCounts.get(ev.city) || 0) + 1);
      branchCounts.set(ev.branch, (branchCounts.get(ev.branch) || 0) + 1);
      contractCounts.set(ev.contractName, (contractCounts.get(ev.contractName) || 0) + 1);
      vehicleCounts.set(ev.vehicleName, (vehicleCounts.get(ev.vehicleName) || 0) + 1);

      const dEntry = dayMap.get(ev.date) || { count: 0, riders: new Set<string>() };
      dEntry.count += 1;
      dEntry.riders.add(ev.riderId);
      dayMap.set(ev.date, dEntry);

      const rEntry = riderMap.get(ev.riderId) || {
        riderId: ev.riderId,
        riderName: ev.riderName,
        internalRiderId: ev.internalRiderId,
        city: ev.city,
        branch: ev.branch,
        occurrences: 0,
        dates: new Set<string>(),
        rawExamples: new Set<string>(),
        latestCaseStatus: null,
        latestCaseDate: '',
        latestNote: '',
      };
      rEntry.occurrences += 1;
      rEntry.dates.add(ev.date);
      rEntry.rawExamples.add(ev.rawCode);
      if (ev.caseRecord && ev.date >= rEntry.latestCaseDate) {
        rEntry.latestCaseDate = ev.date;
        rEntry.latestCaseStatus = ev.caseRecord.status;
        rEntry.latestNote = ev.caseRecord.operationalNote || '';
      }
      riderMap.set(ev.riderId, rEntry);
    }

    const dailySeries = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, count: v.count, riders: v.riders.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const firstSeenDate = dailySeries[0]?.date || '';
    const lastSeenDate = dailySeries[dailySeries.length - 1]?.date || '';

    // Trend direction across active timeline
    let trendDirection: 'up' | 'down' | 'stable' = 'stable';
    if (dailySeries.length >= 2) {
      const split = Math.floor(dailySeries.length / 2);
      const firstHalfAvg =
        dailySeries.slice(0, split).reduce((s, d) => s + d.count, 0) / Math.max(1, split);
      const secondHalfAvg =
        dailySeries.slice(split).reduce((s, d) => s + d.count, 0) /
        Math.max(1, dailySeries.length - split);
      if (secondHalfAvg > firstHalfAvg * 1.15) trendDirection = 'up';
      else if (secondHalfAvg < firstHalfAvg * 0.85) trendDirection = 'down';
    }

    const affectedRiders: AffectedRiderCodeSummary[] = Array.from(riderMap.values())
      .map((r) => {
        const sortedDates = Array.from(r.dates).sort();
        if (r.occurrences >= 2) repeatedRidersGlobal.add(r.riderId);
        return {
          riderId: r.riderId,
          riderName: r.riderName,
          internalRiderId: r.internalRiderId,
          city: r.city,
          branch: r.branch,
          occurrences: r.occurrences,
          dates: sortedDates,
          firstDate: sortedDates[0] || '',
          lastDate: sortedDates[sortedDates.length - 1] || '',
          rawExamples: Array.from(r.rawExamples),
          latestCaseStatus: r.latestCaseStatus,
          latestNote: r.latestNote,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate));

    const repeatedRidersCount = affectedRiders.filter((r) => r.occurrences >= 2).length;
    const total = codeEvents.length;

    codes.push({
      codeKey,
      normalizedCode: sample.normalizedCode,
      rawExamples: Array.from(rawExamplesSet),
      dictionary: dict,
      isVerified,
      displayTitle,
      category: dict?.category?.trim() || 'غير مصنف',
      severity: dict?.severity || 'unknown',
      recommendedAction: dict?.recommendedAction?.trim() || '',
      occurrenceCount: total,
      affectedRidersCount: affectedRiders.length,
      repeatedRidersCount,
      repeatSharePct:
        affectedRiders.length > 0
          ? Number(((repeatedRidersCount / affectedRiders.length) * 100).toFixed(1))
          : 0,
      firstSeenDate,
      lastSeenDate,
      activeDaysCount: dailySeries.length,
      trendDirection,
      dailySeries,
      cityBreakdown: toBreakdown(cityCounts, total),
      branchBreakdown: toBreakdown(branchCounts, total),
      contractBreakdown: toBreakdown(contractCounts, total),
      vehicleBreakdown: toBreakdown(vehicleCounts, total),
      affectedRiders,
    });
  }

  codes.sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.affectedRidersCount - a.affectedRidersCount);

  const top10Codes = codes.slice(0, 10);
  const newCodes = codes.filter(
    (c) => !c.isVerified || (allDatesSorted.length >= 2 && recentWindowDates.has(c.firstSeenDate))
  );
  const repeatedCodes = codes.filter((c) => c.repeatedRidersCount > 0);

  // Daily distribution across all Hunger-Daily dates in scope
  const totalRowsPerDay = new Map<string, number>();
  for (const r of filteredRows) {
    totalRowsPerDay.set(r.date, (totalRowsPerDay.get(r.date) || 0) + 1);
  }
  const errorDayAgg = new Map<
    string,
    { errors: number; rowKeys: Set<string>; codes: Set<string> }
  >();
  for (const ev of events) {
    const cur = errorDayAgg.get(ev.date) || {
      errors: 0,
      rowKeys: new Set<string>(),
      codes: new Set<string>(),
    };
    cur.errors += 1;
    cur.rowKeys.add(ev.recordKey);
    cur.codes.add(ev.codeKey);
    errorDayAgg.set(ev.date, cur);
  }

  const dailyDistribution = allDatesSorted.map((date) => {
    const totalRows = totalRowsPerDay.get(date) || 0;
    const agg = errorDayAgg.get(date);
    const affectedRows = agg ? agg.rowKeys.size : 0;
    return {
      date,
      errors: agg ? agg.errors : 0,
      affectedRows,
      totalRows,
      errorRatePct: totalRows > 0 ? Number(((affectedRows / totalRows) * 100).toFixed(1)) : 0,
      distinctCodes: agg ? agg.codes.size : 0,
    };
  });

  // City and Branch distributions
  const cityAgg = new Map<string, { errors: number; riders: Set<string> }>();
  const branchAgg = new Map<string, { errors: number; riders: Set<string> }>();
  for (const ev of events) {
    const c = cityAgg.get(ev.city) || { errors: 0, riders: new Set<string>() };
    c.errors += 1;
    c.riders.add(ev.riderId);
    cityAgg.set(ev.city, c);

    const b = branchAgg.get(ev.branch) || { errors: 0, riders: new Set<string>() };
    b.errors += 1;
    b.riders.add(ev.riderId);
    branchAgg.set(ev.branch, b);
  }

  const cityDistribution = Array.from(cityAgg.entries())
    .map(([city, v]) => ({
      city,
      errors: v.errors,
      affectedRiders: v.riders.size,
      sharePct: events.length > 0 ? Number(((v.errors / events.length) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.errors - a.errors);

  const branchDistribution = Array.from(branchAgg.entries())
    .map(([branch, v]) => ({
      branch,
      errors: v.errors,
      affectedRiders: v.riders.size,
      sharePct: events.length > 0 ? Number(((v.errors / events.length) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.errors - a.errors);

  // Period-over-period comparison (Month-over-Month if >= 2 months, else Half-Split)
  const monthsSorted = Array.from(new Set(filteredRows.map((r) => r.month))).sort();
  let periodComparison: PeriodComparisonSummary = {
    hasComparison: false,
    mode: 'insufficient',
    currentLabel: '-',
    previousLabel: '-',
    currentErrors: 0,
    previousErrors: 0,
    errorDeltaPct: null,
    currentErrorRatePct: 0,
    previousErrorRatePct: 0,
    rateDeltaPts: 0,
  };

  if (monthsSorted.length >= 2) {
    const curM = monthsSorted[monthsSorted.length - 1];
    const prevM = monthsSorted[monthsSorted.length - 2];
    const curRows = filteredRows.filter((r) => r.month === curM);
    const prevRows = filteredRows.filter((r) => r.month === prevM);
    const curErrs = events.filter((e) => e.month === curM);
    const prevErrs = events.filter((e) => e.month === prevM);
    const curRowRate =
      curRows.length > 0
        ? (new Set(curErrs.map((e) => e.recordKey)).size / curRows.length) * 100
        : 0;
    const prevRowRate =
      prevRows.length > 0
        ? (new Set(prevErrs.map((e) => e.recordKey)).size / prevRows.length) * 100
        : 0;
    periodComparison = {
      hasComparison: true,
      mode: 'month_over_month',
      currentLabel: curM,
      previousLabel: prevM,
      currentErrors: curErrs.length,
      previousErrors: prevErrs.length,
      errorDeltaPct:
        prevErrs.length > 0
          ? Number((((curErrs.length - prevErrs.length) / prevErrs.length) * 100).toFixed(1))
          : null,
      currentErrorRatePct: Number(curRowRate.toFixed(1)),
      previousErrorRatePct: Number(prevRowRate.toFixed(1)),
      rateDeltaPts: Number((curRowRate - prevRowRate).toFixed(1)),
    };
  } else if (allDatesSorted.length >= 2) {
    const split = Math.floor(allDatesSorted.length / 2);
    const prevSet = new Set(allDatesSorted.slice(0, split));
    const curSet = new Set(allDatesSorted.slice(split));
    const curRows = filteredRows.filter((r) => curSet.has(r.date));
    const prevRows = filteredRows.filter((r) => prevSet.has(r.date));
    const curErrs = events.filter((e) => curSet.has(e.date));
    const prevErrs = events.filter((e) => prevSet.has(e.date));
    const curRowRate =
      curRows.length > 0
        ? (new Set(curErrs.map((e) => e.recordKey)).size / curRows.length) * 100
        : 0;
    const prevRowRate =
      prevRows.length > 0
        ? (new Set(prevErrs.map((e) => e.recordKey)).size / prevRows.length) * 100
        : 0;
    const curDatesArr = Array.from(curSet).sort();
    const prevDatesArr = Array.from(prevSet).sort();
    periodComparison = {
      hasComparison: true,
      mode: 'half_split',
      currentLabel: `${curDatesArr[0]} → ${curDatesArr[curDatesArr.length - 1]}`,
      previousLabel: `${prevDatesArr[0]} → ${prevDatesArr[prevDatesArr.length - 1]}`,
      currentErrors: curErrs.length,
      previousErrors: prevErrs.length,
      errorDeltaPct:
        prevErrs.length > 0
          ? Number((((curErrs.length - prevErrs.length) / prevErrs.length) * 100).toFixed(1))
          : null,
      currentErrorRatePct: Number(curRowRate.toFixed(1)),
      previousErrorRatePct: Number(prevRowRate.toFixed(1)),
      rateDeltaPts: Number((curRowRate - prevRowRate).toFixed(1)),
    };
  }

  // Operational correlation (co-occurrence analysis without claiming causation)
  const withErrorsStats = buildCohortStats(rowsWithErrorsList);
  const withoutErrorsStats = buildCohortStats(rowsWithoutErrorsList);

  const perCodeCorrelation: PerCodeCorrelationRow[] = codes.map((c) => {
    const evs = byCode.get(c.codeKey) || [];
    const matchedRows = Array.from(
      new Set(evs.map((e) => e.recordKey))
    )
      .map((rk) => rowByKey.get(rk))
      .filter((r): r is HungerDailyRecord => Boolean(r));
    const stats = buildCohortStats(matchedRows);

    return {
      codeKey: c.codeKey,
      normalizedCode: c.normalizedCode,
      displayTitle: c.displayTitle,
      severity: c.severity,
      rowCount: stats.rowCount,
      riderCount: stats.riderCount,
      avgCompletedDeliveries: stats.avgCompletedDeliveries,
      deltaOrdersVsClean:
        stats.avgCompletedDeliveries !== null && withoutErrorsStats.avgCompletedDeliveries !== null
          ? Number((stats.avgCompletedDeliveries - withoutErrorsStats.avgCompletedDeliveries).toFixed(2))
          : null,
      avgAttendanceRate: stats.avgAttendanceRate,
      deltaAttendanceVsClean:
        stats.avgAttendanceRate !== null && withoutErrorsStats.avgAttendanceRate !== null
          ? Number((stats.avgAttendanceRate - withoutErrorsStats.avgAttendanceRate).toFixed(2))
          : null,
      avgWorkingHours: stats.avgWorkingHours,
      deltaHoursVsClean:
        stats.avgWorkingHours !== null && withoutErrorsStats.avgWorkingHours !== null
          ? Number((stats.avgWorkingHours - withoutErrorsStats.avgWorkingHours).toFixed(2))
          : null,
      avgAcceptanceRate: stats.avgAcceptanceRate,
      cancellationRatePct: stats.cancellationRatePct,
      declineRatePct: stats.declineRatePct,
    };
  });

  const uniqueAffectedRiders = new Set(events.map((e) => e.riderId));

  return {
    delimiterProfile,
    totalHungerDailyRows: filteredRows.length,
    affectedRowsCount: rowsWithErrorsList.length,
    errorRowRatePct:
      filteredRows.length > 0
        ? Number(((rowsWithErrorsList.length / filteredRows.length) * 100).toFixed(1))
        : 0,
    totalErrorEvents: events.length,
    distinctCodesCount: codes.length,
    verifiedCodesCount: codes.filter((c) => c.isVerified).length,
    unknownCodesCount: codes.filter((c) => !c.isVerified).length,
    affectedRidersCount: uniqueAffectedRiders.size,
    repeatedRidersTotalCount: repeatedRidersGlobal.size,
    codes,
    top10Codes,
    newCodes,
    repeatedCodes,
    dailyDistribution,
    cityDistribution,
    branchDistribution,
    periodComparison,
    correlation: {
      withErrors: withErrorsStats,
      withoutErrors: withoutErrorsStats,
      perCode: perCodeCorrelation,
    },
    events,
  };
}

export function generateErrorIntelligenceAlerts(
  report: ErrorIntelligenceReport,
  settings: OperationalSettings
): AlertItem[] {
  const alerts: AlertItem[] = [];

  const repeatThreshold = settings.errorRepeatRiderThreshold ?? 2;
  const spikeDailyThreshold = settings.errorSpikeDailyThreshold ?? 5;
  const spikeMultPct = settings.errorSpikeMultiplierPct ?? 150;
  const spreadThreshold = settings.errorSpreadRidersThreshold ?? 5;
  const branchConcentrationPct = settings.errorBranchConcentrationPct ?? 40;
  const alertNew = settings.alertOnNewErrorCode ?? true;

  for (const code of report.codes) {
    // 1. New / Unverified error code
    if (alertNew && !code.isVerified) {
      alerts.push({
        id: `err_new_${code.codeKey}`,
        severity: code.occurrenceCount >= spikeDailyThreshold ? 'critical' : 'warning',
        category: 'أكواد أخطاء جديدة',
        title: `كود خطأ غير موثق في القاموس: ${code.normalizedCode}`,
        description: `تم رصد الكود ${code.normalizedCode} (${code.occurrenceCount} مرة لـ ${code.affectedRidersCount} مندوب) ولا يزال بحالة Unknown Code بانتظار التوثيق في القاموس.`,
        platform: 'hungerstation',
        riderId: code.affectedRiders[0]?.riderId || '-',
        riderName: code.affectedRiders[0]?.riderName,
        date: code.lastSeenDate || '-',
        metricValue: code.occurrenceCount,
        thresholdValue: 'موثق في القاموس',
        branchOrCity: code.cityBreakdown[0]?.name,
      });
    }

    // 2. Repeated error code for the same rider
    for (const rider of code.affectedRiders) {
      if (rider.occurrences >= repeatThreshold) {
        alerts.push({
          id: `err_rep_${code.codeKey}_${rider.riderId}`,
          severity: rider.occurrences >= repeatThreshold + 2 || code.severity === 'critical' ? 'critical' : 'warning',
          category: 'تكرار كود للمندوب',
          title: `تكرار الكود ${code.normalizedCode} للمندوب ${rider.riderId}`,
          description: `تكرر الكود (${code.displayTitle}) عدد ${rider.occurrences} مرة للمندوب من ${rider.firstDate} إلى ${rider.lastDate} (الحد المسموح: ${repeatThreshold}).`,
          platform: 'hungerstation',
          riderId: rider.riderId,
          riderName: rider.riderName,
          date: rider.lastDate,
          metricValue: rider.occurrences,
          thresholdValue: repeatThreshold,
          branchOrCity: rider.branch !== 'غير مربوط بفرع' ? rider.branch : rider.city,
        });
      }
    }

    // 3. Sudden daily spike
    if (code.dailySeries.length >= 2) {
      const latest = code.dailySeries[code.dailySeries.length - 1];
      const prior = code.dailySeries.slice(0, -1);
      const priorAvg = prior.reduce((s, d) => s + d.count, 0) / prior.length;
      const requiredSpike = Math.max(spikeDailyThreshold, priorAvg * (spikeMultPct / 100));
      if (latest.count >= spikeDailyThreshold && latest.count >= requiredSpike) {
        alerts.push({
          id: `err_spike_${code.codeKey}_${latest.date}`,
          severity: 'critical',
          category: 'قفزة مفاجئة في الأخطاء',
          title: `ارتفاع مفاجئ في الكود ${code.normalizedCode}`,
          description: `سجّل ${latest.count} حالة في ${latest.date} مقارنة بمتوسط تاريخي ${priorAvg.toFixed(1)}/يوم (تجاوز حد القفزة ${spikeDailyThreshold} و${spikeMultPct}%).`,
          platform: 'hungerstation',
          riderId: code.affectedRiders[0]?.riderId || '-',
          date: latest.date,
          metricValue: latest.count,
          thresholdValue: `${spikeDailyThreshold} (${spikeMultPct}%)`,
          branchOrCity: code.cityBreakdown[0]?.name,
        });
      }
    }

    // 4. Widespread code across many riders
    if (code.affectedRidersCount >= spreadThreshold) {
      alerts.push({
        id: `err_spread_${code.codeKey}`,
        severity: code.severity === 'critical' || code.severity === 'high' ? 'critical' : 'warning',
        category: 'انتشار واسع للأخطاء',
        title: `انتشار الكود ${code.normalizedCode} بين ${code.affectedRidersCount} مندوب`,
        description: `الكود (${code.displayTitle}) أثّر على ${code.affectedRidersCount} مندوبًا بإجمالي ${code.occurrenceCount} حالة (الحد: ${spreadThreshold} مندوب).`,
        platform: 'hungerstation',
        riderId: code.affectedRiders[0]?.riderId || '-',
        date: code.lastSeenDate || '-',
        metricValue: code.affectedRidersCount,
        thresholdValue: spreadThreshold,
        branchOrCity: code.cityBreakdown[0]?.name,
      });
    }

    // 5. Concentration in a specific city or branch
    const topBranch = code.branchBreakdown.find((b) => b.name !== 'غير مربوط بفرع');
    const topLoc = topBranch || code.cityBreakdown[0];
    if (topLoc && code.occurrenceCount >= 3 && topLoc.sharePct >= branchConcentrationPct) {
      alerts.push({
        id: `err_conc_${code.codeKey}`,
        severity: 'warning',
        category: 'تركز جغرافي للأخطاء',
        title: `تركز الكود ${code.normalizedCode} في ${topLoc.name}`,
        description: `تتركز ${topLoc.sharePct}% من حالات الكود (${topLoc.count} من ${code.occurrenceCount}) في ${topLoc.name} (الحد: ${branchConcentrationPct}%).`,
        platform: 'hungerstation',
        riderId: code.affectedRiders[0]?.riderId || '-',
        date: code.lastSeenDate || '-',
        metricValue: `${topLoc.sharePct}%`,
        thresholdValue: `${branchConcentrationPct}%`,
        branchOrCity: topLoc.name,
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.date.localeCompare(a.date);
  });
}
