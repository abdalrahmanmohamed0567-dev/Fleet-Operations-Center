import type {
  AccessoryCheckItem,
  DocumentComplianceStatus,
  FleetApprovalRequest,
  FleetApprovalRequestType,
  FleetConfigSettings,
  FleetNotificationRecord,
  InspectionCheckItem,
  PhotoEvidenceSlot,
  PrivateDocumentRecord,
  RiderMaster,
  VehicleAssignment,
  VehicleCustody,
  VehicleDamageClaim,
  VehicleDocumentCategory,
  VehicleDocumentRecord,
  VehicleFuelType,
  VehicleHandoverRecord,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleMovementHistoryEntry,
  VehicleOwnershipType,
  VehicleReturnRecord,
  VehicleSourceType,
  VehicleStatus,
  VehicleStatusHistoryEntry,
} from '../types/fleet';
import { getActiveAuthToken } from './firebase';
import { safeParseJsonResponse } from './safeFetch';

export interface VehicleAvailabilityDocState {
  category: VehicleDocumentCategory;
  labelAr: string;
  expiryDate?: string;
  daysRemaining: number | null;
  status: DocumentComplianceStatus;
}

export interface VehicleAvailabilityItem {
  vehicleInternalId: string;
  plateNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  sourceType: VehicleSourceType;
  branch?: string;
  city?: string;
  status: VehicleStatus;
  readyToDispatch: boolean;
  complianceStatus: 'compliant' | 'expiring_soon' | 'blocked';
  blockingReasons: string[];
  missingMandatoryDocs: VehicleDocumentCategory[];
  expiredMandatoryDocs: VehicleDocumentCategory[];
  expiringDocs: VehicleAvailabilityDocState[];
  hasActiveCustody: boolean;
  activeCustodyId?: string;
  currentRiderId?: string;
}

export interface FleetOverviewPayload {
  vehicles: VehicleMaster[];
  assignments: VehicleAssignment[];
  custodies: VehicleCustody[];
  handovers: VehicleHandoverRecord[];
  returns: VehicleReturnRecord[];
  maintenance: VehicleMaintenanceRecord[];
  approvals: FleetApprovalRequest[];
  vehicleDocuments: VehicleDocumentRecord[];
  damageClaims: VehicleDamageClaim[];
  statusHistory: VehicleStatusHistoryEntry[];
  movementHistory: VehicleMovementHistoryEntry[];
  notifications: FleetNotificationRecord[];
  fleetConfig: FleetConfigSettings;
  availability: VehicleAvailabilityItem[];
}

export interface FleetAvailabilityResponse {
  items: VehicleAvailabilityItem[];
  summary: {
    total: number;
    readyToDispatch: number;
    blocked: number;
    compliant: number;
    expiringSoon: number;
    docBlocked: number;
  };
  fleetConfig: FleetConfigSettings;
}

export interface VehicleProfile360Response {
  vehicle: VehicleMaster;
  availability: VehicleAvailabilityItem;
  activeCustody: VehicleCustody | null;
  currentRider: RiderMaster | null;
  custodies: VehicleCustody[];
  handovers: VehicleHandoverRecord[];
  returns: VehicleReturnRecord[];
  vehicleDocuments: VehicleDocumentRecord[];
  privateDocuments: PrivateDocumentRecord[];
  maintenance: VehicleMaintenanceRecord[];
  damageClaims: VehicleDamageClaim[];
  approvals: FleetApprovalRequest[];
  statusHistory: VehicleStatusHistoryEntry[];
  movementHistory: VehicleMovementHistoryEntry[];
}

export interface CreateOrUpdateVehiclePayload {
  vehicleInternalId?: string;
  plateNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  year?: number | null;
  color?: string;
  vin?: string;
  ownershipType?: VehicleOwnershipType;
  sourceType?: VehicleSourceType;
  ownerOrLeasingCompany?: string;
  branch?: string;
  city?: string;
  fuelType?: VehicleFuelType;
  currentOdometer?: number | null;
  status?: VehicleStatus;
  istimaraNumber?: string;
  istimaraExpiryDate?: string;
  insuranceCompany?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: string;
  periodicInspectionExpiryDate?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
}

function createIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

