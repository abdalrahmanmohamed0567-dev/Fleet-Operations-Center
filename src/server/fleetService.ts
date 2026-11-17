import crypto from 'crypto';
import type {
  AccessoryCheckItem,
  DocumentComplianceStatus,
  FleetApprovalRequest,
  FleetApprovalRequestType,
  FleetConfigSettings,
  FleetNotificationRecord,
  FleetPermissionAction,
  IdempotencyRecord,
  InspectionCheckItem,
  OperationalSettings,
  PhotoEvidenceSlot,
  PrivateDocumentRecord,
  RiderMaster,
  VehicleAssignment,
  VehicleCustody,
  VehicleDamageClaim,
  VehicleDocumentCategory,
  VehicleDocumentRecord,
  VehicleHandoverRecord,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleMovementHistoryEntry,
  VehicleOwnershipType,
  VehicleReturnRecord,
  VehicleSourceType,
  VehicleStatus,
  VehicleStatusHistoryEntry,
} from '../types/fleet.js';
import { matchesDataScope } from '../shared/rbacCore.js';
import { buildFullSystemBackup, saveBackupToServer } from './backupService.js';
import type { VerifiedAuthUser } from './firestoreRest.js';
import {
  listLocalCollection,
  runLocalTransaction,
  type LocalTransactionContext,
  type ValidCollectionName,
} from './localStore.js';

export const DEFAULT_FLEET_CONFIG: FleetConfigSettings = {
  mandatoryDocCategories: ['istimara', 'insurance', 'periodic_inspection'],
  documentAlertDays: [30, 15, 7, 3, 0],
  delegationAlertDays: [14, 7, 3, 0],
  maintenanceAlertDays: 14,
  maintenanceAlertKm: 1000,
  singleVehiclePerRider: true,
  strictSeparationOfDuties: true,
  requireOpsAndAdminForDelegation: true,
  requirePhotosOnHandover: true,
  requirePhotosOnReturn: true,
  mandatoryPhotoSlots: [
    { slotKey: 'front', labelAr: 'الواجهة الأمامية', required: true },
    { slotKey: 'rear', labelAr: 'الجهة الخلفية', required: true },
    { slotKey: 'right', labelAr: 'الجانب الأيمن', required: true },
    { slotKey: 'left', labelAr: 'الجانب الأيسر', required: true },
    { slotKey: 'plate', labelAr: 'لوحة المركبة', required: true },
    { slotKey: 'odometer', labelAr: 'لوحة العداد', required: true },
    { slotKey: 'fuel', labelAr: 'مؤشر الوقود', required: true },
    { slotKey: 'damage', labelAr: 'مواضع الملاحظات والأضرار', required: false },
  ],
  defaultChecklistItems: [
    { itemKey: 'body_exterior', labelAr: 'سلامة الهيكل الخارجي والدهان' },
    { itemKey: 'lights_signals', labelAr: 'الإضاءة الأمامية والخلفية والإشارات' },
    { itemKey: 'tires_rims', labelAr: 'حالة الإطارات والجنوط' },
    { itemKey: 'spare_tire', labelAr: 'الإطار الاحتياطي والرافعة' },
    { itemKey: 'windshield_mirrors', labelAr: 'الزجاج الأمامي والمرايا' },
    { itemKey: 'ac_cooling', labelAr: 'كفاءة المكيف والتبريد' },
    { itemKey: 'brakes_handbrake', labelAr: 'الفرامل وفرامل اليد' },
    { itemKey: 'engine_sounds', labelAr: 'صوت المحرك وعدم وجود تهريبات' },
    { itemKey: 'interior_seats', labelAr: 'نظافة المقصورة والمقاعد' },
    { itemKey: 'battery_start', labelAr: 'البطارية وسرعة التشغيل' },
    { itemKey: 'wipers_washer', labelAr: 'المساحات ورشاش الماء' },
    { itemKey: 'horn_locks', labelAr: 'البوق وأقفال الأبواب والريموت' },
    { itemKey: 'istimara_copy', labelAr: 'نسخة الاستمارة داخل المركبة' },
    { itemKey: 'insurance_copy', labelAr: 'نسخة وثيقة التأمين' },
    { itemKey: 'safety_triangle', labelAr: 'مثلث السلامة وطفاية الحريق' },
    { itemKey: 'first_aid', labelAr: 'حقيبة الإسعافات الأولية' },
  ],
  defaultAccessories: [
    { accessoryKey: 'main_key', labelAr: 'المفتاح الرئيسي' },
    { accessoryKey: 'spare_key', labelAr: 'المفتاح الاحتياطي' },
    { accessoryKey: 'fuel_card', labelAr: 'بطاقة الوقود' },
    { accessoryKey: 'delivery_box', labelAr: 'صندوق / حقيبة التوصيل' },
    { accessoryKey: 'phone_mount', labelAr: 'حامل الجوال والشاحن' },
    { accessoryKey: 'gps_tracker', labelAr: 'جهاز التتبع (GPS)' },
  ],
  companyReportHeader: {
    showLogo: true,
    footerDisclaimerAr: 'وثيقة صادرة من مركز عمليات الأسطول — تخضع للمراجعة والاعتماد الإلكتروني.',
  },
};

export interface FleetHttpError extends Error {
  statusCode: number;
}

export function createFleetError(statusCode: number, message: string): FleetHttpError {
  const err = new Error(message) as FleetHttpError;
  err.statusCode = statusCode;
  return err;
}

const ARABIC_DIGITS_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function toAsciiDigits(input: string): string {
  return String(input || '').replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_DIGITS_MAP[ch] ?? ch);
}

