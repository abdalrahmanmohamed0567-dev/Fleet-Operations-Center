import {
  FileDown,
  FileSpreadsheet,
  Image as ImageIcon,
  Printer,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { exportExcelInBrowser } from '../../lib/clientExcelFallback';
import {
  APPROVAL_STATUS_LABELS,
  DAMAGE_LIABILITY_LABELS,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_STATUS_LABELS,
  MAINTENANCE_WORKFLOW_LABELS,
  VEHICLE_SOURCE_LABELS,
  VEHICLE_STATUS_LABELS,
  type ExpiryWatchItem,
} from '../../lib/erpHelpers';
import type { VehicleAvailabilityItem } from '../../lib/fleetApi';
import { exportArabicTableToPdf } from '../../lib/pdfExport';
import type { ReportImageKpi } from '../../lib/reportImageExport';
import type { ExportColumn } from '../../shared/exportCore';
import type {
  CompanyBrandingDoc,
  RiderMaster,
  UserProfile,
  VehicleCustody,
  VehicleDamageClaim,
  VehicleDocumentRecord,
  VehicleHandoverRecord,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleReturnRecord,
  VehicleStatus,
} from '../../types/fleet';
import { DataTable, type TableColumn } from '../DataTable';
import { KpiCard } from '../KpiCard';
import { ReportImageShareModal } from '../ReportImageShareModal';
import { Button, Card, Input, SectionHeader, Select, ToastBanner } from '../ui/EnterpriseUI';

type FleetReportKind =
  | 'registry_readiness'
  | 'custodies_handovers'
  | 'returns_mileage'
  | 'maintenance_tco'
  | 'damage_claims'
  | 'docs_expiries';

const REPORT_DEFINITIONS: Array<{ key: FleetReportKind; label: string; subtitle: string }> = [
  {
    key: 'registry_readiness',
    label: 'سجل الأسطول والجاهزية',
    subtitle: 'بيانات المركبات والحالات التشغيلية والمستندات وموانع التسليم',
  },
  {
    key: 'custodies_handovers',
    label: 'العهد النشطة والتسليمات',
    subtitle: 'سجل العهد الفعالة والتاريخية ومحاضر التسليم المرتبطة بالمناديب',
  },
  {
    key: 'returns_mileage',
    label: 'محاضر الاستلام والمسافات',
    subtitle: 'فحوصات الإرجاع، المسافة المقطوعة بالعهدة، وحالة الأضرار',
  },
  {
    key: 'maintenance_tco',
    label: 'تكاليف الصيانة والتشغيل (TCO)',
    subtitle: 'ملخص أوامر الصيانة والتكلفة الفعلية وإجمالي مصروفات الأسطول',
  },
  {
    key: 'damage_claims',
    label: 'مطالبات الأضرار والحوادث',
    subtitle: 'تفاصيل الأضرار المرصودة وتحديد المسؤولية وحالة التسوية المالية',
  },
  {
    key: 'docs_expiries',
    label: 'الوثائق والتفويضات والانتهاء',
    subtitle: 'تواريخ انتهاء الاستمارة والتأمين والفحص الدوري والتفويضات',
  },
];

interface FleetReportsTabProps {
  vehicles: VehicleMaster[];
  availability: VehicleAvailabilityItem[];
  custodies: VehicleCustody[];
  handovers: VehicleHandoverRecord[];
  returns: VehicleReturnRecord[];
  maintenance: VehicleMaintenanceRecord[];
  damageClaims: VehicleDamageClaim[];
  vehicleDocuments: VehicleDocumentRecord[];
  fleetExpiries: ExpiryWatchItem[];
  riders: RiderMaster[];
  branding?: CompanyBrandingDoc | null;
  currentUser: UserProfile;
  canExport: boolean;
}

export function FleetReportsTab({
  vehicles,
  availability,
  custodies,
  handovers,
  returns,
  maintenance,
  damageClaims,
  vehicleDocuments,
  fleetExpiries,
  riders,
  branding,
  currentUser,
  canExport,
}: FleetReportsTabProps) {
  const [reportKind, setReportKind] = useState<FleetReportKind>('registry_readiness');
  const [cityFilter, setCityFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VehicleStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const cities = useMemo(() => Array.from(new Set(vehicles.map((v) => v.city || '').filter(Boolean))).sort(), [vehicles]);
  const branches = useMemo(() => Array.from(new Set(vehicles.map((v) => v.branch || '').filter(Boolean))).sort(), [vehicles]);
  const riderById = useMemo(() => new Map(riders.map((r) => [r.internalRiderId, r])), [riders]);
  const availByVehId = useMemo(() => new Map(availability.map((a) => [a.vehicleInternalId, a])), [availability]);
  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.vehicleInternalId, v])), [vehicles]);

  const scopedVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (cityFilter !== 'all' && (v.city || '') !== cityFilter) return false;
      if (branchFilter !== 'all' && (v.branch || '') !== branchFilter) return false;
      if (statusFilter !== 'all' && v.status !== statusFilter) return false;
      return true;
    });
  }, [vehicles, cityFilter, branchFilter, statusFilter]);

  const scopedVehIds = useMemo(() => new Set(scopedVehicles.map((v) => v.vehicleInternalId)), [scopedVehicles]);

  const inDateRange = (isoDate?: string) => {
    if (!isoDate) return !dateFrom && !dateTo;
    const d = isoDate.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const activeReportMeta = REPORT_DEFINITIONS.find((r) => r.key === reportKind) || REPORT_DEFINITIONS[0];

  const reportDataset = useMemo<{
    columns: ExportColumn[];
    rows: Array<Record<string, unknown>>;
    kpis: ReportImageKpi[];
  }>(() => {
    if (reportKind === 'registry_readiness') {
      const columns: ExportColumn[] = [
        { header: 'المعرف', key: 'id', width: 14 },
        { header: 'رقم اللوحة', key: 'plate', width: 14 },
        { header: 'الموديل', key: 'model', width: 22 },
        { header: 'المدينة / الفرع', key: 'location', width: 22 },
        { header: 'الملكية', key: 'source', width: 14 },
        { header: 'الحالة', key: 'status', width: 16 },
        { header: 'المندوب الحالي', key: 'rider', width: 22 },
        { header: 'الجاهزية', key: 'ready', width: 14 },
        { header: 'العداد', key: 'odo', width: 12 },
      ];
      const rows = scopedVehicles.map((v) => {
        const av = availByVehId.get(v.vehicleInternalId);
        const r = v.currentRiderId ? riderById.get(v.currentRiderId) : null;
        return {
          _key: v.vehicleInternalId,
          id: v.vehicleInternalId,
          plate: v.plateNumber,
          model: `${v.make} ${v.model} ${v.year || ''}`.trim(),
          location: [v.city, v.branch].filter(Boolean).join(' / ') || 'غير محدد',
          source: VEHICLE_SOURCE_LABELS[v.sourceType || 'owned'] || 'ملك الشركة',
          status: VEHICLE_STATUS_LABELS[v.status] || v.status,
          rider: r ? r.fullName : v.currentRiderId || 'غير مسلمة',
          ready: av?.readyToDispatch ? 'جاهزة للتسليم' : 'مقيدة',
          odo: v.currentOdometer ?? 0,
        };
      });
      const readyN = rows.filter((r) => r.ready === 'جاهزة للتسليم').length;
      const assignedN = scopedVehicles.filter((v) => v.status === 'assigned').length;
      return {
        columns,
        rows,
        kpis: [
          { label: 'إجمالي المركبات', value: String(rows.length) },
          { label: 'مسلمة بعهدة', value: String(assignedN) },
          { label: 'جاهزة للتسليم', value: String(readyN), tone: 'good' },
          { label: 'مقيدة / صيانة', value: String(rows.length - readyN), tone: 'warn' },
        ],
      };
    }

    if (reportKind === 'custodies_handovers') {
      const filteredCust = custodies.filter((c) => scopedVehIds.has(c.vehicleInternalId) && inDateRange(c.startedAt));
      const columns: ExportColumn[] = [
        { header: 'رقم العهدة', key: 'custNo', width: 14 },
        { header: 'اللوحة', key: 'plate', width: 14 },
        { header: 'المندوب', key: 'rider', width: 22 },
        { header: 'تاريخ البدء', key: 'start', width: 14 },
        { header: 'تاريخ الإغلاق', key: 'end', width: 14 },
        { header: 'عداد البدء', key: 'odoStart', width: 12 },
        { header: 'عداد الإغلاق', key: 'odoEnd', width: 12 },
        { header: 'الحالة', key: 'status', width: 14 },
      ];
      const rows = filteredCust.map((c) => ({
        _key: c.custodyId,
        custNo: c.custodyNumber,
        plate: c.plateNumber,
        rider: `${c.riderName} (${c.riderId})`,
        start: c.startedAt,
        end: c.endedAt || 'مستمرة',
        odoStart: c.startOdometer ?? '—',
        odoEnd: c.endOdometer ?? '—',
        status:
          c.status === 'active'
            ? 'نشطة'
            : c.status === 'transferred'
              ? 'منقولة'
              : c.status === 'pending_return'
                ? 'قيد الاستلام'
                : 'مغلقة',
      }));
      return {
        columns,
        rows,
        kpis: [
          { label: 'إجمالي العهد', value: String(rows.length) },
          { label: 'عهد نشطة', value: String(filteredCust.filter((c) => c.status === 'active').length), tone: 'good' },
          { label: 'عهد منقولة', value: String(filteredCust.filter((c) => c.status === 'transferred').length) },
          { label: 'محاضر التسليم', value: String(handovers.filter((h) => scopedVehIds.has(h.vehicleInternalId)).length) },
        ],
      };
    }

    if (reportKind === 'returns_mileage') {
      const filteredRet = returns.filter((r) => scopedVehIds.has(r.vehicleInternalId) && inDateRange(r.returnDate));
      const columns: ExportColumn[] = [
        { header: 'رقم المحضر', key: 'retNo', width: 14 },
        { header: 'اللوحة', key: 'plate', width: 14 },
        { header: 'المندوب', key: 'rider', width: 22 },
        { header: 'تاريخ الاستلام', key: 'date', width: 14 },
        { header: 'عداد الاستلام', key: 'odo', width: 14 },
        { header: 'المسافة المقطوعة', key: 'dist', width: 16 },
        { header: 'الأضرار', key: 'damage', width: 18 },
        { header: 'الاعتماد', key: 'status', width: 14 },
      ];
      const rows = filteredRet.map((r) => ({
        _key: r.returnId,
        retNo: r.returnNumber,
        plate: r.plateNumber,
        rider: r.riderName,
        date: r.returnDate,
        odo: r.odometerAtReturn ?? '—',
        dist: r.distanceDriven !== null && r.distanceDriven !== undefined ? `${r.distanceDriven} كم` : '—',
        damage: r.damageDetected ? r.damageSummary || 'مرصود ضرر' : 'سليمة',
        status: r.status === 'completed' ? 'مغلق ومعتمد' : 'بانتظار الاعتماد',
      }));
      const totalKm = filteredRet.reduce((acc, r) => acc + (r.distanceDriven || 0), 0);
      const dmgCount = filteredRet.filter((r) => r.damageDetected).length;
      return {
        columns,
        rows,
        kpis: [
          { label: 'محاضر الاستلام', value: String(rows.length) },
          { label: 'المسافة المقطوعة', value: `${totalKm.toLocaleString('en-US')} كم` },
          { label: 'حالات مرصود بها ضرر', value: String(dmgCount), tone: dmgCount > 0 ? 'critical' : 'good' },
          { label: 'بانتظار الاعتماد', value: String(filteredRet.filter((r) => r.status !== 'completed').length), tone: 'warn' },
        ],
      };
    }

    if (reportKind === 'maintenance_tco') {
      const filteredMaint = maintenance.filter((m) => scopedVehIds.has(m.vehicleInternalId) && inDateRange(m.maintenanceDate));
      const columns: ExportColumn[] = [
        { header: 'أمر العمل', key: 'wo', width: 14 },
        { header: 'اللوحة', key: 'plate', width: 14 },
        { header: 'تاريخ الصيانة', key: 'date', width: 14 },
        { header: 'النوع', key: 'type', width: 22 },
        { header: 'الورشة', key: 'workshop', width: 18 },
        { header: 'التكلفة التقديرية', key: 'est', width: 16 },
        { header: 'التكلفة الفعلية', key: 'actual', width: 16 },
        { header: 'حالة العمل', key: 'wf', width: 16 },
      ];
      const rows = filteredMaint.map((m) => ({
        _key: m.maintenanceId,
        wo: m.workOrderNumber || m.maintenanceId.slice(0, 10),
        plate: m.plateNumber,
        date: m.maintenanceDate,
        type: m.maintenanceType,
        workshop: m.workshop || 'غير محدد',
        est: m.estimatedCost ?? m.cost ?? 0,
        actual: m.actualCost ?? m.cost ?? 0,
        wf: MAINTENANCE_WORKFLOW_LABELS[m.workflowStatus || 'completed'] || m.workflowStatus || 'مكتمل',
      }));
      const totalActual = filteredMaint.reduce((acc, m) => acc + (m.actualCost ?? m.cost ?? 0), 0);
      const openWo = filteredMaint.filter((m) => m.workflowStatus !== 'completed' && m.workflowStatus !== 'cancelled').length;
      return {
        columns,
        rows,
        kpis: [
          { label: 'أوامر الصيانة', value: String(rows.length) },
          { label: 'إجمالي التكلفة', value: `${totalActual.toLocaleString('en-US')} ر.س` },
          { label: 'أوامر مفتوحة', value: String(openWo), tone: openWo > 0 ? 'warn' : 'good' },
          { label: 'متوسط تكلفة الأمر', value: rows.length > 0 ? `${Math.round(totalActual / rows.length).toLocaleString('en-US')} ر.س` : '0 ر.س' },
        ],
      };
    }

    if (reportKind === 'damage_claims') {
      const filteredClaims = damageClaims.filter((c) => scopedVehIds.has(c.vehicleInternalId) && inDateRange(c.createdAt));
      const columns: ExportColumn[] = [
        { header: 'رقم البلاغ', key: 'clmNo', width: 14 },
        { header: 'اللوحة', key: 'plate', width: 14 },
        { header: 'المندوب', key: 'rider', width: 20 },
        { header: 'الشدة', key: 'sev', width: 14 },
        { header: 'الوصف', key: 'desc', width: 28 },
        { header: 'المسؤولية', key: 'liab', width: 16 },
        { header: 'التكلفة (ر.س)', key: 'cost', width: 14 },
        { header: 'الحالة', key: 'status', width: 14 },
      ];
      const rows = filteredClaims.map((c) => ({
        _key: c.claimId,
        clmNo: c.claimNumber,
        plate: c.plateNumber,
        rider: c.riderName || 'غير محدد',
        sev: DAMAGE_SEVERITY_LABELS[c.severity] || c.severity,
        desc: c.description,
        liab: DAMAGE_LIABILITY_LABELS[c.liability] || c.liability,
        cost: c.actualRepairCost ?? c.estimatedRepairCost ?? 0,
        status: DAMAGE_STATUS_LABELS[c.status] || c.status,
      }));
      const totalCost = filteredClaims.reduce((acc, c) => acc + (c.actualRepairCost ?? c.estimatedRepairCost ?? 0), 0);
      const openN = filteredClaims.filter((c) => c.status !== 'settled' && c.status !== 'closed').length;
      return {
        columns,
        rows,
        kpis: [
          { label: 'إجمالي البلاغات', value: String(rows.length) },
          { label: 'بلاغات مفتوحة', value: String(openN), tone: openN > 0 ? 'critical' : 'good' },
          { label: 'على المندوبين', value: String(filteredClaims.filter((c) => c.liability === 'rider').length) },
          { label: 'إجمالي التكلفة', value: `${totalCost.toLocaleString('en-US')} ر.س` },
        ],
      };
    }

    // docs_expiries
    const scopedExpiries = fleetExpiries.filter((e) => scopedVehIds.has(e.entityId));
    const columns: ExportColumn[] = [
      { header: 'المركبة', key: 'entity', width: 22 },
      { header: 'نوع الوثيقة', key: 'cat', width: 20 },
      { header: 'رقم الوثيقة', key: 'num', width: 18 },
      { header: 'تاريخ الانتهاء', key: 'exp', width: 14 },
      { header: 'المتبقي (يوم)', key: 'rem', width: 14 },
      { header: 'درجة الأهمية', key: 'urg', width: 16 },
    ];
    const rows = scopedExpiries.map((e) => ({
      _key: e.id,
      entity: e.entityName,
      cat: e.docCategory,
      num: e.docNumber || '—',
      exp: e.expiryDate,
      rem: e.daysRemaining,
      urg:
        e.daysRemaining < 0
          ? 'منتهي'
          : e.daysRemaining <= 7
            ? 'حرج (≤7ي)'
            : e.daysRemaining <= 30
              ? 'قريب (≤30ي)'
              : 'ساري',
    }));
    const expiredN = scopedExpiries.filter((e) => e.daysRemaining < 0).length;
    const within30 = scopedExpiries.filter((e) => e.daysRemaining >= 0 && e.daysRemaining <= 30).length;
    return {
      columns,
      rows,
      kpis: [
        { label: 'إجمالي الوثائق', value: String(rows.length) },
        { label: 'وثائق منتهية', value: String(expiredN), tone: expiredN > 0 ? 'critical' : 'good' },
        { label: 'تنتهي خلال 30 يوم', value: String(within30), tone: within30 > 0 ? 'warn' : 'good' },
        { label: 'وثائق مهيكلة معتمدة', value: String(vehicleDocuments.filter((d) => scopedVehIds.has(d.vehicleInternalId) && d.approvalStatus === 'approved').length) },
      ],
    };
  }, [reportKind, scopedVehicles, availByVehId, riderById, custodies, handovers, returns, maintenance, damageClaims, fleetExpiries, vehicleDocuments, scopedVehIds, dateFrom, dateTo]);

  const tableColumns: TableColumn<Record<string, unknown>>[] = useMemo(
    () =>
      reportDataset.columns.map((c) => ({
        key: c.key,
        header: c.header,
        sortValue: (row) => String(row[c.key] ?? ''),
        render: (row) => (
          <span className="text-xs font-mono-num text-slate-800 dark:text-slate-200">
            {row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? '—' : String(row[c.key])}
          </span>
        ),
      })),
    [reportDataset.columns]
  );

  const periodLabel = dateFrom || dateTo ? `الفترة: ${dateFrom || 'البداية'} ← ${dateTo || 'اليوم'}` : 'كامل الفترة المسجلة';

  const handleExportExcel = async () => {
    setBusy(true);
    setToast(null);
    try {
      await exportExcelInBrowser({
        title: `${activeReportMeta.label} — مركز إدارة الأسطول`,
        sheetName: activeReportMeta.label,
        columns: reportDataset.columns,
        rows: reportDataset.rows,
        metadataLines: [
          `المدينة: ${cityFilter === 'all' ? 'الكل' : cityFilter}`,
          `الفرع: ${branchFilter === 'all' ? 'الكل' : branchFilter}`,
          periodLabel,
          `أعدّه: ${currentUser.email}`,
        ],
        fileName: `fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
      setToast({ type: 'ok', text: `تم تصدير تقرير (${activeReportMeta.label}) بصيغة Excel بنجاح.` });
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تصدير Excel.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportPdf = async () => {
    setBusy(true);
    setToast(null);
    try {
      await exportArabicTableToPdf({
        title: activeReportMeta.label,
        subtitle: `${activeReportMeta.subtitle} · ${periodLabel}`,
        columns: reportDataset.columns,
        rows: reportDataset.rows,
        fileName: `fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.pdf`,
        branding,
        orientation: reportDataset.columns.length >= 7 ? 'landscape' : 'portrait',
        preparer: currentUser.displayName || currentUser.email,
      });
      setToast({ type: 'ok', text: `تم تنزيل ملف PDF (${activeReportMeta.label}) بنجاح.` });
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تصدير PDF.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-700 dark:text-slate-200 ml-1">نوع التقرير:</span>
          {REPORT_DEFINITIONS.map((def) => (
            <Button
              key={def.key}
              size="sm"
              variant={reportKind === def.key ? 'primary' : 'secondary'}
              onClick={() => setReportKind(def.key)}
            >
              {def.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <Select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="h-9 text-xs">
            <option value="all">كل المدن</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="h-9 text-xs">
            <option value="all">كل الفروع</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | VehicleStatus)} className="h-9 text-xs">
            <option value="all">كل حالات المركبات</option>
            {(['available', 'assigned', 'reserved', 'pending_return_inspection', 'maintenance', 'stopped', 'retired'] as VehicleStatus[]).map(
              (st) => (
                <option key={st} value={st}>
                  {VEHICLE_STATUS_LABELS[st]}
                </option>
              )
            )}
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-xs font-mono-num" title="من تاريخ" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-xs font-mono-num" title="إلى تاريخ" />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {reportDataset.kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} tone={k.tone || 'neutral'} />
        ))}
      </div>

      {toast && <ToastBanner type={toast.type} message={toast.text} onDismiss={() => setToast(null)} />}

      <Card>
        <SectionHeader
          title={`${activeReportMeta.label} (${reportDataset.rows.length})`}
          subtitle={activeReportMeta.subtitle}
          actions={
            canExport && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" loading={busy} icon={<ImageIcon className="h-3.5 w-3.5" />} onClick={() => setImageModalOpen(true)}>
                  صورة شيك ومشاركة (واتساب/تيليجرام)
                </Button>
                <Button size="sm" variant="secondary" loading={busy} icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => void handleExportExcel()}>
                  Excel (.xlsx)
                </Button>
                <Button size="sm" variant="secondary" loading={busy} icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void handleExportPdf()}>
                  PDF عربي
                </Button>
                <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>
                  طباعة
                </Button>
              </div>
            )
          }
          className="mb-3"
        />

        <DataTable
          tableId={`fleet_report_${reportKind}`}
          rows={reportDataset.rows}
          columns={tableColumns}
          rowKey={(r) => String(r._key || Math.random())}
          searchPlaceholder="ابحث داخل التقرير..."
          searchText={(r) => Object.values(r).join(' ')}
        />
      </Card>

      <ReportImageShareModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        title={activeReportMeta.label}
        subtitle={activeReportMeta.subtitle}
        columns={reportDataset.columns}
        rows={reportDataset.rows}
        fileName={`fleet_${reportKind}_${new Date().toISOString().slice(0, 10)}.png`}
        branding={branding}
        preparer={currentUser.displayName || currentUser.email}
        periodLabel={periodLabel}
        kpis={reportDataset.kpis}
      />
    </div>
  );
}
