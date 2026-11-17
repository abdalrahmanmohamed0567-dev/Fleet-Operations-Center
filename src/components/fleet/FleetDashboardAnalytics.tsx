import {
  AlertTriangle,
  Bell,
  Car,
  CheckCheck,
  Clock,
  FileWarning,
  Filter,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { VEHICLE_SOURCE_LABELS, VEHICLE_STATUS_LABELS, type ExpiryWatchItem } from '../../lib/erpHelpers';
import { markFleetNotificationsRead, type VehicleAvailabilityItem } from '../../lib/fleetApi';
import type {
  FleetApprovalRequest,
  FleetConfigSettings,
  FleetNotificationRecord,
  UserProfile,
  VehicleDamageClaim,
  VehicleDocumentRecord,
  VehicleHandoverRecord,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleMovementHistoryEntry,
  VehicleReturnRecord,
  VehicleStatus,
  VehicleStatusHistoryEntry,
} from '../../types/fleet';
import { KpiCard } from '../KpiCard';
import { Button, Card, EmptyState, SectionHeader, Select, StatusBadge, type BadgeTone } from '../ui/EnterpriseUI';

const PRIMARY_STATUSES: VehicleStatus[] = [
  'available',
  'assigned',
  'reserved',
  'pending_return_inspection',
  'maintenance',
  'stopped',
  'retired',
];

const STATUS_CHART_COLORS: Record<string, string> = {
  available: '#16A34A',
  assigned: '#2563EB',
  reserved: '#D97706',
  pending_return_inspection: '#EA580C',
  maintenance: '#F59E0B',
  stopped: '#DC2626',
  retired: '#64748B',
};

function vehicleStatusTone(status: VehicleStatus): BadgeTone {
  if (status === 'available') return 'success';
  if (status === 'assigned') return 'info';
  if (status === 'reserved' || status === 'pending_return_inspection' || status === 'maintenance') return 'warning';
  if (status === 'stopped' || status === 'retired') return 'danger';
  return 'neutral';
}

interface FleetDashboardAnalyticsProps {
  vehicles: VehicleMaster[];
  availability: VehicleAvailabilityItem[];
  approvals: FleetApprovalRequest[];
  handovers: VehicleHandoverRecord[];
  returns: VehicleReturnRecord[];
  maintenance: VehicleMaintenanceRecord[];
  damageClaims: VehicleDamageClaim[];
  vehicleDocuments: VehicleDocumentRecord[];
  notifications: FleetNotificationRecord[];
  movementHistory: VehicleMovementHistoryEntry[];
  statusHistory: VehicleStatusHistoryEntry[];
  fleetExpiries: ExpiryWatchItem[];
  fleetConfig?: FleetConfigSettings;
  currentUser: UserProfile;
  onNavigateTab: (tab: 'fleet_vehicles' | 'fleet_assignments' | 'fleet_approvals' | 'fleet_handover' | 'fleet_docs' | 'fleet_maintenance') => void;
  onFilterVehicles: (status: 'all' | VehicleStatus, readiness: 'all' | 'ready' | 'blocked') => void;
  onOpenVehicle360: (vehicleId: string) => void;
  onNotificationsUpdated?: (next: FleetNotificationRecord[]) => void;
}

export function FleetDashboardAnalytics({
  vehicles,
  availability,
  approvals,
  handovers,
  returns,
  maintenance,
  damageClaims,
  vehicleDocuments,
  notifications,
  movementHistory,
  statusHistory,
  fleetExpiries,
  fleetConfig,
  currentUser,
  onNavigateTab,
  onFilterVehicles,
  onOpenVehicle360,
  onNotificationsUpdated,
}: FleetDashboardAnalyticsProps) {
  const [cityFilter, setCityFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const [markingRead, setMarkingRead] = useState(false);

  const filterOptions = useMemo(() => {
    const cities = Array.from(new Set(vehicles.map((v) => v.city || '').filter(Boolean))).sort();
    const branches = Array.from(new Set(vehicles.map((v) => v.branch || '').filter(Boolean))).sort();
    const types = Array.from(new Set(vehicles.map((v) => v.vehicleType || '').filter(Boolean))).sort();
    return { cities, branches, types };
  }, [vehicles]);

  const scopedVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (cityFilter !== 'all' && (v.city || '') !== cityFilter) return false;
      if (branchFilter !== 'all' && (v.branch || '') !== branchFilter) return false;
      if (typeFilter !== 'all' && (v.vehicleType || '') !== typeFilter) return false;
      const src = v.sourceType || (v.ownershipType === 'leased' ? 'leased' : 'owned');
      if (sourceFilter !== 'all' && src !== sourceFilter) return false;
      return true;
    });
  }, [vehicles, cityFilter, branchFilter, typeFilter, sourceFilter]);

  const scopedVehIdSet = useMemo(() => new Set(scopedVehicles.map((v) => v.vehicleInternalId)), [scopedVehicles]);
  const scopedAvailability = useMemo(
    () => availability.filter((a) => scopedVehIdSet.has(a.vehicleInternalId)),
    [availability, scopedVehIdSet]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<VehicleStatus, number> = {
      available: 0,
      assigned: 0,
      reserved: 0,
      pending_return_inspection: 0,
      maintenance: 0,
      stopped: 0,
      retired: 0,
      leased_out: 0,
      out_of_service: 0,
      ended: 0,
    };
    for (const v of scopedVehicles) {
      counts[v.status] = (counts[v.status] || 0) + 1;
    }
    return counts;
  }, [scopedVehicles]);

  const scopedMaint = useMemo(
    () => maintenance.filter((m) => scopedVehIdSet.has(m.vehicleInternalId)),
    [maintenance, scopedVehIdSet]
  );
  const scopedClaims = useMemo(
    () => damageClaims.filter((c) => scopedVehIdSet.has(c.vehicleInternalId)),
    [damageClaims, scopedVehIdSet]
  );
  const scopedReturns = useMemo(
    () => returns.filter((r) => scopedVehIdSet.has(r.vehicleInternalId)),
    [returns, scopedVehIdSet]
  );
  const scopedHandovers = useMemo(
    () => handovers.filter((h) => scopedVehIdSet.has(h.vehicleInternalId)),
    [handovers, scopedVehIdSet]
  );

  const kpis = useMemo(() => {
    const total = scopedVehicles.length;
    const assigned = statusCounts.assigned;
    const utilizationPct = total > 0 ? Math.round((assigned / total) * 100) : 0;
    const readyCount = scopedAvailability.filter((a) => a.readyToDispatch).length;
    const blockedCount = scopedAvailability.filter((a) => !a.readyToDispatch).length;
    const totalMaintCost = scopedMaint.reduce((acc, m) => acc + (m.actualCost ?? m.cost ?? 0), 0);
    const totalClaimCost = scopedClaims.reduce((acc, c) => acc + (c.actualRepairCost ?? c.estimatedRepairCost ?? 0), 0);
    const totalDrivenKm = scopedReturns.reduce((acc, r) => acc + (r.distanceDriven || 0), 0);
    const openApprovals = approvals.filter(
      (a) => scopedVehIdSet.has(a.vehicleInternalId) && ['pending_operations', 'pending_admin', 'pending_delegation', 'approved'].includes(a.status)
    ).length;
    const pendingReturns = scopedReturns.filter((r) => r.status === 'pending_inspection' || r.status === 'pending_approval').length;
    const criticalDocs = fleetExpiries.filter(
      (e) => scopedVehIdSet.has(e.entityId) && (e.urgency === 'expired' || e.urgency === 'due_today' || e.urgency === 'within_7' || e.urgency === 'within_30')
    ).length;
    return {
      total,
      assigned,
      utilizationPct,
      readyCount,
      blockedCount,
      totalMaintCost,
      totalClaimCost,
      totalDrivenKm,
      openApprovals,
      pendingReturns,
      criticalDocs,
      openClaims: scopedClaims.filter((c) => c.status !== 'closed' && c.status !== 'settled').length,
    };
  }, [scopedVehicles, statusCounts, scopedAvailability, scopedMaint, scopedClaims, scopedReturns, approvals, scopedVehIdSet, fleetExpiries]);

  // Logistics Intelligence: Preventive Maintenance Due Watchlist + Expiring Delegations
  const preventiveMaintDue = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const alertDays = fleetConfig?.maintenanceAlertDays ?? 14;
    const alertKm = fleetConfig?.maintenanceAlertKm ?? 1000;
    const cutoffDate = new Date(Date.now() + alertDays * 86400000).toISOString().slice(0, 10);

    const latestByVeh = new Map<string, VehicleMaintenanceRecord>();
    for (const m of scopedMaint) {
      if (!m.nextMaintenanceDate && !m.nextMaintenanceOdometer) continue;
      const prev = latestByVeh.get(m.vehicleInternalId);
      if (!prev || String(m.maintenanceDate).localeCompare(String(prev.maintenanceDate)) > 0) {
        latestByVeh.set(m.vehicleInternalId, m);
      }
    }

    const alerts: Array<{ vehicle: VehicleMaster; reason: string; urgent: boolean }> = [];
    for (const v of scopedVehicles) {
      if (v.status === 'retired') continue;
      const m = latestByVeh.get(v.vehicleInternalId);
      if (!m) continue;
      if (m.nextMaintenanceDate && m.nextMaintenanceDate <= cutoffDate) {
        alerts.push({
          vehicle: v,
          reason: m.nextMaintenanceDate < todayIso ? `متأخرة منذ ${m.nextMaintenanceDate}` : `موعد قادم ${m.nextMaintenanceDate}`,
          urgent: m.nextMaintenanceDate <= todayIso,
        });
      } else if (
        m.nextMaintenanceOdometer &&
        v.currentOdometer !== undefined &&
        v.currentOdometer !== null &&
        m.nextMaintenanceOdometer - v.currentOdometer <= alertKm
      ) {
        const diff = m.nextMaintenanceOdometer - v.currentOdometer;
        alerts.push({
          vehicle: v,
          reason: diff <= 0 ? `تجاوز العداد (${v.currentOdometer}/${m.nextMaintenanceOdometer} كم)` : `متبقي ${diff} كم للصيانة`,
          urgent: diff <= 0,
        });
      }
    }
    return alerts;
  }, [scopedMaint, scopedVehicles, fleetConfig]);

  const expiringDelegations = useMemo(() => {
    const maxDays = Math.max(...(fleetConfig?.delegationAlertDays || [15, 7]));
    const todayMs = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    return vehicleDocuments
      .filter((d) => scopedVehIdSet.has(d.vehicleInternalId) && d.docCategory === 'delegation' && d.expiryDate && d.approvalStatus !== 'rejected')
      .map((d) => {
        const expMs = Date.parse(`${d.expiryDate}T00:00:00Z`);
        const days = Number.isNaN(expMs) ? 999 : Math.round((expMs - todayMs) / 86400000);
        return { doc: d, days };
      })
      .filter((x) => x.days <= maxDays)
      .sort((a, b) => a.days - b.days);
  }, [vehicleDocuments, scopedVehIdSet, fleetConfig]);

  // Chart 1: Status Distribution
  const statusChartData = useMemo(
    () =>
      PRIMARY_STATUSES.map((st) => ({
        status: st,
        name: VEHICLE_STATUS_LABELS[st],
        value: statusCounts[st],
        color: STATUS_CHART_COLORS[st] || '#64748B',
      })).filter((d) => d.value > 0),
    [statusCounts]
  );

  // Chart 2: City / Branch Stacked Breakdown
  const locationChartData = useMemo(() => {
    const map = new Map<string, { label: string; assigned: number; available: number; unavailable: number }>();
    for (const v of scopedVehicles) {
      const label = [v.city, v.branch].filter(Boolean).join(' - ') || 'غير محدد';
      const entry = map.get(label) || { label, assigned: 0, available: 0, unavailable: 0 };
      if (v.status === 'assigned') entry.assigned += 1;
      else if (v.status === 'available') entry.available += 1;
      else entry.unavailable += 1;
      map.set(label, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.assigned + b.available + b.unavailable - (a.assigned + a.available + a.unavailable))
      .slice(0, 8);
  }, [scopedVehicles]);

  // Chart 3: Recent Activity Trend (Last 14 Days with events or daily buckets)
  const movementTrendData = useMemo(() => {
    const map = new Map<string, { date: string; handovers: number; returns: number; maintenance: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      map.set(d, { date: d.slice(5), handovers: 0, returns: 0, maintenance: 0 });
    }
    const ensure = (isoDate: string) => {
      if (!isoDate) return null;
      const key = isoDate.slice(0, 10);
      return map.get(key) || null;
    };
    for (const h of scopedHandovers) {
      const row = ensure(h.handoverDate);
      if (row) row.handovers += 1;
    }
    for (const r of scopedReturns) {
      const row = ensure(r.returnDate);
      if (row) row.returns += 1;
    }
    for (const m of scopedMaint) {
      const row = ensure(m.maintenanceDate);
      if (row) row.maintenance += 1;
    }
    return Array.from(map.values());
  }, [scopedHandovers, scopedReturns, scopedMaint]);

  // Chart 4: Top Cost Vehicles (Maintenance + Damage Claims)
  const topCostData = useMemo(() => {
    const map = new Map<string, { plate: string; maint: number; claims: number; total: number }>();
    for (const v of scopedVehicles) {
      map.set(v.vehicleInternalId, { plate: v.plateNumber, maint: 0, claims: 0, total: 0 });
    }
    for (const m of scopedMaint) {
      const row = map.get(m.vehicleInternalId);
      if (row) {
        const c = m.actualCost ?? m.cost ?? 0;
        row.maint += c;
        row.total += c;
      }
    }
    for (const cl of scopedClaims) {
      const row = map.get(cl.vehicleInternalId);
      if (row) {
        const c = cl.actualRepairCost ?? cl.estimatedRepairCost ?? 0;
        row.claims += c;
        row.total += c;
      }
    }
    return Array.from(map.values())
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [scopedVehicles, scopedMaint, scopedClaims]);

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter((n) => !n.vehicleInternalId || scopedVehIdSet.has(n.vehicleInternalId))
      .filter((n) => {
        const isRead = (n.readByUids || []).includes(currentUser.uid);
        if (notifFilter === 'unread' && isRead) return false;
        if (notifFilter === 'critical' && n.severity !== 'critical') return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [notifications, scopedVehIdSet, notifFilter, currentUser.uid]);

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (n) => (!n.vehicleInternalId || scopedVehIdSet.has(n.vehicleInternalId)) && !(n.readByUids || []).includes(currentUser.uid)
      ).length,
    [notifications, scopedVehIdSet, currentUser.uid]
  );

  const handleMarkNotifications = async (ids?: string[], markAll?: boolean) => {
    setMarkingRead(true);
    try {
      const res = await markFleetNotificationsRead({ notificationIds: ids, markAll });
      if (onNotificationsUpdated) onNotificationsUpdated(res.notifications);
    } catch {
      // silent fallback
    } finally {
      setMarkingRead(false);
    }
  };

  const hasFilters = cityFilter !== 'all' || branchFilter !== 'all' || typeFilter !== 'all' || sourceFilter !== 'all';

  return (
    <div className="space-y-5">
      {/* Interactive Dashboard Filter Strip */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Filter className="h-3.5 w-3.5 text-blue-600" />
            <span>تصفية لوحة القيادة اللحظية:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="w-36 h-8 text-xs">
              <option value="all">كل المدن</option>
              {filterOptions.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-40 h-8 text-xs">
              <option value="all">كل الفروع</option>
              {filterOptions.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-36 h-8 text-xs">
              <option value="all">كل أنواع المركبات</option>
              {filterOptions.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-36 h-8 text-xs">
              <option value="all">كل مصادر الملكية</option>
              <option value="owned">{VEHICLE_SOURCE_LABELS.owned}</option>
              <option value="leased">{VEHICLE_SOURCE_LABELS.leased}</option>
              <option value="other">{VEHICLE_SOURCE_LABELS.other}</option>
            </Select>
            {hasFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCityFilter('all');
                  setBranchFilter('all');
                  setTypeFilter('all');
                  setSourceFilter('all');
                }}
              >
                إعادة التصفية
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          label="إجمالي الأسطول"
          value={String(kpis.total)}
          subtext={`مسلمة: ${kpis.assigned} · متاحة: ${statusCounts.available}`}
          onClick={() => {
            onFilterVehicles('all', 'all');
            onNavigateTab('fleet_vehicles');
          }}
        />
        <KpiCard
          label="نسبة الإشغال والتشغيل"
          value={`${kpis.utilizationPct}%`}
          subtext={`جاهزة للتسليم: ${kpis.readyCount} · مقيدة: ${kpis.blockedCount}`}
          tone={kpis.utilizationPct >= 60 ? 'good' : 'neutral'}
          onClick={() => {
            onFilterVehicles('assigned', 'all');
            onNavigateTab('fleet_vehicles');
          }}
        />
        <KpiCard
          label="الاعتمادات والفحوصات"
          value={String(kpis.openApprovals + kpis.pendingReturns)}
          subtext={`اعتمادات: ${kpis.openApprovals} · إرجاع معلق: ${kpis.pendingReturns}`}
          tone={kpis.openApprovals + kpis.pendingReturns > 0 ? 'warn' : 'good'}
          onClick={() => onNavigateTab(kpis.pendingReturns > 0 ? 'fleet_handover' : 'fleet_approvals')}
        />
        <KpiCard
          label="المسافات المسجلة"
          value={`${kpis.totalDrivenKm.toLocaleString('en-US')} كم`}
          subtext={`محاضر تسليم: ${scopedHandovers.length} · إرجاع: ${scopedReturns.length}`}
          onClick={() => onNavigateTab('fleet_handover')}
        />
        <KpiCard
          label="الوثائق والتفويضات (≤30ي)"
          value={String(kpis.criticalDocs + expiringDelegations.length)}
          subtext={`وثائق حرجة: ${kpis.criticalDocs} · تفويض قريب: ${expiringDelegations.length}`}
          tone={kpis.criticalDocs + expiringDelegations.length > 0 ? 'critical' : 'good'}
          onClick={() => onNavigateTab('fleet_docs')}
        />
        <KpiCard
          label="إجمالي تكلفة الصيانة والأضرار"
          value={`${(kpis.totalMaintCost + kpis.totalClaimCost).toLocaleString('en-US')} ر.س`}
          subtext={`صيانة: ${kpis.totalMaintCost.toLocaleString('en-US')} · أضرار مفتوحة: ${kpis.openClaims}`}
          tone={kpis.openClaims > 0 ? 'warn' : 'neutral'}
          onClick={() => onNavigateTab('fleet_maintenance')}
        />
      </div>

      {/* Actionable Operational Watchlist */}
      {(kpis.openApprovals > 0 ||
        kpis.pendingReturns > 0 ||
        kpis.openClaims > 0 ||
        preventiveMaintDue.length > 0 ||
        expiringDelegations.length > 0) && (
        <Card padding="sm">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span>ملخص الإجراءات والتنبيهات الاستباقية:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {kpis.openApprovals > 0 && (
                <Button size="sm" variant="secondary" onClick={() => onNavigateTab('fleet_approvals')}>
                  اعتمادات وتفويضات معلقة ({kpis.openApprovals})
                </Button>
              )}
              {kpis.pendingReturns > 0 && (
                <Button size="sm" variant="secondary" onClick={() => onNavigateTab('fleet_handover')}>
                  استلامات بانتظار الاعتماد ({kpis.pendingReturns})
                </Button>
              )}
              {preventiveMaintDue.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => onNavigateTab('fleet_maintenance')}>
                  صيانة دورية مستحقة ({preventiveMaintDue.length})
                </Button>
              )}
              {expiringDelegations.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => onNavigateTab('fleet_assignments')}>
                  تفويضات تقارب الانتهاء ({expiringDelegations.length})
                </Button>
              )}
              {kpis.openClaims > 0 && (
                <Button size="sm" variant="secondary" onClick={() => onNavigateTab('fleet_maintenance')}>
                  مطالبات أضرار مفتوحة ({kpis.openClaims})
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader
            title="توزيع حالات المركبات"
            subtitle="اضغط على أي حالة للانتقال مباشرة لقائمة المركبات المطابقة"
            className="mb-3"
          />
          {statusChartData.length === 0 ? (
            <EmptyState title="لا توجد مركبات ضمن النطاق المحدد" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="h-56 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {statusChartData.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val: unknown) => [`${val} مركبة`, 'العدد']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {PRIMARY_STATUSES.map((st) => (
                  <div key={st} className="flex items-center justify-between py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        onFilterVehicles(st, 'all');
                        onNavigateTab('fleet_vehicles');
                      }}
                      className="hover:opacity-80 transition-opacity"
                    >
                      <StatusBadge label={VEHICLE_STATUS_LABELS[st]} tone={vehicleStatusTone(st)} />
                    </button>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                      {statusCounts[st]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="توزيع الأسطول حسب المدينة والفرع"
            subtitle="مقارنة المركبات المسلمة والمتاحة والمقيدة بكل فرع"
            className="mb-3"
          />
          {locationChartData.length === 0 ? (
            <EmptyState title="لا توجد بيانات فروع متاحة" />
          ) : (
            <div className="h-60 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={locationChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="assigned" name="مسلمة" stackId="a" fill="#2563EB" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="available" name="متاحة" stackId="a" fill="#16A34A" />
                  <Bar dataKey="unavailable" name="صيانة / محجوزة / متوقفة" stackId="a" fill="#D97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader
            title="حركة التسليم والاستلام والصيانة (آخر 14 يومًا)"
            subtitle="تتبع يومي لعمليات التسليم وإغلاق العهد وأوامر الصيانة"
            className="mb-3"
          />
          <div className="h-56 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={movementTrendData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="handovers" name="تسليم" fill="#2563EB" radius={[3, 3, 0, 0]} />
                <Bar dataKey="returns" name="استلام" fill="#16A34A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="maintenance" name="صيانة" fill="#D97706" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="أعلى المركبات تكلفة (الصيانة + الأضرار)"
            subtitle="تساعد في قرارات الإحلال أو تقليل الأعطال المتكررة"
            className="mb-3"
          />
          {topCostData.length === 0 ? (
            <EmptyState title="لا توجد تكاليف صيانة أو أضرار مسجلة بعد" subtitle="ستظهر المقارنة فور إغلاق أوامر الصيانة أو تسجيل مطالبات الأضرار." />
          ) : (
            <div className="h-56 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCostData} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="plate" tick={{ fontSize: 11 }} width={85} />
                  <Tooltip formatter={(val: unknown) => [`${Number(val || 0).toLocaleString('en-US')} ر.س`, 'التكلفة']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="maint" name="صيانة" stackId="cost" fill="#0F1E36" />
                  <Bar dataKey="claims" name="أضرار" stackId="cost" fill="#DC2626" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Operational Lists Row: Blocked Vehicles + Preventive Maint / Delegations + Notifications Center + Movement Feed */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <SectionHeader
            title="مركبات مقيدة أو مستحقة الصيانة"
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onFilterVehicles('all', 'blocked');
                  onNavigateTab('fleet_vehicles');
                }}
              >
                عرض المقيدة
              </Button>
            }
            className="mb-3"
          />
          {scopedAvailability.filter((a) => !a.readyToDispatch).length === 0 && preventiveMaintDue.length === 0 ? (
            <EmptyState
              title="الأسطول مستعد بالكامل"
              subtitle="جميع المركبات المتاحة مستوفية الوثائق والصيانة الدورية."
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-auto">
              {preventiveMaintDue.slice(0, 4).map((pm) => (
                <button
                  key={`pm_${pm.vehicle.vehicleInternalId}`}
                  type="button"
                  onClick={() => onOpenVehicle360(pm.vehicle.vehicleInternalId)}
                  className="w-full text-right flex items-center justify-between py-2.5 text-xs gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1"
                >
                  <div className="min-w-0">
                    <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Wrench className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <span>{pm.vehicle.plateNumber}</span>
                    </div>
                    <div className="text-[11px] text-amber-700 dark:text-amber-400 truncate">صيانة دورية: {pm.reason}</div>
                  </div>
                  <StatusBadge label={pm.urgent ? 'مستحقة الآن' : 'قريبة'} tone={pm.urgent ? 'danger' : 'warning'} />
                </button>
              ))}
              {scopedAvailability
                .filter((a) => !a.readyToDispatch)
                .slice(0, 6)
                .map((item) => (
                  <button
                    key={item.vehicleInternalId}
                    type="button"
                    onClick={() => onOpenVehicle360(item.vehicleInternalId)}
                    className="w-full text-right flex items-center justify-between py-2.5 text-xs gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1"
                  >
                    <div className="min-w-0">
                      <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Car className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>{item.plateNumber} · {item.make} {item.model}</span>
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 truncate">
                        {item.blockingReasons.join(' · ')}
                      </div>
                    </div>
                    <StatusBadge label={VEHICLE_STATUS_LABELS[item.status]} tone={vehicleStatusTone(item.status)} />
                  </button>
                ))}
            </div>
          )}
        </Card>

        {/* Fleet Notifications Center */}
        <Card>
          <SectionHeader
            title={`إشعارات الأسطول (${unreadCount} غير مقروء)`}
            actions={
              unreadCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={markingRead}
                  icon={<CheckCheck className="h-3.5 w-3.5" />}
                  onClick={() => void handleMarkNotifications(undefined, true)}
                >
                  قراءة الكل
                </Button>
              )
            }
            className="mb-2"
          />
          <div className="flex items-center gap-1.5 mb-3 text-xs">
            {[
              { k: 'all', l: 'الكل' },
              { k: 'unread', l: `غير المقروء (${unreadCount})` },
              { k: 'critical', l: 'الحرجة' },
            ].map((tab) => (
              <Button
                key={tab.k}
                size="sm"
                variant={notifFilter === tab.k ? 'primary' : 'secondary'}
                onClick={() => setNotifFilter(tab.k as typeof notifFilter)}
              >
                {tab.l}
              </Button>
            ))}
          </div>
          {filteredNotifications.length === 0 ? (
            <EmptyState title="لا توجد إشعارات في هذا التصنيف" subtitle="تظهر هنا تنبيهات الاعتمادات والأضرار وحالات المركبات." />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-auto">
              {filteredNotifications.slice(0, 10).map((n) => {
                const isRead = (n.readByUids || []).includes(currentUser.uid);
                const tone: BadgeTone = n.severity === 'critical' ? 'danger' : n.severity === 'warning' ? 'warning' : 'info';
                return (
                  <div
                    key={n.notificationId}
                    className={`py-2.5 px-1.5 text-xs flex items-start justify-between gap-2 ${
                      !isRead ? 'bg-blue-50/40 dark:bg-blue-950/20 rounded' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!isRead) void handleMarkNotifications([n.notificationId]);
                        if (n.vehicleInternalId) onOpenVehicle360(n.vehicleInternalId);
                      }}
                      className="text-right min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-1.5">
                        {n.severity === 'critical' ? (
                          <ShieldAlert className="h-3.5 w-3.5 text-red-600 shrink-0" />
                        ) : (
                          <Bell className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        )}
                        <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{n.titleAr}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{n.messageAr}</div>
                      <div className="text-[10px] text-slate-400 font-mono-num mt-0.5">
                        {n.createdAt.slice(0, 16).replace('T', ' ')}
                      </div>
                    </button>
                    <StatusBadge
                      label={isRead ? 'مقروء' : n.severity === 'critical' ? 'عاجل' : 'جديد'}
                      tone={isRead ? 'neutral' : tone}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Latest Movements & Expiries */}
        <Card>
          <SectionHeader
            title="أحدث الحركات وتغييرات الحالة"
            actions={
              <span className="font-mono-num text-[11px] text-slate-500 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {movementHistory.length + statusHistory.length} سجل
              </span>
            }
            className="mb-3"
          />
          {movementHistory.length === 0 && expiringDelegations.length === 0 ? (
            <EmptyState
              title="لا توجد حركات مسجلة بعد"
              subtitle="تُسجّل هنا كل حركة تسليم أو استلام أو صيانة أو اعتماد تلقائيًا."
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-auto">
              {expiringDelegations.slice(0, 3).map((d) => (
                <button
                  key={d.doc.vehicleDocId}
                  type="button"
                  onClick={() => onOpenVehicle360(d.doc.vehicleInternalId)}
                  className="w-full text-right py-2.5 text-xs flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                      <FileWarning className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">تفويض {d.doc.plateNumber}</span>
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-500">ينتهي: {d.doc.expiryDate}</div>
                  </div>
                  <StatusBadge label={d.days < 0 ? 'منتهي' : `${d.days}ي`} tone={d.days <= 3 ? 'danger' : 'warning'} />
                </button>
              ))}
              {movementHistory
                .filter((m) => scopedVehIdSet.has(m.vehicleInternalId))
                .slice(0, 7)
                .map((m) => (
                  <button
                    key={m.movementId}
                    type="button"
                    onClick={() => onOpenVehicle360(m.vehicleInternalId)}
                    className="w-full text-right py-2.5 text-xs flex items-start justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {m.plateNumber}: {m.summaryAr}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-num truncate">
                        {m.actorEmail} · {m.occurredAt.slice(0, 16).replace('T', ' ')}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
