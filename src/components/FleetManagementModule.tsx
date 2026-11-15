import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  ArrowLeftRight,
  ArrowRight,
  Car,
  Download,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  checkVehicleAssignmentOverlap,
  computeAllDocumentExpiries,
  generateNextVehicleId,
  normalizePlate,
  VEHICLE_STATUS_LABELS,
  writeErpAuditLog,
  type ExpiryUrgency,
} from '../lib/erpHelpers';
import { auth, db, DEFAULT_DOCUMENT_TYPES, handleFirestoreError, OperationType } from '../lib/firebase';
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
  OperationalSettings,
  PrivateDocumentRecord,
  RiderMaster,
  RoleTemplate,
  SavedViewConfig,
  UserProfile,
  VehicleAssignment,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleOwnershipType,
  VehicleStatus,
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

export type FleetSubTab = 'fleet_dashboard' | 'fleet_vehicles' | 'fleet_handover' | 'fleet_docs' | 'fleet_maintenance';

interface FleetManagementModuleProps {
  vehicles: VehicleMaster[];
  assignments: VehicleAssignment[];
  maintenance: VehicleMaintenanceRecord[];
  riders: RiderMaster[];
  privateDocs: PrivateDocumentRecord[];
  documentTypes: DocumentTypeConfig[];
  settings: OperationalSettings;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  allowedUids: string[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  savedViews?: SavedViewConfig[];
  initialSubTab?: FleetSubTab;
  onOpenRider360: (internalRiderId: string) => void;
  onRefresh: () => Promise<void>;
}

const ALL_VEHICLE_STATUSES: VehicleStatus[] = [
  'available',
  'assigned',
  'maintenance',
  'out_of_service',
  'leased_out',
  'ended',
];

function vehicleStatusTone(status: VehicleStatus): BadgeTone {
  if (status === 'available') return 'success';
  if (status === 'assigned') return 'info';
  if (status === 'maintenance' || status === 'leased_out') return 'warning';
  if (status === 'out_of_service' || status === 'ended') return 'danger';
  return 'neutral';
}

function expiryTone(urgency: ExpiryUrgency): BadgeTone {
  if (urgency === 'expired' || urgency === 'due_today' || urgency === 'within_7') return 'danger';
  if (urgency === 'within_30' || urgency === 'within_60') return 'warning';
  if (urgency === 'within_90') return 'info';
  return 'success';
}

export function FleetManagementModule({
  vehicles,
  assignments,
  maintenance,
  riders,
  privateDocs,
  documentTypes,
  settings,
  currentUser,
  roleTemplates,
  allowedUids,
  dynamicFields = [],
  dynamicForms = [],
  savedViews = [],
  initialSubTab = 'fleet_dashboard',
  onOpenRider360,
  onRefresh,
}: FleetManagementModuleProps) {
  const [subTab, setSubTab] = useState<FleetSubTab>(initialSubTab);
  const [statusFilter, setStatusFilter] = useState<'all' | VehicleStatus>('all');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Full-Page Multi-Section Add / Edit Vehicle Form
  const [vehModalOpen, setVehModalOpen] = useState(false);
  const [editingVeh, setEditingVeh] = useState<VehicleMaster | null>(null);
  const [deleteTargetVeh, setDeleteTargetVeh] = useState<VehicleMaster | null>(null);
  const [vehCustomValues, setVehCustomValues] = useState<Record<string, unknown>>({});
  const [vehCustomErrors, setVehCustomErrors] = useState<Record<string, string>>({});
  const [handoverCustomValues, setHandoverCustomValues] = useState<Record<string, unknown>>({});
  const [handoverCustomErrors, setHandoverCustomErrors] = useState<Record<string, string>>({});
  const [maintCustomValues, setMaintCustomValues] = useState<Record<string, unknown>>({});
  const [maintCustomErrors, setMaintCustomErrors] = useState<Record<string, string>>({});
  const [vehForm, setVehForm] = useState({
    plateNumber: '',
    vehicleType: settings.customVehicleTypes?.[0] || 'سيارة سيدان',
    make: '',
    model: '',
    year: String(new Date().getFullYear()),
    color: '',
    vin: '',
    ownershipType: 'owned' as VehicleOwnershipType,
    ownerOrLeasingCompany: '',
    status: 'available' as VehicleStatus,
    istimaraNumber: '',
    istimaraExpiryDate: '',
    insuranceCompany: '',
    insurancePolicyNumber: '',
    insuranceExpiryDate: '',
    periodicInspectionExpiryDate: '',
    notes: '',
  });

  // Handover Drawer
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverForm, setHandoverForm] = useState({
    vehicleInternalId: '',
    companyRiderId: '',
    handoverDate: new Date().toISOString().slice(0, 10),
    handoverTime: new Date().toTimeString().slice(0, 5),
    handoverOdometer: '',
    handoverCondition: 'جيدة - بدون ملاحظات ظاهرة',
    handoverNotes: '',
    allowSharedOverride: false,
  });

  // Return Drawer
  const [returnTarget, setReturnTarget] = useState<VehicleAssignment | null>(null);
  const [returnForm, setReturnForm] = useState({
    returnDate: new Date().toISOString().slice(0, 10),
    returnTime: new Date().toTimeString().slice(0, 5),
    returnOdometer: '',
    returnCondition: 'سليمة عند الاستلام',
    returnDamageNotes: '',
    returnNotes: '',
    nextVehicleStatus: 'available' as VehicleStatus,
  });

  // Maintenance Drawer
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [maintForm, setMaintForm] = useState({
    vehicleInternalId: '',
    maintenanceType: 'صيانة دورية / تغيير زيت',
    maintenanceDate: new Date().toISOString().slice(0, 10),
    cost: '',
    odometer: '',
    workshop: '',
    details: '',
    nextMaintenanceDate: '',
    nextMaintenanceOdometer: '',
  });

