import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type {
  EmployeeHrStatus,
  OperationalSettings,
  PlatformAccount,
  PrivateDocumentRecord,
  RiderMaster,
  UserProfile,
  VehicleAssignment,
  VehicleMaster,
  VehicleStatus,
} from '../types/fleet';
import { db, handleFirestoreError, OperationType } from './firebase';
import type { FleetDataset } from './fleetAnalytics';

export function generateNextCompanyRiderId(existingRiders: RiderMaster[]): string {
  let maxSeq = 0;
  for (const r of existingRiders) {
    const m = /^EMP-(\d+)$/i.exec((r.internalRiderId || '').trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `EMP-${String(maxSeq + 1).padStart(4, '0')}`;
}

export function generateNextVehicleId(existingVehicles: VehicleMaster[]): string {
  let maxSeq = 0;
  for (const v of existingVehicles) {
    const m = /^VEH-(\d+)$/i.exec((v.vehicleInternalId || '').trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `VEH-${String(maxSeq + 1).padStart(4, '0')}`;
}

export function normalizePlate(plate: string): string {
  return plate.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeIqama(iqama: string): string {
  return iqama.trim().replace(/\s+/g, '');
}

export const EMPLOYEE_HR_STATUS_LABELS: Record<EmployeeHrStatus, string> = {
  new: 'جديد',
  onboarding: 'قيد التجهيز',
  ready: 'جاهز للتشغيل',
  active: 'نشط',
  suspended: 'موقوف مؤقتًا',
  on_leave: 'إجازة',
  terminated: 'منتهية خدماته',
  inactive: 'غير نشط',
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available: 'متاحة',
  assigned: 'مسلمة لمندوب',
  maintenance: 'تحت الصيانة',
  out_of_service: 'خارج الخدمة',
  leased_out: 'مؤجرة',
  ended: 'منتهية العلاقة',
};

export const DEFAULT_EXPIRY_ALERT_DAYS = [90, 60, 30, 7, 0];

export type ExpiryUrgency = 'expired' | 'due_today' | 'within_7' | 'within_30' | 'within_60' | 'within_90' | 'valid';

export interface ExpiryWatchItem {
  id: string;
  domain: 'hr' | 'fleet';
  entityType: 'rider' | 'vehicle';
  entityId: string;
  entityName: string;
  docCategory: string;
  docNumber?: string;
  expiryDate: string;
  daysRemaining: number;
  urgency: ExpiryUrgency;
  branch?: string;
}

export function computeDaysRemaining(isoDate: string | undefined, refDateIso?: string): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) return null;
  const target = new Date(`${isoDate.trim()}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const refStr = refDateIso || new Date().toISOString().slice(0, 10);
  const now = new Date(`${refStr}T00:00:00Z`).getTime();
  return Math.round((target - now) / 86400000);
}

export function classifyExpiryUrgency(daysRemaining: number, thresholds: number[] = DEFAULT_EXPIRY_ALERT_DAYS): ExpiryUrgency {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const t0 = sorted[0] ?? 0;
  const t7 = sorted[1] ?? 7;
  const t30 = sorted[2] ?? 30;
  const t60 = sorted[3] ?? 60;
  const t90 = sorted[4] ?? 90;

  if (daysRemaining < t0) return 'expired';
  if (daysRemaining === t0) return 'due_today';
  if (daysRemaining <= t7) return 'within_7';
  if (daysRemaining <= t30) return 'within_30';
  if (daysRemaining <= t60) return 'within_60';
  if (daysRemaining <= t90) return 'within_90';
  return 'valid';
}

export function computeAllDocumentExpiries(params: {
  riders: RiderMaster[];
  vehicles: VehicleMaster[];
  privateDocs: PrivateDocumentRecord[];
  settings?: OperationalSettings;
  refDateIso?: string;
}): ExpiryWatchItem[] {
  const thresholds =
    Array.isArray(params.settings?.expiryAlertDays) && params.settings!.expiryAlertDays!.length > 0
      ? params.settings!.expiryAlertDays!
      : DEFAULT_EXPIRY_ALERT_DAYS;
  const maxThreshold = Math.max(...thresholds, 90);
  const items: ExpiryWatchItem[] = [];

  for (const r of params.riders) {
    if (r.iqamaExpiryDate) {
      const days = computeDaysRemaining(r.iqamaExpiryDate, params.refDateIso);
      if (days !== null && days <= maxThreshold) {
        items.push({
          id: `iqama_${r.internalRiderId}`,
          domain: 'hr',
          entityType: 'rider',
          entityId: r.internalRiderId,
          entityName: r.fullName,
          docCategory: 'الإقامة',
          docNumber: r.iqamaNumber,
          expiryDate: r.iqamaExpiryDate,
          daysRemaining: days,
          urgency: classifyExpiryUrgency(days, thresholds),
          branch: r.branch,
        });
      }
    }
    if (r.driverLicenseExpiryDate) {
      const days = computeDaysRemaining(r.driverLicenseExpiryDate, params.refDateIso);
      if (days !== null && days <= maxThreshold) {
        items.push({
          id: `lic_${r.internalRiderId}`,
          domain: 'hr',
          entityType: 'rider',
          entityId: r.internalRiderId,
          entityName: r.fullName,
          docCategory: 'رخصة القيادة',
          docNumber: r.driverLicenseNumber,
          expiryDate: r.driverLicenseExpiryDate,
          daysRemaining: days,
          urgency: classifyExpiryUrgency(days, thresholds),
          branch: r.branch,
        });
      }
    }
  }

  for (const v of params.vehicles) {
    const checks: Array<{ key: string; label: string; dt?: string; num?: string }> = [
      { key: 'istimara', label: 'الاستمارة', dt: v.istimaraExpiryDate, num: v.istimaraNumber },
      { key: 'insurance', label: 'التأمين', dt: v.insuranceExpiryDate, num: v.insurancePolicyNumber },
      { key: 'inspection', label: 'الفحص الدوري', dt: v.periodicInspectionExpiryDate },
    ];
    for (const c of checks) {
      if (!c.dt) continue;
      const days = computeDaysRemaining(c.dt, params.refDateIso);
      if (days !== null && days <= maxThreshold) {
        items.push({
          id: `${c.key}_${v.vehicleInternalId}`,
          domain: 'fleet',
          entityType: 'vehicle',
          entityId: v.vehicleInternalId,
          entityName: `${v.plateNumber} (${v.make} ${v.model})`,
          docCategory: c.label,
          docNumber: c.num,
          expiryDate: c.dt,
          daysRemaining: days,
          urgency: classifyExpiryUrgency(days, thresholds),
        });
      }
    }
  }

  for (const d of params.privateDocs) {
    if (!d.expiryDate) continue;
    const days = computeDaysRemaining(d.expiryDate, params.refDateIso);
    if (days !== null && days <= maxThreshold) {
      items.push({
        id: `doc_${d.docId}`,
        domain: d.entityType === 'vehicle' ? 'fleet' : 'hr',
        entityType: d.entityType === 'vehicle' ? 'vehicle' : 'rider',
        entityId: d.entityId,
        entityName: d.entityLabel || d.entityId,
        docCategory: d.docTypeName || d.title,
        expiryDate: d.expiryDate,
        daysRemaining: days,
        urgency: classifyExpiryUrgency(days, thresholds),
      });
    }
  }

  return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function checkVehicleAssignmentOverlap(params: {
  vehicleInternalId: string;
  handoverDate: string;
  returnDate?: string;
  existingAssignments: VehicleAssignment[];
  ignoreAssignmentId?: string;
}): VehicleAssignment | null {
  const newStart = params.handoverDate;
  const newEnd = params.returnDate || '9999-12-31';
  for (const a of params.existingAssignments) {
    if (a.assignmentId === params.ignoreAssignmentId) continue;
    if (a.vehicleInternalId !== params.vehicleInternalId) continue;
    const existingStart = a.handoverDate;
    const existingEnd = a.status === 'active' || !a.returnDate ? '9999-12-31' : a.returnDate;
    if (existingStart <= newEnd && newStart <= existingEnd) {
      return a;
    }
  }
  return null;
}

export interface AutoLinkEvaluationResult {
  linkingStatus: 'linked' | 'unlinked' | 'conflict_review';
  historicalRecordsMatched: number;
  conflictCandidateRiderIds: string[];
  reason: string;
}

/**
 * Deterministic Auto-Linking Engine:
 * - Matches strictly on exact platformId + platformRiderId against imported historical records and existing accounts.
 * - Never auto-links on courier name alone.
 * - Flags conflicts whenever another Company Rider already holds the same platformId + platformRiderId.
 */
export function evaluatePlatformAccountAutoLink(params: {
  platformId: string;
  platformRiderId: string;
  companyRiderId: string;
  existingAccounts: PlatformAccount[];
  dataset: FleetDataset;
  ignoreAccountId?: string;
}): AutoLinkEvaluationResult {
  const pid = params.platformId.trim().toLowerCase();
  const prid = params.platformRiderId.trim();

  const conflictingAccounts = params.existingAccounts.filter(
    (a) =>
      a.accountId !== params.ignoreAccountId &&
      a.platformId.toLowerCase() === pid &&
      a.platformRiderId.trim() === prid &&
      a.companyRiderId &&
      a.companyRiderId !== params.companyRiderId
  );

  if (conflictingAccounts.length > 0) {
    return {
      linkingStatus: 'conflict_review',
      historicalRecordsMatched: 0,
      conflictCandidateRiderIds: Array.from(new Set(conflictingAccounts.map((c) => c.companyRiderId))),
      reason: `تعارض ملكية: معرّف المنصة (${prid}) مسجل بالفعل لمندوب آخر، ويلزم مراجعة واعتماد مسؤول مخوّل.`,
    };
  }

  let matchedCount = 0;
  if (pid === 'hungerstation') {
    matchedCount =
      params.dataset.hungerDaily.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.hungerDistanceDaily.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.hungerWalletSnapshots.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.hungerQualityMonthly.filter((r) => r.riderId.trim() === prid).length;
  } else if (pid === 'keeta') {
    matchedCount =
      params.dataset.keetaDashboardDaily.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.keetaVdaDaily.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.keetaRankSnapshots.filter((r) => r.riderId.trim() === prid).length +
      params.dataset.keetaFacialRecognitionDaily.filter((r) => r.riderId.trim() === prid).length;
  }

  if (matchedCount > 0 && params.companyRiderId) {
    return {
      linkingStatus: 'linked',
      historicalRecordsMatched: matchedCount,
      conflictCandidateRiderIds: [],
      reason: `تم ربط المعرّف تلقائيًا بنجاح مع ${matchedCount} سجل تشغيلي تاريخي مؤكد.`,
    };
  }

  if (params.companyRiderId && !['hungerstation', 'keeta'].includes(pid)) {
    return {
      linkingStatus: 'linked',
      historicalRecordsMatched: 0,
      conflictCandidateRiderIds: [],
      reason: 'تم ربط حساب المنصة بملف المندوب (لا توجد تقارير Excel تاريخية مرفوعة لهذه المنصة بعد).',
    };
  }

  return {
    linkingStatus: 'unlinked',
    historicalRecordsMatched: 0,
    conflictCandidateRiderIds: [],
    reason: `لم يتم العثور على سجلات تاريخية مطابقة لمعرف (${prid}) في ${params.platformId} حتى الآن.`,
  };
}

export async function writeErpAuditLog(params: {
  action: string;
  targetCollection: string;
  targetId: string;
  entityType: string;
  details: string;
  oldValue?: unknown;
  newValue?: unknown;
  source?: 'UI' | 'API' | 'Import' | 'System';
  user: UserProfile;
  allowedUids: string[];
}): Promise<void> {
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeAllowed = Array.from(new Set([params.user.uid, ...params.allowedUids].filter(Boolean))).slice(0, 20);
  const stringifyLimited = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.slice(0, 1800);
    } catch {
      return undefined;
    }
  };

  const oldStr = stringifyLimited(params.oldValue);
  const newStr = stringifyLimited(params.newValue);
  const payload: Record<string, unknown> = {
    logId,
    action: params.action.slice(0, 80),
    targetCollection: params.targetCollection.slice(0, 80),
    targetId: params.targetId.slice(0, 128),
    entityType: params.entityType.slice(0, 64),
    actorUid: params.user.uid,
    actorEmail: (params.user.email || '').slice(0, 200),
    details: params.details.slice(0, 2000),
    source: params.source || 'UI',
    allowedUids: safeAllowed.length > 0 ? safeAllowed : [params.user.uid],
    createdAt: serverTimestamp(),
  };
  if (oldStr !== undefined) payload.oldValue = oldStr;
  if (newStr !== undefined) payload.newValue = newStr;

  try {
    await setDoc(doc(db, 'auditLogs', logId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auditLogs/${logId}`);
  }
}
