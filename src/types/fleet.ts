export type Platform = 'hungerstation' | 'keeta';

export type UserRole = 'owner' | 'admin' | 'operations_manager' | 'supervisor' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  assignedBranch?: string;
  managedByAdminUids?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RiderMaster {
  internalRiderId: string;
  fullName: string;
  city?: string;
  branch?: string;
  supervisor?: string;
  contractName?: string;
  vehicleType?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RiderIdentityMapping {
  mappingId: string;
  internalRiderId: string;
  platform: Platform;
  platformRiderId: string;
  platformRiderName?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportBatch {
  batchId: string;
  fileName: string;
  fileHash: string;
  platform: Platform;
  sourceType: 'local' | 'google_drive';
  driveFileId?: string;
  detectedPeriodStart?: string;
  detectedPeriodEnd?: string;
  sheetsDetected?: string[];
  unknownColumns?: string[];
  validCount: number;
  duplicateCount: number;
  rejectedCount: number;
  updatedCount?: number;
  status: 'previewed' | 'committed' | 'failed';
  importedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
}

export interface HungerDailyRecord {
  recordKey: string;
  platform: 'hungerstation';
  riderId: string;
  date: string;
  month: string;
  city?: string;
  contractName?: string;
  vehicleName?: string;
  batchNumber?: string;
  tgaStatus?: string;
  errorCodes?: string;
  shifts: number | null;
  plannedWorkingHours: number | null;
  actualWorkingHours: number | null;
  avgWorkingHoursPerDay: number | null;
  attendanceRate: number | null;
  breakHours: number | null;
  lostHours: number | null;
  acceptanceRate: number | null;
  contactRate: number | null;
  noShows: number | null;
  noShowPct: number | null;
  notifiedDeliveries: number | null;
  completedDeliveries: number | null;
  acceptedDeliveries: number | null;
  stackedDeliveries: number | null;
  declinedDeliveries: number | null;
  cancelledDeliveries: number | null;
  deductionDeliveries: number | null;
  notAcceptedDeliveries: number | null;
  manualUndispatched: number | null;
  chatResponsePct: number | null;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface HungerDistanceDailyRecord {
  recordKey: string;
  platform: 'hungerstation';
  riderId: string;
  date: string;
  month: string;
  city?: string;
  contractName?: string;
  totalKm: number | null;
  payableKm: number | null;
  avgKm: number | null;
  completedDeliveries: number | null;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface HungerWalletSnapshot {
  recordKey: string;
  platform: 'hungerstation';
  riderId: string;
  snapshotDate: string;
  currentWallet: number;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface HungerQualityMonthly {
  recordKey: string;
  platform: 'hungerstation';
  riderId: string;
  month: string;
  city?: string;
  contractName?: string;
  vehicleType?: string;
  totalVerificationRequests: number | null;
  successfulVerificationRequests: number | null;
  verificationSuccessRate: number | null;
  grossOrders: number | null;
  completedOrders: number | null;
  completedOrdersInTime: number | null;
  failedOrdersByRider: number | null;
  onTimeDeliveryScore: number | null;
  failRateScore: number | null;
  finalDeliveryQualityScore: number | null;
  segment?: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface KeetaDashboardDaily {
  recordKey: string;
  platform: 'keeta';
  riderId: string;
  date: string;
  month: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  vehicleType?: string;
  headquarters?: string;
  branch?: string;
  supervisor?: string;
  courierType?: string;
  shiftAttendanceSummary?: string;
  onShift?: string;
  validDay?: string;
  appOnlineTime: number | null;
  shiftValidOnlineTime: number | null;
  shiftOnlineHours: number | null;
  acceptedTasks: number | null;
  restaurantArrivals: number | null;
  deliveredTasks: number | null;
  largeOrderTasksCompleted: number | null;
  rejectedTasks: number | null;
  rejectedTasksCourier: number | null;
  rejectedTasksAuto: number | null;
  cancellationRate: number | null;
  completionRate: number | null;
  onTimeRate: number | null;
  largeOrderOnTimeRate: number | null;
  avgDeliveryTimeMinutes: number | null;
  deliveredOver55Min: number | null;
  overdueOrderTasks: number | null;
  severelyOverdueOrderTasks: number | null;
  rawExtraColumns?: Record<string, string | number | null>;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface KeetaVdaDaily {
  recordKey: string;
  platform: 'keeta';
  riderId: string;
  date: string;
  month: string;
  vehicleType?: string;
  shiftOnlineHours: number | null;
  sumValidShifts: number | null;
  shouldOnlineDays: number | null;
  totalDeliveredTasks: number | null;
  onTimeDTasks: number | null;
  cancellationD: number | null;
  deliveredOver55Min: number | null;
  acceptedOrders: number | null;
  totalDeliveryDistance: number | null;
  payableDistance: number | null;
  shiftWindows?: Record<string, string | number | null>;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface KeetaRankSnapshot {
  recordKey: string;
  platform: 'keeta';
  riderId: string;
  snapshotDate: string;
  name?: string;
  currentEstimatedLevel?: string;
  rankingPercentile: number | null;
  forcedAssignmentScore: number | null;
  estimatedRewardAmount: number | null;
  onTimeRate: number | null;
  orderCompletionRate: number | null;
  didntTapDropOffTooEarly: number | null;
  orderVolume: number | null;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface KeetaFacialRecognitionDaily {
  recordKey: string;
  platform: 'keeta';
  riderId: string;
  date: string;
  month: string;
  city?: string;
  partnerId?: string;
  partnerName?: string;
  pmm?: string;
  finalInspectionResult?: string;
  totalDaysTriggeredMtd: number | null;
  totalDaysPassedMtd: number | null;
  passRateMtd: number | null;
  over90PassRate?: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRowNumber: number;
  importBatchId: string;
  rowChecksum: string;
  createdByUid: string;
  allowedUids: string[];
  importedAt?: string;
  updatedAt?: string;
}

export interface DailySummary {
  summaryKey: string;
  platform: Platform;
  date: string;
  month: string;
  totalRiders: number;
  activeRiders: number;
  completedOrders: number;
  acceptedOrders: number;
  rejectedOrders: number;
  cancelledOrders: number;
  workingHours: number;
  validHours: number;
  totalKm: number;
  payableKm: number;
  overdueOrders: number;
  avgAcceptanceRate: number;
  avgCompletionRate: number;
  avgOnTimeRate: number;
  avgAttendanceRate: number;
  createdByUid: string;
  allowedUids: string[];
  updatedAt?: string;
}

export interface MonthlySummary {
  summaryKey: string;
  platform: Platform;
  month: string;
  totalRiders: number;
  activeRiders: number;
  completedOrders: number;
  workingHours: number;
  totalKm: number;
  payableKm: number;
  overdueOrders: number;
  avgAcceptanceRate: number;
  avgCompletionRate: number;
  avgOnTimeRate: number;
  avgAttendanceRate: number;
  createdByUid: string;
  allowedUids: string[];
  updatedAt?: string;
}

export interface OperationalSettings {
  settingsId: string;
  minDailyWorkingHours: number;
  minDailyOrders: number;
  maxOverdueRatePct: number;
  maxCancellationRatePct: number;
  minAcceptanceRatePct: number;
  minCompletionRatePct: number;
  minOnTimeRatePct: number;
  minAttendanceRatePct: number;
  minFacialPassRatePct: number;
  minWalletBalance: number;
  minDeliveryQualityScore: number;
  // Configurable HungerStation Error Intelligence Alert Thresholds
  errorRepeatRiderThreshold?: number;
  errorSpikeDailyThreshold?: number;
  errorSpikeMultiplierPct?: number;
  errorSpreadRidersThreshold?: number;
  errorBranchConcentrationPct?: number;
  alertOnNewErrorCode?: boolean;
  // Enterprise Performance Scoring Weights & Operational Policy
  scoreWeightProductivity?: number;
  scoreWeightHours?: number;
  scoreWeightCommitment?: number;
  scoreWeightQuality?: number;
  scoreWeightAcceptance?: number;
  scoreWeightCancellation?: number;
  minActiveOrdersPerDay?: number;
  minActiveHoursPerDay?: number;
  caseOverdueDays?: number;
  configuredBranches?: string[];
  importMaxFiles?: number;
  importAllowUpdates?: boolean;
  importStrictDates?: boolean;
  createdByUid: string;
  allowedUids: string[];
  updatedByEmail?: string;
  updatedAt?: string;
}

export type ErrorCodeSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface ErrorCodeDictionaryEntry {
  codeKey: string;
  normalizedCode: string;
  rawExamples?: string;
  arabicDescription: string;
  englishDescription?: string;
  category?: string;
  severity: ErrorCodeSeverity;
  recommendedAction?: string;
  verifiedStatus: 'verified' | 'unverified';
  notes?: string;
  updatedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type RiderErrorCaseStatus = 'open' | 'in_review' | 'resolved';

export interface RiderErrorCase {
  caseId: string;
  riderId: string;
  date: string;
  codeKey: string;
  normalizedCode: string;
  rawCode: string;
  status: RiderErrorCaseStatus;
  operationalNote?: string;
  actionTaken?: string;
  updatedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type OperationalCaseStatus = 'new' | 'under_review' | 'in_progress' | 'resolved' | 'closed';
export type OperationalCasePriority = 'critical' | 'high' | 'medium' | 'low';

export interface OperationalCase {
  caseId: string;
  riderId: string;
  platform: Platform;
  riderName?: string;
  branch?: string;
  issueType: string;
  title: string;
  description?: string;
  priority: OperationalCasePriority;
  status: OperationalCaseStatus;
  assigneeEmail?: string;
  actionTaken?: string;
  notes?: string;
  registeredDate: string;
  dueDate?: string;
  closedDate?: string;
  sourceRef?: string;
  updatedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type RiderNoteCategory = 'admin' | 'warning' | 'commendation' | 'ops';

export interface RiderNote {
  noteId: string;
  riderKey: string;
  platform: Platform;
  riderId: string;
  category: RiderNoteCategory;
  content: string;
  authorEmail: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  logId: string;
  action: string;
  targetCollection: string;
  targetId: string;
  actorUid: string;
  actorEmail: string;
  details: string;
  allowedUids: string[];
  createdAt?: string;
}

export interface FilterState {
  date: string;
  month: string;
  platform: 'all' | Platform;
  city: string;
  branch: string;
  contract: string;
  supervisor: string;
  vehicleType: string;
  riderId: string;
}

export interface AlertItem {
  id: string;
  severity: 'critical' | 'warning';
  category: string;
  title: string;
  description: string;
  platform: Platform;
  riderId: string;
  riderName?: string;
  date: string;
  metricValue: number | string;
  thresholdValue: number | string;
  branchOrCity?: string;
}

export interface SheetParseDiagnostic {
  sheetName: string;
  targetCollection: string;
  totalRowsScanned: number;
  emptyRowsSkipped: number;
  duplicateHeadersSkipped: number;
  validCount: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  unknownColumns: string[];
}

export interface RejectedRowInfo {
  sheetName: string;
  rowNumber: number;
  riderIdRaw: string;
  reason: string;
}

export interface ImportPreviewResult {
  previewId: string;
  fileName: string;
  fileHash: string;
  platform: Platform;
  sourceType: 'local' | 'google_drive';
  driveFileId?: string;
  detectedPeriodStart: string | null;
  detectedPeriodEnd: string | null;
  sheetsDetected: string[];
  missingExpectedSheets: string[];
  unknownColumns: string[];
  totalValid: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  sheetDiagnostics: SheetParseDiagnostic[];
  rejectedSample: RejectedRowInfo[];
  previewRows: Array<{
    sheetName: string;
    recordKey: string;
    riderId: string;
    dateOrPeriod: string;
    summaryText: string;
    changeStatus: 'new' | 'update' | 'duplicate';
  }>;
}