async function fleetFetch<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    idempotencyPrefix?: string;
  } = {}
): Promise<T> {
  const token = await getActiveAuthToken();
  if (!token) {
    throw new Error('انتهت جلسة تسجيل الدخول. يرجى إعادة تسجيل الدخول.');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyPrefix) {
    headers['Idempotency-Key'] = createIdempotencyKey(options.idempotencyPrefix);
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = await safeParseJsonResponse<{ ok?: boolean; error?: string } & T>(res);
  if (!res.ok) {
    throw new Error(json?.error || `تعذر إتمام عملية الأسطول (رمز ${res.status}).`);
  }
  return json as T;
}

export async function fetchFleetOverview(): Promise<FleetOverviewPayload> {
  return fleetFetch<FleetOverviewPayload>('/api/fleet/overview');
}

export async function fetchFleetAvailability(): Promise<FleetAvailabilityResponse> {
  return fleetFetch<FleetAvailabilityResponse>('/api/fleet/availability');
}

export async function fetchVehicleProfile360(vehicleId: string): Promise<VehicleProfile360Response> {
  return fleetFetch<VehicleProfile360Response>(`/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/profile360`);
}

export async function createFleetVehicle(
  payload: CreateOrUpdateVehiclePayload
): Promise<{ ok: boolean; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }> {
  return fleetFetch('/api/fleet/vehicles', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'veh_create',
  });
}

export async function updateFleetVehicle(
  vehicleId: string,
  payload: Partial<CreateOrUpdateVehiclePayload>
): Promise<{ ok: boolean; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }> {
  return fleetFetch(`/api/fleet/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: 'PATCH',
    body: payload,
    idempotencyPrefix: 'veh_upd',
  });
}

export async function transitionFleetVehicleStatus(
  vehicleId: string,
  payload: { toStatus: VehicleStatus; reason?: string }
): Promise<{ ok: boolean; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }> {
  return fleetFetch(`/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/status`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'veh_stat',
  });
}

export async function runFleetMigrationSync(createPreMigrationBackup = false): Promise<{
  ok: boolean;
  backupCreated?: string;
  vehiclesNormalized: number;
  custodiesBackfilled: number;
  handoversBackfilled: number;
  statusHistoriesSeeded: number;
  movementHistoriesSeeded: number;
  vehicleDocsSeeded: number;
  maintenanceUpgraded: number;
  ranAt: string;
}> {
  return fleetFetch('/api/fleet/migration/sync', {
    method: 'POST',
    body: { createPreMigrationBackup },
    idempotencyPrefix: 'fleet_mig',
  });
}

// ==========================================
// VAULT UPLOAD HELPER FOR FLEET ATTACHMENTS
// ==========================================

export async function uploadFleetVaultFile(params: {
  file: File;
  entityType: 'handover' | 'return' | 'delegation' | 'vehicle_doc' | 'maintenance' | 'damage_claim';
  entityId: string;
  entityLabel: string;
  docTypeId: string;
  docTypeName: string;
  title: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
}): Promise<PrivateDocumentRecord> {
  const token = await getActiveAuthToken();
  if (!token) {
    throw new Error('انتهت جلسة تسجيل الدخول.');
  }
  const fd = new FormData();
  fd.append('file', params.file);
  fd.append('entityType', params.entityType);
  fd.append('entityId', params.entityId);
  fd.append('entityLabel', params.entityLabel);
  fd.append('docTypeId', params.docTypeId);
  fd.append('docTypeName', params.docTypeName);
  fd.append('title', params.title);
  if (params.issueDate) fd.append('issueDate', params.issueDate);
  if (params.expiryDate) fd.append('expiryDate', params.expiryDate);
  if (params.notes) fd.append('notes', params.notes);

  const res = await fetch('/api/documents/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await safeParseJsonResponse<{ document?: PrivateDocumentRecord; doc?: PrivateDocumentRecord; error?: string }>(res);
  const uploadedDoc = json?.document || json?.doc;
  if (!res.ok || !uploadedDoc) {
    throw new Error(json?.error || 'تعذر رفع الملف إلى الخزينة.');
  }
  return uploadedDoc;
}

// ==========================================
// PHASE 3: ASSIGNMENT REQUESTS, APPROVALS & DELEGATIONS
// ==========================================

export async function requestFleetAssignment(payload: {
  vehicleInternalId: string;
  riderId: string;
  requestType?: FleetApprovalRequestType;
  requestReason?: string;
  delegationNumber?: string;
  delegationStartDate?: string;
  delegationExpiryDate?: string;
}): Promise<{ ok: boolean; approval: FleetApprovalRequest; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }> {
  return fleetFetch('/api/fleet/assignments/request', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'asg_req',
  });
}

export async function decideFleetOperationsApproval(
  requestId: string,
  payload: { decision: 'approved' | 'rejected'; note?: string }
): Promise<{ ok: boolean; approval: FleetApprovalRequest; vehicle: VehicleMaster }> {
  return fleetFetch(`/api/fleet/approvals/${encodeURIComponent(requestId)}/operations-decision`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'ops_dec',
  });
}

export async function decideFleetAdminApproval(
  requestId: string,
  payload: { decision: 'approved' | 'rejected'; note?: string }
): Promise<{ ok: boolean; approval: FleetApprovalRequest; vehicle: VehicleMaster }> {
  return fleetFetch(`/api/fleet/approvals/${encodeURIComponent(requestId)}/admin-decision`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'adm_dec',
  });
}

export async function attachDelegationToApproval(
  requestId: string,
  payload: {
    delegationNumber: string;
    delegationStartDate: string;
    delegationExpiryDate: string;
    privateDocId?: string;
    issuerName?: string;
    notes?: string;
  }
): Promise<{ ok: boolean; approval: FleetApprovalRequest; vehicleDocument: VehicleDocumentRecord }> {
  return fleetFetch(`/api/fleet/approvals/${encodeURIComponent(requestId)}/delegation`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'del_att',
  });
}

export async function cancelFleetApproval(
  requestId: string,
  reason?: string
): Promise<{ ok: boolean; approval: FleetApprovalRequest; vehicle: VehicleMaster }> {
  return fleetFetch(`/api/fleet/approvals/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    body: { reason },
    idempotencyPrefix: 'req_can',
  });
}