export function normalizePlateNumber(plate: string): string {
  return toAsciiDigits(plate)
    .trim()
    .replace(/[\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizeVin(vin?: string): string {
  if (!vin) return '';
  return toAsciiDigits(vin)
    .trim()
    .replace(/[\s\-_]+/g, '')
    .toUpperCase();
}

export function normalizeVehicleStatus(rawStatus?: string, hasActiveCustody?: boolean): VehicleStatus {
  const st = String(rawStatus || '').trim();
  if (st === 'out_of_service' || st === 'stopped') return 'stopped';
  if (st === 'ended' || st === 'retired') return 'retired';
  if (st === 'leased_out') return hasActiveCustody ? 'assigned' : 'available';
  if (st === 'reserved') return 'reserved';
  if (st === 'pending_return_inspection') return 'pending_return_inspection';
  if (st === 'maintenance') return 'maintenance';
  if (st === 'assigned') return 'assigned';
  return 'available';
}

export function normalizeSourceType(
  sourceType?: string,
  ownershipType?: string
): { sourceType: VehicleSourceType; ownershipType: VehicleOwnershipType } {
  if (sourceType === 'other') {
    return { sourceType: 'other', ownershipType: ownershipType === 'leased' ? 'leased' : 'owned' };
  }
  if (sourceType === 'leased' || ownershipType === 'leased') {
    return { sourceType: 'leased', ownershipType: 'leased' };
  }
  return { sourceType: 'owned', ownershipType: 'owned' };
}

export function getFleetConfigFromSettings(settingsRaw: Record<string, unknown> | null | undefined): FleetConfigSettings {
  const partial =
    settingsRaw && typeof settingsRaw.fleetConfig === 'object' && settingsRaw.fleetConfig !== null
      ? (settingsRaw.fleetConfig as Partial<FleetConfigSettings>)
      : {};
  return {
    ...DEFAULT_FLEET_CONFIG,
    ...partial,
    mandatoryDocCategories: Array.isArray(partial.mandatoryDocCategories)
      ? partial.mandatoryDocCategories
      : DEFAULT_FLEET_CONFIG.mandatoryDocCategories,
    documentAlertDays:
      Array.isArray(partial.documentAlertDays) && partial.documentAlertDays.length > 0
        ? partial.documentAlertDays
        : DEFAULT_FLEET_CONFIG.documentAlertDays,
    delegationAlertDays:
      Array.isArray(partial.delegationAlertDays) && partial.delegationAlertDays.length > 0
        ? partial.delegationAlertDays
        : DEFAULT_FLEET_CONFIG.delegationAlertDays,
    mandatoryPhotoSlots:
      Array.isArray(partial.mandatoryPhotoSlots) && partial.mandatoryPhotoSlots.length > 0
        ? partial.mandatoryPhotoSlots
        : DEFAULT_FLEET_CONFIG.mandatoryPhotoSlots,
    defaultChecklistItems:
      Array.isArray(partial.defaultChecklistItems) && partial.defaultChecklistItems.length > 0
        ? partial.defaultChecklistItems
        : DEFAULT_FLEET_CONFIG.defaultChecklistItems,
    defaultAccessories:
      Array.isArray(partial.defaultAccessories) && partial.defaultAccessories.length > 0
        ? partial.defaultAccessories
        : DEFAULT_FLEET_CONFIG.defaultAccessories,
    companyReportHeader: {
      showLogo: Boolean(
        partial.companyReportHeader?.showLogo ?? DEFAULT_FLEET_CONFIG.companyReportHeader?.showLogo ?? true
      ),
      footerDisclaimerAr:
        partial.companyReportHeader?.footerDisclaimerAr ??
        DEFAULT_FLEET_CONFIG.companyReportHeader?.footerDisclaimerAr,
    },
  };
}

export function computeDaysRemainingIso(isoDate?: string, refDateIso?: string): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) return null;
  const target = new Date(`${isoDate.trim()}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const ref = (refDateIso || new Date().toISOString().slice(0, 10)).trim();
  const now = new Date(`${ref}T00:00:00Z`).getTime();
  return Math.round((target - now) / 86400000);
}

export function computeDocValidityStatus(
  expiryDate?: string,
  refDateIso?: string,
  alertDays: number[] = [30, 15, 7, 3, 0]
): DocumentComplianceStatus {
  if (!expiryDate || !expiryDate.trim()) return 'missing';
  const days = computeDaysRemainingIso(expiryDate, refDateIso);
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  const maxAlert = Math.max(...alertDays, 30);
  if (days <= maxAlert) return 'expiring_soon';
  return 'valid';
}

const DOC_CATEGORY_LABELS_AR: Record<VehicleDocumentCategory, string> = {
  istimara: 'الاستمارة (رخصة السير)',
  insurance: 'وثيقة التأمين',
  periodic_inspection: 'الفحص الدوري',
  operating_card: 'بطاقة التشغيل',
  delegation: 'تفويض القيادة',
  lease_contract: 'عقد الإيجار',
  other: 'وثيقة أخرى',
};

const VEHICLE_STATUS_LABELS_AR: Record<string, string> = {
  available: 'متاحة للتسليم',
  assigned: 'مسلمة لمندوب',
  reserved: 'محجوزة للتسليم',
  pending_return_inspection: 'بانتظار فحص الاستلام',
  maintenance: 'في الصيانة',
  stopped: 'متوقفة تشغيليًا',
  retired: 'خارج الخدمة / متقاعدة',
  out_of_service: 'خارج الخدمة',
  leased_out: 'مؤجرة',
  ended: 'منتهية العلاقة',
};

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

export function computeVehicleAvailabilityItem(params: {
  vehicle: VehicleMaster;
  vehicleDocs: VehicleDocumentRecord[];
  activeCustodies: VehicleCustody[];
  openMaintenance: VehicleMaintenanceRecord[];
  openClaims: VehicleDamageClaim[];
  config: FleetConfigSettings;
  refDateIso?: string;
}): VehicleAvailabilityItem {
  const { vehicle, vehicleDocs, activeCustodies, openMaintenance, openClaims, config, refDateIso } = params;
  const activeCustody = activeCustodies.find(
    (c) => c.vehicleInternalId === vehicle.vehicleInternalId && (c.status === 'active' || c.status === 'pending_return')
  );
  const hasActiveCustody = Boolean(activeCustody || vehicle.activeCustodyId || vehicle.currentRiderId);
  const canonicalStatus = normalizeVehicleStatus(vehicle.status, hasActiveCustody);

  const blockingReasons: string[] = [];
  if (canonicalStatus !== 'available') {
    blockingReasons.push(`حالة المركبة الحالية (${VEHICLE_STATUS_LABELS_AR[canonicalStatus] || canonicalStatus}) تمنع التسليم المباشر.`);
  }
  if (hasActiveCustody) {
    blockingReasons.push('المركبة مرتبطة بعهدة نشطة حالياً.');
  }
  if (vehicle.reservedForRequestId) {
    blockingReasons.push(`المركبة محجوزة لطلب ربط رقم (${vehicle.reservedForRequestId}).`);
  }

  const blockingMaint = openMaintenance.filter(
    (m) =>
      m.vehicleInternalId === vehicle.vehicleInternalId &&
      m.workflowStatus &&
      ['open', 'in_progress', 'awaiting_approval'].includes(m.workflowStatus) &&
      m.vehicleWasStopped
  );
  if (blockingMaint.length > 0) {
    blockingReasons.push(`يوجد أمر صيانة مفتوح يوقف التشغيل (${blockingMaint[0].workOrderNumber || blockingMaint[0].maintenanceId}).`);
  }

  const criticalClaims = openClaims.filter(
    (cl) =>
      cl.vehicleInternalId === vehicle.vehicleInternalId &&
      ['major', 'critical'].includes(cl.severity) &&
      cl.status !== 'settled' &&
      cl.status !== 'closed'
  );
  if (criticalClaims.length > 0) {
    blockingReasons.push('يوجد بلاغ ضرر جسيم غير مغلق على المركبة.');
  }

  const docsForVeh = vehicleDocs.filter((d) => d.vehicleInternalId === vehicle.vehicleInternalId);
  const missingMandatoryDocs: VehicleDocumentCategory[] = [];
  const expiredMandatoryDocs: VehicleDocumentCategory[] = [];
  const expiringDocs: VehicleAvailabilityDocState[] = [];

  for (const cat of config.mandatoryDocCategories) {
    const linkedDoc = docsForVeh
      .filter((d) => d.docCategory === cat && d.approvalStatus !== 'rejected')
      .sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || '')))[0];

    let expiryDate = linkedDoc?.expiryDate;
    if (!expiryDate) {
      if (cat === 'istimara') expiryDate = vehicle.istimaraExpiryDate;
      if (cat === 'insurance') expiryDate = vehicle.insuranceExpiryDate;
      if (cat === 'periodic_inspection') expiryDate = vehicle.periodicInspectionExpiryDate;
    }

    const docStatus = computeDocValidityStatus(expiryDate, refDateIso, config.documentAlertDays);
    const daysRemaining = computeDaysRemainingIso(expiryDate, refDateIso);
    const labelAr = DOC_CATEGORY_LABELS_AR[cat] || cat;

    if (docStatus === 'missing') {
      missingMandatoryDocs.push(cat);
      blockingReasons.push(`وثيقة إلزامية مفقودة أو غير محددة التاريخ: ${labelAr}.`);
    } else if (docStatus === 'expired') {
      expiredMandatoryDocs.push(cat);
      blockingReasons.push(`وثيقة إلزامية منتهية الصلاحية: ${labelAr} (${expiryDate}).`);
    } else if (docStatus === 'expiring_soon') {
      expiringDocs.push({ category: cat, labelAr, expiryDate, daysRemaining, status: docStatus });
    }
  }

  const complianceStatus: VehicleAvailabilityItem['complianceStatus'] =
    missingMandatoryDocs.length > 0 || expiredMandatoryDocs.length > 0
      ? 'blocked'
      : expiringDocs.length > 0
        ? 'expiring_soon'
        : 'compliant';

  const readyToDispatch = canonicalStatus === 'available' && blockingReasons.length === 0;

  return {
    vehicleInternalId: vehicle.vehicleInternalId,
    plateNumber: vehicle.plateNumber,
    vehicleType: vehicle.vehicleType,
    make: vehicle.make,
    model: vehicle.model,
    sourceType: vehicle.sourceType || (vehicle.ownershipType === 'leased' ? 'leased' : 'owned'),
    branch: vehicle.branch,
    city: vehicle.city,
    status: canonicalStatus,
    readyToDispatch,
    complianceStatus,
    blockingReasons,
    missingMandatoryDocs,
    expiredMandatoryDocs,
    expiringDocs,
    hasActiveCustody,
    activeCustodyId: activeCustody?.custodyId || vehicle.activeCustodyId,
    currentRiderId: activeCustody?.riderId || vehicle.currentRiderId,
  };
}

export function hasFleetPermOnUser(user: VerifiedAuthUser, perm: FleetPermissionAction): boolean {
  if (user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin') return true;
  if (user.fleetPermissions && typeof user.fleetPermissions[perm] === 'boolean') {
    return user.fleetPermissions[perm];
  }
  // Fallback safety mapping if fleetPermissions weren't hydrated
  if (perm === 'fleet.view') return Boolean(user.permissions?.fleet?.view);
  if (perm === 'fleet.create') return Boolean(user.permissions?.fleet?.add);
  if (perm === 'fleet.edit') return Boolean(user.permissions?.fleet?.edit);
  if (perm === 'fleet.delete') return Boolean(user.permissions?.fleet?.delete);
  return false;
}

export function assertFleetPermission(user: VerifiedAuthUser, perm: FleetPermissionAction, messageAr?: string): void {
  if (!hasFleetPermOnUser(user, perm)) {
    throw createFleetError(403, messageAr || `صلاحيات حسابك لا تسمح بهذا الإجراء (${perm}).`);
  }
}

export function isVehicleInUserScope(vehicle: VehicleMaster, user: VerifiedAuthUser): boolean {
  if (user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin') return true;
  const scope = user.dataScope;
  if (!scope) return true;
  if (Array.isArray(scope.vehicleIds) && scope.vehicleIds.length > 0 && !scope.vehicleIds.includes(vehicle.vehicleInternalId)) {
    return false;
  }
  if (scope.allBranches && (!scope.cities || scope.cities.length === 0)) {
    return true;
  }
  return matchesDataScope(
    {
      branch: vehicle.branch,
      city: vehicle.city,
      internalRiderId: vehicle.currentRiderId,
      vehicleInternalId: vehicle.vehicleInternalId,
    },
    scope
  );
}

async function resolveTeamAllowedUidsTx(tx: LocalTransactionContext, callerUid: string): Promise<string[]> {
  const users = await tx.list<{ uid?: string; active?: boolean }>('users');
  const set = new Set<string>([
    callerUid,
    ...users.filter((u) => u.active && typeof u.uid === 'string').map((u) => String(u.uid)),
  ]);
  return Array.from(set).filter(Boolean).slice(0, 20);
}

function generateSequentialCode(prefix: string, existingIds: string[], pad = 4): string {
  let max = 0;
  const rx = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const id of existingIds) {
    const m = rx.exec(String(id || '').trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(pad, '0')}`;
}

async function checkIdempotencyTx<T>(
  tx: LocalTransactionContext,
  idempotencyKey: string | undefined,
  endpoint: string,
  actorUid: string
): Promise<T | null> {
  if (!idempotencyKey) return null;
  const safeKey = `idem_${crypto.createHash('sha256').update(`${endpoint}:${actorUid}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
  const existing = (await tx.get('idempotencyKeys', safeKey)) as IdempotencyRecord | null;
  if (existing && existing.responseBody) {
    return existing.responseBody as T;
  }
  return null;
}

async function saveIdempotencyTx(
  tx: LocalTransactionContext,
  idempotencyKey: string | undefined,
  endpoint: string,
  actorUid: string,
  statusCode: number,
  responseBody: unknown
): Promise<void> {
  if (!idempotencyKey) return;
  const safeKey = `idem_${crypto.createHash('sha256').update(`${endpoint}:${actorUid}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
  const record: IdempotencyRecord = {
    idempotencyKey: safeKey,
    endpoint,
    actorUid,
    statusCode,
    responseBody,
    createdAt: now.toISOString(),
    expiresAt,
  };
  await tx.set('idempotencyKeys', safeKey, record as unknown as Record<string, unknown>);
}

async function appendAuditAndMovementTx(params: {
  tx: LocalTransactionContext;
  user: VerifiedAuthUser;
  allowedUids: string[];
  vehicle: VehicleMaster;
  movementType: VehicleMovementHistoryEntry['movementType'];
  summaryAr: string;
  auditAction: string;
  auditDetails: string;
  referenceType?: string;
  referenceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  odometer?: number | null;
  riderId?: string;
  riderName?: string;
  nowIso: string;
}): Promise<void> {
  const { tx, user, allowedUids, vehicle, nowIso } = params;
  const movId = `mov_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const mov: VehicleMovementHistoryEntry = {
    movementId: movId,
    vehicleInternalId: vehicle.vehicleInternalId,
    plateNumber: vehicle.plateNumber,
    movementType: params.movementType,
    summaryAr: params.summaryAr,
    riderId: params.riderId,
    riderName: params.riderName,
    odometer: params.odometer ?? vehicle.currentOdometer ?? null,
    referenceType: params.referenceType || 'vehicle',
    referenceId: params.referenceId || vehicle.vehicleInternalId,
    actorUid: user.uid,
    actorEmail: user.email,
    occurredAt: nowIso,
    allowedUids,
  };
  await tx.set('vehicleMovementHistory', movId, mov as unknown as Record<string, unknown>);

  const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await tx.set('auditLogs', logId, {
    logId,
    action: params.auditAction,
    targetCollection: 'vehicles',
    targetId: vehicle.vehicleInternalId,
    entityType: 'vehicle',
    actorUid: user.uid,
    actorEmail: user.email,
    details: params.auditDetails,
    oldValue: params.oldValue !== undefined ? JSON.stringify(params.oldValue).slice(0, 1800) : undefined,
    newValue: params.newValue !== undefined ? JSON.stringify(params.newValue).slice(0, 1800) : undefined,
    source: 'API',
    allowedUids,
    createdAt: nowIso,
  });
}

// ==========================================
// PHASE 1: SAFE IDEMPOTENT MIGRATION & SYNC
// ==========================================

export interface FleetMigrationResult {
  ok: true;
  backupCreated?: string;
  vehiclesNormalized: number;
  custodiesBackfilled: number;
  handoversBackfilled: number;
  statusHistoriesSeeded: number;
  movementHistoriesSeeded: number;
  vehicleDocsSeeded: number;
  maintenanceUpgraded: number;
  ranAt: string;
}

export async function runSafeFleetPhase1Migration(params: {
  actorUid: string;
  actorEmail: string;
  createPreMigrationBackup?: boolean;
}): Promise<FleetMigrationResult> {
  const preVehicles = await listLocalCollection<VehicleMaster>('vehicles');
  const preAssignments = await listLocalCollection<VehicleAssignment>('vehicleAssignments');
  const preCustodies = await listLocalCollection<VehicleCustody>('vehicleCustodies');
  const preMaint = await listLocalCollection<VehicleMaintenanceRecord>('vehicleMaintenance');

  const needsWork =
    preVehicles.some((v) => !v.plateNumberNormalized || !v.sourceType || v.readyToDispatch === undefined) ||
    preAssignments.length > preCustodies.length ||
    preMaint.some((m) => !m.workOrderNumber || !m.workflowStatus);

  let backupCreated: string | undefined;
  if (needsWork && params.createPreMigrationBackup !== false) {
    const snap = await buildFullSystemBackup({
      type: 'manual',
      createdBy: params.actorEmail || params.actorUid,
      note: 'نسخة احتياطية تلقائية قبل ترحيل بيانات الأسطول للمرحلة 1-2',
    });
    const saved = await saveBackupToServer(snap);
    backupCreated = saved.fileName;
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleAssignments',
    'vehicleCustodies',
    'vehicleHandovers',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'privateDocuments',
    'riderMaster',
    'auditLogs',
  ];

  const nowIso = new Date().toISOString();

  return runLocalTransaction(cols, async (tx) => {
    const allowedUids = await resolveTeamAllowedUidsTx(tx, params.actorUid);

    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    if (settingsDoc && !settingsDoc.fleetConfig) {
      await tx.update('operationalSettings', 'default', {
        fleetConfig,
        updatedAt: nowIso,
      });
    }

    const vehicles = await tx.list<VehicleMaster>('vehicles');
    const assignments = await tx.list<VehicleAssignment>('vehicleAssignments');
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const handovers = await tx.list<VehicleHandoverRecord>('vehicleHandovers');
    const statusHistories = await tx.list<VehicleStatusHistoryEntry>('vehicleStatusHistory');
    const movementHistories = await tx.list<VehicleMovementHistoryEntry>('vehicleMovementHistory');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const privateDocs = await tx.list<PrivateDocumentRecord>('privateDocuments');
    const riders = await tx.list<RiderMaster>('riderMaster');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');

    const riderById = new Map(riders.map((r) => [r.internalRiderId, r]));
    const vehicleById = new Map(vehicles.map((v) => [v.vehicleInternalId, v]));

    let custodiesBackfilled = 0;
    let handoversBackfilled = 0;
    let vehiclesNormalized = 0;
    let statusHistoriesSeeded = 0;
    let movementHistoriesSeeded = 0;
    let vehicleDocsSeeded = 0;
    let maintenanceUpgraded = 0;

    // 1. Backfill VehicleAssignments -> VehicleCustodies + VehicleHandovers (idempotent)
    const custodyByAssignmentId = new Map<string, VehicleCustody>();
    for (const c of custodies) {
      if (c.assignmentId) custodyByAssignmentId.set(c.assignmentId, c);
    }
    const existingCustodyNumbers = custodies.map((c) => c.custodyNumber);
    const existingHandoverNumbers = handovers.map((h) => h.handoverNumber);

    for (const asg of assignments) {
      if (custodyByAssignmentId.has(asg.assignmentId)) continue;
      const custodyId = `cust_mig_${asg.assignmentId}`.slice(0, 120);
      const handoverId = `hnd_mig_${asg.assignmentId}`.slice(0, 120);
      const alreadyCust = await tx.get('vehicleCustodies', custodyId);
      if (alreadyCust) continue;

      const rider = riderById.get(asg.companyRiderId);
      const veh = vehicleById.get(asg.vehicleInternalId);
      const custodyNumber = generateSequentialCode('CST', existingCustodyNumbers);
      existingCustodyNumbers.push(custodyNumber);
      const handoverNumber = generateSequentialCode('HND', existingHandoverNumbers);
      existingHandoverNumbers.push(handoverNumber);

      const newHandover: VehicleHandoverRecord = {
        handoverId,
        handoverNumber,
        vehicleInternalId: asg.vehicleInternalId,
        plateNumber: asg.plateNumber || veh?.plateNumber || '',
        riderId: asg.companyRiderId,
        riderName: asg.riderName || rider?.fullName || asg.companyRiderId,
        custodyId,
        handoverType: 'new_handover',
        status: 'completed',
        handoverDate: asg.handoverDate,
        handoverTime: asg.handoverTime || '09:00',
        odometer: asg.handoverOdometer ?? null,
        fuelLevel: 'unspecified',
        overallCondition: asg.handoverCondition || 'سليمة',
        notes: asg.handoverNotes || 'محضر مرحّل تلقائيًا من السجل السابق للعهد',
        checklist: [],
        accessories: [],
        photoSlots: [],
        riderAcknowledged: true,
        riderAcknowledgmentMethod: 'paper_signed',
        supervisorUid: asg.handoverByUid || params.actorUid,
        supervisorName: asg.handoverByEmail || params.actorEmail,
        approvedByUid: asg.handoverByUid || params.actorUid,
        approvedByEmail: asg.handoverByEmail || params.actorEmail,
        approvedAt: asg.createdAt || nowIso,
        createdByUid: asg.createdByUid || params.actorUid,
        allowedUids: asg.allowedUids?.length ? asg.allowedUids : allowedUids,
        createdAt: asg.createdAt || nowIso,
        updatedAt: asg.updatedAt || nowIso,
      };

      const newCustody: VehicleCustody = {
        custodyId,
        custodyNumber,
        vehicleInternalId: asg.vehicleInternalId,
        plateNumber: asg.plateNumber || veh?.plateNumber || '',
        riderId: asg.companyRiderId,
        riderName: asg.riderName || rider?.fullName || asg.companyRiderId,
        branch: veh?.branch || rider?.branch,
        city: veh?.city || rider?.city,
        status: asg.status === 'active' ? 'active' : 'returned',
        handoverId,
        assignmentId: asg.assignmentId,
        startedAt: asg.handoverDate,
        endedAt: asg.returnDate || undefined,
        startOdometer: asg.handoverOdometer ?? null,
        endOdometer: asg.returnOdometer ?? null,
        custodyNotes: asg.handoverNotes || '',
        createdByUid: asg.createdByUid || params.actorUid,
        allowedUids: asg.allowedUids?.length ? asg.allowedUids : allowedUids,
        createdAt: asg.createdAt || nowIso,
        updatedAt: asg.updatedAt || nowIso,
      };

      await tx.set('vehicleHandovers', handoverId, newHandover as unknown as Record<string, unknown>);
      await tx.set('vehicleCustodies', custodyId, newCustody as unknown as Record<string, unknown>);
      custodies.push(newCustody);
      custodiesBackfilled++;
      handoversBackfilled++;
    }

    // 2. Seed missing VehicleDocuments from vehicle expiry dates + PrivateDocuments
    const docKeys = new Set(vehicleDocs.map((d) => `${d.vehicleInternalId}:${d.docCategory}`));
    for (const v of vehicles) {
      const catSeeds: Array<{ cat: VehicleDocumentCategory; titleAr: string; expiry?: string; num?: string; issuer?: string }> = [
        { cat: 'istimara', titleAr: DOC_CATEGORY_LABELS_AR.istimara, expiry: v.istimaraExpiryDate, num: v.istimaraNumber },
        {
          cat: 'insurance',
          titleAr: DOC_CATEGORY_LABELS_AR.insurance,
          expiry: v.insuranceExpiryDate,
          num: v.insurancePolicyNumber,
          issuer: v.insuranceCompany,
        },
        { cat: 'periodic_inspection', titleAr: DOC_CATEGORY_LABELS_AR.periodic_inspection, expiry: v.periodicInspectionExpiryDate },
      ];
      for (const s of catSeeds) {
        if (!s.expiry && !s.num) continue;
        const key = `${v.vehicleInternalId}:${s.cat}`;
        if (docKeys.has(key)) continue;

        const matchingPriv = privateDocs.find(
          (pd) =>
            pd.entityType === 'vehicle' &&
            pd.entityId === v.vehicleInternalId &&
            (pd.docTypeId.includes(s.cat) || (s.cat === 'periodic_inspection' && pd.docTypeId.includes('inspection')))
        );

        const vehicleDocId = `vdoc_mig_${v.vehicleInternalId}_${s.cat}`.slice(0, 120);
        const rec: VehicleDocumentRecord = {
          vehicleDocId,
          vehicleInternalId: v.vehicleInternalId,
          plateNumber: v.plateNumber,
          docCategory: s.cat,
          titleAr: s.titleAr,
          documentNumber: s.num || undefined,
          issuerName: s.issuer || undefined,
          expiryDate: s.expiry || matchingPriv?.expiryDate || undefined,
          privateDocId: matchingPriv?.docId,
          approvalStatus: 'approved',
          approvedByUid: params.actorUid,
          approvedAt: nowIso,
          isMandatoryForDispatch: fleetConfig.mandatoryDocCategories.includes(s.cat),
          notes: 'وثيقة مهجّرة تلقائيًا من بيانات المركبة الأساسية',
          createdByUid: v.createdByUid || params.actorUid,
          allowedUids: v.allowedUids?.length ? v.allowedUids : allowedUids,
          createdAt: v.createdAt || nowIso,
          updatedAt: nowIso,
        };
        await tx.set('vehicleDocuments', vehicleDocId, rec as unknown as Record<string, unknown>);
        vehicleDocs.push(rec);
        docKeys.add(key);
        vehicleDocsSeeded++;
      }
    }

    // 3. Upgrade Maintenance records with workOrderNumber + workflowStatus
    const existingWoNums = maintenance.map((m) => m.workOrderNumber || '');
    for (const m of maintenance) {
      if (!m.workOrderNumber || !m.workflowStatus) {
        const woNum = m.workOrderNumber || generateSequentialCode('MNT', existingWoNums);
        existingWoNums.push(woNum);
        await tx.update('vehicleMaintenance', m.maintenanceId, {
          workOrderNumber: woNum,
          workflowStatus: m.workflowStatus || 'completed',
          actualCost: m.actualCost ?? m.cost ?? 0,
          updatedAt: m.updatedAt || nowIso,
        });
        maintenanceUpgraded++;
      }
    }

    // 4. Normalize all Vehicles + compute readiness + seed initial Status/Movement history
    const statusByVeh = new Set(statusHistories.map((s) => s.vehicleInternalId));
    const movByVeh = new Set(movementHistories.map((m) => m.vehicleInternalId));
    const refreshedMaint = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');

    for (const v of vehicles) {
      const activeCust = custodies.find(
        (c) => c.vehicleInternalId === v.vehicleInternalId && (c.status === 'active' || c.status === 'pending_return')
      );
      const { sourceType, ownershipType } = normalizeSourceType(v.sourceType, v.ownershipType);
      const plateNormalized = normalizePlateNumber(v.plateNumber);
      const vinNormalized = normalizeVin(v.vin);
      const canonicalStatus = normalizeVehicleStatus(v.status, Boolean(activeCust || v.currentRiderId));
      const rider = activeCust ? riderById.get(activeCust.riderId) : v.currentRiderId ? riderById.get(v.currentRiderId) : undefined;

      const updatedVeh: VehicleMaster = {
        ...v,
        plateNumberNormalized: plateNormalized,
        vinNormalized: vinNormalized || undefined,
        ownershipType,
        sourceType,
        branch: v.branch || rider?.branch || '',
        city: v.city || rider?.city || '',
        status: canonicalStatus,
        legacyStatus: v.legacyStatus || (v.status !== canonicalStatus ? v.status : undefined),
        activeCustodyId: activeCust?.custodyId || v.activeCustodyId || '',
        currentRiderId: activeCust?.riderId || v.currentRiderId || '',
      };

      const availability = computeVehicleAvailabilityItem({
        vehicle: updatedVeh,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: refreshedMaint,
        openClaims: claims,
        config: fleetConfig,
      });

      const changed =
        v.plateNumberNormalized !== updatedVeh.plateNumberNormalized ||
        v.vinNormalized !== updatedVeh.vinNormalized ||
        v.sourceType !== updatedVeh.sourceType ||
        v.status !== updatedVeh.status ||
        v.activeCustodyId !== updatedVeh.activeCustodyId ||
        v.readyToDispatch !== availability.readyToDispatch ||
        JSON.stringify(v.blockingReasons || []) !== JSON.stringify(availability.blockingReasons);

      if (changed) {
        await tx.update('vehicles', v.vehicleInternalId, {
          plateNumberNormalized: updatedVeh.plateNumberNormalized,
          vinNormalized: updatedVeh.vinNormalized || '',
          ownershipType: updatedVeh.ownershipType,
          sourceType: updatedVeh.sourceType,
          branch: updatedVeh.branch || '',
          city: updatedVeh.city || '',
          status: updatedVeh.status,
          ...(updatedVeh.legacyStatus ? { legacyStatus: updatedVeh.legacyStatus } : {}),
          activeCustodyId: updatedVeh.activeCustodyId || '',
          currentRiderId: updatedVeh.currentRiderId || '',
          readyToDispatch: availability.readyToDispatch,
          blockingReasons: availability.blockingReasons,
          updatedAt: v.updatedAt || nowIso,
        });
        vehiclesNormalized++;
      }

      if (!statusByVeh.has(v.vehicleInternalId)) {
        const historyId = `st_seed_${v.vehicleInternalId}`;
        const stEntry: VehicleStatusHistoryEntry = {
          historyId,
          vehicleInternalId: v.vehicleInternalId,
          plateNumber: v.plateNumber,
          fromStatus: 'none',
          toStatus: canonicalStatus,
          reason: 'تهيئة السجل التاريخي الأولي للمركبة عند ترقية إدارة الأسطول',
          relatedEntityType: 'migration',
          relatedEntityId: v.vehicleInternalId,
          changedByUid: params.actorUid,
          changedByEmail: params.actorEmail,
          changedAt: v.createdAt || nowIso,
          allowedUids: v.allowedUids?.length ? v.allowedUids : allowedUids,
        };
        await tx.set('vehicleStatusHistory', historyId, stEntry as unknown as Record<string, unknown>);
        statusByVeh.add(v.vehicleInternalId);
        statusHistoriesSeeded++;
      }

      if (!movByVeh.has(v.vehicleInternalId)) {
        const movementId = `mov_seed_${v.vehicleInternalId}`;
        const movEntry: VehicleMovementHistoryEntry = {
          movementId,
          vehicleInternalId: v.vehicleInternalId,
          plateNumber: v.plateNumber,
          movementType: 'vehicle_created',
          summaryAr: `تهيئة ملف المركبة ${v.plateNumber} (${v.make} ${v.model}) في السجل الموحد`,
          riderId: activeCust?.riderId || v.currentRiderId || undefined,
          riderName: activeCust?.riderName || rider?.fullName || undefined,
          odometer: v.currentOdometer ?? null,
          referenceType: 'migration',
          referenceId: v.vehicleInternalId,
          actorUid: params.actorUid,
          actorEmail: params.actorEmail,
          occurredAt: v.createdAt || nowIso,
          allowedUids: v.allowedUids?.length ? v.allowedUids : allowedUids,
        };
        await tx.set('vehicleMovementHistory', movementId, movEntry as unknown as Record<string, unknown>);
        movByVeh.add(v.vehicleInternalId);
        movementHistoriesSeeded++;
      }
    }

    const totalChanges =
      vehiclesNormalized +
      custodiesBackfilled +
      handoversBackfilled +
      statusHistoriesSeeded +
      movementHistoriesSeeded +
      vehicleDocsSeeded +
      maintenanceUpgraded;

    if (totalChanges > 0) {
      const logId = `log_mig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await tx.set('auditLogs', logId, {
        logId,
        action: 'FLEET_PHASE1_MIGRATION_SYNC',
        targetCollection: 'vehicles',
        targetId: 'all',
        entityType: 'vehicle',
        actorUid: params.actorUid,
        actorEmail: params.actorEmail,
        details: `مزامنة وترقية بيانات الأسطول: مركبات=${vehiclesNormalized}، عهد=${custodiesBackfilled}، وثائق=${vehicleDocsSeeded}، صيانة=${maintenanceUpgraded}`,
        source: 'System',
        allowedUids,
        createdAt: nowIso,
      });
    }

    return {
      ok: true,
      backupCreated,
      vehiclesNormalized,
      custodiesBackfilled,
      handoversBackfilled,
      statusHistoriesSeeded,
      movementHistoriesSeeded,
      vehicleDocsSeeded,
      maintenanceUpgraded,
      ranAt: nowIso,
    };
  });
}

// ==========================================
// PHASE 2: FLEET READ & AVAILABILITY APIs
// ==========================================

export async function getScopedFleetOverview(user: VerifiedAuthUser) {
  assertFleetPermission(user, 'fleet.view', 'صلاحياتك لا تسمح بعرض بيانات الأسطول.');

  const [
    vehiclesAll,
    assignmentsAll,
    custodiesAll,
    handoversAll,
    returnsAll,
    maintenanceAll,
    approvalsAll,
    vehicleDocsAll,
    claimsAll,
    statusHistoryAll,
    movementHistoryAll,
    notificationsAll,
    settingsList,
  ] = await Promise.all([
    listLocalCollection<VehicleMaster>('vehicles'),
    listLocalCollection<VehicleAssignment>('vehicleAssignments'),
    listLocalCollection<VehicleCustody>('vehicleCustodies'),
    listLocalCollection<VehicleHandoverRecord>('vehicleHandovers'),
    listLocalCollection<VehicleReturnRecord>('vehicleReturns'),
    listLocalCollection<VehicleMaintenanceRecord>('vehicleMaintenance'),
    listLocalCollection<FleetApprovalRequest>('fleetApprovalRequests'),
    listLocalCollection<VehicleDocumentRecord>('vehicleDocuments'),
    listLocalCollection<VehicleDamageClaim>('vehicleDamageClaims'),
    listLocalCollection<VehicleStatusHistoryEntry>('vehicleStatusHistory'),
    listLocalCollection<VehicleMovementHistoryEntry>('vehicleMovementHistory'),
    listLocalCollection<FleetNotificationRecord>('fleetNotifications'),
    listLocalCollection<OperationalSettings>('operationalSettings'),
  ]);

  const settingsDefault = settingsList.find((s) => s.settingsId === 'default') || settingsList[0] || null;
  const fleetConfig = getFleetConfigFromSettings(settingsDefault as unknown as Record<string, unknown>);

  const vehicles = vehiclesAll.filter((v) => isVehicleInUserScope(v, user));
  const allowedVehicleIds = new Set(vehicles.map((v) => v.vehicleInternalId));

  const custodies = custodiesAll.filter((c) => allowedVehicleIds.has(c.vehicleInternalId));
  const handovers = handoversAll.filter((h) => allowedVehicleIds.has(h.vehicleInternalId));
  const returns = returnsAll.filter((r) => allowedVehicleIds.has(r.vehicleInternalId));
  const assignments = assignmentsAll.filter((a) => allowedVehicleIds.has(a.vehicleInternalId));
  const maintenance = maintenanceAll.filter((m) => allowedVehicleIds.has(m.vehicleInternalId));
  const approvals = approvalsAll.filter((a) => allowedVehicleIds.has(a.vehicleInternalId));
  const vehicleDocuments = vehicleDocsAll.filter((d) => allowedVehicleIds.has(d.vehicleInternalId));
  const damageClaims = claimsAll.filter((c) => allowedVehicleIds.has(c.vehicleInternalId));
  const statusHistory = statusHistoryAll.filter((s) => allowedVehicleIds.has(s.vehicleInternalId));
  const movementHistory = movementHistoryAll.filter((m) => allowedVehicleIds.has(m.vehicleInternalId));
  const notifications = notificationsAll.filter(
    (n) => !n.vehicleInternalId || allowedVehicleIds.has(n.vehicleInternalId)
  );

  const availability = vehicles.map((vehicle) =>
    computeVehicleAvailabilityItem({
      vehicle,
      vehicleDocs: vehicleDocuments,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: damageClaims,
      config: fleetConfig,
    })
  );

  return {
    vehicles,
    assignments,
    custodies,
    handovers,
    returns,
    maintenance,
    approvals,
    vehicleDocuments,
    damageClaims,
    statusHistory,
    movementHistory,
    notifications,
    fleetConfig,
    availability,
  };
}

