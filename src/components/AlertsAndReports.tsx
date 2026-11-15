import { CloudUpload, Download, FileText, Printer, RotateCcw, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { exportExcelInBrowser } from '../lib/clientExcelFallback';
import { computeErrorCodeIntelligence, generateErrorIntelligenceAlerts } from '../lib/errorIntelligence';
import { auth, getDriveAccessToken, refreshDriveTokenWithPopup } from '../lib/firebase';
import {
  buildUnifiedDailyRows,
  fmtNum,
  fmtPct,
  generateOperationalAlerts,
  type FleetDataset,
  type UnifiedDailyRow,
} from '../lib/fleetAnalytics';
import { generateKeetaIntelligenceAlerts } from '../lib/keetaIntelligence';
import { exportArabicTableToPdf } from '../lib/pdfExport';
import { ApiHtmlFallbackError, safeParseJsonResponse } from '../lib/safeFetch';
import {
  computeBranchScorecards,
  computeRiderPerformanceScore,
  detectOperationalAnomalies,
} from '../lib/smartAnalytics';
import { computeAllDocumentExpiries, EMPLOYEE_HR_STATUS_LABELS, VEHICLE_STATUS_LABELS } from '../lib/erpHelpers';
import type { ExportColumn } from '../shared/exportCore';
import { isKeetaActive } from '../shared/rbacCore';
import type {
  AlertItem,
  AuditLog,
  CompanyBrandingDoc,
  CustomEntityRecord,
  CustomReportTemplate,
  DynamicFieldDefinition,
  ErrorCodeDictionaryEntry,
  FilterState,
  OperationalCase,
  OperationalSettings,
  Platform,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderErrorCase,
  SystemPageConfig,
  UserProfile,
  VehicleAssignment,
  VehicleMaintenanceRecord,
  VehicleMaster,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { CustomReportDesigner } from './CustomReportDesigner';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';
import {
  Button,
  Card,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  StatusBadge,
  Tabs,
  ToastBanner,
} from './ui/EnterpriseUI';

interface AlertsViewProps {
  dataset: FleetDataset;
  dictionaryEntries?: ErrorCodeDictionaryEntry[];
  riderErrorCases?: RiderErrorCase[];
  vehicles?: VehicleMaster[];
  privateDocs?: PrivateDocumentRecord[];
  platformAccounts?: PlatformAccount[];
  platformCatalog?: PlatformCatalogEntry[];
  settings: OperationalSettings;
  filters: FilterState;
  lockedPlatform?: Platform;
  onSelectRider: (platform: Platform, riderId: string) => void;
  onGoToSettings: () => void;
}

export function AlertsCenterView({
  dataset,
  dictionaryEntries = [],
  riderErrorCases = [],
  vehicles = [],
  privateDocs = [],
  platformAccounts = [],
  platformCatalog = [],
  settings,
  filters,
  lockedPlatform,
  onSelectRider,
  onGoToSettings,
}: AlertsViewProps) {
  const [sevFilter, setSevFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [catFilter, setCatFilter] = useState<string>('');
  const keetaActive = isKeetaActive(settings, platformCatalog);

  const effectiveFilters = useMemo(
    () => (lockedPlatform ? { ...filters, platform: lockedPlatform } : filters),
    [filters, lockedPlatform]
  );

  const alerts = useMemo(() => {
    const opsAlerts = generateOperationalAlerts(dataset, settings, effectiveFilters).filter(
      (a) => keetaActive || a.platform !== 'keeta'
    );
    const keetaAlerts =
      keetaActive && effectiveFilters.platform !== 'hungerstation'
        ? generateKeetaIntelligenceAlerts(dataset, settings, effectiveFilters)
        : [];
    const errorAlerts =
      effectiveFilters.platform !== 'keeta'
        ? generateErrorIntelligenceAlerts(
            computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, effectiveFilters),
            settings
          )
        : [];

    const erpAlerts: AlertItem[] = [];
    if (!lockedPlatform) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const expiries = computeAllDocumentExpiries({
        riders: dataset.riderMaster,
        vehicles,
        privateDocs,
        settings,
        refDateIso: todayIso,
      });
      for (const exp of expiries) {
        if (filters.branch && exp.branch && exp.branch !== filters.branch) continue;
        const isCritical = exp.urgency === 'expired' || exp.urgency === 'due_today' || exp.urgency === 'within_7';
        erpAlerts.push({
          id: `exp_${exp.entityType === 'vehicle' ? 'veh' : 'hr'}_${exp.id}`,
          severity: isCritical ? 'critical' : 'warning',
          category: exp.domain === 'fleet' ? 'انتهاء وثائق الأسطول' : 'انتهاء وثائق HR',
          date: exp.expiryDate,
          platform: 'hungerstation',
          riderId: exp.entityId,
          metricValue: `${exp.daysRemaining} يوم`,
          thresholdValue: '0-90 يوم',
          title:
            exp.daysRemaining < 0
              ? `وثيقة منتهية (${exp.docCategory}): ${exp.entityName}`
              : exp.daysRemaining === 0
                ? `تنتهي اليوم (${exp.docCategory}): ${exp.entityName}`
                : `وثيقة تقترب من الانتهاء (${exp.docCategory}) خلال ${exp.daysRemaining} يوم`,
          description: `${exp.entityType === 'vehicle' ? 'المركبة' : 'المندوب'}: ${exp.entityName}${exp.docNumber ? ` · رقم: ${exp.docNumber}` : ''} · تاريخ الانتهاء: ${exp.expiryDate}`,
        });
      }

      for (const acc of platformAccounts) {
        if (acc.linkingStatus !== 'conflict_review') continue;
        if (!keetaActive && acc.platformId === 'keeta') continue;
        erpAlerts.push({
          id: `conflict_${acc.accountId}`,
          severity: 'critical',
          category: 'تعارض ربط التطبيقات',
          date: todayIso,
          platform: acc.platformId === 'keeta' ? 'keeta' : 'hungerstation',
          riderId: acc.companyRiderId || acc.platformRiderId,
          metricValue: acc.platformRiderId,
          thresholdValue: 'مطابقة فريدة',
          title: `تعارض ملكية معرف ${acc.platformName} (${acc.platformRiderId})`,
          description: acc.notes || `معرف التطبيق ${acc.platformRiderId} يتطلب مراجعة واعتماد الربط.`,
        });
      }
    }

    const dedup = new Map<string, AlertItem>();
    for (const a of [...erpAlerts, ...errorAlerts, ...keetaAlerts, ...opsAlerts]) {
      if (!dedup.has(a.id)) dedup.set(a.id, a);
    }
    return Array.from(dedup.values()).sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }, [dataset, dictionaryEntries, riderErrorCases, vehicles, privateDocs, platformAccounts, settings, effectiveFilters, lockedPlatform, keetaActive, filters.branch]);

  const categories = useMemo(() => Array.from(new Set(alerts.map((a) => a.category))).sort(), [alerts]);
  const visible = alerts.filter((a) => {
    if (sevFilter !== 'all' && a.severity !== sevFilter) return false;
    if (catFilter && a.category !== catFilter) return false;
    return true;
  });

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  const cols: TableColumn<AlertItem>[] = [
    {
      key: 'sev',
      header: 'الخطورة',
      sortValue: (r) => r.severity,
      render: (r) => (
        <StatusBadge
          label={r.severity === 'critical' ? 'حرج' : 'تحذير'}
          tone={r.severity === 'critical' ? 'danger' : 'warning'}
        />
      ),
    },
    { key: 'cat', header: 'التصنيف', sortValue: (r) => r.category, render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.category}</span> },
    { key: 'date', header: 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono-num">{r.date}</span> },
    ...(!lockedPlatform
      ? [{ key: 'platform', header: 'المنصة', sortValue: (r: AlertItem) => r.platform, render: (r: AlertItem) => <span>{r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta'}</span> }]
      : []),
    { key: 'riderId', header: lockedPlatform === 'keeta' ? 'Courier ID' : 'المندوب', sortValue: (r) => r.riderId, render: (r) => <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{r.riderId}</span> },
    { key: 'title', header: 'المشكلة المكتشفة', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-200">{r.title}</span> },
    { key: 'desc', header: 'التفاصيل والمؤشر', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.description}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          lockedPlatform === 'hungerstation'
            ? 'تنبيهات HungerStation التشغيلية'
            : lockedPlatform === 'keeta'
              ? 'تنبيهات Keeta التشغيلية'
              : 'مركز التنبيهات التشغيلية الشاملة (Alerts Center)'
        }
        subtitle="يتم توليد التنبيهات ديناميكيًا وفق حدود الأهداف المضبوطة في إعدادات النظام (دون أي حدود ثابتة في الكود)."
        actions={
          <Button variant="secondary" icon={<Settings className="h-3.5 w-3.5" />} onClick={onGoToSettings}>
            تعديل حدود التنبيهات
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="إجمالي التنبيهات" value={fmtNum(alerts.length)} />
        <KpiCard label="تنبيهات حرجة" value={fmtNum(criticalCount)} tone={criticalCount > 0 ? 'critical' : 'good'} />
        <KpiCard label="تحذيرات أداء" value={fmtNum(warningCount)} tone={warningCount > 0 ? 'warn' : 'good'} />
        <KpiCard label="هدف الطلبات / الساعات" value={`${settings.minDailyOrders} / ${settings.minDailyWorkingHours} س`} />
      </div>

      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          variant="segmented"
          activeKey={sevFilter}
          onChange={setSevFilter}
          items={[
            { key: 'all', label: 'الكل', count: alerts.length },
            { key: 'critical', label: 'حرج فقط', count: criticalCount },
            { key: 'warning', label: 'تحذيرات فقط', count: warningCount },
          ]}
        />

        <div className="w-full sm:w-64">
          <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">كل التصنيفات</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
      </Card>

      <DataTable
        rows={visible}
        columns={cols}
        rowKey={(r) => r.id}
        searchPlaceholder="ابحث برقم المندوب أو وصف التنبيه..."
        searchText={(r) => `${r.riderId} ${r.title} ${r.description} ${r.category}`}
        emptyTitle="لا توجد تنبيهات تشغيلية مطابقة"
        emptySubtitle="جميع السجلات ضمن الحدود التشغيلية المحددة أو لم يتم استيراد بيانات بعد."
        onRowClick={(r) => {
          if (!r.id.startsWith('exp_veh_') && r.riderId && r.riderId !== '-') {
            onSelectRider(r.platform, r.riderId);
          }
        }}
      />
    </div>
  );
}

export type ReportKind =
  | 'executive_report'
  | 'daily_operations'
  | 'monthly_performance'
  | 'rider_ranking'
  | 'branch_performance'
  | 'supervisor_performance'
  | 'error_code_analysis'
  | 'attendance_report'
  | 'delivery_quality'
  | 'platform_comparison'
  | 'hr_riders_report'
  | 'applications_accounts_report'
  | 'fleet_vehicles_report'
  | 'expiries_report'
  | 'maintenance_cost_report'
  | 'audit_summary_report';

const REPORT_DEFS: Array<{ key: ReportKind; label: string; note: string; erpOnly?: boolean }> = [
  {
    key: 'executive_report',
    label: '1. ملخص الإدارة العليا الرسمي',
    note: 'التقرير التنفيذي الرسمي القابل للطباعة والتصدير متضمنًا الأداء الموحد والفروع والانحرافات والحالات.',
  },
  {
    key: 'daily_operations',
    label: '2. العمليات اليومية',
    note: 'تقرير مقارن يومي للطلبات المكتملة وساعات العمل/الاتصال والمسافات عبر المنصات المفعّلة.',
  },
  {
    key: 'monthly_performance',
    label: '3. الأداء الشهري',
    note: 'تجميع الأداء الشهري لإجمالي الطلبات والساعات والمندوبين النشطين ومؤشرات الجودة.',
  },
  {
    key: 'rider_ranking',
    label: '4. ترتيب المندوبين',
    note: 'ترتيب المندوبين وفق معادلة التقييم الموزون (Performance Score 0-100) وإجمالي الطلبات.',
  },
  {
    key: 'branch_performance',
    label: '5. أداء الفروع والمدن',
    note: 'مقارنة الفروع والمدن في عدد المندوبين والطلبات والساعات ومعدل الإنتاجية اليومي.',
  },
  {
    key: 'supervisor_performance',
    label: '6. أداء المشرفين',
    note: 'أداء فرق المشرفين وتوزيع المناديب التابعين ومعدلات الطلبات والساعات.',
  },
  {
    key: 'error_code_analysis',
    label: '7. تحليل أكواد الأخطاء',
    note: 'تقرير أكواد أخطاء HungerStation وتكرارها وشدتها وعدد المندوبين المتأثرين.',
  },
  {
    key: 'attendance_report',
    label: '8. الحضور والشفتات',
    note: 'تقرير الالتزام والحضور اليومي وساعات العمل المسجلة.',
  },
  {
    key: 'delivery_quality',
    label: '9. جودة التسليم والتصنيف',
    note: 'جودة التسليم ومستويات التقييم والالتزام بوقت التسليم.',
  },
  {
    key: 'platform_comparison',
    label: '10. مقارنة المنصتين',
    note: 'مقارنة شاملة بين HungerStation وKeeta مع توضيح تطابق أو اختلاف التعريفات الإحصائية.',
  },
  {
    key: 'hr_riders_report',
    label: '11. سجل الموارد البشرية والمندوبين',
    note: 'بيانات المندوبين الشاملة: رقم الشركة الداخلي، الإقامة، الرخصة، الحالة الوظيفية، والفرع.',
    erpOnly: true,
  },
  {
    key: 'applications_accounts_report',
    label: '12. حسابات التطبيقات والربط',
    note: 'قائمة حسابات المندوبين عبر المنصات وحالة الربط التاريخي وتعارضات المعرّفات.',
    erpOnly: true,
  },
  {
    key: 'fleet_vehicles_report',
    label: '13. سجل الأسطول والمركبات والعهدة',
    note: 'تفاصيل السيارات، حالة التشغيل، المندوب المستلم الحالي، وتواريخ انتهاء الاستمارة والتأمين.',
    erpOnly: true,
  },
  {
    key: 'expiries_report',
    label: '14. انتهاء الوثائق (HR والمركبات)',
    note: 'رصد شامل للإقامات والرخص والاستمارات والتأمين والفحص الدوري حسب الأيام المتبقية.',
    erpOnly: true,
  },
  {
    key: 'maintenance_cost_report',
    label: '15. صيانة وتكاليف الأسطول',
    note: 'سجل أوامر الصيانة، نوع الصيانة، التكلفة بالريال، وحالة الإغلاق.',
    erpOnly: true,
  },
  {
    key: 'audit_summary_report',
    label: '16. ملخص سجل التدقيق والنشاط',
    note: 'تقرير حوكمة العمليات والتعديلات الحساسة المسجلة في سجل التدقيق المركزي.',
    erpOnly: true,
  },
];

export function ReportsExportsView({
  dataset,
  dictionaryEntries = [],
  riderErrorCases = [],
  operationalCases = [],
  vehicles = [],
  vehicleAssignments = [],
  vehicleMaintenance = [],
  platformAccounts = [],
  privateDocs = [],
  auditLogs = [],
  platformCatalog = [],
  settings,
  lockedPlatform,
  companyBranding,
  dynamicFields = [],
  systemPages = [],
  customEntityRecords = [],
  reportTemplates = [],
  currentUser,
  allowedUids = [],
  onRefresh,
}: {
  dataset: FleetDataset;
  filteredRows: UnifiedDailyRow[];
  dictionaryEntries?: ErrorCodeDictionaryEntry[];
  riderErrorCases?: RiderErrorCase[];
  operationalCases?: OperationalCase[];
  vehicles?: VehicleMaster[];
  vehicleAssignments?: VehicleAssignment[];
  vehicleMaintenance?: VehicleMaintenanceRecord[];
  platformAccounts?: PlatformAccount[];
  privateDocs?: PrivateDocumentRecord[];
  auditLogs?: AuditLog[];
  platformCatalog?: PlatformCatalogEntry[];
  settings: OperationalSettings;
  lockedPlatform?: Platform;
  companyBranding?: CompanyBrandingDoc;
  dynamicFields?: DynamicFieldDefinition[];
  systemPages?: SystemPageConfig[];
  customEntityRecords?: CustomEntityRecord[];
  reportTemplates?: CustomReportTemplate[];
  currentUser?: UserProfile;
  allowedUids?: string[];
  onRefresh?: () => Promise<void>;
}) {
  const keetaActive = isKeetaActive(settings, platformCatalog);
  const [reportsMode, setReportsMode] = useState<'standard' | 'designer'>('standard');

  const availableReports = useMemo(
    () =>
      REPORT_DEFS.filter((r) => {
        if ((lockedPlatform || !keetaActive) && r.key === 'platform_comparison') return false;
        if (lockedPlatform === 'keeta' && r.key === 'error_code_analysis') return false;
        if (lockedPlatform === 'hungerstation' && r.key === 'supervisor_performance') return false;
        if (lockedPlatform && r.erpOnly) return false;
        return true;
      }),
    [lockedPlatform, keetaActive]
  );

  const [reportKind, setReportKind] = useState<ReportKind>('executive_report');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>(lockedPlatform || 'all');
  const [cityFilter, setCityFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState('');
  const [riderQuery, setRiderQuery] = useState('');

  const [exportBusy, setExportBusy] = useState(false);
  const [driveConfirmOpen, setDriveConfirmOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setPlatformFilter(lockedPlatform || 'all');
    if (!availableReports.some((r) => r.key === reportKind)) {
      setReportKind('executive_report');
    }
  }, [lockedPlatform, availableReports, reportKind]);

  const effectivePlatformFilter: 'all' | Platform = lockedPlatform || platformFilter;
  const activeReportKind: ReportKind = availableReports.some((r) => r.key === reportKind)
    ? reportKind
    : 'executive_report';

  const allUnified = useMemo(
    () => buildUnifiedDailyRows(dataset).filter((r) => keetaActive || r.platform !== 'keeta'),
    [dataset, keetaActive]
  );

  const inlineOptions = useMemo(() => {
    const months = Array.from(new Set(allUnified.map((r) => r.month).filter(Boolean))).sort().reverse();
    const cities = Array.from(new Set(allUnified.map((r) => r.city).filter(Boolean))).sort();
    const branches = Array.from(new Set(allUnified.map((r) => r.branch).filter(Boolean))).sort();
    const supervisors = Array.from(new Set(allUnified.map((r) => r.supervisor).filter(Boolean))).sort();
    return { months, cities, branches, supervisors };
  }, [allUnified]);

  const internalIdByPlatformRider = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of dataset.riderMappings) {
      map.set(`${m.platform}:${m.platformRiderId}`, m.internalRiderId);
    }
    return map;
  }, [dataset.riderMappings]);

  const reportRows = useMemo(() => {
    const q = riderQuery.trim().toLowerCase();
    return allUnified.filter((r) => {
      if (effectivePlatformFilter !== 'all' && r.platform !== effectivePlatformFilter) return false;
      if (monthFilter && r.month !== monthFilter) return false;
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      if (cityFilter && r.city !== cityFilter) return false;
      if (branchFilter && r.branch !== branchFilter) return false;
      if (supervisorFilter && r.supervisor !== supervisorFilter) return false;
      if (
        q &&
        !r.riderId.toLowerCase().includes(q) &&
        !r.riderName.toLowerCase().includes(q) &&
        !(internalIdByPlatformRider.get(`${r.platform}:${r.riderId}`) || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allUnified, internalIdByPlatformRider, effectivePlatformFilter, monthFilter, startDate, endDate, cityFilter, branchFilter, supervisorFilter, riderQuery]);

  const reportFiltersForErrors: FilterState = useMemo(
    () => ({
      date: '',
      month: monthFilter,
      platform: effectivePlatformFilter,
      city: cityFilter,
      branch: branchFilter,
      contract: '',
      supervisor: supervisorFilter,
      vehicleType: '',
      riderId: riderQuery,
    }),
    [monthFilter, effectivePlatformFilter, cityFilter, branchFilter, supervisorFilter, riderQuery]
  );

  const errorIntel = useMemo(
    () => computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, reportFiltersForErrors),
    [dataset, dictionaryEntries, riderErrorCases, reportFiltersForErrors]
  );

  // Executive Brief live calculations
  const executiveSummary = useMemo(() => {
    const totalOrders = reportRows.reduce((s, r) => s + (r.completedOrders ?? 0), 0);
    const totalHours = reportRows.reduce((s, r) => s + (r.workingHours ?? 0), 0);
    const totalKm = reportRows.reduce((s, r) => s + (r.totalKm ?? 0), 0);
    const activeRiders = new Set(reportRows.filter((r) => r.isActive).map((r) => `${r.platform}:${r.riderId}`)).size;
    const totalRiders = new Set(reportRows.map((r) => `${r.platform}:${r.riderId}`)).size;
    const dates = Array.from(new Set(reportRows.map((r) => r.date))).sort();
    const attVals = reportRows.map((r) => r.attendanceRate).filter((v): v is number => v !== null);
    const avgAttendance = attVals.length ? Number((attVals.reduce((a, b) => a + b, 0) / attVals.length).toFixed(1)) : null;

    // Group by rider for weighted score ranking
    const byRider = new Map<string, UnifiedDailyRow[]>();
    for (const r of reportRows) {
      const k = `${r.platform}:${r.riderId}`;
      const list = byRider.get(k) || [];
      list.push(r);
      byRider.set(k, list);
    }
    const riderScores = Array.from(byRider.values()).map((rows) => {
      const sample = rows[0];
      const hsQual =
        sample.platform === 'hungerstation'
          ? dataset.hungerQualityMonthly.find((q) => q.riderId === sample.riderId)?.finalDeliveryQualityScore ?? null
          : null;
      const score = computeRiderPerformanceScore(
        sample.platform,
        sample.riderId,
        rows,
        settings,
        hsQual
      );
      return {
        platform: sample.platform,
        riderId: sample.riderId,
        riderName: sample.riderName,
        branch: sample.branch || sample.city || '-',
        orders: rows.reduce((s, x) => s + (x.completedOrders ?? 0), 0),
        days: rows.length,
        score: score.totalScore,
        band: score.band,
      };
    });
    riderScores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.orders - a.orders);

    const branchCards = computeBranchScorecards(reportRows, settings);
    const anomalies = detectOperationalAnomalies(reportRows);
    const openCases = operationalCases.filter((c) => c.status !== 'closed' && c.status !== 'resolved');
    const overdueCases = openCases.filter((c) => c.dueDate && c.dueDate < new Date().toISOString().slice(0, 10));

    return {
      periodStart: dates[0] || '-',
      periodEnd: dates[dates.length - 1] || '-',
      distinctDays: dates.length,
      totalRiders,
      activeRiders,
      totalOrders,
      totalHours: Number(totalHours.toFixed(1)),
      totalKm: Number(totalKm.toFixed(1)),
      avgAttendance,
      topPerformers: riderScores.slice(0, 5),
      bottomPerformers: [...riderScores].reverse().slice(0, 5),
      branchCards: branchCards.slice(0, 8),
      anomaliesCount: anomalies.length,
      openCasesCount: openCases.length,
      overdueCasesCount: overdueCases.length,
      errorEventsCount: errorIntel.totalErrorEvents,
      riderScores,
    };
  }, [reportRows, dataset.hungerQualityMonthly, settings, operationalCases, errorIntel.totalErrorEvents]);

  const reportPayload = useMemo(() => {
    const def = availableReports.find((d) => d.key === activeReportKind) || availableReports[0];
    let columns: ExportColumn[] = [];
    let rows: Array<Record<string, unknown>> = [];

    if (activeReportKind === 'executive_report') {
      columns = [
        { header: 'البند التنفيذي', key: 'section', width: 28 },
        { header: 'القيمة / المؤشر', key: 'value', width: 26 },
        { header: 'ملاحظات الإدارة التشغيلية', key: 'detail', width: 45 },
      ];
      const sourceLabel =
        lockedPlatform === 'hungerstation' || !keetaActive
          ? 'HungerStation'
          : lockedPlatform === 'keeta'
            ? 'Keeta'
            : 'HungerStation + Keeta';
      rows = [
        { section: 'نطاق الفترة المغطاة', value: `${executiveSummary.periodStart} → ${executiveSummary.periodEnd}`, detail: `${executiveSummary.distinctDays} يوم تشغيلي` },
        { section: 'إجمالي المندوبين / النشطون', value: `${executiveSummary.activeRiders} / ${executiveSummary.totalRiders}`, detail: 'بحسب الفلاتر المطبقة' },
        { section: 'إجمالي الطلبات المكتملة', value: executiveSummary.totalOrders, detail: sourceLabel },
        { section: 'إجمالي ساعات العمل / الاتصال', value: executiveSummary.totalHours, detail: 'ساعة مسجلة' },
        { section: 'إجمالي المسافة المقطوعة (كم)', value: executiveSummary.totalKm, detail: lockedPlatform === 'hungerstation' || !keetaActive ? 'HS Riders Distance' : lockedPlatform === 'keeta' ? 'Keeta VDA' : 'HS Distance + Keeta VDA' },
        { section: 'متوسط نسبة الحضور', value: executiveSummary.avgAttendance !== null ? `${executiveSummary.avgAttendance}%` : 'غير متاح', detail: 'معدل السجلات المتوفرة' },
        ...(lockedPlatform !== 'keeta'
          ? [{ section: 'حالات أخطاء HungerStation', value: executiveSummary.errorEventsCount, detail: `${errorIntel.distinctCodesCount} أكواد مختلفة` }]
          : []),
        { section: 'الحالات التشغيلية المفتوحة / المتأخرة', value: `${executiveSummary.openCasesCount} / ${executiveSummary.overdueCasesCount}`, detail: 'من مركز التحكم التشغيلي' },
        { section: 'الانحرافات الأدائيّة المرصودة', value: executiveSummary.anomaliesCount, detail: 'تراجع حاد ≥35% أو انخفاض متتالي' },
        ...executiveSummary.branchCards.map((b) => ({
          section: `فرع: ${b.branchName}`,
          value: `${b.completedOrders} طلب (${b.avgOrdersPerRider} طلب/مندوب)`,
          detail: `الإنجاز ${b.completionRate ?? '-'}% · المندوبون ${b.activeRidersCount}/${b.ridersCount} · الحالة: ${b.healthStatus}`,
        })),
      ];
    } else if (activeReportKind === 'daily_operations' || activeReportKind === 'monthly_performance') {
      const isMonthly = activeReportKind === 'monthly_performance';
      columns = [
        { header: isMonthly ? 'الشهر' : 'التاريخ', key: 'period', width: 16 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوبون النشطون', key: 'activeRiders', width: 18 },
        { header: 'الطلبات المكتملة', key: 'orders', width: 18 },
        { header: 'ساعات العمل/الاتصال', key: 'hours', width: 20 },
        { header: 'المسافة الإجمالية (كم)', key: 'totalKm', width: 20 },
        { header: 'المسافة المستحقة (كم)', key: 'payableKm', width: 20 },
      ];
      const map = new Map<string, { period: string; platform: string; riders: Set<string>; orders: number; hours: number; totalKm: number; payableKm: number }>();
      for (const r of reportRows) {
        const p = isMonthly ? r.month : r.date;
        const k = `${p}:${r.platform}`;
        const cur = map.get(k) || {
          period: p,
          platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
          riders: new Set<string>(),
          orders: 0,
          hours: 0,
          totalKm: 0,
          payableKm: 0,
        };
        if (r.isActive) cur.riders.add(r.riderId);
        cur.orders += r.completedOrders ?? 0;
        cur.hours += r.workingHours ?? 0;
        cur.totalKm += r.totalKm ?? 0;
        cur.payableKm += r.payableKm ?? 0;
        map.set(k, cur);
      }
      rows = Array.from(map.values())
        .sort((a, b) => b.period.localeCompare(a.period))
        .map((x) => ({
          period: x.period,
          platform: x.platform,
          activeRiders: x.riders.size,
          orders: x.orders,
          hours: Number(x.hours.toFixed(1)),
          totalKm: Number(x.totalKm.toFixed(1)),
          payableKm: Number(x.payableKm.toFixed(1)),
        }));
    } else if (activeReportKind === 'rider_ranking') {
      columns = [
        { header: 'المنصة', key: 'platform', width: 15 },
        { header: 'معرف المندوب', key: 'riderId', width: 18 },
        { header: 'الاسم', key: 'riderName', width: 22 },
        { header: 'الفرع / المدينة', key: 'branch', width: 18 },
        { header: 'الأيام', key: 'days', width: 10 },
        { header: 'إجمالي الطلبات', key: 'orders', width: 16 },
        { header: 'متوسط/يوم', key: 'avgOrders', width: 14 },
        { header: 'التقييم الموزون (100)', key: 'score', width: 18 },
        { header: 'التصنيف', key: 'band', width: 14 },
      ];
      rows = executiveSummary.riderScores.map((x) => ({
        platform: x.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
        riderId: x.riderId,
        riderName: x.riderName,
        branch: x.branch,
        days: x.days,
        orders: x.orders,
        avgOrders: Number((x.orders / Math.max(1, x.days)).toFixed(1)),
        score: x.score,
        band: x.band,
      }));
    } else if (activeReportKind === 'branch_performance') {
      columns = [
        { header: 'الفرع / المدينة', key: 'branchName', width: 24 },
        { header: 'إجمالي المندوبين', key: 'ridersCount', width: 16 },
        { header: 'النشطون', key: 'activeRidersCount', width: 14 },
        { header: 'الطلبات المكتملة', key: 'completedOrders', width: 18 },
        { header: 'متوسط الطلبات/مندوب', key: 'avgOrdersPerRider', width: 18 },
        { header: 'معدل الإنجاز %', key: 'completionRate', width: 14 },
        { header: 'ساعات العمل', key: 'workingHours', width: 16 },
        { header: 'حالة التشغيل', key: 'healthStatus', width: 16 },
      ];
      rows = executiveSummary.branchCards.map((b) => ({
        branchName: b.branchName,
        ridersCount: b.ridersCount,
        activeRidersCount: b.activeRidersCount,
        completedOrders: b.completedOrders,
        avgOrdersPerRider: b.avgOrdersPerRider,
        completionRate: b.completionRate !== null ? `${b.completionRate}%` : 'غير متاح',
        workingHours: b.workingHours,
        healthStatus: b.healthStatus,
      }));
    } else if (activeReportKind === 'supervisor_performance') {
      columns = [
        { header: 'المشرف', key: 'supervisor', width: 24 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوبون', key: 'riders', width: 14 },
        { header: 'الطلبات المكتملة', key: 'orders', width: 18 },
        { header: 'ساعات العمل', key: 'hours', width: 16 },
      ];
      const map = new Map<string, { supervisor: string; platform: string; riders: Set<string>; orders: number; hours: number }>();
      for (const r of reportRows) {
        if (!r.supervisor) continue;
        const k = `${r.supervisor}:${r.platform}`;
        const cur = map.get(k) || {
          supervisor: r.supervisor,
          platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
          riders: new Set<string>(),
          orders: 0,
          hours: 0,
        };
        cur.riders.add(r.riderId);
        cur.orders += r.completedOrders ?? 0;
        cur.hours += r.workingHours ?? 0;
        map.set(k, cur);
      }
      rows = Array.from(map.values())
        .sort((a, b) => b.orders - a.orders)
        .map((x) => ({
          supervisor: x.supervisor,
          platform: x.platform,
          riders: x.riders.size,
          orders: x.orders,
          hours: Number(x.hours.toFixed(1)),
        }));
    } else if (activeReportKind === 'error_code_analysis') {
      columns = [
        { header: 'الكود الموحد', key: 'normalizedCode', width: 18 },
        { header: 'الوصف المعتمد', key: 'displayTitle', width: 28 },
        { header: 'الخطورة', key: 'severity', width: 14 },
        { header: 'مرات الظهور', key: 'occurrences', width: 14 },
        { header: 'المندوبون المتأثرون', key: 'riders', width: 18 },
        { header: 'تكرار لنفس المندوب', key: 'repeated', width: 18 },
        { header: 'أعلى مدينة', key: 'topCity', width: 16 },
        { header: 'أول / آخر ظهور', key: 'range', width: 24 },
      ];
      rows = errorIntel.codes.map((c) => ({
        normalizedCode: c.normalizedCode,
        displayTitle: c.displayTitle,
        severity: c.severity,
        occurrences: c.occurrenceCount,
        riders: c.affectedRidersCount,
        repeated: c.repeatedRidersCount,
        topCity: c.cityBreakdown[0]?.name || '-',
        range: `${c.firstSeenDate} → ${c.lastSeenDate}`,
      }));
    } else if (activeReportKind === 'platform_comparison') {
      columns = [
        { header: 'المؤشر', key: 'metric', width: 28 },
        { header: 'HungerStation', key: 'hs', width: 20 },
        { header: 'Keeta', key: 'keeta', width: 20 },
        { header: 'تطابق التعريف / ملاحظة المقارنة', key: 'parityNote', width: 42 },
      ];
      const hs = reportRows.filter((r) => r.platform === 'hungerstation');
      const kt = reportRows.filter((r) => r.platform === 'keeta');
      const sum = (arr: UnifiedDailyRow[], fn: (r: UnifiedDailyRow) => number | null) =>
        arr.reduce((s, r) => s + (fn(r) ?? 0), 0);
      const avg = (arr: UnifiedDailyRow[], fn: (r: UnifiedDailyRow) => number | null) => {
        const vals = arr.map(fn).filter((v): v is number => v !== null);
        return vals.length ? `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}%` : 'غير متاح';
      };

      rows = [
        { metric: 'إجمالي المندوبين', hs: new Set(hs.map((r) => r.riderId)).size, keeta: new Set(kt.map((r) => r.riderId)).size, parityNote: 'متطابق (معرف مستقل لكل منصة)' },
        { metric: 'الطلبات المكتملة / المسلمة', hs: sum(hs, (r) => r.completedOrders), keeta: sum(kt, (r) => r.completedOrders), parityNote: 'متطابق (Completed Deliveries vs Delivered Tasks)' },
        { metric: 'ساعات العمل / الاتصال', hs: Number(sum(hs, (r) => r.workingHours).toFixed(1)), keeta: Number(sum(kt, (r) => r.workingHours).toFixed(1)), parityNote: 'اختلاف طفيف: Actual Working Hours مقابل Shift Online Hours' },
        { metric: 'معدل الالتزام / الحضور', hs: avg(hs, (r) => r.attendanceRate), keeta: avg(kt, (r) => r.attendanceRate), parityNote: 'اختلاف تعريف: HS Attendance Rate% مقابل نسبة On-Shift؟ في كيتا' },
        { metric: 'معدل الإنجاز (Completion %)', hs: avg(hs, (r) => r.completionRate), keeta: avg(kt, (r) => r.completionRate), parityNote: 'HS محسوب (Completed/Accepted) مقابل Keeta Completion Rate' },
        { metric: 'المسافة الإجمالية (Total KM)', hs: Number(sum(hs, (r) => r.totalKm).toFixed(1)), keeta: Number(sum(kt, (r) => r.totalKm).toFixed(1)), parityNote: 'متطابق (Riders Distance مقابل VDA Total Distance)' },
        { metric: 'المسافة المستحقة (Payable KM)', hs: Number(sum(hs, (r) => r.payableKm).toFixed(1)), keeta: Number(sum(kt, (r) => r.payableKm).toFixed(1)), parityNote: 'متطابق (Payable KM مقابل VDA Payable distance)' },
      ];
    } else if (activeReportKind === 'attendance_report') {
      columns = [
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوب', key: 'riderId', width: 18 },
        { header: 'ساعات العمل', key: 'hours', width: 15 },
        { header: 'الحضور %', key: 'att', width: 15 },
      ];
      rows = reportRows.map((r) => ({
        date: r.date,
        platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
        riderId: r.riderId,
        hours: r.workingHours ?? 'غير متاح',
        att: r.attendanceRate !== null ? `${r.attendanceRate}%` : 'غير متاح',
      }));
    } else if (activeReportKind === 'delivery_quality') {
      columns = [
        { header: 'المنصة', key: 'platform', width: 16 },
        { header: 'المندوب', key: 'riderId', width: 18 },
        { header: 'الفترة', key: 'period', width: 14 },
        { header: 'Quality Score / On-Time %', key: 'score', width: 22 },
        { header: 'Segment / Overdue', key: 'extra', width: 22 },
      ];
      rows = [
        ...(effectivePlatformFilter !== 'keeta'
          ? dataset.hungerQualityMonthly
              .filter((q) => (!monthFilter || q.month === monthFilter) && (!cityFilter || q.city === cityFilter))
              .map((q) => ({
                platform: 'HungerStation',
                riderId: q.riderId,
                period: q.month,
                score: q.finalDeliveryQualityScore ?? 'غير متاح',
                extra: q.segment || '-',
              }))
          : []),
        ...(keetaActive && effectivePlatformFilter !== 'hungerstation'
          ? dataset.keetaDashboardDaily
              .filter((k) => (!monthFilter || k.month === monthFilter) && (!startDate || k.date >= startDate) && (!endDate || k.date <= endDate))
              .map((k) => ({
                platform: 'Keeta',
                riderId: k.riderId,
                period: k.date,
                score: k.onTimeRate !== null ? `${k.onTimeRate}%` : 'غير متاح',
                extra: `Overdue: ${k.overdueOrderTasks ?? 0}`,
              }))
          : []),
      ];
    } else if (activeReportKind === 'hr_riders_report') {
      columns = [
        { header: 'رقم الشركة', key: 'internalRiderId', width: 14 },
        { header: 'الاسم الكامل', key: 'fullName', width: 24 },
        { header: 'الحالة الوظيفية', key: 'hrStatus', width: 16 },
        { header: 'رقم الإقامة', key: 'iqamaNumber', width: 16 },
        { header: 'انتهاء الإقامة', key: 'iqamaExpiry', width: 14 },
        { header: 'انتهاء الرخصة', key: 'licenseExpiry', width: 14 },
        { header: 'المدينة / الفرع', key: 'branch', width: 18 },
        { header: 'الجوال', key: 'phone', width: 15 },
      ];
      rows = dataset.riderMaster
        .filter((r) => (!branchFilter || r.branch === branchFilter) && (!cityFilter || r.city === cityFilter))
        .map((r) => ({
          internalRiderId: r.internalRiderId,
          fullName: r.fullName,
          hrStatus: EMPLOYEE_HR_STATUS_LABELS[r.status] || r.status,
          iqamaNumber: r.iqamaNumber || '-',
          iqamaExpiry: r.iqamaExpiryDate || '-',
          licenseExpiry: r.driverLicenseExpiryDate || '-',
          branch: [r.city, r.branch].filter(Boolean).join(' / ') || '-',
          phone: r.phone || '-',
        }));
    } else if (activeReportKind === 'applications_accounts_report') {
      const riderNameMap = new Map(dataset.riderMaster.map((r) => [r.internalRiderId, r.fullName]));
      columns = [
        { header: 'المنصة', key: 'platformName', width: 16 },
        { header: 'معرف المنصة', key: 'platformRiderId', width: 18 },
        { header: 'المندوب بالشركة', key: 'companyRiderName', width: 22 },
        { header: 'رقم الشركة', key: 'companyRiderId', width: 14 },
        { header: 'حالة الحساب', key: 'accountStatus', width: 14 },
        { header: 'حالة الربط', key: 'linkingStatus', width: 16 },
        { header: 'مرشحو التعارض', key: 'conflicts', width: 14 },
        { header: 'ملاحظات', key: 'notes', width: 28 },
      ];
      rows = platformAccounts
        .filter((a) => keetaActive || a.platformId !== 'keeta')
        .filter((a) => !branchFilter || a.branch === branchFilter)
        .map((a) => ({
          platformName: a.platformName || a.platformId,
          platformRiderId: a.platformRiderId,
          companyRiderName: riderNameMap.get(a.companyRiderId) || '-',
          companyRiderId: a.companyRiderId,
          accountStatus: a.accountStatus === 'active' ? 'نشط' : a.accountStatus === 'suspended' ? 'موقوف' : 'منتهي',
          linkingStatus: a.linkingStatus === 'linked' ? 'مربوط مؤكد' : a.linkingStatus === 'conflict_review' ? 'تعارض يحتاج اعتماد' : 'غير مربوط',
          conflicts: a.conflictCandidateRiderIds?.length ?? 0,
          notes: a.notes || '-',
        }));
    } else if (activeReportKind === 'fleet_vehicles_report') {
      const riderNameMap = new Map(dataset.riderMaster.map((r) => [r.internalRiderId, r.fullName]));
      columns = [
        { header: 'رقم المركبة', key: 'vehicleId', width: 14 },
        { header: 'رقم اللوحة', key: 'plate', width: 16 },
        { header: 'النوع والموديل', key: 'model', width: 24 },
        { header: 'الحالة', key: 'status', width: 16 },
        { header: 'المندوب المستلم', key: 'rider', width: 22 },
        { header: 'انتهاء الاستمارة', key: 'istimara', width: 15 },
        { header: 'انتهاء التأمين', key: 'insurance', width: 15 },
        { header: 'الفحص الدوري', key: 'inspection', width: 15 },
      ];
      const activeAssignMap = new Map(vehicleAssignments.filter((a) => a.status === 'active').map((a) => [a.vehicleInternalId, a]));
      rows = vehicles.map((v) => {
        const activeAssign = activeAssignMap.get(v.vehicleInternalId);
        const curRiderName = v.currentRiderId ? riderNameMap.get(v.currentRiderId) || v.currentRiderId : '';
        return {
          vehicleId: v.vehicleInternalId,
          plate: v.plateNumber,
          model: `${v.vehicleType} · ${v.make} ${v.model} ${v.year || ''}`.trim(),
          status: VEHICLE_STATUS_LABELS[v.status] || v.status,
          rider: activeAssign ? `${activeAssign.riderName || ''} (${activeAssign.companyRiderId})`.trim() : curRiderName || 'غير مسلمة',
          istimara: v.istimaraExpiryDate || '-',
          insurance: v.insuranceExpiryDate || '-',
          inspection: v.periodicInspectionExpiryDate || '-',
        };
      });
    } else if (activeReportKind === 'expiries_report') {
      columns = [
        { header: 'النطاق', key: 'domain', width: 14 },
        { header: 'الكيان', key: 'entityName', width: 24 },
        { header: 'نوع الوثيقة', key: 'docCategory', width: 18 },
        { header: 'الرقم المرجعي', key: 'docNumber', width: 16 },
        { header: 'تاريخ الانتهاء', key: 'expiryDate', width: 14 },
        { header: 'الأيام المتبقية', key: 'daysRemaining', width: 14 },
        { header: 'مستوى التنبيه', key: 'urgency', width: 16 },
      ];
      const items = computeAllDocumentExpiries({
        riders: dataset.riderMaster,
        vehicles,
        privateDocs,
        settings,
      });
      rows = items.map((i) => ({
        domain: i.domain === 'fleet' ? 'الأسطول' : 'الموارد البشرية',
        entityName: `${i.entityName} (${i.entityId})`,
        docCategory: i.docCategory,
        docNumber: i.docNumber || '-',
        expiryDate: i.expiryDate,
        daysRemaining: i.daysRemaining,
        urgency:
          i.urgency === 'expired'
            ? 'منتهي'
            : i.urgency === 'due_today'
              ? 'ينتهي اليوم'
              : i.urgency === 'within_7'
                ? 'حرج (≤7 أيام)'
                : i.urgency === 'within_30'
                  ? 'قريب (≤30 يوم)'
                  : 'تنبيه مبكر',
      }));
    } else if (activeReportKind === 'maintenance_cost_report') {
      columns = [
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'اللوحة', key: 'plate', width: 16 },
        { header: 'نوع الصيانة', key: 'type', width: 16 },
        { header: 'التفاصيل', key: 'desc', width: 28 },
        { header: 'الورشة / المزود', key: 'vendor', width: 20 },
        { header: 'التكلفة (ر.س)', key: 'cost', width: 14 },
        { header: 'المتابعة القادمة', key: 'nextDate', width: 16 },
      ];
      rows = vehicleMaintenance.map((m) => ({
        date: m.maintenanceDate,
        plate: m.plateNumber || m.vehicleInternalId,
        type: m.maintenanceType === 'periodic' ? 'دورية' : m.maintenanceType === 'accident' ? 'حادث' : m.maintenanceType === 'tires' ? 'إطارات' : m.maintenanceType === 'emergency' ? 'طارئة' : m.maintenanceType || 'صيانة',
        desc: m.details || '-',
        vendor: m.workshop || '-',
        cost: m.cost ?? 0,
        nextDate: m.nextMaintenanceDate || '-',
      }));
    } else {
      columns = [
        { header: 'الإجراء', key: 'action', width: 22 },
        { header: 'النوع', key: 'entityType', width: 16 },
        { header: 'المعرّف', key: 'targetId', width: 18 },
        { header: 'المنفّذ', key: 'actorEmail', width: 24 },
        { header: 'المصدر', key: 'source', width: 12 },
        { header: 'التفاصيل', key: 'details', width: 38 },
      ];
      rows = auditLogs.slice(0, 200).map((l) => ({
        action: l.action,
        entityType: l.entityType || l.targetCollection,
        targetId: l.targetId,
        actorEmail: l.actorEmail,
        source: l.source || 'UI',
        details: l.details,
      }));
    }

    return { def, columns, rows };
  }, [availableReports, activeReportKind, reportRows, dataset, executiveSummary, errorIntel, effectivePlatformFilter, lockedPlatform, monthFilter, startDate, endDate, cityFilter, branchFilter, keetaActive, vehicles, vehicleAssignments, vehicleMaintenance, platformAccounts, privateDocs, auditLogs, settings]);

  const handleExportExcel = async (saveToDrive = false) => {
    if (!auth.currentUser) return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      let driveToken = getDriveAccessToken();
      if (saveToDrive && !driveToken) {
        driveToken = await refreshDriveTokenWithPopup();
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      };
      if (saveToDrive && driveToken) {
        headers['X-Drive-Access-Token'] = driveToken;
      }

      const filePrefix = lockedPlatform === 'hungerstation' ? 'hs' : lockedPlatform === 'keeta' ? 'kt' : 'fleet';
      const platformHeading =
        lockedPlatform === 'hungerstation'
          ? 'HungerStation Operations'
          : lockedPlatform === 'keeta'
            ? 'Keeta Operations'
            : 'Fleet Operations Center';
      const fileName = `${filePrefix}_${activeReportKind}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const exportPayload = {
        title: `${platformHeading} — ${reportPayload.def.label}`,
        sheetName: activeReportKind,
        columns: reportPayload.columns,
        rows: reportPayload.rows,
        metadataLines: [reportPayload.def.note, `تاريخ التصدير: ${new Date().toISOString().slice(0, 10)}`],
        saveToDrive,
        fileName,
      };

      try {
        const res = await fetch('/api/export/excel', {
          method: 'POST',
          headers,
          body: JSON.stringify(exportPayload),
        });

        const resContentType = (res.headers.get('content-type') || '').toLowerCase();
        if (resContentType.includes('text/html') || res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503) {
          throw new ApiHtmlFallbackError();
        }

        if (!res.ok) {
          const err = await safeParseJsonResponse<{ error?: string }>(res);
          throw new Error(err.error || 'تعذر تصدير التقرير.');
        }

        if (saveToDrive) {
          const json = await safeParseJsonResponse<{ driveFile?: { name?: string } }>(res);
          setExportMsg({ type: 'ok', text: `تم حفظ التقرير "${json.driveFile?.name || fileName}" في Google Drive بنجاح.` });
          setDriveConfirmOpen(false);
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
          setExportMsg({ type: 'ok', text: `تم تنزيل ملف Excel (${fileName}) بنجاح.` });
        }
      } catch (apiErr) {
        if (apiErr instanceof ApiHtmlFallbackError || apiErr instanceof TypeError) {
          const fallbackRes = await exportExcelInBrowser(exportPayload);
          if (saveToDrive) {
            setExportMsg({ type: 'ok', text: `تم حفظ التقرير "${fallbackRes.driveFile?.name || fileName}" في Google Drive بنجاح.` });
            setDriveConfirmOpen(false);
          } else {
            setExportMsg({ type: 'ok', text: `تم تنزيل ملف Excel (${fileName}) بنجاح.` });
          }
        } else {
          throw apiErr;
        }
      }
    } catch (err) {
      setExportMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل التصدير.' });
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportPdf = async () => {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const filePrefix = lockedPlatform === 'hungerstation' ? 'hs' : lockedPlatform === 'keeta' ? 'kt' : 'fleet';
      const platformHeading =
        lockedPlatform === 'hungerstation'
          ? 'HungerStation Operations'
          : lockedPlatform === 'keeta'
            ? 'Keeta Operations'
            : 'Fleet Operations Center';
      const fileName = `${filePrefix}_${activeReportKind}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await exportArabicTableToPdf({
        title: `${platformHeading} — ${reportPayload.def.label}`,
        subtitle: reportPayload.def.note,
        columns: reportPayload.columns,
        rows: reportPayload.rows,
        fileName,
        branding: companyBranding,
        preparer: currentUser?.displayName || currentUser?.email,
      });
      setExportMsg({ type: 'ok', text: `تم تصدير ملف PDF (${fileName}) بنجاح.` });
    } catch (err) {
      setExportMsg({ type: 'err', text: err instanceof Error ? err.message : 'فشل تصدير PDF.' });
    } finally {
      setExportBusy(false);
    }
  };

  const tableCols: TableColumn<Record<string, unknown>>[] = reportPayload.columns.map((c) => ({
    key: c.key,
    header: c.header,
    sortValue: (r) => r[c.key] as string | number | null,
    render: (r) => {
      const v = r[c.key];
      return (
        <span className={typeof v === 'number' ? 'font-mono-num font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}>
          {v === null || v === undefined ? 'غير متاح' : String(v)}
        </span>
      );
    },
  }));

  const resetInlineFilters = () => {
    setStartDate('');
    setEndDate('');
    setMonthFilter('');
    setPlatformFilter(lockedPlatform || 'all');
    setCityFilter('');
    setBranchFilter('');
    setSupervisorFilter('');
    setRiderQuery('');
  };

  return (
    <div className="space-y-5">
      <div className="no-print">
        <PageHeader
          title={
            lockedPlatform === 'hungerstation'
              ? 'تقارير وتصدير HungerStation'
              : lockedPlatform === 'keeta'
                ? 'تقارير وتصدير Keeta'
                : 'مركز التقارير ومقارنة المنصتين (BI Reports Center)'
          }
          subtitle={reportPayload.def.note}
          actions={
            <>
              <Button variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>
                طباعة التقرير الرسمي
              </Button>
              <Button
                variant="primary"
                disabled={exportBusy || reportPayload.rows.length === 0}
                onClick={() => handleExportExcel(false)}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                تصدير Excel
              </Button>
              <Button
                variant="secondary"
                disabled={exportBusy || reportPayload.rows.length === 0}
                onClick={handleExportPdf}
                icon={<FileText className="h-3.5 w-3.5" />}
              >
                تصدير PDF
              </Button>
              <Button
                variant="accent"
                disabled={exportBusy || reportPayload.rows.length === 0}
                onClick={() => setDriveConfirmOpen(true)}
                icon={<CloudUpload className="h-3.5 w-3.5" />}
              >
                حفظ في Google Drive
              </Button>
            </>
          }
        />
      </div>

      {!lockedPlatform && currentUser && companyBranding && (
        <div className="no-print">
          <Tabs
            variant="underline"
            activeKey={reportsMode}
            onChange={setReportsMode}
            items={[
              { key: 'standard', label: 'التقارير القياسية الموحدة' },
              { key: 'designer', label: 'مصمم التقارير والطباعة المخصص' },
            ]}
          />
        </div>
      )}

      {reportsMode === 'designer' && !lockedPlatform && currentUser && companyBranding ? (
        <CustomReportDesigner
          dataset={dataset}
          unifiedRows={allUnified}
          vehicles={vehicles}
          maintenance={vehicleMaintenance}
          privateDocs={privateDocs}
          settings={settings}
          branding={companyBranding}
          dynamicFields={dynamicFields}
          systemPages={systemPages}
          customEntityRecords={customEntityRecords}
          reportTemplates={reportTemplates}
          currentUser={currentUser}
          allowedUids={allowedUids}
          onRefresh={onRefresh || (async () => {})}
        />
      ) : (
        <>
      {exportMsg && (
        <div className="no-print">
          <ToastBanner type={exportMsg.type} message={exportMsg.text} onDismiss={() => setExportMsg(null)} />
        </div>
      )}

      {/* Inline Report Filters */}
      <Card padding="sm" className="no-print space-y-3">
        <SectionHeader
          title="نطاق وفلاتر التقرير"
          actions={
            <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3 w-3" />} onClick={resetInlineFilters}>
              إعادة ضبط
            </Button>
          }
        />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="من تاريخ"
            className="font-mono-num"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="إلى تاريخ"
            className="font-mono-num"
          />
          <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="font-mono-num">
            <option value="">كل الأشهر</option>
            {inlineOptions.months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
          {!lockedPlatform && (
            <Select
              value={effectivePlatformFilter}
              onChange={(e) => setPlatformFilter(e.target.value as 'all' | Platform)}
            >
              <option value="all">كل المنصات</option>
              <option value="hungerstation">HungerStation</option>
              {keetaActive && <option value="keeta">Keeta</option>}
            </Select>
          )}
          <Select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value="">كل المدن</option>
            {inlineOptions.cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">كل الفروع</option>
            {inlineOptions.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </Select>
          {lockedPlatform !== 'hungerstation' && (
            <Select value={supervisorFilter} onChange={(e) => setSupervisorFilter(e.target.value)}>
              <option value="">كل المشرفين</option>
              {inlineOptions.supervisors.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
          <Input
            type="text"
            value={riderQuery}
            onChange={(e) => setRiderQuery(e.target.value)}
            placeholder="معرف أو اسم المندوب..."
          />
        </div>
      </Card>

      {/* Report Selector Tabs (Scoped to Workspace) */}
      <Card padding="sm" className="no-print">
        <div className="flex flex-wrap gap-1.5">
          {availableReports.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={activeReportKind === r.key ? 'primary' : 'secondary'}
              onClick={() => setReportKind(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Formal Printable Executive Brief View */}
      {activeReportKind === 'executive_report' && (
        <Card padding="lg" className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="text-[11px] font-mono-num font-bold tracking-wider text-slate-500 dark:text-slate-400">
                {lockedPlatform === 'hungerstation'
                  ? 'HUNGERSTATION OPERATIONS — EXECUTIVE BRIEF'
                  : lockedPlatform === 'keeta'
                    ? 'KEETA OPERATIONS — EXECUTIVE BRIEF'
                    : 'FLEET OPERATIONS CENTER — FORMAL EXECUTIVE BRIEF'}
              </div>
              <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                {lockedPlatform === 'hungerstation'
                  ? 'التقرير التنفيذي الرسمي لمنصة HungerStation'
                  : lockedPlatform === 'keeta'
                    ? 'التقرير التنفيذي الرسمي لمنصة Keeta'
                    : 'ملخص الإدارة العليا الرسمي لأداء الأسطول'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                الفترة المغطاة: <span className="font-mono-num font-semibold">{executiveSummary.periodStart}</span> →{' '}
                <span className="font-mono-num font-semibold">{executiveSummary.periodEnd}</span> ({executiveSummary.distinctDays} يوم تشغيلي)
              </p>
            </div>
            <div className="text-left text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              <div>تاريخ الإصدار: {new Date().toISOString().slice(0, 10)}</div>
              <div>
                المصدر:{' '}
                {lockedPlatform === 'hungerstation' || !keetaActive
                  ? 'HungerStation Official Reports'
                  : lockedPlatform === 'keeta'
                    ? 'Keeta Official Reports'
                    : 'HungerStation & Keeta Official Reports'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <KpiCard label="الطلبات المكتملة" value={fmtNum(executiveSummary.totalOrders)} tone="good" />
            <KpiCard label="المندوبون النشطون" value={`${executiveSummary.activeRiders} / ${executiveSummary.totalRiders}`} />
            <KpiCard label="ساعات العمل / الاتصال" value={fmtNum(executiveSummary.totalHours, 1)} />
            <KpiCard label="متوسط الحضور" value={fmtPct(executiveSummary.avgAttendance)} />
            <KpiCard
              label="حالات الأخطاء / المفتوحة"
              value={`${executiveSummary.errorEventsCount} / ${executiveSummary.openCasesCount}`}
              tone={executiveSummary.overdueCasesCount > 0 ? 'critical' : 'warn'}
              subtext={`متأخرة SLA: ${executiveSummary.overdueCasesCount}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <SectionHeader title="أعلى 5 مندوبين حسب التقييم الموزون" />
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {executiveSummary.topPerformers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">لا توجد بيانات كافية</div>
                ) : (
                  executiveSummary.topPerformers.map((r) => (
                    <div key={`${r.platform}:${r.riderId}`} className="flex items-center justify-between px-3.5 py-2.5">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{r.riderName}</span>{' '}
                        <span className="font-mono-num text-slate-500">({r.riderId})</span>
                      </div>
                      <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                        {r.score}/100 · {r.orders} طلب
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <SectionHeader title="أدنى 5 مندوبين للمتابعة والتدخل" />
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {executiveSummary.bottomPerformers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">لا توجد بيانات كافية</div>
                ) : (
                  executiveSummary.bottomPerformers.map((r) => (
                    <div key={`${r.platform}:${r.riderId}`} className="flex items-center justify-between px-3.5 py-2.5">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{r.riderName}</span>{' '}
                        <span className="font-mono-num text-slate-500">({r.riderId})</span>
                      </div>
                      <span className="font-mono-num font-bold text-red-700 dark:text-red-400">
                        {r.score}/100 · {r.orders} طلب
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <DataTable
        rows={reportPayload.rows}
        columns={tableCols}
        rowKey={(_, idx) => `${activeReportKind}_${idx}`}
        searchPlaceholder="تصفية سريعة داخل التقرير..."
        searchText={(r) => Object.values(r).join(' ')}
      />

      <ConfirmModal
        open={driveConfirmOpen}
        title="تأكيد حفظ التقرير في Google Drive"
        description={`سيتم إنشاء ملف Excel جديد باسم "${lockedPlatform === 'hungerstation' ? 'hs' : lockedPlatform === 'keeta' ? 'kt' : 'fleet'}_${activeReportKind}_${new Date().toISOString().slice(0, 10)}.xlsx" ورفعه إلى حسابك في Google Drive (${reportPayload.rows.length} صف). هل تريد المتابعة؟`}
        confirmLabel="رفع وحفظ في Drive"
        busy={exportBusy}
        onConfirm={() => handleExportExcel(true)}
        onCancel={() => setDriveConfirmOpen(false)}
      />
        </>
      )}
    </div>
  );
}
