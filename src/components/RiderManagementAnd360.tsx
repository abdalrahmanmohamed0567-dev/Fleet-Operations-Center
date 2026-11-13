import { ArrowRight, ClipboardPlus, Link2, MessageSquarePlus, Plus, Search, Trash2, UserCheck } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
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
import { extractHungerErrorEvents, type HungerErrorEvent } from '../lib/errorIntelligence';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
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
import type {
  ErrorCodeDictionaryEntry,
  OperationalCase,
  OperationalCasePriority,
  OperationalSettings,
  Platform,
  RiderErrorCase,
  RiderErrorCaseStatus,
  RiderIdentityMapping,
  RiderMaster,
  RiderNote,
  RiderNoteCategory,
  UserProfile,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';

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
  onSelectRider,
  onRefresh,
}: RiderManagementProps) {
  const canEdit =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.role === 'operations_manager' ||
    currentUser.role === 'supervisor';

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
    for (const m of dataset.riderMappings) {
      mappingIndex.set(`${m.platform}:${m.platformRiderId}`, m.internalRiderId);
    }

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
  }, [dataset, searchQuery]);

  const handleCreateInternalRider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !newRiderId.trim() || !newRiderName.trim()) return;
    const cleanId = newRiderId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
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
        onBack={() => onSelectRider(null)}
        onRefresh={onRefresh}
      />
    );
  }

  const rosterCols: TableColumn<(typeof platformRoster)[number]>[] = [
    {
      key: 'platform',
      header: 'المنصة',
      sortValue: (r) => r.platform,
      render: (r) => (
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}
        </span>
      ),
    },
    {
      key: 'riderId',
      header: 'معرف المنصة',
      sortValue: (r) => r.riderId,
      render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span>,
    },
    {
      key: 'name',
      header: 'الاسم',
      sortValue: (r) => r.name,
      render: (r) => <span>{r.name}</span>,
    },
    {
      key: 'internal',
      header: 'المعرف الداخلي للشركة',
      sortValue: (r) => r.internalRiderId,
      render: (r) =>
        r.internalRiderId ? (
          <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">{r.internalRiderId}</span>
        ) : (
          <span className="text-xs text-slate-400">غير مربوط يدويًا</span>
        ),
    },
    {
      key: 'loc',
      header: 'المدينة / الفرع / المشرف',
      render: (r) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {[r.city, r.branch, r.supervisor].filter(Boolean).join(' · ') || '-'}
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
        <button
          type="button"
          onClick={() => onSelectRider({ platform: r.platform, riderId: r.riderId })}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-900 hover:text-white dark:hover:bg-blue-600 whitespace-nowrap"
        >
          فتح ملف 360
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">إدارة المندوبين والربط اليدوي للهويات (Rider 360)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            يُحفظ معرف كل منصة بشكل مستقل، ويمكن إنشاء معرف داخلي للشركة وربط حسابات HungerStation وKeeta يدويًا لنفس المندوب.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم أو Rider ID أو المعرف الداخلي..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 pr-9 pl-3 text-sm text-slate-900 dark:text-slate-100 focus:border-slate-400 focus:outline-none"
          />
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            msg.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200'
              : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Create Internal Rider */}
          <form onSubmit={handleCreateInternalRider} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <UserCheck className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              <span>إنشاء معرف داخلي للشركة (riderMaster)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={newRiderId}
                onChange={(e) => setNewRiderId(e.target.value)}
                placeholder="المعرف الداخلي (مثال: EMP_1001)"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              <input
                type="text"
                required
                value={newRiderName}
                onChange={(e) => setNewRiderName(e.target.value)}
                placeholder="اسم المندوب الكامل"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              <input
                type="text"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="المدينة"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              <input
                type="text"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="الفرع"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              <input
                type="text"
                value={newSupervisor}
                onChange={(e) => setNewSupervisor(e.target.value)}
                placeholder="المشرف"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              <input
                type="text"
                value={newVehicle}
                onChange={(e) => setNewVehicle(e.target.value)}
                placeholder="نوع المركبة"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>حفظ المندوب الداخلي</span>
            </button>
          </form>

          {/* Manual Identity Linking */}
          <form onSubmit={handleLinkIdentity} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Link2 className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              <span>ربط معرفات المنصات يدويًا بنفس المندوب</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select
                required
                value={mapInternalId}
                onChange={(e) => setMapInternalId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              >
                <option value="">اختر المندوب الداخلي...</option>
                {dataset.riderMaster.map((rm) => (
                  <option key={rm.internalRiderId} value={rm.internalRiderId}>
                    {rm.internalRiderId} — {rm.fullName}
                  </option>
                ))}
              </select>
              <select
                value={mapPlatform}
                onChange={(e) => setMapPlatform(e.target.value as Platform)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              >
                <option value="hungerstation">HungerStation</option>
                <option value="keeta">Keeta</option>
              </select>
              <input
                type="text"
                required
                value={mapPlatformRiderId}
                onChange={(e) => setMapPlatformRiderId(e.target.value)}
                placeholder="Platform Rider / Courier ID"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy || dataset.riderMaster.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>ربط الحساب</span>
            </button>

            {dataset.riderMappings.length > 0 && (
              <div className="mt-3 max-h-28 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                {dataset.riderMappings.map((m) => (
                  <div key={m.mappingId} className="flex items-center justify-between px-3 py-1.5">
                    <span className="font-mono-num text-slate-700 dark:text-slate-300">
                      {m.internalRiderId} ⇄ {m.platform}:{m.platformRiderId}
                    </span>
                    <button
                      type="button"
                      onClick={() => setUnlinkTarget(m)}
                      className="text-red-600 dark:text-red-400 hover:text-red-800"
                      title="إلغاء الربط"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </form>
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
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  // Check if this platform rider is linked to an internalRiderId
  const directMapping = dataset.riderMappings.find(
    (m) => m.platform === platform && m.platformRiderId === riderId
  );
  const internalMaster: RiderMaster | undefined = directMapping
    ? dataset.riderMaster.find((rm) => rm.internalRiderId === directMapping.internalRiderId)
    : undefined;

  const linkedIds = directMapping
    ? dataset.riderMappings.filter((m) => m.internalRiderId === directMapping.internalRiderId)
    : [{ platform, platformRiderId: riderId }];

  const hungerIds = new Set(linkedIds.filter((x) => x.platform === 'hungerstation').map((x) => x.platformRiderId));
  const keetaIds = new Set(linkedIds.filter((x) => x.platform === 'keeta').map((x) => x.platformRiderId));

  const hsDaily = dataset.hungerDaily.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date));
  const hsDist = dataset.hungerDistanceDaily.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date));
  const hsWallet = dataset.hungerWalletSnapshots.filter((r) => hungerIds.has(r.riderId)).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  const hsQual = dataset.hungerQualityMonthly.filter((r) => hungerIds.has(r.riderId));

  const ktDash = dataset.keetaDashboardDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date));
  const ktVda = dataset.keetaVdaDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date));
  const ktRank = dataset.keetaRankSnapshots.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  const ktFace = dataset.keetaFacialRecognitionDaily.filter((r) => keetaIds.has(r.riderId)).sort((a, b) => b.date.localeCompare(a.date));

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

  // Latest day & month summary
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

  // Unified chronological trend chart
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

  // Notes & Operational Case Quick Create inside Rider 360
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span>العودة لقائمة المندوبين</span>
          </button>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">ملف المندوب 360° — {displayName}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono-num">
              المعرفات: {linkedIds.map((l) => `${l.platform}:${l.platformRiderId}`).join(' · ')}
            </span>
            {internalMaster && (
              <>
                <span>·</span>
                <span className="font-mono-num text-emerald-700 dark:text-emerald-400 font-semibold">داخلي: {internalMaster.internalRiderId}</span>
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

        <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={() => setShowNewOpCase((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 whitespace-nowrap"
            >
              <ClipboardPlus className="h-4 w-4" />
              <span>فتح حالة تشغيلية</span>
            </button>
          )}
        </div>
      </div>

      {showNewOpCase && canManageErrors && (
        <form onSubmit={handleCreateOpCase} className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">فتح حالة تشغيلية جديدة للمندوب {displayName}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <input
              type="text"
              required
              value={opTitle}
              onChange={(e) => setOpTitle(e.target.value)}
              placeholder="عنوان الحالة (مثال: متابعة تراجع الأداء)"
              className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
            />
            <select
              value={opPriority}
              onChange={(e) => setOpPriority(e.target.value as OperationalCasePriority)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
            >
              <option value="critical">حرج</option>
              <option value="high">مرتفع</option>
              <option value="medium">متوسط</option>
              <option value="low">منخفض</option>
            </select>
          </div>
          <textarea
            rows={2}
            value={opDesc}
            onChange={(e) => setOpDesc(e.target.value)}
            placeholder="تفاصيل المشكلة والإجراء المطلوب..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewOpCase(false)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={opBusy}
              className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white"
            >
              {opBusy ? 'جاري الإنشاء...' : 'تأكيد فتح الحالة'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <KpiCard label={`طلبات آخر يوم (${latestDate || '-'})`} value={fmtNum(todayOrders)} tone="good" />
        <KpiCard label={`طلبات الشهر (${latestMonth || '-'})`} value={fmtNum(monthOrders)} />
        <KpiCard label="إجمالي الطلبات التاريخي" value={fmtNum(totalOrdersAll)} />
        <KpiCard label="إجمالي ساعات العمل/الاتصال" value={fmtHours(totalHours)} />
        <KpiCard label="إجمالي المرفوضة" value={fmtNum(totalRejected)} tone={totalRejected > 0 ? 'warn' : 'neutral'} />
        <KpiCard label="إجمالي المسافة المقطوعة" value={fmtKm(totalKm)} />
        <KpiCard
          label="آخر رصيد محفظة (HS)"
          value={hsWallet[0] ? fmtCurrency(hsWallet[0].currentWallet) : 'غير متاح'}
          tone={hsWallet[0] && hsWallet[0].currentWallet < 0 ? 'critical' : 'neutral'}
        />
        <KpiCard
          label="جودة التسليم (HS)"
          value={hsQual[0]?.finalDeliveryQualityScore !== undefined ? `${fmtNum(hsQual[0].finalDeliveryQualityScore, 1)} (${hsQual[0].segment || '-'})` : 'غير متاح'}
        />
        <KpiCard
          label="التصنيف والمكافأة (Keeta)"
          value={ktRank[0] ? `${ktRank[0].currentEstimatedLevel || '-'} · ${fmtCurrency(ktRank[0].estimatedRewardAmount)}` : 'غير متاح'}
        />
        <KpiCard
          label="التحقق من الهوية (Keeta)"
          value={ktFace[0] ? `${ktFace[0].finalInspectionResult || '-'} (${fmtPct(ktFace[0].passRateMtd)})` : 'غير متاح'}
        />
      </div>

      {/* Transparent Weighted Performance Score Breakdown */}
      {performanceScore.components.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">تفصيل معادلة التقييم الموزون (Performance Score Breakdown)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{performanceScore.formulaNote}</p>
            </div>
            <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-slate-100">
              النتيجة: {performanceScore.totalScore}/100 ({performanceScore.band})
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {performanceScore.components.map((comp) => (
              <div key={comp.key} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 text-xs">
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
        </div>
      )}

      {/* Performance Trend Chart */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">اتجاه الأداء التاريخي (الطلبات والساعات اليومية)</h3>
        <div className="h-64 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="orders" name="الطلبات المكتملة" stroke="#1d4ed8" strokeWidth={2} />
              <Line type="monotone" dataKey="hours" name="ساعات العمل" stroke="#16a34a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Administrative Notes & Chronological Rider Timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">الملاحظات الإدارية والتشغيلية (Rider Notes)</h3>
            <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">{matchedNotes.length}</span>
          </div>
          {noteMsg && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-800 dark:text-slate-200">
              {noteMsg}
            </div>
          )}
          {canManageErrors && (
            <form onSubmit={handleAddRiderNote} className="space-y-2.5 text-xs">
              <div className="flex items-center gap-2">
                <select
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value as RiderNoteCategory)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                >
                  <option value="ops">ملاحظة تشغيلية</option>
                  <option value="admin">ملاحظة إدارية</option>
                  <option value="warning">تنبيه / إنذار</option>
                  <option value="commendation">إشادة / تميز</option>
                </select>
                <input
                  type="text"
                  required
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="أضف ملاحظة موثقة على ملف المندوب..."
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={noteBusy}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  <span>حفظ</span>
                </button>
              </div>
            </form>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {matchedNotes.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">لا توجد ملاحظات إدارية مسجلة بعد.</p>
            ) : (
              matchedNotes.map((n) => (
                <div key={n.noteId} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {n.category === 'warning' ? 'تنبيه' : n.category === 'commendation' ? 'إشادة' : n.category === 'admin' ? 'إداري' : 'تشغيلي'} ·{' '}
                      <span className="font-mono-num text-[11px] font-normal text-slate-500">{n.authorEmail}</span>
                    </span>
                    {(currentUser.role === 'owner' || currentUser.role === 'admin' || n.createdByUid === currentUser.uid) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(n)}
                        className="text-red-600 hover:text-red-800"
                        title="حذف الملاحظة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{n.content}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">السجل الزمني الموحد للمندوب (Timeline)</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">ورديات · أخطاء · حالات · ملاحظات</span>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {timelineItems.map((tl) => (
              <div key={tl.id} className="flex items-start gap-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-2.5 text-xs">
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
        </div>
      </div>

      {/* Historical Records Tables */}
      {/* Error History Section (HungerStation Error Intelligence) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">سجل الأخطاء التشغيلية (Error History — HungerStation)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              جميع أكواد الأخطاء المسجلة للمندوب وتكرارها وتواريخها وحالة المتابعة والإجراءات التشغيلية.
            </p>
          </div>
          <div className="font-mono-num text-xs text-slate-600 dark:text-slate-400">
            إجمالي الحالات: <span className="font-bold text-slate-900 dark:text-slate-100">{riderErrorEvents.length}</span> · أكواد مختلفة:{' '}
            <span className="font-bold text-slate-900 dark:text-slate-100">{riderErrorSummaryByCode.length}</span>
          </div>
        </div>

        {caseMsg && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200">
            {caseMsg}
          </div>
        )}

        {riderErrorEvents.length === 0 ? (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            لا توجد أكواد أخطاء مسجلة لهذا المندوب في تقارير HungerStation.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary by Code */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-right">الكود الموحد</th>
                    <th className="px-3 py-2 text-right">الوصف</th>
                    <th className="px-3 py-2 text-center">التكرار</th>
                    <th className="px-3 py-2 text-right">أول / آخر ظهور</th>
                    <th className="px-3 py-2 text-right">الإجراء التشغيلي المقترح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {riderErrorSummaryByCode.map((c) => (
                    <tr key={c.codeKey}>
                      <td className="px-3 py-2 font-mono-num font-bold text-slate-900 dark:text-slate-100">
                        {c.normalizedCode}
                        <div className="text-[11px] font-normal text-slate-400">Raw: {Array.from(c.rawExamples).join(', ')}</div>
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{c.displayTitle}</td>
                      <td className="px-3 py-2 text-center font-mono-num font-bold text-red-700 dark:text-red-400">{c.count}</td>
                      <td className="px-3 py-2 font-mono-num text-slate-600 dark:text-slate-300">{c.firstDate} → {c.lastDate}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.recommendedAction || 'بانتظار التوثيق في القاموس'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Inline Case Editor */}
            {editingCaseEvent && canManageErrors && (
              <form onSubmit={handleSaveErrorCase} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  متابعة الحالة: <span className="font-mono-num">{editingCaseEvent.normalizedCode}</span> بتاريخ{' '}
                  <span className="font-mono-num">{editingCaseEvent.date}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">الحالة</label>
                    <select
                      value={caseStatus}
                      onChange={(e) => setCaseStatus(e.target.value as RiderErrorCaseStatus)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="open">مفتوح للمتابعة (Open)</option>
                      <option value="in_review">قيد المراجعة (In Review)</option>
                      <option value="resolved">تمت المعالجة (Resolved)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">الإجراء المتخذ</label>
                    <input
                      type="text"
                      value={caseAction}
                      onChange={(e) => setCaseAction(e.target.value)}
                      placeholder="تواصل مع المندوب / تحديث التطبيق..."
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">ملاحظة تشغيلية</label>
                    <input
                      type="text"
                      value={caseNote}
                      onChange={(e) => setCaseNote(e.target.value)}
                      placeholder="تفاصيل المتابعة..."
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingCaseEvent(null)}
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={caseBusy}
                    className="rounded-md bg-slate-900 dark:bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
                  >
                    {caseBusy ? 'جاري الحفظ...' : 'حفظ المتابعة'}
                  </button>
                </div>
              </form>
            )}

            {/* Chronological Events with Actions/Notes */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-right">التاريخ</th>
                    <th className="px-3 py-2 text-right">الكود (Raw)</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                    <th className="px-3 py-2 text-right">الإجراء والملاحظات</th>
                    {canManageErrors && <th className="px-3 py-2 text-center">تحديث</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {riderErrorEvents.map((ev) => {
                    const st = ev.caseRecord?.status || 'open';
                    const stLabel =
                      st === 'resolved' ? 'تمت المعالجة' : st === 'in_review' ? 'قيد المراجعة' : 'مفتوح للمتابعة';
                    const stCls =
                      st === 'resolved'
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : st === 'in_review'
                          ? 'text-amber-700 dark:text-amber-400 font-semibold'
                          : 'text-slate-700 dark:text-slate-300 font-medium';
                    return (
                      <tr key={ev.eventKey}>
                        <td className="px-3 py-2 font-mono-num">{ev.date}</td>
                        <td className="px-3 py-2 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                          {ev.normalizedCode} <span className="text-slate-400 font-normal">({ev.rawCode})</span>
                        </td>
                        <td className={`px-3 py-2 ${stCls}`}>{stLabel}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {[ev.caseRecord?.actionTaken, ev.caseRecord?.operationalNote].filter(Boolean).join(' — ') || '-'}
                        </td>
                        {canManageErrors && (
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => startEditCase(ev)}
                              className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-900 hover:text-white dark:hover:bg-blue-600"
                            >
                              تحديث الحالة
                            </button>
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
      </div>

      {hsDaily.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">سجل HungerStation اليومي والمحفظة</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right">التاريخ</th>
                  <th className="px-3 py-2 text-center">مكتملة</th>
                  <th className="px-3 py-2 text-center">مقبولة</th>
                  <th className="px-3 py-2 text-center">ملغاة</th>
                  <th className="px-3 py-2 text-center">ساعات فعلية</th>
                  <th className="px-3 py-2 text-center">الحضور %</th>
                  <th className="px-3 py-2 text-center">القبول %</th>
                  <th className="px-3 py-2 text-center">No Shows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {hsDaily.map((r) => (
                  <tr key={r.recordKey}>
                    <td className="px-3 py-2 font-mono-num">{r.date}</td>
                    <td className="px-3 py-2 text-center font-mono-num font-semibold">{fmtNum(r.completedDeliveries)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.acceptedDeliveries)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.cancelledDeliveries)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtHours(r.actualWorkingHours)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.attendanceRate)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.acceptanceRate)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.noShows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ktDash.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">سجل Keeta اليومي (Dashboard · VDA · Facial)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right">التاريخ</th>
                  <th className="px-3 py-2 text-center">Delivered</th>
                  <th className="px-3 py-2 text-center">Rejected</th>
                  <th className="px-3 py-2 text-center">Online (س)</th>
                  <th className="px-3 py-2 text-center">Completion %</th>
                  <th className="px-3 py-2 text-center">On-time %</th>
                  <th className="px-3 py-2 text-center">Overdue</th>
                  <th className="px-3 py-2 text-center">On-Shift?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ktDash.map((r) => (
                  <tr key={r.recordKey}>
                    <td className="px-3 py-2 font-mono-num">{r.date}</td>
                    <td className="px-3 py-2 text-center font-mono-num font-semibold">{fmtNum(r.deliveredTasks)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtNum(r.rejectedTasks)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtHours(r.shiftOnlineHours)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.completionRate)}</td>
                    <td className="px-3 py-2 text-center font-mono-num">{fmtPct(r.onTimeRate)}</td>
                    <td className="px-3 py-2 text-center font-mono-num text-red-700 dark:text-red-400">{fmtNum(r.overdueOrderTasks)}</td>
                    <td className="px-3 py-2 text-center">{r.onShift || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
