export type Platform = 'hungerstation' | 'keeta';

export type WorkspaceMode = 'selector' | 'hungerstation' | 'keeta' | 'global';

export type UserRole =
  | 'owner'
  | 'admin'
  | 'operations_manager'
  | 'supervisor'
  | 'viewer'
  | 'hr_manager'
  | 'hr_employee'
  | 'fleet_manager'
  | 'fleet_employee'
  | 'accountant';

export type PermissionModule =
  | 'executive'
  | 'hr'
  | 'documents'
  | 'applications'
  | 'fleet'
  | 'operations'
  | 'reports'
  | 'alerts'
  | 'users'
  | 'roles'
  | 'settings'
  | 'platforms'
  | 'audit'
  | 'builder'
  | 'branding'
  | 'company'
  | 'system_health'
  | 'trash';

export type PermissionAction = 'view' | 'add' | 'edit' | 'delete' | 'export' | 'approve';

export type GranularCapability =
  | 'print'
  | 'archive'
  | 'restore'
  | 'manage_settings'
  | 'create_fields'
  | 'edit_fields'
  | 'manage_forms'
  | 'manage_sections'
  | 'change_branding'
  | 'manage_company';

export type CapabilityMap = Record<GranularCapability, boolean>;

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionMatrix = Record<PermissionModule, ModulePermissions>;

export interface DataScope {
  allBranches: boolean;
  branches: string[];
  cities: string[];
  platforms: string[];
  riderIds: string[];
}

