import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  DatabaseBackup,
  FileCheck2,
  FileSearch,
  FileSpreadsheet,
  FolderLock,
  Globe,
  Home,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  Menu,
  Moon,
  RefreshCw,
  ScanFace,
  Search,
  Settings,
  Sliders,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Truck,
  Upload,
  User,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_COMPANY_BRANDING, DEFAULT_SYSTEM_SECTIONS } from '../lib/dynamicSchemaEngine';
import { computeAllDocumentExpiries } from '../lib/erpHelpers';
import { computeErrorCodeIntelligence, generateErrorIntelligenceAlerts } from '../lib/errorIntelligence';
import { generateOperationalAlerts, type FleetDataset } from '../lib/fleetAnalytics';
import { hasCapability, hasPermission, isKeetaActive, mapLegacyRoleToTemplateId } from '../shared/rbacCore';
import type {
  CompanyBrandingDoc,
  ErrorCodeDictionaryEntry,
  FilterState,
  NotificationRuleConfig,
  OperationalCase,
  OperationalSettings,
  PermissionAction,
  PermissionModule,
  Platform,
  PlatformAccount,
  PlatformCatalogEntry,
  PrivateDocumentRecord,
  RiderErrorCase,
  RoleTemplate,
  SystemPageConfig,
  SystemSectionConfig,
  UserProfile,
  UserRole,
  VehicleMaster,
  WorkspaceMode,
} from '../types/fleet';

export type NavKey =
  // الرئيسية
  | 'executive_admin'
  | 'overview'
  | 'alerts'
  // الموارد البشرية HR
  | 'hr_dashboard'
  | 'hr_riders'
  | 'hr_docs'
  | 'hr_expiries'
  | 'hr_status'
  // التطبيقات والمنصات
  | 'apps_active'
  | 'apps_accounts'
  | 'apps_linking'
  | 'hungerstation'
  | 'error_intel'
  | 'keeta'
  // الأسطول والمركبات
  | 'fleet_dashboard'
  | 'fleet_vehicles'
  | 'fleet_assignments'
  | 'fleet_approvals'
  | 'fleet_handover'
  | 'fleet_docs'
  | 'fleet_maintenance'
  | 'fleet_reports'
  | 'fleet_settings'
  // العمليات
  | 'operations'
  | 'riders'
  | 'daily_ops'
  | 'rider_perf'
  | 'attendance'
  | 'distance_wallet'
  | 'quality'
  | 'facial'
  | 'import'
  // التقارير والتحليلات
  | 'reports'
  // إدارة النظام والتخصيص
  | 'settings'
  | 'company_branding'
  | 'about_credits'
  | 'system_builder'
  | 'system_backup_reset'
  | 'rbac_users'
  | 'rbac_roles'
  | 'rbac_audit'
  | `custom_page_${string}`;

export interface NavItemDef {
  key: NavKey;
  label: string;
  group: string;
  sectionId?: string;
  icon: typeof LayoutDashboard;
  module?: PermissionModule;
  action?: PermissionAction;
}

