import { collection, doc, getDoc, getDocs } from './lib/erpDb';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { EnterpriseShell, getNavItemsForWorkspace, type NavKey } from './components/EnterpriseShell';
import { EMPTY_FILTERS, FilterBar } from './components/FilterBar';
import { PlatformSelectorHome } from './components/PlatformSelectorHome';
import type { HrSubTab } from './components/HrManagementModule';
import type { AppsSubTab } from './components/ApplicationsModule';
import type { FleetSubTab } from './components/FleetManagementModule';
import type { RbacSubTab } from './components/RbacManagementModule';
import { DEFAULT_COMPANY_BRANDING } from './lib/dynamicSchemaEngine';
import {
  canAccessGlobalHub,
  db,
  DEFAULT_FLEET_CONFIG,
  DEFAULT_OPERATIONAL_SETTINGS,
  ensureOperationalSettings,
  fetchCurrentSessionProfile,
  getUserAllowedPlatforms,
  loginWithPhonePassword,
  logoutUser,
  syncAuthHandle,
} from './lib/firebase';
import { fetchFleetOverview, type VehicleAvailabilityItem } from './lib/fleetApi';
import {
  buildUnifiedDailyRows,
  extractFilterOptions,
  filterUnifiedRows,
  scopeDatasetToPlatform,
  type FleetDataset,
} from './lib/fleetAnalytics';
import {
  getDefaultErpNavForUser,
  hasPermission,
  isKeetaActive,
  matchesDataScope,
  resolveDataScope,
} from './shared/rbacCore';
import type {
  AuditLog,
  CompanyBrandingDoc,
  ConfigSnapshotRecord,
  CustomEntityRecord,
  CustomReportTemplate,
  DocumentTypeConfig,
  DynamicFieldDefinition,
  DynamicFormDefinition,
  DynamicFormVersion,
  EntityNoteTask,
  ErrorCodeDictionaryEntry,
  FilterState,
  FleetApprovalRequest,
  FleetConfigSettings,
  FleetNotificationRecord,
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  HungerQualityMonthly,
  HungerWalletSnapshot,
  ImportBatch,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  NotificationRuleConfig,
  OperationalCase,
  OperationalSettings,
  Platform,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderErrorCase,
  RiderIdentityMapping,
  RiderMaster,
  RiderNote,
  RoleTemplate,
  SavedViewConfig,
  SystemPageConfig,
  SystemSectionConfig,
  TrashItemRecord,
  UserProfile,
  VehicleAssignment,
  VehicleCustody,
  VehicleDamageClaim,
  VehicleDocumentRecord,
  VehicleHandoverRecord,
  VehicleMaintenanceRecord,
  VehicleMaster,
  VehicleMovementHistoryEntry,
  VehicleReturnRecord,
  VehicleStatusHistoryEntry,
  WorkspaceMode,
} from './types/fleet';

// Route-level code splitting for heavy analytical & ERP modules
const ExecutiveAdminModule = lazy(() =>
  import('./components/ExecutiveAdminModule').then((m) => ({ default: m.ExecutiveAdminModule }))
);
const HrManagementModule = lazy(() =>
  import('./components/HrManagementModule').then((m) => ({ default: m.HrManagementModule }))
);
const ApplicationsModule = lazy(() =>
  import('./components/ApplicationsModule').then((m) => ({ default: m.ApplicationsModule }))
);
const FleetManagementModule = lazy(() =>
  import('./components/FleetManagementModule').then((m) => ({ default: m.FleetManagementModule }))
);
const RbacManagementModule = lazy(() =>
  import('./components/RbacManagementModule').then((m) => ({ default: m.RbacManagementModule }))
);
const OverviewDashboard = lazy(() =>
  import('./components/OverviewDashboard').then((m) => ({ default: m.OverviewDashboard }))
);
const OperationsControlCenter = lazy(() =>
  import('./components/OperationsControlCenter').then((m) => ({ default: m.OperationsControlCenter }))
);
const HungerStationView = lazy(() =>
  import('./components/PlatformDashboards').then((m) => ({ default: m.HungerStationView }))
);
const KeetaView = lazy(() =>
  import('./components/PlatformDashboards').then((m) => ({ default: m.KeetaView }))
);
const ErrorIntelligenceCenter = lazy(() =>
  import('./components/ErrorIntelligenceCenter').then((m) => ({ default: m.ErrorIntelligenceCenter }))
);
const RiderManagementAnd360 = lazy(() =>
  import('./components/RiderManagementAnd360').then((m) => ({ default: m.RiderManagementAnd360 }))
);
const DailyOperationsView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.DailyOperationsView }))
);
const RiderPerformanceView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.RiderPerformanceView }))
);
const AttendanceShiftsView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.AttendanceShiftsView }))
);
const DeliveryQualityView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.DeliveryQualityView }))
);
const DistanceWalletView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.DistanceWalletView }))
);
const FacialRecognitionView = lazy(() =>
  import('./components/OperationsModules').then((m) => ({ default: m.FacialRecognitionView }))
);
const AlertsCenterView = lazy(() =>
  import('./components/AlertsAndReports').then((m) => ({ default: m.AlertsCenterView }))
);
const ReportsExportsView = lazy(() =>
  import('./components/AlertsAndReports').then((m) => ({ default: m.ReportsExportsView }))
);
const ImportCenter = lazy(() =>
  import('./components/ImportCenter').then((m) => ({ default: m.ImportCenter }))
);
const SystemSettingsView = lazy(() =>
  import('./components/SettingsAndUsers').then((m) => ({ default: m.SystemSettingsView }))
);
const SystemBuilderModule = lazy(() =>
  import('./components/SystemBuilderModule').then((m) => ({ default: m.SystemBuilderModule }))
);
const CompanyBrandingModule = lazy(() =>
  import('./components/CompanyBrandingModule').then((m) => ({ default: m.CompanyBrandingModule }))
);
const AboutCreditsModule = lazy(() =>
  import('./components/AboutCreditsModule').then((m) => ({ default: m.AboutCreditsModule }))
);
const CustomPageModule = lazy(() =>
  import('./components/CustomPageModule').then((m) => ({ default: m.CustomPageModule }))
);

const EMPTY_DATASET: FleetDataset = {
  hungerDaily: [],
  hungerDistanceDaily: [],
  hungerWalletSnapshots: [],
  hungerQualityMonthly: [],
  keetaDashboardDaily: [],
  keetaVdaDaily: [],
  keetaRankSnapshots: [],
  keetaFacialRecognitionDaily: [],
  riderMaster: [],
  riderMappings: [],
};

