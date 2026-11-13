import { collection, getDocs, query, where } from 'firebase/firestore';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { EnterpriseShell, type NavKey } from './components/EnterpriseShell';
import { EMPTY_FILTERS, FilterBar } from './components/FilterBar';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  DEFAULT_OPERATIONAL_SETTINGS,
  ensureOperationalSettings,
  ensureUserProfile,
  handleFirestoreError,
  logoutUser,
  OperationType,
  signInWithGoogle,
  subscribeAuth,
} from './lib/firebase';
import {
  buildUnifiedDailyRows,
  extractFilterOptions,
  filterUnifiedRows,
  type FleetDataset,
} from './lib/fleetAnalytics';
import type {
  AuditLog,
  ErrorCodeDictionaryEntry,
  FilterState,
  HungerDailyRecord,
  HungerDistanceDailyRecord,
  HungerQualityMonthly,
  HungerWalletSnapshot,
  ImportBatch,
  KeetaDashboardDaily,
  KeetaFacialRecognitionDaily,
  KeetaRankSnapshot,
  KeetaVdaDaily,
  OperationalCase,
  OperationalSettings,
  Platform,
  RiderErrorCase,
  RiderIdentityMapping,
  RiderMaster,
  RiderNote,
  UserProfile,
} from './types/fleet';