export function getNavItemsForWorkspace(
  workspaceMode: Exclude<WorkspaceMode, 'selector'>,
  options?: {
    userProfile?: UserProfile | null;
    roleTemplates?: RoleTemplate[];
    settings?: OperationalSettings | null;
    platformCatalog?: PlatformCatalogEntry[];
    allowedPlatforms?: Platform[];
    systemSections?: SystemSectionConfig[];
    systemPages?: SystemPageConfig[];
  }
): NavItemDef[] {
  const user = options?.userProfile;
  const templates = options?.roleTemplates || [];
  const keetaActive = isKeetaActive(options?.settings, options?.platformCatalog);
  const allowedPlats = options?.allowedPlatforms || ['hungerstation'];
  const allowHs = allowedPlats.includes('hungerstation');
  const allowKt = keetaActive && allowedPlats.includes('keeta');

  const can = (mod?: PermissionModule, act: PermissionAction = 'view') => {
    if (!mod || !user) return true;
    return hasPermission(user, templates, mod, act);
  };

  if (workspaceMode === 'hungerstation') {
    const raw: NavItemDef[] = [
      { key: 'hungerstation', label: 'لوحة تحكم HungerStation', group: 'القيادة والتحكم', icon: Truck, module: 'operations' },
      { key: 'operations', label: 'التحكم والحالات', group: 'القيادة والتحكم', icon: SlidersHorizontal, module: 'operations' },
      { key: 'alerts', label: 'تنبيهات HungerStation', group: 'القيادة والتحكم', icon: Bell, module: 'alerts' },
      { key: 'error_intel', label: 'مركز أكواد الأخطاء', group: 'التشغيل والتحليلات', icon: AlertTriangle, module: 'operations' },
      { key: 'riders', label: 'مندوبو هنقر و360°', group: 'التشغيل والتحليلات', icon: Users, module: 'operations' },
      { key: 'daily_ops', label: 'العمليات اليومية', group: 'التشغيل والتحليلات', icon: Clock, module: 'operations' },
      { key: 'rider_perf', label: 'أداء المندوبين', group: 'التشغيل والتحليلات', icon: BarChart3, module: 'operations' },
      { key: 'attendance', label: 'الحضور والالتزام', group: 'التشغيل والتحليلات', icon: CalendarCheck, module: 'operations' },
      { key: 'distance_wallet', label: 'المسافات والمحافظ', group: 'التشغيل والتحليلات', icon: MapPin, module: 'operations' },
      { key: 'quality', label: 'جودة التسليم الشهرية', group: 'التشغيل والتحليلات', icon: Award, module: 'operations' },
      { key: 'reports', label: 'تقارير HungerStation', group: 'البيانات والتقارير', icon: FileSpreadsheet, module: 'reports' },
      { key: 'import', label: 'مركز استيراد هنقر', group: 'البيانات والتقارير', icon: Upload, module: 'operations', action: 'add' },
    ];
    return raw.filter((item) => can(item.module, item.action || 'view'));
  }

  if (workspaceMode === 'keeta' && keetaActive) {
    const raw: NavItemDef[] = [
      { key: 'keeta', label: 'لوحة تحكم Keeta', group: 'القيادة والتحكم', icon: Activity, module: 'operations' },
      { key: 'operations', label: 'التحكم والحالات', group: 'القيادة والتحكم', icon: SlidersHorizontal, module: 'operations' },
      { key: 'alerts', label: 'تنبيهات Keeta', group: 'القيادة والتحكم', icon: Bell, module: 'alerts' },
      { key: 'riders', label: 'مندوبو كيتا و360°', group: 'التشغيل والتحليلات', icon: Users, module: 'operations' },
      { key: 'daily_ops', label: 'العمليات اليومية', group: 'التشغيل والتحليلات', icon: Clock, module: 'operations' },
      { key: 'rider_perf', label: 'أداء المندوبين', group: 'التشغيل والتحليلات', icon: BarChart3, module: 'operations' },
      { key: 'attendance', label: 'VDA والشفتات', group: 'التشغيل والتحليلات', icon: CalendarCheck, module: 'operations' },
      { key: 'distance_wallet', label: 'مسافات VDA', group: 'التشغيل والتحليلات', icon: MapPin, module: 'operations' },
      { key: 'quality', label: 'RankPlanProcess والمكافآت', group: 'التشغيل والتحليلات', icon: Award, module: 'operations' },
      { key: 'facial', label: 'التحقق من الهوية', group: 'التشغيل والتحليلات', icon: ScanFace, module: 'operations' },
      { key: 'reports', label: 'تقارير Keeta', group: 'البيانات والتقارير', icon: FileSpreadsheet, module: 'reports' },
      { key: 'import', label: 'مركز استيراد كيتا', group: 'البيانات والتقارير', icon: Upload, module: 'operations', action: 'add' },
    ];
    return raw.filter((item) => can(item.module, item.action || 'view'));
  }

  // Global ERP Mode — supports SystemSections customization & Custom SystemPages
  const sectionMap = new Map<string, SystemSectionConfig>();
  for (const def of DEFAULT_SYSTEM_SECTIONS) {
    sectionMap.set(def.sectionId, { ...def, createdByUid: '', allowedUids: [] });
  }
  for (const customSec of options?.systemSections || []) {
    if (!customSec.archived) {
      sectionMap.set(customSec.sectionId, customSec);
    } else {
      sectionMap.delete(customSec.sectionId);
    }
  }

  const userRoleId = user ? user.customRoleId || mapLegacyRoleToTemplateId(user.role) : 'super_admin';
  const isOwnerOrSuper = !user || user.role === 'owner' || userRoleId === 'super_admin';

  const isSectionAllowed = (sec?: SystemSectionConfig) => {
    if (!sec) return true;
    if (sec.visible === false && sec.sectionId !== 'builder') return false;
    if (sec.allowedRoles && sec.allowedRoles.length > 0 && !isOwnerOrSuper) {
      if (!sec.allowedRoles.includes(userRoleId) && !sec.allowedRoles.includes(user?.role || '')) {
        return false;
      }
    }
    return true;
  };

  const titleFor = (sectionId: string, fallback: string) => sectionMap.get(sectionId)?.titleAr || fallback;

  const canSeeBranding =
    can('branding', 'view') ||
    can('company', 'view') ||
    (user ? hasCapability(user, templates, 'change_branding') || hasCapability(user, templates, 'manage_company') : true);

  const canSeeBuilder =
    can('builder', 'view') ||
    (user
      ? hasCapability(user, templates, 'manage_forms') ||
        hasCapability(user, templates, 'create_fields') ||
        hasCapability(user, templates, 'manage_sections')
      : true);

  const builtInItems: NavItemDef[] = [
    // 1. الإدارة العليا
    { key: 'executive_admin', label: 'الإدارة والتحكم التنفيذي', sectionId: 'executive', group: titleFor('executive', 'الإدارة العليا'), icon: LayoutDashboard, module: 'executive' },
    {
      key: 'overview',
      label: keetaActive ? 'الملخص التنفيذي ومقارنة المنصتين' : 'الملخص التنفيذي للعمليات',
      sectionId: 'executive',
      group: titleFor('executive', 'الإدارة العليا'),
      icon: Globe,
      module: 'executive',
    },
    { key: 'alerts', label: 'التنبيهات وانتهاء الوثائق', sectionId: 'executive', group: titleFor('executive', 'الإدارة العليا'), icon: Bell, module: 'alerts' },

    // 2. الموارد البشرية
    { key: 'hr_dashboard', label: 'لوحة الموارد البشرية', sectionId: 'hr', group: titleFor('hr', 'الموارد البشرية'), icon: Users, module: 'hr' },
    { key: 'hr_riders', label: 'ملفات المندوبين', sectionId: 'hr', group: titleFor('hr', 'الموارد البشرية'), icon: UserCheck, module: 'hr' },
    { key: 'hr_docs', label: 'خزينة المستندات الخاصة', sectionId: 'hr', group: titleFor('hr', 'الموارد البشرية'), icon: FolderLock, module: 'documents' },
    { key: 'hr_expiries', label: 'متابعة انتهاء الإقامات والرخص', sectionId: 'hr', group: titleFor('hr', 'الموارد البشرية'), icon: FileCheck2, module: 'hr' },
    { key: 'hr_status', label: 'حالات المندوبين وسجل الحركة', sectionId: 'hr', group: titleFor('hr', 'الموارد البشرية'), icon: Activity, module: 'hr' },

    // 3. التطبيقات والمنصات
    { key: 'apps_active', label: 'المنصات المفعلة والحسابات', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: Smartphone, module: 'applications' },
    { key: 'apps_accounts', label: 'حسابات المناديب بالتطبيقات', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: Users, module: 'applications' },
    { key: 'apps_linking', label: 'محرك الربط وتعارض المعرفات', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: Link2, module: 'applications' },
    ...(allowHs
      ? [
          { key: 'hungerstation' as NavKey, label: 'عمليات HungerStation', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: Truck, module: 'operations' as PermissionModule },
          { key: 'error_intel' as NavKey, label: 'مركز أكواد الأخطاء (HS)', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: AlertTriangle, module: 'operations' as PermissionModule },
        ]
      : []),
    ...(allowKt
      ? [{ key: 'keeta' as NavKey, label: 'عمليات Keeta', sectionId: 'applications', group: titleFor('applications', 'التطبيقات والمنصات'), icon: Activity, module: 'operations' as PermissionModule }]
      : []),

    // 4. الأسطول
    { key: 'fleet_dashboard', label: 'لوحة تحكم الأسطول', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: Car, module: 'fleet' },
    { key: 'fleet_vehicles', label: 'سجل المركبات والسيارات', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: Truck, module: 'fleet' },
    { key: 'fleet_assignments', label: 'الربط والتفويضات', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: Link2, module: 'fleet' },
    { key: 'fleet_approvals', label: 'مركز اعتمادات الأسطول', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: FileCheck2, module: 'fleet' },
    { key: 'fleet_handover', label: 'عهدة التسليم والاستلام', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: ArrowLeftRight, module: 'fleet' },
    { key: 'fleet_docs', label: 'وثائق المركبات والانتهاء', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: FolderLock, module: 'fleet' },
    { key: 'fleet_maintenance', label: 'سجل الصيانة والأضرار', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: Wrench, module: 'fleet' },
    { key: 'fleet_reports', label: 'تقارير الأسطول والطباعة', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: FileSpreadsheet, module: 'fleet' },
    { key: 'fleet_settings', label: 'إعدادات وسياسات الأسطول', sectionId: 'fleet', group: titleFor('fleet', 'إدارة الأسطول'), icon: SlidersHorizontal, module: 'fleet' },

    // 5. العمليات والتقارير
    { key: 'operations', label: 'التحكم والحالات التشغيلية', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: SlidersHorizontal, module: 'operations' },
    { key: 'riders', label: 'ملفات المناديب 360° والربط', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: Users, module: 'operations' },
    { key: 'daily_ops', label: 'العمليات اليومية', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: Clock, module: 'operations' },
    { key: 'rider_perf', label: 'تقييم أداء المندوبين', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: BarChart3, module: 'operations' },
    { key: 'attendance', label: 'الحضور والالتزام', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: CalendarCheck, module: 'operations' },
    { key: 'distance_wallet', label: 'المسافات والمحافظ', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: MapPin, module: 'operations' },
    { key: 'quality', label: 'جودة التسليم الشهرية', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: Award, module: 'operations' },
    ...(allowKt
      ? [{ key: 'facial' as NavKey, label: 'التحقق من الهوية (Keeta)', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: ScanFace, module: 'operations' as PermissionModule }]
      : []),
    { key: 'import', label: 'مركز استيراد Excel', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: Upload, module: 'operations', action: 'add' },
    { key: 'reports', label: 'مركز التقارير الشاملة والتصدير', sectionId: 'operations', group: titleFor('operations', 'العمليات والتقارير'), icon: FileSpreadsheet, module: 'reports' },

    // 6. الصلاحيات والإدارة
    { key: 'settings', label: 'إعدادات النظام والمنصات', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: Settings, module: 'settings' },
    ...(canSeeBranding
      ? [{ key: 'company_branding' as NavKey, label: 'بيانات الشركة والهوية البصرية', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: Building2 }]
      : []),
    { key: 'rbac_users', label: 'المستخدمون ونطاق البيانات', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: Users, module: 'users' },
    { key: 'rbac_roles', label: 'مصفوفة الصلاحيات والأدوار', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: KeyRound, module: 'roles' },
    { key: 'rbac_audit', label: 'سجل النشاط والتدقيق المركزي', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: FileSearch, module: 'audit' },
    { key: 'about_credits', label: 'حول النظام والاعتمادات', sectionId: 'admin', group: titleFor('admin', 'الصلاحيات والإدارة'), icon: Info },

    // 7. مركز التحكم والتخصيص
    ...(canSeeBuilder
      ? [{ key: 'system_builder' as NavKey, label: 'مركز التحكم والتخصيص', sectionId: 'builder', group: titleFor('builder', 'مركز التحكم والتخصيص'), icon: Sliders }]
      : []),
    ...(canSeeBuilder || can('settings', 'edit') || user?.role === 'owner' || user?.role === 'admin'
      ? [
          {
            key: 'system_backup_reset' as NavKey,
            label: 'النسخ الاحتياطي وإعادة ضبط النظام',
            sectionId: 'builder',
            group: titleFor('builder', 'مركز التحكم والتخصيص'),
            icon: DatabaseBackup,
          },
        ]
      : []),
  ];

  // Dynamic Custom Pages created via System Builder
  const customPageItems: NavItemDef[] = (options?.systemPages || [])
    .filter((p) => p.visible && !p.archived)
    .filter((p) => {
      if (!p.allowedRoles || p.allowedRoles.length === 0 || isOwnerOrSuper) return true;
      return p.allowedRoles.includes(userRoleId) || p.allowedRoles.includes(user?.role || '');
    })
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((page) => {
      const targetSec = sectionMap.get(page.sectionId);
      return {
        key: `custom_page_${page.pageId}` as NavKey,
        label: page.titleAr,
        sectionId: page.sectionId,
        group: targetSec?.titleAr || 'صفحات مخصصة',
        icon: Layers,
      };
    });

  const combined = [...builtInItems, ...customPageItems].filter((item) => {
    if (item.sectionId && !isSectionAllowed(sectionMap.get(item.sectionId))) return false;
    return can(item.module, item.action || 'view');
  });

  // Sort items by their section's configured order while preserving relative order inside each section
  const orderOfSection = (secId?: string) => (secId ? sectionMap.get(secId)?.order ?? 99 : 99);
  return combined.sort((a, b) => orderOfSection(a.sectionId) - orderOfSection(b.sectionId));
}