async function safeGetCollection<T>(colName: string, _profile: UserProfile): Promise<T[]> {
  try {
    const snap = await getDocs(collection(db, colName));
    return snap.docs.map((d) => d.data() as T);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed loading collection ${colName}:`, msg);
    return [];
  }
}

function normalizeResolvedNav(rawNav: string, keetaActive: boolean): NavKey {
  if (rawNav === 'reports_executive') return 'reports';
  if (rawNav === 'keeta' && !keetaActive) return 'hungerstation';
  return rawNav as NavKey;
}

function defaultNavForWorkspace(mode: Exclude<WorkspaceMode, 'selector'>, keetaActive = true): NavKey {
  if (mode === 'hungerstation') return 'hungerstation';
  if (mode === 'keeta' && keetaActive) return 'keeta';
  return 'executive_admin';
}

function computeCanAccessGlobal(profile: UserProfile | null, roles: RoleTemplate[]): boolean {
  if (!profile || !profile.active) return false;
  if (canAccessGlobalHub(profile)) return true;
  return (
    hasPermission(profile, roles, 'executive', 'view') ||
    hasPermission(profile, roles, 'hr', 'view') ||
    hasPermission(profile, roles, 'fleet', 'view') ||
    hasPermission(profile, roles, 'applications', 'view') ||
    hasPermission(profile, roles, 'reports', 'view') ||
    hasPermission(profile, roles, 'users', 'view') ||
    hasPermission(profile, roles, 'roles', 'view') ||
    hasPermission(profile, roles, 'settings', 'view') ||
    hasPermission(profile, roles, 'audit', 'view') ||
    hasPermission(profile, roles, 'builder', 'view') ||
    hasPermission(profile, roles, 'branding', 'view') ||
    hasPermission(profile, roles, 'company', 'view')
  );
}

function RouteFallbackSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className="h-24 animate-pulse rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
        />
      ))}
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const hadExplicitThemeRef = useRef<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('foc_theme');
      if (saved === 'dark' || saved === 'light') {
        hadExplicitThemeRef.current = true;
        return saved;
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('foc_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const didInitRouteRef = useRef<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('global');
  const [activeNav, setActiveNav] = useState<NavKey>('executive_admin');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedRider, setSelectedRider] = useState<{ platform: Platform; riderId: string } | null>(null);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<FleetDataset>(EMPTY_DATASET);
  const [errorDictionary, setErrorDictionary] = useState<ErrorCodeDictionaryEntry[]>([]);
  const [riderErrorCases, setRiderErrorCases] = useState<RiderErrorCase[]>([]);
  const [operationalCases, setOperationalCases] = useState<OperationalCase[]>([]);
  const [riderNotes, setRiderNotes] = useState<RiderNote[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);

  // ERP Collections State
  const [roleTemplates, setRoleTemplates] = useState<RoleTemplate[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeConfig[]>([]);
  const [privateDocs, setPrivateDocs] = useState<PrivateDocumentRecord[]>([]);
  const [platformCatalog, setPlatformCatalog] = useState<PlatformCatalogEntry[]>([]);
  const [platformAccounts, setPlatformAccounts] = useState<PlatformAccount[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMaster[]>([]);
  const [vehicleAssignments, setVehicleAssignments] = useState<VehicleAssignment[]>([]);
  const [vehicleMaintenance, setVehicleMaintenance] = useState<VehicleMaintenanceRecord[]>([]);
  const [fleetAvailability, setFleetAvailability] = useState<VehicleAvailabilityItem[]>([]);
  const [vehicleCustodies, setVehicleCustodies] = useState<VehicleCustody[]>([]);
  const [vehicleHandovers, setVehicleHandovers] = useState<VehicleHandoverRecord[]>([]);
  const [vehicleReturns, setVehicleReturns] = useState<VehicleReturnRecord[]>([]);
  const [vehicleDocuments, setVehicleDocuments] = useState<VehicleDocumentRecord[]>([]);
  const [vehicleDamageClaims, setVehicleDamageClaims] = useState<VehicleDamageClaim[]>([]);
  const [fleetApprovals, setFleetApprovals] = useState<FleetApprovalRequest[]>([]);
  const [vehicleStatusHistory, setVehicleStatusHistory] = useState<VehicleStatusHistoryEntry[]>([]);
  const [vehicleMovementHistory, setVehicleMovementHistory] = useState<VehicleMovementHistoryEntry[]>([]);
  const [fleetNotifications, setFleetNotifications] = useState<FleetNotificationRecord[]>([]);
  const [fleetConfig, setFleetConfig] = useState<FleetConfigSettings>(DEFAULT_FLEET_CONFIG);
  const [entityNotesTasks, setEntityNotesTasks] = useState<EntityNoteTask[]>([]);

  // Enterprise Customization & System Builder State
  const [companyBranding, setCompanyBranding] = useState<CompanyBrandingDoc>(() => ({
    ...DEFAULT_COMPANY_BRANDING,
    createdByUid: '',
    allowedUids: [],
  }));
  const [dynamicFields, setDynamicFields] = useState<DynamicFieldDefinition[]>([]);
  const [dynamicForms, setDynamicForms] = useState<DynamicFormDefinition[]>([]);
  const [dynamicFormVersions, setDynamicFormVersions] = useState<DynamicFormVersion[]>([]);
  const [systemSections, setSystemSections] = useState<SystemSectionConfig[]>([]);
  const [systemPages, setSystemPages] = useState<SystemPageConfig[]>([]);
  const [customEntityRecords, setCustomEntityRecords] = useState<CustomEntityRecord[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRuleConfig[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItemRecord[]>([]);
  const [configSnapshots, setConfigSnapshots] = useState<ConfigSnapshotRecord[]>([]);
  const [customReportTemplates, setCustomReportTemplates] = useState<CustomReportTemplate[]>([]);
  const [savedViews, setSavedViews] = useState<SavedViewConfig[]>([]);

  useEffect(() => {
    if (companyBranding?.branding?.systemNameAr) {
      document.title = companyBranding.branding.systemNameAr;
    }
  }, [companyBranding?.branding?.systemNameAr]);

  const [settings, setSettings] = useState<OperationalSettings>({
    ...DEFAULT_OPERATIONAL_SETTINGS,
    createdByUid: '',
    allowedUids: [],
  });

  const loadAllOperationalData = useCallback(async (profile: UserProfile) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const canCreateSettings =
        profile.role === 'owner' || profile.role === 'admin' || profile.role === 'operations_manager';

      const [opSettings, loadedRoles, loadedCatalog] = await Promise.all([
        ensureOperationalSettings(profile.uid, profile.email, canCreateSettings),
        safeGetCollection<RoleTemplate>('roleTemplates', profile),
        safeGetCollection<PlatformCatalogEntry>('platformCatalog', profile),
      ]);

      setSettings(opSettings);
      setRoleTemplates(loadedRoles);
      setPlatformCatalog(loadedCatalog);

      const keetaActiveNow = isKeetaActive(opSettings, loadedCatalog);
      const userAllowed = getUserAllowedPlatforms(profile);
      const effectiveAllowedNow = keetaActiveNow ? userAllowed : userAllowed.filter((p) => p !== 'keeta');
      const allowHs = effectiveAllowedNow.includes('hungerstation');
      const allowKt = keetaActiveNow && effectiveAllowedNow.includes('keeta');

      const canFetchFleetOverview =
        hasPermission(profile, loadedRoles, 'fleet', 'view') ||
        hasPermission(profile, loadedRoles, 'executive', 'view');

      const [
        hungerDaily,
        hungerDistanceDaily,
        hungerWalletSnapshots,
        hungerQualityMonthly,
        keetaDashboardDaily,
        keetaVdaDaily,
        keetaRankSnapshots,
        keetaFacialRecognitionDaily,
        riderMaster,
        riderMappings,
        batches,
        logs,
        dictEntries,
        errCases,
        opCases,
        notes,
        docTypes,
        privDocs,
        platAccounts,
        vehList,
        vehAssignments,
        vehMaint,
        notesTasks,
        dynFields,
        dynForms,
        dynFormVersions,
        sysSections,
        sysPages,
        custRecords,
        notifRules,
        trashList,
        snapshotsList,
        reportTpls,
        viewsList,
        fleetOverview,
      ] = await Promise.all([
        allowHs ? safeGetCollection<HungerDailyRecord>('hungerDaily', profile) : Promise.resolve([]),
        allowHs ? safeGetCollection<HungerDistanceDailyRecord>('hungerDistanceDaily', profile) : Promise.resolve([]),
        allowHs ? safeGetCollection<HungerWalletSnapshot>('hungerWalletSnapshots', profile) : Promise.resolve([]),
        allowHs ? safeGetCollection<HungerQualityMonthly>('hungerQualityMonthly', profile) : Promise.resolve([]),
        allowKt ? safeGetCollection<KeetaDashboardDaily>('keetaDashboardDaily', profile) : Promise.resolve([]),
        allowKt ? safeGetCollection<KeetaVdaDaily>('keetaVdaDaily', profile) : Promise.resolve([]),
        allowKt ? safeGetCollection<KeetaRankSnapshot>('keetaRankSnapshots', profile) : Promise.resolve([]),
        allowKt ? safeGetCollection<KeetaFacialRecognitionDaily>('keetaFacialRecognitionDaily', profile) : Promise.resolve([]),
        safeGetCollection<RiderMaster>('riderMaster', profile),
        safeGetCollection<RiderIdentityMapping>('riderIdentityMapping', profile),
        safeGetCollection<ImportBatch>('importBatches', profile),
        safeGetCollection<AuditLog>('auditLogs', profile),
        allowHs ? safeGetCollection<ErrorCodeDictionaryEntry>('hungerErrorDictionary', profile) : Promise.resolve([]),
        allowHs ? safeGetCollection<RiderErrorCase>('hungerRiderErrorCases', profile) : Promise.resolve([]),
        safeGetCollection<OperationalCase>('operationalCases', profile),
        safeGetCollection<RiderNote>('riderNotes', profile),
        safeGetCollection<DocumentTypeConfig>('documentTypes', profile),
        safeGetCollection<PrivateDocumentRecord>('privateDocuments', profile),
        safeGetCollection<PlatformAccount>('platformAccounts', profile),
        safeGetCollection<VehicleMaster>('vehicles', profile),
        safeGetCollection<VehicleAssignment>('vehicleAssignments', profile),
        safeGetCollection<VehicleMaintenanceRecord>('vehicleMaintenance', profile),
        safeGetCollection<EntityNoteTask>('entityNotesTasks', profile),
        safeGetCollection<DynamicFieldDefinition>('dynamicFields', profile),
        safeGetCollection<DynamicFormDefinition>('dynamicForms', profile),
        safeGetCollection<DynamicFormVersion>('dynamicFormVersions', profile),
        safeGetCollection<SystemSectionConfig>('systemSections', profile),
        safeGetCollection<SystemPageConfig>('systemPages', profile),
        safeGetCollection<CustomEntityRecord>('customEntityRecords', profile),
        safeGetCollection<NotificationRuleConfig>('notificationRules', profile),
        safeGetCollection<TrashItemRecord>('trashItems', profile),
        safeGetCollection<ConfigSnapshotRecord>('configSnapshots', profile),
        safeGetCollection<CustomReportTemplate>('customReportTemplates', profile),
        safeGetCollection<SavedViewConfig>('savedViews', profile),
        canFetchFleetOverview ? fetchFleetOverview().catch(() => null) : Promise.resolve(null),
      ]);

      let loadedBranding: CompanyBrandingDoc = {
        ...DEFAULT_COMPANY_BRANDING,
        createdByUid: profile.uid,
        allowedUids: [profile.uid],
      };
      try {
        const brandSnap = await getDoc(doc(db, 'companyBranding', 'default'));
        if (brandSnap.exists()) {
          const raw = brandSnap.data() as Partial<CompanyBrandingDoc>;
          loadedBranding = {
            brandingId: raw.brandingId || 'default',
            company: { ...DEFAULT_COMPANY_BRANDING.company, ...(raw.company || {}) },
            branding: { ...DEFAULT_COMPANY_BRANDING.branding, ...(raw.branding || {}) },
            credits: {
              ...DEFAULT_COMPANY_BRANDING.credits,
              ...(raw.credits || {}),
              changelog: raw.credits?.changelog || DEFAULT_COMPANY_BRANDING.credits.changelog,
            },
            updatedByEmail: raw.updatedByEmail,
            createdByUid: raw.createdByUid || profile.uid,
            allowedUids: raw.allowedUids || [profile.uid],
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          };
        }
      } catch {
        // fallback cleanly to default branding
      }
      setCompanyBranding(loadedBranding);
      if (
        !hadExplicitThemeRef.current &&
        (loadedBranding.branding.defaultThemeMode === 'dark' || loadedBranding.branding.defaultThemeMode === 'light')
      ) {
        setTheme(loadedBranding.branding.defaultThemeMode);
      }

      const allowedSet = new Set<Platform>(effectiveAllowedNow);
      setDataset({
        hungerDaily,
        hungerDistanceDaily,
        hungerWalletSnapshots,
        hungerQualityMonthly,
        keetaDashboardDaily,
        keetaVdaDaily,
        keetaRankSnapshots,
        keetaFacialRecognitionDaily,
        riderMaster,
        riderMappings: riderMappings.filter((m) => allowedSet.has(m.platform)),
      });
      setImportBatches(batches.filter((b) => allowedSet.has(b.platform)));
      setAuditLogs(logs);
      setErrorDictionary(dictEntries);
      setRiderErrorCases(errCases);
      setOperationalCases(opCases.filter((c) => allowedSet.has(c.platform)));
      setRiderNotes(notes.filter((n) => allowedSet.has(n.platform)));

      setDocumentTypes(docTypes);
      setPrivateDocs(privDocs);
      setPlatformAccounts(platAccounts);
      setVehicles(fleetOverview?.vehicles ?? vehList);
      setVehicleAssignments(fleetOverview?.assignments ?? vehAssignments);
      setVehicleMaintenance(fleetOverview?.maintenance ?? vehMaint);
      setFleetAvailability(fleetOverview?.availability ?? []);
      setVehicleCustodies(fleetOverview?.custodies ?? []);
      setVehicleHandovers(fleetOverview?.handovers ?? []);
      setVehicleReturns(fleetOverview?.returns ?? []);
      setVehicleDocuments(fleetOverview?.vehicleDocuments ?? []);
      setVehicleDamageClaims(fleetOverview?.damageClaims ?? []);
      setFleetApprovals(fleetOverview?.approvals ?? []);
      setVehicleStatusHistory(fleetOverview?.statusHistory ?? []);
      setVehicleMovementHistory(fleetOverview?.movementHistory ?? []);
      setFleetNotifications(fleetOverview?.notifications ?? []);
      setFleetConfig(fleetOverview?.fleetConfig ?? opSettings.fleetConfig ?? DEFAULT_FLEET_CONFIG);
      setEntityNotesTasks(notesTasks);

      setDynamicFields(dynFields);
      setDynamicForms(dynForms);
      setDynamicFormVersions(dynFormVersions);
      setSystemSections(sysSections);
      setSystemPages(sysPages);
      setCustomEntityRecords(custRecords);
      setNotificationRules(notifRules);
      setTrashItems(trashList);
      setConfigSnapshots(snapshotsList);
      setCustomReportTemplates(reportTpls);
      setSavedViews(viewsList);

      const canLoadUsersList =
        profile.role === 'owner' ||
        profile.role === 'admin' ||
        profile.role === 'operations_manager' ||
        hasPermission(profile, loadedRoles, 'users', 'view');

      if (canLoadUsersList) {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const allUsers = usersSnap.docs.map((d) => d.data() as unknown as UserProfile);
          setUsersList(allUsers.length > 0 ? allUsers : [profile]);
        } catch {
          setUsersList([profile]);
        }
      } else {
        setUsersList([profile]);
      }

      // Role-based automatic landing route on initial sign-in
      if (didInitRouteRef.current !== profile.uid) {
        didInitRouteRef.current = profile.uid;
        const canGlobalNow = computeCanAccessGlobal(profile, loadedRoles);
        const resolvedNav = normalizeResolvedNav(
          getDefaultErpNavForUser(profile, loadedRoles),
          keetaActiveNow
        );

        if (resolvedNav === 'hungerstation' && !canGlobalNow) {
          setWorkspaceMode('hungerstation');
          setActiveNav('hungerstation');
        } else if (canGlobalNow) {
          setWorkspaceMode('global');
          setActiveNav(resolvedNav);
        } else {
          const fallbackPlatform = effectiveAllowedNow[0] || 'hungerstation';
          setWorkspaceMode(fallbackPlatform);
          setActiveNav(defaultNavForWorkspace(fallbackPlatform, keetaActiveNow));
        }
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'تعذر تحميل بيانات التشغيل من قاعدة البيانات.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchCurrentSessionProfile();
        if (cancelled) return;
        if (!profile) {
          didInitRouteRef.current = null;
          setUserProfile(null);
          setAuthReady(true);
          return;
        }
        syncAuthHandle(profile);
        setUserProfile(profile);
        setAuthReady(true);
        if (profile.active) {
          void loadAllOperationalData(profile);
        }
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'تعذر التحقق من جلسة المستخدم.');
          setAuthReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAllOperationalData]);

  const handleSignIn = async (phone: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const { profile } = await loginWithPhonePassword(phone, password);
      syncAuthHandle(profile);
      setUserProfile(profile);
      setAuthReady(true);
      if (profile.active) {
        void loadAllOperationalData(profile);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'رقم الجوال أو كلمة المرور غير صحيحة.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logoutUser();
    didInitRouteRef.current = null;
    setUserProfile(null);
    setWorkspaceMode('global');
    setActiveNav('executive_admin');
    setSelectedRider(null);
    setFilters(EMPTY_FILTERS);
    setDataset(EMPTY_DATASET);
    setOperationalCases([]);
    setRiderNotes([]);
    setErrorDictionary([]);
    setRiderErrorCases([]);
    setImportBatches([]);
    setRoleTemplates([]);
    setDocumentTypes([]);
    setPrivateDocs([]);
    setPlatformCatalog([]);
    setPlatformAccounts([]);
    setVehicles([]);
    setVehicleAssignments([]);
    setVehicleMaintenance([]);
    setFleetAvailability([]);
    setVehicleCustodies([]);
    setVehicleHandovers([]);
    setVehicleReturns([]);
    setVehicleDocuments([]);
    setVehicleDamageClaims([]);
    setFleetApprovals([]);
    setVehicleStatusHistory([]);
    setVehicleMovementHistory([]);
    setFleetNotifications([]);
    setFleetConfig(DEFAULT_FLEET_CONFIG);
    setEntityNotesTasks([]);
    setCompanyBranding({ ...DEFAULT_COMPANY_BRANDING, createdByUid: '', allowedUids: [] });
    setDynamicFields([]);
    setDynamicForms([]);
    setDynamicFormVersions([]);
    setSystemSections([]);
    setSystemPages([]);
    setCustomEntityRecords([]);
    setNotificationRules([]);
    setTrashItems([]);
    setConfigSnapshots([]);
    setCustomReportTemplates([]);
    setSavedViews([]);
  };

  const keetaActive = useMemo(() => isKeetaActive(settings, platformCatalog), [settings, platformCatalog]);

  const allowedPlatforms = useMemo(() => {
    const raw = getUserAllowedPlatforms(userProfile);
    return keetaActive ? raw : raw.filter((p) => p !== 'keeta');
  }, [userProfile, keetaActive]);

  const canAccessGlobal = useMemo(
    () => computeCanAccessGlobal(userProfile, roleTemplates),
    [userProfile, roleTemplates]
  );

  const effectiveScope: Exclude<WorkspaceMode, 'selector'> = useMemo(() => {
    if (workspaceMode === 'hungerstation' && allowedPlatforms.includes('hungerstation')) return 'hungerstation';
    if (workspaceMode === 'keeta' && keetaActive && allowedPlatforms.includes('keeta')) return 'keeta';
    if (workspaceMode === 'global' && canAccessGlobal) return 'global';
    if (canAccessGlobal) return 'global';
    return allowedPlatforms[0] || 'hungerstation';
  }, [workspaceMode, allowedPlatforms, canAccessGlobal, keetaActive]);

  const isWorkspaceAuthorized = useMemo(() => {
    if (workspaceMode === 'selector') return true;
    if (workspaceMode === 'hungerstation') return allowedPlatforms.includes('hungerstation');
    if (workspaceMode === 'keeta') return keetaActive && allowedPlatforms.includes('keeta');
    if (workspaceMode === 'global') return canAccessGlobal;
    return false;
  }, [workspaceMode, allowedPlatforms, canAccessGlobal, keetaActive]);

  const lockedPlatform: Platform | undefined =
    effectiveScope === 'hungerstation' || effectiveScope === 'keeta' ? effectiveScope : undefined;

  // DataScope Row-Level Filtering
  const userDataScope = useMemo(() => resolveDataScope(userProfile), [userProfile]);

  const dataScopedDataset = useMemo<FleetDataset>(() => {
    const hsDaily = dataset.hungerDaily.filter((r) =>
      matchesDataScope({ city: r.city, platform: 'hungerstation', riderId: r.riderId }, userDataScope)
    );
    const hsDist = dataset.hungerDistanceDaily.filter((r) =>
      matchesDataScope({ city: r.city, platform: 'hungerstation', riderId: r.riderId }, userDataScope)
    );
    const hsWallet = dataset.hungerWalletSnapshots.filter((r) =>
      matchesDataScope({ platform: 'hungerstation', riderId: r.riderId }, userDataScope)
    );
    const hsQual = dataset.hungerQualityMonthly.filter((r) =>
      matchesDataScope({ city: r.city, platform: 'hungerstation', riderId: r.riderId }, userDataScope)
    );
    const ktDash = keetaActive
      ? dataset.keetaDashboardDaily.filter((r) =>
          matchesDataScope({ platform: 'keeta', riderId: r.riderId }, userDataScope)
        )
      : [];
    const ktVda = keetaActive
      ? dataset.keetaVdaDaily.filter((r) =>
          matchesDataScope({ platform: 'keeta', riderId: r.riderId }, userDataScope)
        )
      : [];
    const ktRank = keetaActive
      ? dataset.keetaRankSnapshots.filter((r) =>
          matchesDataScope({ platform: 'keeta', riderId: r.riderId }, userDataScope)
        )
      : [];
    const ktFace = keetaActive
      ? dataset.keetaFacialRecognitionDaily.filter((r) =>
          matchesDataScope({ city: r.city, platform: 'keeta', riderId: r.riderId }, userDataScope)
        )
      : [];
    const riders = dataset.riderMaster.filter((r) =>
      matchesDataScope({ branch: r.branch, city: r.city, internalRiderId: r.internalRiderId }, userDataScope)
    );
    const mappings = dataset.riderMappings.filter((m) => (keetaActive || m.platform !== 'keeta'));

    return {
      hungerDaily: hsDaily,
      hungerDistanceDaily: hsDist,
      hungerWalletSnapshots: hsWallet,
      hungerQualityMonthly: hsQual,
      keetaDashboardDaily: ktDash,
      keetaVdaDaily: ktVda,
      keetaRankSnapshots: ktRank,
      keetaFacialRecognitionDaily: ktFace,
      riderMaster: riders,
      riderMappings: mappings,
    };
  }, [dataset, userDataScope, keetaActive]);

  const scopedDataset = useMemo(
    () => scopeDatasetToPlatform(dataScopedDataset, effectiveScope),
    [dataScopedDataset, effectiveScope]
  );

  const scopedRiderIdSet = useMemo(
    () => new Set(scopedDataset.riderMaster.map((r) => r.internalRiderId)),
    [scopedDataset.riderMaster]
  );

  const scopedPlatformAccounts = useMemo(
    () =>
      platformAccounts.filter(
        (a) =>
          (keetaActive || a.platformId !== 'keeta') &&
          matchesDataScope(
            { branch: a.branch, city: a.city, platformId: a.platformId, internalRiderId: a.companyRiderId },
            userDataScope
          )
      ),
    [platformAccounts, keetaActive, userDataScope]
  );

  const isVehicleScopeUnrestricted = useMemo(
    () =>
      userDataScope.allBranches &&
      userDataScope.cities.length === 0 &&
      userDataScope.riderIds.length === 0 &&
      (!userDataScope.vehicleIds || userDataScope.vehicleIds.length === 0),
    [userDataScope]
  );

  const scopedVehicles = useMemo(() => {
    if (isVehicleScopeUnrestricted) {
      return vehicles;
    }
    return vehicles.filter((v) => {
      if (userDataScope.vehicleIds && userDataScope.vehicleIds.length > 0 && !userDataScope.vehicleIds.includes(v.vehicleInternalId)) {
        return false;
      }
      if (
        !matchesDataScope(
          {
            branch: v.branch,
            city: v.city,
            internalRiderId: v.currentRiderId,
            vehicleInternalId: v.vehicleInternalId,
          },
          userDataScope
        )
      ) {
        return false;
      }
      if (userDataScope.riderIds.length > 0 && v.currentRiderId && !scopedRiderIdSet.has(v.currentRiderId)) {
        return false;
      }
      return true;
    });
  }, [vehicles, isVehicleScopeUnrestricted, userDataScope, scopedRiderIdSet]);

  const scopedVehicleIdSet = useMemo(
    () => new Set(scopedVehicles.map((v) => v.vehicleInternalId)),
    [scopedVehicles]
  );

  const scopedVehicleAssignments = useMemo(() => {
    if (isVehicleScopeUnrestricted) {
      return vehicleAssignments;
    }
    return vehicleAssignments.filter(
      (a) => scopedRiderIdSet.has(a.companyRiderId) || scopedVehicleIdSet.has(a.vehicleInternalId)
    );
  }, [vehicleAssignments, isVehicleScopeUnrestricted, scopedRiderIdSet, scopedVehicleIdSet]);

  const scopedVehicleMaintenance = useMemo(() => {
    if (isVehicleScopeUnrestricted) {
      return vehicleMaintenance;
    }
    return vehicleMaintenance.filter((m) => scopedVehicleIdSet.has(m.vehicleInternalId));
  }, [vehicleMaintenance, isVehicleScopeUnrestricted, scopedVehicleIdSet]);

  const scopedFleetAvailability = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? fleetAvailability
        : fleetAvailability.filter((a) => scopedVehicleIdSet.has(a.vehicleInternalId)),
    [fleetAvailability, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedVehicleCustodies = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleCustodies
        : vehicleCustodies.filter(
            (c) => scopedVehicleIdSet.has(c.vehicleInternalId) || scopedRiderIdSet.has(c.riderId)
          ),
    [vehicleCustodies, isVehicleScopeUnrestricted, scopedVehicleIdSet, scopedRiderIdSet]
  );

  const scopedVehicleDocuments = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleDocuments
        : vehicleDocuments.filter((d) => scopedVehicleIdSet.has(d.vehicleInternalId)),
    [vehicleDocuments, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedStatusHistory = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleStatusHistory
        : vehicleStatusHistory.filter((h) => scopedVehicleIdSet.has(h.vehicleInternalId)),
    [vehicleStatusHistory, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedMovementHistory = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleMovementHistory
        : vehicleMovementHistory.filter((h) => scopedVehicleIdSet.has(h.vehicleInternalId)),
    [vehicleMovementHistory, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedFleetApprovals = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? fleetApprovals
        : fleetApprovals.filter((a) => scopedVehicleIdSet.has(a.vehicleInternalId)),
    [fleetApprovals, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedVehicleHandovers = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleHandovers
        : vehicleHandovers.filter((h) => scopedVehicleIdSet.has(h.vehicleInternalId) || scopedRiderIdSet.has(h.riderId)),
    [vehicleHandovers, isVehicleScopeUnrestricted, scopedVehicleIdSet, scopedRiderIdSet]
  );

  const scopedVehicleReturns = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleReturns
        : vehicleReturns.filter((r) => scopedVehicleIdSet.has(r.vehicleInternalId) || scopedRiderIdSet.has(r.riderId)),
    [vehicleReturns, isVehicleScopeUnrestricted, scopedVehicleIdSet, scopedRiderIdSet]
  );

  const scopedDamageClaims = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? vehicleDamageClaims
        : vehicleDamageClaims.filter((c) => scopedVehicleIdSet.has(c.vehicleInternalId)),
    [vehicleDamageClaims, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedFleetNotifications = useMemo(
    () =>
      isVehicleScopeUnrestricted
        ? fleetNotifications
        : fleetNotifications.filter((n) => !n.vehicleInternalId || scopedVehicleIdSet.has(n.vehicleInternalId)),
    [fleetNotifications, isVehicleScopeUnrestricted, scopedVehicleIdSet]
  );

  const scopedPrivateDocs = useMemo(() => {
    if (isVehicleScopeUnrestricted) {
      return privateDocs;
    }
    return privateDocs.filter((d) =>
      ['vehicle', 'vehicle_doc', 'delegation', 'handover', 'return', 'maintenance', 'damage_claim'].includes(d.entityType)
        ? scopedVehicleIdSet.has(d.entityId)
        : scopedRiderIdSet.has(d.entityId)
    );
  }, [privateDocs, isVehicleScopeUnrestricted, scopedVehicleIdSet, scopedRiderIdSet]);

  const effectiveFilters: FilterState = useMemo(
    () => (lockedPlatform ? { ...filters, platform: lockedPlatform } : filters),
    [filters, lockedPlatform]
  );

  const scopedUnifiedRows = useMemo(() => buildUnifiedDailyRows(scopedDataset), [scopedDataset]);
  const scopedFilterOptions = useMemo(() => extractFilterOptions(scopedUnifiedRows), [scopedUnifiedRows]);
  const scopedFilteredRows = useMemo(
    () => filterUnifiedRows(scopedUnifiedRows, effectiveFilters),
    [scopedUnifiedRows, effectiveFilters]
  );

  const allBranchOptions = useMemo(() => {
    const set = new Set<string>([
      ...(settings.configuredBranches || []),
      ...scopedFilterOptions.branches,
      ...dataset.riderMaster.map((r) => r.branch || '').filter(Boolean),
    ]);
    return Array.from(set).sort();
  }, [settings.configuredBranches, scopedFilterOptions.branches, dataset.riderMaster]);

  const scopedCases = useMemo(() => {
    const base = keetaActive ? operationalCases : operationalCases.filter((c) => c.platform !== 'keeta');
    const byPlatform = lockedPlatform ? base.filter((c) => c.platform === lockedPlatform) : base;
    return byPlatform.filter((c) =>
      matchesDataScope({ branch: c.branch, platform: c.platform, riderId: c.riderId }, userDataScope)
    );
  }, [operationalCases, lockedPlatform, keetaActive, userDataScope]);

  const scopedNotes = useMemo(() => {
    const base = keetaActive ? riderNotes : riderNotes.filter((n) => n.platform !== 'keeta');
    return lockedPlatform ? base.filter((n) => n.platform === lockedPlatform) : base;
  }, [riderNotes, lockedPlatform, keetaActive]);

  const scopedBatches = useMemo(() => {
    const base = keetaActive ? importBatches : importBatches.filter((b) => b.platform !== 'keeta');
    return lockedPlatform ? base.filter((b) => b.platform === lockedPlatform) : base;
  }, [importBatches, lockedPlatform, keetaActive]);

  const scopedErrorDict = useMemo(
    () => (effectiveScope === 'keeta' ? [] : errorDictionary),
    [errorDictionary, effectiveScope]
  );
  const scopedErrorCases = useMemo(
    () => (effectiveScope === 'keeta' ? [] : riderErrorCases),
    [riderErrorCases, effectiveScope]
  );

  const allowedUids = useMemo(() => {
    const activeUids = usersList.filter((u) => u.active).map((u) => u.uid);
    const set = new Set<string>([userProfile?.uid || '', ...activeUids].filter(Boolean));
    return Array.from(set).slice(0, 20);
  }, [usersList, userProfile]);

  const handleSwitchWorkspace = useCallback(
    (mode: WorkspaceMode) => {
      if (mode === 'selector') {
        setWorkspaceMode('selector');
        setSelectedRider(null);
        return;
      }
      if (mode === 'hungerstation' && !allowedPlatforms.includes('hungerstation')) return;
      if (mode === 'keeta' && (!keetaActive || !allowedPlatforms.includes('keeta'))) return;
      if (mode === 'global' && !canAccessGlobal) {
        setWorkspaceMode('selector');
        return;
      }

      setWorkspaceMode(mode);
      setSelectedRider(null);
      setActiveNav(defaultNavForWorkspace(mode, keetaActive));
      setFilters({
        ...EMPTY_FILTERS,
        platform: mode === 'hungerstation' ? 'hungerstation' : mode === 'keeta' ? 'keeta' : 'all',
      });
    },
    [allowedPlatforms, canAccessGlobal, keetaActive]
  );

  const navItemsForCurrentScope = useMemo(
    () =>
      getNavItemsForWorkspace(effectiveScope, {
        userProfile,
        roleTemplates,
        settings,
        platformCatalog,
        allowedPlatforms,
        systemSections,
        systemPages,
      }),
    [effectiveScope, userProfile, roleTemplates, settings, platformCatalog, allowedPlatforms, systemSections, systemPages]
  );

  const safeActiveNav: NavKey = useMemo(() => {
    const validKeys = navItemsForCurrentScope.map((i) => i.key);
    if (validKeys.includes(activeNav)) return activeNav;
    return validKeys[0] || defaultNavForWorkspace(effectiveScope, keetaActive);
  }, [navItemsForCurrentScope, activeNav, effectiveScope, keetaActive]);

  const handleSelectNav = useCallback(
    (nav: NavKey) => {
      const validKeys = navItemsForCurrentScope.map((i) => i.key);
      if (!validKeys.includes(nav)) return;
      setActiveNav(nav);
      if (nav !== 'riders') setSelectedRider(null);
    },
    [navItemsForCurrentScope]
  );

  const openRider360 = useCallback(
    (platform: Platform, riderId: string) => {
      if (platform === 'keeta' && !keetaActive) return;
      if (lockedPlatform && platform !== lockedPlatform) return;
      if (!allowedPlatforms.includes(platform)) return;
      setSelectedRider({ platform, riderId });
      setActiveNav('riders');
    },
    [lockedPlatform, allowedPlatforms, keetaActive]
  );

  const openRider360ByCompanyId = useCallback(
    (internalRiderId: string) => {
      const mapping = dataset.riderMappings.find(
        (m) => m.internalRiderId === internalRiderId && (keetaActive || m.platform !== 'keeta')
      );
      if (mapping) {
        setSelectedRider({ platform: mapping.platform, riderId: mapping.platformRiderId });
      } else {
        const account = platformAccounts.find(
          (a) =>
            a.companyRiderId === internalRiderId &&
            (a.platformId === 'hungerstation' || (keetaActive && a.platformId === 'keeta'))
        );
        if (account) {
          setSelectedRider({
            platform: account.platformId as Platform,
            riderId: account.platformRiderId,
          });
        } else {
          setSelectedRider({ platform: 'hungerstation', riderId: internalRiderId });
        }
      }
      setActiveNav('riders');
    },
    [dataset.riderMappings, platformAccounts, keetaActive]
  );

  const handleGoToSettings = useCallback(() => {
    if (!canAccessGlobal) return;
    setWorkspaceMode('global');
    setSelectedRider(null);
    setFilters(EMPTY_FILTERS);
    setActiveNav('settings');
  }, [canAccessGlobal]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center text-slate-600 dark:text-slate-300 text-sm">
        جاري تهيئة الجلسة والتحقق من الاتصال...
      </div>
    );
  }

  if (!userProfile || !userProfile.active) {
    return (
      <AuthGate
        loading={authLoading}
        error={authError}
        pendingProfile={userProfile && !userProfile.active ? userProfile : null}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />
    );
  }

  if (workspaceMode === 'selector' || !isWorkspaceAuthorized) {
    return (
      <PlatformSelectorHome
        userProfile={userProfile}
        allowedPlatforms={allowedPlatforms}
        canAccessGlobal={canAccessGlobal}
        dataset={dataScopedDataset}
        operationalCases={scopedCases}
        settings={settings}
        platformCatalog={platformCatalog}
        dataLoading={dataLoading}
        onRefreshData={() => loadAllOperationalData(userProfile)}
        onSignOut={handleSignOut}
        onSelectWorkspace={handleSwitchWorkspace}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />
    );
  }

  const showFilterBar = [
    'overview',
    'hungerstation',
    'keeta',
    'error_intel',
    'daily_ops',
    'rider_perf',
    'attendance',
    'distance_wallet',
    'quality',
    'facial',
    'alerts',
  ].includes(safeActiveNav);

  return (
    <EnterpriseShell
      workspaceMode={effectiveScope}
      allowedPlatforms={allowedPlatforms}
      canAccessGlobal={canAccessGlobal}
      onSwitchWorkspace={handleSwitchWorkspace}
      activeNav={safeActiveNav}
      onSelectNav={handleSelectNav}
      selectedRider={selectedRider}
      onSelectRider={openRider360}
      userProfile={userProfile}
      roleTemplates={roleTemplates}
      platformCatalog={platformCatalog}
      vehicles={scopedVehicles}
      platformAccounts={scopedPlatformAccounts}
      privateDocs={scopedPrivateDocs}
      companyBranding={companyBranding}
      systemSections={systemSections}
      systemPages={systemPages}
      notificationRules={notificationRules}
      onSignOut={handleSignOut}
      onRefreshData={() => loadAllOperationalData(userProfile)}
      dataLoading={dataLoading}
      dataset={scopedDataset}
      dictionaryEntries={scopedErrorDict}
      riderErrorCases={scopedErrorCases}
      operationalCases={scopedCases}
      settings={settings}
      filters={effectiveFilters}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
    >
      {dataError && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-800 dark:text-red-200">
          {dataError}
        </div>
      )}

      {showFilterBar && (
        <FilterBar
          filters={effectiveFilters}
          onChange={(next) => setFilters(lockedPlatform ? { ...next, platform: lockedPlatform } : next)}
          options={scopedFilterOptions}
          lockedPlatform={lockedPlatform}
        />
      )}

      {dataLoading ? (
        <RouteFallbackSkeleton />
      ) : (
        <Suspense fallback={<RouteFallbackSkeleton />}>
          {safeActiveNav === 'executive_admin' && effectiveScope === 'global' && (
            <ExecutiveAdminModule
              riders={scopedDataset.riderMaster}
              vehicles={scopedVehicles}
              assignments={scopedVehicleAssignments}
              maintenance={scopedVehicleMaintenance}
              platformAccounts={scopedPlatformAccounts}
              platformCatalog={platformCatalog}
              privateDocs={scopedPrivateDocs}
              operationalCases={scopedCases}
              entityNotesTasks={entityNotesTasks}
              dataset={scopedDataset}
              settings={settings}
              currentUser={userProfile}
              roleTemplates={roleTemplates}
              usersList={usersList}
              allowedUids={allowedUids}
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              onNavigate={(nav) => handleSelectNav(nav as NavKey)}
              onOpenRider360={openRider360ByCompanyId}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {(safeActiveNav === 'hr_dashboard' ||
            safeActiveNav === 'hr_riders' ||
            safeActiveNav === 'hr_docs' ||
            safeActiveNav === 'hr_expiries' ||
            safeActiveNav === 'hr_status') && (
            <HrManagementModule
              key={safeActiveNav}
              riders={scopedDataset.riderMaster}
              privateDocs={scopedPrivateDocs}
              documentTypes={documentTypes}
              platformAccounts={scopedPlatformAccounts}
              vehicleAssignments={scopedVehicleAssignments}
              vehicles={scopedVehicles}
              settings={settings}
              currentUser={userProfile}
              roleTemplates={roleTemplates}
              allowedUids={allowedUids}
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              savedViews={savedViews}
              initialSubTab={safeActiveNav as HrSubTab}
              onOpenRider360={openRider360ByCompanyId}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {(safeActiveNav === 'apps_active' ||
            safeActiveNav === 'apps_accounts' ||
            safeActiveNav === 'apps_linking') && (
            <ApplicationsModule
              key={safeActiveNav}
              platformCatalog={platformCatalog}
              platformAccounts={scopedPlatformAccounts}
              riders={scopedDataset.riderMaster}
              dataset={scopedDataset}
              settings={settings}
              currentUser={userProfile}
              roleTemplates={roleTemplates}
              allowedUids={allowedUids}
              initialSubTab={safeActiveNav as AppsSubTab}
              onOpenRider360={openRider360ByCompanyId}
              onGoToPlatformFlagSettings={() => handleSelectNav('settings')}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {(safeActiveNav === 'fleet_dashboard' ||
            safeActiveNav === 'fleet_vehicles' ||
            safeActiveNav === 'fleet_assignments' ||
            safeActiveNav === 'fleet_approvals' ||
            safeActiveNav === 'fleet_handover' ||
            safeActiveNav === 'fleet_docs' ||
            safeActiveNav === 'fleet_maintenance' ||
            safeActiveNav === 'fleet_reports' ||
            safeActiveNav === 'fleet_settings') && (
            <FleetManagementModule
              key={safeActiveNav}
              vehicles={scopedVehicles}
              assignments={scopedVehicleAssignments}
              maintenance={scopedVehicleMaintenance}
              riders={scopedDataset.riderMaster}
              privateDocs={scopedPrivateDocs}
              documentTypes={documentTypes}
              availability={scopedFleetAvailability}
              custodies={scopedVehicleCustodies}
              handovers={scopedVehicleHandovers}
              returns={scopedVehicleReturns}
              approvals={scopedFleetApprovals}
              damageClaims={scopedDamageClaims}
              notifications={scopedFleetNotifications}
              vehicleDocuments={scopedVehicleDocuments}
              statusHistory={scopedStatusHistory}
              movementHistory={scopedMovementHistory}
              fleetConfig={fleetConfig}
              companyBranding={companyBranding}
              settings={settings}
              currentUser={userProfile}
              roleTemplates={roleTemplates}
              allowedUids={allowedUids}
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              savedViews={savedViews}
              initialSubTab={safeActiveNav as FleetSubTab}
              onOpenRider360={openRider360ByCompanyId}
              onNotificationsUpdated={(next) => setFleetNotifications(next)}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {(safeActiveNav === 'rbac_users' ||
            safeActiveNav === 'rbac_roles' ||
            safeActiveNav === 'rbac_audit') && (
            <RbacManagementModule
              key={safeActiveNav}
              usersList={usersList}
              roleTemplates={roleTemplates}
              auditLogs={auditLogs}
              riders={scopedDataset.riderMaster}
              branches={allBranchOptions}
              platformCatalog={platformCatalog}
              settings={settings}
              currentUser={userProfile}
              allowedUids={allowedUids}
              initialSubTab={safeActiveNav as RbacSubTab}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'overview' && effectiveScope === 'global' && (
            <OverviewDashboard
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              dictionaryEntries={scopedErrorDict}
              operationalCases={scopedCases}
              settings={settings}
              platformCatalog={platformCatalog}
              onGoToImport={() => handleSelectNav('import')}
              onGoToOperations={() => handleSelectNav('operations')}
              onGoToErrors={() => handleSelectNav('error_intel')}
              onSelectRider={openRider360}
              onOpenPlatformWorkspace={(p) => handleSwitchWorkspace(p)}
            />
          )}

          {safeActiveNav === 'hungerstation' && (
            <HungerStationView
              dataset={scopedDataset}
              filters={effectiveFilters}
              operationalCases={scopedCases}
              settings={settings}
              onSelectRider={openRider360}
              onGoToErrors={() => handleSelectNav('error_intel')}
              onGoToOperations={() => handleSelectNav('operations')}
              onGoToImport={() => handleSelectNav('import')}
            />
          )}

          {safeActiveNav === 'keeta' && keetaActive && (
            <KeetaView
              dataset={scopedDataset}
              filters={effectiveFilters}
              operationalCases={scopedCases}
              settings={settings}
              onSelectRider={openRider360}
              onGoToOperations={() => handleSelectNav('operations')}
              onGoToImport={() => handleSelectNav('import')}
              onGoToFacial={() => handleSelectNav('facial')}
            />
          )}

          {safeActiveNav === 'error_intel' && (
            <ErrorIntelligenceCenter
              dataset={scopedDataset}
              dictionaryEntries={scopedErrorDict}
              riderErrorCases={scopedErrorCases}
              operationalCases={scopedCases}
              settings={settings}
              filters={effectiveFilters}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onSelectRider={openRider360}
              onGoToSettings={handleGoToSettings}
              onGoToOperations={() => handleSelectNav('operations')}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'operations' && (
            <OperationsControlCenter
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              dictionaryEntries={scopedErrorDict}
              operationalCases={scopedCases}
              settings={settings}
              usersList={usersList}
              currentUser={userProfile}
              allowedUids={allowedUids}
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'riders' && (
            <RiderManagementAnd360
              dataset={scopedDataset}
              dictionaryEntries={scopedErrorDict}
              riderErrorCases={scopedErrorCases}
              operationalCases={scopedCases}
              riderNotes={scopedNotes}
              settings={settings}
              currentUser={userProfile}
              allowedUids={allowedUids}
              selectedRider={selectedRider}
              workspaceScope={effectiveScope}
              platformCatalog={platformCatalog}
              platformAccounts={scopedPlatformAccounts}
              privateDocs={scopedPrivateDocs}
              vehicles={scopedVehicles}
              vehicleAssignments={scopedVehicleAssignments}
              entityNotesTasks={entityNotesTasks}
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              onSelectRider={setSelectedRider}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'daily_ops' && (
            <DailyOperationsView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'rider_perf' && (
            <RiderPerformanceView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'attendance' && (
            <AttendanceShiftsView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'quality' && (
            <DeliveryQualityView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'distance_wallet' && (
            <DistanceWalletView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'facial' && keetaActive && (
            <FacialRecognitionView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              filters={effectiveFilters}
              lockedPlatform="keeta"
              onSelectRider={openRider360}
            />
          )}

          {safeActiveNav === 'alerts' && (
            <AlertsCenterView
              dataset={scopedDataset}
              dictionaryEntries={scopedErrorDict}
              riderErrorCases={scopedErrorCases}
              vehicles={scopedVehicles}
              privateDocs={scopedPrivateDocs}
              platformAccounts={scopedPlatformAccounts}
              platformCatalog={platformCatalog}
              settings={settings}
              filters={effectiveFilters}
              lockedPlatform={lockedPlatform}
              onSelectRider={openRider360}
              onGoToSettings={handleGoToSettings}
            />
          )}

          {safeActiveNav === 'reports' && (
            <ReportsExportsView
              dataset={scopedDataset}
              filteredRows={scopedFilteredRows}
              dictionaryEntries={scopedErrorDict}
              riderErrorCases={scopedErrorCases}
              operationalCases={scopedCases}
              vehicles={scopedVehicles}
              vehicleAssignments={scopedVehicleAssignments}
              vehicleMaintenance={scopedVehicleMaintenance}
              platformAccounts={scopedPlatformAccounts}
              privateDocs={scopedPrivateDocs}
              auditLogs={auditLogs}
              platformCatalog={platformCatalog}
              settings={settings}
              lockedPlatform={lockedPlatform}
              companyBranding={companyBranding}
              dynamicFields={dynamicFields}
              systemPages={systemPages}
              customEntityRecords={customEntityRecords}
              reportTemplates={customReportTemplates}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'import' && (
            <ImportCenter
              currentUser={userProfile}
              importBatches={scopedBatches}
              settings={settings}
              platformCatalog={platformCatalog}
              lockedPlatform={
                effectiveScope === 'global'
                  ? keetaActive
                    ? undefined
                    : 'hungerstation'
                  : effectiveScope
              }
              onCommitted={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'settings' && canAccessGlobal && (
            <SystemSettingsView
              settings={settings}
              auditLogs={auditLogs}
              currentUser={userProfile}
              allowedUids={allowedUids}
              platformCatalog={platformCatalog}
              documentTypes={documentTypes}
              roleTemplates={roleTemplates}
              onOpenRbac={() => handleSelectNav('rbac_roles')}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'company_branding' && canAccessGlobal && (
            <CompanyBrandingModule
              branding={companyBranding}
              currentUser={userProfile}
              roleTemplates={roleTemplates}
              allowedUids={allowedUids}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav === 'about_credits' && canAccessGlobal && (
            <AboutCreditsModule
              branding={companyBranding}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {(safeActiveNav === 'system_builder' || safeActiveNav === 'system_backup_reset') && canAccessGlobal && (
            <SystemBuilderModule
              dynamicFields={dynamicFields}
              dynamicForms={dynamicForms}
              dynamicFormVersions={dynamicFormVersions}
              systemSections={systemSections}
              systemPages={systemPages}
              customEntityRecords={customEntityRecords}
              notificationRules={notificationRules}
              trashItems={trashItems}
              configSnapshots={configSnapshots}
              customReportTemplates={customReportTemplates}
              companyBranding={companyBranding}
              roleTemplates={roleTemplates}
              auditLogs={auditLogs}
              riders={scopedDataset.riderMaster}
              vehicles={scopedVehicles}
              assignments={scopedVehicleAssignments}
              maintenance={scopedVehicleMaintenance}
              operationalCases={scopedCases}
              entityNotesTasks={entityNotesTasks}
              currentUser={userProfile}
              allowedUids={allowedUids}
              initialSubTab={safeActiveNav === 'system_backup_reset' ? 'system_reset' : 'fields'}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}

          {safeActiveNav.startsWith('custom_page_') &&
            (() => {
              const targetPageId = safeActiveNav.replace('custom_page_', '');
              const matchedPage = systemPages.find((p) => p.pageId === targetPageId);
              if (!matchedPage) return null;
              return (
                <CustomPageModule
                  key={matchedPage.pageId}
                  page={matchedPage}
                  records={customEntityRecords.filter((r) => r.pageId === matchedPage.pageId)}
                  dynamicFields={dynamicFields}
                  dynamicForms={dynamicForms}
                  savedViews={savedViews}
                  currentUser={userProfile}
                  allowedUids={allowedUids}
                  onRefresh={() => loadAllOperationalData(userProfile)}
                />
              );
            })()}
        </Suspense>
      )}
    </EnterpriseShell>
  );
}
