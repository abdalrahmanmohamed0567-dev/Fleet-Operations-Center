import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  Bell,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  RefreshCw,
  ScanFace,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Truck,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeErrorCodeIntelligence, generateErrorIntelligenceAlerts } from '../lib/errorIntelligence';
import { generateOperationalAlerts, type FleetDataset } from '../lib/fleetAnalytics';
import type {
  ErrorCodeDictionaryEntry,
  FilterState,
  OperationalCase,
  OperationalSettings,
  Platform,
  RiderErrorCase,
  UserProfile,
} from '../types/fleet';

export type NavKey =
  | 'overview'
  | 'operations'
  | 'hungerstation'
  | 'error_intel'
  | 'keeta'
  | 'riders'
  | 'daily_ops'
  | 'rider_perf'
  | 'attendance'
  | 'quality'
  | 'distance_wallet'
  | 'facial'
  | 'alerts'
  | 'reports'
  | 'import'
  | 'settings'
  | 'users';

export interface NavItemDef {
  key: NavKey;
  label: string;
  group: 'القيادة والتحكم' | 'المنصات والتشغيل' | 'التحليلات والتقارير' | 'البيانات والإدارة';
  icon: typeof LayoutDashboard;
}

export const NAV_ITEMS: NavItemDef[] = [
  { key: 'overview', label: 'القيادة التنفيذية', group: 'القيادة والتحكم', icon: LayoutDashboard },
  { key: 'operations', label: 'مركز التحكم التشغيلي', group: 'القيادة والتحكم', icon: SlidersHorizontal },
  { key: 'alerts', label: 'مركز التنبيهات', group: 'القيادة والتحكم', icon: Bell },
  { key: 'hungerstation', label: 'أداء هنقرستيشن', group: 'المنصات والتشغيل', icon: Truck },
  { key: 'error_intel', label: 'أكواد أخطاء هنقرستيشن', group: 'المنصات والتشغيل', icon: AlertTriangle },
  { key: 'keeta', label: 'أداء كيتا', group: 'المنصات والتشغيل', icon: Activity },
  { key: 'riders', label: 'المندوبون و360°', group: 'المنصات والتشغيل', icon: Users },
  { key: 'daily_ops', label: 'العمليات اليومية', group: 'التحليلات والتقارير', icon: Clock },
  { key: 'rider_perf', label: 'أداء المندوبين', group: 'التحليلات والتقارير', icon: BarChart3 },
  { key: 'attendance', label: 'الحضور والشفتات', group: 'التحليلات والتقارير', icon: CalendarCheck },
  { key: 'quality', label: 'جودة التسليم', group: 'التحليلات والتقارير', icon: Award },
  { key: 'distance_wallet', label: 'المسافات والمحافظ', group: 'التحليلات والتقارير', icon: MapPin },
  { key: 'facial', label: 'التحقق من الهوية', group: 'التحليلات والتقارير', icon: ScanFace },
  { key: 'reports', label: 'التقارير والذكاء التجاري', group: 'التحليلات والتقارير', icon: FileSpreadsheet },
  { key: 'import', label: 'مركز الاستيراد', group: 'البيانات والإدارة', icon: Upload },
  { key: 'settings', label: 'إعدادات النظام', group: 'البيانات والإدارة', icon: Settings },
  { key: 'users', label: 'المستخدمون والصلاحيات', group: 'البيانات والإدارة', icon: Shield },
];

const ROLE_PERMISSION_NOTES: Record<UserProfile['role'], string> = {
  owner: 'صلاحيات كاملة: استيراد، تعديل الإعدادات، إدارة المستخدمين، إدارة الحالات والأخطاء.',
  admin: 'إدارة النظام، استيراد البيانات، إدارة المستخدمين، والحالات التشغيلية.',
  operations_manager: 'استيراد التقارير، إدارة الحالات التشغيلية، قاموس الأخطاء، وضبط الحدود.',
  supervisor: 'متابعة الفرق، توثيق الحالات التشغيلية، والملاحظات الإدارية.',
  viewer: 'عرض اللوحات والتقارير والتصدير فقط (للقراءة).',
};