  // Upload & Preview Drawers
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docForm, setDocForm] = useState({
    entityId: '',
    docTypeId: 'vehicle_istimara',
    title: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
  });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ doc: PrivateDocumentRecord; blobUrl: string; mime: string } | null>(null);

  const canAdd = hasPermission(currentUser, roleTemplates, 'fleet', 'add');
  const canEdit = hasPermission(currentUser, roleTemplates, 'fleet', 'edit');
  const canDelete = hasPermission(currentUser, roleTemplates, 'fleet', 'delete');
  const canApprove = hasPermission(currentUser, roleTemplates, 'fleet', 'approve');
  const canViewDocs = hasPermission(currentUser, roleTemplates, 'documents', 'view');
  const canAddDocs = hasPermission(currentUser, roleTemplates, 'documents', 'add');

  const riderById = useMemo(() => new Map(riders.map((r) => [r.internalRiderId, r])), [riders]);
  const vehicleDocs = useMemo(
    () => privateDocs.filter((d) => d.entityType === 'vehicle' || d.entityType === 'handover'),
    [privateDocs]
  );

  const fleetExpiries = useMemo(
    () => computeAllDocumentExpiries({ riders: [], vehicles, privateDocs: vehicleDocs, settings }),
    [vehicles, vehicleDocs, settings]
  );

  const mergedVehicleDocTypes = useMemo(() => {
    const map = new Map<string, DocumentTypeConfig>();
    for (const def of DEFAULT_DOCUMENT_TYPES) {
      if (def.targetEntity === 'vehicle' || def.targetEntity === 'handover') {
        map.set(def.typeId, { ...def, createdByUid: currentUser.uid, allowedUids });
      }
    }
    for (const dt of documentTypes) {
      if (dt.targetEntity === 'vehicle' || dt.targetEntity === 'handover') map.set(dt.typeId, dt);
    }
    return Array.from(map.values()).filter((d) => d.active);
  }, [documentTypes, currentUser.uid, allowedUids]);

  const fleetKpis = useMemo(() => {
    const counts: Record<VehicleStatus, number> = {
      available: 0,
      assigned: 0,
      maintenance: 0,
      out_of_service: 0,
      leased_out: 0,
      ended: 0,
    };
    for (const v of vehicles) counts[v.status] = (counts[v.status] || 0) + 1;
    const totalMaintCost = maintenance.reduce((sum, m) => sum + (Number(m.cost) || 0), 0);
    const activeAssignments = assignments.filter((a) => a.status === 'active').length;
    const criticalDocs = fleetExpiries.filter((e) => ['expired', 'due_today', 'within_7', 'within_30'].includes(e.urgency)).length;
    return { total: vehicles.length, counts, totalMaintCost, activeAssignments, criticalDocs };
  }, [vehicles, maintenance, assignments, fleetExpiries]);

  const filteredVehicles = useMemo(
    () => vehicles.filter((v) => statusFilter === 'all' || v.status === statusFilter),
    [vehicles, statusFilter]
  );

  const vehicleSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'fleet_vehicle', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );
  const handoverSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'fleet_handover', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );
  const maintSchema = useMemo(
    () => buildEffectiveFormSchema({ formId: 'fleet_maintenance', dynamicForms, dynamicFields }),
    [dynamicForms, dynamicFields]
  );

  const openCreateVehicle = () => {
    setEditingVeh(null);
    setVehCustomValues({});
    setVehCustomErrors({});
    setVehForm({
      plateNumber: '',
      vehicleType: settings.customVehicleTypes?.[0] || 'سيارة سيدان',
      make: '',
      model: '',
      year: String(new Date().getFullYear()),
      color: '',
      vin: '',
      ownershipType: 'owned',
      ownerOrLeasingCompany: '',
      status: 'available',
      istimaraNumber: '',
      istimaraExpiryDate: '',
      insuranceCompany: '',
      insurancePolicyNumber: '',
      insuranceExpiryDate: '',
      periodicInspectionExpiryDate: '',
      notes: '',
    });
    setVehModalOpen(true);
  };

  const openEditVehicle = (v: VehicleMaster) => {
    setEditingVeh(v);
    setVehCustomValues(v.customFields ? { ...v.customFields } : {});
    setVehCustomErrors({});
    setVehForm({
      plateNumber: v.plateNumber,
      vehicleType: v.vehicleType,
      make: v.make,
      model: v.model,
      year: v.year ? String(v.year) : '',
      color: v.color || '',
      vin: v.vin || '',
      ownershipType: v.ownershipType,
      ownerOrLeasingCompany: v.ownerOrLeasingCompany || '',
      status: v.status,
      istimaraNumber: v.istimaraNumber || '',
      istimaraExpiryDate: v.istimaraExpiryDate || '',
      insuranceCompany: v.insuranceCompany || '',
      insurancePolicyNumber: v.insurancePolicyNumber || '',
      insuranceExpiryDate: v.insuranceExpiryDate || '',
      periodicInspectionExpiryDate: v.periodicInspectionExpiryDate || '',
      notes: v.notes || '',
    });
    setVehModalOpen(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingVeh && !canEdit) return;
    if (!editingVeh && !canAdd) return;
    const normPlate = normalizePlate(vehForm.plateNumber);
    if (!normPlate || !vehForm.make.trim() || !vehForm.model.trim()) {
      setToast({ type: 'err', msg: 'رقم اللوحة والشركة المصنعة والموديل حقول إلزامية.' });
      return;
    }

    const dynErrs = validateDynamicFormValues(
      Array.from(vehicleSchema.fieldsById.values()),
      vehicleSchema.placements,
      vehCustomValues,
      currentUser
    );
    if (Object.keys(dynErrs).length > 0) {
      setVehCustomErrors(dynErrs);
      setToast({ type: 'err', msg: Object.values(dynErrs)[0] || 'يرجى استكمال الحقول المخصصة للمركبة.' });
      return;
    }
    setVehCustomErrors({});

    const dup = vehicles.find(
      (v) => v.vehicleInternalId !== editingVeh?.vehicleInternalId && normalizePlate(v.plateNumber) === normPlate
    );
    if (dup) {
      setToast({ type: 'err', msg: `رقم اللوحة (${normPlate}) مسجل بالفعل للمركبة ${dup.vehicleInternalId}.` });
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      const vehicleInternalId = editingVeh?.vehicleInternalId || generateNextVehicleId(vehicles);
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const sanitizedCustom = sanitizeCustomFieldsForFirestore(vehCustomValues);

      const payload: Record<string, unknown> = {
        vehicleInternalId,
        plateNumber: normPlate.slice(0, 40),
        vehicleType: vehForm.vehicleType.trim().slice(0, 64),
        make: vehForm.make.trim().slice(0, 80),
        model: vehForm.model.trim().slice(0, 80),
        year: vehForm.year ? Number(vehForm.year) : null,
        ownershipType: vehForm.ownershipType,
        status: vehForm.status,
        createdByUid: editingVeh?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
      };
      if (vehForm.color.trim()) payload.color = vehForm.color.trim().slice(0, 40);
      if (vehForm.vin.trim()) payload.vin = vehForm.vin.trim().slice(0, 64);
      if (vehForm.ownerOrLeasingCompany.trim()) payload.ownerOrLeasingCompany = vehForm.ownerOrLeasingCompany.trim().slice(0, 150);
      if (vehForm.istimaraNumber.trim()) payload.istimaraNumber = vehForm.istimaraNumber.trim().slice(0, 64);
      if (vehForm.istimaraExpiryDate.trim()) payload.istimaraExpiryDate = vehForm.istimaraExpiryDate.trim().slice(0, 10);
      if (vehForm.insuranceCompany.trim()) payload.insuranceCompany = vehForm.insuranceCompany.trim().slice(0, 120);
      if (vehForm.insurancePolicyNumber.trim()) payload.insurancePolicyNumber = vehForm.insurancePolicyNumber.trim().slice(0, 64);
      if (vehForm.insuranceExpiryDate.trim()) payload.insuranceExpiryDate = vehForm.insuranceExpiryDate.trim().slice(0, 10);
      if (vehForm.periodicInspectionExpiryDate.trim())
        payload.periodicInspectionExpiryDate = vehForm.periodicInspectionExpiryDate.trim().slice(0, 10);
      if (vehForm.notes.trim()) payload.notes = vehForm.notes.trim().slice(0, 1000);
      if (Object.keys(sanitizedCustom).length > 0 || editingVeh?.customFields) {
        payload.customFields = sanitizedCustom;
      }

      const ref = doc(db, 'vehicles', vehicleInternalId);
      if (editingVeh) {
        await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() }).catch((err) =>
          handleFirestoreError(err, OperationType.UPDATE, `vehicles/${vehicleInternalId}`)
        );
      } else {
        await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch((err) =>
          handleFirestoreError(err, OperationType.CREATE, `vehicles/${vehicleInternalId}`)
        );
      }

      await writeErpAuditLog({
        action: editingVeh ? 'FLEET_VEHICLE_UPDATED' : 'FLEET_VEHICLE_CREATED',
        targetCollection: 'vehicles',
        targetId: vehicleInternalId,
        entityType: 'vehicle',
        details: `${editingVeh ? 'تحديث' : 'إضافة'} مركبة ${normPlate} (${vehForm.make} ${vehForm.model}) [${vehicleInternalId}]`,
        oldValue: editingVeh ? { plateNumber: editingVeh.plateNumber, status: editingVeh.status } : undefined,
        newValue: { plateNumber: normPlate, status: vehForm.status, ownershipType: vehForm.ownershipType },
        user: currentUser,
        allowedUids,
      });

      setVehModalOpen(false);
      setToast({
        type: 'ok',
        msg: editingVeh ? `تم تحديث المركبة ${normPlate}.` : `تم تسجيل المركبة بالمعرّف التسلسلي ${vehicleInternalId}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd && !canEdit) return;
    const veh = vehicles.find((v) => v.vehicleInternalId === handoverForm.vehicleInternalId);
    const rider = riderById.get(handoverForm.companyRiderId);
    if (!veh || !rider) {
      setToast({ type: 'err', msg: 'اختر المركبة والمندوب لإتمام عملية التسليم.' });
      return;
    }

    const overlap = checkVehicleAssignmentOverlap({
      vehicleInternalId: veh.vehicleInternalId,
      handoverDate: handoverForm.handoverDate,
      existingAssignments: assignments,
    });
    if (overlap && !(handoverForm.allowSharedOverride && canApprove)) {
      setToast({
        type: 'err',
        msg: `لا يمكن تسليم المركبة (${veh.plateNumber}) لوجود عهدة نشطة أو متداخلة مع المندوب ${overlap.riderName || overlap.companyRiderId} بتاريخ ${overlap.handoverDate}.`,
      });
      return;
    }

    const handoverErrs = validateDynamicFormValues(
      Array.from(handoverSchema.fieldsById.values()),
      handoverSchema.placements,
      handoverCustomValues,
      currentUser
    );
    if (Object.keys(handoverErrs).length > 0) {
      setHandoverCustomErrors(handoverErrs);
      setToast({ type: 'err', msg: Object.values(handoverErrs)[0] || 'يرجى استكمال الحقول المخصصة للتسليم.' });
      return;
    }
    setHandoverCustomErrors({});

    setBusy(true);
    setToast(null);
    try {
      const assignmentId = `asg_${veh.vehicleInternalId}_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const odo = handoverForm.handoverOdometer ? Number(handoverForm.handoverOdometer) : null;
      const sanitizedHandoverCustom = sanitizeCustomFieldsForFirestore(handoverCustomValues);

      await setDoc(doc(db, 'vehicleAssignments', assignmentId), {
        assignmentId,
        vehicleInternalId: veh.vehicleInternalId,
        plateNumber: veh.plateNumber,
        companyRiderId: rider.internalRiderId,
        riderName: rider.fullName,
        handoverDate: handoverForm.handoverDate,
        handoverTime: handoverForm.handoverTime || '',
        handoverOdometer: odo,
        handoverCondition: handoverForm.handoverCondition.trim().slice(0, 300),
        handoverNotes: handoverForm.handoverNotes.trim().slice(0, 1000) || '',
        handoverByUid: currentUser.uid,
        handoverByEmail: currentUser.email,
        status: 'active',
        allowSharedOverride: Boolean(handoverForm.allowSharedOverride && canApprove),
        ...(Object.keys(sanitizedHandoverCustom).length > 0 ? { customFields: sanitizedHandoverCustom } : {}),
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'vehicles', veh.vehicleInternalId), {
        status: 'assigned',
        currentRiderId: rider.internalRiderId,
        currentAssignmentId: assignmentId,
        updatedAt: serverTimestamp(),
      });

      await writeErpAuditLog({
        action: 'VEHICLE_HANDOVER_CREATED',
        targetCollection: 'vehicleAssignments',
        targetId: assignmentId,
        entityType: 'vehicle_assignment',
        details: `تسليم المركبة ${veh.plateNumber} (${veh.vehicleInternalId}) إلى المندوب ${rider.fullName} (${rider.internalRiderId}) بعداد ${odo ?? 'غير مسجل'}`,
        newValue: { plateNumber: veh.plateNumber, companyRiderId: rider.internalRiderId, handoverDate: handoverForm.handoverDate, odometer: odo },
        user: currentUser,
        allowedUids,
      });

      setHandoverOpen(false);
      setToast({ type: 'ok', msg: `تم توثيق تسليم المركبة ${veh.plateNumber} للمندوب ${rider.fullName}.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل توثيق تسليم المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReturnVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget || (!canEdit && !canApprove)) return;
    const retOdo = returnForm.returnOdometer ? Number(returnForm.returnOdometer) : null;
    if (retOdo !== null && returnTarget.handoverOdometer !== null && retOdo < returnTarget.handoverOdometer) {
      setToast({
        type: 'err',
        msg: `قراءة العداد عند الاستلام (${retOdo}) أقل من قراءة التسليم (${returnTarget.handoverOdometer}).`,
      });
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      await updateDoc(doc(db, 'vehicleAssignments', returnTarget.assignmentId), {
        status: 'returned',
        returnDate: returnForm.returnDate,
        returnTime: returnForm.returnTime || '',
        returnOdometer: retOdo,
        returnCondition: returnForm.returnCondition.trim().slice(0, 300),
        returnDamageNotes: returnForm.returnDamageNotes.trim().slice(0, 1000),
        returnNotes: returnForm.returnNotes.trim().slice(0, 1000),
        returnByUid: currentUser.uid,
        returnByEmail: currentUser.email,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'vehicles', returnTarget.vehicleInternalId), {
        status: returnForm.nextVehicleStatus,
        currentRiderId: '',
        currentAssignmentId: '',
        updatedAt: serverTimestamp(),
      });

      await writeErpAuditLog({
        action: 'VEHICLE_RETURN_RECORDED',
        targetCollection: 'vehicleAssignments',
        targetId: returnTarget.assignmentId,
        entityType: 'vehicle_assignment',
        details: `استلام عهدة المركبة ${returnTarget.plateNumber} من المندوب ${returnTarget.riderName || returnTarget.companyRiderId} بتاريخ ${returnForm.returnDate}`,
        oldValue: { status: 'active', handoverOdometer: returnTarget.handoverOdometer },
        newValue: { status: 'returned', returnOdometer: retOdo, nextVehicleStatus: returnForm.nextVehicleStatus },
        user: currentUser,
        allowedUids,
      });

      setReturnTarget(null);
      setToast({ type: 'ok', msg: `تم استلام المركبة ${returnTarget.plateNumber} وتحديث حالتها بنجاح.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل توثيق استلام المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd && !canEdit) return;
    const veh = vehicles.find((v) => v.vehicleInternalId === maintForm.vehicleInternalId);
    if (!veh) {
      setToast({ type: 'err', msg: 'اختر المركبة المطلوبة للصيانة.' });
      return;
    }

    const maintErrs = validateDynamicFormValues(
      Array.from(maintSchema.fieldsById.values()),
      maintSchema.placements,
      maintCustomValues,
      currentUser
    );
    if (Object.keys(maintErrs).length > 0) {
      setMaintCustomErrors(maintErrs);
      setToast({ type: 'err', msg: Object.values(maintErrs)[0] || 'يرجى استكمال الحقول المخصصة للصيانة.' });
      return;
    }
    setMaintCustomErrors({});

    setBusy(true);
    try {
      const maintenanceId = `mnt_${veh.vehicleInternalId}_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const costVal = maintForm.cost ? Number(maintForm.cost) : 0;
      const sanitizedMaintCustom = sanitizeCustomFieldsForFirestore(maintCustomValues);

      const payload: Record<string, unknown> = {
        maintenanceId,
        vehicleInternalId: veh.vehicleInternalId,
        plateNumber: veh.plateNumber,
        maintenanceType: maintForm.maintenanceType.trim().slice(0, 120),
        maintenanceDate: maintForm.maintenanceDate,
        cost: costVal,
        odometer: maintForm.odometer ? Number(maintForm.odometer) : null,
        workshop: maintForm.workshop.trim().slice(0, 120),
        details: maintForm.details.trim().slice(0, 1000),
        nextMaintenanceOdometer: maintForm.nextMaintenanceOdometer ? Number(maintForm.nextMaintenanceOdometer) : null,
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (maintForm.nextMaintenanceDate) payload.nextMaintenanceDate = maintForm.nextMaintenanceDate;
      if (Object.keys(sanitizedMaintCustom).length > 0) payload.customFields = sanitizedMaintCustom;

      await setDoc(doc(db, 'vehicleMaintenance', maintenanceId), payload);

      await writeErpAuditLog({
        action: 'FLEET_MAINTENANCE_LOGGED',
        targetCollection: 'vehicleMaintenance',
        targetId: maintenanceId,
        entityType: 'vehicle_maintenance',
        details: `تسجيل صيانة (${maintForm.maintenanceType}) للمركبة ${veh.plateNumber} بتكلفة ${costVal} ر.س`,
        newValue: { plateNumber: veh.plateNumber, cost: costVal, date: maintForm.maintenanceDate },
        user: currentUser,
        allowedUids,
      });

      setMaintModalOpen(false);
      setToast({ type: 'ok', msg: `تم تسجيل سجل الصيانة للمركبة ${veh.plateNumber}.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تسجيل الصيانة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUploadVehicleDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile || !docForm.entityId) {
      setToast({ type: 'err', msg: 'اختر المركبة والملف المطلوب رفعه.' });
      return;
    }
    const veh = vehicles.find((v) => v.vehicleInternalId === docForm.entityId);
    const typeCfg = mergedVehicleDocTypes.find((t) => t.typeId === docForm.docTypeId);

    setBusy(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('الجلسة منتهية.');
      const form = new FormData();
      form.append('file', docFile);
      form.append('entityType', typeCfg?.targetEntity === 'handover' ? 'handover' : 'vehicle');
      form.append('entityId', docForm.entityId);
      form.append('entityLabel', veh ? `${veh.plateNumber} (${veh.make} ${veh.model})` : docForm.entityId);
      form.append('docTypeId', docForm.docTypeId);
      form.append('docTypeName', typeCfg?.nameAr || docForm.docTypeId);
      form.append('title', docForm.title.trim() || typeCfg?.nameAr || docFile.name);
      if (docForm.issueDate) form.append('issueDate', docForm.issueDate);
      if (docForm.expiryDate) form.append('expiryDate', docForm.expiryDate);
      if (docForm.notes) form.append('notes', docForm.notes);

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
      });
      const json = await safeParseJsonResponse<{ success?: boolean; error?: string }>(res);
      if (!res.ok || !json.success) throw new Error(json.error || 'فشل رفع مستند المركبة.');
      setDocModalOpen(false);
      setToast({ type: 'ok', msg: 'تم رفع وثيقة المركبة في الخزينة الخاصة بنجاح.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل رفع المستند.' });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPrivateFile = async (docRec: PrivateDocumentRecord, download: boolean) => {
    if (!canViewDocs) return;
    setBusy(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('يلزم تسجيل الدخول.');
      const res = await fetch(`/api/documents/${encodeURIComponent(docRec.docId)}/file?download=${download ? '1' : '0'}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('تعذر قراءة الملف.');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = docRec.versions[docRec.versions.length - 1]?.originalFileName || `${docRec.docId}.pdf`;
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

  const handleDeleteVehicle = async () => {
    if (!deleteTargetVeh || !canDelete) return;
    setBusy(true);
    try {
      const id = deleteTargetVeh.vehicleInternalId;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const trashId = `trash_vehicle_${id}_${Date.now().toString(36)}`;
      await setDoc(doc(db, 'trashItems', trashId), {
        trashId,
        sourceCollection: 'vehicles',
        sourceDocId: id,
        entityType: 'vehicle',
        titleAr: `${deleteTargetVeh.plateNumber} — ${deleteTargetVeh.make} ${deleteTargetVeh.model}`,
        snapshot: JSON.parse(JSON.stringify(deleteTargetVeh)),
        deletedByUid: currentUser.uid,
        deletedByEmail: currentUser.email,
        deletedAt: new Date().toISOString(),
        status: 'deleted',
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'vehicles', id));
      await writeErpAuditLog({
        action: 'FLEET_VEHICLE_DELETED',
        targetCollection: 'vehicles',
        targetId: id,
        entityType: 'vehicle',
        details: `نقل المركبة ${deleteTargetVeh.plateNumber} (${id}) إلى سلة المحذوفات`,
        oldValue: deleteTargetVeh,
        user: currentUser,
        allowedUids,
      });
      setDeleteTargetVeh(null);
      setToast({ type: 'ok', msg: 'تم نقل المركبة إلى سلة المحذوفات مع إمكانية الاسترجاع.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حذف المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const vehicleCols: TableColumn<VehicleMaster>[] = [
    {
      key: 'id',
      header: 'المعرف واللوحة',
      sortValue: (v) => v.plateNumber,
      render: (v) => (
        <div>
          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{v.plateNumber}</div>
          <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{v.vehicleInternalId}</div>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'النوع والموديل',
      sortValue: (v) => `${v.make} ${v.model}`,
      render: (v) => (
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-200">
            {v.make} {v.model} {v.year || ''}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {v.vehicleType} · {v.ownershipType === 'owned' ? 'ملك الشركة' : `مستأجرة (${v.ownerOrLeasingCompany || 'شركة تأجير'})`}
          </div>
        </div>
      ),
    },
    {
      key: 'rider',
      header: 'العهدة الحالية',
      render: (v) => {
        if (!v.currentRiderId) return <span className="text-xs text-slate-400">غير مسلمة</span>;
        const r = riderById.get(v.currentRiderId);
        return (
          <button
            type="button"
            onClick={() => onOpenRider360(v.currentRiderId!)}
            className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
          >
            {r?.fullName || v.currentRiderId}
          </button>
        );
      },
    },
    {
      key: 'docs',
      header: 'الاستمارة والتأمين',
      render: (v) => (
        <div className="font-mono-num text-[11px]">
          <div>استمارة: {v.istimaraExpiryDate || '—'}</div>
          <div className="text-slate-500 dark:text-slate-400">تأمين: {v.insuranceExpiryDate || '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      sortValue: (v) => v.status,
      render: (v) => <StatusBadge label={VEHICLE_STATUS_LABELS[v.status]} tone={vehicleStatusTone(v.status)} />,
    },
    ...dynamicFields
      .filter((f) => f.formId === 'fleet_vehicle' && f.showInTable && canViewDynamicField(f, currentUser))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .slice(0, 5)
      .map(
        (f): TableColumn<VehicleMaster> => ({
          key: `dyn_${f.key}`,
          header: f.labelAr,
          sortValue: (v) => String(v.customFields?.[f.key] ?? ''),
          render: (v) => (
            <span className="text-xs text-slate-700 dark:text-slate-300 font-mono-num">
              {formatDynamicFieldDisplayValue(f, v.customFields?.[f.key], v.customFields || {})}
            </span>
          ),
        })
      ),
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (v) => (
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => openEditVehicle(v)}>
              تعديل
            </Button>
          )}
          {(canAdd || canEdit) && v.status === 'available' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setHandoverCustomValues({});
                setHandoverCustomErrors({});
                setHandoverForm({
                  vehicleInternalId: v.vehicleInternalId,
                  companyRiderId: riders[0]?.internalRiderId || '',
                  handoverDate: new Date().toISOString().slice(0, 10),
                  handoverTime: new Date().toTimeString().slice(0, 5),
                  handoverOdometer: '',
                  handoverCondition: 'سليمة جاهزة للتشغيل',
                  handoverNotes: '',
                  allowSharedOverride: false,
                });
                setHandoverOpen(true);
              }}
            >
              تسليم عهدة
            </Button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteTargetVeh(v)}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label="حذف المركبة"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const TABS: TabItem<FleetSubTab>[] = [
    { key: 'fleet_dashboard', label: 'لوحة الأسطول', icon: <Car className="h-3.5 w-3.5" /> },
    { key: 'fleet_vehicles', label: 'سجل السيارات', count: vehicles.length, icon: <Car className="h-3.5 w-3.5" /> },
    { key: 'fleet_handover', label: 'التسليم والاستلام', count: assignments.length, icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
    { key: 'fleet_docs', label: 'وثائق المركبات والانتهاء', count: fleetExpiries.length, icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'fleet_maintenance', label: 'سجل الصيانة', count: maintenance.length, icon: <Wrench className="h-3.5 w-3.5" /> },
  ];

  // Dedicated Full-Page Multi-Section Form for Adding / Editing a Vehicle
  if (vehModalOpen) {
    const nextVehId = generateNextVehicleId(vehicles);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setVehModalOpen(false)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>العودة إلى إدارة السيارات والأسطول</span>
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {editingVeh ? `تعديل بيانات المركبة (${editingVeh.vehicleInternalId})` : `إضافة مركبة جديدة (${nextVehId})`}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              توثيق مواصفات المركبة والملكية والاستمارة والتأمين والفحص الدوري في ملف موحد.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setVehModalOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="fleet-vehicle-fullpage-form"
              variant="primary"
              loading={busy}
              icon={<Save className="h-3.5 w-3.5" />}
            >
              {editingVeh ? 'حفظ التعديلات' : 'حفظ بيانات المركبة'}
            </Button>
          </div>
        </div>

        {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

        <form id="fleet-vehicle-fullpage-form" onSubmit={(e) => void handleSaveVehicle(e)} className="space-y-5">
          <Card>
            <SectionHeader
              title="1. بيانات المركبة الأساسية"
              subtitle="رقم اللوحة، الفئة، الطراز والحالة التشغيلية"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="رقم اللوحة" required>
                <Input
                  type="text"
                  required
                  className="font-mono-num"
                  value={vehForm.plateNumber}
                  onChange={(e) => setVehForm({ ...vehForm, plateNumber: e.target.value })}
                  placeholder="مثال: أ ب ج 1234"
                />
              </FormField>
              <FormField label="الشركة المصنعة" required>
                <Input
                  type="text"
                  required
                  value={vehForm.make}
                  onChange={(e) => setVehForm({ ...vehForm, make: e.target.value })}
                  placeholder="Toyota / Hyundai"
                />
              </FormField>
              <FormField label="الموديل" required>
                <Input
                  type="text"
                  required
                  value={vehForm.model}
                  onChange={(e) => setVehForm({ ...vehForm, model: e.target.value })}
                  placeholder="Yaris / Accent"
                />
              </FormField>
              <FormField label="سنة الصنع">
                <Input
                  type="number"
                  className="font-mono-num"
                  value={vehForm.year}
                  onChange={(e) => setVehForm({ ...vehForm, year: e.target.value })}
                />
              </FormField>
              <FormField label="اللون">
                <Input
                  type="text"
                  value={vehForm.color}
                  onChange={(e) => setVehForm({ ...vehForm, color: e.target.value })}
                  placeholder="أبيض / فضي"
                />
              </FormField>
              <FormField label="نوع المركبة">
                <Select
                  value={vehForm.vehicleType}
                  onChange={(e) => setVehForm({ ...vehForm, vehicleType: e.target.value })}
                >
                  {(settings.customVehicleTypes || ['سيارة سيدان', 'فان / توصيل', 'دراجة نارية']).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="حالة المركبة">
                <Select
                  value={vehForm.status}
                  onChange={(e) => setVehForm({ ...vehForm, status: e.target.value as VehicleStatus })}
                >
                  {ALL_VEHICLE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {VEHICLE_STATUS_LABELS[st]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="2. الملكية والتعريف الفني"
              subtitle="جهة الملكية أو عقد التأجير ورقم الهيكل"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="نوع الملكية">
                <Select
                  value={vehForm.ownershipType}
                  onChange={(e) => setVehForm({ ...vehForm, ownershipType: e.target.value as VehicleOwnershipType })}
                >
                  <option value="owned">ملك الشركة</option>
                  <option value="leased">تأجير / عقد تشغيل</option>
                </Select>
              </FormField>
              <FormField label="الشركة المؤجرة / المالك">
                <Input
                  type="text"
                  value={vehForm.ownerOrLeasingCompany}
                  onChange={(e) => setVehForm({ ...vehForm, ownerOrLeasingCompany: e.target.value })}
                  placeholder="اسم شركة التأجير أو المالك"
                />
              </FormField>
              <FormField label="رقم الهيكل (VIN)">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={vehForm.vin}
                  onChange={(e) => setVehForm({ ...vehForm, vin: e.target.value })}
                />
              </FormField>
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="3. الاستمارة والتأمين والفحص الدوري"
              subtitle="تواريخ الانتهاء تغذي مركز التنبيهات الآلي في الأسطول"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="رقم الاستمارة / التسلسل">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={vehForm.istimaraNumber}
                  onChange={(e) => setVehForm({ ...vehForm, istimaraNumber: e.target.value })}
                />
              </FormField>
              <FormField label="انتهاء الاستمارة">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={vehForm.istimaraExpiryDate}
                  onChange={(e) => setVehForm({ ...vehForm, istimaraExpiryDate: e.target.value })}
                />
              </FormField>
              <FormField label="انتهاء الفحص الدوري">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={vehForm.periodicInspectionExpiryDate}
                  onChange={(e) => setVehForm({ ...vehForm, periodicInspectionExpiryDate: e.target.value })}
                />
              </FormField>
              <FormField label="شركة التأمين">
                <Input
                  type="text"
                  value={vehForm.insuranceCompany}
                  onChange={(e) => setVehForm({ ...vehForm, insuranceCompany: e.target.value })}
                />
              </FormField>
              <FormField label="رقم وثيقة التأمين">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={vehForm.insurancePolicyNumber}
                  onChange={(e) => setVehForm({ ...vehForm, insurancePolicyNumber: e.target.value })}
                />
              </FormField>
              <FormField label="انتهاء التأمين">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={vehForm.insuranceExpiryDate}
                  onChange={(e) => setVehForm({ ...vehForm, insuranceExpiryDate: e.target.value })}
                />
              </FormField>
            </div>
          </Card>

          <Card>
            <SectionHeader title="4. الملاحظات والحفظ" className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800" />
            <FormField label="ملاحظات المركبة">
              <Textarea
                rows={3}
                value={vehForm.notes}
                onChange={(e) => setVehForm({ ...vehForm, notes: e.target.value })}
                placeholder="ملاحظات فنية أو شروط عقد التشغيل..."
              />
            </FormField>
          </Card>

          <DynamicFieldsRenderer
            formId="fleet_vehicle"
            entityId={editingVeh?.vehicleInternalId || nextVehId}
            entityLabel={vehForm.plateNumber || nextVehId}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={vehCustomValues}
            onChange={setVehCustomValues}
            user={currentUser}
            mode="form"
            errors={vehCustomErrors}
            contextValues={{ ...vehForm, ...vehCustomValues }}
            title="5. الحقول المخصصة للمركبة (System Builder)"
          />

          <div className="sticky bottom-3 z-10 flex items-center justify-end gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-5 py-3 backdrop-blur shadow-lg">
            <Button variant="secondary" onClick={() => setVehModalOpen(false)}>
              إلغاء والعودة
            </Button>
            <Button type="submit" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
              {editingVeh ? 'حفظ تعديلات المركبة' : 'اعتماد وحفظ المركبة'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="إدارة السيارات والأسطول"
        subtitle="سجل المركبات · التسليم والاستلام ومنع تداخل العهد · الصيانة والتكاليف · الاستمارات والتأمين والفحص الدوري"
        actions={
          <>
            {(canAdd || canEdit) && (
              <>
                <Button
                  variant="secondary"
                  icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setHandoverCustomValues({});
                    setHandoverCustomErrors({});
                    setHandoverForm({
                      vehicleInternalId: vehicles.find((v) => v.status === 'available')?.vehicleInternalId || vehicles[0]?.vehicleInternalId || '',
                      companyRiderId: riders[0]?.internalRiderId || '',
                      handoverDate: new Date().toISOString().slice(0, 10),
                      handoverTime: new Date().toTimeString().slice(0, 5),
                      handoverOdometer: '',
                      handoverCondition: 'جيدة - بدون ملاحظات',
                      handoverNotes: '',
                      allowSharedOverride: false,
                    });
                    setHandoverOpen(true);
                  }}
                >
                  تسليم عهدة مركبة
                </Button>
                <Button
                  variant="secondary"
                  icon={<Wrench className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setMaintCustomValues({});
                    setMaintCustomErrors({});
                    setMaintForm({
                      vehicleInternalId: vehicles[0]?.vehicleInternalId || '',
                      maintenanceType: 'صيانة دورية',
                      maintenanceDate: new Date().toISOString().slice(0, 10),
                      cost: '',
                      odometer: '',
                      workshop: '',
                      details: '',
                      nextMaintenanceDate: '',
                      nextMaintenanceOdometer: '',
                    });
                    setMaintModalOpen(true);
                  }}
                >
                  تسجيل صيانة
                </Button>
              </>
            )}
            {canAddDocs && (
              <Button
                variant="secondary"
                icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => {
                  setDocFile(null);
                  setDocForm({
                    entityId: vehicles[0]?.vehicleInternalId || '',
                    docTypeId: mergedVehicleDocTypes[0]?.typeId || 'vehicle_istimara',
                    title: '',
                    issueDate: '',
                    expiryDate: '',
                    notes: '',
                  });
                  setDocModalOpen(true);
                }}
              >
                رفع وثيقة مركبة
              </Button>
            )}
            {canAdd && (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreateVehicle}>
                إضافة مركبة
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

      {subTab === 'fleet_dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="إجمالي أسطول المركبات"
              value={String(fleetKpis.total)}
              subtext={`مسلمة: ${fleetKpis.counts.assigned} · متاحة: ${fleetKpis.counts.available}`}
              onClick={() => setSubTab('fleet_vehicles')}
            />
            <KpiCard
              label="بالصيانة / خارج الخدمة"
              value={String(fleetKpis.counts.maintenance + fleetKpis.counts.out_of_service)}
              subtext={`صيانة: ${fleetKpis.counts.maintenance} · متوقفة: ${fleetKpis.counts.out_of_service}`}
              tone={fleetKpis.counts.maintenance + fleetKpis.counts.out_of_service > 0 ? 'warn' : 'good'}
            />
            <KpiCard
              label="تنبيهات وثائق المركبات (≤30ي)"
              value={String(fleetKpis.criticalDocs)}
              subtext={`استمارة/تأمين/فحص: ${fleetExpiries.length}`}
              tone={fleetKpis.criticalDocs > 0 ? 'critical' : 'good'}
              onClick={() => setSubTab('fleet_docs')}
            />
            <KpiCard
              label="إجمالي تكاليف الصيانة"
              value={`${fleetKpis.totalMaintCost.toLocaleString('en-US')} ر.س`}
              subtext={`سجلات الصيانة: ${maintenance.length}`}
              onClick={() => setSubTab('fleet_maintenance')}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <SectionHeader title="توزيع حالات المركبات" className="mb-3" />
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {ALL_VEHICLE_STATUSES.map((st) => (
                  <div key={st} className="flex items-center justify-between py-2.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter(st);
                        setSubTab('fleet_vehicles');
                      }}
                      className="hover:opacity-80 transition-opacity"
                    >
                      <StatusBadge label={VEHICLE_STATUS_LABELS[st]} tone={vehicleStatusTone(st)} />
                    </button>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{fleetKpis.counts[st]}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="الوثائق الأقرب للانتهاء في الأسطول"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setSubTab('fleet_docs')}>
                    عرض الكل
                  </Button>
                }
                className="mb-3"
              />
              {fleetExpiries.length === 0 ? (
                <EmptyState
                  title="جميع وثائق الأسطول سارية"
                  subtitle="الاستمارات والتأمينات والفحص الدوري صالحة خلال النافذة الزمنية المحددة."
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {fleetExpiries.slice(0, 7).map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2.5 text-xs gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{item.entityName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                          {item.docCategory} · {item.expiryDate}
                        </div>
                      </div>
                      <StatusBadge
                        tone={expiryTone(item.urgency)}
                        label={item.daysRemaining < 0 ? `منتهي (${Math.abs(item.daysRemaining)}ي)` : `${item.daysRemaining} يوم`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {subTab === 'fleet_vehicles' && (
        <div className="space-y-4">
          <Card padding="sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300 ml-1">حالة المركبة:</span>
              <Button
                size="sm"
                variant={statusFilter === 'all' ? 'primary' : 'secondary'}
                onClick={() => setStatusFilter('all')}
              >
                الكل ({vehicles.length})
              </Button>
              {ALL_VEHICLE_STATUSES.map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={statusFilter === st ? 'primary' : 'secondary'}
                  onClick={() => setStatusFilter(st)}
                >
                  {VEHICLE_STATUS_LABELS[st]} ({fleetKpis.counts[st]})
                </Button>
              ))}
            </div>
          </Card>

          <SavedViewsBar
            scope="fleet_vehicles"
            user={currentUser}
            allowedUids={allowedUids}
            savedViews={savedViews}
            currentFilters={{ statusFilter }}
            onApplyView={(f) => {
              if (typeof f.statusFilter === 'string') setStatusFilter(f.statusFilter as 'all' | VehicleStatus);
            }}
            onChanged={onRefresh}
          />

          <DataTable
            rows={filteredVehicles}
            columns={vehicleCols}
            rowKey={(v) => v.vehicleInternalId}
            searchPlaceholder="ابحث برقم اللوحة، الموديل، المعرّف، أو الشركة المؤجرة..."
            searchText={(v) => `${v.plateNumber} ${v.vehicleInternalId} ${v.make} ${v.model} ${v.ownerOrLeasingCompany || ''} ${v.currentRiderId || ''} ${Object.values(v.customFields || {}).join(' ')}`}
          />
        </div>
      )}

      {subTab === 'fleet_handover' && (
        <DataTable
          rows={assignments}
          rowKey={(a) => a.assignmentId}
          searchPlaceholder="ابحث برقم اللوحة أو اسم المندوب..."
          searchText={(a) => `${a.plateNumber} ${a.vehicleInternalId} ${a.riderName || ''} ${a.companyRiderId}`}
          columns={[
            {
              key: 'veh',
              header: 'المركبة',
              sortValue: (a) => a.plateNumber,
              render: (a) => (
                <div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{a.plateNumber}</div>
                  <div className="text-[11px] text-slate-500 font-mono-num">{a.vehicleInternalId}</div>
                </div>
              ),
            },
            {
              key: 'rider',
              header: 'المندوب المستلم',
              sortValue: (a) => a.riderName || a.companyRiderId,
              render: (a) => (
                <button type="button" onClick={() => onOpenRider360(a.companyRiderId)} className="text-right hover:underline">
                  <div className="font-semibold text-blue-700 dark:text-blue-400">{a.riderName || a.companyRiderId}</div>
                  <div className="font-mono-num text-[11px] text-slate-500">{a.companyRiderId}</div>
                </button>
              ),
            },
            {
              key: 'handover',
              header: 'تاريخ وعداد التسليم',
              sortValue: (a) => a.handoverDate,
              render: (a) => (
                <div className="font-mono-num text-xs">
                  <div>{a.handoverDate} {a.handoverTime || ''}</div>
                  <div className="text-slate-500">عداد: {a.handoverOdometer ?? '—'} كم</div>
                </div>
              ),
            },
            {
              key: 'return',
              header: 'تاريخ وعداد الاستلام',
              render: (a) =>
                a.status === 'returned' ? (
                  <div className="font-mono-num text-xs">
                    <div>{a.returnDate} {a.returnTime || ''}</div>
                    <div className="text-slate-500">عداد: {a.returnOdometer ?? '—'} كم</div>
                  </div>
                ) : (
                  <StatusBadge label="عهدة نشطة" tone="info" />
                ),
            },
            {
              key: 'cond',
              header: 'الحالة والملاحظات',
              render: (a) => (
                <div className="text-xs max-w-[200px] truncate text-slate-700 dark:text-slate-300" title={a.returnDamageNotes || a.handoverCondition}>
                  {a.returnCondition || a.handoverCondition}
                </div>
              ),
            },
            {
              key: 'act',
              header: 'الإجراء',
              render: (a) =>
                a.status === 'active' && (canEdit || canApprove) ? (
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => {
                      setReturnTarget(a);
                      setReturnForm({
                        returnDate: new Date().toISOString().slice(0, 10),
                        returnTime: new Date().toTimeString().slice(0, 5),
                        returnOdometer: a.handoverOdometer ? String(a.handoverOdometer) : '',
                        returnCondition: 'سليمة بدون أضرار جديدة',
                        returnDamageNotes: '',
                        returnNotes: '',
                        nextVehicleStatus: 'available',
                      });
                    }}
                  >
                    استلام وإرجاع
                  </Button>
                ) : (
                  <StatusBadge label="مغلقة" tone="neutral" />
                ),
            },
          ]}
        />
      )}

      {subTab === 'fleet_docs' && (
        <div className="space-y-5">
          <Card>
            <SectionHeader title={`مستندات الأسطول المرفوعة في الخزينة الخاصة (${vehicleDocs.length})`} className="mb-3" />
            <DataTable
              rows={vehicleDocs}
              rowKey={(d) => d.docId}
              searchPlaceholder="ابحث برقم اللوحة أو نوع المستند..."
              searchText={(d) => `${d.title} ${d.docTypeName} ${d.entityLabel || ''}`}
              columns={[
                { key: 'title', header: 'الوثيقة', render: (d) => <span className="font-semibold text-xs">{d.title} ({d.docTypeName})</span> },
                { key: 'entity', header: 'المركبة', render: (d) => <span className="text-xs">{d.entityLabel || d.entityId}</span> },
                { key: 'exp', header: 'الانتهاء', render: (d) => <span className="font-mono-num text-xs">{d.expiryDate || '—'}</span> },
                {
                  key: 'act',
                  header: 'عرض / تنزيل',
                  render: (d) =>
                    canViewDocs ? (
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void handleOpenPrivateFile(d, false)}>
                          معاينة
                        </Button>
                        <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void handleOpenPrivateFile(d, true)} aria-label="تنزيل" />
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>

          <DataTable
            rows={fleetExpiries}
            rowKey={(e) => e.id}
            searchPlaceholder="ابحث في تواريخ انتهاء الاستمارة والتأمين والفحص..."
            searchText={(e) => `${e.entityName} ${e.docCategory}`}
            columns={[
              { key: 'ent', header: 'المركبة', render: (e) => <span className="font-semibold text-xs">{e.entityName}</span> },
              { key: 'cat', header: 'نوع الوثيقة', render: (e) => <span className="text-xs">{e.docCategory} {e.docNumber ? `· ${e.docNumber}` : ''}</span> },
              { key: 'dt', header: 'تاريخ الانتهاء', sortValue: (e) => e.expiryDate, render: (e) => <span className="font-mono-num text-xs">{e.expiryDate}</span> },
              {
                key: 'rem',
                header: 'الحالة / المتبقي',
                sortValue: (e) => e.daysRemaining,
                render: (e) => (
                  <StatusBadge
                    tone={expiryTone(e.urgency)}
                    label={e.daysRemaining < 0 ? `منتهي منذ ${Math.abs(e.daysRemaining)} يوم` : `${e.daysRemaining} يوم`}
                  />
                ),
              },
            ]}
          />
        </div>
      )}

      {subTab === 'fleet_maintenance' && (
        <DataTable
          rows={maintenance}
          rowKey={(m) => m.maintenanceId}
          searchPlaceholder="ابحث برقم اللوحة، نوع الصيانة، أو الورشة..."
          searchText={(m) => `${m.plateNumber} ${m.maintenanceType} ${m.workshop || ''} ${m.details || ''}`}
          columns={[
            { key: 'plate', header: 'المركبة', sortValue: (m) => m.plateNumber, render: (m) => <span className="font-mono-num font-bold text-xs">{m.plateNumber}</span> },
            { key: 'type', header: 'نوع الصيانة', render: (m) => <span className="font-semibold text-xs">{m.maintenanceType}</span> },
            { key: 'date', header: 'التاريخ', sortValue: (m) => m.maintenanceDate, render: (m) => <span className="font-mono-num text-xs">{m.maintenanceDate}</span> },
            { key: 'cost', header: 'التكلفة', sortValue: (m) => m.cost ?? 0, render: (m) => <span className="font-mono-num text-xs font-bold">{(m.cost || 0).toLocaleString('en-US')} ر.س</span> },
            { key: 'odo', header: 'العداد', render: (m) => <span className="font-mono-num text-xs">{m.odometer ? `${m.odometer} كم` : '—'}</span> },
            { key: 'work', header: 'الورشة / الموعد القادم', render: (m) => <span className="text-xs text-slate-500">{[m.workshop, m.nextMaintenanceDate].filter(Boolean).join(' · ') || '—'}</span> },
          ]}
        />
      )}

      {/* HANDOVER DRAWER */}
      <SlideDrawer
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        title="تسليم عهدة مركبة لمندوب"
        subtitle="التحقق التلقائي من عدم تداخل العهد النشطة وتوثيق قراءة العداد"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHandoverOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-handover-form" variant="primary" loading={busy}>
              توثيق التسليم
            </Button>
          </>
        }
      >
        <form id="fleet-handover-form" onSubmit={(e) => void handleHandover(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="المركبة" required>
              <Select
                required
                value={handoverForm.vehicleInternalId}
                onChange={(e) => setHandoverForm({ ...handoverForm, vehicleInternalId: e.target.value })}
              >
                {vehicles.map((v) => (
                  <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                    {v.plateNumber} — {v.make} {v.model} ({VEHICLE_STATUS_LABELS[v.status]})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="المندوب المستلم" required>
              <Select
                required
                value={handoverForm.companyRiderId}
                onChange={(e) => setHandoverForm({ ...handoverForm, companyRiderId: e.target.value })}
              >
                {riders.map((r) => (
                  <option key={r.internalRiderId} value={r.internalRiderId}>
                    {r.fullName} ({r.internalRiderId})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="تاريخ التسليم" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={handoverForm.handoverDate}
                onChange={(e) => setHandoverForm({ ...handoverForm, handoverDate: e.target.value })}
              />
            </FormField>
            <FormField label="قراءة العداد (كم)">
              <Input
                type="number"
                className="font-mono-num"
                value={handoverForm.handoverOdometer}
                onChange={(e) => setHandoverForm({ ...handoverForm, handoverOdometer: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="حالة المركبة عند التسليم" required>
            <Input
              type="text"
              required
              value={handoverForm.handoverCondition}
              onChange={(e) => setHandoverForm({ ...handoverForm, handoverCondition: e.target.value })}
            />
          </FormField>
          {canApprove && (
            <label className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={handoverForm.allowSharedOverride}
                onChange={(e) => setHandoverForm({ ...handoverForm, allowSharedOverride: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>استثناء مشاركة مركبة بين أكثر من مندوب (يتطلب صلاحية الاعتماد)</span>
            </label>
          )}
          <DynamicFieldsRenderer
            formId="fleet_handover"
            entityId={handoverForm.vehicleInternalId || 'handover_draft'}
            entityLabel={handoverForm.vehicleInternalId || 'عهدة مركبة'}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={handoverCustomValues}
            onChange={setHandoverCustomValues}
            user={currentUser}
            mode="form"
            errors={handoverCustomErrors}
            contextValues={{ ...handoverForm, ...handoverCustomValues }}
            title="حقول مخصصة لتسليم العهدة"
          />
        </form>
      </SlideDrawer>

      {/* RETURN DRAWER */}
      <SlideDrawer
        open={Boolean(returnTarget)}
        onClose={() => setReturnTarget(null)}
        title={`استلام المركبة (${returnTarget?.plateNumber || ''}) وإغلاق العهدة`}
        subtitle={returnTarget ? `المندوب: ${returnTarget.riderName || returnTarget.companyRiderId}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReturnTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-return-form" variant="primary" loading={busy}>
              توثيق الاستلام
            </Button>
          </>
        }
      >
        <form id="fleet-return-form" onSubmit={(e) => void handleReturnVehicle(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="تاريخ الاستلام" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={returnForm.returnDate}
                onChange={(e) => setReturnForm({ ...returnForm, returnDate: e.target.value })}
              />
            </FormField>
            <FormField label="عداد الاستلام (كم)">
              <Input
                type="number"
                className="font-mono-num"
                value={returnForm.returnOdometer}
                onChange={(e) => setReturnForm({ ...returnForm, returnOdometer: e.target.value })}
              />
            </FormField>
            <FormField label="الحالة الجديدة للمركبة بعد الاستلام" className="sm:col-span-2">
              <Select
                value={returnForm.nextVehicleStatus}
                onChange={(e) => setReturnForm({ ...returnForm, nextVehicleStatus: e.target.value as VehicleStatus })}
              >
                <option value="available">متاحة للتسليم</option>
                <option value="maintenance">تحويل للصيانة</option>
                <option value="out_of_service">خارج الخدمة</option>
              </Select>
            </FormField>
          </div>
          <FormField label="الفحص والأضرار (إن وجدت)">
            <Textarea
              rows={3}
              value={returnForm.returnDamageNotes}
              onChange={(e) => setReturnForm({ ...returnForm, returnDamageNotes: e.target.value })}
              placeholder="ملاحظات الفحص الفني أو الخدوش الجديدة..."
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* MAINTENANCE DRAWER */}
      <SlideDrawer
        open={maintModalOpen}
        onClose={() => setMaintModalOpen(false)}
        title="تسجيل عملية صيانة مركبة"
        subtitle="تحديث سجل التكاليف وموعد الصيانة الدورية القادم"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMaintModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-maint-form" variant="primary" loading={busy}>
              حفظ سجل الصيانة
            </Button>
          </>
        }
      >
        <form id="fleet-maint-form" onSubmit={(e) => void handleSaveMaintenance(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="المركبة" required>
              <Select
                required
                value={maintForm.vehicleInternalId}
                onChange={(e) => setMaintForm({ ...maintForm, vehicleInternalId: e.target.value })}
              >
                {vehicles.map((v) => (
                  <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                    {v.plateNumber} ({v.make} {v.model})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="نوع الصيانة" required>
              <Input
                type="text"
                required
                value={maintForm.maintenanceType}
                onChange={(e) => setMaintForm({ ...maintForm, maintenanceType: e.target.value })}
              />
            </FormField>
            <FormField label="التاريخ" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={maintForm.maintenanceDate}
                onChange={(e) => setMaintForm({ ...maintForm, maintenanceDate: e.target.value })}
              />
            </FormField>
            <FormField label="التكلفة (ر.س)">
              <Input
                type="number"
                step="0.01"
                className="font-mono-num"
                value={maintForm.cost}
                onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })}
              />
            </FormField>
            <FormField label="الورشة / المركز">
              <Input
                type="text"
                value={maintForm.workshop}
                onChange={(e) => setMaintForm({ ...maintForm, workshop: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ الصيانة القادمة">
              <Input
                type="date"
                className="font-mono-num"
                value={maintForm.nextMaintenanceDate}
                onChange={(e) => setMaintForm({ ...maintForm, nextMaintenanceDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="التفاصيل الفنية">
            <Textarea
              rows={2}
              value={maintForm.details}
              onChange={(e) => setMaintForm({ ...maintForm, details: e.target.value })}
              placeholder="القطع المستبدلة والملاحظات..."
            />
          </FormField>
          <DynamicFieldsRenderer
            formId="fleet_maintenance"
            entityId={maintForm.vehicleInternalId || 'maint_draft'}
            entityLabel={maintForm.maintenanceType || 'صيانة مركبة'}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={maintCustomValues}
            onChange={setMaintCustomValues}
            user={currentUser}
            mode="form"
            errors={maintCustomErrors}
            contextValues={{ ...maintForm, ...maintCustomValues }}
            title="حقول مخصصة لسجل الصيانة"
          />
        </form>
      </SlideDrawer>

      {/* UPLOAD VEHICLE DOCUMENT DRAWER */}
      <SlideDrawer
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        title="رفع وثيقة مركبة أو صور عهدة (خزينة خاصة)"
        subtitle="الاستمارة، وثيقة التأمين، الفحص الدوري، أو صور التسليم"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-doc-upload-form" variant="primary" loading={busy} icon={<Upload className="h-3.5 w-3.5" />}>
              حفظ الوثيقة
            </Button>
          </>
        }
      >
        <form id="fleet-doc-upload-form" onSubmit={(e) => void handleUploadVehicleDoc(e)} className="space-y-4">
          <FormField label="المركبة" required>
            <Select
              required
              value={docForm.entityId}
              onChange={(e) => setDocForm({ ...docForm, entityId: e.target.value })}
            >
              {vehicles.map((v) => (
                <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                  {v.plateNumber} — {v.make} {v.model}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="نوع الوثيقة">
              <Select
                value={docForm.docTypeId}
                onChange={(e) => setDocForm({ ...docForm, docTypeId: e.target.value })}
              >
                {mergedVehicleDocTypes.map((dt) => (
                  <option key={dt.typeId} value={dt.typeId}>
                    {dt.nameAr}
                  </option>
                ))}
              </Select>
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
          <FormField label="الملف (PDF أو صورة)" required>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-700 dark:text-slate-300"
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* DOCUMENT PREVIEW DRAWER */}
      <SlideDrawer
        open={Boolean(previewDoc)}
        onClose={() => {
          if (previewDoc) URL.revokeObjectURL(previewDoc.blobUrl);
          setPreviewDoc(null);
        }}
        title={previewDoc?.doc.title || 'معاينة وثيقة المركبة'}
        subtitle={previewDoc?.doc.entityLabel || previewDoc?.doc.entityId}
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
          <div className="h-[72vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-2 flex items-center justify-center overflow-auto">
            {previewDoc.mime.startsWith('image/') ? (
              <img src={previewDoc.blobUrl} alt={previewDoc.doc.title} className="max-h-full max-w-full object-contain rounded" />
            ) : (
              <iframe src={previewDoc.blobUrl} title={previewDoc.doc.title} className="h-full w-full rounded border-0" />
            )}
          </div>
        )}
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteTargetVeh)}
        title="حذف مركبة من السجل"
        description={`هل تريد حذف المركبة ${deleteTargetVeh?.plateNumber || ''} (${deleteTargetVeh?.vehicleInternalId || ''})؟`}
        danger
        busy={busy}
        onCancel={() => setDeleteTargetVeh(null)}
        onConfirm={() => void handleDeleteVehicle()}
      />
    </div>
  );
}