// Route-level code splitting for heavy analytical & reporting modules
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
const UserManagementView = lazy(() =>
  import('./components/SettingsAndUsers').then((m) => ({ default: m.UserManagementView }))
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

async function safeGetCollection<T>(colName: string, profile: UserProfile): Promise<T[]> {
  try {
    const isBootOwner = profile.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
    const ref = collection(db, colName);
    const q = isBootOwner ? ref : query(ref, where('allowedUids', 'array-contains', profile.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as T);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, colName);
  }
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

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('foc_theme');
      if (saved === 'dark' || saved === 'light') return saved;
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

  const [activeNav, setActiveNav] = useState<NavKey>('overview');
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
      const opSettings = await ensureOperationalSettings(profile.uid, profile.email, canCreateSettings);
      setSettings(opSettings);

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
      ] = await Promise.all([
        safeGetCollection<HungerDailyRecord>('hungerDaily', profile),
        safeGetCollection<HungerDistanceDailyRecord>('hungerDistanceDaily', profile),
        safeGetCollection<HungerWalletSnapshot>('hungerWalletSnapshots', profile),
        safeGetCollection<HungerQualityMonthly>('hungerQualityMonthly', profile),
        safeGetCollection<KeetaDashboardDaily>('keetaDashboardDaily', profile),
        safeGetCollection<KeetaVdaDaily>('keetaVdaDaily', profile),
        safeGetCollection<KeetaRankSnapshot>('keetaRankSnapshots', profile),
        safeGetCollection<KeetaFacialRecognitionDaily>('keetaFacialRecognitionDaily', profile),
        safeGetCollection<RiderMaster>('riderMaster', profile),
        safeGetCollection<RiderIdentityMapping>('riderIdentityMapping', profile),
        safeGetCollection<ImportBatch>('importBatches', profile),
        safeGetCollection<AuditLog>('auditLogs', profile),
        safeGetCollection<ErrorCodeDictionaryEntry>('hungerErrorDictionary', profile),
        safeGetCollection<RiderErrorCase>('hungerRiderErrorCases', profile),
        safeGetCollection<OperationalCase>('operationalCases', profile),
        safeGetCollection<RiderNote>('riderNotes', profile),
      ]);

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
        riderMappings,
      });
      setImportBatches(batches);
      setAuditLogs(logs);
      setErrorDictionary(dictEntries);
      setRiderErrorCases(errCases);
      setOperationalCases(opCases);
      setRiderNotes(notes);

      if (profile.role === 'owner' || profile.role === 'admin') {
        try {
          const isBootOwner = profile.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
          const usersRef = collection(db, 'users');
          const usersQuery = isBootOwner
            ? usersRef
            : query(usersRef, where('managedByAdminUids', 'array-contains', profile.uid));
          const usersSnap = await getDocs(usersQuery);
          const allUsers = usersSnap.docs.map((d) => d.data() as UserProfile);
          setUsersList(allUsers.length > 0 ? allUsers : [profile]);
        } catch {
          setUsersList([profile]);
        }
      } else {
        setUsersList([profile]);
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'تعذر تحميل بيانات التشغيل من Firestore.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeAuth(async (firebaseUser) => {
      if (!firebaseUser) {
        setUserProfile(null);
        setAuthReady(true);
        return;
      }
      try {
        const profile = await ensureUserProfile(firebaseUser);
        setUserProfile(profile);
        setAuthReady(true);
        if (profile.active) {
          void loadAllOperationalData(profile);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'تعذر تحميل ملف المستخدم.');
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, [loadAllOperationalData]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'فشل تسجيل الدخول عبر Google.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logoutUser();
    setUserProfile(null);
    setDataset(EMPTY_DATASET);
    setOperationalCases([]);
    setRiderNotes([]);
  };

  const unifiedRows = useMemo(() => buildUnifiedDailyRows(dataset), [dataset]);
  const filterOptions = useMemo(() => extractFilterOptions(unifiedRows), [unifiedRows]);
  const filteredRows = useMemo(() => filterUnifiedRows(unifiedRows, filters), [unifiedRows, filters]);

  const allowedUids = useMemo(() => {
    const activeUids = usersList.filter((u) => u.active).map((u) => u.uid);
    const set = new Set<string>([userProfile?.uid || '', ...activeUids].filter(Boolean));
    return Array.from(set).slice(0, 20);
  }, [usersList, userProfile]);

  const openRider360 = useCallback((platform: Platform, riderId: string) => {
    setSelectedRider({ platform, riderId });
    setActiveNav('riders');
  }, []);

  const handleSelectNav = useCallback((nav: NavKey) => {
    setActiveNav(nav);
    if (nav !== 'riders') setSelectedRider(null);
  }, []);

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

  const showFilterBar = !['import', 'settings', 'users', 'riders', 'operations', 'reports'].includes(activeNav);

  return (
    <EnterpriseShell
      activeNav={activeNav}
      onSelectNav={handleSelectNav}
      selectedRider={selectedRider}
      onSelectRider={openRider360}
      userProfile={userProfile}
      onSignOut={handleSignOut}
      onRefreshData={() => loadAllOperationalData(userProfile)}
      dataLoading={dataLoading}
      dataset={dataset}
      dictionaryEntries={errorDictionary}
      riderErrorCases={riderErrorCases}
      operationalCases={operationalCases}
      settings={settings}
      filters={filters}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
    >
      {dataError && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-800 dark:text-red-200">
          {dataError}
        </div>
      )}

      {showFilterBar && <FilterBar filters={filters} onChange={setFilters} options={filterOptions} />}

      {dataLoading ? (
        <RouteFallbackSkeleton />
      ) : (
        <Suspense fallback={<RouteFallbackSkeleton />}>
          {activeNav === 'overview' && (
            <OverviewDashboard
              dataset={dataset}
              filteredRows={filteredRows}
              dictionaryEntries={errorDictionary}
              operationalCases={operationalCases}
              settings={settings}
              onGoToImport={() => handleSelectNav('import')}
              onGoToOperations={() => handleSelectNav('operations')}
              onGoToErrors={() => handleSelectNav('error_intel')}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'operations' && (
            <OperationsControlCenter
              dataset={dataset}
              filteredRows={filteredRows}
              dictionaryEntries={errorDictionary}
              operationalCases={operationalCases}
              settings={settings}
              usersList={usersList}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onSelectRider={openRider360}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}
          {activeNav === 'hungerstation' && (
            <HungerStationView dataset={dataset} filters={filters} onSelectRider={openRider360} />
          )}
          {activeNav === 'error_intel' && (
            <ErrorIntelligenceCenter
              dataset={dataset}
              dictionaryEntries={errorDictionary}
              riderErrorCases={riderErrorCases}
              operationalCases={operationalCases}
              settings={settings}
              filters={filters}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onSelectRider={openRider360}
              onGoToSettings={() => handleSelectNav('settings')}
              onGoToOperations={() => handleSelectNav('operations')}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}
          {activeNav === 'keeta' && (
            <KeetaView dataset={dataset} filters={filters} onSelectRider={openRider360} />
          )}
          {activeNav === 'riders' && (
            <RiderManagementAnd360
              dataset={dataset}
              dictionaryEntries={errorDictionary}
              riderErrorCases={riderErrorCases}
              operationalCases={operationalCases}
              riderNotes={riderNotes}
              settings={settings}
              currentUser={userProfile}
              allowedUids={allowedUids}
              selectedRider={selectedRider}
              onSelectRider={setSelectedRider}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}
          {activeNav === 'daily_ops' && (
            <DailyOperationsView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'rider_perf' && (
            <RiderPerformanceView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'attendance' && (
            <AttendanceShiftsView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'quality' && (
            <DeliveryQualityView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'distance_wallet' && (
            <DistanceWalletView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'facial' && (
            <FacialRecognitionView
              dataset={dataset}
              filteredRows={filteredRows}
              filters={filters}
              onSelectRider={openRider360}
            />
          )}
          {activeNav === 'alerts' && (
            <AlertsCenterView
              dataset={dataset}
              dictionaryEntries={errorDictionary}
              riderErrorCases={riderErrorCases}
              settings={settings}
              filters={filters}
              onSelectRider={openRider360}
              onGoToSettings={() => handleSelectNav('settings')}
            />
          )}
          {activeNav === 'reports' && (
            <ReportsExportsView
              dataset={dataset}
              filteredRows={filteredRows}
              dictionaryEntries={errorDictionary}
              riderErrorCases={riderErrorCases}
              operationalCases={operationalCases}
              settings={settings}
            />
          )}
          {activeNav === 'import' && (
            <ImportCenter
              currentUser={userProfile}
              importBatches={importBatches}
              settings={settings}
              onCommitted={() => loadAllOperationalData(userProfile)}
            />
          )}
          {activeNav === 'settings' && (
            <SystemSettingsView
              settings={settings}
              auditLogs={auditLogs}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}
          {activeNav === 'users' && (
            <UserManagementView
              usersList={usersList}
              currentUser={userProfile}
              allowedUids={allowedUids}
              onRefresh={() => loadAllOperationalData(userProfile)}
            />
          )}
        </Suspense>
      )}
    </EnterpriseShell>
  );
}