const ROLE_PERMISSION_NOTES: Record<UserRole, string> = {
  owner: 'صلاحيات المالك الكاملة: إدارة النظام، الموارد البشرية، الأسطول، المنصات، المستندات الخاصة، والصلاحيات.',
  admin: 'مدير النظام الأعلى: صلاحيات كاملة على جميع أنظمة ERP، الوثائق الخاصة، المنصات، والمستخدمين.',
  operations_manager: 'مدير العمليات: إدارة التشغيل، حسابات التطبيقات، استيراد التقارير، الأسطول، ومتابعة الحالات.',
  hr_manager: 'مدير الموارد البشرية: إدارة كاملة لملفات المندوبين، الوثائق الخاصة، الانتهاءات، والحالات الوظيفية.',
  hr_employee: 'موظف موارد بشرية: إضافة وتعديل ملفات المندوبين ورفع الوثائق ومتابعة الانتهاءات.',
  fleet_manager: 'مدير الأسطول: إدارة المركبات، التسليم والاستلام، الصيانة، والتأمين والاستمارة.',
  fleet_employee: 'موظف أسطول: تسجيل عمليات التسليم والاستلام والصيانة وتحديث وثائق المركبات.',
  supervisor: 'مشرف تطبيقات وميدان: متابعة المندوبين والأداء اليومي والحالات ضمن نطاق الفرع والمنصة.',
  accountant: 'المحاسبة والمالية: عرض وتصدير تقارير المحافظ والمسافات وتكاليف الصيانة والاعتماد المالي.',
  viewer: 'مطلع تقارير: عرض اللوحات والتقارير المصرح بها فقط بدون تعديل أو حذف.',
};