export async function getFleetAvailabilityMatrix(user: VerifiedAuthUser) {
  const overview = await getScopedFleetOverview(user);
  const items = overview.availability;
  const summary = {
    total: items.length,
    readyToDispatch: items.filter((i) => i.readyToDispatch).length,
    blocked: items.filter((i) => !i.readyToDispatch).length,
    compliant: items.filter((i) => i.complianceStatus === 'compliant').length,
    expiringSoon: items.filter((i) => i.complianceStatus === 'expiring_soon').length,
    docBlocked: items.filter((i) => i.complianceStatus === 'blocked').length,
  };
  return { items, summary, fleetConfig: overview.fleetConfig };
}

export async function getVehicleProfile360(user: VerifiedAuthUser, vehicleId: string) {
  assertFleetPermission(user, 'fleet.view', 'صلاحياتك لا تسمح بعرض ملف المركبة.');
  const overview = await getScopedFleetOverview(user);
  const vehicle = overview.vehicles.find((v) => v.vehicleInternalId === vehicleId);
  if (!vehicle) {
    throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة أو خارج نطاق صلاحياتك.`);
  }

  const [privateDocsAll, ridersAll] = await Promise.all([
    listLocalCollection<PrivateDocumentRecord>('privateDocuments'),
    listLocalCollection<RiderMaster>('riderMaster'),
  ]);

  const activeCustody =
    overview.custodies.find(
      (c) => c.vehicleInternalId === vehicleId && (c.status === 'active' || c.status === 'pending_return')
    ) || null;
  const currentRiderId = activeCustody?.riderId || vehicle.currentRiderId || '';
  const currentRider = currentRiderId ? ridersAll.find((r) => r.internalRiderId === currentRiderId) || null : null;

  const sortDesc = <T extends object>(arr: T[], keys: string[]): T[] =>
    [...arr].sort((a, b) => {
      const aRec = a as Record<string, unknown>;
      const bRec = b as Record<string, unknown>;
      const av = keys.map((k) => String(aRec[k] || '')).find(Boolean) || '';
      const bv = keys.map((k) => String(bRec[k] || '')).find(Boolean) || '';
      return bv.localeCompare(av);
    });

  return {
    vehicle,
    availability: overview.availability.find((a) => a.vehicleInternalId === vehicleId)!,
    activeCustody,
    currentRider,
    custodies: sortDesc(
      overview.custodies.filter((c) => c.vehicleInternalId === vehicleId),
      ['startedAt', 'createdAt']
    ),
    handovers: sortDesc(
      overview.handovers.filter((h) => h.vehicleInternalId === vehicleId),
      ['handoverDate', 'createdAt']
    ),
    returns: sortDesc(
      overview.returns.filter((r) => r.vehicleInternalId === vehicleId),
      ['returnDate', 'createdAt']
    ),
    vehicleDocuments: overview.vehicleDocuments.filter((d) => d.vehicleInternalId === vehicleId),
    privateDocuments: (() => {
      const linkedEntityIds = new Set<string>([
        vehicleId,
        ...overview.handovers.filter((h) => h.vehicleInternalId === vehicleId).map((h) => h.handoverId),
        ...overview.returns.filter((r) => r.vehicleInternalId === vehicleId).map((r) => r.returnId),
        ...overview.maintenance.filter((m) => m.vehicleInternalId === vehicleId).map((m) => m.maintenanceId),
        ...overview.damageClaims.filter((c) => c.vehicleInternalId === vehicleId).map((c) => c.claimId),
        ...overview.approvals.filter((a) => a.vehicleInternalId === vehicleId).map((a) => a.requestId),
        ...overview.vehicleDocuments.filter((d) => d.vehicleInternalId === vehicleId).map((d) => d.vehicleDocId),
      ]);
      return privateDocsAll.filter(
        (pd) =>
          ['vehicle', 'handover', 'return', 'maintenance', 'delegation', 'damage_claim', 'vehicle_doc'].includes(
            pd.entityType
          ) && linkedEntityIds.has(pd.entityId)
      );
    })(),
    maintenance: sortDesc(
      overview.maintenance.filter((m) => m.vehicleInternalId === vehicleId),
      ['maintenanceDate', 'createdAt']
    ),
    damageClaims: sortDesc(
      overview.damageClaims.filter((c) => c.vehicleInternalId === vehicleId),
      ['createdAt']
    ),
    approvals: sortDesc(
      overview.approvals.filter((a) => a.vehicleInternalId === vehicleId),
      ['requestedAt', 'createdAt']
    ),
    statusHistory: sortDesc(
      overview.statusHistory.filter((s) => s.vehicleInternalId === vehicleId),
      ['changedAt']
    ),
    movementHistory: sortDesc(
      overview.movementHistory.filter((m) => m.vehicleInternalId === vehicleId),
      ['occurredAt']
    ),
  };
}

// ==========================================
// PHASE 2: VEHICLE CREATE, UPDATE & CONTROLLED STATUS
// ==========================================

export interface CreateVehicleInput {
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
  fuelType?: VehicleMaster['fuelType'];
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

export async function createVehicleTransactional(
  user: VerifiedAuthUser,
  input: CreateVehicleInput,
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.create', 'صلاحياتك لا تسمح بإضافة مركبات جديدة.');

  const normPlate = normalizePlateNumber(input.plateNumber || '');
  const normVin = normalizeVin(input.vin);
  if (!normPlate) throw createFleetError(400, 'رقم اللوحة حقل إلزامي.');
  if (!String(input.make || '').trim() || !String(input.model || '').trim()) {
    throw createFleetError(400, 'الشركة المصنعة والموديل حقول إلزامية.');
  }

  // Block creating a vehicle already marked as assigned directly — custody must go through Handover
  const requestedStatus = normalizeVehicleStatus(input.status || 'available', false);
  if (requestedStatus === 'assigned' || requestedStatus === 'reserved' || requestedStatus === 'pending_return_inspection') {
    throw createFleetError(400, 'لا يمكن إنشاء مركبة بحالة مسلمة أو محجوزة مباشرة؛ أنشئ المركبة كمتاحة ثم نفذ طلب الربط والتسليم.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      'POST:/api/fleet/vehicles',
      user.uid
    );
    if (cached) return cached;

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const existingVehicles = await tx.list<VehicleMaster>('vehicles');

    const dupPlate = existingVehicles.find(
      (v) => (v.plateNumberNormalized || normalizePlateNumber(v.plateNumber)) === normPlate
    );
    if (dupPlate) {
      throw createFleetError(409, `رقم اللوحة (${normPlate}) مسجل مسبقًا للمركبة ${dupPlate.vehicleInternalId}.`);
    }

    if (normVin) {
      const dupVin = existingVehicles.find(
        (v) => (v.vinNormalized || normalizeVin(v.vin)) === normVin
      );
      if (dupVin) {
        throw createFleetError(409, `رقم الهيكل VIN (${normVin}) مسجل مسبقًا للمركبة ${dupVin.vehicleInternalId}.`);
      }
    }

    const vehicleInternalId =
      input.vehicleInternalId && /^[a-zA-Z0-9_-]{2,64}$/.test(input.vehicleInternalId.trim())
        ? input.vehicleInternalId.trim()
        : generateSequentialCode('VEH', existingVehicles.map((v) => v.vehicleInternalId));

    if (existingVehicles.some((v) => v.vehicleInternalId === vehicleInternalId)) {
      throw createFleetError(409, `المعرّف الداخلي للمركبة (${vehicleInternalId}) مستخدم بالفعل.`);
    }

    const { sourceType, ownershipType } = normalizeSourceType(input.sourceType, input.ownershipType);
    const nowIso = new Date().toISOString();

    const newVehicle: VehicleMaster = {
      vehicleInternalId,
      plateNumber: toAsciiDigits(input.plateNumber).trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 40),
      plateNumberNormalized: normPlate,
      vehicleType: String(input.vehicleType || 'سيارة سيدان').trim().slice(0, 64),
      make: String(input.make).trim().slice(0, 80),
      model: String(input.model).trim().slice(0, 80),
      year: input.year !== undefined && input.year !== null && Number.isFinite(Number(input.year)) ? Number(input.year) : null,
      color: input.color?.trim().slice(0, 40) || undefined,
      vin: normVin || undefined,
      vinNormalized: normVin || undefined,
      ownershipType,
      sourceType,
      ownerOrLeasingCompany: input.ownerOrLeasingCompany?.trim().slice(0, 150) || undefined,
      branch: input.branch?.trim().slice(0, 100) || undefined,
      city: input.city?.trim().slice(0, 100) || undefined,
      fuelType: input.fuelType || undefined,
      currentOdometer:
        input.currentOdometer !== undefined && input.currentOdometer !== null && Number.isFinite(Number(input.currentOdometer))
          ? Number(input.currentOdometer)
          : null,
      status: requestedStatus,
      istimaraNumber: input.istimaraNumber?.trim().slice(0, 64) || undefined,
      istimaraExpiryDate: input.istimaraExpiryDate?.trim().slice(0, 10) || undefined,
      insuranceCompany: input.insuranceCompany?.trim().slice(0, 120) || undefined,
      insurancePolicyNumber: input.insurancePolicyNumber?.trim().slice(0, 64) || undefined,
      insuranceExpiryDate: input.insuranceExpiryDate?.trim().slice(0, 10) || undefined,
      periodicInspectionExpiryDate: input.periodicInspectionExpiryDate?.trim().slice(0, 10) || undefined,
      notes: input.notes?.trim().slice(0, 1000) || undefined,
      customFields: input.customFields && typeof input.customFields === 'object' ? input.customFields : undefined,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!isVehicleInUserScope(newVehicle, user)) {
      throw createFleetError(403, 'لا يمكن إنشاء مركبة في فرع أو مدينة خارج نطاق صلاحياتك.');
    }

    // Seed VehicleDocuments from initial dates/numbers
    const seededDocs: VehicleDocumentRecord[] = [];
    const docDefs: Array<{ cat: VehicleDocumentCategory; expiry?: string; num?: string; issuer?: string }> = [
      { cat: 'istimara', expiry: newVehicle.istimaraExpiryDate, num: newVehicle.istimaraNumber },
      {
        cat: 'insurance',
        expiry: newVehicle.insuranceExpiryDate,
        num: newVehicle.insurancePolicyNumber,
        issuer: newVehicle.insuranceCompany,
      },
      { cat: 'periodic_inspection', expiry: newVehicle.periodicInspectionExpiryDate },
    ];
    for (const d of docDefs) {
      if (!d.expiry && !d.num) continue;
      const vdocId = `vdoc_${vehicleInternalId}_${d.cat}_${Date.now().toString(36)}`;
      const vdoc: VehicleDocumentRecord = {
        vehicleDocId: vdocId,
        vehicleInternalId,
        plateNumber: newVehicle.plateNumber,
        docCategory: d.cat,
        titleAr: DOC_CATEGORY_LABELS_AR[d.cat],
        documentNumber: d.num,
        issuerName: d.issuer,
        expiryDate: d.expiry,
        approvalStatus: 'approved',
        approvedByUid: user.uid,
        approvedAt: nowIso,
        isMandatoryForDispatch: fleetConfig.mandatoryDocCategories.includes(d.cat),
        createdByUid: user.uid,
        allowedUids,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await tx.set('vehicleDocuments', vdocId, vdoc as unknown as Record<string, unknown>);
      seededDocs.push(vdoc);
    }

    const availability = computeVehicleAvailabilityItem({
      vehicle: newVehicle,
      vehicleDocs: seededDocs,
      activeCustodies: [],
      openMaintenance: [],
      openClaims: [],
      config: fleetConfig,
    });

    newVehicle.readyToDispatch = availability.readyToDispatch;
    newVehicle.blockingReasons = availability.blockingReasons;

    await tx.set('vehicles', vehicleInternalId, newVehicle as unknown as Record<string, unknown>);

    const historyId = `st_${vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const statusEntry: VehicleStatusHistoryEntry = {
      historyId,
      vehicleInternalId,
      plateNumber: newVehicle.plateNumber,
      fromStatus: 'none',
      toStatus: newVehicle.status,
      reason: 'تسجيل مركبة جديدة في سجل الأسطول',
      relatedEntityType: 'vehicle',
      relatedEntityId: vehicleInternalId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    };
    await tx.set('vehicleStatusHistory', historyId, statusEntry as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: newVehicle,
      movementType: 'vehicle_created',
      summaryAr: `إضافة مركبة جديدة ${newVehicle.plateNumber} (${newVehicle.make} ${newVehicle.model})`,
      auditAction: 'FLEET_VEHICLE_CREATED',
      auditDetails: `إضافة مركبة ${newVehicle.plateNumber} [${vehicleInternalId}] (${newVehicle.make} ${newVehicle.model})`,
      newValue: { plateNumber: newVehicle.plateNumber, sourceType, status: newVehicle.status },
      nowIso,
    });

    const response = { vehicle: newVehicle, availability };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/vehicles', user.uid, 201, response);
    return response;
  });
}

