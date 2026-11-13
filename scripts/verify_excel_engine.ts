import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseExcelBuffer } from '../src/server/excelParser.js';

async function buildHungerTestWorkbook(omitWalletSheet = false): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // 1. Hunger-Daily with 30 repeated headers, empty rows, Excel Serial dates, zero vs null, invalid rows
  const wsDaily = wb.addWorksheet('Hunger-Daily');
  const dailyHeaders = [
    'ID', 'City Name', 'Contract Name', 'Vehicle Name', 'Batch Number', 'TGA Status',
    'Error Codes', 'Shifts', 'Working Days', 'Planned Working Hours', 'Actual Working Hours',
    'Avg. Working Hours per Day', 'Attendance Rate', 'Break Hours', 'Lost Hours',
    'Acceptance Rate', 'Contact Rate', 'No Shows', 'No Show %', 'Notified Deliveries',
    'Completed Deliveries', 'Accepted Deliveries', 'Stacked Deliveries', 'Declined Deliveries',
    'Cancelled Deliveries', 'Deduction Deliveries', 'Not Accepted Deliveries',
    'Manual Undispatched', 'Rider-Customer Chat Response %',
  ];
  wsDaily.addRow(dailyHeaders);

  // Valid row 1: Rider "00482910" on 2026-10-13 (Excel serial 46308), zero declined, null chatResponse
  wsDaily.addRow([
    '00482910', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    '', 2, 46308, 10, 9.5,
    9.5, 0.95, 0.5, 0,
    0.92, 0.98, 0, 0, 20,
    18, 18, 2, 0,
    0, 0, 0,
    0, null,
  ]);

  // Empty row
  wsDaily.addRow([]);

  // 30 repeated header rows inside data
  for (let i = 0; i < 30; i++) {
    wsDaily.addRow(dailyHeaders);
  }

  // Valid row 2: Same rider on 2026-10-14 (Excel serial 46309) with changed metrics
  wsDaily.addRow([
    '00482910', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    '', 2, 46309, 10, 6.0,
    6.0, 0.80, 0.5, 1.0,
    0.85, 0.90, 1, 0.1, 15,
    10, 12, 1, 2,
    1, 0, 1,
    0, 88.5,
  ]);

  // Invalid rider ID row (should be rejected)
  wsDaily.addRow([
    '', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    '', 1, 46308, 8, 8,
    8, 1, 0, 0,
    1, 1, 0, 0, 10,
    10, 10, 0, 0,
    0, 0, 0,
    0, 95,
  ]);

  // Invalid date row (should be rejected)
  wsDaily.addRow([
    '998877', 'Jeddah', 'Contract-B', 'bike', 'B2', 'Active',
    '', 1, 'bad-date', 8, 8,
    8, 1, 0, 0,
    1, 1, 0, 0, 10,
    10, 10, 0, 0,
    0, 0, 0,
    0, 95,
  ]);

  // 2. Riders Wallet
  if (!omitWalletSheet) {
    const wsWallet = wb.addWorksheet('Riders Wallet');
    wsWallet.addRow(['Rider Id', 'Current Wallet']);
    wsWallet.addRow(['00482910', -125.5]);
    wsWallet.addRow(['556677', 0]);
  }

  // 3. Riders Distance
  const wsDist = wb.addWorksheet('Riders Distance');
  wsDist.addRow(['Created Date', 'City Name', 'Contract Name', 'Rider Id', 'Total KM', 'Payable KM', 'AVG KM', 'Completed Deliveries']);
  wsDist.addRow([46308, 'Riyadh', 'Contract-A', '00482910', 142.5, 130.0, 7.9, 18]);

  // 4. Delivery Quality Segmentation with missing Column E header and shifted F..P
  const wsQual = wb.addWorksheet('Delivery Quality Segmentation');
  wsQual.addRow([
    'Month', 'City', 'Contract', 'Rider ID', '',
    'Total Verification Requests', 'Successful Verification Requests', 'Verification Success Rate',
    'Gross Orders', 'Completed Orders', 'Completed Orders In Time', 'Failed Orders By Rider',
    'On-time Delivery Score', 'Fail Rate Score', 'Final Delivery Quality Score', 'Segment',
  ]);
  wsQual.addRow([
    '2026-10', 'Riyadh', 'Contract-A', '00482910', 'car',
    20, 19, 0.95,
    300, 290, 275, 2,
    92, 96, 94.2, 'Gold',
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildKeetaTestWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // 1. Dashboard with YYYYMMDD and unknown column Shift_PeAbdo Online Hours
  const wsDash = wb.addWorksheet('Dashboard');
  wsDash.addRow([
    'Date', 'Courier ID', 'Courier first name', 'Courier last name', 'Vehicle type',
    'Headquarters', 'Branch', 'Supervisor', 'Courier Type', 'Shift Attendance summary',
    'On-Shift?', 'Valid Day?', 'Courier App Online Time', 'Shift Valid Online Time',
    'Shift Online Hours', 'Shift_PeAbdo Online Hours', 'Accepted Tasks',
    'Tasks with restaurant arrivals', 'Delivered Tasks', 'Large Order Tasks Completed',
    'Rejected Tasks', 'Rejected Tasks (Courier)', 'Rejected Tasks (Auto)',
    'Cancellation Rate from Delivery Issues', 'Order completion rate', 'On-time Rate',
    'Large order on-time rate', 'Average Delivery Time', 'Delivered Orders over 55min',
    'Overdue Order Tasks', 'Severely Overdue Order Tasks',
  ]);
  wsDash.addRow([
    20261013, '7700123456', 'Ahmed', 'Ali', 'Motorbike',
    'Riyadh', 'North-1', 'Supervisor-A', 'Full-Time', '2/2',
    'Yes', 'Yes', 10.5, 9.2,
    9.5, 4.25, 22,
    22, 21, 3,
    0, 0, 0,
    0, 0.9545, 0.91,
    1.0, 28.5, 0,
    1, 0,
  ]);

  // 2. VDA keyed by Online Day (ignoring First online date)
  const wsVda = wb.addWorksheet('VDA');
  wsVda.addRow([
    'Rider ID', 'Vehicle Type', 'First online date', 'Online Day', 'Shift Online hours',
    'Sum of Valid Shifts', 'Should online days', 'Total delivered tasks', 'On-time D tasks',
    'Scheduled shifts S1', 'Shift hours S1', 'Valid shifts S1',
    'Cancellation(D)', 'Delivered orders over 55min', 'Accepted orders',
    'Total Delivery Distance', 'Payable distance',
  ]);
  wsVda.addRow([
    '7700123456', 'Motorbike', 20260901, 20261013, 9.5,
    2, 1, 21, 19,
    1, 4.5, 1,
    0, 0, 22,
    158.4, 145.0,
  ]);

  // 3. RankPlanProcess with repeated header row
  const wsRank = wb.addWorksheet('RankPlanProcess');
  const rankHeaders = [
    'Courier ID', 'Name', 'Current estimated level', 'Ranking percentile',
    'Forced assignment score', 'Estimated reward amount', 'On-time rate',
    'Order completion rate', "Didn't tap drop-off too early", 'Order volume',
  ];
  wsRank.addRow(rankHeaders);
  wsRank.addRow(rankHeaders); // Repeated header inside data
  wsRank.addRow(['7700123456', 'Ahmed Ali', 'Diamond', 96.5, 100, 850, 0.91, 0.95, 0.99, 410]);

  // 4. FacialRecognitionDataReport with empty if_triggered_today
  const wsFace = wb.addWorksheet('FacialRecognitionDataReport');
  wsFace.addRow([
    'Date', 'City', 'Courier ID', 'Partner ID', 'Partner name', 'PMM',
    'if_triggered_today', 'Final inspection result', 'Total days triggered MTD',
    'Total days passed MTD', 'Pass rate MTD', 'Over 90% pass rate',
  ]);
  wsFace.addRow([
    20261013, 'Riyadh', '7700123456', 'P-10', 'Partner Logistics', 'PMM-1',
    null, 'Pass', 12,
    12, 1.0, 'Yes',
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function run() {
  console.log('--- Running Phase 5 Excel Engine Verification ---');

  // Test 1: HungerStation full workbook
  const hsBuf = await buildHungerTestWorkbook(false);
  const hsParsed = await parseExcelBuffer({
    buffer: hsBuf,
    fileName: 'Report_A.xlsx', // Intentionally non-descriptive filename (Rule 1)
    batchId: 'batch_test_1',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });

  assert.equal(hsParsed.platform, 'hungerstation', 'Platform must be detected from sheets/columns, not filename');
  const hsDailyDiag = hsParsed.sheetDiagnostics.find((s) => s.sheetName === 'Hunger-Daily')!;
  assert.equal(hsDailyDiag.duplicateHeadersSkipped, 30, 'Must skip all 30 repeated headers');
  assert.equal(hsDailyDiag.emptyRowsSkipped, 1, 'Must skip empty row');
  assert.equal(hsDailyDiag.rejectedCount, 2, 'Must reject 1 missing ID + 1 bad date');
  assert.equal(hsDailyDiag.validCount, 2, 'Must accept exactly 2 valid daily rows');

  const hsDailyRows = hsParsed.records.filter((r) => r.collection === 'hungerDaily').map((r) => r.data);
  assert.equal(hsDailyRows[0].riderId, '00482910', 'Rider ID must stay exact string with leading zeros');
  assert.equal(hsDailyRows[0].date, '2026-10-13', 'Excel serial 46308 must convert to 2026-10-13');
  assert.equal(hsDailyRows[1].date, '2026-10-14', 'Excel serial 46309 must convert to 2026-10-14');
  assert.equal(hsDailyRows[0].declinedDeliveries, 0, 'Zero must stay 0');
  assert.equal(hsDailyRows[0].chatResponsePct, null, 'Empty cell must stay null, never 0');

  const qualRows = hsParsed.records.filter((r) => r.collection === 'hungerQualityMonthly').map((r) => r.data);
  assert.equal(qualRows.length, 1);
  assert.equal(qualRows[0].vehicleType, 'car', 'Column E without header must map to Vehicle Type');
  assert.equal(qualRows[0].segment, 'Gold', 'Column P must map to Segment');
  assert.equal(qualRows[0].finalDeliveryQualityScore, 94.2);

  // Test 2: Idempotency (same file uploaded twice produces exact same recordKeys & rowChecksums)
  const hsParsed2 = await parseExcelBuffer({
    buffer: hsBuf,
    fileName: 'Report_A_copy.xlsx',
    batchId: 'batch_test_2',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });
  assert.equal(hsParsed.fileHash, hsParsed2.fileHash);
  assert.equal(hsParsed.records[0].data.recordKey, hsParsed2.records[0].data.recordKey);
  assert.equal(hsParsed.records[0].data.rowChecksum, hsParsed2.records[0].data.rowChecksum);

  // Test 3: Missing sheet workbook
  const hsPartialBuf = await buildHungerTestWorkbook(true);
  const hsPartialParsed = await parseExcelBuffer({
    buffer: hsPartialBuf,
    fileName: 'Partial_Hunger.xlsx',
    batchId: 'batch_test_3',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });
  assert.deepEqual(hsPartialParsed.missingExpectedSheets, ['Riders Wallet']);

  // Test 4: Keeta workbook
  const ktBuf = await buildKeetaTestWorkbook();
  const ktParsed = await parseExcelBuffer({
    buffer: ktBuf,
    fileName: 'Report_B.xlsx',
    batchId: 'batch_test_4',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });
  assert.equal(ktParsed.platform, 'keeta');
  assert.ok(ktParsed.unknownColumns.some((c) => c.includes('Shift_PeAbdo Online Hours')), 'Unknown column must be flagged');

  const ktDash = ktParsed.records.find((r) => r.collection === 'keetaDashboardDaily')!.data;
  if ('rawExtraColumns' in ktDash) {
    assert.equal(ktDash.date, '2026-10-13');
    assert.equal(ktDash.rawExtraColumns?.['Shift_PeAbdo Online Hours'], 4.25);
    assert.equal(ktDash.rejectedTasks, 0);
  }

  const ktVda = ktParsed.records.find((r) => r.collection === 'keetaVdaDaily')!.data;
  if ('totalDeliveryDistance' in ktVda) {
    assert.equal(ktVda.date, '2026-10-13', 'Must use Online Day (2026-10-13), NOT First online date (2026-09-01)');
    assert.equal(ktVda.payableDistance, 145);
  }

  const ktRankDiag = ktParsed.sheetDiagnostics.find((s) => s.sheetName === 'RankPlanProcess')!;
  assert.equal(ktRankDiag.duplicateHeadersSkipped, 1, 'Repeated header in RankPlanProcess must be skipped');

  console.log('ALL PHASE 5 EXCEL VERIFICATION ASSERTIONS PASSED!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