const WORKSPACE_META: Record<
  Exclude<WorkspaceMode, 'selector'>,
  {
    title: string;
    subtitle: string;
    accentBadgeCls: string;
    accentIconCls: string;
    icon: typeof Truck;
  }
> = {
  hungerstation: {
    title: 'HungerStation Operations',
    subtitle: 'مساحة عمل هنقرستيشن',
    accentBadgeCls:
      'border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    accentIconCls: 'text-amber-400',
    icon: Truck,
  },
  keeta: {
    title: 'Keeta Operations',
    subtitle: 'مساحة عمل كيتا',
    accentBadgeCls:
      'border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200',
    accentIconCls: 'text-blue-400',
    icon: Activity,
  },
  global: {
    title: 'نظام الإدارة المتكامل ERP',
    subtitle: 'Fleet Operations Center',
    accentBadgeCls:
      'border-blue-200/80 dark:border-blue-800/70 bg-blue-50/80 dark:bg-blue-950/40 text-[#0f1e36] dark:text-blue-200',
    accentIconCls: 'text-blue-400',
    icon: Globe,
  },
};

interface EnterpriseShellProps {
  workspaceMode: Exclude<WorkspaceMode, 'selector'>;
  allowedPlatforms: Platform[];
  canAccessGlobal: boolean;
  onSwitchWorkspace: (mode: WorkspaceMode) => void;
  activeNav: NavKey;
  onSelectNav: (nav: NavKey) => void;
  selectedRider: { platform: Platform; riderId: string } | null;
  onSelectRider: (platform: Platform, riderId: string) => void;
  userProfile: UserProfile;
  roleTemplates?: RoleTemplate[];
  platformCatalog?: PlatformCatalogEntry[];
  vehicles?: VehicleMaster[];
  platformAccounts?: PlatformAccount[];
  privateDocs?: PrivateDocumentRecord[];
  companyBranding?: CompanyBrandingDoc;
  systemSections?: SystemSectionConfig[];
  systemPages?: SystemPageConfig[];
  notificationRules?: NotificationRuleConfig[];
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
  workspaceMode,
  allowedPlatforms,
  canAccessGlobal,
  onSwitchWorkspace,
  activeNav,
  onSelectNav,
  selectedRider,
  onSelectRider,
  userProfile,
  roleTemplates = [],
  platformCatalog = [],
  vehicles = [],
  platformAccounts = [],
  privateDocs = [],
  companyBranding,
  systemSections = [],
  systemPages = [],
  notificationRules = [],
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('foc_sidebar_groups');
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const keetaActive = isKeetaActive(settings, platformCatalog);