// ==========================================
// PHASE 4: HANDOVERS, RETURNS & CUSTODY TRANSFERS
// ==========================================

export async function executeFleetHandover(payload: {
  vehicleInternalId: string;
  riderId: string;
  approvalRequestId?: string;
  handoverType?: VehicleHandoverRecord['handoverType'];
  handoverDate: string;
  handoverTime?: string;
  odometer: number | null;
  fuelLevel: string;
  overallCondition: string;
  notes?: string;
  checklist?: InspectionCheckItem[];
  accessories?: AccessoryCheckItem[];
  photoSlots?: PhotoEvidenceSlot[];
  riderAcknowledged: boolean;
  riderAcknowledgmentMethod?: VehicleHandoverRecord['riderAcknowledgmentMethod'];
  directOverride?: boolean;
  customFields?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  custody: VehicleCustody;
  handover: VehicleHandoverRecord;
  assignment: VehicleAssignment;
  vehicle: VehicleMaster;
}> {
  return fleetFetch('/api/fleet/handovers', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'hnd_exec',
  });
}

export async function executeFleetReturn(payload: {
  vehicleInternalId: string;
  custodyId?: string;
  returnDate: string;
  returnTime?: string;
  odometerAtReturn: number | null;
  fuelLevelAtReturn: string;
  overallCondition: string;
  checklist?: InspectionCheckItem[];
  accessories?: AccessoryCheckItem[];
  photoSlots?: PhotoEvidenceSlot[];
  damageDetected: boolean;
  damageSummary?: string;
  damageSeverity?: VehicleDamageClaim['severity'];
  estimatedRepairCost?: number | null;
  damageLiability?: VehicleDamageClaim['liability'];
  recommendedNextStatus: 'available' | 'maintenance' | 'stopped';
  finalizeImmediately?: boolean;
  notes?: string;
}): Promise<{
  ok: boolean;
  returnRecord: VehicleReturnRecord;
  custody: VehicleCustody;
  damageClaim: VehicleDamageClaim | null;
  vehicle: VehicleMaster;
}> {
  return fleetFetch('/api/fleet/returns', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'ret_exec',
  });
}

export async function approveFleetPendingReturn(
  returnId: string,
  payload: { nextVehicleStatus?: 'available' | 'maintenance' | 'stopped'; note?: string }
): Promise<{
  ok: boolean;
  returnRecord: VehicleReturnRecord;
  custody: VehicleCustody;
  vehicle: VehicleMaster;
}> {
  return fleetFetch(`/api/fleet/returns/${encodeURIComponent(returnId)}/approve`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'ret_app',
  });
}

export async function transferFleetCustody(
  custodyId: string,
  payload: {
    toRiderId: string;
    transferDate: string;
    odometer: number | null;
    fuelLevel?: string;
    condition?: string;
    notes?: string;
  }
): Promise<{
  ok: boolean;
  closedCustody: VehicleCustody;
  newCustody: VehicleCustody;
  vehicle: VehicleMaster;
}> {
  return fleetFetch(`/api/fleet/custodies/${encodeURIComponent(custodyId)}/transfer`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'cust_trf',
  });
}

// ==========================================
// PHASE 5: MAINTENANCE, DAMAGE CLAIMS & STRUCTURED DOCUMENTS
// ==========================================

