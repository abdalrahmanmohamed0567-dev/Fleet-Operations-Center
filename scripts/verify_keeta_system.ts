import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  computeKeetaCrossSheetLinkage,
  computeKeetaDashboardAnalytics,
  computeKeetaFacialAnalytics,
  computeKeetaRankAnalytics,
  computeKeetaVdaAnalytics,
  generateKeetaIntelligenceAlerts,
  KEETA_KPI_DICTIONARY,
} from '../src/lib/keetaIntelligence.js';
import type { FleetDataset } from '../src/lib/fleetAnalytics.js';
import { DEFAULT_OPERATIONAL_SETTINGS } from '../src/lib/firebase.js';
import { parseExcelBuffer } from '../src/server/excelParser.js';
import type {
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  OperationalSettings,
} from '../src/types/fleet.js';

const TEST_SETTINGS: OperationalSettings = {
  ...DEFAULT_OPERATIONAL_SETTINGS,
  createdByUid: 'uid_test',
  allowedUids: ['uid_test'],
};

async function build91ColKeetaWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // 1. Dashboard (30 exact columns) with 2 banner rows above header (header detection on row 3)
  const wsDash = wb.addWorksheet('Dashboard');
  wsDash.addRow(['Keeta Monthly Export Report — October 2026']);
  wsDash.addRow([]);
  const dashHeaders = [
    'Date', 'Courier ID', 'Courier first name', 'Courier last name', 'Vehicle type',
    'Headquarters', 'Branch', 'Supervisor', 'Courier Type',
    'Shift_Attendance summary based on valid online duration',
    'On-Shift?', 'Valid Day?', 'Shift_Courier App Online Time', 'Shift_Valid Online Time',
    'Shift_Online Hours', 'Shift_PeAbdo Online Hours',
    'Task Volumes_Accepted Tasks', 'Task Volumes_Tasks with restaurant arrivals',
    'Task Volumes_Delivered Tasks', 'Task Volumes_Large Order Tasks Completed',
    'Task Volumes_Rejected Tasks', 'Task Volumes_Rejected Tasks (Courier)',
    'Task Volumes_Rejected Tasks (Auto)',
    'Delivery Experience_Cancellation Rate from Delivery Issues',
    'Delivery Experience_Order completion rate (non-delivery related)',
    'Delivery Experience_On-time Rate (D)', 'Delivery Experience_Large order on-time rate',
    'Delivery Experience_Average Delivery Time',
    'Delivery Experience_Delivered Orders Prop. (Over 55min)',
    'Delivery Experience_Overdue Order Tasks',
  ];
  assert.equal(dashHeaders.length, 30, 'Dashboard must have exact 30 columns');
  wsDash.addRow(dashHeaders);

  const slotsSample =
    '00:00-03:00: 1.5h (Qualified) | 03:00-06:00: 0h (No Shifts) | 06:00-12:00: 3.0h (Qualified) | 12:00-16:00: 2.5h (Qualified) | 16:00-20:00: 2.0h (Unqualified) | 20:00-24:00: 1.5h (Qualified)';

  // Rider A: 100 tasks (weighted dominance), valid, 95% comp, 90% on-time
  wsDash.addRow([
    20261013, '00482910', 'Ahmed', 'Ali', 'Motorbike',
    'Riyadh', 'North-1', 'Sup-A', 'Full-Time', slotsSample,
    'Yes', 'Yes', '11 hrs 30 min', '9 hrs 0 min',
    '10 hrs 30 min', 4.5,
    100, 100, 100, 5,
    0, 0, 0,
    0, 0.95, 0.90, 1.0, '24 min', '2.00%', 1,
  ]);
  // Rider B: 1 task, 0% comp, 0% on-time, 4 courier rejections -> weighted avg stays ~94.06% / ~89.11% (NOT 47.5%!)
  wsDash.addRow([
    20261013, '1234567890123456', 'Omar', 'Zaid', 'Car',
    'Riyadh', 'North-1', 'Sup-A', 'Part-Time', slotsSample,
    'Yes', 'No', '1 hrs 0 min', '0 sec',
    '1 hrs 0 min', '-',
    1, 1, 1, 0,
    4, 4, 0,
    0, 0, 0, '-', '0 sec', '-', 0,
  ]);
  // Invalid date row to check columnName + rawValue diagnostics
  wsDash.addRow([
    'invalid-dt', '99887766', 'Bad', 'Date', 'Car',
    'Riyadh', 'North-1', 'Sup-A', 'Full-Time', '-',
    'No', 'No', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  // 2. VDA (39 exact columns)
  const wsVda = wb.addWorksheet('VDA');
  const vdaHeaders = [
    'Rider ID', 'Vehicle Type', 'First online date', 'Online Day', '3PL ID', '3PL Name', 'PMM',
    'If New Rider', 'Shift Online hours', 'Sum of Valid Shifts', 'Should online days',
    'Total delivered tasks', 'Sum of Delivered advance tasks', 'On-time D tasks',
    'Scheduled shifts S1', 'Shift hours S1', 'Valid shifts S1',
    'Scheduled shifts S2', 'Shift hours S2', 'Valid shifts S2',
    'Scheduled shifts S3', 'Shift hours S3', 'Valid shifts S3',
    'Scheduled shifts S4', 'Shift hours S4', 'Valid shifts S4',
    'Scheduled shifts S5', 'Shift hours S5', 'Valid shifts S5',
    'Scheduled shifts S6', 'Shift hours S6', 'Valid shifts S6',
    'Cancellation(D)', 'Delivered orders over 55min', 'Accepted orders',
    'Total Delivery Distance', 'Payable distance', 'VDA score', 'Overdue orders',
  ];
  assert.equal(vdaHeaders.length, 39, 'VDA must have exact 39 columns');
  wsVda.addRow(vdaHeaders);
  wsVda.addRow([
    '00482910', 'Motorbike', 20260801, 20261013, '3PL-01', 'Alpha Fleet', 'PMM-East',
    'No', 10.5, 3, 1,
    100, 12, 90,
    1, 2.0, 1,
    1, 2.0, 1,
    1, 2.0, 1,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 2, 100,
    210.5, 195.0, 92.4, 1,
  ]);
  // Rider only in VDA (not in Dashboard) to verify cross-sheet mismatch detection
  wsVda.addRow([
    '77778888', 'Car', 20261001, 20261013, '3PL-01', 'Alpha Fleet', 'PMM-East',
    'Yes', 4.0, 1, 1,
    10, 2, 9,
    1, 4.0, 1,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 10,
    30.0, 28.0, 88.0, 0,
  ]);

  // 3. RankPlanProcess (10 exact columns) with repeated header + 2 snapshot dates + name discrepancy
  const wsRank = wb.addWorksheet('RankPlanProcess');
  const rankHeaders = [
    'Courier ID', 'Name', 'Current estimated level', 'Ranking percentile',
    'Forced assignment score', 'Estimated reward amount', 'On-time rate',
    'Order completion rate', "Didn't tap drop-off too early", 'Order volume',
  ];
  assert.equal(rankHeaders.length, 10, 'RankPlanProcess must have exact 10 columns');
  wsRank.addRow(rankHeaders);
  wsRank.addRow(rankHeaders); // Repeated header
  wsRank.addRow(['00482910', 'Ahmed Ali', 'Gold', 82.0, 95.0, 600, 0.88, 0.94, 0.96, 300]);
  // Also snapshot date column test via second sheet or explicit Snapshot Date? Let's test snapshot dates cleanly via Snapshot Date optional column in a second worksheet or check default snapshot date, then build multi-date snapshots in unit analytics below.

  // 4. FacialRecognitionDataReport (12 exact columns) with snake_case `dt` & `if_triggered_today` + multi-day MTD
  const wsFace = wb.addWorksheet('FacialRecognitionDataReport');
  const faceHeaders = [
    'dt', 'City', 'Courier ID', 'Partner ID', 'Partner name', 'PMM',
    'if_triggered_today', 'Final inspection result', 'Total days triggered MTD',
    'Total days passed MTD', 'Pass rate MTD', 'Over 90% pass rate',
  ];
  assert.equal(faceHeaders.length, 12, 'FacialRecognitionDataReport must have exact 12 columns');
  wsFace.addRow(faceHeaders);
  wsFace.addRow([20261012, 'Riyadh', '00482910', 'P-1', 'Alpha Fleet', 'PMM-East', null, 'Pass', 10, 9, 0.90, 'Yes']);
  wsFace.addRow([20261013, 'Riyadh', '00482910', 'P-1', 'Alpha Fleet', 'PMM-East', null, 'Pass', 11, 10, 0.9091, 'Yes']);
  wsFace.addRow([20261013, 'Riyadh', '1234567890123456', 'P-1', 'Alpha Fleet', 'PMM-East', 'Yes', 'Fail', 5, 3, 0.60, 'No']);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function run() {
  console.log('=== Verifying Keeta System (Real CSV + Full 4-Sheet 91-Column XLSX) ===');

  // PART 1: Real CSV Verification (_Keeta_Oct_2026_f7e1819e)
  const realCsvPath = path.resolve(process.cwd(), 'public/assets/aistudio/_Keeta_Oct_2026_f7e1819e');
  assert.ok(fs.existsSync(realCsvPath), `Real CSV file must exist at ${realCsvPath}`);
  const csvBuf = fs.readFileSync(realCsvPath);

  const csvParsed = await parseExcelBuffer({
    buffer: csvBuf,
    fileName: '_Keeta_Oct_2026.csv',
    batchId: 'batch_real_csv_1',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });

  assert.equal(csvParsed.platform, 'keeta', 'CSV must be auto-detected as keeta');
  assert.equal(csvParsed.sheetsDetected.length, 1, 'Real CSV contains only Dashboard sheet');
  assert.equal(csvParsed.sheetsDetected[0], 'Dashboard');
  assert.deepEqual(
    csvParsed.missingExpectedSheets,
    ['VDA', 'RankPlanProcess', 'FacialRecognitionDataReport'],
    'Missing 3 sheets must be honestly reported'
  );
  assert.equal(csvParsed.records.length, 2619, 'All 2,619 data rows must be parsed without loss');
  const csvRejectedTotal = csvParsed.sheetDiagnostics.reduce((s, d) => s + d.rejectedCount, 0);
  assert.equal(csvRejectedTotal, 0, 'Zero valid rows should be rejected in clean CSV');

  const csvDashRows = csvParsed.records.map((r) => r.data as KeetaDashboardDaily);
  const uniqueRiders = new Set(csvDashRows.map((r) => r.riderId));
  const uniqueDates = new Set(csvDashRows.map((r) => r.date));
  assert.equal(uniqueRiders.size, 103, 'Real CSV has 103 unique Courier IDs');
  assert.equal(uniqueDates.size, 31, 'Real CSV spans 31 days (2026-10-01 to 2026-10-31)');
  assert.equal(csvParsed.detectedPeriodStart, '2026-10-01');
  assert.equal(csvParsed.detectedPeriodEnd, '2026-10-31');

  // Verify 6-window parsedShiftSlots on real rows
  const withSlots = csvDashRows.filter((r) => (r.parsedShiftSlots?.length ?? 0) === 6);
  assert.ok(withSlots.length > 2000, `Expected parsedShiftSlots (6 windows) on >2000 rows, got ${withSlots.length}`);

  // Verify "-" -> null vs "0 sec" -> 0, percentage string vs decimal fraction string, deliveredOver55MinProp vs deliveredOver55Min
  const rowWithDash = csvDashRows.find((r) => r.completionRate === null || r.onTimeRate === null);
  assert.ok(rowWithDash, 'Rows with "-" rates must preserve null instead of converting to 0');
  const rowWithZeroSec = csvDashRows.find((r) => r.appOnlineTime === 0 && r.appOnlineTimeRaw === '0 sec');
  assert.ok(rowWithZeroSec, '"0 sec" must parse as numeric 0 while preserving raw text');
  assert.ok(
    csvDashRows.some((r) => r.deliveredOver55MinProp !== null && r.deliveredOver55MinProp !== undefined && r.deliveredOver55Min === null),
    'Dashboard deliveredOver55MinProp (%) must remain separated from VDA deliveredOver55Min count'
  );
  assert.ok(
    csvParsed.unknownColumns.some((c) => c.includes('Shift_PeAbdo Online Hours')),
    'Shift_PeAbdo Online Hours must remain flagged as unverified column definition'
  );

  // Verify Idempotency on real CSV
  const csvParsed2 = await parseExcelBuffer({
    buffer: csvBuf,
    fileName: '_Keeta_Oct_2026_copy.csv',
    batchId: 'batch_real_csv_2',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });
  assert.equal(csvParsed.fileHash, csvParsed2.fileHash);
  assert.equal(csvDashRows[0].recordKey, (csvParsed2.records[0].data as KeetaDashboardDaily).recordKey);
  assert.equal(csvDashRows[0].rowChecksum, (csvParsed2.records[0].data as KeetaDashboardDaily).rowChecksum);

  const realDashAnalytics = computeKeetaDashboardAnalytics(csvDashRows);
  assert.ok(realDashAnalytics.deliveredTasks > 0, 'Real CSV total delivered tasks must be positive');
  assert.ok(realDashAnalytics.acceptanceRate !== null && realDashAnalytics.acceptanceRate > 0 && realDashAnalytics.acceptanceRate <= 100);
  assert.equal(realDashAnalytics.slotBreakdown.length, 6, '6 shift windows must be aggregated');
  console.log(
    `Real CSV OK: ${csvDashRows.length} rows, ${uniqueRiders.size} riders, ${realDashAnalytics.deliveredTasks} delivered tasks, ` +
    `Acc=${realDashAnalytics.acceptanceRate}%, Comp=${realDashAnalytics.completionRate}%, OT=${realDashAnalytics.onTimeRate}%`
  );

  // PART 2: Full 4-Sheet 91-Column XLSX Workbook Verification
  const wbBuf = await build91ColKeetaWorkbook();
  const wbParsed = await parseExcelBuffer({
    buffer: wbBuf,
    fileName: 'Arbitrary_Export_Name.xlsx',
    batchId: 'batch_91col_1',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });

  assert.equal(wbParsed.platform, 'keeta');
  assert.equal(wbParsed.sheetsDetected.length, 4, 'All 4 Keeta sheets must be detected');
  assert.equal(wbParsed.missingExpectedSheets.length, 0, 'No expected sheets missing');
  const wbRejectedTotal = wbParsed.sheetDiagnostics.reduce((s, d) => s + d.rejectedCount, 0);
  assert.equal(wbRejectedTotal, 1, 'Exactly 1 bad date row must be rejected');
  assert.equal(wbParsed.rejectedRows.length, 1);
  assert.equal(wbParsed.rejectedRows[0].columnName, 'Date');
  assert.equal(wbParsed.rejectedRows[0].rawValue, 'invalid-dt');

  const dash91 = wbParsed.records.filter((r) => r.collection === 'keetaDashboardDaily').map((r) => r.data as KeetaDashboardDaily);
  const vda91 = wbParsed.records.filter((r) => r.collection === 'keetaVdaDaily').map((r) => r.data as KeetaVdaDaily);
  const rank91 = wbParsed.records.filter((r) => r.collection === 'keetaRankSnapshots').map((r) => r.data as KeetaRankSnapshot);
  const face91 = wbParsed.records.filter((r) => r.collection === 'keetaFacialRecognitionDaily').map((r) => r.data as KeetaFacialRecognitionDaily);

  assert.equal(dash91.length, 2, 'Dashboard header detected cleanly on row 3');
  assert.equal(dash91[0].riderId, '00482910', 'Leading zeros preserved');
  assert.equal(dash91[1].riderId, '1234567890123456', '16-digit Courier ID preserved as exact string');
  assert.equal(dash91[0].rejectedTasksCourier, 0);
  assert.equal(dash91[1].rejectedTasksCourier, 4);
  assert.equal(dash91[1].shiftValidOnlineTime, 0, '"0 sec" stays 0');
  assert.equal(dash91[1].onTimeRate, 0, '0 stays 0');
  assert.equal(dash91[1].largeOrderOnTimeRate, null, '"-" stays null');
  assert.equal(dash91[1].deliveredOver55MinProp, null, '"-" prop stays null');

  assert.equal(vda91.length, 2);
  assert.equal(vda91[0].date, '2026-10-13', 'Must key VDA by Online Day, NOT First online date 2026-08-01');
  assert.equal(vda91[0].firstOnlineDate, '2026-08-01');
  assert.equal(vda91[0].threePlName, 'Alpha Fleet');
  assert.equal(vda91[0].shiftsS1ToS6?.length, 6, 'All S1..S6 shift windows must be parsed');
  assert.equal(vda91[0].deliveredOver55Min, 2);

  assert.equal(rank91.length, 1, 'Repeated header in RankPlanProcess skipped cleanly');
  assert.equal(face91.length, 3, 'All 3 Facial rows including snake_case dt parsed');

  // Verify Weighted KPIs (100 tasks @ 95% + 1 task @ 0% => weighted ~94.06%, NOT 47.5%)
  const wbDashAnalytics = computeKeetaDashboardAnalytics(dash91);
  assert.ok(wbDashAnalytics.completionRate !== null && wbDashAnalytics.completionRate > 90, `Expected weighted completion > 90%, got ${wbDashAnalytics.completionRate}`);
  assert.ok(wbDashAnalytics.onTimeRate !== null && wbDashAnalytics.onTimeRate > 85, `Expected weighted on-time > 85%, got ${wbDashAnalytics.onTimeRate}`);
  assert.equal(wbDashAnalytics.rejectedCourier, 4);
  assert.equal(wbDashAnalytics.rejectedAuto, 0);

  // Verify VDA analytics & S1..S6
  const wbVdaAnalytics = computeKeetaVdaAnalytics(vda91);
  assert.equal(wbVdaAnalytics.totalOver55MinCount, 2);
  assert.equal(wbVdaAnalytics.newRidersCount, 1);
  assert.equal(wbVdaAnalytics.s1ToS6Matrix.find((s) => s.slot === 'S1')?.validShifts, 2);

  // Verify Rank progression across 2 snapshot dates
  const rankMulti: KeetaRankSnapshot[] = [
    { ...rank91[0], recordKey: 'k1', snapshotDate: '2026-10-10', rankingPercentile: 75.0, estimatedRewardAmount: 500 },
    { ...rank91[0], recordKey: 'k2', snapshotDate: '2026-10-13', name: 'Ahmed DifferentName', rankingPercentile: 85.0, estimatedRewardAmount: 750 },
  ];
  const wbRankAnalytics = computeKeetaRankAnalytics(rankMulti);
  assert.equal(wbRankAnalytics.latestRows.length, 1, 'Latest snapshot deduplicates per rider');
  assert.equal(wbRankAnalytics.totalEstimatedRewardLatest, 750, 'Must NOT double-count 500 + 750');
  assert.equal(wbRankAnalytics.progression.upgradedCount, 1);

  // Verify Facial Latest-MTD non-summation + if_triggered_today fill rate
  const wbFaceAnalytics = computeKeetaFacialAnalytics(face91);
  assert.equal(wbFaceAnalytics.dailyTotalRows, 3);
  assert.equal(wbFaceAnalytics.uniqueRiders, 2, 'Deduplicated to 2 riders for MTD summary');
  assert.equal(wbFaceAnalytics.triggeredTodayNullCount, 2);
  assert.equal(wbFaceAnalytics.triggeredTodayPopulatedCount, 1);
  assert.equal(wbFaceAnalytics.dailyFailCount, 1);

  // Verify Cross-Sheet Linkage & Name Discrepancy detection
  const testDataset: FleetDataset = {
    hungerDaily: [],
    hungerDistanceDaily: [],
    hungerWalletSnapshots: [],
    hungerQualityMonthly: [],
    keetaDashboardDaily: dash91,
    keetaVdaDaily: vda91,
    keetaRankSnapshots: rankMulti,
    keetaFacialRecognitionDaily: face91,
    riderMaster: [],
    riderMappings: [],
  };
  const linkage = computeKeetaCrossSheetLinkage(testDataset);
  assert.deepEqual(linkage.vdaNotInDashboardIds, ['77778888'], 'Must detect VDA-only Courier ID');
  assert.equal(linkage.nameDiscrepancies.length, 1, 'Must detect Dashboard vs RankPlan name mismatch');
  assert.equal(linkage.nameDiscrepancies[0].riderId, '00482910');

  // Verify Keeta Intelligence Alerts
  const ktAlerts = generateKeetaIntelligenceAlerts(testDataset, TEST_SETTINGS, {
    date: '',
    month: '',
    platform: 'keeta',
    city: '',
    branch: '',
    contract: '',
    supervisor: '',
    vehicleType: '',
    riderId: '',
  });
  assert.ok(ktAlerts.some((a) => a.category.includes('رفض المندوب') && a.riderId === '1234567890123456'));
  assert.ok(ktAlerts.some((a) => a.category.includes('التحقق من الهوية') && a.riderId === '1234567890123456'));
  assert.ok(KEETA_KPI_DICTIONARY.length >= 9, 'KPI Dictionary must document all major Keeta formulas');

  console.log('ALL KEETA SYSTEM VERIFICATION ASSERTIONS PASSED!');
}

run().catch((err) => {
  console.error('Keeta verification failed:', err);
  process.exit(1);
});
