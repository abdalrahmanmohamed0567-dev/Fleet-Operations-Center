import {
  ArrowRight,
  Car,
  ClipboardPlus,
  Download,
  FolderLock,
  Link2,
  MessageSquarePlus,
  Plus,
  Search,
  Smartphone,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from '../lib/erpDb';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EMPLOYEE_HR_STATUS_LABELS, generateNextCompanyRiderId, VEHICLE_STATUS_LABELS } from '../lib/erpHelpers';
import { extractHungerErrorEvents, type HungerErrorEvent } from '../lib/errorIntelligence';
import { db, getActiveAuthToken, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildUnifiedDailyRows,
  fmtCurrency,
  fmtHours,
  fmtKm,
  fmtNum,
  fmtPct,
  type FleetDataset,
} from '../lib/fleetAnalytics';
import { computeRiderPerformanceScore } from '../lib/smartAnalytics';
import { isKeetaActive } from '../shared/rbacCore';
import type {
  DynamicFieldDefinition,
  DynamicFormDefinition,
  EntityNoteTask,
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalCasePriority,
  OperationalSettings,
  Platform,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderErrorCase,
  RiderErrorCaseStatus,
  RiderIdentityMapping,
  RiderMaster,
  RiderNote,
  RiderNoteCategory,
  UserProfile,
  VehicleAssignment,
  VehicleMaster,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { KpiCard } from './KpiCard';
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
  Textarea,
  ToastBanner,
  type BadgeTone,
} from './ui/EnterpriseUI';

interface RiderManagementProps {
  dataset: FleetDataset;
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  riderErrorCases: RiderErrorCase[];
  operationalCases: OperationalCase[];
  riderNotes: RiderNote[];
  settings: OperationalSettings;
  currentUser: UserProfile;
  allowedUids: string[];
  selectedRider: { platform: Platform; riderId: string } | null;
  workspaceScope?: 'hungerstation' | 'keeta' | 'global';
  platformCatalog?: PlatformCatalogEntry[];
  platformAccounts?: PlatformAccount[];
  privateDocs?: PrivateDocumentRecord[];
  vehicles?: VehicleMaster[];
  vehicleAssignments?: VehicleAssignment[];
  entityNotesTasks?: EntityNoteTask[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  onSelectRider: (target: { platform: Platform; riderId: string } | null) => void;
  onRefresh: () => Promise<void>;
}

export function RiderManagementAnd360({
  dataset,
  dictionaryEntries,
  riderErrorCases,
  operationalCases,
  riderNotes,
  settings,
  currentUser,
  allowedUids,
  selectedRider,
  workspaceScope = 'global',
  platformCatalog = [],
  platformAccounts = [],
  privateDocs = [],
  vehicles = [],
  vehicleAssignments = [],
  entityNotesTasks = [],
  dynamicFields = [],
  dynamicForms = [],
  onSelectRider,
  onRefresh,
}: RiderManagementProps) {
  const canEdit =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager' ||
    currentUser.role === 'supervisor' ||
    currentUser.role === 'hr_manager';
  const keetaActive = isKeetaActive(settings, platformCatalog);

  const [searchQuery, setSearchQuery] = useState('');
  const [newRiderId, setNewRiderId] = useState('');
  const [newRiderName, setNewRiderName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newSupervisor, setNewSupervisor] = useState('');
  const [newVehicle, setNewVehicle] = useState('');

  const [mapInternalId, setMapInternalId] = useState('');
  const [mapPlatform, setMapPlatform] = useState<Platform>('hungerstation');
  const [mapPlatformRiderId, setMapPlatformRiderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<RiderIdentityMapping | null>(null);

  // Build directory of all discovered platform riders + linked internal IDs
  const platformRoster = useMemo(() => {
    const mapByKey = new Map<
      string,
      {
        platform: Platform;
        riderId: string;
        name: string;
        city: string;
        branch: string;
        supervisor: string;
        vehicle: string;
        orders: number;
        hours: number;
        days: number;
        internalRiderId: string;
      }
    >();

    const mappingIndex = new Map<string, string>();
    if (workspaceScope === 'global') {
      for (const m of dataset.riderMappings) {
        mappingIndex.set(`${m.platform}:${m.platformRiderId}`, m.internalRiderId);
      }
    }

    if (workspaceScope !== 'keeta') {
      for (const h of dataset.hungerDaily) {
        const k = `hungerstation:${h.riderId}`;
        const cur = mapByKey.get(k) || {
          platform: 'hungerstation' as Platform,
          riderId: h.riderId,
          name: h.riderId,
          city: h.city || '',
          branch: '',
          supervisor: '',
          vehicle: h.vehicleName || '',
          orders: 0,
          hours: 0,
          days: 0,
          internalRiderId: mappingIndex.get(k) || '',
        };
        cur.orders += h.completedDeliveries ?? 0;
        cur.hours += h.actualWorkingHours ?? 0;
        cur.days += 1;
        if (!cur.city && h.city) cur.city = h.city;
        if (!cur.vehicle && h.vehicleName) cur.vehicle = h.vehicleName;
        mapByKey.set(k, cur);
      }
    }

    if (workspaceScope !== 'hungerstation') {
      for (const kd of dataset.keetaDashboardDaily) {
        const k = `keeta:${kd.riderId}`;
        const cur = mapByKey.get(k) || {
          platform: 'keeta' as Platform,
          riderId: kd.riderId,
          name: kd.fullName || kd.riderId,
          city: kd.headquarters || '',
          branch: kd.branch || '',
          supervisor: kd.supervisor || '',
          vehicle: kd.vehicleType || '',
          orders: 0,
          hours: 0,
          days: 0,
          internalRiderId: mappingIndex.get(k) || '',
        };
        cur.orders += kd.deliveredTasks ?? 0;
        cur.hours += kd.shiftOnlineHours ?? 0;
        cur.days += 1;
        if (kd.fullName && cur.name === kd.riderId) cur.name = kd.fullName;
        if (!cur.branch && kd.branch) cur.branch = kd.branch;
        if (!cur.supervisor && kd.supervisor) cur.supervisor = kd.supervisor;
        mapByKey.set(k, cur);
      }
    }

    const list = Array.from(mapByKey.values());
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (r) =>
        r.riderId.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.internalRiderId.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q)
    );
  }, [dataset, searchQuery, workspaceScope]);

