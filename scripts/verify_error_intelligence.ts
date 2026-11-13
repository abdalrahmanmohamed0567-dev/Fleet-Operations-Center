import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  computeErrorCodeIntelligence,
  generateErrorIntelligenceAlerts,
} from '../src/lib/errorIntelligence.js';
import { DEFAULT_OPERATIONAL_SETTINGS } from '../src/lib/firebase.js';
import type { FleetDataset } from '../src/lib/fleetAnalytics.js';
import { parseExcelBuffer } from '../src/server/excelParser.js';
import { makeErrorCodeKey, parseRawErrorCodes } from '../src/shared/errorCodeParser.js';
import type {
  ErrorCodeDictionaryEntry,
  FilterState,
  HungerDailyRecord,
  OperationalSettings,
  RiderErrorCase,
} from '../src/types/fleet.js';

const EMPTY_FILTERS: FilterState = {
  date: '',
  month: '',
  platform: 'all',
  city: '',
  branch: '',
  contract: '',
  supervisor: '',
  vehicleType: '',
  riderId: '',
};

async function buildErrorTestWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hunger-Daily');
  ws.addRow([
    'ID', 'City Name', 'Contract Name', 'Vehicle Name', 'Batch Number', 'TGA Status',
    'Error Codes', 'Shifts', 'Working Days', 'Planned Working Hours', 'Actual Working Hours',
    'Avg. Working Hours per Day', 'Attendance Rate', 'Break Hours', 'Lost Hours',
    'Acceptance Rate', 'Contact Rate', 'No Shows', 'No Show %', 'Notified Deliveries',
    'Completed Deliveries', 'Accepted Deliveries', 'Stacked Deliveries', 'Declined Deliveries',
    'Cancelled Deliveries', 'Deduction Deliveries', 'Not Accepted Deliveries',
    'Manual Undispatched', 'Rider-Customer Chat Response %',
  ]);

  // Row 1: Single composite code ERR-101 on rider 00482910, 2026-10-13 (46308)
  ws.addRow([
    '00482910', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    'ERR-101', 2, 46308, 10, 6.0,
    6.0, 0.80, 0.5, 1.0,
    0.78, 0.90, 0, 0, 20,
    8, 10, 0, 3,
    2, 0, 1,
    0, 88,
  ]);

  // Row 2: Multi-code comma separated (lowercase + whitespace) on same rider next day -> ERR-101 repeated!
  ws.addRow([
    '00482910', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    'err-101, TGA_TIMEOUT', 2, 46309, 10, 5.5,
    5.5, 0.75, 0.5, 1.5,
    0.72, 0.85, 1, 0.1, 18,
    6, 9, 0, 4,
    2, 0, 2,
    0, 82,
  ]);

  // Row 3: Spaced slash + Composite code CODE/A (must split on ' / ', MUST NOT split CODE/A!)
  ws.addRow([
    '00551122', 'Jeddah', 'Contract-B', 'bike', 'B2', 'Active',
    'CODE/A / 050', 2, 46309, 10, 7.0,
    7.0, 0.85, 0.5, 0.5,
    0.82, 0.92, 0, 0, 16,
    10, 12, 1, 1,
    1, 0, 1,
    0, 90,
  ]);

  // Row 4: Newline multi-code on another rider on 2026-10-14
  ws.addRow([
    '00663344', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    'ERR-101\nE04: GPS_LOST', 2, 46309, 10, 6.5,
    6.5, 0.82, 0.5, 0.5,
    0.80, 0.90, 0, 0, 18,
    9, 11, 0, 2,
    1, 0, 1,
    0, 87,
  ]);

  // Row 5-7: Empty / sentinel Error Codes (MUST produce 0 error events; clean control cohort)
  ws.addRow([
    '00482910', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    '', 2, 46310, 10, 9.5,
    9.5, 0.98, 0.5, 0,
    0.95, 0.99, 0, 0, 22,
    20, 21, 2, 0,
    0, 0, 0,
    0, 97,
  ]);
  ws.addRow([
    '00551122', 'Jeddah', 'Contract-B', 'bike', 'B2', 'Active',
    'N/A', 2, 46310, 10, 9.0,
    9.0, 0.96, 0.5, 0,
    0.94, 0.98, 0, 0, 20,
    19, 19, 1, 0,
    0, 0, 0,
    0, 96,
  ]);
  ws.addRow([
    '00663344', 'Riyadh', 'Contract-A', 'car', 'B1', 'Active',
    '-', 2, 46310, 10, 9.2,
    9.2, 0.97, 0.5, 0,
    0.93, 0.98, 0, 0, 21,
    18, 19, 1, 0,
    0, 0, 0,
    0, 95,
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function run() {
  console.log('--- Running HungerStation Error Code Intelligence Verification ---');

  // 1. Unit checks on safe multi-code splitting & sentinel exclusion
  assert.deepEqual(parseRawErrorCodes(''), []);
  assert.deepEqual(parseRawErrorCodes(' - '), []);
  assert.deepEqual(parseRawErrorCodes('N/A'), []);
  assert.deepEqual(parseRawErrorCodes('null'), []);
  assert.deepEqual(parseRawErrorCodes('0'), []);

  const composite = parseRawErrorCodes('CODE/A');
  assert.equal(composite.length, 1, 'Composite single code CODE/A must NOT be split');
  assert.equal(composite[0].normalizedCode, 'CODE/A');
  assert.equal(composite[0].rawCode, 'CODE/A');

  const multi = parseRawErrorCodes('err-101, TGA_TIMEOUT; E04: GPS_LOST | err-101');
  assert.equal(multi.length, 3, 'Duplicate within same cell deduplicates to 3 distinct codes');
  assert.equal(multi[0].rawCode, 'err-101');
  assert.equal(multi[0].normalizedCode, 'ERR-101');
  assert.equal(multi[2].normalizedCode, 'E04: GPS_LOST');

  // 2. Excel workbook parsing & double-upload idempotency
  const buf = await buildErrorTestWorkbook();
  const parsed1 = await parseExcelBuffer({
    buffer: buf,
    fileName: 'HS_Errors_Test.xlsx',
    batchId: 'batch_err_1',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });
  const parsed2 = await parseExcelBuffer({
    buffer: buf,
    fileName: 'HS_Errors_Test_Reupload.xlsx',
    batchId: 'batch_err_2',
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  });

  const hsRows1 = parsed1.records
    .filter((r) => r.collection === 'hungerDaily')
    .map((r) => r.data as HungerDailyRecord);
  const hsRows2 = parsed2.records
    .filter((r) => r.collection === 'hungerDaily')
    .map((r) => r.data as HungerDailyRecord);

  assert.equal(hsRows1.length, 7, 'All 7 valid Hunger-Daily rows must be parsed');
  assert.equal(hsRows1[0].riderId, '00482910', 'Leading zero Rider ID preserved');
  assert.equal(hsRows1[0].date, '2026-10-13', 'Excel serial date 46308 -> 2026-10-13');
  assert.equal(hsRows1[4].errorCodes, '', 'Empty cell preserved as empty string');
  assert.equal(hsRows1[5].errorCodes, '', 'N/A cell normalized to empty string');
  assert.equal(hsRows1[6].errorCodes, '', 'Dash cell normalized to empty string');

  // Double-upload idempotency guarantee (recordKey + rowChecksum match 100%)
  for (let i = 0; i < hsRows1.length; i++) {
    assert.equal(hsRows1[i].recordKey, hsRows2[i].recordKey);
    assert.equal(hsRows1[i].rowChecksum, hsRows2[i].rowChecksum);
  }

  // Deduplicate by recordKey just as Firestore Upsert does
  const dedupMap = new Map<string, HungerDailyRecord>();
  for (const r of [...hsRows1, ...hsRows2]) {
    dedupMap.set(r.recordKey, r);
  }
  const deduplicatedRows = Array.from(dedupMap.values());
  assert.equal(deduplicatedRows.length, 7, 'Re-uploading same file must NOT duplicate daily records or error events');

  // 3. Dictionary Lookup + Unknown Code Fallback (no invented meanings!)
  const err101Key = makeErrorCodeKey('ERR-101');
  const dictionary: ErrorCodeDictionaryEntry[] = [
    {
      codeKey: err101Key,
      normalizedCode: 'ERR-101',
      rawExamples: 'ERR-101, err-101',
      arabicDescription: 'تأخر تأكيد الشفت في التطبيق',
      englishDescription: 'Shift confirmation delay',
      category: 'الالتزام والحضور',
      severity: 'high',
      recommendedAction: 'التواصل مع المندوب قبل بداية الشفت بـ 15 دقيقة',
      verifiedStatus: 'verified',
      createdByUid: 'uid_test',
      allowedUids: ['uid_test'],
    },
  ];

  const riderCases: RiderErrorCase[] = [];
  const dataset: FleetDataset = {
    hungerDaily: deduplicatedRows,
    hungerDistanceDaily: [],
    hungerWalletSnapshots: [],
    hungerQualityMonthly: [],
    keetaDashboardDaily: [],
    keetaVdaDaily: [],
    keetaRankSnapshots: [],
    keetaFacialRecognitionDaily: [],
    riderMaster: [
      {
        internalRiderId: 'EMP_01',
        fullName: 'أحمد محمد',
        city: 'Riyadh',
        branch: 'الرياض - الشمال',
        status: 'active',
        createdByUid: 'uid_test',
        allowedUids: ['uid_test'],
      },
    ],
    riderMappings: [
      {
        mappingId: 'hungerstation_00482910',
        internalRiderId: 'EMP_01',
        platform: 'hungerstation',
        platformRiderId: '00482910',
        createdByUid: 'uid_test',
        allowedUids: ['uid_test'],
      },
    ],
  };

  const report = computeErrorCodeIntelligence(dataset, dictionary, riderCases, EMPTY_FILTERS);

  // Expected distinct codes: ERR-101 (3x), TGA_TIMEOUT (1x), CODE/A (1x), 050 (1x), E04: GPS_LOST (1x) = 5 distinct codes, 7 events
  assert.equal(report.distinctCodesCount, 5, 'Must extract exact 5 distinct codes');
  assert.equal(report.totalErrorEvents, 7, 'Must extract exact 7 error events with zero drops');
  assert.equal(report.affectedRowsCount, 4, 'Only 4 rows had non-empty Error Codes');
  assert.equal(report.totalHungerDailyRows, 7);
  assert.equal(report.affectedRidersCount, 3);
  assert.equal(report.verifiedCodesCount, 1, 'Only ERR-101 is verified in dictionary');
  assert.equal(report.unknownCodesCount, 4, '4 unverified codes must remain Unknown Code');

  const err101Agg = report.codes.find((c) => c.normalizedCode === 'ERR-101')!;
  assert.equal(err101Agg.occurrenceCount, 3);
  assert.equal(err101Agg.affectedRidersCount, 2);
  assert.equal(err101Agg.repeatedRidersCount, 1, 'Rider 00482910 repeated ERR-101 twice');
  assert.equal(err101Agg.firstSeenDate, '2026-10-13');
  assert.equal(err101Agg.lastSeenDate, '2026-10-14');
  assert.ok(err101Agg.rawExamples.includes('ERR-101') && err101Agg.rawExamples.includes('err-101'));
  assert.equal(err101Agg.affectedRiders[0].branch, 'الرياض - الشمال');

  const unmappedCode = report.codes.find((c) => c.normalizedCode === 'CODE/A')!;
  assert.equal(unmappedCode.displayTitle, 'Unknown Code', 'Unverified code must explicitly display Unknown Code');
  assert.equal(unmappedCode.severity, 'unknown');

  // 4. Smart Alerts driven by configurable System Settings
  const settings: OperationalSettings = {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    errorRepeatRiderThreshold: 2,
    errorSpikeDailyThreshold: 2,
    errorSpikeMultiplierPct: 150,
    errorSpreadRidersThreshold: 2,
    errorBranchConcentrationPct: 40,
    alertOnNewErrorCode: true,
    createdByUid: 'uid_test',
    allowedUids: ['uid_test'],
  };

  const alerts = generateErrorIntelligenceAlerts(report, settings);
  assert.ok(alerts.some((a) => a.category === 'أكواد أخطاء جديدة'), 'Must alert on Unknown/New codes');
  assert.ok(alerts.some((a) => a.category === 'تكرار كود للمندوب' && a.riderId === '00482910'), 'Must alert on repeated code for rider 00482910');
  assert.ok(alerts.some((a) => a.category === 'قفزة مفاجئة في الأخطاء'), 'Must detect daily spike on ERR-101');
  assert.ok(alerts.some((a) => a.category === 'انتشار واسع للأخطاء'), 'Must detect widespread code across riders');
  assert.ok(alerts.some((a) => a.category === 'تركز جغرافي للأخطاء'), 'Must detect geographic concentration');

  // Verify settings threshold dynamically disables alerts when raised
  const strictSettings: OperationalSettings = {
    ...settings,
    errorRepeatRiderThreshold: 10,
    errorSpikeDailyThreshold: 20,
    errorSpreadRidersThreshold: 20,
    errorBranchConcentrationPct: 99,
    alertOnNewErrorCode: false,
  };
  const quietAlerts = generateErrorIntelligenceAlerts(report, strictSettings);
  assert.equal(quietAlerts.length, 0, 'Raising settings thresholds must eliminate alerts dynamically');

  // 5. Operational Correlation math check
  assert.equal(report.correlation.withErrors.rowCount, 4);
  assert.equal(report.correlation.withoutErrors.rowCount, 3);
  assert.ok(
    (report.correlation.withErrors.avgCompletedDeliveries ?? 0) <
      (report.correlation.withoutErrors.avgCompletedDeliveries ?? 0),
    'Cohort with errors had fewer deliveries than clean cohort in test data'
  );

  console.log('ALL HUNGERSTATION ERROR CODE INTELLIGENCE TESTS PASSED!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