  const navItems = useMemo(
    () =>
      getNavItemsForWorkspace(workspaceMode, {
        userProfile,
        roleTemplates,
        settings,
        platformCatalog,
        allowedPlatforms,
        systemSections,
        systemPages,
      }),
    [workspaceMode, userProfile, roleTemplates, settings, platformCatalog, allowedPlatforms, systemSections, systemPages]
  );

  const groups = useMemo(() => Array.from(new Set(navItems.map((n) => n.group))), [navItems]);
  const wsMeta = WORKSPACE_META[workspaceMode];
  const WsIcon = wsMeta.icon;

  const assignedRoleTemplate = useMemo(() => {
    const tid = userProfile.customRoleId || mapLegacyRoleToTemplateId(userProfile.role);
    return roleTemplates.find((t) => t.roleId === tid);
  }, [userProfile, roleTemplates]);

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

  const toggleGroupCollapsed = (grp: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [grp]: !prev[grp] };
      try {
        localStorage.setItem('foc_sidebar_groups', JSON.stringify(next));
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
        setSwitcherOpen(false);
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
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (switcherRef.current && !switcherRef.current.contains(target)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const notifications = useMemo(() => {
    const opsAlerts = generateOperationalAlerts(dataset, settings, filters);
    const errAlerts =
      workspaceMode === 'keeta'
        ? []
        : generateErrorIntelligenceAlerts(
            computeErrorCodeIntelligence(dataset, dictionaryEntries, riderErrorCases, filters),
            settings
          );
    const todayStr = new Date().toISOString().slice(0, 10);

    const canSeeExpiries =
      hasPermission(userProfile, roleTemplates, 'alerts', 'view') ||
      hasPermission(userProfile, roleTemplates, 'hr', 'view') ||
      hasPermission(userProfile, roleTemplates, 'fleet', 'view');

    const activeExpiryRule = notificationRules.find(
      (r) =>
        r.enabled &&
        (r.eventType === 'iqama_expiry' ||
          r.eventType === 'license_expiry' ||
          r.eventType === 'vehicle_expiry' ||
          r.eventType === 'expiry_threshold')
    );
    const maxExpiryThresholdDays = activeExpiryRule?.thresholdDaysOrValue ?? 30;

    const expiryNotifs = canSeeExpiries
      ? computeAllDocumentExpiries({
          riders: dataset.riderMaster,
          vehicles,
          privateDocs,
          settings,
        })
          .filter((e) => e.daysRemaining <= maxExpiryThresholdDays)
          .slice(0, 10)
          .map((e) => ({
            id: `exp_${e.id}`,
            kind: 'expiry' as const,
            severity: (e.daysRemaining <= 7 ? 'critical' : 'warning') as 'critical' | 'warning',
            title: `${e.docCategory}: ${e.entityName}`,
            subtitle:
              e.daysRemaining < 0
                ? `منتهي منذ ${Math.abs(e.daysRemaining)} يوم (${e.expiryDate})`
                : e.daysRemaining === 0
                  ? `ينتهي اليوم (${e.expiryDate})`
                  : `متبقي ${e.daysRemaining} يوم (${e.expiryDate})`,
            onClick: () => {
              onSelectNav(e.domain === 'fleet' ? 'fleet_docs' : 'hr_expiries');
              setNotifOpen(false);
            },
          }))
      : [];

    const overdueCaseItems = operationalCases
      .filter((c) => c.status !== 'closed' && c.status !== 'resolved' && c.dueDate && c.dueDate < todayStr)
      .filter((c) => keetaActive || c.platform !== 'keeta')
      .slice(0, 6)
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

    const alertItems = [...errAlerts, ...opsAlerts]
      .filter((a) => keetaActive || a.platform !== 'keeta')
      .slice(0, 10)
      .map((a) => ({
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

    return [...expiryNotifs, ...overdueCaseItems, ...alertItems];
  }, [
    workspaceMode,
    dataset,
    dictionaryEntries,
    riderErrorCases,
    operationalCases,
    vehicles,
    privateDocs,
    notificationRules,
    settings,
    filters,
    userProfile,
    roleTemplates,
    keetaActive,
    onSelectNav,
    onSelectRider,
  ]);

  const criticalNotifCount = notifications.filter((n) => n.severity === 'critical').length;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        pages: navItems.slice(0, 6),
        riders: [] as Array<{ platform: Platform; riderId: string; label: string; sub: string }>,
        vehiclesList: [] as VehicleMaster[],
        accounts: [] as PlatformAccount[],
        cases: [] as OperationalCase[],
        codes: [] as ErrorCodeDictionaryEntry[],
      };
    }

    const pages = navItems
      .filter((n) => n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q))
      .slice(0, 6);

    const riderMap = new Map<string, { platform: Platform; riderId: string; label: string; sub: string }>();
    if (workspaceMode === 'global') {
      for (const m of dataset.riderMaster) {
        if (`${m.internalRiderId} ${m.fullName} ${m.iqamaNumber || ''} ${m.phone || ''} ${m.city || ''} ${m.branch || ''}`.toLowerCase().includes(q)) {
          const acc = platformAccounts.find(
            (a) => a.companyRiderId === m.internalRiderId && (keetaActive || a.platformId.toLowerCase() !== 'keeta')
          );
          const mapping = dataset.riderMappings.find(
            (mp) => mp.internalRiderId === m.internalRiderId && (keetaActive || mp.platform !== 'keeta')
          );
          const targetPlatform: Platform =
            acc && (acc.platformId === 'hungerstation' || acc.platformId === 'keeta')
              ? (acc.platformId as Platform)
              : mapping
                ? mapping.platform
                : 'hungerstation';
          const targetId = acc ? acc.platformRiderId : mapping ? mapping.platformRiderId : m.internalRiderId;
          riderMap.set(`${targetPlatform}:${targetId}`, {
            platform: targetPlatform,
            riderId: targetId,
            label: `${m.fullName} (${m.internalRiderId})`,
            sub: `${m.city || '-'} · ${m.branch || '-'}`,
          });
        }
      }
    }
    if (workspaceMode !== 'keeta') {
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
    }
    if (keetaActive && workspaceMode !== 'hungerstation') {
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
    }

    const vehiclesList =
      hasPermission(userProfile, roleTemplates, 'fleet', 'view')
        ? vehicles
            .filter((v) =>
              `${v.plateNumber} ${v.vehicleInternalId} ${v.make} ${v.model} ${v.currentRiderId || ''}`
                .toLowerCase()
                .includes(q)
            )
            .slice(0, 5)
        : [];

    const accounts =
      hasPermission(userProfile, roleTemplates, 'applications', 'view')
        ? platformAccounts
            .filter((a) => keetaActive || a.platformId.toLowerCase() !== 'keeta')
            .filter((a) =>
              `${a.platformRiderId} ${a.platformName} ${a.companyRiderId}`
                .toLowerCase()
                .includes(q)
            )
            .slice(0, 5)
        : [];

    const cases = operationalCases
      .filter((c) => keetaActive || c.platform !== 'keeta')
      .filter((c) => `${c.title} ${c.riderId} ${c.riderName} ${c.caseId}`.toLowerCase().includes(q))
      .slice(0, 5);

    const codes =
      workspaceMode !== 'keeta'
        ? dictionaryEntries
            .filter((d) => `${d.normalizedCode} ${d.arabicDescription} ${d.category || ''}`.toLowerCase().includes(q))
            .slice(0, 5)
        : [];

    return {
      pages,
      riders: Array.from(riderMap.values()).slice(0, 8),
      vehiclesList,
      accounts,
      cases,
      codes,
    };
  }, [
    searchQuery,
    navItems,
    workspaceMode,
    dataset,
    vehicles,
    platformAccounts,
    operationalCases,
    dictionaryEntries,
    userProfile,
    roleTemplates,
    keetaActive,
  ]);