interface EnterpriseShellProps {
  activeNav: NavKey;
  onSelectNav: (nav: NavKey) => void;
  selectedRider: { platform: Platform; riderId: string } | null;
  onSelectRider: (platform: Platform, riderId: string) => void;
  userProfile: UserProfile;
  onSignOut: () => void;
  onRefreshData: () => void;
  dataLoading: boolean;
  dataset: FleetDataset;
  dictionaryEntries: ErrorCodeDictionaryEntry[];
  riderErrorCases: RiderErrorCase[];
  operationalCases: OperationalCase[];
  settings: OperationalSettings;
  filters: FilterState;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  children: ReactNode;
}

export function EnterpriseShell({
  activeNav,
  onSelectNav,
  selectedRider,
  onSelectRider,
  userProfile,
  onSignOut,
  onRefreshData,
  dataLoading,
  dataset,
  dictionaryEntries,
  riderErrorCases,
  operationalCases,
  settings,
  filters,
  theme,
  onToggleTheme,
  children,
}: EnterpriseShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('foc_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggleCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('foc_sidebar_collapsed', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  }, [searchOpen]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Real notifications derived from live operational alerts + error alerts + overdue cases
  const notifications = useMemo(() => {
    const opsAlerts = generateOperationalAlerts(dataset, settings, filters);
    const errReport = computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, filters);
    const errAlerts = generateErrorIntelligenceAlerts(errReport, settings);
    const todayStr = new Date().toISOString().slice(0, 10);

    const overdueCaseItems = operationalCases
      .filter((c) => c.status !== 'closed' && c.status !== 'resolved' && c.dueDate && c.dueDate < todayStr)
      .slice(0, 8)
      .map((c) => ({
        id: `case_due_${c.caseId}`,
        kind: 'case' as const,
        severity: 'critical' as const,
        title: `حالة متأخرة: ${c.riderName || c.riderId}`,
        subtitle: `${c.title} · استحقاق ${c.dueDate}`,
        onClick: () => {
          onSelectNav('operations');
          setNotifOpen(false);
        },
      }));

    const alertItems = [...errAlerts, ...opsAlerts].slice(0, 12).map((a) => ({
      id: a.id,
      kind: 'alert' as const,
      severity: a.severity,
      title: `${a.category} — ${a.riderId !== '-' ? a.riderId : a.title}`,
      subtitle: a.description,
      onClick: () => {
        if (a.riderId && a.riderId !== '-') {
          onSelectRider(a.platform, a.riderId);
        } else {
          onSelectNav('alerts');
        }
        setNotifOpen(false);
      },
    }));

    return [...overdueCaseItems, ...alertItems];
  }, [dataset, dictionaryEntries, riderErrorCases, operationalCases, settings, filters, onSelectNav, onSelectRider]);

  const criticalNotifCount = notifications.filter((n) => n.severity === 'critical').length;

  // Global Search Results across pages, riders, error codes, and operational cases
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        pages: NAV_ITEMS.slice(0, 6),
        riders: [] as Array<{ platform: Platform; riderId: string; label: string; sub: string }>,
        cases: [] as OperationalCase[],
        codes: [] as ErrorCodeDictionaryEntry[],
      };
    }

    const pages = NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q)).slice(0, 5);

    const riderMap = new Map<string, { platform: Platform; riderId: string; label: string; sub: string }>();
    for (const m of dataset.riderMaster) {
      if (`${m.internalRiderId} ${m.fullName} ${m.city || ''} ${m.branch || ''}`.toLowerCase().includes(q)) {
        const mapping = dataset.riderMappings.find((mp) => mp.internalRiderId === m.internalRiderId);
        const targetPlatform: Platform = mapping ? mapping.platform : 'hungerstation';
        const targetId = mapping ? mapping.platformRiderId : m.internalRiderId;
        riderMap.set(`${targetPlatform}:${targetId}`, {
          platform: targetPlatform,
          riderId: targetId,
          label: `${m.fullName} (${m.internalRiderId})`,
          sub: `${m.city || '-'} · ${m.branch || '-'}`,
        });
      }
    }
    for (const r of dataset.hungerDaily) {
      if (riderMap.size >= 8) break;
      if (r.riderId.toLowerCase().includes(q) && !riderMap.has(`hungerstation:${r.riderId}`)) {
        riderMap.set(`hungerstation:${r.riderId}`, {
          platform: 'hungerstation',
          riderId: r.riderId,
          label: `مندوب HungerStation: ${r.riderId}`,
          sub: `${r.city || '-'} · ${r.contractName || '-'}`,
        });
      }
    }
    for (const r of dataset.keetaDashboardDaily) {
      if (riderMap.size >= 10) break;
      if (`${r.riderId} ${r.fullName || ''}`.toLowerCase().includes(q) && !riderMap.has(`keeta:${r.riderId}`)) {
        riderMap.set(`keeta:${r.riderId}`, {
          platform: 'keeta',
          riderId: r.riderId,
          label: `${r.fullName || r.riderId} (${r.riderId})`,
          sub: `Keeta · ${r.branch || r.headquarters || '-'}`,
        });
      }
    }

    const cases = operationalCases
      .filter((c) => `${c.title} ${c.riderId} ${c.riderName} ${c.caseId}`.toLowerCase().includes(q))
      .slice(0, 5);

    const codes = dictionaryEntries
      .filter((d) => `${d.normalizedCode} ${d.arabicDescription} ${d.category || ''}`.toLowerCase().includes(q))
      .slice(0, 5);

    return {
      pages,
      riders: Array.from(riderMap.values()).slice(0, 8),
      cases,
      codes,
    };
  }, [searchQuery, dataset, operationalCases, dictionaryEntries]);

  const currentNavMeta = NAV_ITEMS.find((i) => i.key === activeNav) || NAV_ITEMS[0];
  const groups = ['القيادة والتحكم', 'المنصات والتشغيل', 'التحليلات والتقارير', 'البيانات والإدارة'] as const;

  const renderSidebarContent = (collapsed: boolean, onItemClick?: () => void) => (
    <>
      <div className={`flex h-16 items-center border-b border-slate-800 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-emerald-400">
            <Truck className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">Fleet Operations</div>
              <div className="truncate text-[11px] text-slate-400">Enterprise · HS &amp; Keeta</div>
            </div>
          )}
        </div>
        {!onItemClick && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
            className="hidden lg:inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-4">
        {groups.map((grp) => {
          const items = NAV_ITEMS.filter((i) => i.group === grp);
          return (
            <div key={grp} className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  {grp}
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    title={collapsed ? item.label : undefined}
                    onClick={() => {
                      onSelectNav(item.key);
                      onItemClick?.();
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      active
                        ? 'bg-slate-800 text-white font-semibold'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3 space-y-2">
        {!collapsed && (
          <div className="min-w-0 px-1">
            <div className="truncate text-xs font-semibold text-white">{userProfile.displayName}</div>
            <div className="truncate text-[11px] font-mono-num text-slate-400">
              {userProfile.role} · {userProfile.email}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title="تسجيل الخروج"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>تسجيل الخروج</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Collapsible Navy Sidebar */}
      <aside
        className={`no-print hidden lg:flex lg:shrink-0 lg:flex-col bg-slate-900 dark:bg-slate-950 text-slate-200 border-l border-slate-800 transition-all duration-200 ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
        }`}
      >
        {renderSidebarContent(sidebarCollapsed)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/70" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex w-72 flex-col bg-slate-900 text-slate-200">
            <div className="flex h-12 items-center justify-end border-b border-slate-800 px-4">
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderSidebarContent(false, () => setMobileMenuOpen(false))}
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Enterprise Sticky Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 lg:px-6">
          {/* Left/Start: Menu + Breadcrumbs */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-700 dark:text-slate-200 lg:hidden"
              aria-label="القائمة"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Fleet Operations</span>
                <span>/</span>
                <span>{currentNavMeta.group}</span>
                {activeNav === 'riders' && selectedRider && (
                  <>
                    <span>/</span>
                    <span className="font-mono-num text-blue-700 dark:text-blue-400">{selectedRider.riderId}</span>
                  </>
                )}
              </div>
              <h1 className="truncate text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                {currentNavMeta.label}
              </h1>
            </div>
          </div>

          {/* Center: Global Search Button */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center justify-between gap-4 w-72 lg:w-80 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">بحث شامل: مندوب، كود خطأ، حالة، تقرير...</span>
            </span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono-num">
              Ctrl+K
            </kbd>
          </button>

          {/* End: Controls (Search mobile, Theme Toggle, Notifications, Refresh, User Profile) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="md:hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-200"
              aria-label="بحث"
            >
              <Search className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Real Notification Center */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                title="التنبيهات والتصعيدات الحرجة"
                className="relative rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Bell className="h-4 w-4" />
                {criticalNotifCount > 0 && (
                  <span className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold font-mono-num text-white">
                    {criticalNotifCount > 99 ? '99+' : criticalNotifCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      مركز الإشعارات التشغيلية ({notifications.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectNav('alerts');
                        setNotifOpen(false);
                      }}
                      className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      فتح مركز التنبيهات
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        لا توجد تنبيهات أو حالات متأخرة نشطة حاليًا.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={n.onClick}
                          className="w-full px-4 py-2.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-xs font-semibold truncate ${
                                n.severity === 'critical'
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {n.title}
                            </span>
                            <span className="text-[10px] font-mono-num text-slate-400 shrink-0">
                              {n.kind === 'case' ? 'حالة متأخرة' : n.severity === 'critical' ? 'حرج' : 'تحذير'}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                            {n.subtitle}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={dataLoading}
              onClick={onRefreshData}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${dataLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">تحديث البيانات</span>
            </button>

            {/* User Profile Popover */}
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 dark:bg-blue-600 text-white">
                  <User className="h-3.5 w-3.5" />
                </div>
                <span className="hidden xl:inline max-w-[120px] truncate font-semibold text-slate-800 dark:text-slate-100">
                  {userProfile.displayName}
                </span>
              </button>

              {profileOpen && (
                <div className="absolute left-0 mt-2 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl z-50 space-y-3 text-xs">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <div className="font-bold text-slate-900 dark:text-slate-100">{userProfile.displayName}</div>
                    <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{userProfile.email}</div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">الدور الوظيفي:</span>
                      <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{userProfile.role}</span>
                    </div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {ROLE_PERMISSION_NOTES[userProfile.role]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 space-y-6">{children}</main>
      </div>

      {/* Global Search Modal */}
      {searchOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 pt-16 p-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث برقم المندوب، الاسم، كود الخطأ، عنوان الحالة التشغيلية، أو اسم الصفحة..."
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-3 space-y-4 text-xs">
              {searchResults.pages.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">الصفحات والأقسام</div>
                  <div className="space-y-1">
                    {searchResults.pages.map((p) => {
                      const Icon = p.icon;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => {
                            onSelectNav(p.key);
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                        >
                          <Icon className="h-4 w-4 text-slate-500" />
                          <span className="font-semibold">{p.label}</span>
                          <span className="text-[11px] text-slate-400 mr-auto">{p.group}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {searchResults.riders.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">المندوبون (Rider 360°)</div>
                  <div className="space-y-1">
                    {searchResults.riders.map((r) => (
                      <button
                        key={`${r.platform}:${r.riderId}`}
                        type="button"
                        onClick={() => {
                          onSelectRider(r.platform, r.riderId);
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{r.label}</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{r.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.codes.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">أكواد أخطاء هنقرستيشن</div>
                  <div className="space-y-1">
                    {searchResults.codes.map((c) => (
                      <button
                        key={c.codeKey}
                        type="button"
                        onClick={() => {
                          onSelectNav('error_intel');
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">{c.normalizedCode}</span>
                        <span className="text-slate-600 dark:text-slate-300 truncate max-w-xs">{c.arabicDescription}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.cases.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">الحالات التشغيلية</div>
                  <div className="space-y-1">
                    {searchResults.cases.map((c) => (
                      <button
                        key={c.caseId}
                        type="button"
                        onClick={() => {
                          onSelectNav('operations');
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{c.title}</span>
                        <span className="font-mono-num text-[11px] text-slate-500">{c.riderId} · {c.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchQuery.trim() &&
                searchResults.pages.length === 0 &&
                searchResults.riders.length === 0 &&
                searchResults.codes.length === 0 &&
                searchResults.cases.length === 0 && (
                  <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                    لم يتم العثور على نتائج مطابقة لـ &quot;{searchQuery}&quot;.
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
