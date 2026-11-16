import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from '../lib/erpDb';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Eye,
  FilePlus2,
  FileText,
  History,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  computeAllDocumentExpiries,
  EMPLOYEE_HR_STATUS_LABELS,
  generateNextCompanyRiderId,
  normalizeIqama,
  writeErpAuditLog,
  type ExpiryUrgency,
} from '../lib/erpHelpers';
import { db, DEFAULT_DOCUMENT_TYPES, getActiveAuthToken, handleFirestoreError, OperationType } from '../lib/firebase';
import { safeParseJsonResponse } from '../lib/safeFetch';
import { hasPermission } from '../shared/rbacCore';
import {
  buildEffectiveFormSchema,
  canViewDynamicField,
  formatDynamicFieldDisplayValue,
  sanitizeCustomFieldsForFirestore,
  validateDynamicFormValues,
} from '../lib/dynamicSchemaEngine';
import type {
  DocumentTypeConfig,
  DynamicFieldDefinition,
  DynamicFormDefinition,
  EmployeeHrStatus,
  OperationalSettings,
  PlatformAccount,
  PrivateDocumentRecord,
  RiderMaster,
  RiderStatusHistoryEntry,
  RoleTemplate,
  SavedViewConfig,
  UserProfile,
  VehicleAssignment,
  VehicleMaster,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { KpiCard } from './KpiCard';
import { SavedViewsBar } from './SavedViewsBar';
import {
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  Tabs,
  Textarea,
  ToastBanner,
  type BadgeTone,
  type TabItem,
} from './ui/EnterpriseUI';

export type HrSubTab = 'hr_dashboard' | 'hr_riders' | 'hr_docs' | 'hr_expiries' | 'hr_status';

interface HrManagementModuleProps {
  riders: RiderMaster[];
  privateDocs: PrivateDocumentRecord[];
  documentTypes: DocumentTypeConfig[];
  platformAccounts: PlatformAccount[];
  vehicleAssignments: VehicleAssignment[];
  vehicles: VehicleMaster[];
  settings: OperationalSettings;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  allowedUids: string[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  savedViews?: SavedViewConfig[];
  initialSubTab?: HrSubTab;
  onOpenRider360: (internalRiderId: string) => void;
  onRefresh: () => Promise<void>;
}

const URGENCY_META: Record<ExpiryUrgency, { label: string; tone: BadgeTone }> = {
  expired: { label: 'منتهي', tone: 'danger' },
  due_today: { label: 'ينتهي اليوم', tone: 'danger' },
  within_7: { label: 'خلال 7 أيام', tone: 'danger' },
  within_30: { label: 'خلال 30 يومًا', tone: 'warning' },
  within_60: { label: 'خلال 60 يومًا', tone: 'warning' },
  within_90: { label: 'خلال 90 يومًا', tone: 'info' },
  valid: { label: 'ساري', tone: 'success' },
};

const ALL_STATUSES: EmployeeHrStatus[] = [
  'new',
  'onboarding',
  'ready',
  'active',
  'suspended',
  'on_leave',
  'terminated',
  'inactive',
];

function hrStatusTone(status: EmployeeHrStatus): BadgeTone {
  if (status === 'active' || status === 'ready') return 'success';
  if (status === 'terminated' || status === 'suspended') return 'danger';
  if (status === 'new' || status === 'onboarding' || status === 'on_leave') return 'warning';
  return 'neutral';
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function HrManagementModule({
  riders,
  privateDocs,
  documentTypes,
  platformAccounts,
  vehicleAssignments,
  vehicles,
  settings,
  currentUser,
  roleTemplates,
  allowedUids,
  dynamicFields = [],
  dynamicForms = [],
  savedViews = [],
  initialSubTab = 'hr_dashboard',
  onOpenRider360,
  onRefresh,
}: HrManagementModuleProps) {
  const [subTab, setSubTab] = useState<HrSubTab>(initialSubTab);
  const [statusFilter, setStatusFilter] = useState<'all' | EmployeeHrStatus>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | ExpiryUrgency>('all');

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Full-Page Add / Edit Rider Form
  const [riderModalOpen, setRiderModalOpen] = useState(false);
  const [editingRider, setEditingRider] = useState<RiderMaster | null>(null);
  const [customFieldsValues, setCustomFieldsValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [riderForm, setRiderForm] = useState({
    fullName: '',
    iqamaNumber: '',
    iqamaIssueDate: '',
    iqamaExpiryDate: '',
    iqamaRenewalNotes: '',
    phone: '',
    birthDate: '',
    nationality: '',
    joinDate: new Date().toISOString().slice(0, 10),
    driverLicenseNumber: '',
    driverLicenseType: 'خاصة',
    driverLicenseIssueDate: '',
    driverLicenseExpiryDate: '',
    city: '',
    branch: '',
    supervisor: '',
    contractName: '',
    vehicleType: settings.customVehicleTypes?.[0] || 'سيارة سيدان',
    status: 'new' as EmployeeHrStatus,
    adminNotes: '',
  });

  // Status Change Drawer
  const [statusModalRider, setStatusModalRider] = useState<RiderMaster | null>(null);
  const [newStatusVal, setNewStatusVal] = useState<EmployeeHrStatus>('active');
  const [statusDate, setStatusDate] = useState(new Date().toISOString().slice(0, 10));
  const [statusReason, setStatusReason] = useState('');

  // Document Upload / Replace Drawer
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [replaceTargetDoc, setReplaceTargetDoc] = useState<PrivateDocumentRecord | null>(null);
  const [docForm, setDocForm] = useState({
    entityId: '',
    docTypeId: 'iqama',
    title: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
    versionNote: '',
  });
  const [docFile, setDocFile] = useState<File | null>(null);

  // Document Preview & History Drawers
  const [previewDoc, setPreviewDoc] = useState<{ doc: PrivateDocumentRecord; blobUrl: string; mime: string } | null>(null);
  const [historyDoc, setHistoryDoc] = useState<PrivateDocumentRecord | null>(null);
  const [deleteTargetDoc, setDeleteTargetDoc] = useState<PrivateDocumentRecord | null>(null);
  const [deleteTargetRider, setDeleteTargetRider] = useState<RiderMaster | null>(null);

  // Custom Document Type Quick Add
  const [newTypeAr, setNewTypeAr] = useState('');
  const [newTypeEn, setNewTypeEn] = useState('');
  const [newTypeExpires, setNewTypeExpires] = useState(true);

  const canAddHr = hasPermission(currentUser, roleTemplates, 'hr', 'add');
  const canEditHr = hasPermission(currentUser, roleTemplates, 'hr', 'edit');
  const canDeleteHr = hasPermission(currentUser, roleTemplates, 'hr', 'delete');
  const canApproveHr = hasPermission(currentUser, roleTemplates, 'hr', 'approve');
  const canViewDocs = hasPermission(currentUser, roleTemplates, 'documents', 'view');
  const canAddDocs = hasPermission(currentUser, roleTemplates, 'documents', 'add');
  const canEditDocs = hasPermission(currentUser, roleTemplates, 'documents', 'edit');
  const canDeleteDocs = hasPermission(currentUser, roleTemplates, 'documents', 'delete');

  const mergedDocTypes = useMemo(() => {
    const map = new Map<string, DocumentTypeConfig>();
    for (const def of DEFAULT_DOCUMENT_TYPES) {
      map.set(def.typeId, {
        ...def,
        createdByUid: currentUser.uid,
        allowedUids,
      });
    }
    for (const dt of documentTypes) {
      map.set(dt.typeId, dt);
    }
    return Array.from(map.values()).filter((d) => d.targetEntity === 'rider' && d.active);
  }, [documentTypes, currentUser.uid, allowedUids]);

  const riderDocs = useMemo(() => privateDocs.filter((d) => d.entityType === 'rider'), [privateDocs]);

  const allExpiries = useMemo(
    () =>
      computeAllDocumentExpiries({
        riders,
        vehicles: [],
        privateDocs: riderDocs,
        settings,
      }),
    [riders, riderDocs, settings]
  );

  const filteredExpiries = useMemo(() => {
    return allExpiries.filter((item) => urgencyFilter === 'all' || item.urgency === urgencyFilter);
  }, [allExpiries, urgencyFilter]);

  const branches = useMemo(() => {
    const set = new Set<string>(settings.configuredBranches || []);
    for (const r of riders) {
      if (r.branch) set.add(r.branch);
    }
    return Array.from(set).sort();
  }, [riders, settings.configuredBranches]);

  const filteredRiders = useMemo(() => {
    return riders.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (branchFilter !== 'all' && (r.branch || '') !== branchFilter) return false;
      return true;
    });
  }, [riders, statusFilter, branchFilter]);

  const hrKpis = useMemo(() => {
    const counts: Record<EmployeeHrStatus, number> = {
      new: 0,
      onboarding: 0,
      ready: 0,
      active: 0,
      suspended: 0,
      on_leave: 0,
      terminated: 0,
      inactive: 0,
    };
    for (const r of riders) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    const criticalExpiries = allExpiries.filter((e) =>
      ['expired', 'due_today', 'within_7', 'within_30'].includes(e.urgency)
    ).length;
    const ridersMissingIqamaDoc = riders.filter(
      (r) => !riderDocs.some((d) => d.entityId === r.internalRiderId && d.docTypeId === 'iqama')
    ).length;
    return {
      total: riders.length,
      counts,
      criticalExpiries,
      ridersMissingIqamaDoc,
      totalPrivateDocs: riderDocs.length,
    };
  }, [riders, allExpiries, riderDocs]);

  const accountsByRider = useMemo(() => {
    const map = new Map<string, PlatformAccount[]>();
    for (const acc of platformAccounts) {
      if (!acc.companyRiderId) continue;
      const list = map.get(acc.companyRiderId) || [];
      list.push(acc);
      map.set(acc.companyRiderId, list);
    }
    return map;
  }, [platformAccounts]);

  const activeVehicleByRider = useMemo(() => {
    const map = new Map<string, { plate: string; vehicleId: string }>();
    for (const a of vehicleAssignments) {
      if (a.status === 'active') {
        map.set(a.companyRiderId, { plate: a.plateNumber, vehicleId: a.vehicleInternalId });
      }
    }
    for (const v of vehicles) {
      if (v.currentRiderId && !map.has(v.currentRiderId)) {
        map.set(v.currentRiderId, { plate: v.plateNumber, vehicleId: v.vehicleInternalId });
      }
    }
    return map;
  }, [vehicleAssignments, vehicles]);

  const riderSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'hr_rider', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );

  const openCreateRider = () => {
    setEditingRider(null);
    setCustomFieldsValues({});
    setCustomFieldErrors({});
    setRiderForm({
      fullName: '',
      iqamaNumber: '',
      iqamaIssueDate: '',
      iqamaExpiryDate: '',
      iqamaRenewalNotes: '',
      phone: '',
      birthDate: '',
      nationality: '',
      joinDate: new Date().toISOString().slice(0, 10),
      driverLicenseNumber: '',
      driverLicenseType: 'خاصة',
      driverLicenseIssueDate: '',
      driverLicenseExpiryDate: '',
      city: '',
      branch: branches[0] || '',
      supervisor: '',
      contractName: '',
      vehicleType: settings.customVehicleTypes?.[0] || 'سيارة سيدان',
      status: 'new',
      adminNotes: '',
    });
    setRiderModalOpen(true);
  };

  const openEditRider = (r: RiderMaster) => {
    setEditingRider(r);
    setCustomFieldsValues(r.customFields ? { ...r.customFields } : {});
    setCustomFieldErrors({});
    setRiderForm({
      fullName: r.fullName || '',
      iqamaNumber: r.iqamaNumber || '',
      iqamaIssueDate: r.iqamaIssueDate || '',
      iqamaExpiryDate: r.iqamaExpiryDate || '',
      iqamaRenewalNotes: r.iqamaRenewalNotes || '',
      phone: r.phone || '',
      birthDate: r.birthDate || '',
      nationality: r.nationality || '',
      joinDate: r.joinDate || '',
      driverLicenseNumber: r.driverLicenseNumber || '',
      driverLicenseType: r.driverLicenseType || '',
      driverLicenseIssueDate: r.driverLicenseIssueDate || '',
      driverLicenseExpiryDate: r.driverLicenseExpiryDate || '',
      city: r.city || '',
      branch: r.branch || '',
      supervisor: r.supervisor || '',
      contractName: r.contractName || '',
      vehicleType: r.vehicleType || '',
      status: r.status || 'active',
      adminNotes: r.adminNotes || '',
    });
    setRiderModalOpen(true);
  };

  const handleSaveRider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRider && !canEditHr) return;
    if (!editingRider && !canAddHr) return;
    if (!riderForm.fullName.trim()) {
      setToast({ type: 'err', msg: 'الاسم الكامل للمندوب مطلوب.' });
      return;
    }

    const activeCustomFields = Array.from(riderSchema.fieldsById.values());
    const dynErrors = validateDynamicFormValues(
      activeCustomFields,
      riderSchema.placements,
      customFieldsValues,
      currentUser
    );
    if (Object.keys(dynErrors).length > 0) {
      setCustomFieldErrors(dynErrors);
      setToast({ type: 'err', msg: Object.values(dynErrors)[0] || 'يرجى التحقق من الحقول المخصصة المطلوبة.' });
      return;
    }
    setCustomFieldErrors({});

    const normIqama = riderForm.iqamaNumber ? normalizeIqama(riderForm.iqamaNumber) : '';
    if (normIqama) {
      const duplicate = riders.find(
        (r) => r.internalRiderId !== editingRider?.internalRiderId && normalizeIqama(r.iqamaNumber || '') === normIqama
      );
      if (duplicate) {
        setToast({
          type: 'err',
          msg: `رقم الإقامة (${normIqama}) مسجل بالفعل للمندوب: ${duplicate.fullName} (${duplicate.internalRiderId}).`,
        });
        return;
      }
    }

    setBusy(true);
    setToast(null);
    try {
      const targetId = editingRider ? editingRider.internalRiderId : generateNextCompanyRiderId(riders);
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const historyEntry: RiderStatusHistoryEntry = {
        status: riderForm.status,
        date: new Date().toISOString().slice(0, 10),
        reason: editingRider ? 'تحديث بيانات الموظف' : 'تسجيل موظف جديد في الموارد البشرية',
        changedByUid: currentUser.uid,
        changedByEmail: currentUser.email,
      };

      const sanitizedCustomFields = sanitizeCustomFieldsForFirestore(customFieldsValues);

      const rawPayload = stripUndefined({
        internalRiderId: targetId,
        fullName: riderForm.fullName.trim().slice(0, 150),
        iqamaNumber: normIqama.slice(0, 40) || undefined,
        iqamaIssueDate: riderForm.iqamaIssueDate.trim().slice(0, 10) || undefined,
        iqamaExpiryDate: riderForm.iqamaExpiryDate.trim().slice(0, 10) || undefined,
        iqamaRenewalNotes: riderForm.iqamaRenewalNotes.trim().slice(0, 600) || undefined,
        phone: riderForm.phone.trim().slice(0, 32) || undefined,
        birthDate: riderForm.birthDate.trim().slice(0, 10) || undefined,
        nationality: riderForm.nationality.trim().slice(0, 80) || undefined,
        joinDate: riderForm.joinDate.trim().slice(0, 10) || undefined,
        driverLicenseNumber: riderForm.driverLicenseNumber.trim().slice(0, 40) || undefined,
        driverLicenseType: riderForm.driverLicenseType.trim().slice(0, 60) || undefined,
        driverLicenseIssueDate: riderForm.driverLicenseIssueDate.trim().slice(0, 10) || undefined,
        driverLicenseExpiryDate: riderForm.driverLicenseExpiryDate.trim().slice(0, 10) || undefined,
        city: riderForm.city.trim().slice(0, 100) || undefined,
        branch: riderForm.branch.trim().slice(0, 100) || undefined,
        supervisor: riderForm.supervisor.trim().slice(0, 100) || undefined,
        contractName: riderForm.contractName.trim().slice(0, 120) || undefined,
        vehicleType: riderForm.vehicleType.trim().slice(0, 64) || undefined,
        status: riderForm.status,
        adminNotes: riderForm.adminNotes.trim().slice(0, 1500) || undefined,
        customFields: Object.keys(sanitizedCustomFields).length > 0 || editingRider?.customFields ? sanitizedCustomFields : undefined,
        statusHistory: editingRider
          ? editingRider.status !== riderForm.status
            ? [...(editingRider.statusHistory || []), historyEntry].slice(-50)
            : editingRider.statusHistory
          : [historyEntry],
        createdByUid: editingRider?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
      });

      const ref = doc(db, 'riderMaster', targetId);
      if (editingRider) {
        await updateDoc(ref, {
          ...rawPayload,
          updatedAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `riderMaster/${targetId}`));
      } else {
        await setDoc(ref, {
          ...rawPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `riderMaster/${targetId}`));
      }

      await writeErpAuditLog({
        action: editingRider ? 'HR_RIDER_UPDATED' : 'HR_RIDER_CREATED',
        targetCollection: 'riderMaster',
        targetId,
        entityType: 'rider',
        details: `${editingRider ? 'تحديث' : 'إضافة'} ملف المندوب ${riderForm.fullName} (${targetId})`,
        oldValue: editingRider ? { fullName: editingRider.fullName, status: editingRider.status, branch: editingRider.branch } : undefined,
        newValue: { fullName: riderForm.fullName, status: riderForm.status, branch: riderForm.branch, iqamaNumber: normIqama },
        user: currentUser,
        allowedUids,
      });

      setRiderModalOpen(false);
      setToast({
        type: 'ok',
        msg: editingRider ? `تم تحديث ملف المندوب ${targetId}.` : `تم إنشاء ملف المندوب برقم الشركة الموحد ${targetId}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حفظ ملف المندوب.' });
    } finally {
      setBusy(false);
    }
  };

  const handleStatusTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalRider) return;
    if (!canEditHr && !canApproveHr) return;
    if (!statusReason.trim()) {
      setToast({ type: 'err', msg: 'يجب إدخال سبب تغيير الحالة الوظيفية لتوثيق السجل.' });
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      const targetId = statusModalRider.internalRiderId;
      const entry: RiderStatusHistoryEntry = {
        status: newStatusVal,
        date: statusDate,
        reason: statusReason.trim().slice(0, 300),
        changedByUid: currentUser.uid,
        changedByEmail: currentUser.email,
      };
      const nextHistory = [...(statusModalRider.statusHistory || []), entry].slice(-50);
      const patch: Record<string, unknown> = {
        status: newStatusVal,
        statusHistory: nextHistory,
        updatedAt: serverTimestamp(),
      };
      if (newStatusVal === 'terminated') {
        patch.exitDate = statusDate;
      }

      await updateDoc(doc(db, 'riderMaster', targetId), patch).catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `riderMaster/${targetId}`)
      );

      await writeErpAuditLog({
        action: 'HR_RIDER_STATUS_CHANGED',
        targetCollection: 'riderMaster',
        targetId,
        entityType: 'rider',
        details: `تغيير حالة ${statusModalRider.fullName} (${targetId}) من ${EMPLOYEE_HR_STATUS_LABELS[statusModalRider.status]} إلى ${EMPLOYEE_HR_STATUS_LABELS[newStatusVal]} | السبب: ${statusReason}`,
        oldValue: statusModalRider.status,
        newValue: { status: newStatusVal, date: statusDate, reason: statusReason },
        user: currentUser,
        allowedUids,
      });

      setStatusModalRider(null);
      setStatusReason('');
      setToast({ type: 'ok', msg: `تم تغيير حالة المندوب إلى "${EMPLOYEE_HR_STATUS_LABELS[newStatusVal]}" وحفظ السجل التاريخي.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تغيير الحالة الوظيفية.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRider = async () => {
    if (!deleteTargetRider || !canDeleteHr) return;
    setBusy(true);
    try {
      const id = deleteTargetRider.internalRiderId;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const trashId = `trash_rider_${id}_${Date.now().toString(36)}`;
      await setDoc(doc(db, 'trashItems', trashId), {
        trashId,
        sourceCollection: 'riderMaster',
        sourceDocId: id,
        entityType: 'rider',
        titleAr: `${deleteTargetRider.fullName} (${id})`,
        snapshot: JSON.parse(JSON.stringify(deleteTargetRider)),
        deletedByUid: currentUser.uid,
        deletedByEmail: currentUser.email,
        deletedAt: new Date().toISOString(),
        status: 'deleted',
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'riderMaster', id)).catch((err) =>
        handleFirestoreError(err, OperationType.DELETE, `riderMaster/${id}`)
      );
      await writeErpAuditLog({
        action: 'HR_RIDER_DELETED',
        targetCollection: 'riderMaster',
        targetId: id,
        entityType: 'rider',
        details: `نقل ملف المندوب ${deleteTargetRider.fullName} (${id}) إلى سلة المحذوفات`,
        oldValue: { fullName: deleteTargetRider.fullName, iqamaNumber: deleteTargetRider.iqamaNumber },
        user: currentUser,
        allowedUids,
      });
      setDeleteTargetRider(null);
      setToast({ type: 'ok', msg: `تم نقل ملف المندوب ${id} إلى سلة المحذوفات مع إمكانية الاسترجاع.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حذف المندوب.' });
    } finally {
      setBusy(false);
    }
  };

  const openUploadDocModal = (presetRiderId?: string, replaceDoc?: PrivateDocumentRecord) => {
    setReplaceTargetDoc(replaceDoc || null);
    setDocFile(null);
    setDocForm({
      entityId: replaceDoc?.entityId || presetRiderId || riders[0]?.internalRiderId || '',
      docTypeId: replaceDoc?.docTypeId || mergedDocTypes[0]?.typeId || 'iqama',
      title: replaceDoc?.title || '',
      issueDate: replaceDoc?.issueDate || '',
      expiryDate: replaceDoc?.expiryDate || '',
      notes: replaceDoc?.notes || '',
      versionNote: replaceDoc ? 'تجديد / تحديث نسخة المستند' : '',
    });
    setDocModalOpen(true);
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) {
      setToast({ type: 'err', msg: 'اختر ملف المستند (PDF, JPG, PNG, WEBP بحد أقصى 15MB).' });
      return;
    }
    if (!docForm.entityId) {
      setToast({ type: 'err', msg: 'اختر المندوب المرتبط بالمستند.' });
      return;
    }
    const rider = riders.find((r) => r.internalRiderId === docForm.entityId);
    const typeCfg = mergedDocTypes.find((t) => t.typeId === docForm.docTypeId);

    setBusy(true);
    setToast(null);
    try {
      const idToken = await getActiveAuthToken();
      if (!idToken) throw new Error('الجلسة منتهية. أعد تسجيل الدخول.');

      const form = new FormData();
      form.append('file', docFile);
      form.append('entityType', 'rider');
      form.append('entityId', docForm.entityId);
      form.append('entityLabel', rider ? `${rider.fullName} (${rider.internalRiderId})` : docForm.entityId);
      form.append('docTypeId', docForm.docTypeId);
      form.append('docTypeName', typeCfg?.nameAr || docForm.docTypeId);
      form.append('title', docForm.title.trim() || typeCfg?.nameAr || docFile.name);
      if (docForm.issueDate) form.append('issueDate', docForm.issueDate);
      if (docForm.expiryDate) form.append('expiryDate', docForm.expiryDate);
      if (docForm.notes) form.append('notes', docForm.notes);
      if (docForm.versionNote) form.append('versionNote', docForm.versionNote);
      if (replaceTargetDoc) form.append('docId', replaceTargetDoc.docId);

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
      });
      const json = await safeParseJsonResponse<{ success?: boolean; error?: string }>(res);
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل رفع المستند إلى الخزينة الخاصة.');
      }

      setDocModalOpen(false);
      setToast({
        type: 'ok',
        msg: replaceTargetDoc ? 'تم رفع النسخة الجديدة وحفظ النسخة السابقة في الأرشيف.' : 'تم رفع وحفظ المستند في الخزينة الخاصة بأمان.',
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل رفع المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPrivateFile = async (docRec: PrivateDocumentRecord, download: boolean, version?: number) => {
    if (!canViewDocs) return;
    setBusy(true);
    try {
      const idToken = await getActiveAuthToken();
      if (!idToken) throw new Error('يلزم تسجيل الدخول للوصول للمستند.');
      const url = `/api/documents/${encodeURIComponent(docRec.docId)}/file?${version ? `version=${version}&` : ''}${download ? 'download=1' : 'download=0'}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const errJson = await safeParseJsonResponse<{ error?: string }>(res).catch(() => ({ error: undefined }));
        throw new Error(errJson.error || `تعذر فتح المستند (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      if (download) {
        const verObj = docRec.versions.find((v) => v.version === (version || docRec.currentVersion)) || docRec.versions[docRec.versions.length - 1];
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = verObj?.originalFileName || `${docRec.docId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      } else {
        setPreviewDoc({ doc: docRec, blobUrl, mime: blob.type || 'application/pdf' });
      }
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر عرض المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePrivateDoc = async () => {
    if (!deleteTargetDoc || !canDeleteDocs) return;
    setBusy(true);
    try {
      const idToken = await getActiveAuthToken();
      if (!idToken) throw new Error('الجلسة منتهية.');
      const res = await fetch(`/api/documents/${encodeURIComponent(deleteTargetDoc.docId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await safeParseJsonResponse<{ success?: boolean; error?: string }>(res);
      if (!res.ok || !json.success) throw new Error(json.error || 'فشل حذف المستند.');
      setDeleteTargetDoc(null);
      setToast({ type: 'ok', msg: 'تم حذف المستند وجميع نسخه من الخزينة الخاصة.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حذف المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAddCustomDocType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeAr.trim() || !canAddDocs) return;
    setBusy(true);
    try {
      const typeId = `custom_${Date.now()}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'documentTypes', typeId), {
        typeId,
        nameAr: newTypeAr.trim().slice(0, 120),
        nameEn: (newTypeEn.trim() || newTypeAr.trim()).slice(0, 120),
        targetEntity: 'rider',
        requiresExpiry: newTypeExpires,
        isDefault: false,
        active: true,
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewTypeAr('');
      setNewTypeEn('');
      setToast({ type: 'ok', msg: 'تمت إضافة نوع المستند الجديد لقائمة الموارد البشرية.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل إضافة نوع المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const riderColumns: TableColumn<RiderMaster>[] = [
    {
      key: 'id',
      header: 'رقم الشركة',
      sortValue: (r) => r.internalRiderId,
      render: (r) => (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onOpenRider360(r.internalRiderId);
          }}
          className="font-mono-num font-bold text-blue-700 dark:text-blue-400 hover:underline"
        >
          {r.internalRiderId}
        </button>
      ),
    },
    {
      key: 'name',
      header: 'الاسم الكامل',
      sortValue: (r) => r.fullName,
      render: (r) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{r.fullName}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
            {[r.nationality, r.phone].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'iqama',
      header: 'الإقامة والانتهاء',
      sortValue: (r) => r.iqamaExpiryDate || '',
      render: (r) => (
        <div className="font-mono-num text-xs">
          <div className="text-slate-800 dark:text-slate-200">{r.iqamaNumber || '—'}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.iqamaExpiryDate || 'بدون تاريخ'}</div>
        </div>
      ),
    },
    {
      key: 'branch',
      header: 'الفرع / المدينة',
      sortValue: (r) => `${r.branch || ''} ${r.city || ''}`,
      render: (r) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {[r.branch, r.city].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'apps',
      header: 'التطبيقات والمركبة',
      render: (r) => {
        const accs = accountsByRider.get(r.internalRiderId) || [];
        const veh = activeVehicleByRider.get(r.internalRiderId);
        return (
          <div className="text-xs">
            <div className="text-slate-800 dark:text-slate-200">
              {accs.length > 0 ? accs.map((a) => `${a.platformName} (${a.platformRiderId})`).join(' · ') : 'بدون حساب تطبيق'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
              {veh ? `مركبة: ${veh.plate}` : 'بدون عهدة سيارة'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'الحالة الوظيفية',
      sortValue: (r) => r.status,
      render: (r) => (
        <StatusBadge label={EMPLOYEE_HR_STATUS_LABELS[r.status]} tone={hrStatusTone(r.status)} />
      ),
    },
    ...dynamicFields
      .filter((f) => f.formId === 'hr_rider' && f.showInTable && canViewDynamicField(f, currentUser))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .slice(0, 6)
      .map(
        (f): TableColumn<RiderMaster> => ({
          key: `dyn_${f.key}`,
          header: f.labelAr,
          sortValue: (r) => String(r.customFields?.[f.key] ?? ''),
          render: (r) => (
            <span className="text-xs text-slate-700 dark:text-slate-300 font-mono-num">
              {formatDynamicFieldDisplayValue(f, r.customFields?.[f.key], r.customFields || {})}
            </span>
          ),
        })
      ),
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" onClick={() => onOpenRider360(r.internalRiderId)}>
            ملف 360°
          </Button>
          {canEditHr && (
            <Button size="sm" variant="secondary" onClick={() => openEditRider(r)}>
              تعديل
            </Button>
          )}
          {(canEditHr || canApproveHr) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatusModalRider(r);
                setNewStatusVal(r.status);
                setStatusDate(new Date().toISOString().slice(0, 10));
                setStatusReason('');
              }}
              className="text-blue-700 dark:text-blue-400"
            >
              تغيير الحالة
            </Button>
          )}
          {canAddDocs && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openUploadDocModal(r.internalRiderId)}
              className="text-emerald-700 dark:text-emerald-400"
            >
              + وثيقة
            </Button>
          )}
          {canDeleteHr && (
            <button
              type="button"
              onClick={() => setDeleteTargetRider(r)}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label="حذف المندوب"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const docColumns: TableColumn<PrivateDocumentRecord>[] = [
    {
      key: 'title',
      header: 'المستند والنوع',
      sortValue: (d) => d.title,
      render: (d) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{d.title}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
            {d.docTypeName} · v{d.currentVersion}
          </div>
        </div>
      ),
    },
    {
      key: 'entity',
      header: 'المندوب المرتبط',
      sortValue: (d) => d.entityLabel || d.entityId,
      render: (d) => (
        <button
          type="button"
          onClick={() => onOpenRider360(d.entityId)}
          className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
        >
          {d.entityLabel || d.entityId}
        </button>
      ),
    },
    {
      key: 'dates',
      header: 'الإصدار / الانتهاء',
      sortValue: (d) => d.expiryDate || '9999-12-31',
      render: (d) => (
        <div className="font-mono-num text-xs">
          <div>إصدار: {d.issueDate || '—'}</div>
          <div className="text-slate-500 dark:text-slate-400">انتهاء: {d.expiryDate || 'غير محدد'}</div>
        </div>
      ),
    },
    {
      key: 'fileInfo',
      header: 'الملف الحالي',
      render: (d) => {
        const latest = d.versions?.[d.versions.length - 1];
        return (
          <div className="text-xs text-slate-600 dark:text-slate-300">
            <div className="truncate max-w-[180px]">{latest?.originalFileName || '—'}</div>
            <div className="text-[11px] text-slate-500 font-mono-num">
              {latest ? `${Math.round(latest.sizeBytes / 1024)} KB · ${latest.uploadedByEmail}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'إجراءات الخزينة',
      render: (d) => (
        <div className="flex items-center gap-1.5">
          {canViewDocs && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Eye className="h-3.5 w-3.5" />}
                onClick={() => void handleOpenPrivateFile(d, false)}
              >
                معاينة
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => void handleOpenPrivateFile(d, true)}
                aria-label="تنزيل"
              />
            </>
          )}
          {canEditDocs && (
            <Button size="sm" variant="ghost" onClick={() => openUploadDocModal(d.entityId, d)}>
              تحديث نسخة
            </Button>
          )}
          <button
            type="button"
            onClick={() => setHistoryDoc(d)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="سجل الإصدارات"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          {canDeleteDocs && (
            <button
              type="button"
              onClick={() => setDeleteTargetDoc(d)}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              title="حذف المستند"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const TABS: TabItem<HrSubTab>[] = [
    { key: 'hr_dashboard', label: 'لوحة الموارد البشرية', icon: <Users className="h-3.5 w-3.5" /> },
    { key: 'hr_riders', label: 'دليل المندوبين', count: riders.length, icon: <UserCheck className="h-3.5 w-3.5" /> },
    { key: 'hr_docs', label: 'خزينة المستندات الخاصة', count: riderDocs.length, icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'hr_expiries', label: 'متابعة الانتهاء', count: allExpiries.length, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { key: 'hr_status', label: 'سجل الحالات الوظيفية', icon: <History className="h-3.5 w-3.5" /> },
  ];

  const statusTimelineRows = useMemo(() => {
    return riders
      .flatMap((r) =>
        (r.statusHistory || []).map((h, idx) => ({
          key: `${r.internalRiderId}_${idx}`,
          riderId: r.internalRiderId,
          fullName: r.fullName,
          ...h,
        }))
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60);
  }, [riders]);

  // Dedicated Full-Page Multi-Section Form (Hybrid Forms Architecture for Long Forms)
  if (riderModalOpen) {
    const nextSeqId = generateNextCompanyRiderId(riders);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setRiderModalOpen(false)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>العودة إلى إدارة الموارد البشرية</span>
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {editingRider ? `تعديل ملف المندوب (${editingRider.internalRiderId})` : 'تسجيل مندوب جديد في الموارد البشرية'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {editingRider
                ? 'يُحفظ المعرّف الداخلي كما هو دون تعديل وتُوثق التحديثات في سجل التدقيق.'
                : `سيتم تعيين الرقم الداخلي التسلسلي الموحد تلقائيًا: ${nextSeqId}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setRiderModalOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="hr-rider-fullpage-form"
              variant="primary"
              loading={busy}
              icon={<Save className="h-3.5 w-3.5" />}
            >
              {editingRider ? 'حفظ التعديلات' : 'إنشاء ملف المندوب'}
            </Button>
          </div>
        </div>

        {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

        <form id="hr-rider-fullpage-form" onSubmit={(e) => void handleSaveRider(e)} className="space-y-5">
          {/* Section 1: Personal Info */}
          <Card>
            <SectionHeader
              title="1. البيانات الشخصية والاتصال"
              subtitle="بيانات التعريف الأساسية للموظف وتاريخ التحاقه بالشركة"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="الاسم الكامل" required className="sm:col-span-2">
                <Input
                  type="text"
                  required
                  value={riderForm.fullName}
                  onChange={(e) => setRiderForm({ ...riderForm, fullName: e.target.value })}
                  placeholder="الاسم الرباعي كما في الإقامة"
                />
              </FormField>
              <FormField label="الجنسية">
                <Input
                  type="text"
                  value={riderForm.nationality}
                  onChange={(e) => setRiderForm({ ...riderForm, nationality: e.target.value })}
                  placeholder="مثال: مصري / باكستاني"
                />
              </FormField>
              <FormField label="رقم الجوال">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={riderForm.phone}
                  onChange={(e) => setRiderForm({ ...riderForm, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                />
              </FormField>
              <FormField label="تاريخ الميلاد">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.birthDate}
                  onChange={(e) => setRiderForm({ ...riderForm, birthDate: e.target.value })}
                />
              </FormField>
              <FormField label="تاريخ التعيين / الانضمام">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.joinDate}
                  onChange={(e) => setRiderForm({ ...riderForm, joinDate: e.target.value })}
                />
              </FormField>
            </div>
          </Card>

          {/* Section 2: Iqama & License */}
          <Card>
            <SectionHeader
              title="2. الإقامة ورخصة القيادة"
              subtitle="يتحقق النظام تلقائيًا من عدم تكرار رقم الإقامة ويرسل تنبيهات الانتهاء"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="رقم الإقامة / الهوية">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={riderForm.iqamaNumber}
                  onChange={(e) => setRiderForm({ ...riderForm, iqamaNumber: e.target.value })}
                  placeholder="10 أو 20 رقماً"
                />
              </FormField>
              <FormField label="تاريخ إصدار الإقامة">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.iqamaIssueDate}
                  onChange={(e) => setRiderForm({ ...riderForm, iqamaIssueDate: e.target.value })}
                />
              </FormField>
              <FormField label="تاريخ انتهاء الإقامة">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.iqamaExpiryDate}
                  onChange={(e) => setRiderForm({ ...riderForm, iqamaExpiryDate: e.target.value })}
                />
              </FormField>
              <FormField label="رقم رخصة القيادة">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={riderForm.driverLicenseNumber}
                  onChange={(e) => setRiderForm({ ...riderForm, driverLicenseNumber: e.target.value })}
                />
              </FormField>
              <FormField label="نوع الرخصة">
                <Input
                  type="text"
                  value={riderForm.driverLicenseType}
                  onChange={(e) => setRiderForm({ ...riderForm, driverLicenseType: e.target.value })}
                  placeholder="خاصة / عمومي / دراجة"
                />
              </FormField>
              <FormField label="تاريخ انتهاء الرخصة">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.driverLicenseExpiryDate}
                  onChange={(e) => setRiderForm({ ...riderForm, driverLicenseExpiryDate: e.target.value })}
                />
              </FormField>
              <FormField label="تاريخ إصدار الرخصة">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={riderForm.driverLicenseIssueDate}
                  onChange={(e) => setRiderForm({ ...riderForm, driverLicenseIssueDate: e.target.value })}
                />
              </FormField>
              <FormField label="ملاحظات تجديد الإقامة" className="sm:col-span-2">
                <Input
                  type="text"
                  value={riderForm.iqamaRenewalNotes}
                  onChange={(e) => setRiderForm({ ...riderForm, iqamaRenewalNotes: e.target.value })}
                  placeholder="حالة التجديد أو الكفالة..."
                />
              </FormField>
            </div>
          </Card>

          {/* Section 3: Operational Assignment */}
          <Card>
            <SectionHeader
              title="3. التسكين الإداري والتشغيلي"
              subtitle="تحديد الفرع، المدينة، المشرف المباشر، والحالة الوظيفية"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="الفرع">
                <Input
                  type="text"
                  value={riderForm.branch}
                  onChange={(e) => setRiderForm({ ...riderForm, branch: e.target.value })}
                  list="hr-branches-list"
                />
                <datalist id="hr-branches-list">
                  {branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </FormField>
              <FormField label="المدينة">
                <Input
                  type="text"
                  value={riderForm.city}
                  onChange={(e) => setRiderForm({ ...riderForm, city: e.target.value })}
                />
              </FormField>
              <FormField label="المشرف المباشر">
                <Input
                  type="text"
                  value={riderForm.supervisor}
                  onChange={(e) => setRiderForm({ ...riderForm, supervisor: e.target.value })}
                />
              </FormField>
              <FormField label="نوع المركبة المعتادة">
                <Input
                  type="text"
                  value={riderForm.vehicleType}
                  onChange={(e) => setRiderForm({ ...riderForm, vehicleType: e.target.value })}
                />
              </FormField>
              <FormField label="العقد / المشروع">
                <Input
                  type="text"
                  value={riderForm.contractName}
                  onChange={(e) => setRiderForm({ ...riderForm, contractName: e.target.value })}
                />
              </FormField>
              <FormField label="الحالة الوظيفية">
                <Select
                  value={riderForm.status}
                  onChange={(e) => setRiderForm({ ...riderForm, status: e.target.value as EmployeeHrStatus })}
                >
                  {ALL_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {EMPLOYEE_HR_STATUS_LABELS[st]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </Card>

          {/* Section 4: Notes */}
          <Card>
            <SectionHeader
              title="4. الملاحظات الإدارية والحفظ"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <FormField label="ملاحظات إدارية عامة">
              <Textarea
                rows={3}
                value={riderForm.adminNotes}
                onChange={(e) => setRiderForm({ ...riderForm, adminNotes: e.target.value })}
                placeholder="ملاحظات إضافية لملف الموظف..."
              />
            </FormField>
          </Card>

          <DynamicFieldsRenderer
            formId="hr_rider"
            entityId={editingRider?.internalRiderId || nextSeqId}
            entityLabel={riderForm.fullName || nextSeqId}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={customFieldsValues}
            onChange={setCustomFieldsValues}
            user={currentUser}
            mode="form"
            errors={customFieldErrors}
            contextValues={{ ...riderForm, ...customFieldsValues }}
            title="5. الحقول المخصصة الإضافية (System Builder)"
          />

          <div className="sticky bottom-3 z-10 flex items-center justify-end gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-5 py-3 backdrop-blur shadow-lg">
            <Button variant="secondary" onClick={() => setRiderModalOpen(false)}>
              إلغاء والعودة
            </Button>
            <Button type="submit" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
              {editingRider ? 'حفظ تعديلات المندوب' : 'اعتماد وإنشاء ملف المندوب'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="إدارة الموارد البشرية والمندوبين"
        subtitle="ملف موظف موحد بأرقام EMP تسلسلية للجدد · خزينة وثائق خاصة محمية بالصلاحيات · مراقبة انتهاء الإقامات والرخص"
        actions={
          <>
            {canAddDocs && (
              <Button variant="secondary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => openUploadDocModal()}>
                رفع مستند خاص
              </Button>
            )}
            {canAddHr && (
              <Button variant="primary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={openCreateRider}>
                إضافة مندوب جديد
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void onRefresh()}
              disabled={busy}
              aria-label="تحديث البيانات"
              icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
            >
              تحديث
            </Button>
          </>
        }
      />

      <Tabs items={TABS} activeKey={subTab} onChange={setSubTab} variant="underline" />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      {/* TAB 1: HR DASHBOARD */}
      {subTab === 'hr_dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="إجمالي المندوبين المسجلين"
              value={hrKpis.total.toLocaleString('en-US')}
              subtext={`نشط: ${hrKpis.counts.active} · جاهز: ${hrKpis.counts.ready}`}
              onClick={() => setSubTab('hr_riders')}
            />
            <KpiCard
              label="قيد التجهيز / جدد / إجازة"
              value={(hrKpis.counts.new + hrKpis.counts.onboarding + hrKpis.counts.on_leave).toLocaleString('en-US')}
              subtext={`جديد: ${hrKpis.counts.new} · تجهيز: ${hrKpis.counts.onboarding} · إجازة: ${hrKpis.counts.on_leave}`}
              tone="neutral"
            />
            <KpiCard
              label="تنبيهات انتهاء حرجة (≤ 30 يوم)"
              value={hrKpis.criticalExpiries.toLocaleString('en-US')}
              subtext={`إجمالي تنبيهات 90 يوم: ${allExpiries.length}`}
              tone={hrKpis.criticalExpiries > 0 ? 'critical' : 'good'}
              onClick={() => setSubTab('hr_expiries')}
            />
            <KpiCard
              label="المستندات الخاصة المؤرشفة"
              value={hrKpis.totalPrivateDocs.toLocaleString('en-US')}
              subtext={`بدون مرفق إقامة: ${hrKpis.ridersMissingIqamaDoc} مندوب`}
              tone={hrKpis.ridersMissingIqamaDoc > 0 ? 'warn' : 'good'}
              onClick={() => setSubTab('hr_docs')}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <SectionHeader title="توزيع الحالات الوظيفية للمندوبين" className="mb-3" />
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {ALL_STATUSES.map((st) => {
                  const count = hrKpis.counts[st] || 0;
                  const pct = hrKpis.total > 0 ? Math.round((count / hrKpis.total) * 100) : 0;
                  return (
                    <div key={st} className="flex items-center justify-between py-2.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter(st);
                          setSubTab('hr_riders');
                        }}
                        className="hover:opacity-80 transition-opacity"
                      >
                        <StatusBadge label={EMPLOYEE_HR_STATUS_LABELS[st]} tone={hrStatusTone(st)} />
                      </button>
                      <div className="flex items-center gap-3 font-mono-num">
                        <span className="text-slate-500 dark:text-slate-400">{pct}%</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="أقرب الوثائق والإقامات للانتهاء"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setSubTab('hr_expiries')}>
                    عرض الكل
                  </Button>
                }
                className="mb-3"
              />
              {allExpiries.length === 0 ? (
                <EmptyState
                  title="لا توجد وثائق قريبة من الانتهاء"
                  subtitle="جميع الإقامات والرخص والوثائق المرفوعة سارية خلال النافذة الزمنية المحددة."
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {allExpiries.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2.5 text-xs gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenRider360(item.entityId)}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:underline truncate block"
                        >
                          {item.entityName}
                        </button>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                          {item.docCategory} {item.docNumber ? `· ${item.docNumber}` : ''} · {item.expiryDate}
                        </div>
                      </div>
                      <StatusBadge
                        tone={URGENCY_META[item.urgency].tone}
                        label={
                          item.daysRemaining < 0
                            ? `منتهي منذ ${Math.abs(item.daysRemaining)} ي`
                            : item.daysRemaining === 0
                              ? 'ينتهي اليوم'
                              : `متبقي ${item.daysRemaining} يوم`
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: RIDERS DIRECTORY */}
      {subTab === 'hr_riders' && (
        <div className="space-y-4">
          <SavedViewsBar
            scope="hr_riders"
            user={currentUser}
            allowedUids={allowedUids}
            savedViews={savedViews}
            currentFilters={{ statusFilter, branchFilter }}
            onApplyView={(f) => {
              if (typeof f.statusFilter === 'string') setStatusFilter(f.statusFilter as 'all' | EmployeeHrStatus);
              if (typeof f.branchFilter === 'string') setBranchFilter(f.branchFilter);
            }}
            onChanged={onRefresh}
          />
          <DataTable
            tableId="hr_riders"
            rows={filteredRiders}
            columns={riderColumns}
            rowKey={(r) => r.internalRiderId}
            searchPlaceholder="ابحث برقم الشركة، الاسم، رقم الإقامة، الجوال، أو الفرع..."
            searchText={(r) =>
              `${r.internalRiderId} ${r.fullName} ${r.iqamaNumber || ''} ${r.phone || ''} ${r.branch || ''} ${r.city || ''} ${Object.values(r.customFields || {}).join(' ')}`
            }
            onRowClick={(r) => onOpenRider360(r.internalRiderId)}
            toolbarExtra={
              <>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | EmployeeHrStatus)}
                  className="!w-40"
                >
                  <option value="all">كل الحالات ({riders.length})</option>
                  {ALL_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {EMPLOYEE_HR_STATUS_LABELS[st]}
                    </option>
                  ))}
                </Select>
                <Select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="!w-40"
                >
                  <option value="all">جميع الفروع</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </>
            }
          />
        </div>
      )}

      {/* TAB 3: PRIVATE DOCUMENT VAULT */}
      {subTab === 'hr_docs' && (
        <div className="space-y-4">
          {!canViewDocs ? (
            <ToastBanner
              type="warn"
              message="لا تملك صلاحية عرض المستندات الخاصة (documents.view). تواصل مع مسؤول النظام."
            />
          ) : (
            <>
              {canAddDocs && (
                <Card padding="sm">
                  <form
                    onSubmit={(e) => void handleAddCustomDocType(e)}
                    className="flex flex-wrap items-end gap-3"
                  >
                    <FormField label="إضافة نوع مستند مخصص (HR)" className="flex-1 min-w-[200px]">
                      <Input
                        type="text"
                        value={newTypeAr}
                        onChange={(e) => setNewTypeAr(e.target.value)}
                        placeholder="مثال: فحص طبي / تفويض قيادة"
                      />
                    </FormField>
                    <FormField label="الاسم بالإنجليزية" className="w-48">
                      <Input
                        type="text"
                        value={newTypeEn}
                        onChange={(e) => setNewTypeEn(e.target.value)}
                        placeholder="Medical Certificate"
                      />
                    </FormField>
                    <label className="flex items-center gap-2 h-9 text-xs font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={newTypeExpires}
                        onChange={(e) => setNewTypeExpires(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>يتطلب تاريخ انتهاء</span>
                    </label>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy || !newTypeAr.trim()}
                      icon={<Plus className="h-3.5 w-3.5" />}
                    >
                      حفظ النوع
                    </Button>
                  </form>
                </Card>
              )}

              <DataTable
                tableId="hr_docs"
                rows={riderDocs}
                columns={docColumns}
                rowKey={(d) => d.docId}
                searchPlaceholder="ابحث بعنوان المستند، اسم المندوب، أو نوع الوثيقة..."
                searchText={(d) => `${d.title} ${d.docTypeName} ${d.entityLabel || ''} ${d.entityId}`}
                emptyTitle="لا توجد مستندات مرفوعة في الخزينة الخاصة"
                emptySubtitle="استخدم زر «رفع مستند خاص» لإرفاق الإقامات والرخص والعقود بصيغة PDF أو صور."
              />
            </>
          )}
        </div>
      )}

      {/* TAB 4: EXPIRY WATCH */}
      {subTab === 'hr_expiries' && (
        <div className="space-y-4">
          <Card padding="sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300 ml-1">نطاق الانتهاء:</span>
              {(
                [
                  ['all', 'الكل'],
                  ['expired', 'منتهية'],
                  ['due_today', 'اليوم'],
                  ['within_7', '≤ 7 أيام'],
                  ['within_30', '≤ 30 يومًا'],
                  ['within_60', '≤ 60 يومًا'],
                  ['within_90', '≤ 90 يومًا'],
                ] as Array<['all' | ExpiryUrgency, string]>
              ).map(([k, lbl]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={urgencyFilter === k ? 'primary' : 'secondary'}
                  onClick={() => setUrgencyFilter(k)}
                >
                  {lbl}
                </Button>
              ))}
            </div>
          </Card>

          <DataTable
            tableId="hr_expiries"
            rows={filteredExpiries}
            rowKey={(e) => e.id}
            searchPlaceholder="ابحث باسم المندوب أو نوع الوثيقة أو رقم الإقامة..."
            searchText={(e) => `${e.entityName} ${e.entityId} ${e.docCategory} ${e.docNumber || ''} ${e.branch || ''}`}
            columns={[
              {
                key: 'rider',
                header: 'المندوب',
                sortValue: (e) => e.entityName,
                render: (e) => (
                  <button
                    type="button"
                    onClick={() => onOpenRider360(e.entityId)}
                    className="font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {e.entityName} ({e.entityId})
                  </button>
                ),
              },
              {
                key: 'doc',
                header: 'الوثيقة',
                sortValue: (e) => e.docCategory,
                render: (e) => (
                  <span className="text-xs text-slate-800 dark:text-slate-200 font-mono-num">
                    {e.docCategory} {e.docNumber ? `· ${e.docNumber}` : ''}
                  </span>
                ),
              },
              {
                key: 'branch',
                header: 'الفرع',
                render: (e) => <span className="text-xs text-slate-500 dark:text-slate-400">{e.branch || '—'}</span>,
              },
              {
                key: 'expiry',
                header: 'تاريخ الانتهاء',
                sortValue: (e) => e.expiryDate,
                render: (e) => <span className="font-mono-num text-xs">{e.expiryDate}</span>,
              },
              {
                key: 'remaining',
                header: 'الحالة / المتبقي',
                sortValue: (e) => e.daysRemaining,
                render: (e) => (
                  <StatusBadge
                    tone={URGENCY_META[e.urgency].tone}
                    label={
                      e.daysRemaining < 0
                        ? `منتهي منذ ${Math.abs(e.daysRemaining)} ي`
                        : e.daysRemaining === 0
                          ? 'ينتهي اليوم'
                          : `${e.daysRemaining} يوم`
                    }
                  />
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB 5: STATUS HISTORY TIMELINE */}
      {subTab === 'hr_status' && (
        <Card>
          <SectionHeader title="سجل تغييرات الحالات الوظيفية" className="mb-3" />
          {statusTimelineRows.length === 0 ? (
            <EmptyState
              title="لا يوجد سجل تغييرات حتى الآن"
              subtitle="تُسجّل هنا جميع تحديثات الحالات الوظيفية للمندوبين مع السبب والتاريخ والمستخدم المسؤول."
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {statusTimelineRows.map((row) => (
                <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenRider360(row.riderId)}
                        className="font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {row.fullName} ({row.riderId})
                      </button>
                      <StatusBadge label={EMPLOYEE_HR_STATUS_LABELS[row.status]} tone={hrStatusTone(row.status)} />
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">{row.reason}</div>
                  </div>
                  <div className="text-left font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                    <div>{row.date}</div>
                    <div>{row.changedByEmail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* STATUS TRANSITION DRAWER */}
      <SlideDrawer
        open={Boolean(statusModalRider)}
        onClose={() => setStatusModalRider(null)}
        title={`تغيير الحالة الوظيفية${statusModalRider ? ` — ${statusModalRider.fullName}` : ''}`}
        subtitle={statusModalRider ? `المعرف الموحد: ${statusModalRider.internalRiderId}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusModalRider(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="hr-status-form" variant="primary" loading={busy}>
              حفظ واعتماد الحالة
            </Button>
          </>
        }
      >
        <form id="hr-status-form" onSubmit={(e) => void handleStatusTransition(e)} className="space-y-4">
          <FormField label="الحالة الجديدة" required>
            <Select
              value={newStatusVal}
              onChange={(e) => setNewStatusVal(e.target.value as EmployeeHrStatus)}
            >
              {ALL_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {EMPLOYEE_HR_STATUS_LABELS[st]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="تاريخ التغيير (وإنهاء الخدمة إن وجد)" required>
            <Input
              type="date"
              required
              className="font-mono-num"
              value={statusDate}
              onChange={(e) => setStatusDate(e.target.value)}
            />
          </FormField>
          <FormField label="السبب الإلزامي للتغيير" required>
            <Textarea
              rows={3}
              required
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="وثق السبب الإداري أو التشغيلي..."
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PRIVATE DOCUMENT UPLOAD DRAWER */}
      <SlideDrawer
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        title={replaceTargetDoc ? `استبدال المستند (v${replaceTargetDoc.currentVersion + 1})` : 'رفع مستند خاص للخزينة المحمية'}
        subtitle="التخزين الخاص عبر API محمي بالصلاحيات وتوثيق النسخ"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="hr-doc-upload-form" variant="primary" loading={busy} icon={<Upload className="h-3.5 w-3.5" />}>
              {busy ? 'جاري الرفع الآمن...' : 'حفظ في الخزينة الخاصة'}
            </Button>
          </>
        }
      >
        <form id="hr-doc-upload-form" onSubmit={(e) => void handleUploadDocument(e)} className="space-y-4">
          <FormField label="المندوب" required>
            <Select
              required
              disabled={Boolean(replaceTargetDoc)}
              value={docForm.entityId}
              onChange={(e) => setDocForm({ ...docForm, entityId: e.target.value })}
            >
              <option value="">-- اختر المندوب --</option>
              {riders.map((r) => (
                <option key={r.internalRiderId} value={r.internalRiderId}>
                  {r.fullName} ({r.internalRiderId})
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="نوع المستند" required>
              <Select
                disabled={Boolean(replaceTargetDoc)}
                value={docForm.docTypeId}
                onChange={(e) => setDocForm({ ...docForm, docTypeId: e.target.value })}
              >
                {mergedDocTypes.map((dt) => (
                  <option key={dt.typeId} value={dt.typeId}>
                    {dt.nameAr}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="عنوان الوثيقة">
              <Input
                type="text"
                value={docForm.title}
                onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                placeholder="مثال: إقامة 2026"
              />
            </FormField>
            <FormField label="تاريخ الإصدار">
              <Input
                type="date"
                className="font-mono-num"
                value={docForm.issueDate}
                onChange={(e) => setDocForm({ ...docForm, issueDate: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ الانتهاء">
              <Input
                type="date"
                className="font-mono-num"
                value={docForm.expiryDate}
                onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="الملف (PDF, JPG, PNG, WEBP — حد أقصى 15MB)" required>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-700 dark:text-slate-300"
            />
          </FormField>

          <FormField label="ملاحظة">
            <Input
              type="text"
              value={replaceTargetDoc ? docForm.versionNote : docForm.notes}
              onChange={(e) =>
                setDocForm(replaceTargetDoc ? { ...docForm, versionNote: e.target.value } : { ...docForm, notes: e.target.value })
              }
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* AUTHENTICATED PREVIEW DRAWER */}
      <SlideDrawer
        open={Boolean(previewDoc)}
        onClose={() => {
          if (previewDoc) URL.revokeObjectURL(previewDoc.blobUrl);
          setPreviewDoc(null);
        }}
        title={previewDoc?.doc.title || 'معاينة المستند'}
        subtitle={previewDoc ? `${previewDoc.doc.entityLabel || ''} · إصدار v${previewDoc.doc.currentVersion}` : undefined}
        size="xl"
        footer={
          previewDoc && (
            <>
              <Button
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => void handleOpenPrivateFile(previewDoc.doc, true)}
              >
                تنزيل الملف
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  URL.revokeObjectURL(previewDoc.blobUrl);
                  setPreviewDoc(null);
                }}
              >
                إغلاق
              </Button>
            </>
          )
        }
      >
        {previewDoc && (
          <div className="h-[72vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-2 overflow-auto flex items-center justify-center">
            {previewDoc.mime.startsWith('image/') ? (
              <img src={previewDoc.blobUrl} alt={previewDoc.doc.title} className="max-h-full max-w-full object-contain rounded" />
            ) : (
              <iframe src={previewDoc.blobUrl} title={previewDoc.doc.title} className="h-full w-full rounded border-0" />
            )}
          </div>
        )}
      </SlideDrawer>

      {/* VERSION HISTORY DRAWER */}
      <SlideDrawer
        open={Boolean(historyDoc)}
        onClose={() => setHistoryDoc(null)}
        title={`سجل نسخ المستند: ${historyDoc?.title || ''}`}
        subtitle={historyDoc ? `${historyDoc.docTypeName} · ${historyDoc.entityLabel || historyDoc.entityId}` : undefined}
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setHistoryDoc(null)}>
            إغلاق
          </Button>
        }
      >
        {historyDoc && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {historyDoc.versions
              .slice()
              .reverse()
              .map((v) => (
                <div key={v.version} className="flex items-center justify-between gap-3 py-3 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      الإصدار v{v.version} — {v.originalFileName}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                      {v.uploadedAt.slice(0, 16)} · {v.uploadedByEmail} · {Math.round(v.sizeBytes / 1024)} KB
                    </div>
                    {v.note && <div className="text-[11px] text-slate-600 dark:text-slate-300">{v.note}</div>}
                  </div>
                  {canViewDocs && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => void handleOpenPrivateFile(historyDoc, true, v.version)}
                    >
                      تنزيل
                    </Button>
                  )}
                </div>
              ))}
          </div>
        )}
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteTargetDoc)}
        title="حذف مستند من الخزينة الخاصة"
        description={`هل أنت متأكد من حذف المستند "${deleteTargetDoc?.title || ''}" وجميع نسخه المؤرشفة نهائيًا؟`}
        danger
        busy={busy}
        onCancel={() => setDeleteTargetDoc(null)}
        onConfirm={() => void handleDeletePrivateDoc()}
      />

      <ConfirmModal
        open={Boolean(deleteTargetRider)}
        title="حذف ملف مندوب"
        description={`سيتم حذف ملف المندوب ${deleteTargetRider?.fullName || ''} (${deleteTargetRider?.internalRiderId || ''}) مع توثيق العملية في سجل التدقيق.`}
        danger
        busy={busy}
        onCancel={() => setDeleteTargetRider(null)}
        onConfirm={() => void handleDeleteRider()}
      />
    </div>
  );
}