  const currentNavMeta = navItems.find((i) => i.key === activeNav) || navItems[0] || {
    key: activeNav,
    label: 'Fleet Operations Center',
    group: 'الرئيسية',
    icon: LayoutDashboard,
  };

  const firstItemInCurrentGroup = navItems.find((i) => i.group === currentNavMeta.group);

  const brandVisual = companyBranding?.branding || DEFAULT_COMPANY_BRANDING.branding;
  const brandCompany = companyBranding?.company || DEFAULT_COMPANY_BRANDING.company;
  const sidebarLogoKey =
    !logoError && (theme === 'dark' ? brandVisual.alternateLogoKey || brandVisual.primaryLogoKey : brandVisual.primaryLogoKey);

  useEffect(() => {
    setLogoError(false);
  }, [brandVisual.primaryLogoKey, brandVisual.alternateLogoKey, theme]);

  const shellBrandVars = {
    '--foc-primary': brandVisual.primaryColor || '#0f1e36',
    '--foc-secondary': brandVisual.secondaryColor || '#2563eb',
    '--foc-button': brandVisual.buttonColor || '#1d4ed8',
  } as CSSProperties;

  const sidebarTitle = workspaceMode === 'global' ? brandVisual.systemNameAr || wsMeta.title : wsMeta.title;
  const sidebarSubtitle = workspaceMode === 'global' ? brandCompany.companyNameAr || wsMeta.subtitle : wsMeta.subtitle;