  const handleCreateInternalRider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !newRiderName.trim()) return;
    const rawId = newRiderId.trim() || generateNextCompanyRiderId(dataset.riderMaster);
    const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(doc(db, 'riderMaster', cleanId), {
        internalRiderId: cleanId,
        fullName: newRiderName.trim(),
        city: newCity.trim(),
        branch: newBranch.trim(),
        supervisor: newSupervisor.trim(),
        vehicleType: newVehicle.trim(),
        status: 'active',
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'RIDER_MASTER_CREATED',
        targetCollection: 'riderMaster',
        targetId: cleanId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `إنشاء سجل مندوب داخلي: ${cleanId} (${newRiderName.trim()})`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setNewRiderId('');
      setNewRiderName('');
      setNewCity('');
      setNewBranch('');
      setNewSupervisor('');
      setNewVehicle('');
      setMsg({ type: 'ok', text: `تم إنشاء المندوب الداخلي ${cleanId} بنجاح.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `riderMaster/${cleanId}`);
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'فشل إنشاء المندوب.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLinkIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !mapInternalId || !mapPlatformRiderId.trim()) return;
    const mappingId = `${mapPlatform}_${mapPlatformRiderId.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    setBusy(true);
    setMsg(null);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(doc(db, 'riderIdentityMapping', mappingId), {
        mappingId,
        internalRiderId: mapInternalId,
        platform: mapPlatform,
        platformRiderId: mapPlatformRiderId.trim(),
        platformRiderName: '',
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'IDENTITY_LINKED',
        targetCollection: 'riderIdentityMapping',
        targetId: mappingId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `ربط معرف المنصة ${mapPlatform}:${mapPlatformRiderId.trim()} بالمندوب الداخلي ${mapInternalId}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setMapPlatformRiderId('');
      setMsg({ type: 'ok', text: `تم ربط المعرف بنجاح بالمندوب الداخلي ${mapInternalId}.` });
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `riderIdentityMapping/${mappingId}`);
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'فشل ربط معرف المنصة.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    setBusy(true);
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await deleteDoc(doc(db, 'riderIdentityMapping', unlinkTarget.mappingId));
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'IDENTITY_UNLINKED',
        targetCollection: 'riderIdentityMapping',
        targetId: unlinkTarget.mappingId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `إلغاء ربط ${unlinkTarget.platform}:${unlinkTarget.platformRiderId} من ${unlinkTarget.internalRiderId}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setUnlinkTarget(null);
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `riderIdentityMapping/${unlinkTarget.mappingId}`);
      } catch (wrapped) {
        setMsg({ type: 'err', text: wrapped instanceof Error ? wrapped.message : 'تعذر فك الربط.' });
      }
    } finally {
      setBusy(false);
    }
  };

  // If a Rider 360 profile is open, render the full Rider 360 view
  if (selectedRider) {
    return (
      <Rider360Profile
        dataset={dataset}
        dictionaryEntries={dictionaryEntries}
        riderErrorCases={riderErrorCases}
        operationalCases={operationalCases}
        riderNotes={riderNotes}
        settings={settings}
        currentUser={currentUser}
        allowedUids={allowedUids}
        platform={selectedRider.platform}
        riderId={selectedRider.riderId}
        workspaceScope={workspaceScope}
        keetaActive={keetaActive}
        platformAccounts={platformAccounts}
        privateDocs={privateDocs}
        vehicles={vehicles}
        vehicleAssignments={vehicleAssignments}
        entityNotesTasks={entityNotesTasks}
        dynamicFields={dynamicFields}
        dynamicForms={dynamicForms}
        onBack={() => onSelectRider(null)}
        onRefresh={onRefresh}
      />
    );
  }

  type RosterRow = (typeof platformRoster)[number];

  const rosterCols: TableColumn<RosterRow>[] = [
    ...(workspaceScope === 'global'
      ? [
          {
            key: 'platform',
            header: 'المنصة',
            sortValue: (r: RosterRow) => r.platform,
            render: (r: RosterRow) => (
              <StatusBadge
                label={r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
                tone={r.platform === 'hungerstation' ? 'info' : 'warning'}
              />
            ),
          },
        ]
      : []),
    {
      key: 'riderId',
      header: workspaceScope === 'keeta' ? 'Courier ID' : workspaceScope === 'hungerstation' ? 'Rider ID' : 'معرف المنصة',
      sortValue: (r) => r.riderId,
      render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span>,
    },
    {
      key: 'name',
      header: 'الاسم',
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>,
    },
    ...(workspaceScope === 'global'
      ? [
          {
            key: 'internal',
            header: 'المعرف الداخلي للشركة',
            sortValue: (r: RosterRow) => r.internalRiderId,
            render: (r: RosterRow) =>
              r.internalRiderId ? (
                <StatusBadge label={r.internalRiderId} tone="success" className="font-mono-num" />
              ) : (
                <span className="text-xs text-slate-400">غير مربوط يدويًا</span>
              ),
          },
        ]
      : []),
    {
      key: 'loc',
      header: 'المدينة / الفرع / المشرف',
      render: (r) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {[r.city, r.branch, r.supervisor].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'orders',
      header: 'إجمالي الطلبات',
      align: 'center',
      sortValue: (r) => r.orders,
      render: (r) => <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">{fmtNum(r.orders)}</span>,
    },
    {
      key: 'hours',
      header: 'ساعات العمل',
      align: 'center',
      sortValue: (r) => r.hours,
      render: (r) => <span className="font-mono-num">{fmtHours(r.hours)}</span>,
    },
    {
      key: 'open',
      header: 'Rider 360',
      align: 'center',
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => onSelectRider({ platform: r.platform, riderId: r.riderId })}>
          فتح ملف 360
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          workspaceScope === 'hungerstation'
            ? 'مندوبو HungerStation وملفات 360°'
            : workspaceScope === 'keeta'
              ? 'مندوبو Keeta وملفات 360°'
              : 'الدليل الموحد للمندوبين والربط اليدوي للهويات (Rider 360)'
        }
        subtitle={
          workspaceScope === 'hungerstation'
            ? 'عرض مندوبي HungerStation فقط مع بياناتهم اليومية والمحافظ وجودة التسليم وسجل الأخطاء بشكل معزول.'
            : workspaceScope === 'keeta'
              ? 'عرض مندوبي Keeta فقط مع بيانات Dashboard وVDA وRankPlanProcess والتحقق من الهوية بشكل معزول.'
              : 'يُحفظ معرف كل منصة بشكل مستقل، ويمكن إنشاء معرف داخلي للشركة وربط حسابات المنصات يدويًا لنفس المندوب.'
        }
        actions={
          <div className="relative w-72 max-w-full">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو معرف المندوب..."
              className="pr-9"
            />
          </div>
        }
      />

      {msg && (
        <ToastBanner
          type={msg.type}
          message={msg.text}
          onDismiss={() => setMsg(null)}
        />
      )}

      {canEdit && workspaceScope === 'global' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <SectionHeader
              title="إنشاء معرف داخلي للشركة (riderMaster)"
              subtitle="إنشاء ملف موظف أساسي مع تسلسل EMP تلقائي"
              className="mb-4"
            />
            <form onSubmit={handleCreateInternalRider} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="معرف داخلي (اختياري)">
                  <Input
                    type="text"
                    className="font-mono-num"
                    value={newRiderId}
                    onChange={(e) => setNewRiderId(e.target.value)}
                    placeholder={`تلقائي (${generateNextCompanyRiderId(dataset.riderMaster)})`}
                  />
                </FormField>
                <FormField label="اسم المندوب الكامل" required>
                  <Input
                    type="text"
                    required
                    value={newRiderName}
                    onChange={(e) => setNewRiderName(e.target.value)}
                    placeholder="الاسم الكامل"
                  />
                </FormField>
                <FormField label="المدينة">
                  <Input type="text" value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="المدينة" />
                </FormField>
                <FormField label="الفرع">
                  <Input type="text" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="الفرع" />
                </FormField>
                <FormField label="المشرف">
                  <Input type="text" value={newSupervisor} onChange={(e) => setNewSupervisor(e.target.value)} placeholder="المشرف" />
                </FormField>
                <FormField label="نوع المركبة">
                  <Input type="text" value={newVehicle} onChange={(e) => setNewVehicle(e.target.value)} placeholder="نوع المركبة" />
                </FormField>
              </div>
              <Button type="submit" variant="primary" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
                حفظ المندوب الداخلي
              </Button>
            </form>
          </Card>

          <Card>
            <SectionHeader
              title="ربط معرفات المنصات يدويًا بنفس المندوب"
              subtitle="ربط رقم المندوب على المنصة بملفه الداخلي في الشركة"
              className="mb-4"
            />
            <form onSubmit={handleLinkIdentity} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField label="المندوب الداخلي" required>
                  <Select required value={mapInternalId} onChange={(e) => setMapInternalId(e.target.value)}>
                    <option value="">اختر المندوب...</option>
                    {dataset.riderMaster.map((rm) => (
                      <option key={rm.internalRiderId} value={rm.internalRiderId}>
                        {rm.internalRiderId} — {rm.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="المنصة">
                  <Select value={mapPlatform} onChange={(e) => setMapPlatform(e.target.value as Platform)}>
                    <option value="hungerstation">HungerStation</option>
                    {keetaActive && <option value="keeta">Keeta</option>}
                  </Select>
                </FormField>
                <FormField label="Platform Rider ID" required>
                  <Input
                    type="text"
                    required
                    className="font-mono-num"
                    value={mapPlatformRiderId}
                    onChange={(e) => setMapPlatformRiderId(e.target.value)}
                    placeholder="Rider / Courier ID"
                  />
                </FormField>
              </div>
              <Button
                type="submit"
                variant="accent"
                disabled={busy || dataset.riderMaster.length === 0}
                icon={<Link2 className="h-3.5 w-3.5" />}
              >
                ربط الحساب
              </Button>

              {dataset.riderMappings.length > 0 && (
                <div className="max-h-32 overflow-y-auto erp-scroll divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                  {dataset.riderMappings.map((m) => (
                    <div key={m.mappingId} className="flex items-center justify-between px-3 py-2">
                      <span className="font-mono-num text-slate-700 dark:text-slate-300">
                        {m.internalRiderId} ⇄ {m.platform}:{m.platformRiderId}
                      </span>
                      <button
                        type="button"
                        onClick={() => setUnlinkTarget(m)}
                        className="rounded p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                        title="إلغاء الربط"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </form>
          </Card>
        </div>
      )}

      <DataTable
        rows={platformRoster}
        columns={rosterCols}
        rowKey={(r) => `${r.platform}:${r.riderId}`}
        emptyTitle="لا توجد بيانات مندوبين"
        emptySubtitle="استورد ملفات Excel لعرض قائمة المندوبين وفتح ملف Rider 360."
      />

      <ConfirmModal
        open={Boolean(unlinkTarget)}
        title="تأكيد إلغاء ربط معرف المنصة"
        description={
          unlinkTarget
            ? `هل تريد فك ارتباط المعرف ${unlinkTarget.platform}:${unlinkTarget.platformRiderId} عن المندوب الداخلي ${unlinkTarget.internalRiderId}؟`
            : ''
        }
        danger
        busy={busy}
        onConfirm={confirmUnlink}
        onCancel={() => setUnlinkTarget(null)}
      />
    </div>
  );
}

function Rider360Profile({
  dataset,
  dictionaryEntries,
  riderErrorCases,
  operationalCases,
  riderNotes,
  settings,
  currentUser,
  allowedUids,
  platform,
  riderId,
  workspaceScope,
  keetaActive,
  platformAccounts,
  privateDocs,
  vehicles,
  vehicleAssignments,
  entityNotesTasks,
  dynamicFields = [],
  dynamicForms = [],
  onBack,
  onRefresh,
}: {
  dataset: FleetDataset;
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  riderErrorCases: RiderErrorCase[];
  operationalCases: OperationalCase[];
  riderNotes: RiderNote[];
  settings: OperationalSettings;
  currentUser: UserProfile;
  allowedUids: string[];
  platform: Platform;
  riderId: string;
  workspaceScope: 'hungerstation' | 'keeta' | 'global';
  keetaActive: boolean;
  platformAccounts: PlatformAccount[];
  privateDocs: PrivateDocumentRecord[];
  vehicles: VehicleMaster[];
  vehicleAssignments: VehicleAssignment[];
  entityNotesTasks: EntityNoteTask[];
  dynamicFields?: DynamicFieldDefinition[];
  dynamicForms?: DynamicFormDefinition[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const directByInternal =
    workspaceScope === 'global'
      ? dataset.riderMaster.find((rm) => rm.internalRiderId === riderId)
      : undefined;
  const directMapping =
    workspaceScope === 'global'
      ? dataset.riderMappings.find((m) => m.platform === platform && m.platformRiderId === riderId)
      : undefined;
  const directAccount =
    workspaceScope === 'global'
      ? platformAccounts.find((a) => a.platformId === platform && a.platformRiderId === riderId)
      : undefined;

  const resolvedInternalId =
    directByInternal?.internalRiderId ||
    directMapping?.internalRiderId ||
    directAccount?.companyRiderId ||
    '';

  const internalMaster: RiderMaster | undefined = resolvedInternalId
    ? dataset.riderMaster.find((rm) => rm.internalRiderId === resolvedInternalId)
    : undefined;

  const companyAccounts = useMemo(() => {
    if (!resolvedInternalId || workspaceScope !== 'global') return [];
    return platformAccounts
      .filter((a) => a.companyRiderId === resolvedInternalId)
      .filter((a) => keetaActive || a.platformId.toLowerCase() !== 'keeta');
  }, [resolvedInternalId, workspaceScope, platformAccounts, keetaActive]);

  const linkedIds = useMemo(() => {
    if (!resolvedInternalId || workspaceScope !== 'global') {
      return [{ platform, platformRiderId: riderId }];
    }
    const list: Array<{ platform: Platform; platformRiderId: string }> = [];
    const seen = new Set<string>();
    for (const m of dataset.riderMappings) {
      if (m.internalRiderId === resolvedInternalId && (keetaActive || m.platform !== 'keeta')) {
        const k = `${m.platform}:${m.platformRiderId}`;
        if (!seen.has(k)) {
          seen.add(k);
          list.push({ platform: m.platform, platformRiderId: m.platformRiderId });
        }
      }
    }
    for (const a of companyAccounts) {
      if (a.platformId === 'hungerstation' || (a.platformId === 'keeta' && keetaActive)) {
        const k = `${a.platformId}:${a.platformRiderId}`;
        if (!seen.has(k)) {
          seen.add(k);
          list.push({ platform: a.platformId as Platform, platformRiderId: a.platformRiderId });
        }
      }
    }
    if (list.length === 0) list.push({ platform, platformRiderId: riderId });
    return list;
  }, [resolvedInternalId, workspaceScope, dataset.riderMappings, companyAccounts, keetaActive, platform, riderId]);

  const allowHs = workspaceScope !== 'keeta';
  const allowKt = keetaActive && workspaceScope !== 'hungerstation';

  const hungerIds = new Set(allowHs ? linkedIds.filter((x) => x.platform === 'hungerstation').map((x) => x.platformRiderId) : []);
  const keetaIds = new Set(allowKt ? linkedIds.filter((x) => x.platform === 'keeta').map((x) => x.platformRiderId) : []);

  const riderPrivateDocs = useMemo(() => {
    if (!resolvedInternalId) return [];
    return privateDocs.filter((d) => d.entityType === 'rider' && d.entityId === resolvedInternalId);
  }, [privateDocs, resolvedInternalId]);

  const riderVehicleHistory = useMemo(() => {
    if (!resolvedInternalId) return [];
    return vehicleAssignments
      .filter((a) => a.companyRiderId === resolvedInternalId)
      .sort((a, b) => b.handoverDate.localeCompare(a.handoverDate))
      .map((a) => ({
        ...a,
        vehicle: vehicles.find((v) => v.vehicleInternalId === a.vehicleInternalId),
      }));
  }, [vehicleAssignments, vehicles, resolvedInternalId]);

  const riderExecTasks = useMemo(() => {
    if (!resolvedInternalId) return [];
    return entityNotesTasks.filter((t) => t.entityType === 'rider' && t.entityId === resolvedInternalId);
  }, [entityNotesTasks, resolvedInternalId]);

  const handleDownloadVaultDoc = async (docRec: PrivateDocumentRecord) => {
    try {
      const token = await getActiveAuthToken();
      if (!token) return;
      const res = await fetch(`/api/documents/${encodeURIComponent(docRec.docId)}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const latestVer = docRec.versions?.[docRec.versions.length - 1];
      a.download = latestVer?.originalFileName || `${docRec.docId}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore download error
    }
  };

  const hsDaily = allowHs ? dataset.hungerDaily.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const hsDist = allowHs ? dataset.hungerDistanceDaily.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const hsWallet = allowHs ? dataset.hungerWalletSnapshots.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)) : [];
  const hsQual = allowHs ? dataset.hungerQualityMonthly.filter((r) => hungerIds.has(r.riderId)) : [];

  const ktDash = allowKt ? dataset.keetaDashboardDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const ktVda = allowKt ? dataset.keetaVdaDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const ktRank = allowKt ? dataset.keetaRankSnapshots.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)) : [];
  const ktFace = allowKt ? dataset.keetaFacialRecognitionDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date)) : [];

  const canManageErrors =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager' ||
    currentUser.role === 'supervisor';

  const riderErrorEvents = useMemo(
    () => extractHungerErrorEvents(hsDaily, dataset, dictionaryEntries, riderErrorCases).events,
    [hsDaily, dataset, dictionaryEntries, riderErrorCases]
  );

  const riderErrorSummaryByCode = useMemo(() => {
    const map = new Map<
      string,
      {
        codeKey: string;
        normalizedCode: string;
        displayTitle: string;
        severity: string;
        recommendedAction: string;
        count: number;
        firstDate: string;
        lastDate: string;
        rawExamples: Set<string>;
      }
    >();
    for (const ev of riderErrorEvents) {
      const cur = map.get(ev.codeKey) || {
        codeKey: ev.codeKey,
        normalizedCode: ev.normalizedCode,
        displayTitle: ev.dictionaryEntry?.arabicDescription || 'Unknown Code',
        severity: ev.dictionaryEntry?.severity || 'unknown',
        recommendedAction: ev.dictionaryEntry?.recommendedAction || '',
        count: 0,
        firstDate: ev.date,
        lastDate: ev.date,
        rawExamples: new Set<string>(),
      };
      cur.count += 1;
      if (ev.date < cur.firstDate) cur.firstDate = ev.date;
      if (ev.date > cur.lastDate) cur.lastDate = ev.date;
      cur.rawExamples.add(ev.rawCode);
      map.set(ev.codeKey, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [riderErrorEvents]);

  const [editingCaseEvent, setEditingCaseEvent] = useState<HungerErrorEvent | null>(null);
  const [caseStatus, setCaseStatus] = useState<RiderErrorCaseStatus>('open');
  const [caseAction, setCaseAction] = useState('');
  const [caseNote, setCaseNote] = useState('');
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseMsg, setCaseMsg] = useState<string | null>(null);

  const startEditCase = (ev: HungerErrorEvent) => {
    setEditingCaseEvent(ev);
    setCaseStatus(ev.caseRecord?.status || 'open');
    setCaseAction(ev.caseRecord?.actionTaken || '');
    setCaseNote(ev.caseRecord?.operationalNote || '');
    setCaseMsg(null);
  };

  const handleSaveErrorCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCaseEvent || !canManageErrors) return;
    setCaseBusy(true);
    setCaseMsg(null);
    const { caseId, riderId: evRiderId, date, codeKey, normalizedCode, rawCode, caseRecord } = editingCaseEvent;
    try {
      const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
      await setDoc(
        doc(db, 'hungerRiderErrorCases', caseId),
        {
          caseId,
          riderId: evRiderId.slice(0, 64),
          date,
          codeKey,
          normalizedCode: normalizedCode.slice(0, 200),
          rawCode: rawCode.slice(0, 200),
          status: caseStatus,
          actionTaken: caseAction.trim().slice(0, 500),
          operationalNote: caseNote.trim().slice(0, 1000),
          updatedByEmail: currentUser.email.slice(0, 200),
          createdByUid: caseRecord?.createdByUid || currentUser.uid,
          allowedUids: safeAllowed,
          createdAt: caseRecord?.createdAt ? caseRecord.createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: Boolean(caseRecord) }
      );
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'RIDER_ERROR_CASE_UPDATED',
        targetCollection: 'hungerRiderErrorCases',
        targetId: caseId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        details: `تحديث حالة خطأ المندوب ${evRiderId} (${normalizedCode} · ${date}) إلى ${caseStatus}`,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
      });
      setEditingCaseEvent(null);
      setCaseMsg('تم حفظ حالة الخطأ والملاحظات التشغيلية بنجاح.');
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `hungerRiderErrorCases/${caseId}`);
      } catch (wrapped) {
        setCaseMsg(wrapped instanceof Error ? wrapped.message : 'تعذر حفظ حالة المتابعة.');
      }
    } finally {
      setCaseBusy(false);
    }
  };

  const latestKt = ktDash[0];
  const latestHs = hsDaily[0];
  const displayName = internalMaster?.fullName || latestKt?.fullName || riderId;
  const city = internalMaster?.city || latestHs?.city || latestKt?.headquarters || '-';
  const branch = internalMaster?.branch || latestKt?.branch || '-';
  const supervisor = internalMaster?.supervisor || latestKt?.supervisor || '-';
  const vehicle = internalMaster?.vehicleType || latestHs?.vehicleName || latestKt?.vehicleType || '-';

  const allDates = [
    ...hsDaily.map((d) => d.date),
    ...ktDash.map((d) => d.date),
  ].sort().reverse();
  const latestDate = allDates[0] || '';
  const latestMonth = latestDate.slice(0, 7);

  const todayOrders =
    hsDaily.filter((d) => d.date === latestDate).reduce((s, r) => s + (r.completedDeliveries ?? 0), 0) +
    ktDash.filter((d) => d.date === latestDate).reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);

  const monthOrders =
    hsDaily.filter((d) => d.month === latestMonth).reduce((s, r) => s + (r.completedDeliveries ?? 0), 0) +
    ktDash.filter((d) => d.month === latestMonth).reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);

  const totalHours =
    hsDaily.reduce((s, r) => s + (r.actualWorkingHours ?? 0), 0) +
    ktDash.reduce((s, r) => s + (r.shiftOnlineHours ?? 0), 0);

  const totalKm =
    hsDist.reduce((s, r) => s + (r.totalKm ?? 0), 0) +
    ktVda.reduce((s, r) => s + (r.totalDeliveryDistance ?? 0), 0);

  const totalOrdersAll =
    hsDaily.reduce((s, r) => s + (r.completedDeliveries ?? 0), 0) +
    ktDash.reduce((s, r) => s + (r.deliveredTasks ?? 0), 0);

  const totalRejected =
    hsDaily.reduce((s, r) => s + (r.declinedDeliveries ?? 0) + (r.notAcceptedDeliveries ?? 0), 0) +
    ktDash.reduce((s, r) => s + (r.rejectedTasks ?? 0), 0);

  const trendMap = new Map<string, { date: string; orders: number; hours: number }>();
  for (const h of hsDaily) {
    const cur = trendMap.get(h.date) || { date: h.date, orders: 0, hours: 0 };
    cur.orders += h.completedDeliveries ?? 0;
    cur.hours += h.actualWorkingHours ?? 0;
    trendMap.set(h.date, cur);
  }
  for (const k of ktDash) {
    const cur = trendMap.get(k.date) || { date: k.date, orders: 0, hours: 0 };
    cur.orders += k.deliveredTasks ?? 0;
    cur.hours += k.shiftOnlineHours ?? 0;
    trendMap.set(k.date, cur);
  }
  const trendSeries = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const riderUnifiedRows = useMemo(() => {
    const all = buildUnifiedDailyRows(dataset);
    return all.filter((r) =>
      (r.platform === 'hungerstation' && hungerIds.has(r.riderId)) ||
      (r.platform === 'keeta' && keetaIds.has(r.riderId))
    );
  }, [dataset, hungerIds, keetaIds]);

  const performanceScore = useMemo(() => {
    const platformRows = riderUnifiedRows.filter((r) => r.platform === platform);
    const qualScore = hsQual[0]?.finalDeliveryQualityScore ?? null;
    return computeRiderPerformanceScore(platform, riderId, platformRows.length ? platformRows : riderUnifiedRows, settings, qualScore);
  }, [riderUnifiedRows, platform, riderId, settings, hsQual]);

  const matchedOperationalCases = useMemo(
    () =>
      operationalCases
        .filter((c) => (c.platform === 'hungerstation' && hungerIds.has(c.riderId)) || (c.platform === 'keeta' && keetaIds.has(c.riderId)))
        .sort((a, b) => b.registeredDate.localeCompare(a.registeredDate)),
    [operationalCases, hungerIds, keetaIds]
  );

  const matchedNotes = useMemo(
    () =>
      riderNotes
        .filter((n) => (n.platform === 'hungerstation' && hungerIds.has(n.riderId)) || (n.platform === 'keeta' && keetaIds.has(n.riderId)))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [riderNotes, hungerIds, keetaIds]
  );

  const [noteCategory, setNoteCategory] = useState<RiderNoteCategory>('ops');
  const [noteContent, setNoteContent] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  const [showNewOpCase, setShowNewOpCase] = useState(false);
  const [opTitle, setOpTitle] = useState('');
  const [opPriority, setOpPriority] = useState<OperationalCasePriority>('high');
  const [opDesc, setOpDesc] = useState('');
  const [opBusy, setOpBusy] = useState(false);

  const handleAddRiderNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageErrors || !noteContent.trim()) return;
    setNoteBusy(true);
    setNoteMsg(null);
    const noteId = `rnote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
    try {
      await setDoc(doc(db, 'riderNotes', noteId), {
        noteId,
        riderKey: `${platform}_${riderId}`.slice(0, 128),
        platform,
        riderId: riderId.slice(0, 64),
        category: noteCategory,
        content: noteContent.trim().slice(0, 1500),
        authorEmail: currentUser.email.slice(0, 200),
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNoteContent('');
      setNoteMsg('تمت إضافة الملاحظة الإدارية إلى ملف المندوب.');
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `riderNotes/${noteId}`);
      } catch (wrapped) {
        setNoteMsg(wrapped instanceof Error ? wrapped.message : 'تعذر حفظ الملاحظة.');
      }
    } finally {
      setNoteBusy(false);
    }
  };

  const handleDeleteNote = async (n: RiderNote) => {
    setNoteBusy(true);
    try {
      await deleteDoc(doc(db, 'riderNotes', n.noteId));
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `riderNotes/${n.noteId}`);
      } catch (wrapped) {
        setNoteMsg(wrapped instanceof Error ? wrapped.message : 'تعذر حذف الملاحظة.');
      }
    } finally {
      setNoteBusy(false);
    }
  };

  const handleCreateOpCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageErrors || !opTitle.trim()) return;
    setOpBusy(true);
    const today = new Date().toISOString().slice(0, 10);
    const dueDt = new Date(Date.now() + (settings.caseOverdueDays ?? 3) * 86400000).toISOString().slice(0, 10);
    const caseId = `opcase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeAllowed = allowedUids.length > 0 ? allowedUids : [currentUser.uid];
    try {
      await setDoc(doc(db, 'operationalCases', caseId), {
        caseId,
        riderId: riderId.slice(0, 64),
        platform,
        riderName: displayName.slice(0, 150),
        branch: branch !== '-' ? branch.slice(0, 120) : '',
        issueType: 'rider_360_followup',
        title: opTitle.trim().slice(0, 200),
        description: opDesc.trim().slice(0, 1200),
        priority: opPriority,
        status: 'new',
        assigneeEmail: currentUser.email.slice(0, 200),
        actionTaken: '',
        notes: '',
        registeredDate: today,
        dueDate: dueDt,
        closedDate: '',
        sourceRef: `rider360:${platform}:${riderId}`,
        updatedByEmail: currentUser.email.slice(0, 200),
        createdByUid: currentUser.uid,
        allowedUids: safeAllowed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowNewOpCase(false);
      setOpTitle('');
      setOpDesc('');
      setNoteMsg('تم فتح الحالة التشغيلية وإرسالها لمركز التحكم.');
      await onRefresh();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `operationalCases/${caseId}`);
      } catch (wrapped) {
        setNoteMsg(wrapped instanceof Error ? wrapped.message : 'تعذر فتح الحالة التشغيلية.');
      }
    } finally {
      setOpBusy(false);
    }
  };

  const timelineItems = useMemo(() => {
    const items: Array<{ id: string; date: string; kind: 'shift' | 'error' | 'case' | 'note'; title: string; detail: string }> = [];
    for (const h of hsDaily.slice(0, 25)) {
      items.push({
        id: `tl_hs_${h.recordKey}`,
        date: h.date,
        kind: 'shift',
        title: `وردية HungerStation (${fmtNum(h.completedDeliveries)} طلب)`,
        detail: `ساعات: ${fmtHours(h.actualWorkingHours)} · حضور: ${fmtPct(h.attendanceRate)} · قبول: ${fmtPct(h.acceptanceRate)}`,
      });
    }
    for (const k of ktDash.slice(0, 25)) {
      items.push({
        id: `tl_kt_${k.recordKey}`,
        date: k.date,
        kind: 'shift',
        title: `وردية Keeta (${fmtNum(k.deliveredTasks)} مهمة)`,
        detail: `ساعات: ${fmtHours(k.shiftOnlineHours)} · في الوقت: ${fmtPct(k.onTimeRate)} · متأخرات: ${fmtNum(k.overdueOrderTasks)}`,
      });
    }
    for (const ev of riderErrorEvents) {
      items.push({
        id: `tl_err_${ev.eventKey}`,
        date: ev.date,
        kind: 'error',
        title: `كود خطأ HS: ${ev.normalizedCode}`,
        detail: `${ev.dictionaryEntry?.arabicDescription || 'غير موثق بعد'} (Raw: ${ev.rawCode})`,
      });
    }
    for (const c of matchedOperationalCases) {
      items.push({
        id: `tl_case_${c.caseId}`,
        date: c.registeredDate,
        kind: 'case',
        title: `حالة تشغيلية: ${c.title}`,
        detail: `المرحلة: ${c.status} · المسؤول: ${c.assigneeEmail || '-'} ${c.actionTaken ? `· الإجراء: ${c.actionTaken}` : ''}`,
      });
    }
    for (const n of matchedNotes) {
      items.push({
        id: `tl_note_${n.noteId}`,
        date: typeof n.createdAt === 'string' && n.createdAt ? n.createdAt.slice(0, 10) : latestDate || new Date().toISOString().slice(0, 10),
        kind: 'note',
        title: `ملاحظة (${n.category}) — ${n.authorEmail}`,
        detail: n.content,
      });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  }, [hsDaily, ktDash, riderErrorEvents, matchedOperationalCases, matchedNotes, latestDate]);

  const errorCaseTone = (st: RiderErrorCaseStatus): BadgeTone =>
    st === 'resolved' ? 'success' : st === 'in_review' ? 'warning' : 'neutral';

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>العودة لقائمة المندوبين</span>
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">ملف المندوب 360° — {displayName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono-num">
                المعرفات: {linkedIds.map((l) => `${l.platform}:${l.platformRiderId}`).join(' · ')}
              </span>
              {internalMaster && (
                <>
                  <span>·</span>
                  <StatusBadge label={`داخلي: ${internalMaster.internalRiderId}`} tone="success" className="font-mono-num" />
                </>
              )}
              <span>·</span>
              <span>المدينة: {city}</span>
              <span>·</span>
              <span>الفرع: {branch}</span>
              <span>·</span>
              <span>المشرف: {supervisor}</span>
              <span>·</span>
              <span>المركبة: {vehicle}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {performanceScore.totalScore !== null && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-center">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">نقاط الأداء الموزونة</div>
                <div className="text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100">
                  {performanceScore.totalScore}/100{' '}
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">({performanceScore.band})</span>
                </div>
              </div>
            )}
            {canManageErrors && (
              <Button variant="primary" icon={<ClipboardPlus className="h-4 w-4" />} onClick={() => setShowNewOpCase(true)}>
                فتح حالة تشغيلية
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label={`طلبات آخر يوم (${latestDate || '-'})`} value={fmtNum(todayOrders)} tone="good" />
        <KpiCard label={`طلبات الشهر (${latestMonth || '-'})`} value={fmtNum(monthOrders)} />
        <KpiCard label="إجمالي الطلبات التاريخي" value={fmtNum(totalOrdersAll)} />
        <KpiCard label="إجمالي ساعات العمل/الاتصال" value={fmtHours(totalHours)} />
        <KpiCard label="إجمالي المرفوضة" value={fmtNum(totalRejected)} tone={totalRejected > 0 ? 'warn' : 'neutral'} />
        <KpiCard label="إجمالي المسافة المقطوعة" value={fmtKm(totalKm)} />
        {allowHs && (
          <>
            <KpiCard
              label="آخر رصيد محفظة (HS)"
              value={hsWallet[0] ? fmtCurrency(hsWallet[0].currentWallet) : 'غير متاح'}
              tone={hsWallet[0] && hsWallet[0].currentWallet < 0 ? 'critical' : 'neutral'}
            />
            <KpiCard
              label="جودة التسليم (HS)"
              value={hsQual[0]?.finalDeliveryQualityScore !== undefined ? `${fmtNum(hsQual[0].finalDeliveryQualityScore, 1)} (${hsQual[0].segment || '-'})` : 'غير متاح'}
            />
          </>
        )}
        {allowKt && (
          <>
            <KpiCard
              label="التصنيف والمكافأة (Keeta)"
              value={ktRank[0] ? `${ktRank[0].currentEstimatedLevel || '-'} · ${fmtCurrency(ktRank[0].estimatedRewardAmount)}` : 'غير متاح'}
            />
            <KpiCard
              label="التحقق من الهوية (Keeta)"
              value={ktFace[0] ? `${ktFace[0].finalInspectionResult || '-'} (${fmtPct(ktFace[0].passRateMtd)})` : 'غير متاح'}
            />
          </>
        )}
      </div>

      {/* Unified Company ERP 360 Summary */}
      {workspaceScope === 'global' && internalMaster && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <SectionHeader
              title="بيانات الموارد البشرية والوثائق الخاصة (HR 360°)"
              actions={
                <StatusBadge
                  label={EMPLOYEE_HR_STATUS_LABELS[internalMaster.status] || internalMaster.status}
                  tone={internalMaster.status === 'active' || internalMaster.status === 'ready' ? 'success' : internalMaster.status === 'terminated' || internalMaster.status === 'suspended' ? 'danger' : 'warning'}
                />
              }
              className="border-b border-slate-100 dark:border-slate-800 pb-3"
            />

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
                <div className="text-slate-500">رقم الإقامة والانتهاء</div>
                <div className="mt-1 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  {internalMaster.iqamaNumber || 'غير مسجل'} · {internalMaster.iqamaExpiryDate || '-'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
                <div className="text-slate-500">رخصة القيادة والانتهاء</div>
                <div className="mt-1 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  {internalMaster.driverLicenseNumber || 'غير مسجلة'} · {internalMaster.driverLicenseExpiryDate || '-'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
                <div className="text-slate-500">الجوال / الجنسية</div>
                <div className="mt-1 font-mono-num text-slate-900 dark:text-slate-100">
                  {internalMaster.phone || '-'} · {internalMaster.nationality || '-'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
                <div className="text-slate-500">تاريخ الانضمام / الخروج</div>
                <div className="mt-1 font-mono-num text-slate-900 dark:text-slate-100">
                  {internalMaster.joinDate || '-'} {internalMaster.exitDate ? `→ ${internalMaster.exitDate}` : ''}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <FolderLock className="h-3.5 w-3.5 text-slate-500" />
                <span>المستندات المحفوظة في الخزينة الخاصة ({riderPrivateDocs.length})</span>
              </div>
              {riderPrivateDocs.length === 0 ? (
                <p className="text-xs text-slate-500">لا توجد مستندات مرفوعة في الخزينة لهذا المندوب.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                  {riderPrivateDocs.map((d) => (
                    <div key={d.docId} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{d.title || d.docTypeName}</span>
                        <span className="mr-2 font-mono-num text-[11px] text-slate-500">
                          v{d.currentVersion} {d.expiryDate ? `· ينتهي ${d.expiryDate}` : ''}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Download className="h-3 w-3" />}
                        onClick={() => handleDownloadVaultDoc(d)}
                      >
                        تنزيل
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {dynamicFields.some((f) => f.formId === 'hr_rider') && (
              <DynamicFieldsRenderer
                formId="hr_rider"
                entityId={internalMaster.internalRiderId}
                entityLabel={internalMaster.fullName}
                dynamicFields={dynamicFields}
                dynamicForms={dynamicForms}
                values={internalMaster.customFields || {}}
                user={currentUser}
                mode="readonly"
                contextValues={{ ...internalMaster, ...(internalMaster.customFields || {}) }}
                title="الحقول المخصصة الإضافية للمندوب"
              />
            )}
          </Card>

          <Card className="space-y-4">
            <SectionHeader
              title="حسابات المنصات والعهدة والمركبات"
              actions={<Smartphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
              className="border-b border-slate-100 dark:border-slate-800 pb-3"
            />

            <div className="space-y-1.5 text-xs">
              <div className="font-bold text-slate-700 dark:text-slate-300">حسابات التطبيقات المرتبطة ({companyAccounts.length})</div>
              {companyAccounts.length === 0 ? (
                <p className="text-slate-500">لا توجد حسابات تطبيقات مسجلة في سجل المنصات لهذا المندوب.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                  {companyAccounts.map((a) => (
                    <div key={a.accountId} className="flex items-center justify-between px-3 py-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {a.platformName}: <span className="font-mono-num">{a.platformRiderId}</span>
                      </span>
                      <span className="font-mono-num text-[11px] text-slate-500">
                        {a.accountStatus} · {a.linkingStatus}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                <Car className="h-3.5 w-3.5 text-slate-500" />
                <span>سجل استلام وتسليم المركبات ({riderVehicleHistory.length})</span>
              </div>
              {riderVehicleHistory.length === 0 ? (
                <p className="text-slate-500">لم تُسجّل مركبات مسلّمة لهذا المندوب حتى الآن.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                  {riderVehicleHistory.map((va) => (
                    <div key={va.assignmentId} className="flex items-center justify-between px-3 py-2">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {va.plateNumber} ({va.vehicle ? `${va.vehicle.make} ${va.vehicle.model}` : va.vehicleInternalId})
                        </span>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          تسليم: {va.handoverDate} ({va.handoverOdometer} كم)
                          {va.returnDate ? ` → استلام: ${va.returnDate} (${va.returnOdometer ?? '-'} كم)` : ' · عهدة حالية'}
                        </div>
                      </div>
                      <StatusBadge
                        tone={va.status === 'active' ? 'success' : 'neutral'}
                        label={va.status === 'active' ? 'نشطة' : va.vehicle ? VEHICLE_STATUS_LABELS[va.vehicle.status] : 'مرجعة'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {riderExecTasks.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <div className="font-bold text-slate-700 dark:text-slate-300">متابعات الإدارة التنفيذية ({riderExecTasks.length})</div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                  {riderExecTasks.slice(0, 4).map((t) => (
                    <div key={t.noteTaskId} className="flex items-center justify-between px-3 py-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</span>
                      <StatusBadge
                        label={t.status === 'closed' ? 'مغلق' : t.status === 'in_progress' ? 'قيد المتابعة' : 'مفتوح'}
                        tone={t.status === 'closed' ? 'success' : t.status === 'in_progress' ? 'warning' : 'info'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Weighted Performance Score Breakdown */}
      {performanceScore.components.length > 0 && (
        <Card className="space-y-3">
          <SectionHeader
            title="تفصيل معادلة التقييم الموزون (Performance Score Breakdown)"
            subtitle={performanceScore.formulaNote}
            actions={
              <StatusBadge
                tone="info"
                className="font-mono-num"
                label={`النتيجة: ${performanceScore.totalScore}/100 (${performanceScore.band})`}
              />
            }
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {performanceScore.components.map((comp) => (
              <div key={comp.key} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{comp.label}</span>
                  <span className="font-mono-num font-bold text-blue-700 dark:text-blue-400">+{comp.weightedPoints} نقطة</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                  <span>{comp.rawValueLabel}</span>
                  <span>الوزن الفعلي: {comp.effectiveWeightPct}% (تقييم {comp.subScore}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Performance Trend Chart */}
      <Card>
        <SectionHeader title="اتجاه الأداء التاريخي (الطلبات والساعات اليومية)" className="mb-3" />
        <div className="h-64 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="orders" name="الطلبات المكتملة" stroke="#2563eb" strokeWidth={2} />
              <Line type="monotone" dataKey="hours" name="ساعات العمل" stroke="#0d9488" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Administrative Notes & Chronological Rider Timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <SectionHeader
            title="الملاحظات الإدارية والتشغيلية (Rider Notes)"
            actions={<span className="font-mono-num text-xs font-semibold text-slate-500">{matchedNotes.length}</span>}
          />
          {noteMsg && <ToastBanner type="info" message={noteMsg} onDismiss={() => setNoteMsg(null)} />}
          {canManageErrors && (
            <form onSubmit={handleAddRiderNote} className="flex flex-wrap items-center gap-2">
              <Select
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value as RiderNoteCategory)}
                className="!w-36"
              >
                <option value="ops">ملاحظة تشغيلية</option>
                <option value="admin">ملاحظة إدارية</option>
                <option value="warning">تنبيه / إنذار</option>
                <option value="commendation">إشادة / تميز</option>
              </Select>
              <Input
                type="text"
                required
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="أضف ملاحظة موثقة على ملف المندوب..."
                className="flex-1 min-w-[180px]"
              />
              <Button type="submit" variant="primary" loading={noteBusy} icon={<MessageSquarePlus className="h-3.5 w-3.5" />}>
                حفظ
              </Button>
            </form>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto erp-scroll">
            {matchedNotes.length === 0 ? (
              <EmptyState title="لا توجد ملاحظات مسجلة" subtitle="أضف ملاحظة إدارية أو تشغيلية لتوثيقها في سجل المندوب." />
            ) : (
              matchedNotes.map((n) => (
                <div key={n.noteId} className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        tone={n.category === 'warning' ? 'danger' : n.category === 'commendation' ? 'success' : n.category === 'admin' ? 'info' : 'neutral'}
                        label={n.category === 'warning' ? 'تنبيه' : n.category === 'commendation' ? 'إشادة' : n.category === 'admin' ? 'إداري' : 'تشغيلي'}
                      />
                      <span className="font-mono-num text-[11px] text-slate-500">{n.authorEmail}</span>
                    </div>
                    {(currentUser.role === 'owner' || currentUser.role === 'admin' || n.createdByUid === currentUser.uid) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(n)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        title="حذف الملاحظة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-slate-700 dark:text-slate-300 leading-relaxed">{n.content}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader
            title="السجل الزمني الموحد للمندوب (Timeline)"
            subtitle="ورديات · أخطاء · حالات · ملاحظات"
          />
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto erp-scroll">
            {timelineItems.map((tl) => (
              <div key={tl.id} className="flex items-start gap-3 py-2.5 text-xs">
                <span className="font-mono-num text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                  {tl.date}
                </span>
                <div className="min-w-0">
                  <div
                    className={`font-semibold ${
                      tl.kind === 'error'
                        ? 'text-red-700 dark:text-red-400'
                        : tl.kind === 'case'
                          ? 'text-amber-700 dark:text-amber-400'
                          : tl.kind === 'note'
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {tl.title}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 mt-0.5">{tl.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Error History Section (HungerStation Error Intelligence) */}
      {allowHs && (
        <Card className="space-y-4">
          <SectionHeader
            title="سجل الأخطاء التشغيلية (Error History — HungerStation)"
            subtitle="جميع أكواد الأخطاء المسجلة للمندوب وتكرارها وتواريخها وحالة المتابعة والإجراءات التشغيلية."
            actions={
              <div className="font-mono-num text-xs text-slate-600 dark:text-slate-400">
                إجمالي الحالات: <span className="font-bold text-slate-900 dark:text-slate-100">{riderErrorEvents.length}</span> · أكواد مختلفة:{' '}
                <span className="font-bold text-slate-900 dark:text-slate-100">{riderErrorSummaryByCode.length}</span>
              </div>
            }
          />

          {caseMsg && <ToastBanner type="info" message={caseMsg} onDismiss={() => setCaseMsg(null)} />}

          {riderErrorEvents.length === 0 ? (
            <EmptyState
              title="سجل خالٍ من الأخطاء"
              subtitle="لا توجد أكواد أخطاء مسجلة لهذا المندوب في تقارير HungerStation."
            />
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">الكود الموحد</th>
                      <th className="px-3 py-2.5 text-right">الوصف</th>
                      <th className="px-3 py-2.5 text-center">التكرار</th>
                      <th className="px-3 py-2.5 text-right">أول / آخر ظهور</th>
                      <th className="px-3 py-2.5 text-right">الإجراء التشغيلي المقترح</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {riderErrorSummaryByCode.map((c) => (
                      <tr key={c.codeKey}>
                        <td className="px-3 py-2.5 font-mono-num font-bold text-slate-900 dark:text-slate-100">
                          {c.normalizedCode}
                          <div className="text-[11px] font-normal text-slate-400">Raw: {Array.from(c.rawExamples).join(', ')}</div>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">{c.displayTitle}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num font-bold text-red-700 dark:text-red-400">{c.count}</td>
                        <td className="px-3 py-2.5 font-mono-num text-slate-600 dark:text-slate-300">{c.firstDate} → {c.lastDate}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{c.recommendedAction || 'بانتظار التوثيق في القاموس'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">التاريخ</th>
                      <th className="px-3 py-2.5 text-right">الكود (Raw)</th>
                      <th className="px-3 py-2.5 text-right">الحالة</th>
                      <th className="px-3 py-2.5 text-right">الإجراء والملاحظات</th>
                      {canManageErrors && <th className="px-3 py-2.5 text-center">تحديث</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {riderErrorEvents.map((ev) => {
                      const st = ev.caseRecord?.status || 'open';
                      const stLabel =
                        st === 'resolved' ? 'تمت المعالجة' : st === 'in_review' ? 'قيد المراجعة' : 'مفتوح للمتابعة';
                      return (
                        <tr key={ev.eventKey}>
                          <td className="px-3 py-2.5 font-mono-num">{ev.date}</td>
                          <td className="px-3 py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                            {ev.normalizedCode} <span className="text-slate-400 font-normal">({ev.rawCode})</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge label={stLabel} tone={errorCaseTone(st)} />
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                            {[ev.caseRecord?.actionTaken, ev.caseRecord?.operationalNote].filter(Boolean).join(' — ') || '-'}
                          </td>
                          {canManageErrors && (
                            <td className="px-3 py-2.5 text-center">
                              <Button size="sm" variant="secondary" onClick={() => startEditCase(ev)}>
                                تحديث الحالة
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {allowHs && hsDaily.length > 0 && (
        <Card className="space-y-3">
          <SectionHeader title="سجل HungerStation اليومي والمحفظة" />
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 text-right">التاريخ</th>
                  <th className="px-3 py-2.5 text-center">مكتملة</th>
                  <th className="px-3 py-2.5 text-center">مقبولة</th>
                  <th className="px-3 py-2.5 text-center">ملغاة</th>
                  <th className="px-3 py-2.5 text-center">ساعات فعلية</th>
                  <th className="px-3 py-2.5 text-center">الحضور %</th>
                  <th className="px-3 py-2.5 text-center">القبول %</th>
                  <th className="px-3 py-2.5 text-center">No Shows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {hsDaily.map((r) => (
                  <tr key={r.recordKey}>
                    <td className="px-3 py-2.5 font-mono-num">{r.date}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num font-semibold">{fmtNum(r.completedDeliveries)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(r.acceptedDeliveries)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(r.cancelledDeliveries)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtHours(r.actualWorkingHours)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(r.attendanceRate)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(r.acceptanceRate)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(r.noShows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {allowKt && (ktDash.length > 0 || ktVda.length > 0 || ktRank.length > 0 || ktFace.length > 0) && (
        <div className="space-y-4">
          {ktDash.length > 0 && (
            <Card className="space-y-4">
              <SectionHeader
                title="سجل Keeta اليومي (Dashboard · 6-Window Slots · Rejection Split)"
                actions={
                  ktDash[0] && (
                    <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                      آخر يوم ({ktDash[0].date}): App={ktDash[0].appOnlineTimeRaw || fmtHours(ktDash[0].appOnlineTime)} · Valid={ktDash[0].shiftValidOnlineTimeRaw || fmtHours(ktDash[0].shiftValidOnlineTime)}
                      {ktDash[0].shiftPeAbdoOnlineHours !== undefined && ktDash[0].shiftPeAbdoOnlineHours !== null
                        ? ` · PeAbdo (غير موثق)=${fmtHours(ktDash[0].shiftPeAbdoOnlineHours)}`
                        : ''}
                    </span>
                  )
                }
              />

              {ktDash[0]?.parsedShiftSlots && ktDash[0].parsedShiftSlots.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3 space-y-2">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    تفصيل نوافذ الشفتات الـ 6 لأحدث يوم ({ktDash[0].date}):
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                    {ktDash[0].parsedShiftSlots.map((slot) => (
                      <div key={slot.window} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 font-mono-num">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{slot.window}</div>
                        <div className="text-blue-700 dark:text-blue-400">{slot.durationRaw || fmtHours(slot.durationHours)}</div>
                        <div className={`text-[11px] font-semibold ${slot.qualification === 'qualified' ? 'text-emerald-700 dark:text-emerald-400' : slot.qualification === 'unqualified' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>
                          {slot.status}{slot.qualification && !slot.status.toLowerCase().includes(slot.qualification.toLowerCase()) ? ` (${slot.qualification})` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">التاريخ</th>
                      <th className="px-3 py-2.5 text-center">Delivered</th>
                      <th className="px-3 py-2.5 text-center">Rej (C/A)</th>
                      <th className="px-3 py-2.5 text-center">Shift / Valid / App</th>
                      <th className="px-3 py-2.5 text-center">Completion %</th>
                      <th className="px-3 py-2.5 text-center">On-time %</th>
                      <th className="px-3 py-2.5 text-center">&gt;55m Prop / Overdue</th>
                      <th className="px-3 py-2.5 text-center">On-Shift / ValidDay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ktDash.map((r) => (
                      <tr key={r.recordKey}>
                        <td className="px-3 py-2.5 font-mono-num">{r.date}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num font-semibold">{fmtNum(r.deliveredTasks)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(r.rejectedTasks)} ({fmtNum(r.rejectedTasksCourier)}/{fmtNum(r.rejectedTasksAuto)})</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(r.shiftOnlineHours, 1)} / {fmtNum(r.shiftValidOnlineTime, 1)} / {fmtNum(r.appOnlineTime, 1)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(r.completionRate)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(r.onTimeRate)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num text-red-700 dark:text-red-400">
                          {r.deliveredOver55MinProp !== null && r.deliveredOver55MinProp !== undefined ? fmtPct(r.deliveredOver55MinProp) : '-'} / {fmtNum(r.overdueOrderTasks)}
                        </td>
                        <td className="px-3 py-2.5 text-center">{r.onShift || '-'} / {r.validDay || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {ktVda.length > 0 && (
            <Card className="space-y-3">
              <SectionHeader
                title="سجل Keeta VDA والشفتات S1–S6 والمسافات"
                actions={
                  <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                    3PL: {ktVda[0].threePlName || '-'} · First Online: {ktVda[0].firstOnlineDate || '-'} · New Rider: {ktVda[0].ifNewRider || '-'}
                  </span>
                }
              />
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">Online Day</th>
                      <th className="px-3 py-2.5 text-center">Valid Shifts</th>
                      <th className="px-3 py-2.5 text-center">VDA Score</th>
                      <th className="px-3 py-2.5 text-center">Advance Tasks</th>
                      <th className="px-3 py-2.5 text-center">&gt;55m (Count)</th>
                      <th className="px-3 py-2.5 text-center">Total / Payable KM</th>
                      <th className="px-3 py-2.5 text-right">ملخص S1–S6</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ktVda.map((v) => (
                      <tr key={v.recordKey}>
                        <td className="px-3 py-2.5 font-mono-num">{v.date}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(v.sumValidShifts)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num font-semibold">{fmtNum(v.vdaScore, 1)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(v.sumDeliveredAdvanceTasks)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num text-amber-700 dark:text-amber-400">{fmtNum(v.deliveredOver55Min)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtKm(v.totalDeliveryDistance)} / {fmtKm(v.payableDistance)}</td>
                        <td className="px-3 py-2.5 font-mono-num text-slate-600 dark:text-slate-300">
                          {v.shiftsS1ToS6?.filter((s) => (s.scheduledShifts ?? 0) > 0 || (s.validShifts ?? 0) > 0).map((s) => `${s.slot}(${s.validShifts ?? 0}/${s.scheduledShifts ?? 0})`).join(' · ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {ktRank.length > 0 && (
            <Card className="space-y-3">
              <SectionHeader title="السجل التاريخي للرتب والمكافآت (RankPlanProcess Snapshots)" />
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">تاريخ اللقطة</th>
                      <th className="px-3 py-2.5 text-right">المستوى المقدر</th>
                      <th className="px-3 py-2.5 text-center">Percentile</th>
                      <th className="px-3 py-2.5 text-center">Forced Score</th>
                      <th className="px-3 py-2.5 text-center">On-time %</th>
                      <th className="px-3 py-2.5 text-center">Completion %</th>
                      <th className="px-3 py-2.5 text-center">المكافأة المقدرة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ktRank.map((rk) => (
                      <tr key={rk.recordKey}>
                        <td className="px-3 py-2.5 font-mono-num">{rk.snapshotDate}</td>
                        <td className="px-3 py-2.5 font-semibold text-blue-700 dark:text-blue-400">{rk.currentEstimatedLevel || '-'}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(rk.rankingPercentile, 1)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(rk.forcedAssignmentScore, 1)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(rk.onTimeRate)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtPct(rk.orderCompletionRate)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num text-emerald-700 dark:text-emerald-400">{fmtCurrency(rk.estimatedRewardAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {ktFace.length > 0 && (
            <Card className="space-y-3">
              <SectionHeader title="سجل التحقق من الهوية بالوجه (Facial Recognition Daily Log & MTD)" />
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-right">التاريخ (dt)</th>
                      <th className="px-3 py-2.5 text-right">النتيجة النهائية</th>
                      <th className="px-3 py-2.5 text-center">if_triggered_today</th>
                      <th className="px-3 py-2.5 text-center">أيام التفعيل / الاجتياز MTD</th>
                      <th className="px-3 py-2.5 text-center">Pass Rate MTD</th>
                      <th className="px-3 py-2.5 text-center">Over 90%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ktFace.map((f) => (
                      <tr key={f.recordKey}>
                        <td className="px-3 py-2.5 font-mono-num">{f.date}</td>
                        <td className="px-3 py-2.5 font-semibold">{f.finalInspectionResult || '-'}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num">
                          {f.ifTriggeredToday === null || f.ifTriggeredToday === undefined || f.ifTriggeredToday === '' ? 'غير متاح' : f.ifTriggeredTodayRaw || String(f.ifTriggeredToday)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono-num">{fmtNum(f.totalDaysTriggeredMtd)} / {fmtNum(f.totalDaysPassedMtd)}</td>
                        <td className="px-3 py-2.5 text-center font-mono-num font-semibold">{fmtPct(f.passRateMtd)}</td>
                        <td className="px-3 py-2.5 text-center">{f.over90PassRate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* NEW OPERATIONAL CASE DRAWER */}
      <SlideDrawer
        open={showNewOpCase && canManageErrors}
        onClose={() => setShowNewOpCase(false)}
        title={`فتح حالة تشغيلية جديدة — ${displayName}`}
        subtitle="تُرسل الحالة مباشرة إلى مركز التحكم التشغيلي للمتابعة"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNewOpCase(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="rider360-opcase-form" variant="primary" loading={opBusy}>
              تأكيد فتح الحالة
            </Button>
          </>
        }
      >
        <form id="rider360-opcase-form" onSubmit={handleCreateOpCase} className="space-y-4">
          <FormField label="عنوان الحالة" required>
            <Input
              type="text"
              required
              value={opTitle}
              onChange={(e) => setOpTitle(e.target.value)}
              placeholder="مثال: متابعة تراجع الأداء"
            />
          </FormField>
          <FormField label="الأولوية">
            <Select value={opPriority} onChange={(e) => setOpPriority(e.target.value as OperationalCasePriority)}>
              <option value="critical">حرج</option>
              <option value="high">مرتفع</option>
              <option value="medium">متوسط</option>
              <option value="low">منخفض</option>
            </Select>
          </FormField>
          <FormField label="تفاصيل المشكلة والإجراء المطلوب">
            <Textarea
              rows={4}
              value={opDesc}
              onChange={(e) => setOpDesc(e.target.value)}
              placeholder="صف المشكلة والإجراء الموصى به..."
            />
          </FormField>
        </form>
      </SlideDrawer>

      {/* ERROR CASE FOLLOWUP DRAWER */}
      <SlideDrawer
        open={Boolean(editingCaseEvent && canManageErrors)}
        onClose={() => setEditingCaseEvent(null)}
        title={`متابعة حالة الخطأ: ${editingCaseEvent?.normalizedCode || ''}`}
        subtitle={editingCaseEvent ? `التاريخ: ${editingCaseEvent.date} · Raw: ${editingCaseEvent.rawCode}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingCaseEvent(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="rider360-error-case-form" variant="primary" loading={caseBusy}>
              حفظ المتابعة
            </Button>
          </>
        }
      >
        <form id="rider360-error-case-form" onSubmit={handleSaveErrorCase} className="space-y-4">
          <FormField label="الحالة">
            <Select value={caseStatus} onChange={(e) => setCaseStatus(e.target.value as RiderErrorCaseStatus)}>
              <option value="open">مفتوح للمتابعة (Open)</option>
              <option value="in_review">قيد المراجعة (In Review)</option>
              <option value="resolved">تمت المعالجة (Resolved)</option>
            </Select>
          </FormField>
          <FormField label="الإجراء المتخذ">
            <Input
              type="text"
              value={caseAction}
              onChange={(e) => setCaseAction(e.target.value)}
              placeholder="تواصل مع المندوب / تحديث التطبيق..."
            />
          </FormField>
          <FormField label="ملاحظة تشغيلية">
            <Textarea
              rows={3}
              value={caseNote}
              onChange={(e) => setCaseNote(e.target.value)}
              placeholder="تفاصيل المتابعة..."
            />
          </FormField>
        </form>
      </SlideDrawer>
    </div>
  );
}