export async function updateVehicleTransactional(
  user: VerifiedAuthUser,
  vehicleId: string,
  patch: Partial<CreateVehicleInput> & {
    currentRiderId?: unknown;
    activeCustodyId?: unknown;
    currentAssignmentId?: unknown;
  },
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.edit', 'صلاحياتك لا تسمح بتعديل بيانات المركبات.');

  // Strictly block direct tampering with custody/rider ownership fields
  if (
    'currentRiderId' in patch ||
    'activeCustodyId' in patch ||
    'currentAssignmentId' in patch
  ) {
    throw createFleetError(
      400,
      'ممنوع تعديل المندوب أو العهدة النشطة يدويًا من ملف المركبة؛ استخدم مسار التسليم والاستلام الرسمي.'
    );
  }
  if (patch.status !== undefined) {
    throw createFleetError(
      400,
      'لتغيير الحالة التشغيلية للمركبة يرجى استخدام إجراء تغيير الحالة المعتمد.'
    );
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      `PATCH:/api/fleet/vehicles/${vehicleId}`,
      user.uid
    );
    if (cached) return cached;

    const existing = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!existing) throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة.`);
    if (!isVehicleInUserScope(existing, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق الفروع أو المدن المصرح لك بها.');
    }

    const existingVehicles = await tx.list<VehicleMaster>('vehicles');
    const normPlate =
      patch.plateNumber !== undefined ? normalizePlateNumber(patch.plateNumber) : existing.plateNumberNormalized || normalizePlateNumber(existing.plateNumber);
    if (!normPlate) throw createFleetError(400, 'رقم اللوحة لا يمكن أن يكون فارغًا.');

    const dupPlate = existingVehicles.find(
      (v) =>
        v.vehicleInternalId !== vehicleId &&
        (v.plateNumberNormalized || normalizePlateNumber(v.plateNumber)) === normPlate
    );
    if (dupPlate) {
      throw createFleetError(409, `رقم اللوحة (${normPlate}) مسجل مسبقًا للمركبة ${dupPlate.vehicleInternalId}.`);
    }

    const normVin =
      patch.vin !== undefined ? normalizeVin(patch.vin) : existing.vinNormalized || normalizeVin(existing.vin);
    if (normVin) {
      const dupVin = existingVehicles.find(
        (v) => v.vehicleInternalId !== vehicleId && (v.vinNormalized || normalizeVin(v.vin)) === normVin
      );
      if (dupVin) {
        throw createFleetError(409, `رقم الهيكل VIN (${normVin}) مسجل مسبقًا للمركبة ${dupVin.vehicleInternalId}.`);
      }
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const { sourceType, ownershipType } = normalizeSourceType(
      patch.sourceType ?? existing.sourceType,
      patch.ownershipType ?? existing.ownershipType
    );
    const nowIso = new Date().toISOString();

    const updated: VehicleMaster = {
      ...existing,
      plateNumber:
        patch.plateNumber !== undefined
          ? toAsciiDigits(patch.plateNumber).trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 40)
          : existing.plateNumber,
      plateNumberNormalized: normPlate,
      vehicleType: patch.vehicleType !== undefined ? String(patch.vehicleType).trim().slice(0, 64) : existing.vehicleType,
      make: patch.make !== undefined ? String(patch.make).trim().slice(0, 80) : existing.make,
      model: patch.model !== undefined ? String(patch.model).trim().slice(0, 80) : existing.model,
      year: patch.year !== undefined ? (patch.year !== null ? Number(patch.year) : null) : existing.year,
      color: patch.color !== undefined ? patch.color.trim().slice(0, 40) || undefined : existing.color,
      vin: normVin || undefined,
      vinNormalized: normVin || undefined,
      ownershipType,
      sourceType,
      ownerOrLeasingCompany:
        patch.ownerOrLeasingCompany !== undefined
          ? patch.ownerOrLeasingCompany.trim().slice(0, 150) || undefined
          : existing.ownerOrLeasingCompany,
      branch: patch.branch !== undefined ? patch.branch.trim().slice(0, 100) || undefined : existing.branch,
      city: patch.city !== undefined ? patch.city.trim().slice(0, 100) || undefined : existing.city,
      fuelType: patch.fuelType !== undefined ? patch.fuelType : existing.fuelType,
      currentOdometer:
        patch.currentOdometer !== undefined
          ? patch.currentOdometer !== null
            ? Number(patch.currentOdometer)
            : null
          : existing.currentOdometer,
      istimaraNumber: patch.istimaraNumber !== undefined ? patch.istimaraNumber.trim().slice(0, 64) || undefined : existing.istimaraNumber,
      istimaraExpiryDate:
        patch.istimaraExpiryDate !== undefined ? patch.istimaraExpiryDate.trim().slice(0, 10) || undefined : existing.istimaraExpiryDate,
      insuranceCompany:
        patch.insuranceCompany !== undefined ? patch.insuranceCompany.trim().slice(0, 120) || undefined : existing.insuranceCompany,
      insurancePolicyNumber:
        patch.insurancePolicyNumber !== undefined
          ? patch.insurancePolicyNumber.trim().slice(0, 64) || undefined
          : existing.insurancePolicyNumber,
      insuranceExpiryDate:
        patch.insuranceExpiryDate !== undefined ? patch.insuranceExpiryDate.trim().slice(0, 10) || undefined : existing.insuranceExpiryDate,
      periodicInspectionExpiryDate:
        patch.periodicInspectionExpiryDate !== undefined
          ? patch.periodicInspectionExpiryDate.trim().slice(0, 10) || undefined
          : existing.periodicInspectionExpiryDate,
      notes: patch.notes !== undefined ? patch.notes.trim().slice(0, 1000) || undefined : existing.notes,
      customFields: patch.customFields !== undefined ? patch.customFields : existing.customFields,
      allowedUids,
      updatedAt: nowIso,
    };

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const allDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');

    // Sync/create vehicleDocuments for istimara / insurance / periodic_inspection if changed
    const docUpdates: Array<{ cat: VehicleDocumentCategory; expiry?: string; num?: string; issuer?: string }> = [
      { cat: 'istimara', expiry: updated.istimaraExpiryDate, num: updated.istimaraNumber },
      { cat: 'insurance', expiry: updated.insuranceExpiryDate, num: updated.insurancePolicyNumber, issuer: updated.insuranceCompany },
      { cat: 'periodic_inspection', expiry: updated.periodicInspectionExpiryDate },
    ];
    for (const d of docUpdates) {
      if (!d.expiry && !d.num) continue;
      const existingDoc = allDocs.find(
        (docItem) => docItem.vehicleInternalId === vehicleId && docItem.docCategory === d.cat
      );
      if (existingDoc) {
        const nextDoc: VehicleDocumentRecord = {
          ...existingDoc,
          plateNumber: updated.plateNumber,
          documentNumber: d.num ?? existingDoc.documentNumber,
          issuerName: d.issuer ?? existingDoc.issuerName,
          expiryDate: d.expiry ?? existingDoc.expiryDate,
          updatedAt: nowIso,
        };
        await tx.set('vehicleDocuments', existingDoc.vehicleDocId, nextDoc as unknown as Record<string, unknown>);
        const idx = allDocs.findIndex((x) => x.vehicleDocId === existingDoc.vehicleDocId);
        if (idx >= 0) allDocs[idx] = nextDoc;
      } else {
        const vdocId = `vdoc_${vehicleId}_${d.cat}_${Date.now().toString(36)}`;
        const newDoc: VehicleDocumentRecord = {
          vehicleDocId: vdocId,
          vehicleInternalId: vehicleId,
          plateNumber: updated.plateNumber,
          docCategory: d.cat,
          titleAr: DOC_CATEGORY_LABELS_AR[d.cat],
          documentNumber: d.num,
          issuerName: d.issuer,
          expiryDate: d.expiry,
          approvalStatus: 'approved',
          approvedByUid: user.uid,
          approvedAt: nowIso,
          isMandatoryForDispatch: fleetConfig.mandatoryDocCategories.includes(d.cat),
          createdByUid: user.uid,
          allowedUids,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        await tx.set('vehicleDocuments', vdocId, newDoc as unknown as Record<string, unknown>);
        allDocs.push(newDoc);
      }
    }

    const availability = computeVehicleAvailabilityItem({
      vehicle: updated,
      vehicleDocs: allDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updated.readyToDispatch = availability.readyToDispatch;
    updated.blockingReasons = availability.blockingReasons;

    await tx.set('vehicles', vehicleId, updated as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updated,
      movementType: 'vehicle_updated',
      summaryAr: `تحديث بيانات المركبة ${updated.plateNumber} (${updated.make} ${updated.model})`,
      auditAction: 'FLEET_VEHICLE_UPDATED',
      auditDetails: `تحديث بيانات المركبة ${updated.plateNumber} [${vehicleId}]`,
      oldValue: { plateNumber: existing.plateNumber, branch: existing.branch, city: existing.city, sourceType: existing.sourceType },
      newValue: { plateNumber: updated.plateNumber, branch: updated.branch, city: updated.city, sourceType: updated.sourceType },
      nowIso,
    });

    const response = { vehicle: updated, availability };
    await saveIdempotencyTx(
      tx,
      idempotencyKey,
      `PATCH:/api/fleet/vehicles/${vehicleId}`,
      user.uid,
      200,
      response
    );
    return response;
  });
}

export async function transitionVehicleStatusTransactional(
  user: VerifiedAuthUser,
  vehicleId: string,
  input: { toStatus: VehicleStatus; reason?: string },
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.edit', 'صلاحياتك لا تسمح بتغيير حالة المركبات.');

  const targetStatus = normalizeVehicleStatus(input.toStatus, false);
  const allowedTargets: VehicleStatus[] = ['available', 'stopped', 'retired', 'maintenance'];
  if (!allowedTargets.includes(targetStatus)) {
    throw createFleetError(
      400,
      'التغيير اليدوي للحالة مسموح فقط إلى: متاحة، متوقفة، متقاعدة، أو صيانة. حالة التسليم والحجز تدار تلقائيًا عبر سير العمل.'
    );
  }
  const reason = String(input.reason || '').trim();
  if ((targetStatus === 'stopped' || targetStatus === 'retired') && reason.length < 3) {
    throw createFleetError(400, 'يجب إدخال سبب واضح عند إيقاف المركبة أو إحالتها للتقاعد.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/vehicles/${vehicleId}/status`,
      user.uid
    );
    if (cached) return cached;

    const existing = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!existing) throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة.`);
    if (!isVehicleInUserScope(existing, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const activeCustody = custodies.find(
      (c) => c.vehicleInternalId === vehicleId && (c.status === 'active' || c.status === 'pending_return')
    );

    if (activeCustody || existing.activeCustodyId || existing.currentRiderId) {
      throw createFleetError(
        409,
        `لا يمكن تغيير حالة المركبة (${existing.plateNumber}) لوجود عهدة نشطة حاليًا؛ قم بإغلاق العهدة أو استلام المركبة أولاً.`
      );
    }

    if (existing.reservedForRequestId) {
      throw createFleetError(
        409,
        `المركبة محجوزة لطلب ربط رقم (${existing.reservedForRequestId})؛ يرجى إلغاء الطلب أولاً.`
      );
    }

    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const blockingOpenMaint = maintenance.find(
      (m) =>
        m.vehicleInternalId === vehicleId &&
        m.workflowStatus &&
        ['open', 'in_progress', 'awaiting_approval'].includes(m.workflowStatus) &&
        m.vehicleWasStopped
    );
    if (targetStatus === 'available' && blockingOpenMaint) {
      throw createFleetError(
        409,
        `لا يمكن تفعيل المركبة كمتاحة قبل إغلاق أمر الصيانة المفتوح (${blockingOpenMaint.workOrderNumber || blockingOpenMaint.maintenanceId}).`
      );
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const allDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const nowIso = new Date().toISOString();
    const fromStatus = existing.status;

    const updated: VehicleMaster = {
      ...existing,
      status: targetStatus,
      stopReason: targetStatus === 'stopped' || targetStatus === 'retired' ? reason : '',
      stoppedAt: targetStatus === 'stopped' || targetStatus === 'retired' ? nowIso : '',
      allowedUids,
      updatedAt: nowIso,
    };

    const availability = computeVehicleAvailabilityItem({
      vehicle: updated,
      vehicleDocs: allDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updated.readyToDispatch = availability.readyToDispatch;
    updated.blockingReasons = availability.blockingReasons;

    await tx.set('vehicles', vehicleId, updated as unknown as Record<string, unknown>);

    const historyId = `st_${vehicleId}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const stEntry: VehicleStatusHistoryEntry = {
      historyId,
      vehicleInternalId: vehicleId,
      plateNumber: updated.plateNumber,
      fromStatus,
      toStatus: targetStatus,
      reason: reason || `تغيير حالة المركبة إلى ${VEHICLE_STATUS_LABELS_AR[targetStatus] || targetStatus}`,
      relatedEntityType: 'vehicle',
      relatedEntityId: vehicleId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    };
    await tx.set('vehicleStatusHistory', historyId, stEntry as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updated,
      movementType: 'status_changed',
      summaryAr: `تغيير حالة المركبة من (${VEHICLE_STATUS_LABELS_AR[fromStatus] || fromStatus}) إلى (${VEHICLE_STATUS_LABELS_AR[targetStatus] || targetStatus})${reason ? `: ${reason}` : ''}`,
      auditAction: 'FLEET_VEHICLE_STATUS_CHANGED',
      auditDetails: `تغيير حالة المركبة ${updated.plateNumber} [${vehicleId}] من ${fromStatus} إلى ${targetStatus}${reason ? ` — السبب: ${reason}` : ''}`,
      oldValue: { status: fromStatus },
      newValue: { status: targetStatus, stopReason: reason || '' },
      nowIso,
    });

    if (targetStatus === 'stopped' || targetStatus === 'retired') {
      const notifId = `notif_st_${vehicleId}_${Date.now().toString(36)}`;
      const notif: FleetNotificationRecord = {
        notificationId: notifId,
        type: 'status_changed',
        severity: targetStatus === 'retired' ? 'critical' : 'warning',
        titleAr: `${targetStatus === 'retired' ? 'إحالة مركبة للتقاعد' : 'إيقاف مركبة'}: ${updated.plateNumber}`,
        messageAr: `تم تغيير حالة المركبة ${updated.plateNumber} إلى ${VEHICLE_STATUS_LABELS_AR[targetStatus]} — السبب: ${reason}`,
        vehicleInternalId: vehicleId,
        plateNumber: updated.plateNumber,
        referenceType: 'vehicle',
        referenceId: vehicleId,
        targetRoles: ['super_admin', 'fleet_manager', 'operations_manager'],
        readByUids: [],
        createdAt: nowIso,
        allowedUids,
      };
      await tx.set('fleetNotifications', notifId, notif as unknown as Record<string, unknown>);
    }

    const response = { vehicle: updated, availability };
    await saveIdempotencyTx(
      tx,
      idempotencyKey,
      `POST:/api/fleet/vehicles/${vehicleId}/status`,
      user.uid,
      200,
      response
    );
    return response;
  });
}

// ==========================================
// PHASE 3: DUAL-STAGE APPROVALS & DELEGATION
// ==========================================

export interface RequestVehicleAssignmentInput {
  vehicleInternalId: string;
  riderId: string;
  requestType?: FleetApprovalRequestType;
  requestReason?: string;
  delegationNumber?: string;
  delegationStartDate?: string;
  delegationExpiryDate?: string;
}

export async function requestVehicleAssignmentTransactional(
  user: VerifiedAuthUser,
  input: RequestVehicleAssignmentInput,
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.assignment.request', 'صلاحياتك لا تسمح برفع طلب ربط أو تفويض مركبة.');

  const vehicleId = String(input.vehicleInternalId || '').trim();
  const riderId = String(input.riderId || '').trim();
  const requestType: FleetApprovalRequestType =
    input.requestType && ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(input.requestType)
      ? input.requestType
      : 'vehicle_assignment';

  if (!vehicleId || !riderId) {
    throw createFleetError(400, 'يجب تحديد المركبة والمندوب المطلوب ربطه.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'riderMaster',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ approval: FleetApprovalRequest; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      'POST:/api/fleet/assignments/request',
      user.uid
    );
    if (cached) return cached;

    const vehicle = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة.`);
    if (!isVehicleInUserScope(vehicle, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const rider = (await tx.get('riderMaster', riderId)) as RiderMaster | null;
    if (!rider) throw createFleetError(404, `ملف المندوب (${riderId}) غير موجود في الموارد البشرية.`);
    if (['terminated', 'inactive', 'suspended'].includes(rider.status)) {
      throw createFleetError(
        409,
        `لا يمكن تخصيص مركبة للمندوب (${rider.fullName}) لأن حالته الوظيفية الحالية (${rider.status}) غير مؤهلة للتشغيل.`
      );
    }

    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const approvals = await tx.list<FleetApprovalRequest>('fleetApprovalRequests');

    const currentAvail = computeVehicleAvailabilityItem({
      vehicle,
      vehicleDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });

    if (!currentAvail.readyToDispatch) {
      throw createFleetError(
        409,
        `المركبة (${vehicle.plateNumber}) غير جاهزة للربط حاليًا: ${currentAvail.blockingReasons.join(' · ')}`
      );
    }

    const openApprovalForVeh = approvals.find(
      (a) =>
        a.vehicleInternalId === vehicleId &&
        ['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(a.status)
    );
    if (openApprovalForVeh) {
      throw createFleetError(
        409,
        `توجد معاملة اعتماد مفتوحة بالفعل للمركبة (${vehicle.plateNumber}) برقم ${openApprovalForVeh.requestNumber}.`
      );
    }

    if (fleetConfig.singleVehiclePerRider) {
      const riderActiveCustody = custodies.find(
        (c) => c.riderId === riderId && (c.status === 'active' || c.status === 'pending_return')
      );
      if (riderActiveCustody) {
        throw createFleetError(
          409,
          `المندوب (${rider.fullName}) لديه عهدة نشطة حاليًا للمركبة (${riderActiveCustody.plateNumber}) ولا تسمح السياسة بتسليم أكثر من مركبة واحدة في نفس الوقت.`
        );
      }
      const riderOpenApproval = approvals.find(
        (a) =>
          a.riderId === riderId &&
          ['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(a.status)
      );
      if (riderOpenApproval) {
        throw createFleetError(
          409,
          `المندوب (${rider.fullName}) لديه طلب ربط مفتوح برقم ${riderOpenApproval.requestNumber}.`
        );
      }
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const requestNumber = generateSequentialCode('REQ', approvals.map((a) => a.requestNumber || a.requestId));
    const requestId = `req_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

    const approval: FleetApprovalRequest = {
      requestId,
      requestNumber,
      requestType,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: rider.internalRiderId,
      riderName: rider.fullName,
      branch: vehicle.branch || rider.branch,
      city: vehicle.city || rider.city,
      status: 'pending_operations',
      requestedByUid: user.uid,
      requestedByEmail: user.email,
      requestedAt: nowIso,
      requestReason: input.requestReason?.trim().slice(0, 600) || `طلب ربط وتفويض مركبة للمندوب ${rider.fullName}`,
      delegationNumber: input.delegationNumber?.trim().slice(0, 64) || undefined,
      delegationStartDate: input.delegationStartDate?.trim().slice(0, 10) || undefined,
      delegationExpiryDate: input.delegationExpiryDate?.trim().slice(0, 10) || undefined,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      status: 'reserved',
      reservedForRequestId: requestId,
      allowedUids,
      updatedAt: nowIso,
    };
    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('fleetApprovalRequests', requestId, approval as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicleId, updatedVehicle as unknown as Record<string, unknown>);

    const stHistoryId = `st_${vehicleId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const stEntry: VehicleStatusHistoryEntry = {
      historyId: stHistoryId,
      vehicleInternalId: vehicleId,
      plateNumber: updatedVehicle.plateNumber,
      fromStatus: vehicle.status,
      toStatus: 'reserved',
      reason: `حجز المركبة لطلب الربط (${requestNumber}) للمندوب ${rider.fullName}`,
      relatedEntityType: 'approval',
      relatedEntityId: requestId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    };
    await tx.set('vehicleStatusHistory', stHistoryId, stEntry as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'assignment_requested',
      summaryAr: `رفع طلب ربط وتفويض (${requestNumber}) للمندوب ${rider.fullName}`,
      auditAction: 'FLEET_ASSIGNMENT_REQUESTED',
      auditDetails: `رفع طلب ربط (${requestNumber}) للمركبة ${updatedVehicle.plateNumber} -> المندوب ${rider.fullName}`,
      referenceType: 'approval',
      referenceId: requestId,
      riderId: rider.internalRiderId,
      riderName: rider.fullName,
      newValue: { requestNumber, riderId: rider.internalRiderId, status: 'pending_operations' },
      nowIso,
    });

    const notifId = `notif_req_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const notif: FleetNotificationRecord = {
      notificationId: notifId,
      type: 'approval_needed',
      severity: 'info',
      titleAr: `طلب اعتماد تشغيلي جديد (${requestNumber})`,
      messageAr: `المركبة ${updatedVehicle.plateNumber} للمندوب ${rider.fullName} بانتظار اعتماد مدير العمليات.`,
      vehicleInternalId: vehicleId,
      plateNumber: updatedVehicle.plateNumber,
      riderId: rider.internalRiderId,
      referenceType: 'approval',
      referenceId: requestId,
      targetRoles: ['operations_manager', 'super_admin'],
      readByUids: [],
      createdAt: nowIso,
      allowedUids,
    };
    await tx.set('fleetNotifications', notifId, notif as unknown as Record<string, unknown>);

    const response = { approval, vehicle: updatedVehicle, availability: nextAvail };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/assignments/request', user.uid, 201, response);
    return response;
  });
}