  const renderSidebarContent = (collapsed: boolean, onItemClick?: () => void) => (
    <>
      <div className={`flex h-16 items-center border-b border-[#1e2f4d] ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        <div className="flex items-center gap-3 min-w-0">
          {sidebarLogoKey ? (
            <img
              src={`/api/branding/logo/${encodeURIComponent(sidebarLogoKey)}`}
              alt={sidebarTitle}
              onError={() => setLogoError(true)}
              className="h-9 w-9 shrink-0 rounded-lg bg-white/95 object-contain p-0.5 border border-[#24385c]"
            />
          ) : (
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#13223a] border border-[#24385c] ${wsMeta.accentIconCls}`}>
              <WsIcon className="h-4 w-4" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-white">{sidebarTitle}</div>
              <div className="truncate text-[11px] text-slate-400">{sidebarSubtitle}</div>
            </div>
          )}
        </div>
        {!onItemClick && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
            className="hidden lg:inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-[#13223a] hover:text-white transition-colors"
          >
            {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Quick Workspace Home Switch */}
      {(canAccessGlobal || (keetaActive && allowedPlatforms.length > 1)) && (
        <div className="border-b border-[#1b2842] px-2.5 py-2.5">
          <button
            type="button"
            title={workspaceMode === 'global' ? 'محدد المنصات' : 'العودة لنظام ERP المتكامل'}
            onClick={() => {
              onSwitchWorkspace(workspaceMode === 'global' ? 'selector' : canAccessGlobal ? 'global' : 'selector');
              onItemClick?.();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg border border-[#1e2f4d] bg-[#070f1d] px-2.5 py-2 text-xs font-medium text-slate-300 hover:border-blue-500/50 hover:text-white transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <Home className="h-4 w-4 shrink-0 text-blue-400" />
            {!collapsed && (
              <span className="truncate">
                {workspaceMode === 'global' ? 'شاشة المنصات المختصرة' : 'نظام الإدارة المتكامل ERP'}
              </span>
            )}
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto erp-scroll px-2.5 py-3 space-y-4">
        {groups.map((grp) => {
          const items = navItems.filter((i) => i.group === grp);
          const isGroupCollapsed = Boolean(collapsedGroups[grp]);
          return (
            <div key={grp} className="space-y-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(grp)}
                  className="flex w-full items-center justify-between px-2.5 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <span className="truncate">{grp}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
                      isGroupCollapsed ? 'rotate-90' : ''
                    }`}
                  />
                </button>
              )}
              {(!isGroupCollapsed || collapsed) &&
                items.map((item) => {
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
                      className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        collapsed ? 'justify-center' : ''
                      } ${
                        active
                          ? 'bg-[#152846] text-white font-semibold'
                          : 'text-slate-300/85 hover:bg-[#13223a]/80 hover:text-white'
                      }`}
                    >
                      {active && !collapsed && (
                        <span
                          aria-hidden="true"
                          className="absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l bg-blue-500"
                        />
                      )}
                      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-400'}`} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#1e2f4d] p-3 space-y-2.5">
        {!collapsed && (
          <div className="min-w-0 px-1">
            <div className="truncate text-xs font-semibold text-white">{userProfile.displayName}</div>
            <div className="truncate text-[11px] text-slate-400">
              {assignedRoleTemplate?.nameAr || userProfile.role}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title="تسجيل الخروج"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#24385c] bg-[#13223a] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-[#1a2f50] transition-colors whitespace-nowrap"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>تسجيل الخروج</span>}
        </button>
      </div>
    </>
  );

  return (
    <div style={shellBrandVars} className="min-h-screen bg-slate-50 dark:bg-[#060b16] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Collapsible Right-Side RTL Navy Sidebar */}
      <aside
        style={theme === 'light' && brandVisual.sidebarColor ? { backgroundColor: brandVisual.sidebarColor } : undefined}
        className={`no-print hidden lg:flex lg:shrink-0 lg:flex-col sticky top-0 h-screen bg-[#0b1628] dark:bg-[#070d19] text-slate-200 border-l border-[#1e2f4d] transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[264px]'
        }`}
      >
        {renderSidebarContent(sidebarCollapsed)}
      </aside>

      {/* Mobile RTL Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-[1px]" onClick={() => setMobileMenuOpen(false)} />
          <div
            style={theme === 'light' && brandVisual.sidebarColor ? { backgroundColor: brandVisual.sidebarColor } : undefined}
            className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-[#0b1628] text-slate-200 border-l border-[#1e2f4d]"
          >
            <div className="flex h-12 items-center justify-end border-b border-[#1e2f4d] px-4">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
                aria-label="إغلاق القائمة"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderSidebarContent(false, () => setMobileMenuOpen(false))}
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Enterprise Top Header */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 lg:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 lg:hidden shrink-0"
              aria-label="فتح القائمة"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="relative shrink-0" ref={switcherRef}>
              <button
                type="button"
                onClick={() => setSwitcherOpen((o) => !o)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${wsMeta.accentBadgeCls}`}
              >
                <WsIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{wsMeta.title}</span>
                <span className="sm:hidden">
                  {workspaceMode === 'hungerstation' ? 'HS' : workspaceMode === 'keeta' ? 'Keeta' : 'ERP'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-75" />
              </button>

              {switcherOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl z-50 text-xs space-y-1">
                  <div className="px-2.5 py-1 text-[11px] font-bold text-slate-400">تبديل مساحة العمل</div>
                  {canAccessGlobal && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchWorkspace('global');
                        setSwitcherOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right font-semibold transition-colors ${
                        workspaceMode === 'global'
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        <span>نظام الإدارة المتكامل ERP</span>
                      </span>
                      {workspaceMode === 'global' && <span className="text-[10px]">نشط</span>}
                    </button>
                  )}
                  {allowedPlatforms.includes('hungerstation') && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchWorkspace('hungerstation');
                        setSwitcherOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right font-semibold transition-colors ${
                        workspaceMode === 'hungerstation'
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Truck className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span>HungerStation Operations</span>
                      </span>
                      {workspaceMode === 'hungerstation' && <span className="text-[10px]">نشط</span>}
                    </button>
                  )}
                  {keetaActive && allowedPlatforms.includes('keeta') && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchWorkspace('keeta');
                        setSwitcherOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right font-semibold transition-colors ${
                        workspaceMode === 'keeta'
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Keeta Operations</span>
                      </span>
                      {workspaceMode === 'keeta' && <span className="text-[10px]">نشط</span>}
                    </button>
                  )}
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchWorkspace('selector');
                        setSwitcherOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Home className="h-3.5 w-3.5" />
                      <span>شاشة اختيار المنصة الرئيسية</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive RTL Breadcrumbs */}
            <nav aria-label="Breadcrumb" className="min-w-0">
              <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    if (firstItemInCurrentGroup) onSelectNav(firstItemInCurrentGroup.key);
                  }}
                  className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors truncate"
                >
                  {currentNavMeta.group}
                </button>
                <ChevronLeft className="h-3 w-3 shrink-0 opacity-60" />
                <span className="text-slate-700 dark:text-slate-300 font-medium truncate">
                  {currentNavMeta.label}
                </span>
                {activeNav === 'riders' && selectedRider && (
                  <>
                    <ChevronLeft className="h-3 w-3 shrink-0 opacity-60" />
                    <span className="font-mono-num font-semibold text-blue-700 dark:text-blue-400">
                      {selectedRider.riderId}
                    </span>
                  </>
                )}
              </div>
              <div className="truncate text-sm sm:text-[15px] font-bold text-slate-900 dark:text-slate-100">
                {currentNavMeta.label}
              </div>
            </nav>
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden xl:flex items-center justify-between gap-4 w-72 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">بحث شامل (مندوب، لوحة مركبة، حساب، صفحة...)</span>
            </span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono-num shrink-0">
              Ctrl+K
            </kbd>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="xl:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              aria-label="بحث"
            >
              <Search className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                title="التنبيهات وانتهاء الوثائق"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
                      إشعارات {wsMeta.title} ({notifications.length})
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
                  <div className="max-h-80 overflow-y-auto erp-scroll divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        لا توجد تنبيهات أو وثائق منتهية أو حالات متأخرة حاليًا.
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
                              {n.kind === 'expiry' ? 'انتهاء وثيقة' : n.kind === 'case' ? 'حالة متأخرة' : n.severity === 'critical' ? 'حرج' : 'تحذير'}
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
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${dataLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">تحديث</span>
            </button>

            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0f1e36] dark:bg-blue-600 text-white shrink-0">
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
                    <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
                      {userProfile.phone || userProfile.email}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">الدور الوظيفي:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {assignedRoleTemplate?.nameAr || userProfile.role}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">نطاق الفروع:</span>
                      <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                        {userProfile.dataScope?.allBranches !== false
                          ? 'جميع الفروع'
                          : userProfile.dataScope?.branches?.join(' · ') || userProfile.assignedBranch || 'مقيد'}
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {assignedRoleTemplate?.description || ROLE_PERMISSION_NOTES[userProfile.role]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1600px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* Unified Quick Search Modal */}
      {searchOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 backdrop-blur-[1px] pt-16 p-4"
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
                placeholder={`ابحث في ${wsMeta.title} (اسم، إقامة، لوحة مركبة، حساب تطبيق، صفحة...)`}
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto erp-scroll p-3 space-y-4 text-xs">
              {searchResults.pages.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">الصفحات والوحدات</div>
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

              {searchResults.vehiclesList.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">المركبات والأسطول</div>
                  <div className="space-y-1">
                    {searchResults.vehiclesList.map((v) => (
                      <button
                        key={v.vehicleInternalId}
                        type="button"
                        onClick={() => {
                          onSelectNav('fleet_vehicles');
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {v.plateNumber} · {v.make} {v.model} ({v.vehicleInternalId})
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {v.currentRiderId ? `عهدة: ${v.currentRiderId}` : v.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.accounts.length > 0 && (
                <div>
                  <div className="px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">حسابات التطبيقات</div>
                  <div className="space-y-1">
                    {searchResults.accounts.map((a) => (
                      <button
                        key={a.accountId}
                        type="button"
                        onClick={() => {
                          onSelectNav('apps_accounts');
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                          {a.platformName}: {a.platformRiderId}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{a.companyRiderId}</span>
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
                searchResults.vehiclesList.length === 0 &&
                searchResults.accounts.length === 0 &&
                searchResults.codes.length === 0 &&
                searchResults.cases.length === 0 && (
                  <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                    لم يتم العثور على نتائج مطابقة لـ &quot;{searchQuery}&quot; داخل هذه المساحة.
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
