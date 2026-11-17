import { deleteDoc, doc, serverTimestamp, setDoc } from '../lib/erpDb';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  History,
  Link2,
  Plus,
  Printer,
  RefreshCw,
  Repeat,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
  computeAllDocumentExpiries,
  DAMAGE_LIABILITY_LABELS,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_STATUS_LABELS,
  DOCUMENT_COMPLIANCE_LABELS,
  generateNextVehicleId,
  MAINTENANCE_WORKFLOW_LABELS,
  normalizePlate,
  normalizeVehicleStatus,
  VEHICLE_SOURCE_LABELS,
  VEHICLE_STATUS_LABELS,
  writeErpAuditLog,
  type ExpiryUrgency,
} from '../lib/erpHelpers';
import { db, DEFAULT_DOCUMENT_TYPES, DEFAULT_FLEET_CONFIG, getActiveAuthToken } from '../lib/firebase';
import {
  approveFleetPendingReturn,
  attachDelegationToApproval,
  cancelFleetApproval,
  completeFleetMaintenanceWorkOrder,
  createFleetMaintenanceWorkOrder,
  createFleetVehicle,
  decideFleetAdminApproval,
  decideFleetDocument,
  decideFleetOperationsApproval,
  executeFleetHandover,
  executeFleetReturn,
  fetchVehicleProfile360,
  requestFleetAssignment,
  transferFleetCustody,
  transitionFleetVehicleStatus,
  updateFleetDamageClaim,
  updateFleetVehicle,
  uploadFleetVaultFile,
  upsertFleetDocument,
  type VehicleAvailabilityItem,
  type VehicleProfile360Response,
} from '../lib/fleetApi';
import { safeParseJsonResponse } from '../lib/safeFetch';
import { hasFleetPermission, hasPermission } from '../shared/rbacCore';
import {
  buildEffectiveFormSchema,
  canViewDynamicField,
  formatDynamicFieldDisplayValue,
  sanitizeCustomFieldsForFirestore,
  validateDynamicFormValues,
} from '../lib/dynamicSchemaEngine';
import type {
  AccessoryCheckItem,
  CompanyBrandingDoc,
  DocumentTypeConfig,
  DynamicFieldDefinition,
  DynamicFormDefinition,
  FleetApprovalRequest,
  FleetApprovalRequestType,
  FleetApprovalStatus,
  FleetConfigSettings,
  FleetNotificationRecord,
  InspectionCheckItem,
  OperationalSettings,
  PhotoEvidenceSlot,
  PrivateDocumentRecord,
  RiderMaster,
  RoleTemplate,
  SavedViewConfig,
  UserProfile,
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
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { FleetDashboardAnalytics } from './fleet/FleetDashboardAnalytics';
import { FleetProtocolPrintModal, type FleetProtocolTarget } from './fleet/FleetProtocolPrintModal';
import { FleetReportsTab } from './fleet/FleetReportsTab';
import { FleetSettingsTab } from './fleet/FleetSettingsTab';
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

export type FleetSubTab =
  | 'fleet_dashboard'
  | 'fleet_vehicles'
  | 'fleet_assignments'
  | 'fleet_approvals'
  | 'fleet_handover'
  | 'fleet_docs'
  | 'fleet_maintenance'
  | 'fleet_reports'
  | 'fleet_settings';

interface FleetManagementModuleProps {
  vehicles: VehicleMaster[];
  assignments: VehicleAssignment[];
  maintenance: VehicleMaintenanceRecord[];
  riders: RiderMaster[];
  privateDocs: PrivateDocumentRecord[];
  documentTypes: DocumentTypeConfig[];
  availability?: VehicleAvailabilityItem[];
  custodies?: VehicleCustody[];
  handovers?: VehicleHandoverRecord[];
  returns?: VehicleReturnRecord[];
  approvals?: FleetApprovalRequest[];
  damageClaims?: VehicleDamageClaim[];
  notifications?: FleetNotificationRecord[];
  vehicleDocuments?: VehicleDocumentRecord[];
  statusHistory?: VehicleStatusHistoryEntry[];
  movementHistory?: VehicleMovementHistoryEntry[];
  fleetConfig?: FleetConfigSettings;
  companyBranding?: CompanyBrandingDoc | null;
  settings: OperationalSettings;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  allowedUids: string[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  savedViews?: SavedViewConfig[];
  initialSubTab?: FleetSubTab;
  onOpenRider360: (internalRiderId: string) => void;
  onNotificationsUpdated?: (next: FleetNotificationRecord[]) => void;
  onRefresh: () => Promise<void>;
}

const PRIMARY_VEHICLE_STATUSES: VehicleStatus[] = [
  'available',
  'assigned',
  'reserved',
  'pending_return_inspection',
  'maintenance',
  'stopped',
  'retired',
];

const FUEL_TYPE_LABELS: Record<VehicleFuelType, string> = {
  petrol: 'بنزين',
  diesel: 'ديزل',
  hybrid: 'هايبرد (هجين)',
  electric: 'كهربائي',
};

const DOC_CATEGORY_LABELS: Record<VehicleDocumentCategory, string> = {
  istimara: 'رخصة السير (الاستمارة)',
  insurance: 'وثيقة التأمين',
  periodic_inspection: 'شهادة الفحص الدوري',
  operating_card: 'بطاقة التشغيل',
  delegation: 'تفويض قيادة مركبة',
  lease_contract: 'عقد إيجار / تمويل',
  other: 'وثيقة أخرى',
};

const DEFAULT_CHECKLIST_ITEMS: Array<{ itemKey: string; labelAr: string }> = [
  { itemKey: 'body_exterior', labelAr: 'الهيكل الخارجي والزجاج والمرايا' },
  { itemKey: 'tires', labelAr: 'الإطارات وضغط الهواء والاستبنة' },
  { itemKey: 'lights_signals', labelAr: 'الأنوار والإشارات والتنبيه' },
  { itemKey: 'brakes_engine', labelAr: 'المكابح وصوت المحرك والتبريد' },
  { itemKey: 'interior_ac', labelAr: 'المقصورة الداخلية والتكييف والنظافة' },
];

const DEFAULT_ACCESSORIES_ITEMS: Array<{ accessoryKey: string; labelAr: string }> = [
  { accessoryKey: 'spare_key', labelAr: 'مفتاح المركبة / الاحتياطي' },
  { accessoryKey: 'istimara_copy', labelAr: 'أصل أو صورة الاستمارة والتأمين' },
  { accessoryKey: 'first_aid_triangle', labelAr: 'طفاية حريق ومثلث سلامة وإسعافات' },
  { accessoryKey: 'jack_tools', labelAr: 'عفريتة ومفك العجلات' },
];

function vehicleStatusTone(status: VehicleStatus): BadgeTone {
  if (status === 'available') return 'success';
  if (status === 'assigned') return 'info';
  if (status === 'reserved' || status === 'pending_return_inspection' || status === 'maintenance' || status === 'leased_out') {
    return 'warning';
  }
  if (status === 'stopped' || status === 'retired' || status === 'out_of_service' || status === 'ended') {
    return 'danger';
  }
  return 'neutral';
}

function approvalStatusTone(status: FleetApprovalStatus): BadgeTone {
  if (status === 'approved' || status === 'completed') return 'success';
  if (status === 'pending_operations' || status === 'pending_admin' || status === 'pending_delegation') return 'warning';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function expiryTone(urgency: ExpiryUrgency): BadgeTone {
  if (urgency === 'expired' || urgency === 'due_today' || urgency === 'within_7') return 'danger';
  if (urgency === 'within_30' || urgency === 'within_60') return 'warning';
  if (urgency === 'within_90') return 'info';
  return 'success';
}

function complianceTone(status: string): BadgeTone {
  if (status === 'valid' || status === 'approved') return 'success';
  if (status === 'expiring_soon' || status === 'pending_review' || status === 'pending' || status === 'not_started') return 'warning';
  return 'danger';
}

export function FleetManagementModule({
  vehicles,
  assignments,
  maintenance,
  riders,
  privateDocs,
  documentTypes,
  availability = [],
  custodies = [],
  handovers = [],
  returns = [],
  approvals = [],
  damageClaims = [],
  notifications = [],
  vehicleDocuments = [],
  statusHistory = [],
  movementHistory = [],
  fleetConfig,
  companyBranding,
  settings,
  currentUser,
  roleTemplates,
  allowedUids,
  dynamicFields = [],
  dynamicForms = [],
  savedViews = [],
  initialSubTab = 'fleet_dashboard',
  onOpenRider360,
  onNotificationsUpdated,
  onRefresh,
}: FleetManagementModuleProps) {
  const [subTab, setSubTab] = useState<FleetSubTab>(initialSubTab);
  const [statusFilter, setStatusFilter] = useState<'all' | VehicleStatus>('all');
  const [readinessFilter, setReadinessFilter] = useState<'all' | 'ready' | 'blocked'>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | FleetApprovalStatus>('all');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [protocolTarget, setProtocolTarget] = useState<FleetProtocolTarget | null>(null);

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
    sourceType: 'owned' as VehicleSourceType,
    ownershipType: 'owned' as VehicleOwnershipType,
    ownerOrLeasingCompany: '',
    branch: '',
    city: '',
    fuelType: 'petrol' as VehicleFuelType,
    currentOdometer: '',
    status: 'available' as VehicleStatus,
    istimaraNumber: '',
    istimaraExpiryDate: '',
    insuranceCompany: '',
    insurancePolicyNumber: '',
    insuranceExpiryDate: '',
    periodicInspectionExpiryDate: '',
    notes: '',
  });

  // Controlled Status Transition Drawer
  const [statusTargetVeh, setStatusTargetVeh] = useState<VehicleMaster | null>(null);
  const [statusTransitionForm, setStatusTransitionForm] = useState<{
    toStatus: VehicleStatus;
    reason: string;
  }>({ toStatus: 'stopped', reason: '' });

  // Vehicle 360° Details Drawer
  const [profile360VehId, setProfile360VehId] = useState<string | null>(null);
  const [profile360Data, setProfile360Data] = useState<VehicleProfile360Response | null>(null);
  const [profile360Loading, setProfile360Loading] = useState(false);
  const [profile360Tab, setProfile360Tab] = useState<'overview' | 'custody' | 'docs' | 'history'>('overview');

  // Phase 3: Assignment Request Drawer
  const [assignReqOpen, setAssignReqOpen] = useState(false);
  const [assignReqForm, setAssignReqForm] = useState({
    vehicleInternalId: '',
    riderId: '',
    requestType: 'vehicle_assignment' as FleetApprovalRequestType,
    requestReason: '',
    delegationNumber: '',
    delegationStartDate: '',
    delegationExpiryDate: '',
  });

  // Phase 3: Operations / Admin Decision Drawer
  const [approvalDecisionTarget, setApprovalDecisionTarget] = useState<{
    approval: FleetApprovalRequest;
    stage: 'operations' | 'admin';
  } | null>(null);
  const [approvalDecisionForm, setApprovalDecisionForm] = useState<{
    decision: 'approved' | 'rejected';
    note: string;
  }>({ decision: 'approved', note: '' });

  // Phase 3: Attach Delegation Drawer
  const [delegationTarget, setDelegationTarget] = useState<FleetApprovalRequest | null>(null);
  const [delegationForm, setDelegationForm] = useState({
    delegationNumber: '',
    delegationStartDate: new Date().toISOString().slice(0, 10),
    delegationExpiryDate: '',
    issuerName: 'إدارة المرور / منصة تم',
    notes: '',
  });
  const [delegationFile, setDelegationFile] = useState<File | null>(null);

  // Phase 4: Enterprise Handover Drawer
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverForm, setHandoverForm] = useState({
    approvalRequestId: '',
    vehicleInternalId: '',
    companyRiderId: '',
    handoverType: 'new_handover' as VehicleHandoverRecord['handoverType'],
    handoverDate: new Date().toISOString().slice(0, 10),
    handoverTime: new Date().toTimeString().slice(0, 5),
    handoverOdometer: '',
    fuelLevel: 'ممتلئ 4/4',
    handoverCondition: 'سليمة جاهزة للتشغيل',
    handoverNotes: '',
    riderAcknowledged: false,
    riderAcknowledgmentMethod: 'signature' as NonNullable<VehicleHandoverRecord['riderAcknowledgmentMethod']>,
    directOverride: false,
  });
  const [handoverChecklist, setHandoverChecklist] = useState<InspectionCheckItem[]>([]);
  const [handoverAccessories, setHandoverAccessories] = useState<AccessoryCheckItem[]>([]);
  const [handoverPhotoFiles, setHandoverPhotoFiles] = useState<File[]>([]);

  // Phase 4: Enterprise Return Inspection Drawer
  const [returnTarget, setReturnTarget] = useState<{
    vehicleInternalId: string;
    plateNumber: string;
    custodyId?: string;
    riderId: string;
    riderName: string;
    startOdometer: number | null;
  } | null>(null);
  const [returnForm, setReturnForm] = useState({
    returnDate: new Date().toISOString().slice(0, 10),
    returnTime: new Date().toTimeString().slice(0, 5),
    returnOdometer: '',
    fuelLevelAtReturn: 'متوسط 2/4',
    overallCondition: 'سليمة عند الاستلام',
    damageDetected: false,
    damageSummary: '',
    damageSeverity: 'moderate' as VehicleDamageClaim['severity'],
    estimatedRepairCost: '',
    damageLiability: 'under_review' as VehicleDamageClaim['liability'],
    recommendedNextStatus: 'available' as 'available' | 'maintenance' | 'stopped',
    finalizeImmediately: true,
    notes: '',
  });
  const [returnChecklist, setReturnChecklist] = useState<InspectionCheckItem[]>([]);
  const [returnAccessories, setReturnAccessories] = useState<AccessoryCheckItem[]>([]);
  const [returnPhotoFiles, setReturnPhotoFiles] = useState<File[]>([]);

  // Phase 4: Pending Return Finalize Drawer & Custody Transfer Drawer
  const [pendingReturnTarget, setPendingReturnTarget] = useState<VehicleReturnRecord | null>(null);
  const [pendingReturnForm, setPendingReturnForm] = useState<{
    nextVehicleStatus: 'available' | 'maintenance' | 'stopped';
    note: string;
  }>({ nextVehicleStatus: 'available', note: '' });

  const [transferTarget, setTransferTarget] = useState<VehicleCustody | null>(null);
  const [transferForm, setTransferForm] = useState({
    toRiderId: '',
    transferDate: new Date().toISOString().slice(0, 10),
    odometer: '',
    fuelLevel: 'متوسط 2/4',
    condition: 'نقل عهدة مباشر بين مندوبين',
    notes: '',
  });

  // Phase 5: Maintenance Work Order Create + Complete Drawers
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [maintForm, setMaintForm] = useState({
    vehicleInternalId: '',
    maintenanceType: 'صيانة دورية / تغيير زيت',
    maintenanceDate: new Date().toISOString().slice(0, 10),
    estimatedCost: '',
    odometer: '',
    workshop: '',
    details: '',
    nextMaintenanceDate: '',
    nextMaintenanceOdometer: '',
    stopVehicle: false,
    requireCostApproval: false,
  });
  const [maintInvoiceFile, setMaintInvoiceFile] = useState<File | null>(null);

  const [completeMaintTarget, setCompleteMaintTarget] = useState<VehicleMaintenanceRecord | null>(null);
  const [completeMaintForm, setCompleteMaintForm] = useState({
    actualCost: '',
    completedOdometer: '',
    completedAt: new Date().toISOString().slice(0, 10),
    releaseVehicleToAvailable: true,
    details: '',
  });
  const [completeMaintInvoiceFile, setCompleteMaintInvoiceFile] = useState<File | null>(null);

  // Phase 5: Damage Claim Settlement Drawer
  const [claimTarget, setClaimTarget] = useState<VehicleDamageClaim | null>(null);
  const [claimForm, setClaimForm] = useState({
    liability: 'under_review' as VehicleDamageClaim['liability'],
    status: 'open' as VehicleDamageClaim['status'],
    actualRepairCost: '',
    notes: '',
  });

  // Phase 5: Structured Vehicle Document Upsert & Decision
  const [structuredDocOpen, setStructuredDocOpen] = useState(false);
  const [structuredDocForm, setStructuredDocForm] = useState({
    vehicleDocId: '',
    vehicleInternalId: '',
    docCategory: 'istimara' as VehicleDocumentCategory,
    titleAr: '',
    documentNumber: '',
    issuerName: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
  });
  const [structuredDocFile, setStructuredDocFile] = useState<File | null>(null);
  const [rejectDocTarget, setRejectDocTarget] = useState<VehicleDocumentRecord | null>(null);
  const [rejectDocReason, setRejectDocReason] = useState('');

  // Upload & Preview Drawers (Private Vault)
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

  const canAdd =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.create') ||
    hasPermission(currentUser, roleTemplates, 'fleet', 'add');
  const canEdit =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.edit') ||
    hasPermission(currentUser, roleTemplates, 'fleet', 'edit');
  const canDelete =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.delete') ||
    hasPermission(currentUser, roleTemplates, 'fleet', 'delete');
  const canApprove =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.handover.approve') ||
    hasPermission(currentUser, roleTemplates, 'fleet', 'approve');
  const canRequestAssignment =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.assignment.request') || canAdd || canEdit;
  const canOpsApprove =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.assignment.operations_approve') || canApprove;
  const canAdminApprove =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.assignment.admin_approve') || canApprove;
  const canCreateHandover =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.handover.create') || canAdd || canEdit;
  const canCreateReturn =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.return.create') || canEdit || canApprove;
  const canApproveReturn =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.return.approve') || canApprove || canEdit;
  const canCreateMaint =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.maintenance.create') || canAdd || canEdit;
  const canApproveMaint =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.maintenance.approve') || canApprove || canEdit;
  const canViewDocs =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.documents.view') ||
    hasPermission(currentUser, roleTemplates, 'documents', 'view');
  const canAddDocs =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.documents.upload') ||
    hasPermission(currentUser, roleTemplates, 'documents', 'add');
  const canApproveDocs =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.documents.approve') || canApprove || canEdit;
  const canViewReports =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.reports.view') ||
    hasPermission(currentUser, roleTemplates, 'reports', 'view') ||
    hasPermission(currentUser, roleTemplates, 'fleet', 'view');
  const canExportReports =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.reports.export') ||
    hasPermission(currentUser, roleTemplates, 'reports', 'export') ||
    canEdit;
  const canManageFleetSettings =
    hasFleetPermission(currentUser, roleTemplates, 'fleet.settings.manage') ||
    hasPermission(currentUser, roleTemplates, 'settings', 'edit') ||
    currentUser.role === 'owner' ||
    currentUser.role === 'admin';

  const riderById = useMemo(() => new Map(riders.map((r) => [r.internalRiderId, r])), [riders]);
  const availabilityByVehicleId = useMemo(
    () => new Map(availability.map((a) => [a.vehicleInternalId, a])),
    [availability]
  );
  const vehicleDocs = useMemo(
    () =>
      privateDocs.filter((d) =>
        ['vehicle', 'vehicle_doc', 'delegation', 'handover', 'return', 'maintenance', 'damage_claim'].includes(
          d.entityType
        )
      ),
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
      reserved: 0,
      pending_return_inspection: 0,
      maintenance: 0,
      stopped: 0,
      retired: 0,
      out_of_service: 0,
      leased_out: 0,
      ended: 0,
    };
    let readyToDispatch = 0;
    let blocked = 0;

    for (const v of vehicles) {
      const normalizedStatus = normalizeVehicleStatus(v.status, Boolean(v.activeCustodyId || v.currentRiderId));
      counts[v.status] = (counts[v.status] || 0) + 1;
      if (normalizedStatus !== v.status) {
        counts[normalizedStatus] = (counts[normalizedStatus] || 0) + 1;
      }
      const avail = availabilityByVehicleId.get(v.vehicleInternalId);
      const isReady = avail ? avail.readyToDispatch : v.readyToDispatch ?? v.status === 'available';
      if (isReady) readyToDispatch += 1;
      else blocked += 1;
    }

    const totalMaintCost = maintenance.reduce((sum, m) => sum + (Number(m.cost) || 0), 0);
    const activeAssignments =
      custodies.filter((c) => c.status === 'active').length ||
      assignments.filter((a) => a.status === 'active').length;
    const criticalDocs = fleetExpiries.filter((e) =>
      ['expired', 'due_today', 'within_7', 'within_30'].includes(e.urgency)
    ).length;

    return {
      total: vehicles.length,
      counts,
      readyToDispatch,
      blocked,
      totalMaintCost,
      activeAssignments,
      criticalDocs,
    };
  }, [vehicles, availabilityByVehicleId, maintenance, custodies, assignments, fleetExpiries]);

  const filteredVehicles = useMemo(
    () =>
      vehicles.filter((v) => {
        const normalized = normalizeVehicleStatus(v.status, Boolean(v.activeCustodyId || v.currentRiderId));
        if (statusFilter !== 'all' && v.status !== statusFilter && normalized !== statusFilter) {
          return false;
        }
        if (readinessFilter !== 'all') {
          const avail = availabilityByVehicleId.get(v.vehicleInternalId);
          const isReady = avail ? avail.readyToDispatch : v.readyToDispatch ?? v.status === 'available';
          if (readinessFilter === 'ready' && !isReady) return false;
          if (readinessFilter === 'blocked' && isReady) return false;
        }
        return true;
      }),
    [vehicles, statusFilter, readinessFilter, availabilityByVehicleId]
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
      sourceType: 'owned',
      ownershipType: 'owned',
      ownerOrLeasingCompany: '',
      branch: settings.configuredBranches?.[0] || '',
      city: riders.find((r) => r.city)?.city || '',
      fuelType: 'petrol',
      currentOdometer: '',
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
    const resolvedSource: VehicleSourceType =
      v.sourceType || (v.ownershipType === 'leased' ? 'leased' : 'owned');
    setVehForm({
      plateNumber: v.plateNumber,
      vehicleType: v.vehicleType,
      make: v.make,
      model: v.model,
      year: v.year ? String(v.year) : '',
      color: v.color || '',
      vin: v.vin || '',
      sourceType: resolvedSource,
      ownershipType: resolvedSource === 'leased' ? 'leased' : v.ownershipType,
      ownerOrLeasingCompany: v.ownerOrLeasingCompany || '',
      branch: v.branch || '',
      city: v.city || '',
      fuelType: v.fuelType || 'petrol',
      currentOdometer: v.currentOdometer !== null && v.currentOdometer !== undefined ? String(v.currentOdometer) : '',
      status: normalizeVehicleStatus(v.status, Boolean(v.activeCustodyId || v.currentRiderId)),
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

  const openVehicle360 = async (vehicleInternalId: string) => {
    setProfile360VehId(vehicleInternalId);
    setProfile360Tab('overview');
    setProfile360Data(null);
    setProfile360Loading(true);
    try {
      const data = await fetchVehicleProfile360(vehicleInternalId);
      setProfile360Data(data);
    } catch (err) {
      setToast({
        type: 'err',
        msg: err instanceof Error ? err.message : 'تعذر تحميل الملف الشامل 360° للمركبة.',
      });
    } finally {
      setProfile360Loading(false);
    }
  };

  const openStatusDrawer = (v: VehicleMaster) => {
    const normalized = normalizeVehicleStatus(v.status, Boolean(v.activeCustodyId || v.currentRiderId));
    setStatusTargetVeh(v);
    setStatusTransitionForm({
      toStatus: normalized === 'stopped' ? 'available' : 'stopped',
      reason: '',
    });
  };

  const handleTransitionStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTargetVeh || !canEdit) return;
    const reason = statusTransitionForm.reason.trim();
    if ((statusTransitionForm.toStatus === 'stopped' || statusTransitionForm.toStatus === 'retired') && !reason) {
      setToast({ type: 'err', msg: 'سبب الإيقاف أو الإخراج من الخدمة إلزامي.' });
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      const res = await transitionFleetVehicleStatus(statusTargetVeh.vehicleInternalId, {
        toStatus: statusTransitionForm.toStatus,
        reason: reason || undefined,
      });
      setStatusTargetVeh(null);
      setToast({
        type: 'ok',
        msg: `تم تحديث حالة المركبة (${res.vehicle.plateNumber}) إلى ${VEHICLE_STATUS_LABELS[res.vehicle.status]}.`,
      });
      await onRefresh();
      if (profile360VehId === res.vehicle.vehicleInternalId) {
        void openVehicle360(res.vehicle.vehicleInternalId);
      }
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تحديث حالة المركبة.' });
    } finally {
      setBusy(false);
    }
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

    setBusy(true);
    setToast(null);
    try {
      const sanitizedCustom = sanitizeCustomFieldsForFirestore(vehCustomValues);
      const basePayload = {
        plateNumber: normPlate.slice(0, 40),
        vehicleType: vehForm.vehicleType.trim().slice(0, 64),
        make: vehForm.make.trim().slice(0, 80),
        model: vehForm.model.trim().slice(0, 80),
        year: vehForm.year ? Number(vehForm.year) : null,
        color: vehForm.color.trim().slice(0, 40) || undefined,
        vin: vehForm.vin.trim().slice(0, 64) || undefined,
        sourceType: vehForm.sourceType,
        ownershipType: (vehForm.sourceType === 'leased' ? 'leased' : 'owned') as VehicleOwnershipType,
        ownerOrLeasingCompany: vehForm.ownerOrLeasingCompany.trim().slice(0, 150) || undefined,
        branch: vehForm.branch.trim().slice(0, 80) || undefined,
        city: vehForm.city.trim().slice(0, 80) || undefined,
        fuelType: vehForm.fuelType,
        currentOdometer: vehForm.currentOdometer ? Number(vehForm.currentOdometer) : null,
        istimaraNumber: vehForm.istimaraNumber.trim().slice(0, 64) || undefined,
        istimaraExpiryDate: vehForm.istimaraExpiryDate.trim().slice(0, 10) || undefined,
        insuranceCompany: vehForm.insuranceCompany.trim().slice(0, 120) || undefined,
        insurancePolicyNumber: vehForm.insurancePolicyNumber.trim().slice(0, 64) || undefined,
        insuranceExpiryDate: vehForm.insuranceExpiryDate.trim().slice(0, 10) || undefined,
        periodicInspectionExpiryDate: vehForm.periodicInspectionExpiryDate.trim().slice(0, 10) || undefined,
        notes: vehForm.notes.trim().slice(0, 1000) || undefined,
        ...(Object.keys(sanitizedCustom).length > 0 || editingVeh?.customFields
          ? { customFields: sanitizedCustom }
          : {}),
      };

      if (editingVeh) {
        const res = await updateFleetVehicle(editingVeh.vehicleInternalId, basePayload);
        setVehModalOpen(false);
        setToast({
          type: 'ok',
          msg: `تم تحديث المركبة ${res.vehicle.plateNumber} (${res.vehicle.vehicleInternalId}).`,
        });
      } else {
        const initialStatus: VehicleStatus =
          vehForm.status === 'stopped' || vehForm.status === 'maintenance' ? vehForm.status : 'available';
        const res = await createFleetVehicle({
          ...basePayload,
          status: initialStatus,
        });
        setVehModalOpen(false);
        setToast({
          type: 'ok',
          msg: `تم تسجيل المركبة بالمعرّف التسلسلي ${res.vehicle.vehicleInternalId} (${res.vehicle.plateNumber}).`,
        });
      }
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const buildDefaultChecklist = (): InspectionCheckItem[] =>
    (fleetConfig?.defaultChecklistItems?.length ? fleetConfig.defaultChecklistItems : DEFAULT_CHECKLIST_ITEMS).map(
      (item) => ({
        itemKey: item.itemKey,
        labelAr: item.labelAr,
        status: 'ok',
        notes: '',
      })
    );

  const buildDefaultAccessories = (): AccessoryCheckItem[] =>
    (fleetConfig?.defaultAccessories?.length ? fleetConfig.defaultAccessories : DEFAULT_ACCESSORIES_ITEMS).map(
      (item) => ({
        accessoryKey: item.accessoryKey,
        labelAr: item.labelAr,
        present: true,
        condition: 'good',
        notes: '',
      })
    );

  const openAssignmentRequestDrawer = (preVehicleId?: string) => {
    const readyVehicle =
      (preVehicleId ? vehicles.find((v) => v.vehicleInternalId === preVehicleId) : null) ||
      vehicles.find((v) => availabilityByVehicleId.get(v.vehicleInternalId)?.readyToDispatch) ||
      vehicles.find((v) => v.status === 'available') ||
      vehicles[0];
    const eligibleRider =
      riders.find((r) => !['terminated', 'inactive', 'suspended'].includes(r.status)) || riders[0];
    setAssignReqForm({
      vehicleInternalId: readyVehicle?.vehicleInternalId || '',
      riderId: eligibleRider?.internalRiderId || '',
      requestType: 'vehicle_assignment',
      requestReason: '',
      delegationNumber: '',
      delegationStartDate: '',
      delegationExpiryDate: '',
    });
    setAssignReqOpen(true);
  };

  const handleRequestAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRequestAssignment) return;
    if (!assignReqForm.vehicleInternalId || !assignReqForm.riderId) {
      setToast({ type: 'err', msg: 'اختر المركبة والمندوب لتقديم الطلب.' });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const res = await requestFleetAssignment({
        vehicleInternalId: assignReqForm.vehicleInternalId,
        riderId: assignReqForm.riderId,
        requestType: assignReqForm.requestType,
        requestReason: assignReqForm.requestReason.trim() || undefined,
        delegationNumber: assignReqForm.delegationNumber.trim() || undefined,
        delegationStartDate: assignReqForm.delegationStartDate || undefined,
        delegationExpiryDate: assignReqForm.delegationExpiryDate || undefined,
      });
      setAssignReqOpen(false);
      setToast({
        type: 'ok',
        msg: `تم رفع الطلب (${res.approval.requestNumber}) وحجز المركبة ${res.vehicle.plateNumber} بانتظار اعتماد التشغيل.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر رفع طلب الربط.' });
    } finally {
      setBusy(false);
    }
  };

  const handleApprovalDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalDecisionTarget) return;
    setBusy(true);
    setToast(null);
    try {
      const { approval, stage } = approvalDecisionTarget;
      const res =
        stage === 'operations'
          ? await decideFleetOperationsApproval(approval.requestId, approvalDecisionForm)
          : await decideFleetAdminApproval(approval.requestId, approvalDecisionForm);
      setApprovalDecisionTarget(null);
      setToast({
        type: 'ok',
        msg: `تم تحديث قرار الطلب (${res.approval.requestNumber}) — الحالة الحالية: ${APPROVAL_STATUS_LABELS[res.approval.status] || res.approval.status}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر تسجيل قرار الاعتماد.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAttachDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegationTarget) return;
    setBusy(true);
    setToast(null);
    try {
      let uploadedDocId: string | undefined;
      if (delegationFile) {
        const uploaded = await uploadFleetVaultFile({
          file: delegationFile,
          entityType: 'delegation',
          entityId: delegationTarget.vehicleInternalId,
          entityLabel: `${delegationTarget.plateNumber} — ${delegationTarget.riderName || ''}`,
          docTypeId: 'vehicle_delegation',
          docTypeName: 'وثيقة تفويض قيادة',
          title: `تفويض قيادة رقم ${delegationForm.delegationNumber} (${delegationTarget.plateNumber})`,
          issueDate: delegationForm.delegationStartDate,
          expiryDate: delegationForm.delegationExpiryDate,
          notes: delegationForm.notes,
        });
        uploadedDocId = uploaded.docId;
      }

      const res = await attachDelegationToApproval(delegationTarget.requestId, {
        delegationNumber: delegationForm.delegationNumber.trim(),
        delegationStartDate: delegationForm.delegationStartDate,
        delegationExpiryDate: delegationForm.delegationExpiryDate,
        privateDocId: uploadedDocId,
        issuerName: delegationForm.issuerName.trim() || undefined,
        notes: delegationForm.notes.trim() || undefined,
      });
      setDelegationTarget(null);
      setDelegationFile(null);
      setToast({
        type: 'ok',
        msg: `تم توثيق التفويض رقم (${res.approval.delegationNumber}) وتجهيز الطلب (${res.approval.requestNumber}) لتسليم المركبة.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر إرفاق التفويض.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCancelApprovalRequest = async (req: FleetApprovalRequest) => {
    setBusy(true);
    setToast(null);
    try {
      await cancelFleetApproval(req.requestId, 'إلغاء الطلب قبل إتمام التسليم');
      setToast({ type: 'ok', msg: `تم إلغاء الطلب (${req.requestNumber}) وتحرير حجز المركبة.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر إلغاء الطلب.' });
    } finally {
      setBusy(false);
    }
  };

  const openEnterpriseHandoverDrawer = (opts?: {
    approval?: FleetApprovalRequest;
    vehicle?: VehicleMaster;
  }) => {
    const app = opts?.approval;
    const veh =
      opts?.vehicle ||
      (app ? vehicles.find((v) => v.vehicleInternalId === app.vehicleInternalId) : null) ||
      vehicles.find((v) => v.status === 'available') ||
      vehicles[0];
    const eligibleRider = riders.find((r) => !['terminated', 'inactive', 'suspended'].includes(r.status)) || riders[0];

    setHandoverCustomValues({});
    setHandoverCustomErrors({});
    setHandoverChecklist(buildDefaultChecklist());
    setHandoverAccessories(buildDefaultAccessories());
    setHandoverPhotoFiles([]);
    setHandoverForm({
      approvalRequestId: app?.requestId || '',
      vehicleInternalId: app?.vehicleInternalId || veh?.vehicleInternalId || '',
      companyRiderId: app?.riderId || eligibleRider?.internalRiderId || '',
      handoverType: app?.requestType === 'vehicle_transfer' ? 'transfer' : 'new_handover',
      handoverDate: new Date().toISOString().slice(0, 10),
      handoverTime: new Date().toTimeString().slice(0, 5),
      handoverOdometer: veh?.currentOdometer !== null && veh?.currentOdometer !== undefined ? String(veh.currentOdometer) : '',
      fuelLevel: 'ممتلئ 4/4',
      handoverCondition: 'سليمة جاهزة للتشغيل',
      handoverNotes: '',
      riderAcknowledged: false,
      riderAcknowledgmentMethod: 'signature',
      directOverride: !app && (canApprove || canAdminApprove),
    });
    setHandoverOpen(true);
  };

  const handleHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateHandover) return;
    if (!handoverForm.vehicleInternalId || !handoverForm.companyRiderId) {
      setToast({ type: 'err', msg: 'اختر المركبة والمندوب لإتمام محضر التسليم.' });
      return;
    }
    if (!handoverForm.riderAcknowledged) {
      setToast({ type: 'err', msg: 'يجب تأكيد إقرار واستلام المندوب للمركبة قبل حفظ المحضر.' });
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
      const veh = vehicles.find((v) => v.vehicleInternalId === handoverForm.vehicleInternalId);
      const photoSlots: PhotoEvidenceSlot[] = [];
      for (let i = 0; i < handoverPhotoFiles.length; i += 1) {
        const f = handoverPhotoFiles[i];
        const uploaded = await uploadFleetVaultFile({
          file: f,
          entityType: 'handover',
          entityId: handoverForm.vehicleInternalId,
          entityLabel: veh ? `${veh.plateNumber} (${veh.make} ${veh.model})` : handoverForm.vehicleInternalId,
          docTypeId: 'handover_photo',
          docTypeName: 'صورة تسليم مركبة',
          title: `صورة محضر التسليم (${i + 1}) — ${veh?.plateNumber || handoverForm.vehicleInternalId}`,
        });
        photoSlots.push({
          slotKey: `photo_${i + 1}`,
          labelAr: `صورة فحص التسليم #${i + 1}`,
          docId: uploaded.docId,
          fileName: f.name,
          uploadedAt: new Date().toISOString(),
        });
      }

      const odo = handoverForm.handoverOdometer ? Number(handoverForm.handoverOdometer) : null;
      const sanitizedHandoverCustom = sanitizeCustomFieldsForFirestore(handoverCustomValues);

      const res = await executeFleetHandover({
        vehicleInternalId: handoverForm.vehicleInternalId,
        riderId: handoverForm.companyRiderId,
        approvalRequestId: handoverForm.approvalRequestId || undefined,
        handoverType: handoverForm.handoverType,
        handoverDate: handoverForm.handoverDate,
        handoverTime: handoverForm.handoverTime || undefined,
        odometer: odo,
        fuelLevel: handoverForm.fuelLevel,
        overallCondition: handoverForm.handoverCondition.trim(),
        notes: handoverForm.handoverNotes.trim() || undefined,
        checklist: handoverChecklist,
        accessories: handoverAccessories,
        photoSlots,
        riderAcknowledged: handoverForm.riderAcknowledged,
        riderAcknowledgmentMethod: handoverForm.riderAcknowledgmentMethod,
        directOverride: handoverForm.directOverride,
        customFields: Object.keys(sanitizedHandoverCustom).length > 0 ? sanitizedHandoverCustom : undefined,
      });

      setHandoverOpen(false);
      setToast({
        type: 'ok',
        msg: `تم إتمام محضر التسليم (${res.handover.handoverNumber}) وتفعيل العهدة (${res.custody.custodyNumber}) للمركبة ${res.vehicle.plateNumber}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل توثيق محضر التسليم.' });
    } finally {
      setBusy(false);
    }
  };

  const openEnterpriseReturnDrawer = (target: {
    vehicleInternalId: string;
    plateNumber: string;
    custodyId?: string;
    riderId: string;
    riderName: string;
    startOdometer: number | null;
  }) => {
    setReturnTarget(target);
    setReturnChecklist(buildDefaultChecklist());
    setReturnAccessories(buildDefaultAccessories());
    setReturnPhotoFiles([]);
    setReturnForm({
      returnDate: new Date().toISOString().slice(0, 10),
      returnTime: new Date().toTimeString().slice(0, 5),
      returnOdometer: target.startOdometer !== null ? String(target.startOdometer) : '',
      fuelLevelAtReturn: 'متوسط 2/4',
      overallCondition: 'سليمة بدون أضرار جديدة',
      damageDetected: false,
      damageSummary: '',
      damageSeverity: 'moderate',
      estimatedRepairCost: '',
      damageLiability: 'under_review',
      recommendedNextStatus: 'available',
      finalizeImmediately: canApproveReturn,
      notes: '',
    });
  };

  const handleReturnVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget || !canCreateReturn) return;

    setBusy(true);
    setToast(null);
    try {
      const photoSlots: PhotoEvidenceSlot[] = [];
      for (let i = 0; i < returnPhotoFiles.length; i += 1) {
        const f = returnPhotoFiles[i];
        const uploaded = await uploadFleetVaultFile({
          file: f,
          entityType: 'return',
          entityId: returnTarget.vehicleInternalId,
          entityLabel: `${returnTarget.plateNumber} — ${returnTarget.riderName}`,
          docTypeId: 'return_photo',
          docTypeName: 'صورة استلام مركبة',
          title: `صورة فحص الاستلام (${i + 1}) — ${returnTarget.plateNumber}`,
        });
        photoSlots.push({
          slotKey: `ret_photo_${i + 1}`,
          labelAr: `صورة الاستلام #${i + 1}`,
          docId: uploaded.docId,
          fileName: f.name,
          uploadedAt: new Date().toISOString(),
        });
      }

      const retOdo = returnForm.returnOdometer ? Number(returnForm.returnOdometer) : null;
      const res = await executeFleetReturn({
        vehicleInternalId: returnTarget.vehicleInternalId,
        custodyId: returnTarget.custodyId,
        returnDate: returnForm.returnDate,
        returnTime: returnForm.returnTime || undefined,
        odometerAtReturn: retOdo,
        fuelLevelAtReturn: returnForm.fuelLevelAtReturn,
        overallCondition: returnForm.overallCondition.trim(),
        checklist: returnChecklist,
        accessories: returnAccessories,
        photoSlots,
        damageDetected: returnForm.damageDetected,
        damageSummary: returnForm.damageDetected ? returnForm.damageSummary.trim() : undefined,
        damageSeverity: returnForm.damageDetected ? returnForm.damageSeverity : undefined,
        estimatedRepairCost:
          returnForm.damageDetected && returnForm.estimatedRepairCost ? Number(returnForm.estimatedRepairCost) : null,
        damageLiability: returnForm.damageDetected ? returnForm.damageLiability : undefined,
        recommendedNextStatus: returnForm.recommendedNextStatus,
        finalizeImmediately: canApproveReturn ? returnForm.finalizeImmediately : false,
        notes: returnForm.notes.trim() || undefined,
      });

      setReturnTarget(null);
      setToast({
        type: 'ok',
        msg: `تم تسجيل محضر الاستلام (${res.returnRecord.returnNumber})${res.damageClaim ? ` وفتح بلاغ الضرر (${res.damageClaim.claimNumber})` : ''} بنجاح.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل توثيق محضر الاستلام.' });
    } finally {
      setBusy(false);
    }
  };

  const handleApprovePendingReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingReturnTarget || !canApproveReturn) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await approveFleetPendingReturn(pendingReturnTarget.returnId, {
        nextVehicleStatus: pendingReturnForm.nextVehicleStatus,
        note: pendingReturnForm.note.trim() || undefined,
      });
      setPendingReturnTarget(null);
      setToast({
        type: 'ok',
        msg: `تم اعتماد إغلاق محضر الاستلام (${res.returnRecord.returnNumber}) وتحويل المركبة إلى (${VEHICLE_STATUS_LABELS[res.vehicle.status]}).`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر اعتماد إغلاق المحضر.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTransferCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTarget || !canCreateHandover || !canCreateReturn) return;
    if (!transferForm.toRiderId) {
      setToast({ type: 'err', msg: 'اختر المندوب المستلم الجديد.' });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const res = await transferFleetCustody(transferTarget.custodyId, {
        toRiderId: transferForm.toRiderId,
        transferDate: transferForm.transferDate,
        odometer: transferForm.odometer ? Number(transferForm.odometer) : null,
        fuelLevel: transferForm.fuelLevel,
        condition: transferForm.condition.trim() || undefined,
        notes: transferForm.notes.trim() || undefined,
      });
      setTransferTarget(null);
      setToast({
        type: 'ok',
        msg: `تم نقل عهدة المركبة ${res.vehicle.plateNumber} إلى (${res.newCustody.riderName}) بعهدة جديدة (${res.newCustody.custodyNumber}).`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل نقل العهدة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateMaint) return;
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
    setToast(null);
    try {
      let invoiceDocId: string | undefined;
      if (maintInvoiceFile) {
        const uploaded = await uploadFleetVaultFile({
          file: maintInvoiceFile,
          entityType: 'maintenance',
          entityId: veh.vehicleInternalId,
          entityLabel: `${veh.plateNumber} — ${maintForm.maintenanceType}`,
          docTypeId: 'maintenance_invoice',
          docTypeName: 'فاتورة / عرض سعر صيانة',
          title: `أمر صيانة (${maintForm.maintenanceType}) — ${veh.plateNumber}`,
        });
        invoiceDocId = uploaded.docId;
      }

      const estCost = maintForm.estimatedCost ? Number(maintForm.estimatedCost) : null;
      const sanitizedMaintCustom = sanitizeCustomFieldsForFirestore(maintCustomValues);
      const res = await createFleetMaintenanceWorkOrder({
        vehicleInternalId: veh.vehicleInternalId,
        maintenanceType: maintForm.maintenanceType.trim(),
        maintenanceDate: maintForm.maintenanceDate,
        estimatedCost: estCost,
        cost: estCost,
        odometer: maintForm.odometer ? Number(maintForm.odometer) : null,
        workshop: maintForm.workshop.trim() || undefined,
        details: maintForm.details.trim() || undefined,
        nextMaintenanceDate: maintForm.nextMaintenanceDate || undefined,
        nextMaintenanceOdometer: maintForm.nextMaintenanceOdometer ? Number(maintForm.nextMaintenanceOdometer) : null,
        stopVehicle: maintForm.stopVehicle,
        requireCostApproval: maintForm.requireCostApproval,
        invoiceDocId,
        customFields: Object.keys(sanitizedMaintCustom).length > 0 ? sanitizedMaintCustom : undefined,
      });

      setMaintModalOpen(false);
      setMaintInvoiceFile(null);
      setToast({
        type: 'ok',
        msg: `تم فتح أمر الصيانة (${res.maintenance.workOrderNumber || res.maintenance.maintenanceId}) للمركبة ${veh.plateNumber}${res.approval ? ` وإرسال طلب اعتماد التكلفة (${res.approval.requestNumber})` : ''}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل فتح أمر الصيانة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeMaintTarget || !canApproveMaint) return;
    setBusy(true);
    setToast(null);
    try {
      let invoiceDocId: string | undefined;
      if (completeMaintInvoiceFile) {
        const uploaded = await uploadFleetVaultFile({
          file: completeMaintInvoiceFile,
          entityType: 'maintenance',
          entityId: completeMaintTarget.vehicleInternalId,
          entityLabel: `${completeMaintTarget.plateNumber} — فاتورة إغلاق صيانة`,
          docTypeId: 'maintenance_invoice',
          docTypeName: 'فاتورة صيانة نهائية',
          title: `فاتورة إغلاق (${completeMaintTarget.workOrderNumber || completeMaintTarget.maintenanceId})`,
        });
        invoiceDocId = uploaded.docId;
      }

      const res = await completeFleetMaintenanceWorkOrder(completeMaintTarget.maintenanceId, {
        actualCost: completeMaintForm.actualCost !== '' ? Number(completeMaintForm.actualCost) : null,
        completedOdometer: completeMaintForm.completedOdometer ? Number(completeMaintForm.completedOdometer) : null,
        completedAt: completeMaintForm.completedAt,
        invoiceDocId,
        releaseVehicleToAvailable: completeMaintForm.releaseVehicleToAvailable,
        details: completeMaintForm.details.trim() || undefined,
      });
      setCompleteMaintTarget(null);
      setCompleteMaintInvoiceFile(null);
      setToast({
        type: 'ok',
        msg: `تم إغلاق واعتماد أمر الصيانة (${res.maintenance.workOrderNumber || res.maintenance.maintenanceId}) للمركبة ${res.vehicle.plateNumber}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر إغلاق أمر الصيانة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateDamageClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimTarget || !canApproveMaint) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await updateFleetDamageClaim(claimTarget.claimId, {
        liability: claimForm.liability,
        status: claimForm.status,
        actualRepairCost: claimForm.actualRepairCost !== '' ? Number(claimForm.actualRepairCost) : null,
        notes: claimForm.notes.trim() || undefined,
      });
      setClaimTarget(null);
      setToast({
        type: 'ok',
        msg: `تم تحديث مطالبة الضرر (${res.claim.claimNumber}) بنجاح.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر تحديث مطالبة الضرر.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStructuredVehicleDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddDocs && !canEdit) return;
    const veh = vehicles.find((v) => v.vehicleInternalId === structuredDocForm.vehicleInternalId);
    if (!veh) {
      setToast({ type: 'err', msg: 'اختر المركبة المطلوبة للوثيقة.' });
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      let privateDocId: string | undefined;
      if (structuredDocFile) {
        const uploaded = await uploadFleetVaultFile({
          file: structuredDocFile,
          entityType: 'vehicle_doc',
          entityId: veh.vehicleInternalId,
          entityLabel: `${veh.plateNumber} (${veh.make} ${veh.model})`,
          docTypeId: structuredDocForm.docCategory,
          docTypeName: DOC_CATEGORY_LABELS[structuredDocForm.docCategory],
          title: structuredDocForm.titleAr.trim() || DOC_CATEGORY_LABELS[structuredDocForm.docCategory],
          issueDate: structuredDocForm.issueDate || undefined,
          expiryDate: structuredDocForm.expiryDate || undefined,
          notes: structuredDocForm.notes || undefined,
        });
        privateDocId = uploaded.docId;
      }

      const res = await upsertFleetDocument({
        vehicleDocId: structuredDocForm.vehicleDocId || undefined,
        vehicleInternalId: veh.vehicleInternalId,
        docCategory: structuredDocForm.docCategory,
        titleAr: structuredDocForm.titleAr.trim() || undefined,
        documentNumber: structuredDocForm.documentNumber.trim() || undefined,
        issuerName: structuredDocForm.issuerName.trim() || undefined,
        issueDate: structuredDocForm.issueDate || undefined,
        expiryDate: structuredDocForm.expiryDate || undefined,
        privateDocId,
        notes: structuredDocForm.notes.trim() || undefined,
      });

      setStructuredDocOpen(false);
      setStructuredDocFile(null);
      setToast({
        type: 'ok',
        msg: `تم حفظ وثيقة (${res.document.titleAr}) للمركبة ${res.vehicle.plateNumber} ومزامنة جاهزيتها تلقائيًا.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حفظ وثيقة المركبة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDecideStructuredDoc = async (
    docRec: VehicleDocumentRecord,
    decision: 'approved' | 'rejected',
    rejectionReason?: string
  ) => {
    if (!canApproveDocs) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await decideFleetDocument(docRec.vehicleDocId, { decision, rejectionReason });
      setRejectDocTarget(null);
      setRejectDocReason('');
      setToast({
        type: 'ok',
        msg: `تم ${decision === 'approved' ? 'اعتماد' : 'رفض'} وثيقة (${res.document.titleAr}) للمركبة ${res.vehicle.plateNumber}.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر تحديث قرار الوثيقة.' });
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
      const idToken = await getActiveAuthToken();
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
      const idToken = await getActiveAuthToken();
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
        <button
          type="button"
          onClick={() => void openVehicle360(v.vehicleInternalId)}
          className="text-right group"
        >
          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {v.plateNumber}
          </div>
          <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
            {v.vehicleInternalId}
            {v.branch || v.city ? ` · ${[v.city, v.branch].filter(Boolean).join(' / ')}` : ''}
          </div>
        </button>
      ),
    },
    {
      key: 'model',
      header: 'النوع والموديل',
      sortValue: (v) => `${v.make} ${v.model}`,
      render: (v) => {
        const src = v.sourceType || (v.ownershipType === 'leased' ? 'leased' : 'owned');
        return (
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              {v.make} {v.model} {v.year || ''}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {v.vehicleType} · {VEHICLE_SOURCE_LABELS[src]}
              {v.ownerOrLeasingCompany ? ` (${v.ownerOrLeasingCompany})` : ''}
            </div>
          </div>
        );
      },
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
      key: 'readiness',
      header: 'الجاهزية والوثائق',
      render: (v) => {
        const avail = availabilityByVehicleId.get(v.vehicleInternalId);
        const isReady = avail ? avail.readyToDispatch : v.readyToDispatch ?? v.status === 'available';
        const reasons = avail?.blockingReasons || v.blockingReasons || [];
        return (
          <div className="space-y-1">
            <StatusBadge
              label={isReady ? 'جاهزة للتشغيل' : 'مقيدة'}
              tone={isReady ? 'success' : 'warning'}
            />
            {reasons.length > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400 truncate max-w-[190px]" title={reasons.join(' · ')}>
                {reasons[0]}
              </div>
            )}

      {subTab === 'fleet_reports' && canViewReports && (
        <FleetReportsTab
          vehicles={vehicles}
          availability={availability}
          custodies={custodies}
          handovers={handovers}
          returns={returns}
          maintenance={maintenance}
          damageClaims={damageClaims}
          vehicleDocuments={vehicleDocuments}
          fleetExpiries={fleetExpiries}
          riders={riders}
          branding={companyBranding}
          currentUser={currentUser}
          canExport={canExportReports}
        />
      )}

      {subTab === 'fleet_settings' && (
        <FleetSettingsTab
          fleetConfig={fleetConfig || DEFAULT_FLEET_CONFIG}
          canManage={canManageFleetSettings}
          onSaved={onRefresh}
        />
      )}
          </div>
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
      render: (v) => <StatusBadge label={VEHICLE_STATUS_LABELS[v.status] || v.status} tone={vehicleStatusTone(v.status)} />,
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
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void openVehicle360(v.vehicleInternalId)}>
            360°
          </Button>
          {canEdit && (
            <>
              <Button size="sm" variant="secondary" onClick={() => openEditVehicle(v)}>
                تعديل
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openStatusDrawer(v)}>
                الحالة
              </Button>
            </>
          )}
          {canCreateHandover && v.status === 'available' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => openEnterpriseHandoverDrawer({ vehicle: v })}
            >
              تسليم عهدة
            </Button>
          )}
          {canRequestAssignment && availabilityByVehicleId.get(v.vehicleInternalId)?.readyToDispatch && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openAssignmentRequestDrawer(v.vehicleInternalId)}
            >
              طلب ربط
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

  const pendingApprovalsCount = approvals.filter((a) =>
    ['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(a.status)
  ).length;
  const activeCustodiesList = useMemo(
    () => custodies.filter((c) => c.status === 'active' || c.status === 'pending_return'),
    [custodies]
  );
  const pendingReturnsList = useMemo(
    () => returns.filter((r) => r.status === 'pending_inspection' || r.status === 'pending_approval'),
    [returns]
  );
  const openClaimsCount = damageClaims.filter((c) => c.status !== 'closed' && c.status !== 'settled').length;

  const TABS: TabItem<FleetSubTab>[] = [
    { key: 'fleet_dashboard', label: 'لوحة الأسطول', icon: <Car className="h-3.5 w-3.5" /> },
    { key: 'fleet_vehicles', label: 'سجل السيارات', count: vehicles.length, icon: <Car className="h-3.5 w-3.5" /> },
    { key: 'fleet_assignments', label: 'الربط والتفويضات', count: activeCustodiesList.length, icon: <Link2 className="h-3.5 w-3.5" /> },
    { key: 'fleet_approvals', label: 'مركز الاعتمادات', count: pendingApprovalsCount, icon: <FileCheck2 className="h-3.5 w-3.5" /> },
    { key: 'fleet_handover', label: 'التسليم والاستلام', count: handovers.length || assignments.length, icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
    { key: 'fleet_docs', label: 'وثائق المركبات', count: vehicleDocuments.length || fleetExpiries.length, icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'fleet_maintenance', label: 'الصيانة والأضرار', count: maintenance.length + openClaimsCount, icon: <Wrench className="h-3.5 w-3.5" /> },
    ...(canViewReports
      ? [{ key: 'fleet_reports' as FleetSubTab, label: 'التقارير والطباعة', icon: <FileSpreadsheet className="h-3.5 w-3.5" /> }]
      : []),
    { key: 'fleet_settings', label: 'إعدادات الأسطول', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  ];

  // Dedicated Full-Page Multi-Section Form for Adding / Editing a Vehicle
  if (vehModalOpen) {
    const nextVehId = generateNextVehicleId(vehicles);
    const branchSuggestions = Array.from(
      new Set([...(settings.configuredBranches || []), ...vehicles.map((v) => v.branch || '').filter(Boolean)])
    );
    const citySuggestions = Array.from(
      new Set([
        ...riders.map((r) => r.city || '').filter(Boolean),
        ...vehicles.map((v) => v.city || '').filter(Boolean),
      ])
    );

    return (
      <div className="space-y-6">
        <datalist id="fleet-branches-list">
          {branchSuggestions.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <datalist id="fleet-cities-list">
          {citySuggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

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
              توثيق مواصفات المركبة والملكية والفرع والمدينة والاستمارة والتأمين والفحص الدوري عبر المعاملات الآمنة.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setVehModalOpen(false)}>
              إلغاء
            </Button>
            {editingVeh && canEdit && (
              <Button
                variant="secondary"
                onClick={() => {
                  setVehModalOpen(false);
                  openStatusDrawer(editingVeh);
                }}
              >
                تغيير الحالة التشغيلية
              </Button>
            )}
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
              subtitle="رقم اللوحة، الفئة، الطراز والوقود والعداد الحالي"
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
              <FormField label="نوع الوقود">
                <Select
                  value={vehForm.fuelType}
                  onChange={(e) => setVehForm({ ...vehForm, fuelType: e.target.value as VehicleFuelType })}
                >
                  {(Object.keys(FUEL_TYPE_LABELS) as VehicleFuelType[]).map((ft) => (
                    <option key={ft} value={ft}>
                      {FUEL_TYPE_LABELS[ft]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="قراءة العداد الحالية (كم)">
                <Input
                  type="number"
                  min={0}
                  className="font-mono-num"
                  value={vehForm.currentOdometer}
                  onChange={(e) => setVehForm({ ...vehForm, currentOdometer: e.target.value })}
                  placeholder="0"
                />
              </FormField>
              {editingVeh ? (
                <FormField label="الحالة التشغيلية الحالية (يتم تعديلها من مسار تغيير الحالة)">
                  <div className="flex h-10 items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3">
                    <StatusBadge
                      label={VEHICLE_STATUS_LABELS[vehForm.status] || vehForm.status}
                      tone={vehicleStatusTone(vehForm.status)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setVehModalOpen(false);
                        openStatusDrawer(editingVeh);
                      }}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      تغيير
                    </button>
                  </div>
                </FormField>
              ) : (
                <FormField label="الحالة الأولية للمركبة">
                  <Select
                    value={vehForm.status}
                    onChange={(e) => setVehForm({ ...vehForm, status: e.target.value as VehicleStatus })}
                  >
                    <option value="available">{VEHICLE_STATUS_LABELS.available}</option>
                    <option value="maintenance">{VEHICLE_STATUS_LABELS.maintenance}</option>
                    <option value="stopped">{VEHICLE_STATUS_LABELS.stopped}</option>
                  </Select>
                </FormField>
              )}
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="2. الملكية والنطاق الجغرافي والتعريف الفني"
              subtitle="مصدر المركبة، الفرع والمدينة، ورقم الهيكل"
              className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="مصدر / ملكية المركبة">
                <Select
                  value={vehForm.sourceType}
                  onChange={(e) => {
                    const src = e.target.value as VehicleSourceType;
                    setVehForm({
                      ...vehForm,
                      sourceType: src,
                      ownershipType: src === 'leased' ? 'leased' : 'owned',
                    });
                  }}
                >
                  <option value="owned">ملك الشركة</option>
                  <option value="leased">مستأجرة / عقد تشغيل</option>
                  <option value="other">أخرى</option>
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
              <FormField label="الفرع التشغيلي">
                <Input
                  type="text"
                  list="fleet-branches-list"
                  value={vehForm.branch}
                  onChange={(e) => setVehForm({ ...vehForm, branch: e.target.value })}
                  placeholder="مثال: فرع الرياض الرئيسي"
                />
              </FormField>
              <FormField label="المدينة">
                <Input
                  type="text"
                  list="fleet-cities-list"
                  value={vehForm.city}
                  onChange={(e) => setVehForm({ ...vehForm, city: e.target.value })}
                  placeholder="مثال: الرياض / جدة"
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
        title="مركز إدارة الأسطول والمركبات"
        subtitle="الاعتمادات ثنائية المرحلة · التفويضات · محاضر التسليم والاستلام بالفحص والصور · أوامر الصيانة والأضرار"
        actions={
          <>
            {canRequestAssignment && (
              <Button
                variant="secondary"
                icon={<Link2 className="h-3.5 w-3.5" />}
                onClick={() => openAssignmentRequestDrawer()}
              >
                طلب ربط وتفويض
              </Button>
            )}
            {canCreateHandover && (
              <Button
                variant="secondary"
                icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                onClick={() => openEnterpriseHandoverDrawer()}
              >
                تسليم عهدة
              </Button>
            )}
            {canCreateMaint && (
              <Button
                variant="secondary"
                icon={<Wrench className="h-3.5 w-3.5" />}
                onClick={() => {
                  setMaintCustomValues({});
                  setMaintCustomErrors({});
                  setMaintInvoiceFile(null);
                  setMaintForm({
                    vehicleInternalId: vehicles[0]?.vehicleInternalId || '',
                    maintenanceType: 'صيانة دورية',
                    maintenanceDate: new Date().toISOString().slice(0, 10),
                    estimatedCost: '',
                    odometer: vehicles[0]?.currentOdometer ? String(vehicles[0].currentOdometer) : '',
                    workshop: '',
                    details: '',
                    nextMaintenanceDate: '',
                    nextMaintenanceOdometer: '',
                    stopVehicle: false,
                    requireCostApproval: false,
                  });
                  setMaintModalOpen(true);
                }}
              >
                فتح أمر صيانة
              </Button>
            )}
            {(canAddDocs || canEdit) && (
              <Button
                variant="secondary"
                icon={<FileText className="h-3.5 w-3.5" />}
                onClick={() => {
                  setStructuredDocFile(null);
                  setStructuredDocForm({
                    vehicleDocId: '',
                    vehicleInternalId: vehicles[0]?.vehicleInternalId || '',
                    docCategory: 'istimara',
                    titleAr: '',
                    documentNumber: '',
                    issuerName: '',
                    issueDate: '',
                    expiryDate: '',
                    notes: '',
                  });
                  setStructuredDocOpen(true);
                }}
              >
                توثيق / تجديد وثيقة
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
        <FleetDashboardAnalytics
          vehicles={vehicles}
          availability={availability}
          approvals={approvals}
          handovers={handovers}
          returns={returns}
          maintenance={maintenance}
          damageClaims={damageClaims}
          vehicleDocuments={vehicleDocuments}
          notifications={notifications}
          movementHistory={movementHistory}
          statusHistory={statusHistory}
          fleetExpiries={fleetExpiries}
          fleetConfig={fleetConfig}
          currentUser={currentUser}
          onNavigateTab={(tab) => setSubTab(tab)}
          onFilterVehicles={(st, rd) => {
            setStatusFilter(st);
            setReadinessFilter(rd);
          }}
          onOpenVehicle360={(vehId) => void openVehicle360(vehId)}
          onNotificationsUpdated={onNotificationsUpdated}
        />
      )}

      {subTab === 'fleet_vehicles' && (
        <div className="space-y-4">
          <Card padding="sm">
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-600 dark:text-slate-300 ml-1">حالة المركبة:</span>
                <Button
                  size="sm"
                  variant={statusFilter === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setStatusFilter('all')}
                >
                  الكل ({vehicles.length})
                </Button>
                {PRIMARY_VEHICLE_STATUSES.map((st) => (
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
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-600 dark:text-slate-300 ml-1">جاهزية التشغيل والتسليم:</span>
                <Button
                  size="sm"
                  variant={readinessFilter === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setReadinessFilter('all')}
                >
                  الجميع
                </Button>
                <Button
                  size="sm"
                  variant={readinessFilter === 'ready' ? 'primary' : 'secondary'}
                  onClick={() => setReadinessFilter('ready')}
                >
                  جاهزة للتسليم ({fleetKpis.readyToDispatch})
                </Button>
                <Button
                  size="sm"
                  variant={readinessFilter === 'blocked' ? 'primary' : 'secondary'}
                  onClick={() => setReadinessFilter('blocked')}
                >
                  مقيدة تشغيليًا ({fleetKpis.blocked})
                </Button>
              </div>
            </div>
          </Card>

          <SavedViewsBar
            scope="fleet_vehicles"
            user={currentUser}
            allowedUids={allowedUids}
            savedViews={savedViews}
            currentFilters={{ statusFilter, readinessFilter }}
            onApplyView={(f) => {
              if (typeof f.statusFilter === 'string') setStatusFilter(f.statusFilter as 'all' | VehicleStatus);
              if (typeof f.readinessFilter === 'string') setReadinessFilter(f.readinessFilter as 'all' | 'ready' | 'blocked');
            }}
            onChanged={onRefresh}
          />

          <DataTable
            tableId="fleet_vehicles"
            rows={filteredVehicles}
            columns={vehicleCols}
            rowKey={(v) => v.vehicleInternalId}
            searchPlaceholder="ابحث برقم اللوحة، الموديل، الفرع، المدينة، المعرّف، أو الشركة المؤجرة..."
            searchText={(v) =>
              `${v.plateNumber} ${v.vehicleInternalId} ${v.make} ${v.model} ${v.vin || ''} ${v.branch || ''} ${v.city || ''} ${v.ownerOrLeasingCompany || ''} ${v.currentRiderId || ''} ${Object.values(v.customFields || {}).join(' ')}`
            }
          />
        </div>
      )}

      {subTab === 'fleet_assignments' && (
        <div className="space-y-5">
          <Card>
            <SectionHeader
              title={`العهد النشطة حاليًا (${activeCustodiesList.length})`}
              subtitle="الربط الرسمي الفعال بين المركبات والمناديب مع إمكانية النقل الذري للعهدة أو فتح محضر استلام"
              actions={
                canRequestAssignment && (
                  <Button size="sm" variant="primary" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => openAssignmentRequestDrawer()}>
                    طلب ربط وتفويض جديد
                  </Button>
                )
              }
              className="mb-3"
            />
            <DataTable
              tableId="fleet_active_custodies"
              rows={activeCustodiesList}
              rowKey={(c) => c.custodyId}
              searchPlaceholder="ابحث برقم العهدة، رقم اللوحة، أو اسم المندوب..."
              searchText={(c) => `${c.custodyNumber} ${c.plateNumber} ${c.riderName} ${c.riderId}`}
              columns={[
                {
                  key: 'custodyNo',
                  header: 'رقم العهدة والمركبة',
                  sortValue: (c) => c.custodyNumber,
                  render: (c) => (
                    <button type="button" onClick={() => void openVehicle360(c.vehicleInternalId)} className="text-right group">
                      <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600">
                        {c.plateNumber} · {c.custodyNumber}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {c.vehicleInternalId} {c.branch ? `· ${c.branch}` : ''}
                      </div>
                    </button>
                  ),
                },
                {
                  key: 'rider',
                  header: 'المندوب المستلم',
                  sortValue: (c) => c.riderName,
                  render: (c) => (
                    <button type="button" onClick={() => onOpenRider360(c.riderId)} className="text-right hover:underline">
                      <div className="font-semibold text-blue-700 dark:text-blue-400">{c.riderName}</div>
                      <div className="font-mono-num text-[11px] text-slate-500">{c.riderId}</div>
                    </button>
                  ),
                },
                {
                  key: 'start',
                  header: 'بداية العهدة والعداد',
                  sortValue: (c) => c.startedAt,
                  render: (c) => (
                    <div className="font-mono-num text-xs">
                      <div>{c.startedAt}</div>
                      <div className="text-slate-500">عداد البدء: {c.startOdometer ?? '—'} كم</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'حالة العهدة',
                  render: (c) => (
                    <StatusBadge
                      label={c.status === 'pending_return' ? 'قيد فحص الاستلام' : 'عهدة نشطة'}
                      tone={c.status === 'pending_return' ? 'warning' : 'success'}
                    />
                  ),
                },
                {
                  key: 'actions',
                  header: 'عمليات العهدة',
                  render: (c) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.status === 'active' && canCreateHandover && canCreateReturn && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Repeat className="h-3.5 w-3.5" />}
                          onClick={() => {
                            const eligibleTarget =
                              riders.find((r) => r.internalRiderId !== c.riderId && !['terminated', 'inactive', 'suspended'].includes(r.status)) ||
                              riders[0];
                            setTransferTarget(c);
                            setTransferForm({
                              toRiderId: eligibleTarget?.internalRiderId || '',
                              transferDate: new Date().toISOString().slice(0, 10),
                              odometer: c.startOdometer !== null ? String(c.startOdometer) : '',
                              fuelLevel: c.fuelLevelStart || 'متوسط 2/4',
                              condition: 'نقل عهدة مباشر بين مندوبين',
                              notes: '',
                            });
                          }}
                        >
                          نقل العهدة
                        </Button>
                      )}
                      {canCreateReturn && (
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() =>
                            openEnterpriseReturnDrawer({
                              vehicleInternalId: c.vehicleInternalId,
                              plateNumber: c.plateNumber,
                              custodyId: c.custodyId,
                              riderId: c.riderId,
                              riderName: c.riderName,
                              startOdometer: c.startOdometer,
                            })
                          }
                        >
                          استلام وإرجاع
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader
              title={`المركبات المحجوزة وطلبات الربط والتفويض المفتوحة (${approvals.filter((a) => ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(a.requestType)).length})`}
              actions={
                <Button size="sm" variant="ghost" onClick={() => setSubTab('fleet_approvals')}>
                  فتح مركز الاعتمادات الكامل
                </Button>
              }
              className="mb-3"
            />
            <DataTable
              tableId="fleet_assignment_requests"
              rows={approvals.filter((a) => ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(a.requestType))}
              rowKey={(a) => a.requestId}
              searchPlaceholder="ابحث برقم الطلب، اللوحة، المندوب، أو رقم التفويض..."
              searchText={(a) => `${a.requestNumber} ${a.plateNumber} ${a.riderName || ''} ${a.delegationNumber || ''}`}
              columns={[
                {
                  key: 'req',
                  header: 'الطلب والنوع',
                  sortValue: (a) => a.requestNumber,
                  render: (a) => (
                    <div>
                      <div className="font-mono-num font-bold text-xs">{a.requestNumber}</div>
                      <div className="text-[11px] text-slate-500">{APPROVAL_TYPE_LABELS[a.requestType] || a.requestType}</div>
                    </div>
                  ),
                },
                {
                  key: 'veh',
                  header: 'المركبة والمندوب',
                  render: (a) => (
                    <div className="text-xs">
                      <div className="font-mono-num font-bold">{a.plateNumber}</div>
                      <div className="text-slate-600 dark:text-slate-300">{a.riderName || a.riderId || '—'}</div>
                    </div>
                  ),
                },
                {
                  key: 'del',
                  header: 'بيانات التفويض',
                  render: (a) =>
                    a.delegationNumber ? (
                      <div className="font-mono-num text-xs">
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400">#{a.delegationNumber}</div>
                        <div className="text-[11px] text-slate-500">ينتهي: {a.delegationExpiryDate || '—'}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">غير مرفق بعد</span>
                    ),
                },
                {
                  key: 'status',
                  header: 'المرحلة',
                  render: (a) => <StatusBadge label={APPROVAL_STATUS_LABELS[a.status] || a.status} tone={approvalStatusTone(a.status)} />,
                },
                {
                  key: 'act',
                  header: 'الإجراء التالي',
                  render: (a) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {a.status === 'approved' && canCreateHandover && (
                        <Button size="sm" variant="primary" onClick={() => openEnterpriseHandoverDrawer({ approval: a })}>
                          تنفيذ التسليم
                        </Button>
                      )}
                      {(a.status === 'pending_delegation' || (a.status === 'approved' && !a.delegationNumber)) && (canAddDocs || canRequestAssignment || canEdit) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setDelegationTarget(a);
                            setDelegationFile(null);
                            setDelegationForm({
                              delegationNumber: a.delegationNumber || '',
                              delegationStartDate: a.delegationStartDate || new Date().toISOString().slice(0, 10),
                              delegationExpiryDate: a.delegationExpiryDate || '',
                              issuerName: 'إدارة المرور / منصة تم',
                              notes: '',
                            });
                          }}
                        >
                          إرفاق تفويض
                        </Button>
                      )}
                      {(a.status === 'pending_operations' || a.status === 'pending_admin') && (
                        <Button size="sm" variant="secondary" onClick={() => setSubTab('fleet_approvals')}>
                          اعتماد في المركز
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      )}

      {subTab === 'fleet_approvals' && (
        <div className="space-y-4">
          <Card padding="sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300 ml-1">تصفية الاعتمادات:</span>
              {[
                { key: 'all', label: `الكل (${approvals.length})` },
                { key: 'pending_operations', label: `بانتظار التشغيل (${approvals.filter((a) => a.status === 'pending_operations').length})` },
                { key: 'pending_admin', label: `بانتظار الإدارة (${approvals.filter((a) => a.status === 'pending_admin').length})` },
                { key: 'pending_delegation', label: `بانتظار التفويض (${approvals.filter((a) => a.status === 'pending_delegation').length})` },
                { key: 'approved', label: `معتمد للتنفيذ (${approvals.filter((a) => a.status === 'approved').length})` },
                { key: 'completed', label: `منفّذ (${approvals.filter((a) => a.status === 'completed').length})` },
                { key: 'rejected', label: `مرفوض (${approvals.filter((a) => a.status === 'rejected').length})` },
              ].map((pill) => (
                <Button
                  key={pill.key}
                  size="sm"
                  variant={approvalFilter === pill.key ? 'primary' : 'secondary'}
                  onClick={() => setApprovalFilter(pill.key as typeof approvalFilter)}
                >
                  {pill.label}
                </Button>
              ))}
            </div>
          </Card>

          <DataTable
            tableId="fleet_approvals_center"
            rows={approvalFilter === 'all' ? approvals : approvals.filter((a) => a.status === approvalFilter)}
            rowKey={(a) => a.requestId}
            searchPlaceholder="ابحث برقم المعاملة، المركبة، المندوب، أو مقدم الطلب..."
            searchText={(a) => `${a.requestNumber} ${a.plateNumber} ${a.riderName || ''} ${a.requestedByEmail} ${a.requestReason || ''}`}
            columns={[
              {
                key: 'num',
                header: 'المعاملة والتاريخ',
                sortValue: (a) => a.requestedAt,
                render: (a) => (
                  <div>
                    <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{a.requestNumber}</div>
                    <div className="text-[11px] text-slate-500">{APPROVAL_TYPE_LABELS[a.requestType] || a.requestType}</div>
                    <div className="text-[10px] text-slate-400 font-mono-num">{a.requestedAt.slice(0, 16).replace('T', ' ')}</div>
                  </div>
                ),
              },
              {
                key: 'target',
                header: 'المركبة والمستفيد',
                render: (a) => (
                  <div className="text-xs">
                    <div className="font-mono-num font-bold">{a.plateNumber}</div>
                    <div className="text-slate-600 dark:text-slate-300">{a.riderName || '—'}</div>
                    {a.estimatedAmount ? (
                      <div className="font-mono-num text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                        مبلغ: {a.estimatedAmount.toLocaleString('en-US')} ر.س
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'trail',
                header: 'سلسلة الاعتماد (ثنائية المرحلة)',
                render: (a) => (
                  <div className="text-[11px] space-y-0.5">
                    <div>
                      <span className="text-slate-500">1. الطلب:</span> {a.requestedByEmail}
                    </div>
                    <div>
                      <span className="text-slate-500">2. التشغيل:</span>{' '}
                      {a.operationsByEmail
                        ? `${a.operationsDecision === 'approved' ? 'موافقة' : 'رفض'} (${a.operationsByEmail})`
                        : 'بانتظار المراجعة'}
                    </div>
                    <div>
                      <span className="text-slate-500">3. الإدارة:</span>{' '}
                      {a.adminByEmail
                        ? `${a.adminDecision === 'approved' ? 'موافقة' : 'رفض'} (${a.adminByEmail})`
                        : 'بانتظار الاعتماد'}
                    </div>
                    {a.delegationNumber && (
                      <div className="text-emerald-700 dark:text-emerald-400 font-mono-num">
                        4. التفويض: #{a.delegationNumber} ({a.delegationExpiryDate})
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'الحالة الحالية',
                sortValue: (a) => a.status,
                render: (a) => <StatusBadge label={APPROVAL_STATUS_LABELS[a.status] || a.status} tone={approvalStatusTone(a.status)} />,
              },
              {
                key: 'actions',
                header: 'القرار والتنفيذ',
                render: (a) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.status === 'pending_operations' && canOpsApprove && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setApprovalDecisionTarget({ approval: a, stage: 'operations' });
                          setApprovalDecisionForm({ decision: 'approved', note: '' });
                        }}
                      >
                        قرار التشغيل
                      </Button>
                    )}
                    {a.status === 'pending_admin' && canAdminApprove && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setApprovalDecisionTarget({ approval: a, stage: 'admin' });
                          setApprovalDecisionForm({ decision: 'approved', note: '' });
                        }}
                      >
                        قرار الإدارة
                      </Button>
                    )}
                    {a.status === 'pending_delegation' && (canAddDocs || canRequestAssignment || canEdit) && (
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => {
                          setDelegationTarget(a);
                          setDelegationFile(null);
                          setDelegationForm({
                            delegationNumber: a.delegationNumber || '',
                            delegationStartDate: a.delegationStartDate || new Date().toISOString().slice(0, 10),
                            delegationExpiryDate: a.delegationExpiryDate || '',
                            issuerName: 'إدارة المرور / منصة تم',
                            notes: '',
                          });
                        }}
                      >
                        إرفاق التفويض
                      </Button>
                    )}
                    {a.status === 'approved' &&
                      ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(a.requestType) &&
                      canCreateHandover && (
                        <Button size="sm" variant="primary" onClick={() => openEnterpriseHandoverDrawer({ approval: a })}>
                          تسليم فعلي
                        </Button>
                      )}
                    {['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(a.status) &&
                      (a.requestedByUid === currentUser.uid || canAdminApprove || canEdit) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleCancelApprovalRequest(a)}
                        >
                          إلغاء
                        </Button>
                      )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {subTab === 'fleet_handover' && (
        <div className="space-y-5">
          {pendingReturnsList.length > 0 && (
            <Card>
              <SectionHeader
                title={`محاضر استلام بانتظار الاعتماد النهائي (${pendingReturnsList.length})`}
                subtitle="فحوصات إرجاع مسجلة تشغيليًا وتحتاج اعتماد مشرف الأسطول لإغلاق العهدة"
                className="mb-3"
              />
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {pendingReturnsList.map((ret) => (
                  <div key={ret.returnId} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                        {ret.returnNumber} · {ret.plateNumber} — {ret.riderName}
                      </div>
                      <div className="text-slate-500">
                        تاريخ الفحص: {ret.returnDate} · العداد: {ret.odometerAtReturn ?? '—'} كم · الحالة المقترحة:{' '}
                        {VEHICLE_STATUS_LABELS[ret.recommendedNextStatus]}
                        {ret.damageDetected ? ` · رصد ضرر: ${ret.damageSummary}` : ''}
                      </div>
                    </div>
                    {canApproveReturn && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setPendingReturnTarget(ret);
                          setPendingReturnForm({
                            nextVehicleStatus: ret.recommendedNextStatus || 'available',
                            note: '',
                          });
                        }}
                      >
                        اعتماد وإغلاق العهدة
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionHeader
              title={`سجل محاضر التسليم الرسمية (${handovers.length})`}
              actions={
                canCreateHandover && (
                  <Button size="sm" variant="primary" icon={<ClipboardCheck className="h-3.5 w-3.5" />} onClick={() => openEnterpriseHandoverDrawer()}>
                    إنشاء محضر تسليم جديد
                  </Button>
                )
              }
              className="mb-3"
            />
            <DataTable
              tableId="fleet_handovers_structured"
              rows={handovers}
              rowKey={(h) => h.handoverId}
              searchPlaceholder="ابحث برقم المحضر، اللوحة، أو المندوب..."
              searchText={(h) => `${h.handoverNumber} ${h.plateNumber} ${h.riderName} ${h.riderId}`}
              columns={[
                {
                  key: 'num',
                  header: 'رقم المحضر والمركبة',
                  sortValue: (h) => h.handoverNumber,
                  render: (h) => (
                    <div>
                      <div className="font-mono-num font-bold">{h.handoverNumber} · {h.plateNumber}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">{h.handoverDate} {h.handoverTime}</div>
                    </div>
                  ),
                },
                {
                  key: 'rider',
                  header: 'المندوب المستلم',
                  render: (h) => (
                    <button type="button" onClick={() => onOpenRider360(h.riderId)} className="text-right hover:underline">
                      <div className="font-semibold text-blue-700 dark:text-blue-400">{h.riderName}</div>
                      <div className="text-[11px] font-mono-num text-slate-500">{h.riderId}</div>
                    </button>
                  ),
                },
                {
                  key: 'odo',
                  header: 'العداد والوقود',
                  render: (h) => (
                    <div className="font-mono-num text-xs">
                      <div>{h.odometer ?? '—'} كم</div>
                      <div className="text-slate-500">{h.fuelLevel}</div>
                    </div>
                  ),
                },
                {
                  key: 'check',
                  header: 'الفحص والمرفقات',
                  render: (h) => (
                    <div className="text-xs">
                      <div>بنود الفحص: {h.checklist?.length || 0} · ملحقات: {h.accessories?.length || 0}</div>
                      <div className="text-[11px] text-slate-500">صور موثقة: {h.photoSlots?.length || 0} · إقرار المندوب: {h.riderAcknowledged ? 'نعم' : 'لا'}</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  render: (h) => <StatusBadge label={h.status === 'completed' ? 'معتمد ومسلّم' : h.status} tone="success" />,
                },
                {
                  key: 'print',
                  header: 'المحضر الرسمي',
                  render: (h) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Printer className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setProtocolTarget({
                          kind: 'handover',
                          handover: h,
                          vehicle: vehicles.find((v) => v.vehicleInternalId === h.vehicleInternalId),
                          rider: riderById.get(h.riderId),
                        })
                      }
                    >
                      طباعة / صورة
                    </Button>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader title={`سجل محاضر الاستلام والفحص (${returns.length})`} className="mb-3" />
            <DataTable
              tableId="fleet_returns_structured"
              rows={returns}
              rowKey={(r) => r.returnId}
              searchPlaceholder="ابحث برقم محضر الاستلام، اللوحة، أو المندوب..."
              searchText={(r) => `${r.returnNumber} ${r.plateNumber} ${r.riderName} ${r.damageSummary || ''}`}
              columns={[
                {
                  key: 'num',
                  header: 'محضر الاستلام',
                  sortValue: (r) => r.returnNumber,
                  render: (r) => (
                    <div>
                      <div className="font-mono-num font-bold">{r.returnNumber} · {r.plateNumber}</div>
                      <div className="text-[11px] font-mono-num text-slate-500">{r.returnDate} {r.returnTime}</div>
                    </div>
                  ),
                },
                {
                  key: 'rider',
                  header: 'المندوب المُسلِّم',
                  render: (r) => <span className="font-semibold text-xs">{r.riderName}</span>,
                },
                {
                  key: 'odo',
                  header: 'العداد والمسافة المقطوعة',
                  render: (r) => (
                    <div className="font-mono-num text-xs">
                      <div>استلام: {r.odometerAtReturn ?? '—'} كم</div>
                      {r.distanceDriven !== null && r.distanceDriven !== undefined && (
                        <div className="text-emerald-700 dark:text-emerald-400">مقطوعة: {r.distanceDriven.toLocaleString('en-US')} كم</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'dmg',
                  header: 'حالة الأضرار',
                  render: (r) =>
                    r.damageDetected ? (
                      <StatusBadge label="تم رصد أضرار" tone="danger" />
                    ) : (
                      <StatusBadge label="سليمة" tone="success" />
                    ),
                },
                {
                  key: 'status',
                  header: 'الاعتماد',
                  render: (r) => (
                    <StatusBadge
                      label={r.status === 'completed' ? 'مغلق ومعتمد' : 'بانتظار الاعتماد'}
                      tone={r.status === 'completed' ? 'neutral' : 'warning'}
                    />
                  ),
                },
                {
                  key: 'print',
                  header: 'المحضر الرسمي',
                  render: (r) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Printer className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setProtocolTarget({
                          kind: 'return',
                          returnRecord: r,
                          vehicle: vehicles.find((v) => v.vehicleInternalId === r.vehicleInternalId),
                          rider: riderById.get(r.riderId),
                          damageClaim: damageClaims.find((c) => c.returnId === r.returnId),
                        })
                      }
                    >
                      طباعة / صورة
                    </Button>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader title={`سجل العهد الموروثة والمرتبطة (${assignments.length})`} className="mb-3" />
            <DataTable
              tableId="fleet_handover"
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
                  key: 'act',
                  header: 'الإجراء',
                  render: (a) =>
                    a.status === 'active' && canCreateReturn ? (
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() =>
                          openEnterpriseReturnDrawer({
                            vehicleInternalId: a.vehicleInternalId,
                            plateNumber: a.plateNumber,
                            riderId: a.companyRiderId,
                            riderName: a.riderName || a.companyRiderId,
                            startOdometer: a.handoverOdometer,
                          })
                        }
                      >
                        استلام وإرجاع
                      </Button>
                    ) : (
                      <StatusBadge label="مغلقة" tone="neutral" />
                    ),
                },
              ]}
            />
          </Card>
        </div>
      )}

      {subTab === 'fleet_docs' && (
        <div className="space-y-5">
          <Card>
            <SectionHeader
              title={`سجل وثائق المركبات المهيكل والاعتمادات (${vehicleDocuments.length})`}
              subtitle="توثيق الاستمارات والتأمين والفحص الدوري والتفويضات وعقود الإيجار مع اعتمادها وربطها التلقائي بجاهزية المركبة"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {(canAddDocs || canEdit) && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setStructuredDocFile(null);
                        setStructuredDocForm({
                          vehicleDocId: '',
                          vehicleInternalId: vehicles[0]?.vehicleInternalId || '',
                          docCategory: 'istimara',
                          titleAr: '',
                          documentNumber: '',
                          issuerName: '',
                          issueDate: '',
                          expiryDate: '',
                          notes: '',
                        });
                        setStructuredDocOpen(true);
                      }}
                    >
                      تسجيل / تجديد وثيقة
                    </Button>
                  )}
                  {canAddDocs && (
                    <Button
                      size="sm"
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
                      رفع مرفق سريع بالخزينة
                    </Button>
                  )}
                </div>
              }
              className="mb-3"
            />
            <DataTable
              tableId="fleet_structured_docs"
              rows={vehicleDocuments}
              rowKey={(d) => d.vehicleDocId}
              searchPlaceholder="ابحث برقم اللوحة، نوع الوثيقة، أو الرقم..."
              searchText={(d) => `${d.plateNumber} ${d.titleAr} ${d.documentNumber || ''} ${d.issuerName || ''}`}
              columns={[
                {
                  key: 'veh',
                  header: 'المركبة والوثيقة',
                  sortValue: (d) => d.plateNumber,
                  render: (d) => (
                    <div>
                      <div className="font-mono-num font-bold text-xs">{d.plateNumber} — {d.titleAr}</div>
                      <div className="text-[11px] text-slate-500">
                        {DOC_CATEGORY_LABELS[d.docCategory] || d.docCategory}
                        {d.documentNumber ? ` · رقم: ${d.documentNumber}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'dates',
                  header: 'الإصدار والانتهاء',
                  sortValue: (d) => d.expiryDate || '',
                  render: (d) => (
                    <div className="font-mono-num text-xs">
                      <div>الانتهاء: {d.expiryDate || '—'}</div>
                      {d.issuerName && <div className="text-[11px] text-slate-500">{d.issuerName}</div>}
                    </div>
                  ),
                },
                {
                  key: 'app',
                  header: 'حالة الاعتماد',
                  render: (d) => (
                    <StatusBadge
                      label={
                        d.approvalStatus === 'approved'
                          ? 'معتمدة'
                          : d.approvalStatus === 'rejected'
                            ? 'مرفوضة'
                            : 'قيد المراجعة'
                      }
                      tone={complianceTone(d.approvalStatus)}
                    />
                  ),
                },
                {
                  key: 'act',
                  header: 'الإجراءات',
                  render: (d) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(canAddDocs || canEdit) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setStructuredDocFile(null);
                            setStructuredDocForm({
                              vehicleDocId: d.vehicleDocId,
                              vehicleInternalId: d.vehicleInternalId,
                              docCategory: d.docCategory,
                              titleAr: d.titleAr,
                              documentNumber: d.documentNumber || '',
                              issuerName: d.issuerName || '',
                              issueDate: d.issueDate || '',
                              expiryDate: d.expiryDate || '',
                              notes: d.notes || '',
                            });
                            setStructuredDocOpen(true);
                          }}
                        >
                          تجديد/تعديل
                        </Button>
                      )}
                      {canApproveDocs && d.approvalStatus !== 'approved' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleDecideStructuredDoc(d, 'approved')}
                        >
                          اعتماد
                        </Button>
                      )}
                      {canApproveDocs && d.approvalStatus !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejectDocTarget(d);
                            setRejectDocReason('');
                          }}
                        >
                          رفض
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader title={`مرفقات الأسطول في الخزينة الخاصة (${vehicleDocs.length})`} className="mb-3" />
            <DataTable
              tableId="fleet_docs"
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
            tableId="fleet_expiries"
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
        <div className="space-y-5">
          <Card>
            <SectionHeader
              title={`أوامر وسجل الصيانة (${maintenance.length})`}
              actions={
                canCreateMaint && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Wrench className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMaintCustomValues({});
                      setMaintCustomErrors({});
                      setMaintInvoiceFile(null);
                      setMaintForm({
                        vehicleInternalId: vehicles[0]?.vehicleInternalId || '',
                        maintenanceType: 'صيانة دورية / تغيير زيت',
                        maintenanceDate: new Date().toISOString().slice(0, 10),
                        estimatedCost: '',
                        odometer: vehicles[0]?.currentOdometer ? String(vehicles[0].currentOdometer) : '',
                        workshop: '',
                        details: '',
                        nextMaintenanceDate: '',
                        nextMaintenanceOdometer: '',
                        stopVehicle: false,
                        requireCostApproval: false,
                      });
                      setMaintModalOpen(true);
                    }}
                  >
                    فتح أمر صيانة جديد
                  </Button>
                )
              }
              className="mb-3"
            />
            <DataTable
              tableId="fleet_maintenance"
              rows={maintenance}
              rowKey={(m) => m.maintenanceId}
              searchPlaceholder="ابحث برقم أمر الصيانة، اللوحة، نوع الصيانة، أو الورشة..."
              searchText={(m) => `${m.workOrderNumber || ''} ${m.plateNumber} ${m.maintenanceType} ${m.workshop || ''} ${m.details || ''}`}
              columns={[
                {
                  key: 'wo',
                  header: 'أمر الصيانة والمركبة',
                  sortValue: (m) => m.maintenanceDate,
                  render: (m) => (
                    <div>
                      <div className="font-mono-num font-bold text-xs">
                        {m.workOrderNumber || m.maintenanceId.slice(0, 10)} · {m.plateNumber}
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-500">{m.maintenanceDate}</div>
                    </div>
                  ),
                },
                {
                  key: 'type',
                  header: 'نوع الصيانة والورشة',
                  render: (m) => (
                    <div className="text-xs">
                      <div className="font-semibold">{m.maintenanceType}</div>
                      <div className="text-[11px] text-slate-500">{m.workshop || 'غير محدد'}</div>
                    </div>
                  ),
                },
                {
                  key: 'cost',
                  header: 'التكلفة (تقديري / فعلي)',
                  sortValue: (m) => m.actualCost ?? m.cost ?? 0,
                  render: (m) => (
                    <div className="font-mono-num text-xs">
                      <div className="font-bold">{(m.actualCost ?? m.cost ?? 0).toLocaleString('en-US')} ر.س</div>
                      {m.estimatedCost && m.actualCost !== undefined && m.actualCost !== m.estimatedCost && (
                        <div className="text-[11px] text-slate-500">تقديري: {m.estimatedCost.toLocaleString('en-US')} ر.س</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'wf',
                  header: 'حالة العمل',
                  render: (m) => {
                    const wf = m.workflowStatus || 'completed';
                    const tone: BadgeTone =
                      wf === 'completed' ? 'success' : wf === 'cancelled' ? 'danger' : wf === 'awaiting_approval' ? 'warning' : 'info';
                    return <StatusBadge label={MAINTENANCE_WORKFLOW_LABELS[wf] || wf} tone={tone} />;
                  },
                },
                {
                  key: 'act',
                  header: 'الإجراء',
                  render: (m) =>
                    m.workflowStatus !== 'completed' && m.workflowStatus !== 'cancelled' && canApproveMaint ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setCompleteMaintTarget(m);
                          setCompleteMaintInvoiceFile(null);
                          setCompleteMaintForm({
                            actualCost: String(m.estimatedCost ?? m.cost ?? 0),
                            completedOdometer: m.odometer ? String(m.odometer) : '',
                            completedAt: new Date().toISOString().slice(0, 10),
                            releaseVehicleToAvailable: Boolean(m.vehicleWasStopped),
                            details: '',
                          });
                        }}
                      >
                        إغلاق واعتماد
                      </Button>
                    ) : (
                      <span className="font-mono-num text-[11px] text-slate-400">
                        {m.completedAt || m.nextMaintenanceDate || 'مكتمل'}
                      </span>
                    ),
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader
              title={`بلاغات ومطالبات الأضرار والحوادث (${damageClaims.length})`}
              subtitle="تنشأ تلقائيًا عند رصد أضرار أثناء فحص استلام المركبة وتتابع مسؤوليتها وتكلفتها حتى التسوية"
              className="mb-3"
            />
            <DataTable
              tableId="fleet_damage_claims"
              rows={damageClaims}
              rowKey={(c) => c.claimId}
              searchPlaceholder="ابحث برقم البلاغ، اللوحة، المندوب، أو وصف الضرر..."
              searchText={(c) => `${c.claimNumber} ${c.plateNumber} ${c.riderName || ''} ${c.description}`}
              columns={[
                {
                  key: 'clm',
                  header: 'البلاغ والمركبة',
                  sortValue: (c) => c.claimNumber,
                  render: (c) => (
                    <div>
                      <div className="font-mono-num font-bold text-xs">{c.claimNumber} · {c.plateNumber}</div>
                      <div className="text-[11px] text-slate-500">{c.riderName || 'غير محدد'}</div>
                    </div>
                  ),
                },
                {
                  key: 'desc',
                  header: 'الشدة والوصف',
                  render: (c) => (
                    <div className="text-xs space-y-1 max-w-[260px]">
                      <StatusBadge
                        label={DAMAGE_SEVERITY_LABELS[c.severity] || c.severity}
                        tone={c.severity === 'critical' || c.severity === 'major' ? 'danger' : 'warning'}
                      />
                      <div className="text-slate-700 dark:text-slate-300 truncate" title={c.description}>{c.description}</div>
                    </div>
                  ),
                },
                {
                  key: 'liab',
                  header: 'المسؤولية والتكلفة',
                  render: (c) => (
                    <div className="text-xs">
                      <div className="font-semibold">{DAMAGE_LIABILITY_LABELS[c.liability] || c.liability}</div>
                      <div className="font-mono-num text-[11px] text-slate-500">
                        فعلي: {(c.actualRepairCost ?? c.estimatedRepairCost ?? 0).toLocaleString('en-US')} ر.س
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'st',
                  header: 'الحالة',
                  render: (c) => (
                    <StatusBadge
                      label={DAMAGE_STATUS_LABELS[c.status] || c.status}
                      tone={c.status === 'settled' || c.status === 'closed' ? 'success' : 'warning'}
                    />
                  ),
                },
                {
                  key: 'act',
                  header: 'الإجراء',
                  render: (c) =>
                    canApproveMaint ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setClaimTarget(c);
                          setClaimForm({
                            liability: c.liability,
                            status: c.status,
                            actualRepairCost:
                              c.actualRepairCost !== null && c.actualRepairCost !== undefined
                                ? String(c.actualRepairCost)
                                : c.estimatedRepairCost !== null && c.estimatedRepairCost !== undefined
                                  ? String(c.estimatedRepairCost)
                                  : '',
                            notes: c.notes || '',
                          });
                        }}
                      >
                        تحديث / تسوية
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>
      )}

      {/* PHASE 3: REQUEST VEHICLE ASSIGNMENT & DELEGATION DRAWER */}
      <SlideDrawer
        open={assignReqOpen}
        onClose={() => setAssignReqOpen(false)}
        title="رفع طلب ربط وتفويض مركبة"
        subtitle="يحجز المركبة الجاهزة ويرسل الطلب تلقائيًا لسلسلة الاعتماد (التشغيل ← الإدارة ← التفويض)"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignReqOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-assign-request-form" variant="primary" loading={busy}>
              تقديم طلب الربط والحجز
            </Button>
          </>
        }
      >
        <form id="fleet-assign-request-form" onSubmit={(e) => void handleRequestAssignment(e)} className="space-y-4">
          <FormField label="المركبة الجاهزة للربط" required>
            <Select
              required
              value={assignReqForm.vehicleInternalId}
              onChange={(e) => setAssignReqForm({ ...assignReqForm, vehicleInternalId: e.target.value })}
            >
              {vehicles.map((v) => {
                const av = availabilityByVehicleId.get(v.vehicleInternalId);
                return (
                  <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                    {v.plateNumber} — {v.make} {v.model} ({av?.readyToDispatch ? 'جاهزة' : VEHICLE_STATUS_LABELS[v.status]})
                  </option>
                );
              })}
            </Select>
          </FormField>
          <FormField label="المندوب المطلوب تخصيص المركبة له" required>
            <Select
              required
              value={assignReqForm.riderId}
              onChange={(e) => setAssignReqForm({ ...assignReqForm, riderId: e.target.value })}
            >
              {riders.map((r) => (
                <option key={r.internalRiderId} value={r.internalRiderId}>
                  {r.fullName} ({r.internalRiderId}) — {r.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="نوع المعاملة" required>
            <Select
              value={assignReqForm.requestType}
              onChange={(e) => setAssignReqForm({ ...assignReqForm, requestType: e.target.value as FleetApprovalRequestType })}
            >
              <option value="vehicle_assignment">ربط وتخصيص مركبة لمندوب</option>
              <option value="vehicle_delegation">إصدار تفويض قيادة مركبة</option>
            </Select>
          </FormField>
          <FormField label="سبب الطلب / الملاحظات التشغيلية">
            <Textarea
              rows={2}
              value={assignReqForm.requestReason}
              onChange={(e) => setAssignReqForm({ ...assignReqForm, requestReason: e.target.value })}
              placeholder="مثال: تشغيل مشروع هنقرستيشن - منطقة الرياض..."
            />
          </FormField>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3 bg-slate-50/60 dark:bg-slate-900/40">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300">بيانات التفويض المبدئية (اختياري الآن أو بعد الاعتماد الإداري)</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="رقم التفويض">
                <Input
                  type="text"
                  className="font-mono-num"
                  value={assignReqForm.delegationNumber}
                  onChange={(e) => setAssignReqForm({ ...assignReqForm, delegationNumber: e.target.value })}
                />
              </FormField>
              <FormField label="بداية التفويض">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={assignReqForm.delegationStartDate}
                  onChange={(e) => setAssignReqForm({ ...assignReqForm, delegationStartDate: e.target.value })}
                />
              </FormField>
              <FormField label="انتهاء التفويض">
                <Input
                  type="date"
                  className="font-mono-num"
                  value={assignReqForm.delegationExpiryDate}
                  onChange={(e) => setAssignReqForm({ ...assignReqForm, delegationExpiryDate: e.target.value })}
                />
              </FormField>
            </div>
          </div>
        </form>
      </SlideDrawer>

      {/* PHASE 3: OPERATIONS / ADMIN APPROVAL DECISION DRAWER */}
      <SlideDrawer
        open={Boolean(approvalDecisionTarget)}
        onClose={() => setApprovalDecisionTarget(null)}
        title={
          approvalDecisionTarget?.stage === 'operations'
            ? `الاعتماد التشغيلي (${approvalDecisionTarget.approval.requestNumber})`
            : `الاعتماد الإداري النهائي (${approvalDecisionTarget?.approval.requestNumber || ''})`
        }
        subtitle={
          approvalDecisionTarget
            ? `${approvalDecisionTarget.approval.plateNumber} — ${approvalDecisionTarget.approval.riderName || ''}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setApprovalDecisionTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-approval-decision-form" variant="primary" loading={busy}>
              تأكيد القرار
            </Button>
          </>
        }
      >
        <form id="fleet-approval-decision-form" onSubmit={(e) => void handleApprovalDecision(e)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant={approvalDecisionForm.decision === 'approved' ? 'primary' : 'secondary'}
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() => setApprovalDecisionForm({ ...approvalDecisionForm, decision: 'approved' })}
            >
              موافقة واعتماد
            </Button>
            <Button
              type="button"
              variant={approvalDecisionForm.decision === 'rejected' ? 'danger' : 'secondary'}
              icon={<XCircle className="h-4 w-4" />}
              onClick={() => setApprovalDecisionForm({ ...approvalDecisionForm, decision: 'rejected' })}
            >
              رفض الطلب
            </Button>
          </div>
          <FormField
            label="ملاحظات القرار / السبب"
            required={approvalDecisionForm.decision === 'rejected'}
          >
            <Textarea
              rows={3}
              required={approvalDecisionForm.decision === 'rejected'}
              value={approvalDecisionForm.note}
              onChange={(e) => setApprovalDecisionForm({ ...approvalDecisionForm, note: e.target.value })}
              placeholder={approvalDecisionForm.decision === 'rejected' ? 'اكتب سبب الرفض ليُحفظ في سجل التدقيق...' : 'ملاحظات إضافية (اختياري)'}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 3: ATTACH DELEGATION DRAWER */}
      <SlideDrawer
        open={Boolean(delegationTarget)}
        onClose={() => setDelegationTarget(null)}
        title={`توثيق وإرفاق التفويض (${delegationTarget?.requestNumber || ''})`}
        subtitle={delegationTarget ? `${delegationTarget.plateNumber} — ${delegationTarget.riderName || ''}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDelegationTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-delegation-form" variant="primary" loading={busy}>
              حفظ التفويض وتجهيز التسليم
            </Button>
          </>
        }
      >
        <form id="fleet-delegation-form" onSubmit={(e) => void handleAttachDelegation(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="رقم التفويض الرسمي" required>
              <Input
                type="text"
                required
                className="font-mono-num"
                value={delegationForm.delegationNumber}
                onChange={(e) => setDelegationForm({ ...delegationForm, delegationNumber: e.target.value })}
                placeholder="مثال: DEL-987654"
              />
            </FormField>
            <FormField label="جهة الإصدار">
              <Input
                type="text"
                value={delegationForm.issuerName}
                onChange={(e) => setDelegationForm({ ...delegationForm, issuerName: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ بدء التفويض" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={delegationForm.delegationStartDate}
                onChange={(e) => setDelegationForm({ ...delegationForm, delegationStartDate: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ انتهاء التفويض" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={delegationForm.delegationExpiryDate}
                onChange={(e) => setDelegationForm({ ...delegationForm, delegationExpiryDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="نسخة PDF / صورة التفويض (تُرفع للخزينة الخاصة)">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setDelegationFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
            />
          </FormField>
          <FormField label="ملاحظات">
            <Textarea
              rows={2}
              value={delegationForm.notes}
              onChange={(e) => setDelegationForm({ ...delegationForm, notes: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 4: ENTERPRISE HANDOVER DRAWER */}
      <SlideDrawer
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        title="محضر تسليم عهدة مركبة (Enterprise Handover)"
        subtitle={
          handoverForm.approvalRequestId
            ? `مرتبط بطلب الاعتماد المعتمد (${approvals.find((a) => a.requestId === handoverForm.approvalRequestId)?.requestNumber || handoverForm.approvalRequestId})`
            : 'فحص شامل · ملحقات · صور توثيقية · إقرار المندوب'
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHandoverOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-handover-form" variant="primary" loading={busy}>
              اعتماد وتنفيذ محضر التسليم
            </Button>
          </>
        }
      >
        <form id="fleet-handover-form" onSubmit={(e) => void handleHandover(e)} className="space-y-4">
          {approvals.some((a) => a.status === 'approved' && ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(a.requestType)) && (
            <FormField label="ربط بطلب اعتماد جاهز للتنفيذ (اختياري للمشرفين المخوّلين)">
              <Select
                value={handoverForm.approvalRequestId}
                onChange={(e) => {
                  const reqId = e.target.value;
                  const found = approvals.find((a) => a.requestId === reqId);
                  if (found) {
                    const v = vehicles.find((x) => x.vehicleInternalId === found.vehicleInternalId);
                    setHandoverForm({
                      ...handoverForm,
                      approvalRequestId: reqId,
                      vehicleInternalId: found.vehicleInternalId,
                      companyRiderId: found.riderId || handoverForm.companyRiderId,
                      handoverOdometer: v?.currentOdometer !== null && v?.currentOdometer !== undefined ? String(v.currentOdometer) : handoverForm.handoverOdometer,
                      directOverride: false,
                    });
                  } else {
                    setHandoverForm({ ...handoverForm, approvalRequestId: '' });
                  }
                }}
              >
                <option value="">بدون طلب مسبق (تجاوز مباشر للمخولين)</option>
                {approvals
                  .filter((a) => a.status === 'approved' && ['vehicle_assignment', 'vehicle_delegation', 'vehicle_transfer'].includes(a.requestType))
                  .map((a) => (
                    <option key={a.requestId} value={a.requestId}>
                      {a.requestNumber} — {a.plateNumber} ({a.riderName || a.riderId})
                    </option>
                  ))}
              </Select>
            </FormField>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="المركبة" required>
              <Select
                required
                disabled={Boolean(handoverForm.approvalRequestId)}
                value={handoverForm.vehicleInternalId}
                onChange={(e) => {
                  const v = vehicles.find((x) => x.vehicleInternalId === e.target.value);
                  setHandoverForm({
                    ...handoverForm,
                    vehicleInternalId: e.target.value,
                    handoverOdometer: v?.currentOdometer !== null && v?.currentOdometer !== undefined ? String(v.currentOdometer) : handoverForm.handoverOdometer,
                  });
                }}
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
                disabled={Boolean(handoverForm.approvalRequestId)}
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
            <FormField label="قراءة العداد الحالية (كم)" required>
              <Input
                type="number"
                required
                className="font-mono-num"
                value={handoverForm.handoverOdometer}
                onChange={(e) => setHandoverForm({ ...handoverForm, handoverOdometer: e.target.value })}
              />
            </FormField>
            <FormField label="مستوى الوقود عند التسليم">
              <Select
                value={handoverForm.fuelLevel}
                onChange={(e) => setHandoverForm({ ...handoverForm, fuelLevel: e.target.value })}
              >
                <option value="ممتلئ 4/4">ممتلئ 4/4</option>
                <option value="ثلاثة أرباع 3/4">ثلاثة أرباع 3/4</option>
                <option value="متوسط 2/4">متوسط 2/4</option>
                <option value="ربع 1/4">ربع 1/4</option>
                <option value="فارغ / احتياطي">فارغ / احتياطي</option>
              </Select>
            </FormField>
            <FormField label="طريقة توثيق إقرار المندوب">
              <Select
                value={handoverForm.riderAcknowledgmentMethod}
                onChange={(e) =>
                  setHandoverForm({
                    ...handoverForm,
                    riderAcknowledgmentMethod: e.target.value as NonNullable<VehicleHandoverRecord['riderAcknowledgmentMethod']>,
                  })
                }
              >
                <option value="signature">توقيع إلكتروني / مباشر</option>
                <option value="paper_signed">توقيع على محضر ورقي</option>
                <option value="otp">تأكيد برمز تحقق</option>
                <option value="verbal_confirmed">إقرار حضوري موثق</option>
              </Select>
            </FormField>
          </div>

          <FormField label="ملخص الحالة العامة عند التسليم" required>
            <Input
              type="text"
              required
              value={handoverForm.handoverCondition}
              onChange={(e) => setHandoverForm({ ...handoverForm, handoverCondition: e.target.value })}
            />
          </FormField>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">قائمة الفحص الفني عند التسليم</div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {handoverChecklist.map((item, idx) => (
                <div key={item.itemKey} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                  <span>{item.labelAr}</span>
                  <Select
                    value={item.status}
                    onChange={(e) =>
                      setHandoverChecklist((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, status: e.target.value as InspectionCheckItem['status'] } : x))
                      )
                    }
                    className="w-32 py-1 text-xs"
                  >
                    <option value="ok">سليم</option>
                    <option value="issue">ملاحظة</option>
                    <option value="missing">ناقص</option>
                    <option value="na">لا ينطبق</option>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">الملحقات والعهدة المرفقة</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {handoverAccessories.map((acc, idx) => (
                <label key={acc.accessoryKey} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                  <input
                    type="checkbox"
                    checked={acc.present}
                    onChange={(e) =>
                      setHandoverAccessories((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, present: e.target.checked } : x))
                      )
                    }
                  />
                  <span>{acc.labelAr}</span>
                </label>
              ))}
            </div>
          </div>

          <FormField label="صور توثيقية لمحضر التسليم (تُرفع في الخزينة الخاصة)">
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={(e) => setHandoverPhotoFiles(Array.from(e.target.files || []))}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
            />
          </FormField>

          {!handoverForm.approvalRequestId && (canApprove || canAdminApprove) && (
            <label className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={handoverForm.directOverride}
                onChange={(e) => setHandoverForm({ ...handoverForm, directOverride: e.target.checked })}
              />
              <span>تسليم مباشر بصلاحية الإدارة (تخطي مسار الاعتماد المسبق)</span>
            </label>
          )}

          <label className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 p-3 text-xs font-semibold text-blue-900 dark:text-blue-200">
            <input
              type="checkbox"
              required
              checked={handoverForm.riderAcknowledged}
              onChange={(e) => setHandoverForm({ ...handoverForm, riderAcknowledged: e.target.checked })}
            />
            <span>أقرّ المندوب باستلام المركبة ومطابقة العداد والفحص وتحمل كامل مسؤولية العهدة.</span>
          </label>

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

      {/* PHASE 4: ENTERPRISE RETURN INSPECTION DRAWER */}
      <SlideDrawer
        open={Boolean(returnTarget)}
        onClose={() => setReturnTarget(null)}
        title={`محضر استلام وفحص المركبة (${returnTarget?.plateNumber || ''})`}
        subtitle={returnTarget ? `المندوب المُسلِّم: ${returnTarget.riderName} · عداد التسليم: ${returnTarget.startOdometer ?? '—'} كم` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReturnTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-return-form" variant="primary" loading={busy}>
              توثيق محضر الاستلام
            </Button>
          </>
        }
      >
        {returnTarget && (
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
              <FormField label="عداد الاستلام (كم)" required>
                <Input
                  type="number"
                  required
                  className="font-mono-num"
                  value={returnForm.returnOdometer}
                  onChange={(e) => setReturnForm({ ...returnForm, returnOdometer: e.target.value })}
                />
              </FormField>
              {returnTarget.startOdometer !== null && returnForm.returnOdometer && (
                <div className="sm:col-span-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-xs font-mono-num flex items-center justify-between">
                  <span>المسافة المقطوعة خلال هذه العهدة:</span>
                  <span className="font-bold text-blue-700 dark:text-blue-400">
                    {Math.max(0, Number(returnForm.returnOdometer) - returnTarget.startOdometer).toLocaleString('en-US')} كم
                  </span>
                </div>
              )}
              <FormField label="مستوى الوقود عند الاستلام">
                <Select
                  value={returnForm.fuelLevelAtReturn}
                  onChange={(e) => setReturnForm({ ...returnForm, fuelLevelAtReturn: e.target.value })}
                >
                  <option value="ممتلئ 4/4">ممتلئ 4/4</option>
                  <option value="ثلاثة أرباع 3/4">ثلاثة أرباع 3/4</option>
                  <option value="متوسط 2/4">متوسط 2/4</option>
                  <option value="ربع 1/4">ربع 1/4</option>
                  <option value="فارغ / احتياطي">فارغ / احتياطي</option>
                </Select>
              </FormField>
              <FormField label="الحالة المستهدفة للمركبة بعد الإغلاق">
                <Select
                  value={returnForm.recommendedNextStatus}
                  onChange={(e) => setReturnForm({ ...returnForm, recommendedNextStatus: e.target.value as 'available' | 'maintenance' | 'stopped' })}
                >
                  <option value="available">متاحة للتسليم</option>
                  <option value="maintenance">تحويل للصيانة</option>
                  <option value="stopped">إيقاف تشغيلي</option>
                </Select>
              </FormField>
            </div>

            <FormField label="الحالة العامة عند الاستلام" required>
              <Input
                type="text"
                required
                value={returnForm.overallCondition}
                onChange={(e) => setReturnForm({ ...returnForm, overallCondition: e.target.value })}
              />
            </FormField>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="text-xs font-bold">قائمة الفحص الفني عند الإرجاع</div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {returnChecklist.map((item, idx) => (
                  <div key={item.itemKey} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                    <span>{item.labelAr}</span>
                    <Select
                      value={item.status}
                      onChange={(e) =>
                        setReturnChecklist((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, status: e.target.value as InspectionCheckItem['status'] } : x))
                        )
                      }
                      className="w-32 py-1 text-xs"
                    >
                      <option value="ok">سليم</option>
                      <option value="issue">ملاحظة/عطل</option>
                      <option value="missing">مفقود</option>
                      <option value="na">لا ينطبق</option>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="text-xs font-bold">مطابقة الملحقات المسترجعة</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {returnAccessories.map((acc, idx) => (
                  <label key={acc.accessoryKey} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                    <input
                      type="checkbox"
                      checked={acc.present}
                      onChange={(e) =>
                        setReturnAccessories((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, present: e.target.checked } : x))
                        )
                      }
                    />
                    <span>{acc.labelAr}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={returnForm.damageDetected}
                  onChange={(e) =>
                    setReturnForm({
                      ...returnForm,
                      damageDetected: e.target.checked,
                      recommendedNextStatus: e.target.checked ? 'maintenance' : returnForm.recommendedNextStatus,
                    })
                  }
                />
                <span>تم رصد أضرار أو صدمات جديدة تستلزم فتح بلاغ ضرر (CLM) تلقائيًا</span>
              </label>

              {returnForm.damageDetected && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label="درجة الضرر">
                    <Select
                      value={returnForm.damageSeverity}
                      onChange={(e) => setReturnForm({ ...returnForm, damageSeverity: e.target.value as VehicleDamageClaim['severity'] })}
                    >
                      <option value="minor">بسيط</option>
                      <option value="moderate">متوسط</option>
                      <option value="major">جسيم</option>
                      <option value="critical">حرج / شامل</option>
                    </Select>
                  </FormField>
                  <FormField label="المسؤولية المبدئية">
                    <Select
                      value={returnForm.damageLiability}
                      onChange={(e) => setReturnForm({ ...returnForm, damageLiability: e.target.value as VehicleDamageClaim['liability'] })}
                    >
                      <option value="under_review">قيد التحقيق</option>
                      <option value="rider">على المندوب</option>
                      <option value="company">على الشركة</option>
                      <option value="third_party">طرف ثالث</option>
                      <option value="insurance">شركة التأمين</option>
                    </Select>
                  </FormField>
                  <FormField label="التكلفة التقديرية (ر.س)">
                    <Input
                      type="number"
                      step="0.01"
                      className="font-mono-num"
                      value={returnForm.estimatedRepairCost}
                      onChange={(e) => setReturnForm({ ...returnForm, estimatedRepairCost: e.target.value })}
                    />
                  </FormField>
                  <FormField label="وصف الأضرار التفصيلي" required className="sm:col-span-3">
                    <Textarea
                      rows={2}
                      required
                      value={returnForm.damageSummary}
                      onChange={(e) => setReturnForm({ ...returnForm, damageSummary: e.target.value })}
                      placeholder="وصف مكان الضرر وحالة الهيكل أو المحرك..."
                    />
                  </FormField>
                </div>
              )}
            </div>

            <FormField label="صور الفحص والاستلام (اختياري)">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => setReturnPhotoFiles(Array.from(e.target.files || []))}
                className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
              />
            </FormField>

            {canApproveReturn && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={returnForm.finalizeImmediately}
                  onChange={(e) => setReturnForm({ ...returnForm, finalizeImmediately: e.target.checked })}
                />
                <span>إغلاق العهدة نهائيًا فور الحفظ (أو أزل التحديد لإرسالها للمراجعة والاعتماد لاحقًا)</span>
              </label>
            )}
          </form>
        )}
      </SlideDrawer>

      {/* PHASE 4: APPROVE PENDING RETURN DRAWER */}
      <SlideDrawer
        open={Boolean(pendingReturnTarget)}
        onClose={() => setPendingReturnTarget(null)}
        title={`اعتماد وإغلاق محضر الاستلام (${pendingReturnTarget?.returnNumber || ''})`}
        subtitle={pendingReturnTarget ? `${pendingReturnTarget.plateNumber} — ${pendingReturnTarget.riderName}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingReturnTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-approve-return-form" variant="primary" loading={busy}>
              اعتماد وإغلاق العهدة
            </Button>
          </>
        }
      >
        <form id="fleet-approve-return-form" onSubmit={(e) => void handleApprovePendingReturn(e)} className="space-y-4">
          <FormField label="الحالة النهائية للمركبة" required>
            <Select
              value={pendingReturnForm.nextVehicleStatus}
              onChange={(e) =>
                setPendingReturnForm({
                  ...pendingReturnForm,
                  nextVehicleStatus: e.target.value as 'available' | 'maintenance' | 'stopped',
                })
              }
            >
              <option value="available">متاحة للتسليم</option>
              <option value="maintenance">تحويل للصيانة</option>
              <option value="stopped">إيقاف تشغيلي</option>
            </Select>
          </FormField>
          <FormField label="ملاحظة الاعتماد">
            <Textarea
              rows={2}
              value={pendingReturnForm.note}
              onChange={(e) => setPendingReturnForm({ ...pendingReturnForm, note: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 4: ATOMIC CUSTODY TRANSFER DRAWER */}
      <SlideDrawer
        open={Boolean(transferTarget)}
        onClose={() => setTransferTarget(null)}
        title={`نقل عهدة المركبة (${transferTarget?.plateNumber || ''})`}
        subtitle={transferTarget ? `من المندوب الحالي: ${transferTarget.riderName} (${transferTarget.custodyNumber})` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTransferTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-transfer-custody-form" variant="primary" loading={busy}>
              تأكيد نقل العهدة ذريًا
            </Button>
          </>
        }
      >
        <form id="fleet-transfer-custody-form" onSubmit={(e) => void handleTransferCustody(e)} className="space-y-4">
          <FormField label="المندوب المستلم الجديد" required>
            <Select
              required
              value={transferForm.toRiderId}
              onChange={(e) => setTransferForm({ ...transferForm, toRiderId: e.target.value })}
            >
              {riders
                .filter((r) => r.internalRiderId !== transferTarget?.riderId)
                .map((r) => (
                  <option key={r.internalRiderId} value={r.internalRiderId}>
                    {r.fullName} ({r.internalRiderId}) — {r.status}
                  </option>
                ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="تاريخ النقل" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={transferForm.transferDate}
                onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })}
              />
            </FormField>
            <FormField label="قراءة العداد عند النقل (كم)" required>
              <Input
                type="number"
                required
                className="font-mono-num"
                value={transferForm.odometer}
                onChange={(e) => setTransferForm({ ...transferForm, odometer: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="حالة المركبة عند النقل">
            <Input
              type="text"
              value={transferForm.condition}
              onChange={(e) => setTransferForm({ ...transferForm, condition: e.target.value })}
            />
          </FormField>
          <FormField label="ملاحظات النقل">
            <Textarea
              rows={2}
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 5: MAINTENANCE WORK ORDER DRAWER */}
      <SlideDrawer
        open={maintModalOpen}
        onClose={() => setMaintModalOpen(false)}
        title="فتح أمر صيانة مركبة (Work Order)"
        subtitle="إمكانية إيقاف المركبة للصيانة أو رفع طلب اعتماد للتكاليف المقدرة"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMaintModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-maint-form" variant="primary" loading={busy}>
              فتح أمر الصيانة
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
            <FormField label="تاريخ الدخول" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={maintForm.maintenanceDate}
                onChange={(e) => setMaintForm({ ...maintForm, maintenanceDate: e.target.value })}
              />
            </FormField>
            <FormField label="التكلفة التقديرية (ر.س)">
              <Input
                type="number"
                step="0.01"
                className="font-mono-num"
                value={maintForm.estimatedCost}
                onChange={(e) => setMaintForm({ ...maintForm, estimatedCost: e.target.value })}
              />
            </FormField>
            <FormField label="العداد الحالي (كم)">
              <Input
                type="number"
                className="font-mono-num"
                value={maintForm.odometer}
                onChange={(e) => setMaintForm({ ...maintForm, odometer: e.target.value })}
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
            <FormField label="العداد للصيانة القادمة (كم)">
              <Input
                type="number"
                className="font-mono-num"
                value={maintForm.nextMaintenanceOdometer}
                onChange={(e) => setMaintForm({ ...maintForm, nextMaintenanceOdometer: e.target.value })}
              />
            </FormField>
          </div>
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={maintForm.stopVehicle}
                onChange={(e) => setMaintForm({ ...maintForm, stopVehicle: e.target.checked })}
              />
              <span>تحويل حالة المركبة إلى "تحت الصيانة" (للمركبات غير المسلمة حاليًا)</span>
            </label>
            <label className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <input
                type="checkbox"
                checked={maintForm.requireCostApproval}
                onChange={(e) => setMaintForm({ ...maintForm, requireCostApproval: e.target.checked })}
              />
              <span>إرسال التكلفة التقديرية للاعتماد المالي والإداري في مركز الاعتمادات</span>
            </label>
          </div>
          <FormField label="عرض السعر / فاتورة الصيانة المبدئية (اختياري)">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setMaintInvoiceFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
            />
          </FormField>
          <FormField label="التفاصيل الفنية">
            <Textarea
              rows={2}
              value={maintForm.details}
              onChange={(e) => setMaintForm({ ...maintForm, details: e.target.value })}
              placeholder="الأعطال المرصودة والقطع المطلوبة..."
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

      {/* PHASE 5: COMPLETE MAINTENANCE WORK ORDER DRAWER */}
      <SlideDrawer
        open={Boolean(completeMaintTarget)}
        onClose={() => setCompleteMaintTarget(null)}
        title={`إغلاق واعتماد أمر الصيانة (${completeMaintTarget?.workOrderNumber || ''})`}
        subtitle={completeMaintTarget ? `${completeMaintTarget.plateNumber} — ${completeMaintTarget.maintenanceType}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCompleteMaintTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-complete-maint-form" variant="primary" loading={busy}>
              اعتماد الإغلاق وحفظ الفاتورة
            </Button>
          </>
        }
      >
        <form id="fleet-complete-maint-form" onSubmit={(e) => void handleCompleteMaintenance(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="التكلفة الفعلية النهائية (ر.س)" required>
              <Input
                type="number"
                step="0.01"
                required
                className="font-mono-num"
                value={completeMaintForm.actualCost}
                onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, actualCost: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ الإنجاز" required>
              <Input
                type="date"
                required
                className="font-mono-num"
                value={completeMaintForm.completedAt}
                onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, completedAt: e.target.value })}
              />
            </FormField>
            <FormField label="عداد الخروج من الصيانة (كم)" className="sm:col-span-2">
              <Input
                type="number"
                className="font-mono-num"
                value={completeMaintForm.completedOdometer}
                onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, completedOdometer: e.target.value })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <input
              type="checkbox"
              checked={completeMaintForm.releaseVehicleToAvailable}
              onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, releaseVehicleToAvailable: e.target.checked })}
            />
            <span>إعادة المركبة إلى حالة "متاحة للتسليم" فور الإغلاق (إن كانت متوقفة للصيانة)</span>
          </label>
          <FormField label="فاتورة الصيانة النهائية (اختياري)">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setCompleteMaintInvoiceFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
            />
          </FormField>
          <FormField label="ملاحظات الإغلاق">
            <Textarea
              rows={2}
              value={completeMaintForm.details}
              onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, details: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 5: UPDATE / SETTLE DAMAGE CLAIM DRAWER */}
      <SlideDrawer
        open={Boolean(claimTarget)}
        onClose={() => setClaimTarget(null)}
        title={`تحديث وتسوية بلاغ الضرر (${claimTarget?.claimNumber || ''})`}
        subtitle={claimTarget ? `${claimTarget.plateNumber} — ${claimTarget.riderName || ''}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClaimTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-claim-form" variant="primary" loading={busy}>
              حفظ التحديث والتسوية
            </Button>
          </>
        }
      >
        <form id="fleet-claim-form" onSubmit={(e) => void handleUpdateDamageClaim(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="تحديد المسؤولية" required>
              <Select
                value={claimForm.liability}
                onChange={(e) => setClaimForm({ ...claimForm, liability: e.target.value as VehicleDamageClaim['liability'] })}
              >
                <option value="under_review">قيد التحقيق</option>
                <option value="rider">على المندوب</option>
                <option value="company">على الشركة</option>
                <option value="third_party">طرف ثالث</option>
                <option value="insurance">شركة التأمين</option>
              </Select>
            </FormField>
            <FormField label="حالة البلاغ" required>
              <Select
                value={claimForm.status}
                onChange={(e) => setClaimForm({ ...claimForm, status: e.target.value as VehicleDamageClaim['status'] })}
              >
                <option value="open">بلاغ مفتوح</option>
                <option value="awaiting_approval">بانتظار اعتماد التسوية</option>
                <option value="in_repair">تحت الإصلاح</option>
                <option value="settled">تمت التسوية</option>
                <option value="closed">مغلق</option>
              </Select>
            </FormField>
          </div>
          <FormField label="تكلفة الإصلاح الفعلية (ر.س)">
            <Input
              type="number"
              step="0.01"
              className="font-mono-num"
              value={claimForm.actualRepairCost}
              onChange={(e) => setClaimForm({ ...claimForm, actualRepairCost: e.target.value })}
            />
          </FormField>
          <FormField label="ملاحظات التحقيق / التسوية">
            <Textarea
              rows={3}
              value={claimForm.notes}
              onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 5: STRUCTURED VEHICLE DOCUMENT UPSERT DRAWER */}
      <SlideDrawer
        open={structuredDocOpen}
        onClose={() => setStructuredDocOpen(false)}
        title={structuredDocForm.vehicleDocId ? 'تجديد / تعديل وثيقة مركبة مهيكلة' : 'تسجيل وثيقة مركبة مهيكلة'}
        subtitle="تزامن تلقائي مع بيانات المركبة وحساب جاهزية التشغيل والانتهاء"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStructuredDocOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-structured-doc-form" variant="primary" loading={busy}>
              حفظ الوثيقة والمزامنة
            </Button>
          </>
        }
      >
        <form id="fleet-structured-doc-form" onSubmit={(e) => void handleSaveStructuredVehicleDoc(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="المركبة" required>
              <Select
                required
                value={structuredDocForm.vehicleInternalId}
                onChange={(e) => setStructuredDocForm({ ...structuredDocForm, vehicleInternalId: e.target.value })}
              >
                {vehicles.map((v) => (
                  <option key={v.vehicleInternalId} value={v.vehicleInternalId}>
                    {v.plateNumber} — {v.make} {v.model}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="فئة الوثيقة" required>
              <Select
                value={structuredDocForm.docCategory}
                onChange={(e) =>
                  setStructuredDocForm({
                    ...structuredDocForm,
                    docCategory: e.target.value as VehicleDocumentCategory,
                  })
                }
              >
                {(Object.keys(DOC_CATEGORY_LABELS) as VehicleDocumentCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {DOC_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="رقم الوثيقة / البوليصة">
              <Input
                type="text"
                className="font-mono-num"
                value={structuredDocForm.documentNumber}
                onChange={(e) => setStructuredDocForm({ ...structuredDocForm, documentNumber: e.target.value })}
              />
            </FormField>
            <FormField label="جهة الإصدار / شركة التأمين">
              <Input
                type="text"
                value={structuredDocForm.issuerName}
                onChange={(e) => setStructuredDocForm({ ...structuredDocForm, issuerName: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ الإصدار">
              <Input
                type="date"
                className="font-mono-num"
                value={structuredDocForm.issueDate}
                onChange={(e) => setStructuredDocForm({ ...structuredDocForm, issueDate: e.target.value })}
              />
            </FormField>
            <FormField label="تاريخ الانتهاء">
              <Input
                type="date"
                className="font-mono-num"
                value={structuredDocForm.expiryDate}
                onChange={(e) => setStructuredDocForm({ ...structuredDocForm, expiryDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="مرفق الوثيقة (اختياري — PDF أو صورة للخزينة)">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setStructuredDocFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
            />
          </FormField>
          <FormField label="ملاحظات">
            <Textarea
              rows={2}
              value={structuredDocForm.notes}
              onChange={(e) => setStructuredDocForm({ ...structuredDocForm, notes: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* PHASE 5: REJECT DOCUMENT DRAWER */}
      <SlideDrawer
        open={Boolean(rejectDocTarget)}
        onClose={() => setRejectDocTarget(null)}
        title={`رفض وثيقة (${rejectDocTarget?.titleAr || ''})`}
        subtitle={rejectDocTarget ? `المركبة: ${rejectDocTarget.plateNumber}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectDocTarget(null)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (rejectDocTarget && rejectDocReason.trim()) {
                  void handleDecideStructuredDoc(rejectDocTarget, 'rejected', rejectDocReason.trim());
                }
              }}
            >
              تأكيد الرفض
            </Button>
          </>
        }
      >
        <FormField label="سبب رفض الوثيقة" required>
          <Textarea
            rows={3}
            required
            value={rejectDocReason}
            onChange={(e) => setRejectDocReason(e.target.value)}
            placeholder="مثال: الصورة غير واضحة أو تاريخ الانتهاء غير مطابق..."
          />
        </FormField>
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

      {/* CONTROLLED STATUS TRANSITION DRAWER */}
      <SlideDrawer
        open={Boolean(statusTargetVeh)}
        onClose={() => setStatusTargetVeh(null)}
        title={`تغيير الحالة التشغيلية للمركبة (${statusTargetVeh?.plateNumber || ''})`}
        subtitle={
          statusTargetVeh
            ? `الحالة الحالية: ${VEHICLE_STATUS_LABELS[statusTargetVeh.status] || statusTargetVeh.status} · ${statusTargetVeh.vehicleInternalId}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusTargetVeh(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="fleet-status-transition-form" variant="primary" loading={busy}>
              اعتماد تغيير الحالة
            </Button>
          </>
        }
      >
        {statusTargetVeh && (
          <form id="fleet-status-transition-form" onSubmit={(e) => void handleTransitionStatus(e)} className="space-y-4">
            {(statusTargetVeh.status === 'assigned' || statusTargetVeh.status === 'reserved' || Boolean(statusTargetVeh.activeCustodyId)) && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  هذه المركبة مرتبطة بعهدة نشطة أو حجز قيد الاعتماد. يرجى إغلاق العهدة أو محضر الاستلام أولاً قبل تحويلها لحالة أخرى.
                </div>
              </div>
            )}
            <FormField label="الحالة التشغيلية المستهدفة" required>
              <Select
                value={statusTransitionForm.toStatus}
                onChange={(e) =>
                  setStatusTransitionForm({
                    ...statusTransitionForm,
                    toStatus: e.target.value as VehicleStatus,
                  })
                }
              >
                <option value="available">{VEHICLE_STATUS_LABELS.available}</option>
                <option value="maintenance">{VEHICLE_STATUS_LABELS.maintenance}</option>
                <option value="stopped">{VEHICLE_STATUS_LABELS.stopped}</option>
                <option value="retired">{VEHICLE_STATUS_LABELS.retired}</option>
              </Select>
            </FormField>
            <FormField
              label="سبب التغيير / الإيقاف"
              required={statusTransitionForm.toStatus === 'stopped' || statusTransitionForm.toStatus === 'retired'}
            >
              <Textarea
                rows={3}
                required={statusTransitionForm.toStatus === 'stopped' || statusTransitionForm.toStatus === 'retired'}
                value={statusTransitionForm.reason}
                onChange={(e) => setStatusTransitionForm({ ...statusTransitionForm, reason: e.target.value })}
                placeholder="وثّق سبب الإيقاف التشغيلي أو التحويل للصيانة أو التقاعد..."
              />
            </FormField>
          </form>
        )}
      </SlideDrawer>

      {/* VEHICLE 360° PROFILE DRAWER */}
      <SlideDrawer
        open={Boolean(profile360VehId)}
        onClose={() => {
          setProfile360VehId(null);
          setProfile360Data(null);
        }}
        title={
          profile360Data
            ? `ملف المركبة 360° — ${profile360Data.vehicle.plateNumber}`
            : `ملف المركبة 360° (${profile360VehId || ''})`
        }
        subtitle={
          profile360Data
            ? `${profile360Data.vehicle.make} ${profile360Data.vehicle.model} ${profile360Data.vehicle.year || ''} · ${profile360Data.vehicle.vehicleInternalId}`
            : 'جاري تحميل البيانات الشاملة للمركبة...'
        }
        size="xl"
        footer={
          profile360Data && (
            <>
              <Button
                variant="secondary"
                icon={<Printer className="h-3.5 w-3.5" />}
                onClick={() =>
                  setProtocolTarget({
                    kind: 'vehicle_dossier',
                    vehicle: profile360Data.vehicle,
                    rider: profile360Data.currentRider || undefined,
                    totalMaintCost: profile360Data.maintenance.reduce(
                      (s, m) => s + (Number(m.actualCost ?? m.cost) || 0),
                      0
                    ),
                    totalClaimCost: profile360Data.damageClaims.reduce(
                      (s, c) => s + (Number(c.actualRepairCost ?? c.estimatedRepairCost) || 0),
                      0
                    ),
                    custodyCount: profile360Data.custodies.length,
                  })
                }
              >
                ملف المركبة للطباعة والمشاركة
              </Button>
              {canCreateHandover && profile360Data.vehicle.status === 'available' && (
                <Button
                  variant="primary"
                  icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const targetVeh = profile360Data.vehicle;
                    setProfile360VehId(null);
                    openEnterpriseHandoverDrawer({ vehicle: targetVeh });
                  }}
                >
                  تسليم عهدة
                </Button>
              )}
              {canCreateReturn && profile360Data.activeCustody && (
                <Button
                  variant="accent"
                  onClick={() => {
                    const cust = profile360Data.activeCustody!;
                    const targetVeh = profile360Data.vehicle;
                    setProfile360VehId(null);
                    openEnterpriseReturnDrawer({
                      vehicleInternalId: targetVeh.vehicleInternalId,
                      plateNumber: targetVeh.plateNumber,
                      custodyId: cust.custodyId,
                      riderId: cust.riderId,
                      riderName: cust.riderName,
                      startOdometer: cust.startOdometer,
                    });
                  }}
                >
                  استلام وفحص
                </Button>
              )}
              {canEdit && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const target = profile360Data.vehicle;
                      setProfile360VehId(null);
                      openEditVehicle(target);
                    }}
                  >
                    تعديل البيانات
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => openStatusDrawer(profile360Data.vehicle)}
                  >
                    تغيير الحالة
                  </Button>
                </>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  setProfile360VehId(null);
                  setProfile360Data(null);
                }}
              >
                إغلاق
              </Button>
            </>
          )
        }
      >
        {profile360Loading ? (
          <div className="py-12 text-center text-xs text-slate-500">جاري تحميل السجل الكامل للمركبة...</div>
        ) : !profile360Data ? (
          <EmptyState title="تعذر عرض تفاصيل المركبة" subtitle="حاول إعادة التحديث أو تحقق من الصلاحيات." />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <StatusBadge
                  label={VEHICLE_STATUS_LABELS[profile360Data.vehicle.status] || profile360Data.vehicle.status}
                  tone={vehicleStatusTone(profile360Data.vehicle.status)}
                />
                <StatusBadge
                  label={profile360Data.availability.readyToDispatch ? 'جاهزة للتسليم والتشغيل' : 'مقيدة تشغيليًا'}
                  tone={profile360Data.availability.readyToDispatch ? 'success' : 'warning'}
                />
                {profile360Data.vehicle.stopReason && (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    سبب الإيقاف: {profile360Data.vehicle.stopReason}
                  </span>
                )}
              </div>
              <div className="font-mono-num text-xs text-slate-500">
                العداد الحالي: {profile360Data.vehicle.currentOdometer ?? '—'} كم
              </div>
            </div>

            {profile360Data.availability.blockingReasons.length > 0 && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4" />
                  <span>أسباب المنع أو التحذير التشغيلي ({fleetConfig ? 'وفق سياسات الأسطول' : 'التحقق التلقائي'}):</span>
                </div>
                <ul className="list-disc pr-5 space-y-0.5">
                  {profile360Data.availability.blockingReasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 text-xs">
              {[
                { key: 'overview', label: 'البيانات الأساسية' },
                { key: 'custody', label: `العهدة والتسليم (${profile360Data.custodies.length})` },
                { key: 'docs', label: `الوثائق (${profile360Data.vehicleDocuments.length})` },
                { key: 'history', label: `الحركة والصيانة (${profile360Data.movementHistory.length + profile360Data.statusHistory.length})` },
              ].map((t) => (
                <Button
                  key={t.key}
                  size="sm"
                  variant={profile360Tab === t.key ? 'primary' : 'secondary'}
                  onClick={() => setProfile360Tab(t.key as typeof profile360Tab)}
                >
                  {t.label}
                </Button>
              ))}
            </div>

            {profile360Tab === 'overview' && (() => {
              const totalMaintTco = profile360Data.maintenance.reduce(
                (s, m) => s + (Number(m.actualCost ?? m.cost) || 0),
                0
              );
              const totalClaimsTco = profile360Data.damageClaims.reduce(
                (s, c) => s + (Number(c.actualRepairCost ?? c.estimatedRepairCost) || 0),
                0
              );
              const totalDrivenKm = profile360Data.returns.reduce(
                (s, r) => s + (Number(r.distanceDriven) || 0),
                0
              );
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/70">
                      <div className="text-[11px] text-slate-500">تكاليف الصيانة</div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-white mt-0.5">
                        {totalMaintTco.toLocaleString('en-US')} ر.س
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/70">
                      <div className="text-[11px] text-slate-500">تكاليف الأضرار ({profile360Data.damageClaims.length})</div>
                      <div className="font-mono-num font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                        {totalClaimsTco.toLocaleString('en-US')} ر.س
                      </div>
                    </div>
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 p-3 bg-blue-50/70 dark:bg-blue-950/30">
                      <div className="text-[11px] text-blue-700 dark:text-blue-300">إجمالي التكلفة (TCO)</div>
                      <div className="font-mono-num font-bold text-blue-900 dark:text-blue-100 mt-0.5">
                        {(totalMaintTco + totalClaimsTco).toLocaleString('en-US')} ر.س
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/70">
                      <div className="text-[11px] text-slate-500">المسافة الموثقة والعهد</div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-white mt-0.5">
                        {totalDrivenKm.toLocaleString('en-US')} كم · {profile360Data.custodies.length} عهدة
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                    {[
                      ['المعرف الداخلي', profile360Data.vehicle.vehicleInternalId],
                      ['رقم اللوحة', profile360Data.vehicle.plateNumber],
                      ['رقم الهيكل (VIN)', profile360Data.vehicle.vin || '—'],
                      ['النوع والفئة', profile360Data.vehicle.vehicleType],
                      ['الصنع والموديل', `${profile360Data.vehicle.make} ${profile360Data.vehicle.model} (${profile360Data.vehicle.year || '—'})`],
                      ['اللون والوقود', `${profile360Data.vehicle.color || '—'} · ${profile360Data.vehicle.fuelType ? FUEL_TYPE_LABELS[profile360Data.vehicle.fuelType] : '—'}`],
                      ['الملكية / المصدر', `${VEHICLE_SOURCE_LABELS[profile360Data.vehicle.sourceType || (profile360Data.vehicle.ownershipType === 'leased' ? 'leased' : 'owned')]} ${profile360Data.vehicle.ownerOrLeasingCompany ? `(${profile360Data.vehicle.ownerOrLeasingCompany})` : ''}`],
                      ['الفرع / المدينة', [profile360Data.vehicle.branch, profile360Data.vehicle.city].filter(Boolean).join(' / ') || '—'],
                      ['المندوب المستلم حاليًا', profile360Data.currentRider ? `${profile360Data.currentRider.fullName} (${profile360Data.currentRider.internalRiderId})` : 'غير مسلمة'],
                      ['رقم الاستمارة / الانتهاء', `${profile360Data.vehicle.istimaraNumber || '—'} · ${profile360Data.vehicle.istimaraExpiryDate || '—'}`],
                      ['شركة التأمين / الانتهاء', `${profile360Data.vehicle.insuranceCompany || '—'} · ${profile360Data.vehicle.insuranceExpiryDate || '—'}`],
                      ['انتهاء الفحص الدوري', profile360Data.vehicle.periodicInspectionExpiryDate || '—'],
                    ].map(([label, val]) => (
                      <div key={label} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
                        <div className="text-[11px] text-slate-500">{label}</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 font-mono-num">{val}</div>
                      </div>
                    ))}
                    {profile360Data.vehicle.notes && (
                      <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
                        <div className="text-[11px] text-slate-500">ملاحظات المركبة</div>
                        <div className="text-slate-800 dark:text-slate-200 mt-1">{profile360Data.vehicle.notes}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {profile360Tab === 'custody' && (
              <div className="space-y-4">
                {profile360Data.activeCustody ? (
                  <Card>
                    <SectionHeader title="العهدة النشطة الحالية" className="mb-2" />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {profile360Data.activeCustody.riderName} ({profile360Data.activeCustody.riderId})
                        </div>
                        <div className="text-slate-500 font-mono-num">
                          رقم العهدة: {profile360Data.activeCustody.custodyNumber} · تاريخ البدء: {profile360Data.activeCustody.startedAt} · العداد: {profile360Data.activeCustody.startOdometer ?? '—'} كم
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onOpenRider360(profile360Data.activeCustody!.riderId)}
                      >
                        فتح ملف المندوب 360°
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <EmptyState title="لا توجد عهدة نشطة حاليًا" subtitle="المركبة غير مسلمة لمندوب في الوقت الحالي." />
                )}

                {profile360Data.custodies.length > 0 && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    {profile360Data.custodies.map((c) => (
                      <div key={c.custodyId} className="p-3 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold">{c.riderName} ({c.riderId})</div>
                          <div className="text-[11px] text-slate-500 font-mono-num">
                            {c.custodyNumber} · من {c.startedAt} {c.endedAt ? `إلى ${c.endedAt}` : '— مستمرة'}
                          </div>
                        </div>
                        <StatusBadge label={c.status === 'active' ? 'عهدة نشطة' : 'منتهية'} tone={c.status === 'active' ? 'info' : 'neutral'} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {profile360Tab === 'docs' && (
              <div className="space-y-4">
                {profile360Data.vehicleDocuments.length === 0 ? (
                  <EmptyState title="لا توجد سجلات وثائق مهيكلة" subtitle="يمكن إضافة تواريخ الاستمارة والتأمين والفحص من نموذج تعديل المركبة." />
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    {profile360Data.vehicleDocuments.map((d) => {
                      const availDoc = profile360Data.availability.expiringDocs.find((x) => x.category === d.docCategory);
                      const docState = availDoc?.status || (d.expiryDate ? 'valid' : 'missing');
                      return (
                        <div key={d.vehicleDocId} className="p-3 flex items-center justify-between text-xs gap-3">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{d.titleAr}</div>
                            <div className="text-[11px] text-slate-500 font-mono-num">
                              {d.documentNumber ? `رقم: ${d.documentNumber} · ` : ''}انتهاء: {d.expiryDate || 'غير محدد'}
                            </div>
                          </div>
                          <StatusBadge
                            label={DOCUMENT_COMPLIANCE_LABELS[docState] || docState}
                            tone={complianceTone(docState)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {profile360Data.privateDocuments.length > 0 && canViewDocs && (
                  <Card>
                    <SectionHeader title="المرفقات المحفوظة في الخزينة الخاصة" className="mb-2" />
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {profile360Data.privateDocuments.map((pd) => (
                        <div key={pd.docId} className="py-2 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold">{pd.title} ({pd.docTypeName})</div>
                            <div className="text-[11px] text-slate-500 font-mono-num">انتهاء: {pd.expiryDate || '—'}</div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void handleOpenPrivateFile(pd, false)}>
                              معاينة
                            </Button>
                            <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void handleOpenPrivateFile(pd, true)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {profile360Tab === 'history' && (
              <div className="space-y-4">
                <Card>
                  <SectionHeader
                    title="سجل الحركات وتغيرات الحالة غير القابل للتعديل"
                    actions={<History className="h-4 w-4 text-slate-400" />}
                    className="mb-3"
                  />
                  {profile360Data.movementHistory.length === 0 && profile360Data.statusHistory.length === 0 ? (
                    <EmptyState title="لا توجد حركات مسجلة بعد" />
                  ) : (
                    <div className="space-y-2.5 max-h-[340px] overflow-auto pr-1">
                      {profile360Data.movementHistory.map((m) => (
                        <div key={m.movementId} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 text-xs flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{m.summaryAr}</div>
                            <div className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                              بواسطة: {m.actorEmail} {m.odometer !== null && m.odometer !== undefined ? `· عداد: ${m.odometer} كم` : ''}
                            </div>
                          </div>
                          <span className="font-mono-num text-[11px] text-slate-400 shrink-0 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {m.occurredAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                      ))}
                      {profile360Data.statusHistory.map((sh) => (
                        <div key={sh.historyId} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 text-xs flex items-start justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/50">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                              <span>
                                تغيير حالة: {sh.fromStatus === 'none' ? 'تسجيل أولي' : VEHICLE_STATUS_LABELS[sh.fromStatus] || sh.fromStatus} ← {VEHICLE_STATUS_LABELS[sh.toStatus] || sh.toStatus}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{sh.reason} · {sh.changedByEmail}</div>
                          </div>
                          <span className="font-mono-num text-[11px] text-slate-400 shrink-0">
                            {sh.changedAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <SectionHeader title={`سجل الصيانة (${profile360Data.maintenance.length})`} className="mb-2" />
                  {profile360Data.maintenance.length === 0 ? (
                    <EmptyState title="لا توجد سجلات صيانة مسجلة لهذه المركبة" />
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {profile360Data.maintenance.map((m) => (
                        <div key={m.maintenanceId} className="py-2 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold">
                              {m.workOrderNumber ? `${m.workOrderNumber} · ` : ''}{m.maintenanceType}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono-num">{m.maintenanceDate} · {m.workshop || '—'}</div>
                          </div>
                          <span className="font-mono-num font-bold">{(m.actualCost ?? m.cost ?? 0).toLocaleString('en-US')} ر.س</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <SectionHeader title={`بلاغات ومطالبات الأضرار (${profile360Data.damageClaims.length})`} className="mb-2" />
                  {profile360Data.damageClaims.length === 0 ? (
                    <EmptyState title="لا توجد بلاغات أضرار مسجلة لهذه المركبة" />
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {profile360Data.damageClaims.map((c) => (
                        <div key={c.claimId} className="py-2 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {c.claimNumber} · {DAMAGE_SEVERITY_LABELS[c.severity] || c.severity} ({DAMAGE_LIABILITY_LABELS[c.liability] || c.liability})
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">{c.description}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono-num font-bold">
                              {(c.actualRepairCost ?? c.estimatedRepairCost ?? 0).toLocaleString('en-US')} ر.س
                            </span>
                            <StatusBadge
                              label={DAMAGE_STATUS_LABELS[c.status] || c.status}
                              tone={c.status === 'settled' || c.status === 'closed' ? 'success' : 'warning'}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>
        )}
      </SlideDrawer>

      <FleetProtocolPrintModal
        open={Boolean(protocolTarget)}
        target={protocolTarget}
        branding={companyBranding}
        fleetConfig={fleetConfig}
        preparerEmail={currentUser.email}
        onClose={() => setProtocolTarget(null)}
      />

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