export async function createFleetMaintenanceWorkOrder(payload: {
  vehicleInternalId: string;
  maintenanceType: string;
  maintenanceDate: string;
  estimatedCost?: number | null;
  cost?: number | null;
  odometer?: number | null;
  workshop?: string;
  details?: string;
  nextMaintenanceDate?: string;
  nextMaintenanceOdometer?: number | null;
  stopVehicle?: boolean;
  requireCostApproval?: boolean;
  invoiceDocId?: string;
  customFields?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  maintenance: VehicleMaintenanceRecord;
  approval: FleetApprovalRequest | null;
  vehicle: VehicleMaster;
}> {
  return fleetFetch('/api/fleet/maintenance', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'mnt_new',
  });
}

export async function completeFleetMaintenanceWorkOrder(
  maintenanceId: string,
  payload: {
    actualCost: number | null;
    completedOdometer?: number | null;
    completedAt?: string;
    invoiceDocId?: string;
    releaseVehicleToAvailable?: boolean;
    details?: string;
  }
): Promise<{
  ok: boolean;
  maintenance: VehicleMaintenanceRecord;
  vehicle: VehicleMaster;
}> {
  return fleetFetch(`/api/fleet/maintenance/${encodeURIComponent(maintenanceId)}/complete`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'mnt_cmp',
  });
}

export async function updateFleetDamageClaim(
  claimId: string,
  payload: {
    liability?: VehicleDamageClaim['liability'];
    status?: VehicleDamageClaim['status'];
    actualRepairCost?: number | null;
    notes?: string;
  }
): Promise<{ ok: boolean; claim: VehicleDamageClaim; vehicle: VehicleMaster | null }> {
  return fleetFetch(`/api/fleet/damage-claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    body: payload,
    idempotencyPrefix: 'clm_upd',
  });
}

export async function upsertFleetDocument(payload: {
  vehicleDocId?: string;
  vehicleInternalId: string;
  docCategory: VehicleDocumentCategory;
  titleAr?: string;
  documentNumber?: string;
  issuerName?: string;
  issueDate?: string;
  expiryDate?: string;
  privateDocId?: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  document: VehicleDocumentRecord;
  vehicle: VehicleMaster;
  availability: VehicleAvailabilityItem;
}> {
  return fleetFetch('/api/fleet/documents', {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'vdoc_up',
  });
}

export async function decideFleetDocument(
  vehicleDocId: string,
  payload: { decision: 'approved' | 'rejected'; rejectionReason?: string }
): Promise<{
  ok: boolean;
  document: VehicleDocumentRecord;
  vehicle: VehicleMaster;
  availability: VehicleAvailabilityItem;
}> {
  return fleetFetch(`/api/fleet/documents/${encodeURIComponent(vehicleDocId)}/decision`, {
    method: 'POST',
    body: payload,
    idempotencyPrefix: 'vdoc_dec',
  });
}

// ==========================================
// PHASE 7: FLEET SETTINGS & NOTIFICATIONS
// ==========================================

export async function updateFleetSettings(
  payload: Partial<FleetConfigSettings>
): Promise<{
  ok: boolean;
  fleetConfig: FleetConfigSettings;
  vehiclesUpdated: number;
  availability: VehicleAvailabilityItem[];
}> {
  return fleetFetch('/api/fleet/settings', {
    method: 'PATCH',
    body: payload,
    idempotencyPrefix: 'flt_cfg',
  });
}

export async function markFleetNotificationsRead(payload: {
  notificationIds?: string[];
  markAll?: boolean;
}): Promise<{
  ok: boolean;
  updatedCount: number;
  notifications: FleetNotificationRecord[];
}> {
  return fleetFetch('/api/fleet/notifications/read', {
    method: 'POST',
    body: payload,
  });
}

// ==========================================
// PHASE 7: FLEET SETTINGS & NOTIFICATIONS
// ==========================================

export async function updateFleetSettings(
  payload: Partial<FleetConfigSettings>
): Promise<{
  ok: boolean;
  fleetConfig: FleetConfigSettings;
  vehiclesUpdated: number;
  availability: VehicleAvailabilityItem[];
}> {
  return fleetFetch('/api/fleet/settings', {
    method: 'PATCH',
    body: payload,
    idempotencyPrefix: 'flt_cfg',
  });
}

export async function markFleetNotificationsRead(payload: {
  notificationIds?: string[];
  markAll?: boolean;
}): Promise<{
  ok: boolean;
  updatedCount: number;
  notifications: FleetNotificationRecord[];
}> {
  return fleetFetch('/api/fleet/notifications/read', {
    method: 'POST',
    body: payload,
  });
}