export interface RoleTemplate {
  roleId: string;
  nameAr: string;
  nameEn: string;
  description?: string;
  isSystemPreset: boolean;
  permissions: PermissionMatrix;
  capabilities?: Partial<CapabilityMap>;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface UserProfile {
  uid: string;
  phone?: string;
  email: string;
  displayName: string;
  role: UserRole;
  customRoleId?: string;
  active: boolean;
  allowedPlatforms?: Platform[];
  assignedBranch?: string;
  assignedCity?: string;
  dataScope?: DataScope;
  permissionOverrides?: Partial<Record<PermissionModule, Partial<ModulePermissions>>>;
  capabilityOverrides?: Partial<CapabilityMap>;
  managedByAdminUids?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type EmployeeHrStatus =
  | 'new'
  | 'onboarding'
  | 'ready'
  | 'active'
  | 'suspended'
  | 'on_leave'
  | 'terminated'
  | 'inactive';

export interface RiderStatusHistoryEntry {
  status: EmployeeHrStatus;
  date: string;
  reason: string;
  changedByUid: string;
  changedByEmail: string;
}

export interface RiderMaster {
  internalRiderId: string;
  fullName: string;
  iqamaNumber?: string;
  iqamaIssueDate?: string;
  iqamaExpiryDate?: string;
  iqamaRenewalNotes?: string;
  phone?: string;
  birthDate?: string;
  nationality?: string;
  joinDate?: string;
  exitDate?: string;
  driverLicenseNumber?: string;
  driverLicenseType?: string;
  driverLicenseIssueDate?: string;
  driverLicenseExpiryDate?: string;
  adminNotes?: string;
  city?: string;
  branch?: string;
  supervisor?: string;
  contractName?: string;
  vehicleType?: string;
  status: EmployeeHrStatus;
  statusHistory?: RiderStatusHistoryEntry[];
  customFields?: Record<string, unknown>;
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

export interface KeetaShiftSlot {
  window: string;
  status: string;
  durationRaw: string;
  durationMinutes: number | null;
  durationHours: number | null;
  qualification: string | null;
}

export interface KeetaVdaShiftWindowEntry {
  slot: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
  scheduledShifts: number | null;
  shiftHours: number | null;
  validShifts: number | null;
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
  parsedShiftSlots?: KeetaShiftSlot[];
  onShift?: string;
  validDay?: string;
  appOnlineTime: number | null;
  appOnlineTimeRaw?: string | null;
  shiftValidOnlineTime: number | null;
  shiftValidOnlineTimeRaw?: string | null;
  shiftOnlineHours: number | null;
  shiftPeAbdoOnlineHours?: number | null;
  shiftPeAbdoOnlineHoursRaw?: string | null;
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
  deliveredOver55MinProp?: number | null;
  overdueOrderTasks: number | null;
  severelyOverdueOrderTasks: number | null;
  originalHeaders?: Record<string, string>;
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
  firstOnlineDate?: string | null;
  vehicleType?: string;
  threePlId?: string;
  threePlName?: string;
  pmm?: string;
  ifNewRider?: string;
  shiftOnlineHours: number | null;
  sumValidShifts: number | null;
  shouldOnlineDays: number | null;
  totalDeliveredTasks: number | null;
  sumDeliveredAdvanceTasks?: number | null;
  onTimeDTasks: number | null;
  cancellationD: number | null;
  deliveredOver55Min: number | null;
  acceptedOrders: number | null;
  vdaScore?: number | null;
  totalDeliveryDistance: number | null;
  payableDistance: number | null;
  shiftWindows?: Record<string, string | number | null>;
  shiftsS1ToS6?: KeetaVdaShiftWindowEntry[];
  originalHeaders?: Record<string, string>;
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

export interface KeetaRankSnapshot {
  recordKey: string;
  platform: 'keeta';
  riderId: string;
  snapshotDate: string;
  snapshotMonth?: string;
  name?: string;
  currentEstimatedLevel?: string;
  rankingPercentile: number | null;
  forcedAssignmentScore: number | null;
  estimatedRewardAmount: number | null;
  onTimeRate: number | null;
  orderCompletionRate: number | null;
  didntTapDropOffTooEarly: number | null;
  orderVolume: number | null;
  originalHeaders?: Record<string, string>;
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
  ifTriggeredToday?: boolean | string | null;
  ifTriggeredTodayRaw?: string | null;
  finalInspectionResult?: string;
  totalDaysTriggeredMtd: number | null;
  totalDaysPassedMtd: number | null;
  passRateMtd: number | null;
  over90PassRate?: string;
  originalHeaders?: Record<string, string>;
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
  // Enterprise ERP Feature Flags, Expiry Windows & Custom Vocabularies
  keetaEnabled?: boolean;
  keetaHidden?: boolean;
  expiryAlertDays?: number[];
  customVehicleTypes?: string[];
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
  customFields?: Record<string, unknown>;
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
  entityType?: string;
  actorUid: string;
  actorEmail: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  source?: 'UI' | 'API' | 'Import' | 'System';
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
  withinFileDuplicateConflicts?: number;
  rejectedCount: number;
  unknownColumns: string[];
  expectedColumns?: string[];
  detectedColumns?: string[];
  missingColumns?: string[];
}

export interface RejectedRowInfo {
  sheetName: string;
  rowNumber: number;
  riderIdRaw: string;
  columnName?: string;
  rawValue?: string;
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

// ==========================================
// ENTERPRISE ERP MODULE TYPES
// ==========================================

export interface DocumentTypeConfig {
  typeId: string;
  nameAr: string;
  nameEn: string;
  targetEntity: 'rider' | 'vehicle' | 'handover';
  requiresExpiry: boolean;
  isDefault: boolean;
  active: boolean;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentVersionEntry {
  version: number;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedByUid: string;
  uploadedByEmail: string;
  uploadedAt: string;
  note?: string;
}

export interface PrivateDocumentRecord {
  docId: string;
  entityType: 'rider' | 'vehicle' | 'handover' | 'custom_field' | 'branding';
  entityId: string;
  entityLabel?: string;
  docTypeId: string;
  docTypeName: string;
  title: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  currentVersion: number;
  versions: DocumentVersionEntry[];
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PlatformCatalogEntry {
  platformId: string;
  name: string;
  nameAr: string;
  enabled: boolean;
  hiddenFromUi: boolean;
  operationalImportEnabled: boolean;
  supportsExcelImport: boolean;
  isBuiltIn: boolean;
  description?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type PlatformAccountStatus = 'active' | 'suspended' | 'inactive';
export type PlatformLinkingStatus = 'linked' | 'unlinked' | 'conflict_review';

export interface PlatformAccount {
  accountId: string;
  companyRiderId: string;
  platformId: string;
  platformName: string;
  platformRiderId: string;
  startDate?: string;
  deactivationDate?: string;
  accountStatus: PlatformAccountStatus;
  linkingStatus: PlatformLinkingStatus;
  conflictCandidateRiderIds?: string[];
  branch?: string;
  city?: string;
  supervisor?: string;
  vehicleType?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type VehicleStatus =
  | 'available'
  | 'assigned'
  | 'maintenance'
  | 'out_of_service'
  | 'leased_out'
  | 'ended';

export type VehicleOwnershipType = 'owned' | 'leased';

export interface VehicleMaster {
  vehicleInternalId: string;
  plateNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  year: number | null;
  color?: string;
  vin?: string;
  ownershipType: VehicleOwnershipType;
  ownerOrLeasingCompany?: string;
  status: VehicleStatus;
  istimaraNumber?: string;
  istimaraExpiryDate?: string;
  insuranceCompany?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: string;
  periodicInspectionExpiryDate?: string;
  currentRiderId?: string;
  currentAssignmentId?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VehicleAssignment {
  assignmentId: string;
  vehicleInternalId: string;
  plateNumber: string;
  companyRiderId: string;
  riderName?: string;
  handoverDate: string;
  handoverTime?: string;
  handoverOdometer: number | null;
  handoverCondition: string;
  handoverNotes?: string;
  handoverDocIds?: string[];
  handoverByUid: string;
  handoverByEmail: string;
  returnDate?: string;
  returnTime?: string;
  returnOdometer?: number | null;
  returnCondition?: string;
  returnNotes?: string;
  returnDamageNotes?: string;
  returnDocIds?: string[];
  returnByUid?: string;
  returnByEmail?: string;
  status: 'active' | 'returned';
  allowSharedOverride?: boolean;
  customFields?: Record<string, unknown>;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VehicleMaintenanceRecord {
  maintenanceId: string;
  vehicleInternalId: string;
  plateNumber: string;
  maintenanceType: string;
  maintenanceDate: string;
  cost: number | null;
  odometer: number | null;
  workshop?: string;
  details?: string;
  nextMaintenanceDate?: string;
  nextMaintenanceOdometer?: number | null;
  customFields?: Record<string, unknown>;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type EntityNoteTargetType = 'general' | 'rider' | 'vehicle' | 'platform_account';
export type EntityNoteStatus = 'open' | 'in_progress' | 'closed';

export interface EntityNoteTask {
  noteTaskId: string;
  entityType: EntityNoteTargetType;
  entityId: string;
  entityLabel?: string;
  title: string;
  content: string;
  priority: OperationalCasePriority;
  status: EntityNoteStatus;
  assigneeUid?: string;
  assigneeEmail?: string;
  dueDate?: string;
  actionTaken?: string;
  resolutionNote?: string;
  closedAt?: string;
  closedByEmail?: string;
  customFields?: Record<string, unknown>;
  createdByUid: string;
  createdByEmail: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

// ==========================================
// ENTERPRISE SYSTEM BUILDER & CUSTOMIZATION TYPES
// ==========================================

export type DynamicFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'image'
  | 'pdf'
  | 'file'
  | 'checkbox'
  | 'dropdown'
  | 'multiselect'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'url'
  | 'percentage'
  | 'formula';

export type DynamicModuleBinding =
  | 'hr'
  | 'fleet'
  | 'operations'
  | 'executive'
  | 'applications'
  | 'custom';

export interface DynamicFieldOption {
  value: string;
  labelAr: string;
  labelEn?: string;
  color?: string;
}

export interface DynamicFieldValidation {
  min?: number | null;
  max?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string;
  customErrorAr?: string;
}

export interface DynamicFieldFileConfig {
  multiple?: boolean;
  maxSizeMb?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
}

export interface DynamicFieldPermissions {
  viewRoles: string[];
  editRoles: string[];
}

export interface DynamicFieldDefinition {
  fieldId: string;
  key: string;
  labelAr: string;
  labelEn: string;
  description?: string;
  placeholderAr?: string;
  type: DynamicFieldType;
  module: DynamicModuleBinding;
  formId: string;
  order: number;
  required: boolean;
  visible: boolean;
  editable: boolean;
  showInTable?: boolean;
  isCore?: boolean;
  archived?: boolean;
  defaultValue?: string | number | boolean | string[] | null;
  options?: DynamicFieldOption[];
  validation?: DynamicFieldValidation;
  fileConfig?: DynamicFieldFileConfig;
  formulaExpression?: string;
  permissions?: DynamicFieldPermissions;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type DynamicFormLayoutMode = 'sections' | 'tabs' | 'wizard';
export type DynamicFieldWidth = 'full' | 'half' | 'third';

export interface DynamicFormSection {
  sectionId: string;
  titleAr: string;
  titleEn?: string;
  descriptionAr?: string;
  order: number;
  collapsible?: boolean;
}

export interface DynamicFormFieldPlacement {
  fieldId: string;
  fieldKey: string;
  sectionId: string;
  order: number;
  width: DynamicFieldWidth;
  hidden?: boolean;
  readonly?: boolean;
  requiredOverride?: boolean;
}

export interface DynamicFormDefinition {
  formId: string;
  nameAr: string;
  nameEn: string;
  description?: string;
  module: DynamicModuleBinding;
  targetEntity: string;
  layoutMode: DynamicFormLayoutMode;
  sections: DynamicFormSection[];
  placements: DynamicFormFieldPlacement[];
  draftSections?: DynamicFormSection[];
  draftPlacements?: DynamicFormFieldPlacement[];
  draftLayoutMode?: DynamicFormLayoutMode;
  hasUnpublishedDraft?: boolean;
  publishedVersion: number;
  status: 'published' | 'draft';
  updatedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DynamicFormVersion {
  versionId: string;
  formId: string;
  versionNumber: number;
  layoutMode: DynamicFormLayoutMode;
  sections: DynamicFormSection[];
  placements: DynamicFormFieldPlacement[];
  changeNote?: string;
  publishedByUid: string;
  publishedByEmail: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
}

export interface SystemSectionConfig {
  sectionId: string;
  titleAr: string;
  titleEn: string;
  description?: string;
  iconName: string;
  order: number;
  visible: boolean;
  isBuiltIn: boolean;
  archived?: boolean;
  allowedRoles?: string[];
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemPageConfig {
  pageId: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  description?: string;
  sectionId: string;
  formId: string;
  iconName: string;
  order: number;
  visible: boolean;
  isBuiltIn: boolean;
  archived?: boolean;
  allowedRoles?: string[];
  tableColumns?: string[];
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomEntityRecord {
  recordId: string;
  pageId: string;
  formId: string;
  title: string;
  status?: string;
  branch?: string;
  city?: string;
  customFields: Record<string, unknown>;
  archived?: boolean;
  createdByUid: string;
  createdByEmail: string;
  updatedByEmail?: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanyProfileConfig {
  companyNameAr: string;
  companyNameEn: string;
  shortName?: string;
  vatNumber?: string;
  crNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  website?: string;
  responsibleManager?: string;
  officialFooterText?: string;
}

export interface VisualBrandingConfig {
  systemNameAr: string;
  systemNameEn: string;
  primaryLogoKey?: string;
  alternateLogoKey?: string;
  iconLogoKey?: string;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  sidebarColor: string;
  uiStyleMode: 'corporate' | 'modern' | 'compact';
  defaultThemeMode: 'light' | 'dark';
  loginScreenStyle: 'split' | 'centered' | 'minimal';
  loginHeadlineAr?: string;
  loginSubheadlineAr?: string;
}

export interface DeveloperCreditsConfig {
  systemTitle: string;
  systemSummary: string;
  developerName: string;
  developerPhone: string;
  version: string;
  lastUpdated: string;
  systemStatus: string;
  copyrightText: string;
  changelog: Array<{ version: string; date: string; notes: string }>;
}

export interface CompanyBrandingDoc {
  brandingId: string;
  company: CompanyProfileConfig;
  branding: VisualBrandingConfig;
  credits: DeveloperCreditsConfig;
  updatedByEmail?: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SavedViewConfig {
  viewId: string;
  scope: string;
  nameAr: string;
  filters: Record<string, unknown>;
  visibleColumns?: string[];
  columnOrder?: string[];
  isShared: boolean;
  ownerUid: string;
  ownerEmail: string;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardWidgetPref {
  widgetId: string;
  visible: boolean;
  order: number;
}

export interface TableColumnPref {
  visibleColumns: string[];
  columnOrder: string[];
  customLabels?: Record<string, string>;
}

export interface UserPreferenceDoc {
  userId: string;
  defaultNav?: string;
  dashboardDateWindow?: 'today' | '7d' | '30d' | 'month';
  dashboardWidgets?: DashboardWidgetPref[];
  tableColumns?: Record<string, TableColumnPref>;
  sidebarCollapsed?: boolean;
  createdByUid: string;
  allowedUids: string[];
  updatedAt?: string;
}

export interface NotificationRuleConfig {
  ruleId: string;
  nameAr: string;
  description?: string;
  module: string;
  eventType: string;
  severity: 'critical' | 'warning' | 'info';
  thresholdDaysOrValue?: number | null;
  targetRoles: string[];
  enabled: boolean;
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TrashItemRecord {
  trashId: string;
  itemType: 'dynamic_field' | 'dynamic_form' | 'system_section' | 'system_page' | 'custom_record' | 'rider' | 'vehicle';
  sourceCollection: string;
  sourceDocId: string;
  titleAr: string;
  summary?: string;
  snapshotJson: string;
  deletedByUid: string;
  deletedByEmail: string;
  restoredAt?: string;
  restoredByEmail?: string;
  status: 'deleted' | 'restored' | 'purged';
  createdByUid: string;
  allowedUids: string[];
  createdAt?: string;
}

export interface ConfigSnapshotRecord {
  snapshotId: string;
  nameAr: string;
  description?: string;
  payloadJson: string;
  createdByUid: string;
  createdByEmail: string;
  allowedUids: string[];
  createdAt?: string;
}

export interface CustomReportTemplate {
  templateId: string;
  nameAr: string;
  dataSource: 'riders' | 'vehicles' | 'operations_daily' | 'expiries' | 'maintenance' | 'custom_page';
  customPageId?: string;
  columns: Array<{ key: string; labelAr: string }>;
  headerTitle: string;
  headerSubtitle?: string;
  footerNote?: string;
  preparerName?: string;
  includeCompanyLogo: boolean;
  includeCompanyDetails: boolean;
  orientation: 'landscape' | 'portrait';
  createdByUid: string;
  createdByEmail: string;
  allowedUids: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemBackupSummary {
  backupId: string;
  fileName: string;
  type: 'manual' | 'auto_daily' | 'pre_reset';
  createdAt: string;
  createdBy: string;
  sizeBytes: number;
  totalDocuments: number;
  vaultFileCount: number;
  checksum: string;
  note?: string;
}

export interface BackupSchedulerConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  retentionDays: number;
  lastRunDate: string;
  lastRunAt: string;
  lastBackupId: string;
  lastStatus: string;
}