export async function decideOperationsApprovalTransactional(
  user: VerifiedAuthUser,
  requestId: string,
  input: { decision: 'approved' | 'rejected'; note?: string },
  idempotencyKey?: string
) {
  assertFleetPermission(
    user,
    'fleet.assignment.operations_approve',
    'صلاحياتك لا تسمح بالاعتماد التشغيلي لطلبات الأسطول.'
  );

  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw createFleetError(400, 'القرار يجب أن يكون موافقة أو رفضًا.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ approval: FleetApprovalRequest; vehicle: VehicleMaster }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/operations-decision`,
      user.uid
    );
    if (cached) return cached;

    const req = (await tx.get('fleetApprovalRequests', requestId)) as FleetApprovalRequest | null;
    if (!req) throw createFleetError(404, `طلب الاعتماد (${requestId}) غير موجود.`);
    if (req.status !== 'pending_operations') {
      throw createFleetError(409, `هذا الطلب ليس في مرحلة بانتظار اعتماد التشغيل (الحالة الحالية: ${req.status}).`);
    }

    const vehicle = (await tx.get('vehicles', req.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة المرتبطة بالطلب غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const isAdminActor = user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin';
    if (fleetConfig.strictSeparationOfDuties && !isAdminActor && req.requestedByUid === user.uid) {
      throw createFleetError(403, 'سياسة فصل الصلاحيات تمنع مُقدّم الطلب من اعتماده تشغيليًا.');
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const note = String(input.note || '').trim().slice(0, 600);
    if (input.decision === 'rejected' && note.length < 2) {
      throw createFleetError(400, 'يرجى توضيح سبب رفض الطلب.');
    }

    const nextReqStatus = input.decision === 'approved' ? 'pending_admin' : 'rejected';
    const updatedReq: FleetApprovalRequest = {
      ...req,
      status: nextReqStatus,
      operationsDecision: input.decision,
      operationsByUid: user.uid,
      operationsByEmail: user.email,
      operationsAt: nowIso,
      operationsNote: note || undefined,
      allowedUids,
      updatedAt: nowIso,
    };

    let updatedVehicle = { ...vehicle, allowedUids, updatedAt: nowIso };
    if (input.decision === 'rejected') {
      const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
      const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
      const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
      const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
      updatedVehicle.status = 'available';
      updatedVehicle.reservedForRequestId = '';
      const nextAvail = computeVehicleAvailabilityItem({
        vehicle: updatedVehicle,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: claims,
        config: fleetConfig,
      });
      updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
      updatedVehicle.blockingReasons = nextAvail.blockingReasons;

      const stHistoryId = `st_${vehicle.vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('vehicleStatusHistory', stHistoryId, {
        historyId: stHistoryId,
        vehicleInternalId: vehicle.vehicleInternalId,
        plateNumber: vehicle.plateNumber,
        fromStatus: vehicle.status,
        toStatus: 'available',
        reason: `فك حجز المركبة لرفض طلب الربط (${req.requestNumber}) تشغيليًا: ${note}`,
        relatedEntityType: 'approval',
        relatedEntityId: requestId,
        changedByUid: user.uid,
        changedByEmail: user.email,
        changedAt: nowIso,
        allowedUids,
      });
    }

    await tx.set('fleetApprovalRequests', requestId, updatedReq as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'ops_approved',
      summaryAr:
        input.decision === 'approved'
          ? `اعتماد التشغيل المبدئي لطلب (${req.requestNumber}) — محال للاعتماد الإداري`
          : `رفض طلب الربط (${req.requestNumber}) تشغيليًا: ${note}`,
      auditAction: input.decision === 'approved' ? 'FLEET_OPS_APPROVED' : 'FLEET_OPS_REJECTED',
      auditDetails: `${input.decision === 'approved' ? 'موافقة' : 'رفض'} التشغيل على طلب ${req.requestNumber}${note ? ` — ${note}` : ''}`,
      referenceType: 'approval',
      referenceId: requestId,
      riderId: req.riderId,
      riderName: req.riderName,
      oldValue: { status: req.status },
      newValue: { status: nextReqStatus, note },
      nowIso,
    });

    const notifId = `notif_ops_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('fleetNotifications', notifId, {
      notificationId: notifId,
      type: input.decision === 'approved' ? 'approval_needed' : 'approval_decided',
      severity: input.decision === 'approved' ? 'info' : 'warning',
      titleAr:
        input.decision === 'approved'
          ? `بانتظار الاعتماد الإداري (${req.requestNumber})`
          : `تم رفض طلب الربط (${req.requestNumber})`,
      messageAr:
        input.decision === 'approved'
          ? `اعتمد التشغيل طلب ربط المركبة ${vehicle.plateNumber} للمندوب ${req.riderName || ''} وبانتظار الاعتماد الإداري.`
          : `تم رفض الطلب من التشغيل: ${note}`,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: req.riderId,
      referenceType: 'approval',
      referenceId: requestId,
      targetRoles: input.decision === 'approved' ? ['fleet_manager', 'super_admin'] : ['fleet_employee', 'operations_manager'],
      readByUids: [],
      createdAt: nowIso,
      allowedUids,
    });

    const response = { approval: updatedReq, vehicle: updatedVehicle };
    await saveIdempotencyTx(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/operations-decision`,
      user.uid,
      200,
      response
    );
    return response;
  });
}

export async function decideAdminApprovalTransactional(
  user: VerifiedAuthUser,
  requestId: string,
  input: { decision: 'approved' | 'rejected'; note?: string },
  idempotencyKey?: string
) {
  assertFleetPermission(
    user,
    'fleet.assignment.admin_approve',
    'صلاحياتك لا تسمح بالاعتماد الإداري النهائي لطلبات الأسطول.'
  );

  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw createFleetError(400, 'القرار يجب أن يكون موافقة أو رفضًا.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ approval: FleetApprovalRequest; vehicle: VehicleMaster }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/admin-decision`,
      user.uid
    );
    if (cached) return cached;

    const req = (await tx.get('fleetApprovalRequests', requestId)) as FleetApprovalRequest | null;
    if (!req) throw createFleetError(404, `طلب الاعتماد (${requestId}) غير موجود.`);
    if (req.status !== 'pending_admin') {
      throw createFleetError(409, `هذا الطلب ليس في مرحلة بانتظار الاعتماد الإداري (الحالة الحالية: ${req.status}).`);
    }

    const vehicle = (await tx.get('vehicles', req.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة المرتبطة بالطلب غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const isAdminActor = user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin';
    if (fleetConfig.strictSeparationOfDuties && !isAdminActor && req.operationsByUid === user.uid) {
      throw createFleetError(403, 'سياسة فصل الصلاحيات تمنع نفس المعتمد التشغيلي من تنفيذ الاعتماد الإداري لنفس الطلب.');
    }

    const note = String(input.note || '').trim().slice(0, 600);
    if (input.decision === 'rejected' && note.length < 2) {
      throw createFleetError(400, 'يرجى توضيح سبب الرفض الإداري.');
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();

    const isAssignmentFlow = ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(req.requestType);
    const nextStatus =
      input.decision === 'rejected'
        ? 'rejected'
        : isAssignmentFlow && fleetConfig.requireOpsAndAdminForDelegation && !req.delegationNumber
          ? 'pending_delegation'
          : 'approved';

    const updatedReq: FleetApprovalRequest = {
      ...req,
      status: nextStatus,
      adminDecision: input.decision,
      adminByUid: user.uid,
      adminByEmail: user.email,
      adminAt: nowIso,
      adminNote: note || undefined,
      allowedUids,
      updatedAt: nowIso,
    };

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');

    let updatedVehicle = { ...vehicle, allowedUids, updatedAt: nowIso };
    if (input.decision === 'rejected' && isAssignmentFlow) {
      updatedVehicle.status = 'available';
      updatedVehicle.reservedForRequestId = '';
      const nextAvail = computeVehicleAvailabilityItem({
        vehicle: updatedVehicle,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: claims,
        config: fleetConfig,
      });
      updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
      updatedVehicle.blockingReasons = nextAvail.blockingReasons;

      const stHistoryId = `st_${vehicle.vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('vehicleStatusHistory', stHistoryId, {
        historyId: stHistoryId,
        vehicleInternalId: vehicle.vehicleInternalId,
        plateNumber: vehicle.plateNumber,
        fromStatus: vehicle.status,
        toStatus: 'available',
        reason: `فك حجز المركبة لرفض طلب الربط (${req.requestNumber}) إداريًا: ${note}`,
        relatedEntityType: 'approval',
        relatedEntityId: requestId,
        changedByUid: user.uid,
        changedByEmail: user.email,
        changedAt: nowIso,
        allowedUids,
      });
    }

    // Handle maintenance_cost or damage_claim_settlement linked records
    if (req.requestType === 'maintenance_cost' && req.targetEntityId) {
      const maintRec = (await tx.get('vehicleMaintenance', req.targetEntityId)) as VehicleMaintenanceRecord | null;
      if (maintRec) {
        const nextMaint: VehicleMaintenanceRecord = {
          ...maintRec,
          workflowStatus: input.decision === 'approved' ? 'in_progress' : 'cancelled',
          approvedByUid: input.decision === 'approved' ? user.uid : undefined,
          approvedByEmail: input.decision === 'approved' ? user.email : undefined,
          approvedAt: input.decision === 'approved' ? nowIso : undefined,
          updatedAt: nowIso,
        };
        await tx.set('vehicleMaintenance', maintRec.maintenanceId, nextMaint as unknown as Record<string, unknown>);
      }
    } else if (req.requestType === 'damage_claim_settlement' && req.targetEntityId) {
      const claimRec = (await tx.get('vehicleDamageClaims', req.targetEntityId)) as VehicleDamageClaim | null;
      if (claimRec) {
        const nextClaim: VehicleDamageClaim = {
          ...claimRec,
          status: input.decision === 'approved' ? 'settled' : 'open',
          settledAt: input.decision === 'approved' ? nowIso : undefined,
          settledByUid: input.decision === 'approved' ? user.uid : undefined,
          updatedAt: nowIso,
        };
        await tx.set('vehicleDamageClaims', claimRec.claimId, nextClaim as unknown as Record<string, unknown>);
      }
    }

    await tx.set('fleetApprovalRequests', requestId, updatedReq as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'admin_approved',
      summaryAr:
        input.decision === 'approved'
          ? `الاعتماد الإداري النهائي للطلب (${req.requestNumber})${nextStatus === 'pending_delegation' ? ' — بانتظار رفع وثيقة التفويض' : ' — جاهز للتنفيذ'}`
          : `رفض إداري للطلب (${req.requestNumber}): ${note}`,
      auditAction: input.decision === 'approved' ? 'FLEET_ADMIN_APPROVED' : 'FLEET_ADMIN_REJECTED',
      auditDetails: `${input.decision === 'approved' ? 'اعتماد' : 'رفض'} إداري للطلب ${req.requestNumber}${note ? ` — ${note}` : ''}`,
      referenceType: 'approval',
      referenceId: requestId,
      riderId: req.riderId,
      riderName: req.riderName,
      oldValue: { status: req.status },
      newValue: { status: nextStatus, note },
      nowIso,
    });

    const notifId = `notif_adm_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('fleetNotifications', notifId, {
      notificationId: notifId,
      type: 'approval_decided',
      severity: input.decision === 'approved' ? 'info' : 'warning',
      titleAr:
        input.decision === 'approved'
          ? `تم الاعتماد الإداري (${req.requestNumber})`
          : `رفض إداري للطلب (${req.requestNumber})`,
      messageAr:
        input.decision === 'approved'
          ? `تمت الموافقة الإدارية على ${req.requestNumber} للمركبة ${vehicle.plateNumber}.`
          : `تم رفض الطلب إداريًا: ${note}`,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: req.riderId,
      referenceType: 'approval',
      referenceId: requestId,
      targetRoles: ['fleet_manager', 'fleet_employee', 'operations_manager'],
      readByUids: [],
      createdAt: nowIso,
      allowedUids,
    });

    const response = { approval: updatedReq, vehicle: updatedVehicle };
    await saveIdempotencyTx(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/admin-decision`,
      user.uid,
      200,
      response
    );
    return response;
  });
}

export async function attachDelegationToApprovalTransactional(
  user: VerifiedAuthUser,
  requestId: string,
  input: {
    delegationNumber: string;
    delegationStartDate: string;
    delegationExpiryDate: string;
    privateDocId?: string;
    issuerName?: string;
    notes?: string;
  },
  idempotencyKey?: string
) {
  if (
    !hasFleetPermOnUser(user, 'fleet.documents.upload') &&
    !hasFleetPermOnUser(user, 'fleet.assignment.request') &&
    !hasFleetPermOnUser(user, 'fleet.edit')
  ) {
    throw createFleetError(403, 'صلاحياتك لا تسمح بإرفاق وتوثيق التفويض.');
  }

  const delegationNumber = String(input.delegationNumber || '').trim();
  const delegationStartDate = String(input.delegationStartDate || '').trim();
  const delegationExpiryDate = String(input.delegationExpiryDate || '').trim();
  if (!delegationNumber || !delegationStartDate || !delegationExpiryDate) {
    throw createFleetError(400, 'رقم التفويض وتاريخ البدء وتاريخ الانتهاء حقول إلزامية.');
  }
  if (delegationExpiryDate < delegationStartDate) {
    throw createFleetError(400, 'تاريخ انتهاء التفويض يجب أن يكون بعد تاريخ البدء.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'vehicles',
    'vehicleDocuments',
    'fleetApprovalRequests',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ approval: FleetApprovalRequest; vehicleDocument: VehicleDocumentRecord }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/delegation`,
      user.uid
    );
    if (cached) return cached;

    const req = (await tx.get('fleetApprovalRequests', requestId)) as FleetApprovalRequest | null;
    if (!req) throw createFleetError(404, 'طلب الربط غير موجود.');
    if (!['pending_delegation', 'approved'].includes(req.status)) {
      throw createFleetError(409, 'لا يمكن إرفاق التفويض قبل إتمام الاعتماد التشغيلي والإداري.');
    }

    const vehicle = (await tx.get('vehicles', req.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const vehicleDocId = `vdoc_del_${vehicle.vehicleInternalId}_${Date.now().toString(36)}`;

    const vehicleDocument: VehicleDocumentRecord = {
      vehicleDocId,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      docCategory: 'delegation',
      titleAr: `تفويض قيادة للمندوب ${req.riderName || req.riderId || ''}`,
      documentNumber: delegationNumber.slice(0, 64),
      issuerName: input.issuerName?.trim().slice(0, 120) || 'إدارة المرور / النظام الموحد',
      issueDate: delegationStartDate.slice(0, 10),
      expiryDate: delegationExpiryDate.slice(0, 10),
      privateDocId: input.privateDocId?.trim() || undefined,
      approvalStatus: 'approved',
      approvedByUid: user.uid,
      approvedAt: nowIso,
      isMandatoryForDispatch: false,
      notes: input.notes?.trim().slice(0, 500) || undefined,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedReq: FleetApprovalRequest = {
      ...req,
      status: 'approved',
      delegationDocId: vehicleDocId,
      delegationNumber: delegationNumber.slice(0, 64),
      delegationStartDate: delegationStartDate.slice(0, 10),
      delegationExpiryDate: delegationExpiryDate.slice(0, 10),
      allowedUids,
      updatedAt: nowIso,
    };

    await tx.set('vehicleDocuments', vehicleDocId, vehicleDocument as unknown as Record<string, unknown>);
    await tx.set('fleetApprovalRequests', requestId, updatedReq as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle,
      movementType: 'delegation_uploaded',
      summaryAr: `إرفاق وثيقة التفويض رقم (${delegationNumber}) لطلب (${req.requestNumber}) — ساري حتى ${delegationExpiryDate}`,
      auditAction: 'FLEET_DELEGATION_ATTACHED',
      auditDetails: `توثيق تفويض (${delegationNumber}) للطلب ${req.requestNumber} للمركبة ${vehicle.plateNumber}`,
      referenceType: 'approval',
      referenceId: requestId,
      riderId: req.riderId,
      riderName: req.riderName,
      newValue: { delegationNumber, delegationStartDate, delegationExpiryDate, vehicleDocId },
      nowIso,
    });

    const response = { approval: updatedReq, vehicleDocument };
    await saveIdempotencyTx(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/delegation`,
      user.uid,
      200,
      response
    );
    return response;
  });
}

export async function cancelFleetApprovalTransactional(
  user: VerifiedAuthUser,
  requestId: string,
  reason?: string,
  idempotencyKey?: string
) {
  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ approval: FleetApprovalRequest; vehicle: VehicleMaster }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/approvals/${requestId}/cancel`,
      user.uid
    );
    if (cached) return cached;

    const req = (await tx.get('fleetApprovalRequests', requestId)) as FleetApprovalRequest | null;
    if (!req) throw createFleetError(404, 'طلب الاعتماد غير موجود.');

    const canCancel =
      req.requestedByUid === user.uid ||
      hasFleetPermOnUser(user, 'fleet.assignment.admin_approve') ||
      hasFleetPermOnUser(user, 'fleet.edit');
    if (!canCancel) {
      throw createFleetError(403, 'صلاحياتك لا تسمح بإلغاء هذا الطلب.');
    }

    if (!['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(req.status)) {
      throw createFleetError(409, 'لا يمكن إلغاء طلب مكتمل أو مرفوض أو ملغي مسبقًا.');
    }

    const vehicle = (await tx.get('vehicles', req.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const cancelNote = String(reason || '').trim() || 'إلغاء الطلب قبل التنفيذ';

    const updatedReq: FleetApprovalRequest = {
      ...req,
      status: 'cancelled',
      adminNote: req.adminNote ? `${req.adminNote} · ${cancelNote}` : cancelNote,
      allowedUids,
      updatedAt: nowIso,
    };

    let updatedVehicle = { ...vehicle, allowedUids, updatedAt: nowIso };
    if (vehicle.reservedForRequestId === requestId && vehicle.status === 'reserved') {
      const settingsDoc = await tx.get('operationalSettings', 'default');
      const fleetConfig = getFleetConfigFromSettings(settingsDoc);
      const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
      const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
      const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
      const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
      updatedVehicle.status = 'available';
      updatedVehicle.reservedForRequestId = '';
      const nextAvail = computeVehicleAvailabilityItem({
        vehicle: updatedVehicle,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: claims,
        config: fleetConfig,
      });
      updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
      updatedVehicle.blockingReasons = nextAvail.blockingReasons;

      const stHistoryId = `st_${vehicle.vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('vehicleStatusHistory', stHistoryId, {
        historyId: stHistoryId,
        vehicleInternalId: vehicle.vehicleInternalId,
        plateNumber: vehicle.plateNumber,
        fromStatus: 'reserved',
        toStatus: 'available',
        reason: `إلغاء حجز الطلب (${req.requestNumber}): ${cancelNote}`,
        relatedEntityType: 'approval',
        relatedEntityId: requestId,
        changedByUid: user.uid,
        changedByEmail: user.email,
        changedAt: nowIso,
        allowedUids,
      });
    }

    await tx.set('fleetApprovalRequests', requestId, updatedReq as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'status_changed',
      summaryAr: `إلغاء طلب (${req.requestNumber}): ${cancelNote}`,
      auditAction: 'FLEET_APPROVAL_CANCELLED',
      auditDetails: `إلغاء الطلب ${req.requestNumber} — ${cancelNote}`,
      referenceType: 'approval',
      referenceId: requestId,
      nowIso,
    });

    const response = { approval: updatedReq, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, `POST:/api/fleet/approvals/${requestId}/cancel`, user.uid, 200, response);
    return response;
  });
}

// ==========================================
// PHASE 4: ENTERPRISE HANDOVER, RETURN INSPECTION & CUSTODY TRANSFER
// ==========================================

export interface ExecuteHandoverInput {
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
}

export async function executeVehicleHandoverTransactional(
  user: VerifiedAuthUser,
  input: ExecuteHandoverInput,
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.handover.create', 'صلاحياتك لا تسمح بإنشاء محاضر تسليم العهد.');

  const vehicleId = String(input.vehicleInternalId || '').trim();
  const riderId = String(input.riderId || '').trim();
  const handoverDate = String(input.handoverDate || new Date().toISOString().slice(0, 10)).trim();
  if (!vehicleId || !riderId) {
    throw createFleetError(400, 'يجب تحديد المركبة والمندوب لإتمام محضر التسليم.');
  }
  if (!input.riderAcknowledged) {
    throw createFleetError(400, 'يجب تأكيد إقرار واستلام المندوب للمركبة في محضر التسليم.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'riderMaster',
    'vehicles',
    'vehicleAssignments',
    'vehicleCustodies',
    'vehicleHandovers',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{
      custody: VehicleCustody;
      handover: VehicleHandoverRecord;
      assignment: VehicleAssignment;
      vehicle: VehicleMaster;
    }>(tx, idempotencyKey, 'POST:/api/fleet/handovers', user.uid);
    if (cached) return cached;

    const vehicle = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة.`);
    if (!isVehicleInUserScope(vehicle, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const rider = (await tx.get('riderMaster', riderId)) as RiderMaster | null;
    if (!rider) throw createFleetError(404, `المندوب (${riderId}) غير موجود في الموارد البشرية.`);
    if (['terminated', 'inactive', 'suspended'].includes(rider.status)) {
      throw createFleetError(409, `لا يمكن تسليم مركبة لمندوب حالته الوظيفية (${rider.status}).`);
    }

    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const handovers = await tx.list<VehicleHandoverRecord>('vehicleHandovers');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const approvals = await tx.list<FleetApprovalRequest>('fleetApprovalRequests');

    const activeVehCustody = custodies.find(
      (c) => c.vehicleInternalId === vehicleId && (c.status === 'active' || c.status === 'pending_return')
    );
    if (activeVehCustody || vehicle.activeCustodyId || vehicle.status === 'assigned') {
      throw createFleetError(409, `المركبة (${vehicle.plateNumber}) مسلمة حاليًا ولا يمكن تسليمها قبل استلام العهدة الحالية.`);
    }

    if (fleetConfig.singleVehiclePerRider) {
      const riderActiveCustody = custodies.find(
        (c) => c.riderId === riderId && (c.status === 'active' || c.status === 'pending_return')
      );
      if (riderActiveCustody) {
        throw createFleetError(
          409,
          `المندوب (${rider.fullName}) لديه عهدة نشطة بالفعل للمركبة (${riderActiveCustody.plateNumber}).`
        );
      }
    }

    let linkedApproval: FleetApprovalRequest | null = null;
    if (input.approvalRequestId) {
      linkedApproval = approvals.find((a) => a.requestId === input.approvalRequestId) || null;
      if (!linkedApproval) throw createFleetError(404, 'طلب الاعتماد المحدد غير موجود.');
      if (linkedApproval.vehicleInternalId !== vehicleId || linkedApproval.riderId !== riderId) {
        throw createFleetError(400, 'طلب الاعتماد لا يطابق المركبة أو المندوب المحدد في محضر التسليم.');
      }
      if (linkedApproval.status !== 'approved') {
        throw createFleetError(
          409,
          `لا يمكن تنفيذ التسليم قبل اكتمال جميع مراحل الاعتماد والتفويض للطلب ${linkedApproval.requestNumber}.`
        );
      }
      if (fleetConfig.requireOpsAndAdminForDelegation && !linkedApproval.delegationNumber && !linkedApproval.delegationDocId) {
        throw createFleetError(409, 'السياسة تلزم إرفاق رقم أو وثيقة التفويض قبل تسليم المركبة.');
      }
    } else {
      if (vehicle.status === 'reserved' || vehicle.reservedForRequestId) {
        throw createFleetError(409, 'المركبة محجوزة لطلب اعتماد محدد؛ يرجى تنفيذ التسليم عبر ذلك الطلب المعتمد.');
      }
      const canBypass =
        Boolean(input.directOverride) &&
        (hasFleetPermOnUser(user, 'fleet.handover.approve') || hasFleetPermOnUser(user, 'fleet.assignment.admin_approve'));
      if (fleetConfig.requireOpsAndAdminForDelegation && !canBypass) {
        throw createFleetError(
          409,
          'سياسة الأسطول تتطلب تقديم طلب ربط واعتماده تشغيليًا وإداريًا مع التفويض قبل تنفيذ التسليم.'
        );
      }
      const avail = computeVehicleAvailabilityItem({
        vehicle,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: claims,
        config: fleetConfig,
      });
      if (!avail.readyToDispatch && !canBypass) {
        throw createFleetError(409, `المركبة غير جاهزة للتسليم: ${avail.blockingReasons.join(' · ')}`);
      }
    }

    const odometerVal =
      input.odometer !== null && input.odometer !== undefined && Number.isFinite(Number(input.odometer))
        ? Number(input.odometer)
        : vehicle.currentOdometer ?? null;
    if (
      odometerVal !== null &&
      vehicle.currentOdometer !== null &&
      vehicle.currentOdometer !== undefined &&
      odometerVal < vehicle.currentOdometer
    ) {
      throw createFleetError(
        400,
        `قراءة العداد عند التسليم (${odometerVal} كم) لا يمكن أن تكون أقل من آخر عداد مسجل للمركبة (${vehicle.currentOdometer} كم).`
      );
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const custodyNumber = generateSequentialCode('CUST', custodies.map((c) => c.custodyNumber || c.custodyId));
    const handoverNumber = generateSequentialCode('HND', handovers.map((h) => h.handoverNumber || h.handoverId));
    const custodyId = `cust_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const handoverId = `hnd_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const assignmentId = `asg_${vehicleId}_${Date.now().toString(36)}`;

    const custody: VehicleCustody = {
      custodyId,
      custodyNumber,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      riderId: rider.internalRiderId,
      riderName: rider.fullName,
      branch: vehicle.branch || rider.branch,
      city: vehicle.city || rider.city,
      status: 'active',
      handoverId,
      assignmentId,
      approvalRequestId: linkedApproval?.requestId,
      delegationDocumentId: linkedApproval?.delegationDocId,
      startedAt: handoverDate,
      startOdometer: odometerVal,
      fuelLevelStart: input.fuelLevel || 'ممتلئ 4/4',
      custodyNotes: input.notes?.trim().slice(0, 600) || undefined,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const handover: VehicleHandoverRecord = {
      handoverId,
      handoverNumber,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      riderId: rider.internalRiderId,
      riderName: rider.fullName,
      custodyId,
      approvalRequestId: linkedApproval?.requestId,
      handoverType: input.handoverType || 'new_handover',
      status: 'completed',
      handoverDate,
      handoverTime: input.handoverTime || new Date().toTimeString().slice(0, 5),
      odometer: odometerVal,
      fuelLevel: input.fuelLevel || 'ممتلئ 4/4',
      overallCondition: String(input.overallCondition || 'سليمة جاهزة للتشغيل').trim().slice(0, 300),
      notes: input.notes?.trim().slice(0, 1000) || undefined,
      checklist: Array.isArray(input.checklist) ? input.checklist : [],
      accessories: Array.isArray(input.accessories) ? input.accessories : [],
      photoSlots: Array.isArray(input.photoSlots) ? input.photoSlots : [],
      riderAcknowledged: true,
      riderAcknowledgmentMethod: input.riderAcknowledgmentMethod || 'signature',
      supervisorUid: user.uid,
      supervisorName: user.email,
      approvedByUid: user.uid,
      approvedByEmail: user.email,
      approvedAt: nowIso,
      customFields: input.customFields,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const assignment: VehicleAssignment = {
      assignmentId,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      companyRiderId: rider.internalRiderId,
      riderName: rider.fullName,
      handoverDate,
      handoverTime: handover.handoverTime,
      handoverOdometer: odometerVal,
      handoverCondition: handover.overallCondition,
      handoverNotes: handover.notes,
      handoverDocIds: handover.photoSlots.map((p) => p.docId).filter(Boolean),
      handoverByUid: user.uid,
      handoverByEmail: user.email,
      status: 'active',
      customFields: input.customFields,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      status: 'assigned',
      currentRiderId: rider.internalRiderId,
      activeCustodyId: custodyId,
      currentAssignmentId: assignmentId,
      reservedForRequestId: '',
      currentOdometer: odometerVal ?? vehicle.currentOdometer,
      allowedUids,
      updatedAt: nowIso,
    };
    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: [...custodies, custody],
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('vehicleCustodies', custodyId, custody as unknown as Record<string, unknown>);
    await tx.set('vehicleHandovers', handoverId, handover as unknown as Record<string, unknown>);
    await tx.set('vehicleAssignments', assignmentId, assignment as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicleId, updatedVehicle as unknown as Record<string, unknown>);

    if (linkedApproval) {
      await tx.set('fleetApprovalRequests', linkedApproval.requestId, {
        ...linkedApproval,
        custodyId,
        targetEntityType: 'handover',
        targetEntityId: handoverId,
        status: 'completed',
        updatedAt: nowIso,
      });
    }

    const stHistoryId = `st_${vehicleId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('vehicleStatusHistory', stHistoryId, {
      historyId: stHistoryId,
      vehicleInternalId: vehicleId,
      plateNumber: updatedVehicle.plateNumber,
      fromStatus: vehicle.status,
      toStatus: 'assigned',
      reason: `تسليم عهدة (${custodyNumber}) عبر محضر (${handoverNumber}) إلى المندوب ${rider.fullName}`,
      relatedEntityType: 'handover',
      relatedEntityId: handoverId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    });

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'handover_completed',
      summaryAr: `إتمام محضر التسليم (${handoverNumber}) وتفعيل العهدة (${custodyNumber}) للمندوب ${rider.fullName}`,
      auditAction: 'VEHICLE_HANDOVER_CREATED',
      auditDetails: `تسليم المركبة ${updatedVehicle.plateNumber} (${custodyNumber}/${handoverNumber}) إلى ${rider.fullName} بعداد ${odometerVal ?? '—'}`,
      referenceType: 'handover',
      referenceId: handoverId,
      riderId: rider.internalRiderId,
      riderName: rider.fullName,
      odometer: odometerVal,
      newValue: { custodyNumber, handoverNumber, riderId: rider.internalRiderId, odometer: odometerVal },
      nowIso,
    });

    const notifId = `notif_hnd_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('fleetNotifications', notifId, {
      notificationId: notifId,
      type: 'custody_changed',
      severity: 'info',
      titleAr: `تسليم عهدة جديدة (${custodyNumber})`,
      messageAr: `تم تسليم المركبة ${updatedVehicle.plateNumber} للمندوب ${rider.fullName} بتاريخ ${handoverDate}.`,
      vehicleInternalId: vehicleId,
      plateNumber: updatedVehicle.plateNumber,
      riderId: rider.internalRiderId,
      referenceType: 'handover',
      referenceId: handoverId,
      targetRoles: ['fleet_manager', 'operations_manager', 'super_admin'],
      readByUids: [],
      createdAt: nowIso,
      allowedUids,
    });

    const response = { custody, handover, assignment, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/handovers', user.uid, 201, response);
    return response;
  });
}

export interface ExecuteReturnInput {
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
}

export async function executeVehicleReturnTransactional(
  user: VerifiedAuthUser,
  input: ExecuteReturnInput,
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.return.create', 'صلاحياتك لا تسمح بتسجيل محاضر استلام وفحص الإرجاع.');

  const rawVehicleId = String(input.vehicleInternalId || '').trim();
  const custodyHintId = String(input.custodyId || '').trim();
  const returnDate = String(input.returnDate || new Date().toISOString().slice(0, 10)).trim();
  if (!rawVehicleId && !custodyHintId) throw createFleetError(400, 'يجب تحديد المركبة أو العهدة المطلوب استلامها.');
  if (input.damageDetected && !String(input.damageSummary || '').trim()) {
    throw createFleetError(400, 'عند رصد أضرار أثناء الفحص يجب كتابة وصف واضح للضرر.');
  }

  const finalize = input.finalizeImmediately !== false;
  if (finalize && !hasFleetPermOnUser(user, 'fleet.return.approve') && !hasFleetPermOnUser(user, 'fleet.edit')) {
    throw createFleetError(403, 'إغلاق العهدة نهائيًا يتطلب صلاحية اعتماد الاستلام؛ يمكنك تسجيلها كفحص مبدئي بانتظار الاعتماد.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleAssignments',
    'vehicleCustodies',
    'vehicleReturns',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{
      returnRecord: VehicleReturnRecord;
      custody: VehicleCustody;
      damageClaim: VehicleDamageClaim | null;
      vehicle: VehicleMaster;
    }>(tx, idempotencyKey, 'POST:/api/fleet/returns', user.uid);
    if (cached) return cached;

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const hintedCustody = custodyHintId ? custodies.find((c) => c.custodyId === custodyHintId) || null : null;
    const vehicleId = rawVehicleId || hintedCustody?.vehicleInternalId || '';
    if (!vehicleId) throw createFleetError(400, 'يجب تحديد المركبة المطلوب استلامها.');

    const vehicle = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, `المركبة (${vehicleId}) غير موجودة.`);
    if (!isVehicleInUserScope(vehicle, user)) {
      throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');
    }

    const returnsList = await tx.list<VehicleReturnRecord>('vehicleReturns');
    const assignments = await tx.list<VehicleAssignment>('vehicleAssignments');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);

    const activeCustody =
      (input.custodyId ? custodies.find((c) => c.custodyId === input.custodyId) : null) ||
      custodies.find((c) => c.vehicleInternalId === vehicleId && (c.status === 'active' || c.status === 'pending_return'));

    if (!activeCustody) {
      throw createFleetError(409, `لا توجد عهدة نشطة مسجلة للمركبة (${vehicle.plateNumber}) ليتم استلامها.`);
    }

    const odoReturn =
      input.odometerAtReturn !== null &&
      input.odometerAtReturn !== undefined &&
      Number.isFinite(Number(input.odometerAtReturn))
        ? Number(input.odometerAtReturn)
        : null;

    if (
      odoReturn !== null &&
      activeCustody.startOdometer !== null &&
      activeCustody.startOdometer !== undefined &&
      odoReturn < activeCustody.startOdometer
    ) {
      throw createFleetError(
        400,
        `قراءة العداد عند الاستلام (${odoReturn} كم) أقل من قراءة التسليم (${activeCustody.startOdometer} كم).`
      );
    }

    const distanceDriven =
      odoReturn !== null && activeCustody.startOdometer !== null && activeCustody.startOdometer !== undefined
        ? Math.max(0, odoReturn - activeCustody.startOdometer)
        : null;

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const returnNumber = generateSequentialCode('RET', returnsList.map((r) => r.returnNumber || r.returnId));
    const returnId = `ret_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const nextVehStatus: VehicleStatus = finalize ? input.recommendedNextStatus : 'pending_return_inspection';

    let damageClaim: VehicleDamageClaim | null = null;
    if (input.damageDetected) {
      const claimNumber = generateSequentialCode('CLM', claims.map((c) => c.claimNumber || c.claimId));
      const claimId = `clm_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
      damageClaim = {
        claimId,
        claimNumber,
        vehicleInternalId: vehicleId,
        plateNumber: vehicle.plateNumber,
        custodyId: activeCustody.custodyId,
        returnId,
        riderId: activeCustody.riderId,
        riderName: activeCustody.riderName,
        severity: input.damageSeverity || 'moderate',
        description: String(input.damageSummary || '').trim().slice(0, 1000),
        estimatedRepairCost:
          input.estimatedRepairCost !== undefined && input.estimatedRepairCost !== null
            ? Number(input.estimatedRepairCost)
            : null,
        liability: input.damageLiability || 'under_review',
        status: 'open',
        photoDocIds: (input.photoSlots || []).map((p) => p.docId).filter(Boolean),
        notes: input.notes?.trim().slice(0, 600) || undefined,
        createdByUid: user.uid,
        allowedUids,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await tx.set('vehicleDamageClaims', claimId, damageClaim as unknown as Record<string, unknown>);
      claims.push(damageClaim);
    }

    const returnRecord: VehicleReturnRecord = {
      returnId,
      returnNumber,
      custodyId: activeCustody.custodyId,
      handoverId: activeCustody.handoverId,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      riderId: activeCustody.riderId,
      riderName: activeCustody.riderName,
      status: finalize ? 'completed' : 'pending_inspection',
      returnDate,
      returnTime: input.returnTime || new Date().toTimeString().slice(0, 5),
      odometerAtReturn: odoReturn,
      fuelLevelAtReturn: input.fuelLevelAtReturn || 'غير محدد',
      distanceDriven,
      overallCondition: String(input.overallCondition || 'تم الاستلام والفحص').trim().slice(0, 300),
      checklist: Array.isArray(input.checklist) ? input.checklist : [],
      accessories: Array.isArray(input.accessories) ? input.accessories : [],
      photoSlots: Array.isArray(input.photoSlots) ? input.photoSlots : [],
      damageDetected: Boolean(input.damageDetected),
      damageSummary: input.damageSummary?.trim().slice(0, 1000) || undefined,
      damageClaimId: damageClaim?.claimId,
      recommendedNextStatus: input.recommendedNextStatus || 'available',
      finalVehicleStatus: nextVehStatus,
      inspectorUid: user.uid,
      inspectorName: user.email,
      approvedByUid: finalize ? user.uid : undefined,
      approvedByEmail: finalize ? user.email : undefined,
      approvedAt: finalize ? nowIso : undefined,
      notes: input.notes?.trim().slice(0, 1000) || undefined,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedCustody: VehicleCustody = {
      ...activeCustody,
      status: finalize ? 'returned' : 'pending_return',
      returnId,
      endedAt: finalize ? returnDate : activeCustody.endedAt,
      endOdometer: odoReturn ?? activeCustody.endOdometer,
      fuelLevelEnd: input.fuelLevelAtReturn || activeCustody.fuelLevelEnd,
      allowedUids,
      updatedAt: nowIso,
    };

    // Update matching legacy VehicleAssignment
    const matchingAssignment =
      (activeCustody.assignmentId ? assignments.find((a) => a.assignmentId === activeCustody.assignmentId) : null) ||
      assignments.find((a) => a.vehicleInternalId === vehicleId && a.status === 'active');

    if (matchingAssignment && finalize) {
      await tx.set('vehicleAssignments', matchingAssignment.assignmentId, {
        ...matchingAssignment,
        status: 'returned',
        returnDate,
        returnTime: returnRecord.returnTime,
        returnOdometer: odoReturn,
        returnCondition: returnRecord.overallCondition,
        returnDamageNotes: input.damageSummary || '',
        returnNotes: input.notes || '',
        returnByUid: user.uid,
        returnByEmail: user.email,
        updatedAt: nowIso,
      });
    }

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      status: nextVehStatus,
      currentRiderId: finalize ? '' : vehicle.currentRiderId,
      activeCustodyId: finalize ? '' : activeCustody.custodyId,
      currentAssignmentId: finalize ? '' : vehicle.currentAssignmentId,
      currentOdometer: odoReturn ?? vehicle.currentOdometer,
      stopReason:
        finalize && input.recommendedNextStatus === 'stopped'
          ? input.damageSummary || input.notes || 'تم الإيقاف بعد فحص الاستلام'
          : finalize
            ? ''
            : vehicle.stopReason,
      allowedUids,
      updatedAt: nowIso,
    };

    const custodiesUpdated = custodies.map((c) => (c.custodyId === updatedCustody.custodyId ? updatedCustody : c));
    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: custodiesUpdated,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('vehicleReturns', returnId, returnRecord as unknown as Record<string, unknown>);
    await tx.set('vehicleCustodies', updatedCustody.custodyId, updatedCustody as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicleId, updatedVehicle as unknown as Record<string, unknown>);

    const stHistoryId = `st_${vehicleId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('vehicleStatusHistory', stHistoryId, {
      historyId: stHistoryId,
      vehicleInternalId: vehicleId,
      plateNumber: updatedVehicle.plateNumber,
      fromStatus: vehicle.status,
      toStatus: nextVehStatus,
      reason: finalize
        ? `استلام وإغلاق العهدة (${activeCustody.custodyNumber}) عبر محضر (${returnNumber})`
        : `تسجيل فحص استلام مبدئي (${returnNumber}) بانتظار الاعتماد`,
      relatedEntityType: 'return',
      relatedEntityId: returnId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    });

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: finalize ? 'return_completed' : 'return_initiated',
      summaryAr: finalize
        ? `استلام المركبة وإغلاق العهدة (${activeCustody.custodyNumber}) من ${activeCustody.riderName}${distanceDriven !== null ? ` — مسافة مقطوعة ${distanceDriven} كم` : ''}`
        : `فتح محضر فحص استلام مبدئي (${returnNumber}) من ${activeCustody.riderName}`,
      auditAction: 'VEHICLE_RETURN_RECORDED',
      auditDetails: `${finalize ? 'إغلاق عهدة' : 'فحص مبدئي'} ${activeCustody.custodyNumber} للمركبة ${updatedVehicle.plateNumber}${damageClaim ? ` · بلاغ ضرر ${damageClaim.claimNumber}` : ''}`,
      referenceType: 'return',
      referenceId: returnId,
      riderId: activeCustody.riderId,
      riderName: activeCustody.riderName,
      odometer: odoReturn,
      newValue: { returnNumber, nextVehStatus, distanceDriven, damageClaimId: damageClaim?.claimId },
      nowIso,
    });

    if (damageClaim) {
      const notifId = `notif_dmg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('fleetNotifications', notifId, {
        notificationId: notifId,
        type: 'damage_reported',
        severity: damageClaim.severity === 'critical' || damageClaim.severity === 'major' ? 'critical' : 'warning',
        titleAr: `رصد ضرر مركبة (${damageClaim.claimNumber}) — ${updatedVehicle.plateNumber}`,
        messageAr: `${damageClaim.description} — المندوب: ${activeCustody.riderName}`,
        vehicleInternalId: vehicleId,
        plateNumber: updatedVehicle.plateNumber,
        riderId: activeCustody.riderId,
        referenceType: 'damage_claim',
        referenceId: damageClaim.claimId,
        targetRoles: ['fleet_manager', 'operations_manager', 'super_admin'],
        readByUids: [],
        createdAt: nowIso,
        allowedUids,
      });
    }

    const response = { returnRecord, custody: updatedCustody, damageClaim, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/returns', user.uid, 201, response);
    return response;
  });
}

export async function approvePendingReturnTransactional(
  user: VerifiedAuthUser,
  returnId: string,
  input: { nextVehicleStatus?: 'available' | 'maintenance' | 'stopped'; note?: string },
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.return.approve', 'صلاحياتك لا تسمح باعتماد إغلاق محاضر الاستلام.');

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleAssignments',
    'vehicleCustodies',
    'vehicleReturns',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ returnRecord: VehicleReturnRecord; custody: VehicleCustody; vehicle: VehicleMaster }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/returns/${returnId}/approve`,
      user.uid
    );
    if (cached) return cached;

    const ret = (await tx.get('vehicleReturns', returnId)) as VehicleReturnRecord | null;
    if (!ret) throw createFleetError(404, 'محضر الاستلام غير موجود.');
    if (ret.status === 'completed') throw createFleetError(409, 'تم اعتماد وإغلاق هذا المحضر مسبقًا.');

    const custody = (await tx.get('vehicleCustodies', ret.custodyId)) as VehicleCustody | null;
    if (!custody) throw createFleetError(404, 'العهدة المرتبطة غير موجودة.');

    const vehicle = (await tx.get('vehicles', ret.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const targetVehStatus = input.nextVehicleStatus || ret.recommendedNextStatus || 'available';

    const updatedRet: VehicleReturnRecord = {
      ...ret,
      status: 'completed',
      finalVehicleStatus: targetVehStatus,
      approvedByUid: user.uid,
      approvedByEmail: user.email,
      approvedAt: nowIso,
      notes: input.note ? `${ret.notes ? `${ret.notes} · ` : ''}${input.note}` : ret.notes,
      allowedUids,
      updatedAt: nowIso,
    };

    const updatedCustody: VehicleCustody = {
      ...custody,
      status: 'returned',
      endedAt: ret.returnDate,
      endOdometer: ret.odometerAtReturn ?? custody.endOdometer,
      allowedUids,
      updatedAt: nowIso,
    };

    const assignments = await tx.list<VehicleAssignment>('vehicleAssignments');
    const matchingAsg =
      (custody.assignmentId ? assignments.find((a) => a.assignmentId === custody.assignmentId) : null) ||
      assignments.find((a) => a.vehicleInternalId === vehicle.vehicleInternalId && a.status === 'active');
    if (matchingAsg) {
      await tx.set('vehicleAssignments', matchingAsg.assignmentId, {
        ...matchingAsg,
        status: 'returned',
        returnDate: ret.returnDate,
        returnTime: ret.returnTime,
        returnOdometer: ret.odometerAtReturn,
        returnCondition: ret.overallCondition,
        returnDamageNotes: ret.damageSummary || '',
        returnByUid: user.uid,
        returnByEmail: user.email,
        updatedAt: nowIso,
      });
    }

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      status: targetVehStatus,
      currentRiderId: '',
      activeCustodyId: '',
      currentAssignmentId: '',
      allowedUids,
      updatedAt: nowIso,
    };
    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: custodies.map((c) => (c.custodyId === updatedCustody.custodyId ? updatedCustody : c)),
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('vehicleReturns', returnId, updatedRet as unknown as Record<string, unknown>);
    await tx.set('vehicleCustodies', updatedCustody.custodyId, updatedCustody as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    const stHistoryId = `st_${vehicle.vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await tx.set('vehicleStatusHistory', stHistoryId, {
      historyId: stHistoryId,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      fromStatus: vehicle.status,
      toStatus: targetVehStatus,
      reason: `اعتماد محضر الاستلام (${ret.returnNumber}) وإغلاق العهدة`,
      relatedEntityType: 'return',
      relatedEntityId: returnId,
      changedByUid: user.uid,
      changedByEmail: user.email,
      changedAt: nowIso,
      allowedUids,
    });

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'return_completed',
      summaryAr: `اعتماد إغلاق محضر الاستلام (${ret.returnNumber}) من المندوب ${ret.riderName}`,
      auditAction: 'FLEET_RETURN_APPROVED',
      auditDetails: `اعتماد إغلاق محضر استلام ${ret.returnNumber} للمركبة ${vehicle.plateNumber}`,
      referenceType: 'return',
      referenceId: returnId,
      riderId: ret.riderId,
      riderName: ret.riderName,
      odometer: ret.odometerAtReturn,
      nowIso,
    });

    const response = { returnRecord: updatedRet, custody: updatedCustody, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, `POST:/api/fleet/returns/${returnId}/approve`, user.uid, 200, response);
    return response;
  });
}

export async function transferVehicleCustodyTransactional(
  user: VerifiedAuthUser,
  custodyId: string,
  input: {
    toRiderId: string;
    transferDate: string;
    odometer: number | null;
    fuelLevel?: string;
    condition?: string;
    notes?: string;
  },
  idempotencyKey?: string
) {
  if (!hasFleetPermOnUser(user, 'fleet.handover.create') || !hasFleetPermOnUser(user, 'fleet.return.create')) {
    throw createFleetError(403, 'نقل العهدة يتطلب صلاحيتي إنشاء محضر الاستلام ومحضر التسليم.');
  }
  const toRiderId = String(input.toRiderId || '').trim();
  const transferDate = String(input.transferDate || new Date().toISOString().slice(0, 10)).trim();
  if (!toRiderId) throw createFleetError(400, 'يجب تحديد المندوب المستلم الجديد.');

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'riderMaster',
    'vehicles',
    'vehicleAssignments',
    'vehicleCustodies',
    'vehicleHandovers',
    'vehicleReturns',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{
      closedCustody: VehicleCustody;
      newCustody: VehicleCustody;
      vehicle: VehicleMaster;
    }>(tx, idempotencyKey, `POST:/api/fleet/custodies/${custodyId}/transfer`, user.uid);
    if (cached) return cached;

    const oldCustody = (await tx.get('vehicleCustodies', custodyId)) as VehicleCustody | null;
    if (!oldCustody) throw createFleetError(404, 'العهدة المطلوب نقلها غير موجودة.');
    if (oldCustody.status !== 'active') throw createFleetError(409, 'يمكن نقل العهد النشطة فقط.');
    if (oldCustody.riderId === toRiderId) throw createFleetError(400, 'لا يمكن نقل العهدة إلى نفس المندوب الحالي.');

    const vehicle = (await tx.get('vehicles', oldCustody.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');

    const toRider = (await tx.get('riderMaster', toRiderId)) as RiderMaster | null;
    if (!toRider) throw createFleetError(404, 'المندوب المستلم الجديد غير موجود.');
    if (['terminated', 'inactive', 'suspended'].includes(toRider.status)) {
      throw createFleetError(409, `المندوب المستلم (${toRider.fullName}) غير مؤهل للتشغيل (${toRider.status}).`);
    }

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    if (fleetConfig.singleVehiclePerRider) {
      const conflict = custodies.find(
        (c) => c.riderId === toRiderId && (c.status === 'active' || c.status === 'pending_return')
      );
      if (conflict) {
        throw createFleetError(409, `المندوب المستلم (${toRider.fullName}) لديه عهدة نشطة بالفعل (${conflict.plateNumber}).`);
      }
    }

    const odoVal =
      input.odometer !== null && input.odometer !== undefined && Number.isFinite(Number(input.odometer))
        ? Number(input.odometer)
        : vehicle.currentOdometer ?? oldCustody.startOdometer ?? null;

    if (odoVal !== null && oldCustody.startOdometer !== null && odoVal < oldCustody.startOdometer) {
      throw createFleetError(400, `عداد النقل (${odoVal}) أقل من عداد العهدة السابقة (${oldCustody.startOdometer}).`);
    }

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const handovers = await tx.list<VehicleHandoverRecord>('vehicleHandovers');
    const returnsList = await tx.list<VehicleReturnRecord>('vehicleReturns');
    const assignments = await tx.list<VehicleAssignment>('vehicleAssignments');

    const newCustodyNumber = generateSequentialCode('CUST', custodies.map((c) => c.custodyNumber || c.custodyId));
    const retNum = generateSequentialCode('RET', returnsList.map((r) => r.returnNumber || r.returnId));
    const hndNum = generateSequentialCode('HND', handovers.map((h) => h.handoverNumber || h.handoverId));
    const returnId = `ret_${vehicle.vehicleInternalId}_${Date.now().toString(36)}`;
    const newCustodyId = `cust_${vehicle.vehicleInternalId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const newHandoverId = `hnd_${vehicle.vehicleInternalId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const newAssignmentId = `asg_${vehicle.vehicleInternalId}_${Date.now().toString(36)}`;

    const retRec: VehicleReturnRecord = {
      returnId,
      returnNumber: retNum,
      custodyId: oldCustody.custodyId,
      handoverId: oldCustody.handoverId,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: oldCustody.riderId,
      riderName: oldCustody.riderName,
      status: 'completed',
      returnDate: transferDate,
      returnTime: new Date().toTimeString().slice(0, 5),
      odometerAtReturn: odoVal,
      fuelLevelAtReturn: input.fuelLevel || 'متوسط 2/4',
      distanceDriven:
        odoVal !== null && oldCustody.startOdometer !== null ? Math.max(0, odoVal - oldCustody.startOdometer) : null,
      overallCondition: input.condition || 'نقل عهدة مباشر بين مندوبين',
      checklist: [],
      accessories: [],
      photoSlots: [],
      damageDetected: false,
      recommendedNextStatus: 'available',
      finalVehicleStatus: 'assigned',
      inspectorUid: user.uid,
      inspectorName: user.email,
      approvedByUid: user.uid,
      approvedByEmail: user.email,
      approvedAt: nowIso,
      notes: input.notes,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const closedCustody: VehicleCustody = {
      ...oldCustody,
      status: 'transferred',
      returnId,
      endedAt: transferDate,
      endOdometer: odoVal,
      fuelLevelEnd: input.fuelLevel,
      allowedUids,
      updatedAt: nowIso,
    };

    const newCustody: VehicleCustody = {
      custodyId: newCustodyId,
      custodyNumber: newCustodyNumber,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: toRider.internalRiderId,
      riderName: toRider.fullName,
      branch: vehicle.branch || toRider.branch,
      city: vehicle.city || toRider.city,
      status: 'active',
      handoverId: newHandoverId,
      assignmentId: newAssignmentId,
      startedAt: transferDate,
      startOdometer: odoVal,
      fuelLevelStart: input.fuelLevel || 'متوسط 2/4',
      previousCustodyId: oldCustody.custodyId,
      custodyNotes: input.notes,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const newHandover: VehicleHandoverRecord = {
      handoverId: newHandoverId,
      handoverNumber: hndNum,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      riderId: toRider.internalRiderId,
      riderName: toRider.fullName,
      custodyId: newCustodyId,
      handoverType: 'transfer',
      status: 'completed',
      handoverDate: transferDate,
      handoverTime: new Date().toTimeString().slice(0, 5),
      odometer: odoVal,
      fuelLevel: input.fuelLevel || 'متوسط 2/4',
      overallCondition: input.condition || 'نقل عهدة مباشر',
      checklist: [],
      accessories: [],
      photoSlots: [],
      riderAcknowledged: true,
      riderAcknowledgmentMethod: 'signature',
      supervisorUid: user.uid,
      supervisorName: user.email,
      approvedByUid: user.uid,
      approvedByEmail: user.email,
      approvedAt: nowIso,
      notes: input.notes,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const oldAssignment =
      (oldCustody.assignmentId ? assignments.find((a) => a.assignmentId === oldCustody.assignmentId) : null) ||
      assignments.find((a) => a.vehicleInternalId === vehicle.vehicleInternalId && a.status === 'active');
    if (oldAssignment) {
      await tx.set('vehicleAssignments', oldAssignment.assignmentId, {
        ...oldAssignment,
        status: 'returned',
        returnDate: transferDate,
        returnOdometer: odoVal,
        returnCondition: 'نقل عهدة لمندوب آخر',
        returnByUid: user.uid,
        returnByEmail: user.email,
        updatedAt: nowIso,
      });
    }

    const newAssignment: VehicleAssignment = {
      assignmentId: newAssignmentId,
      vehicleInternalId: vehicle.vehicleInternalId,
      plateNumber: vehicle.plateNumber,
      companyRiderId: toRider.internalRiderId,
      riderName: toRider.fullName,
      handoverDate: transferDate,
      handoverTime: newHandover.handoverTime,
      handoverOdometer: odoVal,
      handoverCondition: newHandover.overallCondition,
      handoverNotes: input.notes,
      handoverByUid: user.uid,
      handoverByEmail: user.email,
      status: 'active',
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      status: 'assigned',
      currentRiderId: toRider.internalRiderId,
      activeCustodyId: newCustodyId,
      currentAssignmentId: newAssignmentId,
      currentOdometer: odoVal ?? vehicle.currentOdometer,
      allowedUids,
      updatedAt: nowIso,
    };

    await tx.set('vehicleReturns', returnId, retRec as unknown as Record<string, unknown>);
    await tx.set('vehicleCustodies', closedCustody.custodyId, closedCustody as unknown as Record<string, unknown>);
    await tx.set('vehicleCustodies', newCustodyId, newCustody as unknown as Record<string, unknown>);
    await tx.set('vehicleHandovers', newHandoverId, newHandover as unknown as Record<string, unknown>);
    await tx.set('vehicleAssignments', newAssignmentId, newAssignment as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'custody_transferred',
      summaryAr: `نقل عهدة المركبة من (${oldCustody.riderName}) إلى (${toRider.fullName}) — عهدة جديدة ${newCustodyNumber}`,
      auditAction: 'FLEET_CUSTODY_TRANSFERRED',
      auditDetails: `نقل عهدة ${vehicle.plateNumber} من ${oldCustody.riderName} إلى ${toRider.fullName} (${newCustodyNumber})`,
      referenceType: 'custody',
      referenceId: newCustodyId,
      riderId: toRider.internalRiderId,
      riderName: toRider.fullName,
      odometer: odoVal,
      nowIso,
    });

    const response = { closedCustody, newCustody, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, `POST:/api/fleet/custodies/${custodyId}/transfer`, user.uid, 200, response);
    return response;
  });
}

// ==========================================
// PHASE 5: MAINTENANCE WORK ORDERS, DAMAGE CLAIMS & DOCUMENT COMPLIANCE
// ==========================================

export interface CreateMaintenanceInput {
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
}

export async function createMaintenanceWorkOrderTransactional(
  user: VerifiedAuthUser,
  input: CreateMaintenanceInput,
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.maintenance.create', 'صلاحياتك لا تسمح بفتح أوامر الصيانة.');

  const vehicleId = String(input.vehicleInternalId || '').trim();
  const maintenanceType = String(input.maintenanceType || '').trim();
  const maintenanceDate = String(input.maintenanceDate || new Date().toISOString().slice(0, 10)).trim();
  if (!vehicleId || !maintenanceType) {
    throw createFleetError(400, 'يجب تحديد المركبة ونوع الصيانة.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'fleetApprovalRequests',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'fleetNotifications',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{
      maintenance: VehicleMaintenanceRecord;
      approval: FleetApprovalRequest | null;
      vehicle: VehicleMaster;
    }>(tx, idempotencyKey, 'POST:/api/fleet/maintenance', user.uid);
    if (cached) return cached;

    const vehicle = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const maintAll = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const approvals = await tx.list<FleetApprovalRequest>('fleetApprovalRequests');
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);

    const activeCustody = custodies.find(
      (c) => c.vehicleInternalId === vehicleId && (c.status === 'active' || c.status === 'pending_return')
    );

    const workOrderNumber = generateSequentialCode('MNT', maintAll.map((m) => m.workOrderNumber || m.maintenanceId));
    const maintenanceId = `mnt_${vehicleId}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const estCost = input.estimatedCost !== undefined && input.estimatedCost !== null ? Number(input.estimatedCost) : Number(input.cost || 0) || null;

    const shouldRequireApproval = Boolean(input.requireCostApproval && estCost && estCost > 0);
    let approval: FleetApprovalRequest | null = null;

    if (shouldRequireApproval) {
      const reqNum = generateSequentialCode('REQ', approvals.map((a) => a.requestNumber || a.requestId));
      const reqId = `req_mnt_${vehicleId}_${Date.now().toString(36)}`;
      approval = {
        requestId: reqId,
        requestNumber: reqNum,
        requestType: 'maintenance_cost',
        vehicleInternalId: vehicleId,
        plateNumber: vehicle.plateNumber,
        custodyId: activeCustody?.custodyId,
        targetEntityType: 'maintenance',
        targetEntityId: maintenanceId,
        branch: vehicle.branch,
        city: vehicle.city,
        status: 'pending_operations',
        requestedByUid: user.uid,
        requestedByEmail: user.email,
        requestedAt: nowIso,
        requestReason: `اعتماد تكلفة أمر صيانة (${workOrderNumber}): ${maintenanceType}`,
        estimatedAmount: estCost,
        createdByUid: user.uid,
        allowedUids,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await tx.set('fleetApprovalRequests', reqId, approval as unknown as Record<string, unknown>);
    }

    const canStopVehicle = Boolean(input.stopVehicle) && !activeCustody && !vehicle.activeCustodyId && vehicle.status !== 'assigned';
    const maintRecord: VehicleMaintenanceRecord = {
      maintenanceId,
      workOrderNumber,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      maintenanceType: maintenanceType.slice(0, 120),
      maintenanceDate,
      workflowStatus: shouldRequireApproval ? 'awaiting_approval' : 'open',
      custodyId: activeCustody?.custodyId,
      riderId: activeCustody?.riderId || vehicle.currentRiderId || undefined,
      cost: input.cost !== undefined && input.cost !== null ? Number(input.cost) : estCost,
      estimatedCost: estCost,
      odometer: input.odometer !== undefined && input.odometer !== null ? Number(input.odometer) : vehicle.currentOdometer ?? null,
      workshop: input.workshop?.trim().slice(0, 120) || undefined,
      details: input.details?.trim().slice(0, 1000) || undefined,
      nextMaintenanceDate: input.nextMaintenanceDate?.trim().slice(0, 10) || undefined,
      nextMaintenanceOdometer:
        input.nextMaintenanceOdometer !== undefined && input.nextMaintenanceOdometer !== null
          ? Number(input.nextMaintenanceOdometer)
          : null,
      invoiceDocId: input.invoiceDocId?.trim() || undefined,
      approvalRequestId: approval?.requestId,
      vehicleWasStopped: canStopVehicle,
      customFields: input.customFields,
      createdByUid: user.uid,
      allowedUids,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    let updatedVehicle = { ...vehicle, allowedUids, updatedAt: nowIso };
    if (canStopVehicle) {
      updatedVehicle.status = 'maintenance';
    }
    if (maintRecord.odometer && (!updatedVehicle.currentOdometer || maintRecord.odometer > updatedVehicle.currentOdometer)) {
      updatedVehicle.currentOdometer = maintRecord.odometer;
    }

    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: custodies,
      openMaintenance: [...maintAll, maintRecord],
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('vehicleMaintenance', maintenanceId, maintRecord as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicleId, updatedVehicle as unknown as Record<string, unknown>);

    if (canStopVehicle && vehicle.status !== 'maintenance') {
      const stHistoryId = `st_${vehicleId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('vehicleStatusHistory', stHistoryId, {
        historyId: stHistoryId,
        vehicleInternalId: vehicleId,
        plateNumber: vehicle.plateNumber,
        fromStatus: vehicle.status,
        toStatus: 'maintenance',
        reason: `فتح أمر صيانة (${workOrderNumber}): ${maintenanceType}`,
        relatedEntityType: 'maintenance',
        relatedEntityId: maintenanceId,
        changedByUid: user.uid,
        changedByEmail: user.email,
        changedAt: nowIso,
        allowedUids,
      });
    }

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'maintenance_opened',
      summaryAr: `فتح أمر صيانة (${workOrderNumber}) — ${maintenanceType}${estCost ? ` (تقديري ${estCost} ر.س)` : ''}`,
      auditAction: 'FLEET_MAINTENANCE_LOGGED',
      auditDetails: `أمر صيانة ${workOrderNumber} للمركبة ${vehicle.plateNumber}: ${maintenanceType}`,
      referenceType: 'maintenance',
      referenceId: maintenanceId,
      odometer: maintRecord.odometer,
      newValue: { workOrderNumber, estimatedCost: estCost, workflowStatus: maintRecord.workflowStatus },
      nowIso,
    });

    const response = { maintenance: maintRecord, approval, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/maintenance', user.uid, 201, response);
    return response;
  });
}

export async function completeMaintenanceWorkOrderTransactional(
  user: VerifiedAuthUser,
  maintenanceId: string,
  input: {
    actualCost: number | null;
    completedOdometer?: number | null;
    completedAt?: string;
    invoiceDocId?: string;
    releaseVehicleToAvailable?: boolean;
    details?: string;
  },
  idempotencyKey?: string
) {
  if (!hasFleetPermOnUser(user, 'fleet.maintenance.approve') && !hasFleetPermOnUser(user, 'fleet.edit')) {
    throw createFleetError(403, 'صلاحياتك لا تسمح بإغلاق واعتماد أوامر الصيانة.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleStatusHistory',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ maintenance: VehicleMaintenanceRecord; vehicle: VehicleMaster }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/maintenance/${maintenanceId}/complete`,
      user.uid
    );
    if (cached) return cached;

    const maint = (await tx.get('vehicleMaintenance', maintenanceId)) as VehicleMaintenanceRecord | null;
    if (!maint) throw createFleetError(404, 'أمر الصيانة غير موجود.');
    if (maint.workflowStatus === 'completed') throw createFleetError(409, 'تم إغلاق أمر الصيانة مسبقًا.');

    const vehicle = (await tx.get('vehicles', maint.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const actualCost = input.actualCost !== undefined && input.actualCost !== null ? Number(input.actualCost) : maint.cost ?? 0;

    const updatedMaint: VehicleMaintenanceRecord = {
      ...maint,
      workflowStatus: 'completed',
      actualCost,
      cost: actualCost,
      completedAt: input.completedAt || nowIso.slice(0, 10),
      completedOdometer:
        input.completedOdometer !== undefined && input.completedOdometer !== null
          ? Number(input.completedOdometer)
          : maint.odometer ?? vehicle.currentOdometer ?? null,
      invoiceDocId: input.invoiceDocId || maint.invoiceDocId,
      details: input.details ? `${maint.details ? `${maint.details} · ` : ''}${input.details}` : maint.details,
      approvedByUid: user.uid,
      approvedByEmail: user.email,
      approvedAt: nowIso,
      allowedUids,
      updatedAt: nowIso,
    };

    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const allMaint = (await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance')).map((m) =>
      m.maintenanceId === maintenanceId ? updatedMaint : m
    );
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);

    let updatedVehicle: VehicleMaster = {
      ...vehicle,
      currentOdometer: updatedMaint.completedOdometer ?? vehicle.currentOdometer,
      allowedUids,
      updatedAt: nowIso,
    };

    const canRelease = Boolean(input.releaseVehicleToAvailable) && vehicle.status === 'maintenance' && !vehicle.activeCustodyId;
    if (canRelease) {
      updatedVehicle.status = 'available';
      const stHistoryId = `st_${vehicle.vehicleInternalId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await tx.set('vehicleStatusHistory', stHistoryId, {
        historyId: stHistoryId,
        vehicleInternalId: vehicle.vehicleInternalId,
        plateNumber: vehicle.plateNumber,
        fromStatus: 'maintenance',
        toStatus: 'available',
        reason: `اكتمال أمر الصيانة (${maint.workOrderNumber || maintenanceId}) وتجهيز المركبة للتشغيل`,
        relatedEntityType: 'maintenance',
        relatedEntityId: maintenanceId,
        changedByUid: user.uid,
        changedByEmail: user.email,
        changedAt: nowIso,
        allowedUids,
      });
    }

    const nextAvail = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs,
      activeCustodies: custodies,
      openMaintenance: allMaint,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = nextAvail.readyToDispatch;
    updatedVehicle.blockingReasons = nextAvail.blockingReasons;

    await tx.set('vehicleMaintenance', maintenanceId, updatedMaint as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'maintenance_completed',
      summaryAr: `اكتمال أمر الصيانة (${maint.workOrderNumber || maintenanceId}) بتكلفة فعلية ${actualCost} ر.س`,
      auditAction: 'FLEET_MAINTENANCE_COMPLETED',
      auditDetails: `إغلاق صيانة ${maint.workOrderNumber || maintenanceId} للمركبة ${vehicle.plateNumber} بتكلفة ${actualCost}`,
      referenceType: 'maintenance',
      referenceId: maintenanceId,
      odometer: updatedMaint.completedOdometer,
      newValue: { actualCost, status: 'completed', released: canRelease },
      nowIso,
    });

    const response = { maintenance: updatedMaint, vehicle: updatedVehicle };
    await saveIdempotencyTx(tx, idempotencyKey, `POST:/api/fleet/maintenance/${maintenanceId}/complete`, user.uid, 200, response);
    return response;
  });
}

export async function updateDamageClaimTransactional(
  user: VerifiedAuthUser,
  claimId: string,
  input: {
    liability?: VehicleDamageClaim['liability'];
    status?: VehicleDamageClaim['status'];
    actualRepairCost?: number | null;
    notes?: string;
  },
  idempotencyKey?: string
) {
  if (!hasFleetPermOnUser(user, 'fleet.maintenance.approve') && !hasFleetPermOnUser(user, 'fleet.edit')) {
    throw createFleetError(403, 'صلاحياتك لا تسمح بتعديل أو تسوية مطالبات الأضرار.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ claim: VehicleDamageClaim; vehicle: VehicleMaster | null }>(
      tx,
      idempotencyKey,
      `PATCH:/api/fleet/damage-claims/${claimId}`,
      user.uid
    );
    if (cached) return cached;

    const existing = (await tx.get('vehicleDamageClaims', claimId)) as VehicleDamageClaim | null;
    if (!existing) throw createFleetError(404, 'مطالبة الضرر غير موجودة.');

    const vehicle = (await tx.get('vehicles', existing.vehicleInternalId)) as VehicleMaster | null;
    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();

    const updated: VehicleDamageClaim = {
      ...existing,
      liability: input.liability ?? existing.liability,
      status: input.status ?? existing.status,
      actualRepairCost:
        input.actualRepairCost !== undefined ? input.actualRepairCost : existing.actualRepairCost,
      notes: input.notes !== undefined ? input.notes.trim().slice(0, 600) : existing.notes,
      settledAt: input.status === 'settled' || input.status === 'closed' ? nowIso : existing.settledAt,
      settledByUid: input.status === 'settled' || input.status === 'closed' ? user.uid : existing.settledByUid,
      allowedUids,
      updatedAt: nowIso,
    };

    await tx.set('vehicleDamageClaims', claimId, updated as unknown as Record<string, unknown>);

    if (vehicle) {
      const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
      const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
      const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
      const allClaims = (await tx.list<VehicleDamageClaim>('vehicleDamageClaims')).map((c) =>
        c.claimId === claimId ? updated : c
      );
      const settingsDoc = await tx.get('operationalSettings', 'default');
      const fleetConfig = getFleetConfigFromSettings(settingsDoc);
      const nextAvail = computeVehicleAvailabilityItem({
        vehicle,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: allClaims,
        config: fleetConfig,
      });
      await tx.set('vehicles', vehicle.vehicleInternalId, {
        ...vehicle,
        readyToDispatch: nextAvail.readyToDispatch,
        blockingReasons: nextAvail.blockingReasons,
        updatedAt: nowIso,
      });

      await appendAuditAndMovementTx({
        tx,
        user,
        allowedUids,
        vehicle,
        movementType: 'damage_recorded',
        summaryAr: `تحديث بلاغ الضرر (${updated.claimNumber}) — الحالة: ${updated.status} · المسؤولية: ${updated.liability}`,
        auditAction: 'FLEET_DAMAGE_CLAIM_UPDATED',
        auditDetails: `تحديث بلاغ الضرر ${updated.claimNumber} للمركبة ${vehicle.plateNumber}`,
        referenceType: 'damage_claim',
        referenceId: claimId,
        newValue: { status: updated.status, liability: updated.liability, actualRepairCost: updated.actualRepairCost },
        nowIso,
      });
    }

    const response = { claim: updated, vehicle };
    await saveIdempotencyTx(tx, idempotencyKey, `PATCH:/api/fleet/damage-claims/${claimId}`, user.uid, 200, response);
    return response;
  });
}

export async function upsertVehicleDocumentTransactional(
  user: VerifiedAuthUser,
  input: {
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
  },
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.documents.upload', 'صلاحياتك لا تسمح بإضافة أو تحديث وثائق المركبات.');

  const vehicleId = String(input.vehicleInternalId || '').trim();
  if (!vehicleId || !input.docCategory) {
    throw createFleetError(400, 'يجب تحديد المركبة وفئة الوثيقة.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ document: VehicleDocumentRecord; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      'POST:/api/fleet/documents',
      user.uid
    );
    if (cached) return cached;

    const vehicle = (await tx.get('vehicles', vehicleId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');
    if (!isVehicleInUserScope(vehicle, user)) throw createFleetError(403, 'المركبة خارج نطاق صلاحياتك.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);
    const allDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const nowIso = new Date().toISOString();

    const existing = input.vehicleDocId
      ? allDocs.find((d) => d.vehicleDocId === input.vehicleDocId)
      : allDocs.find((d) => d.vehicleInternalId === vehicleId && d.docCategory === input.docCategory);

    const vehicleDocId = existing?.vehicleDocId || `vdoc_${vehicleId}_${input.docCategory}_${Date.now().toString(36)}`;
    const autoApprove = hasFleetPermOnUser(user, 'fleet.documents.approve');

    const record: VehicleDocumentRecord = {
      vehicleDocId,
      vehicleInternalId: vehicleId,
      plateNumber: vehicle.plateNumber,
      docCategory: input.docCategory,
      titleAr: input.titleAr?.trim() || DOC_CATEGORY_LABELS_AR[input.docCategory] || input.docCategory,
      documentNumber: input.documentNumber?.trim().slice(0, 64) ?? existing?.documentNumber,
      issuerName: input.issuerName?.trim().slice(0, 120) ?? existing?.issuerName,
      issueDate: input.issueDate?.trim().slice(0, 10) ?? existing?.issueDate,
      expiryDate: input.expiryDate?.trim().slice(0, 10) ?? existing?.expiryDate,
      privateDocId: input.privateDocId?.trim() || existing?.privateDocId,
      approvalStatus: autoApprove ? 'approved' : 'pending',
      approvedByUid: autoApprove ? user.uid : undefined,
      approvedAt: autoApprove ? nowIso : undefined,
      isMandatoryForDispatch: fleetConfig.mandatoryDocCategories.includes(input.docCategory),
      notes: input.notes?.trim().slice(0, 500) ?? existing?.notes,
      createdByUid: existing?.createdByUid || user.uid,
      allowedUids,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      istimaraNumber: input.docCategory === 'istimara' ? record.documentNumber || vehicle.istimaraNumber : vehicle.istimaraNumber,
      istimaraExpiryDate: input.docCategory === 'istimara' ? record.expiryDate || vehicle.istimaraExpiryDate : vehicle.istimaraExpiryDate,
      insuranceCompany: input.docCategory === 'insurance' ? record.issuerName || vehicle.insuranceCompany : vehicle.insuranceCompany,
      insurancePolicyNumber: input.docCategory === 'insurance' ? record.documentNumber || vehicle.insurancePolicyNumber : vehicle.insurancePolicyNumber,
      insuranceExpiryDate: input.docCategory === 'insurance' ? record.expiryDate || vehicle.insuranceExpiryDate : vehicle.insuranceExpiryDate,
      periodicInspectionExpiryDate:
        input.docCategory === 'periodic_inspection'
          ? record.expiryDate || vehicle.periodicInspectionExpiryDate
          : vehicle.periodicInspectionExpiryDate,
      allowedUids,
      updatedAt: nowIso,
    };

    const mergedDocs = existing
      ? allDocs.map((d) => (d.vehicleDocId === vehicleDocId ? record : d))
      : [...allDocs, record];

    const availability = computeVehicleAvailabilityItem({
      vehicle: updatedVehicle,
      vehicleDocs: mergedDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    updatedVehicle.readyToDispatch = availability.readyToDispatch;
    updatedVehicle.blockingReasons = availability.blockingReasons;

    await tx.set('vehicleDocuments', vehicleDocId, record as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicleId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'document_updated',
      summaryAr: `تحديث وثيقة (${record.titleAr})${record.expiryDate ? ` — انتهاء ${record.expiryDate}` : ''}`,
      auditAction: 'FLEET_DOCUMENT_UPSERTED',
      auditDetails: `تسجيل/تحديث وثيقة ${record.titleAr} للمركبة ${vehicle.plateNumber}`,
      referenceType: 'vehicle_document',
      referenceId: vehicleDocId,
      newValue: { docCategory: record.docCategory, expiryDate: record.expiryDate, approvalStatus: record.approvalStatus },
      nowIso,
    });

    const response = { document: record, vehicle: updatedVehicle, availability };
    await saveIdempotencyTx(tx, idempotencyKey, 'POST:/api/fleet/documents', user.uid, 200, response);
    return response;
  });
}

export async function decideVehicleDocumentTransactional(
  user: VerifiedAuthUser,
  vehicleDocId: string,
  input: { decision: 'approved' | 'rejected'; rejectionReason?: string },
  idempotencyKey?: string
) {
  assertFleetPermission(user, 'fleet.documents.approve', 'صلاحياتك لا تسمح باعتماد أو رفض وثائق المركبات.');

  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw createFleetError(400, 'القرار يجب أن يكون اعتماد أو رفض.');
  }
  if (input.decision === 'rejected' && !String(input.rejectionReason || '').trim()) {
    throw createFleetError(400, 'يرجى كتابة سبب رفض الوثيقة.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'vehicleMovementHistory',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{ document: VehicleDocumentRecord; vehicle: VehicleMaster; availability: VehicleAvailabilityItem }>(
      tx,
      idempotencyKey,
      `POST:/api/fleet/documents/${vehicleDocId}/decision`,
      user.uid
    );
    if (cached) return cached;

    const existing = (await tx.get('vehicleDocuments', vehicleDocId)) as VehicleDocumentRecord | null;
    if (!existing) throw createFleetError(404, 'الوثيقة غير موجودة.');

    const vehicle = (await tx.get('vehicles', existing.vehicleInternalId)) as VehicleMaster | null;
    if (!vehicle) throw createFleetError(404, 'المركبة غير موجودة.');

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const nowIso = new Date().toISOString();
    const updated: VehicleDocumentRecord = {
      ...existing,
      approvalStatus: input.decision,
      approvedByUid: user.uid,
      approvedAt: nowIso,
      rejectionReason: input.decision === 'rejected' ? input.rejectionReason?.trim().slice(0, 300) : undefined,
      allowedUids,
      updatedAt: nowIso,
    };

    const allDocs = (await tx.list<VehicleDocumentRecord>('vehicleDocuments')).map((d) =>
      d.vehicleDocId === vehicleDocId ? updated : d
    );
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');
    const settingsDoc = await tx.get('operationalSettings', 'default');
    const fleetConfig = getFleetConfigFromSettings(settingsDoc);

    const availability = computeVehicleAvailabilityItem({
      vehicle,
      vehicleDocs: allDocs,
      activeCustodies: custodies,
      openMaintenance: maintenance,
      openClaims: claims,
      config: fleetConfig,
    });
    const updatedVehicle: VehicleMaster = {
      ...vehicle,
      readyToDispatch: availability.readyToDispatch,
      blockingReasons: availability.blockingReasons,
      updatedAt: nowIso,
    };

    await tx.set('vehicleDocuments', vehicleDocId, updated as unknown as Record<string, unknown>);
    await tx.set('vehicles', vehicle.vehicleInternalId, updatedVehicle as unknown as Record<string, unknown>);

    await appendAuditAndMovementTx({
      tx,
      user,
      allowedUids,
      vehicle: updatedVehicle,
      movementType: 'document_updated',
      summaryAr: `${input.decision === 'approved' ? 'اعتماد' : 'رفض'} وثيقة (${updated.titleAr})`,
      auditAction: input.decision === 'approved' ? 'FLEET_DOCUMENT_APPROVED' : 'FLEET_DOCUMENT_REJECTED',
      auditDetails: `${input.decision === 'approved' ? 'اعتماد' : 'رفض'} وثيقة ${updated.titleAr} للمركبة ${vehicle.plateNumber}`,
      referenceType: 'vehicle_document',
      referenceId: vehicleDocId,
      nowIso,
    });

    const response = { document: updated, vehicle: updatedVehicle, availability };
    await saveIdempotencyTx(tx, idempotencyKey, `POST:/api/fleet/documents/${vehicleDocId}/decision`, user.uid, 200, response);
    return response;
  });
}

// ==========================================
// PHASE 7: FLEET SETTINGS & NOTIFICATIONS
// ==========================================

const ALLOWED_DOC_CATEGORIES = new Set<VehicleDocumentCategory>([
  'istimara',
  'insurance',
  'periodic_inspection',
  'operating_card',
  'delegation',
  'lease_contract',
  'other',
]);

export async function updateFleetConfigTransactional(
  user: VerifiedAuthUser,
  input: Partial<FleetConfigSettings>,
  idempotencyKey?: string
) {
  if (
    !hasFleetPermOnUser(user, 'fleet.settings.manage') &&
    !user.permissions?.settings?.edit
  ) {
    throw createFleetError(403, 'صلاحياتك لا تسمح بتعديل إعدادات وسياسات إدارة الأسطول.');
  }

  const cols: ValidCollectionName[] = [
    'users',
    'operationalSettings',
    'vehicles',
    'vehicleCustodies',
    'vehicleDocuments',
    'vehicleMaintenance',
    'vehicleDamageClaims',
    'auditLogs',
    'idempotencyKeys',
  ];

  return runLocalTransaction(cols, async (tx) => {
    const cached = await checkIdempotencyTx<{
      fleetConfig: FleetConfigSettings;
      vehiclesUpdated: number;
      availability: VehicleAvailabilityItem[];
    }>(tx, idempotencyKey, 'PATCH:/api/fleet/settings', user.uid);
    if (cached) return cached;

    const allowedUids = await resolveTeamAllowedUidsTx(tx, user.uid);
    const existingSettings = ((await tx.get('operationalSettings', 'default')) || {}) as Record<string, unknown>;
    const currentCfg = getFleetConfigFromSettings(existingSettings);

    const normalizeDays = (arr: unknown, fallback: number[]) => {
      if (!Array.isArray(arr)) return fallback;
      const cleaned = Array.from(
        new Set(
          arr
            .map((x) => Math.round(Number(x)))
            .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365)
        )
      ).sort((a, b) => b - a);
      return cleaned.length > 0 ? cleaned : fallback;
    };

    const nextMandatoryDocs = Array.isArray(input.mandatoryDocCategories)
      ? Array.from(
          new Set(
            input.mandatoryDocCategories.filter((c): c is VehicleDocumentCategory => ALLOWED_DOC_CATEGORIES.has(c))
          )
        )
      : currentCfg.mandatoryDocCategories;

    const nextChecklist = Array.isArray(input.defaultChecklistItems)
      ? input.defaultChecklistItems
          .filter((i) => i && String(i.labelAr || '').trim())
          .slice(0, 30)
          .map((i, idx) => ({
            itemKey: String(i.itemKey || `chk_${idx + 1}`).trim().slice(0, 60),
            labelAr: String(i.labelAr).trim().slice(0, 120),
          }))
      : currentCfg.defaultChecklistItems;

    const nextAccessories = Array.isArray(input.defaultAccessories)
      ? input.defaultAccessories
          .filter((a) => a && String(a.labelAr || '').trim())
          .slice(0, 30)
          .map((a, idx) => ({
            accessoryKey: String(a.accessoryKey || `acc_${idx + 1}`).trim().slice(0, 60),
            labelAr: String(a.labelAr).trim().slice(0, 120),
          }))
      : currentCfg.defaultAccessories;

    const nextPhotoSlots = Array.isArray(input.mandatoryPhotoSlots)
      ? input.mandatoryPhotoSlots
          .filter((s) => s && String(s.labelAr || '').trim())
          .slice(0, 16)
          .map((s, idx) => ({
            slotKey: String(s.slotKey || `photo_${idx + 1}`).trim().slice(0, 60),
            labelAr: String(s.labelAr).trim().slice(0, 120),
            required: Boolean(s.required),
          }))
      : currentCfg.mandatoryPhotoSlots;

    const nextCfg: FleetConfigSettings = {
      mandatoryDocCategories: nextMandatoryDocs,
      documentAlertDays: normalizeDays(input.documentAlertDays, currentCfg.documentAlertDays),
      delegationAlertDays: normalizeDays(input.delegationAlertDays, currentCfg.delegationAlertDays),
      maintenanceAlertDays:
        input.maintenanceAlertDays !== undefined && Number.isFinite(Number(input.maintenanceAlertDays))
          ? Math.max(1, Math.min(180, Math.round(Number(input.maintenanceAlertDays))))
          : currentCfg.maintenanceAlertDays,
      maintenanceAlertKm:
        input.maintenanceAlertKm !== undefined && Number.isFinite(Number(input.maintenanceAlertKm))
          ? Math.max(100, Math.min(20000, Math.round(Number(input.maintenanceAlertKm))))
          : currentCfg.maintenanceAlertKm,
      singleVehiclePerRider:
        typeof input.singleVehiclePerRider === 'boolean'
          ? input.singleVehiclePerRider
          : currentCfg.singleVehiclePerRider,
      strictSeparationOfDuties:
        typeof input.strictSeparationOfDuties === 'boolean'
          ? input.strictSeparationOfDuties
          : currentCfg.strictSeparationOfDuties,
      requireOpsAndAdminForDelegation:
        typeof input.requireOpsAndAdminForDelegation === 'boolean'
          ? input.requireOpsAndAdminForDelegation
          : currentCfg.requireOpsAndAdminForDelegation,
      requirePhotosOnHandover:
        typeof input.requirePhotosOnHandover === 'boolean'
          ? input.requirePhotosOnHandover
          : currentCfg.requirePhotosOnHandover,
      requirePhotosOnReturn:
        typeof input.requirePhotosOnReturn === 'boolean'
          ? input.requirePhotosOnReturn
          : currentCfg.requirePhotosOnReturn,
      mandatoryPhotoSlots: nextPhotoSlots.length > 0 ? nextPhotoSlots : currentCfg.mandatoryPhotoSlots,
      defaultChecklistItems: nextChecklist.length > 0 ? nextChecklist : currentCfg.defaultChecklistItems,
      defaultAccessories: nextAccessories.length > 0 ? nextAccessories : currentCfg.defaultAccessories,
      companyReportHeader: {
        showLogo:
          typeof input.companyReportHeader?.showLogo === 'boolean'
            ? input.companyReportHeader.showLogo
            : Boolean(currentCfg.companyReportHeader?.showLogo ?? true),
        footerDisclaimerAr:
          input.companyReportHeader?.footerDisclaimerAr !== undefined
            ? String(input.companyReportHeader.footerDisclaimerAr).trim().slice(0, 400)
            : currentCfg.companyReportHeader?.footerDisclaimerAr,
      },
    };

    const nowIso = new Date().toISOString();
    await tx.set('operationalSettings', 'default', {
      settingsId: 'default',
      ...existingSettings,
      fleetConfig: nextCfg,
      allowedUids,
      updatedByEmail: user.email,
      updatedAt: nowIso,
    });

    const vehicles = await tx.list<VehicleMaster>('vehicles');
    const vehicleDocs = await tx.list<VehicleDocumentRecord>('vehicleDocuments');
    const custodies = await tx.list<VehicleCustody>('vehicleCustodies');
    const maintenance = await tx.list<VehicleMaintenanceRecord>('vehicleMaintenance');
    const claims = await tx.list<VehicleDamageClaim>('vehicleDamageClaims');

    const updatedAvailability: VehicleAvailabilityItem[] = [];
    let vehiclesUpdated = 0;

    for (const v of vehicles) {
      const avail = computeVehicleAvailabilityItem({
        vehicle: v,
        vehicleDocs,
        activeCustodies: custodies,
        openMaintenance: maintenance,
        openClaims: claims,
        config: nextCfg,
      });
      updatedAvailability.push(avail);
      if (
        v.readyToDispatch !== avail.readyToDispatch ||
        JSON.stringify(v.blockingReasons || []) !== JSON.stringify(avail.blockingReasons)
      ) {
        await tx.set('vehicles', v.vehicleInternalId, {
          ...v,
          readyToDispatch: avail.readyToDispatch,
          blockingReasons: avail.blockingReasons,
          updatedAt: nowIso,
        });
        vehiclesUpdated++;
      }
    }

    const logId = `log_fleet_cfg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await tx.set('auditLogs', logId, {
      logId,
      action: 'FLEET_CONFIG_UPDATED',
      targetCollection: 'operationalSettings',
      targetId: 'default',
      entityType: 'settings',
      actorUid: user.uid,
      actorEmail: user.email,
      details: `تحديث سياسات وقواعد إدارة الأسطول (إلزامي: ${nextCfg.mandatoryDocCategories.join(', ') || 'لا يوجد'} · إعادة تقييم ${vehiclesUpdated} مركبة)`,
      oldValue: currentCfg,
      newValue: nextCfg,
      source: 'API',
      allowedUids,
      createdAt: nowIso,
    });

    const response = {
      fleetConfig: nextCfg,
      vehiclesUpdated,
      availability: updatedAvailability.filter((a) => {
        const veh = vehicles.find((v) => v.vehicleInternalId === a.vehicleInternalId);
        return veh ? isVehicleInUserScope(veh, user) : false;
      }),
    };
    await saveIdempotencyTx(tx, idempotencyKey, 'PATCH:/api/fleet/settings', user.uid, 200, response);
    return response;
  });
}

export async function markFleetNotificationsReadTransactional(
  user: VerifiedAuthUser,
  input: { notificationIds?: string[]; markAll?: boolean }
) {
  assertFleetPermission(user, 'fleet.view', 'صلاحياتك لا تسمح بالوصول لإشعارات الأسطول.');

  return runLocalTransaction(['fleetNotifications', 'vehicles'], async (tx) => {
    const vehicles = await tx.list<VehicleMaster>('vehicles');
    const scopedIds = new Set(vehicles.filter((v) => isVehicleInUserScope(v, user)).map((v) => v.vehicleInternalId));
    const notifications = await tx.list<FleetNotificationRecord>('fleetNotifications');
    const targetIdSet = Array.isArray(input.notificationIds) ? new Set(input.notificationIds.map(String)) : null;

    let updatedCount = 0;
    const updatedList: FleetNotificationRecord[] = [];
    for (const n of notifications) {
      const inScope = !n.vehicleInternalId || scopedIds.has(n.vehicleInternalId);
      const shouldMark = inScope && (Boolean(input.markAll) || Boolean(targetIdSet?.has(n.notificationId)));
      if (shouldMark && !(n.readByUids || []).includes(user.uid)) {
        const nextRec: FleetNotificationRecord = {
          ...n,
          readByUids: Array.from(new Set([...(n.readByUids || []), user.uid])),
        };
        await tx.set('fleetNotifications', n.notificationId, nextRec as unknown as Record<string, unknown>);
        updatedList.push(nextRec);
        updatedCount++;
      } else if (inScope) {
        updatedList.push(n);
      }
    }

    return {
      updatedCount,
      notifications: updatedList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    };
  });
}
