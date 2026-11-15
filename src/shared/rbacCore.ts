import type {
  CapabilityMap,
  DataScope,
  GranularCapability,
  ModulePermissions,
  OperationalSettings,
  PermissionAction,
  PermissionMatrix,
  PermissionModule,
  PlatformCatalogEntry,
  RoleTemplate,
  UserProfile,
  UserRole,
} from '../types/fleet.js';

export const BOOTSTRAPPED_OWNER_EMAIL_LOWER = 'abdalrahmanmohamed0567@gmail.com';

export const PERMISSION_MODULES: Array<{ key: PermissionModule; labelAr: string; labelEn: string }> = [
  { key: 'executive', labelAr: 'الإدارة العليا والملخص التنفيذي', labelEn: 'Executive Control' },
  { key: 'hr', labelAr: 'الموارد البشرية والمندوبون', labelEn: 'HR Management' },
  { key: 'documents', labelAr: 'المستندات والخزينة الخاصة', labelEn: 'Private Documents' },
  { key: 'applications', labelAr: 'التطبيقات وحسابات المنصات', labelEn: 'Applications' },
  { key: 'fleet', labelAr: 'الأسطول والمركبات والصيانة', labelEn: 'Fleet & Vehicles' },
  { key: 'operations', labelAr: 'العمليات والأداء والملاحظات', labelEn: 'Operations' },
  { key: 'reports', labelAr: 'التقارير والتحليلات والتصدير', labelEn: 'Reports & Exports' },
  { key: 'alerts', labelAr: 'التنبيهات ومتابعة الانتهاء', labelEn: 'Alerts' },
  { key: 'users', labelAr: 'إدارة المستخدمين', labelEn: 'Users' },
  { key: 'roles', labelAr: 'الأدوار ومصفوفة الصلاحيات', labelEn: 'Roles & RBAC' },
  { key: 'settings', labelAr: 'إعدادات النظام والأهداف', labelEn: 'System Settings' },
  { key: 'platforms', labelAr: 'إدارة المنصات والخصائص', labelEn: 'Platform Flags' },
  { key: 'audit', labelAr: 'سجل النشاط والتدقيق', labelEn: 'Audit Logs' },
  { key: 'builder', labelAr: 'مركز التحكم ومنشئ النظام', labelEn: 'System Builder' },
  { key: 'branding', labelAr: 'الهوية البصرية وشاشة الدخول', labelEn: 'Visual Branding' },
  { key: 'company', labelAr: 'بيانات الشركة والاعتماد', labelEn: 'Company Profile' },
  { key: 'system_health', labelAr: 'صحة النظام والتشخيص', labelEn: 'System Health' },
  { key: 'trash', labelAr: 'سلة المحذوفات والاسترجاع', labelEn: 'Trash & Recovery' },
];

export const PERMISSION_ACTIONS: Array<{ key: PermissionAction; labelAr: string }> = [
  { key: 'view', labelAr: 'عرض' },
  { key: 'add', labelAr: 'إضافة' },
  { key: 'edit', labelAr: 'تعديل' },
  { key: 'delete', labelAr: 'حذف' },
  { key: 'export', labelAr: 'تصدير' },
  { key: 'approve', labelAr: 'اعتماد' },
];

export const GRANULAR_CAPABILITIES: Array<{ key: GranularCapability; labelAr: string; descriptionAr: string }> = [
  { key: 'print', labelAr: 'الطباعة والتصدير PDF', descriptionAr: 'طباعة التقارير المخصصة وتوليد PDF بهوية الشركة' },
  { key: 'archive', labelAr: 'الأرشفة والحذف الآمن', descriptionAr: 'أرشفة السجلات والحقول إلى سلة المحذوفات' },
  { key: 'restore', labelAr: 'الاسترجاع من السلة', descriptionAr: 'استعادة العناصر المحذوفة وإعادة نشر إصدارات سابقة' },
  { key: 'manage_settings', labelAr: 'إدارة الإعدادات العامة', descriptionAr: 'تعديل الأهداف التشغيلية والنسخ الاحتياطي وقواعد التنبيهات' },
  { key: 'create_fields', labelAr: 'إنشاء الحقول الديناميكية', descriptionAr: 'إضافة حقول جديدة للنماذج والوحدات' },
  { key: 'edit_fields', labelAr: 'تعديل الحقول وترتيبها', descriptionAr: 'تغيير أسماء وأنواع وإلزامية وصلاحيات الحقول' },
  { key: 'manage_forms', labelAr: 'إدارة ونشر النماذج', descriptionAr: 'تصميم النماذج ونشر الإصدارات والرجوع لإصدار سابق' },
  { key: 'manage_sections', labelAr: 'إدارة الأقسام والصفحات', descriptionAr: 'إضافة أو إخفاء أو تعديل الأقسام والصفحات المخصصة' },
  { key: 'change_branding', labelAr: 'تعديل الهوية البصرية', descriptionAr: 'تغيير الألوان والشعار واسم النظام ونمط الدخول' },
  { key: 'manage_company', labelAr: 'إدارة بيانات الشركة', descriptionAr: 'تعديل السجل التجاري والرقم الضريبي وبيانات التواصل' },
];

export function createEmptyCapabilities(): CapabilityMap {
  return {
    print: false,
    archive: false,
    restore: false,
    manage_settings: false,
    create_fields: false,
    edit_fields: false,
    manage_forms: false,
    manage_sections: false,
    change_branding: false,
    manage_company: false,
  };
}

export function createFullCapabilities(): CapabilityMap {
  return {
    print: true,
    archive: true,
    restore: true,
    manage_settings: true,
    create_fields: true,
    edit_fields: true,
    manage_forms: true,
    manage_sections: true,
    change_branding: true,
    manage_company: true,
  };
}

export function makeModulePerm(partial: Partial<ModulePermissions> = {}): ModulePermissions {
  return {
    view: Boolean(partial.view),
    add: Boolean(partial.add),
    edit: Boolean(partial.edit),
    delete: Boolean(partial.delete),
    export: Boolean(partial.export),
    approve: Boolean(partial.approve),
  };
}

export function createEmptyPermissionMatrix(): PermissionMatrix {
  return {
    executive: makeModulePerm(),
    hr: makeModulePerm(),
    documents: makeModulePerm(),
    applications: makeModulePerm(),
    fleet: makeModulePerm(),
    operations: makeModulePerm(),
    reports: makeModulePerm(),
    alerts: makeModulePerm(),
    users: makeModulePerm(),
    roles: makeModulePerm(),
    settings: makeModulePerm(),
    platforms: makeModulePerm(),
    audit: makeModulePerm(),
    builder: makeModulePerm(),
    branding: makeModulePerm(),
    company: makeModulePerm(),
    system_health: makeModulePerm(),
    trash: makeModulePerm(),
  };
}

export function createFullPermissionMatrix(): PermissionMatrix {
  const full = makeModulePerm({ view: true, add: true, edit: true, delete: true, export: true, approve: true });
  return {
    executive: { ...full },
    hr: { ...full },
    documents: { ...full },
    applications: { ...full },
    fleet: { ...full },
    operations: { ...full },
    reports: { ...full },
    alerts: { ...full },
    users: { ...full },
    roles: { ...full },
    settings: { ...full },
    platforms: { ...full },
    audit: { ...full },
    builder: { ...full },
    branding: { ...full },
    company: { ...full },
    system_health: { ...full },
    trash: { ...full },
  };
}

const ALL_VIEW_EXPORT = makeModulePerm({ view: true, export: true });
const CRUD_EXPORT = makeModulePerm({ view: true, add: true, edit: true, export: true });
const FULL_MODULE = makeModulePerm({ view: true, add: true, edit: true, delete: true, export: true, approve: true });

export const DEFAULT_ROLE_TEMPLATES: Omit<RoleTemplate, 'createdByUid' | 'allowedUids'>[] = [
  {
    roleId: 'super_admin',
    nameAr: 'مدير النظام الأعلى (Super Admin)',
    nameEn: 'Super Admin',
    description: 'صلاحيات كاملة على جميع أقسام ERP، مركز التحكم والتخصيص، المستندات، الأسطول، المنصات، الصلاحيات، والتدقيق.',
    isSystemPreset: true,
    permissions: createFullPermissionMatrix(),
    capabilities: createFullCapabilities(),
  },
  {
    roleId: 'operations_manager',
    nameAr: 'مدير العمليات (Operations Manager)',
    nameEn: 'Operations Manager',
    description: 'إدارة العمليات اليومية، استيراد تقارير المنصات المفعّلة، ربط الحسابات، متابعة الحالات والأسطول.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      executive: ALL_VIEW_EXPORT,
      hr: makeModulePerm({ view: true, add: true, edit: true, export: true }),
      documents: makeModulePerm({ view: true, add: true, edit: true, export: true }),
      applications: FULL_MODULE,
      fleet: makeModulePerm({ view: true, add: true, edit: true, export: true, approve: true }),
      operations: FULL_MODULE,
      reports: makeModulePerm({ view: true, export: true, approve: true }),
      alerts: makeModulePerm({ view: true, edit: true, approve: true, export: true }),
      settings: makeModulePerm({ view: true, edit: true }),
      audit: ALL_VIEW_EXPORT,
    },
    capabilities: { ...createEmptyCapabilities(), print: true, archive: true },
  },
  {
    roleId: 'hr_manager',
    nameAr: 'مدير الموارد البشرية (HR Manager)',
    nameEn: 'HR Manager',
    description: 'إدارة كاملة لملفات المندوبين، الإقامات، الرخص، المستندات الخاصة، والحالات الوظيفية.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      executive: ALL_VIEW_EXPORT,
      hr: FULL_MODULE,
      documents: FULL_MODULE,
      applications: makeModulePerm({ view: true, export: true }),
      fleet: makeModulePerm({ view: true }),
      operations: makeModulePerm({ view: true, add: true, edit: true }),
      reports: makeModulePerm({ view: true, export: true }),
      alerts: makeModulePerm({ view: true, edit: true, approve: true }),
      audit: makeModulePerm({ view: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true, archive: true },
  },
  {
    roleId: 'hr_employee',
    nameAr: 'موظف موارد بشرية (HR Employee)',
    nameEn: 'HR Employee',
    description: 'إضافة وتعديل ملفات المندوبين ورفع الوثائق دون حذف أو اعتماد نهائي.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      hr: makeModulePerm({ view: true, add: true, edit: true, export: true }),
      documents: makeModulePerm({ view: true, add: true, edit: true, export: true }),
      alerts: makeModulePerm({ view: true }),
      reports: makeModulePerm({ view: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true },
  },
  {
    roleId: 'fleet_manager',
    nameAr: 'مدير الأسطول (Fleet Manager)',
    nameEn: 'Fleet Manager',
    description: 'إدارة كاملة للسيارات، التسليم والاستلام، الصيانة، التأمين والاستمارة، والوثائق.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      executive: ALL_VIEW_EXPORT,
      hr: makeModulePerm({ view: true }),
      documents: CRUD_EXPORT,
      fleet: FULL_MODULE,
      operations: makeModulePerm({ view: true, add: true, edit: true }),
      reports: makeModulePerm({ view: true, export: true }),
      alerts: makeModulePerm({ view: true, edit: true, approve: true }),
      audit: makeModulePerm({ view: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true, archive: true },
  },
  {
    roleId: 'fleet_employee',
    nameAr: 'موظف أسطول (Fleet Employee)',
    nameEn: 'Fleet Employee',
    description: 'تسجيل عمليات التسليم والاستلام والصيانة وتحديث وثائق المركبات.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      fleet: CRUD_EXPORT,
      documents: makeModulePerm({ view: true, add: true, edit: true }),
      alerts: makeModulePerm({ view: true }),
      reports: makeModulePerm({ view: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true },
  },
  {
    roleId: 'platform_supervisor',
    nameAr: 'مشرف تطبيقات وميدان (Platform Supervisor)',
    nameEn: 'Platform Supervisor',
    description: 'متابعة المندوبين والأداء اليومي وحالات التشغيل ضمن نطاق الفرع والمنصة المحددة.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      hr: makeModulePerm({ view: true }),
      applications: makeModulePerm({ view: true, add: true, edit: true }),
      fleet: makeModulePerm({ view: true }),
      operations: CRUD_EXPORT,
      alerts: makeModulePerm({ view: true, edit: true }),
      reports: makeModulePerm({ view: true, export: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true },
  },
  {
    roleId: 'accountant',
    nameAr: 'المحاسبة والمالية (Accountant / Finance)',
    nameEn: 'Accountant / Finance',
    description: 'عرض وتصدير تقارير المحافظ والمسافات وتكاليف الصيانة وتقارير المنصات والاعتماد المالي.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      executive: ALL_VIEW_EXPORT,
      hr: makeModulePerm({ view: true }),
      applications: makeModulePerm({ view: true, export: true }),
      fleet: makeModulePerm({ view: true, export: true }),
      operations: makeModulePerm({ view: true, export: true }),
      reports: makeModulePerm({ view: true, export: true, approve: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true },
  },
  {
    roleId: 'reports_viewer',
    nameAr: 'مطلع تقارير (Reports Viewer)',
    nameEn: 'Reports Viewer',
    description: 'قراءة وعرض اللوحات والتقارير فقط دون صلاحية تعديل أو حذف.',
    isSystemPreset: true,
    permissions: {
      ...createEmptyPermissionMatrix(),
      executive: makeModulePerm({ view: true }),
      hr: makeModulePerm({ view: true }),
      applications: makeModulePerm({ view: true }),
      fleet: makeModulePerm({ view: true }),
      operations: makeModulePerm({ view: true }),
      reports: makeModulePerm({ view: true }),
      alerts: makeModulePerm({ view: true }),
    },
    capabilities: { ...createEmptyCapabilities(), print: true },
  },
];

export function mapLegacyRoleToTemplateId(role: UserRole | string | undefined): string {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'super_admin';
    case 'operations_manager':
      return 'operations_manager';
    case 'hr_manager':
      return 'hr_manager';
    case 'hr_employee':
      return 'hr_employee';
    case 'fleet_manager':
      return 'fleet_manager';
    case 'fleet_employee':
      return 'fleet_employee';
    case 'supervisor':
      return 'platform_supervisor';
    case 'accountant':
      return 'accountant';
    case 'viewer':
    default:
      return 'reports_viewer';
  }
}

export function isSystemOwnerUser(user: Pick<UserProfile, 'email' | 'role'> | null | undefined): boolean {
  if (!user) return false;
  if ((user.email || '').trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER) return true;
  return user.role === 'owner';
}

export function isSuperAdminUser(user: Pick<UserProfile, 'email' | 'role' | 'customRoleId'> | null | undefined): boolean {
  if (!user) return false;
  if ((user.email || '').trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER) return true;
  return user.role === 'owner' || user.role === 'admin' || user.customRoleId === 'super_admin';
}

export function resolveEffectivePermissions(
  user: Pick<UserProfile, 'email' | 'role' | 'customRoleId' | 'permissionOverrides' | 'active'> | null | undefined,
  roleTemplates: RoleTemplate[] = []
): PermissionMatrix {
  if (!user || !user.active) return createEmptyPermissionMatrix();
  if (isSuperAdminUser(user)) return createFullPermissionMatrix();

  const targetRoleId = user.customRoleId || mapLegacyRoleToTemplateId(user.role);
  const defaultTemplate =
    DEFAULT_ROLE_TEMPLATES.find((r) => r.roleId === targetRoleId) ||
    DEFAULT_ROLE_TEMPLATES.find((r) => r.roleId === 'reports_viewer')!;
  const template = roleTemplates.find((r) => r.roleId === targetRoleId) || defaultTemplate;

  const matrix = createEmptyPermissionMatrix();
  for (const mod of PERMISSION_MODULES) {
    const base =
      template.permissions?.[mod.key] ||
      defaultTemplate.permissions?.[mod.key] ||
      makeModulePerm();
    const override = user.permissionOverrides?.[mod.key];
    matrix[mod.key] = {
      view: override?.view !== undefined ? Boolean(override.view) : Boolean(base.view),
      add: override?.add !== undefined ? Boolean(override.add) : Boolean(base.add),
      edit: override?.edit !== undefined ? Boolean(override.edit) : Boolean(base.edit),
      delete: override?.delete !== undefined ? Boolean(override.delete) : Boolean(base.delete),
      export: override?.export !== undefined ? Boolean(override.export) : Boolean(base.export),
      approve: override?.approve !== undefined ? Boolean(override.approve) : Boolean(base.approve),
    };
  }
  return matrix;
}

export function resolveEffectiveCapabilities(
  user: Pick<UserProfile, 'email' | 'role' | 'customRoleId' | 'capabilityOverrides' | 'active'> | null | undefined,
  roleTemplates: RoleTemplate[] = []
): CapabilityMap {
  if (!user || !user.active) return createEmptyCapabilities();
  if (isSuperAdminUser(user)) return createFullCapabilities();

  const targetRoleId = user.customRoleId || mapLegacyRoleToTemplateId(user.role);
  const defaultTemplate = DEFAULT_ROLE_TEMPLATES.find((r) => r.roleId === targetRoleId);
  const template = roleTemplates.find((r) => r.roleId === targetRoleId);
  const caps = createEmptyCapabilities();

  for (const cap of GRANULAR_CAPABILITIES) {
    const overrideVal = user.capabilityOverrides?.[cap.key];
    if (overrideVal !== undefined) {
      caps[cap.key] = Boolean(overrideVal);
    } else if (template?.capabilities && template.capabilities[cap.key] !== undefined) {
      caps[cap.key] = Boolean(template.capabilities[cap.key]);
    } else if (defaultTemplate?.capabilities && defaultTemplate.capabilities[cap.key] !== undefined) {
      caps[cap.key] = Boolean(defaultTemplate.capabilities[cap.key]);
    }
  }
  return caps;
}

export function hasPermission(
  user: Pick<UserProfile, 'email' | 'role' | 'customRoleId' | 'permissionOverrides' | 'active'> | null | undefined,
  roleTemplates: RoleTemplate[],
  module: PermissionModule,
  action: PermissionAction
): boolean {
  const matrix = resolveEffectivePermissions(user, roleTemplates);
  return Boolean(matrix[module]?.[action]);
}

export function hasCapability(
  user: Pick<UserProfile, 'email' | 'role' | 'customRoleId' | 'capabilityOverrides' | 'active'> | null | undefined,
  roleTemplates: RoleTemplate[],
  capability: GranularCapability
): boolean {
  const caps = resolveEffectiveCapabilities(user, roleTemplates);
  return Boolean(caps[capability]);
}

export function resolveDataScope(
  user: Pick<UserProfile, 'email' | 'role' | 'customRoleId' | 'assignedBranch' | 'assignedCity' | 'allowedPlatforms' | 'dataScope'> | null | undefined
): DataScope {
  if (!user || isSuperAdminUser(user)) {
    return { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] };
  }
  const ds = user.dataScope;
  const branches = Array.isArray(ds?.branches) ? ds.branches.filter(Boolean) : [];
  if (user.assignedBranch && !branches.includes(user.assignedBranch) && ds?.allBranches === false) {
    branches.push(user.assignedBranch);
  }
  const cities = Array.isArray(ds?.cities) ? ds.cities.filter(Boolean) : [];
  if (user.assignedCity && !cities.includes(user.assignedCity)) {
    cities.push(user.assignedCity);
  }
  const platforms = Array.isArray(ds?.platforms) && ds.platforms.length > 0
    ? ds.platforms.filter(Boolean)
    : Array.isArray(user.allowedPlatforms)
      ? user.allowedPlatforms
      : [];
  const riderIds = Array.isArray(ds?.riderIds) ? ds.riderIds.filter(Boolean) : [];
  return {
    allBranches: ds?.allBranches !== undefined ? Boolean(ds.allBranches) : branches.length === 0 && !user.assignedBranch,
    branches,
    cities,
    platforms,
    riderIds,
  };
}

export function matchesDataScope(
  item: { branch?: string; city?: string; platform?: string; platformId?: string; riderId?: string; internalRiderId?: string },
  scope: DataScope
): boolean {
  if (!scope.allBranches && scope.branches.length > 0 && item.branch) {
    if (!scope.branches.includes(item.branch)) return false;
  }
  if (!scope.allBranches && scope.branches.length > 0 && !item.branch && scope.cities.length === 0) {
    // Allow records without branch unless explicitly restricted by riderIds
  }
  if (scope.cities.length > 0 && item.city && !scope.cities.includes(item.city)) {
    return false;
  }
  const p = item.platform || item.platformId;
  if (scope.platforms.length > 0 && p && !scope.platforms.includes(p)) {
    return false;
  }
  const rid = item.internalRiderId || item.riderId;
  if (scope.riderIds.length > 0 && rid && !scope.riderIds.includes(rid)) {
    return false;
  }
  return true;
}

export const DEFAULT_PLATFORM_CATALOG: Omit<PlatformCatalogEntry, 'createdByUid' | 'allowedUids'>[] = [
  {
    platformId: 'hungerstation',
    name: 'HungerStation',
    nameAr: 'هنقرستيشن',
    enabled: true,
    hiddenFromUi: false,
    operationalImportEnabled: true,
    supportsExcelImport: true,
    isBuiltIn: true,
    description: 'منصة التوصيل الرئيسية المفعّلة مع تقارير Hunger-Daily والمسافات والمحافظ والجودة والأخطاء.',
  },
  {
    platformId: 'keeta',
    name: 'Keeta',
    nameAr: 'كيتا',
    enabled: false,
    hiddenFromUi: true,
    operationalImportEnabled: false,
    supportsExcelImport: true,
    isBuiltIn: true,
    description: 'مخفية مؤقتًا بأمر الإدارة مع الاحتفاظ الكامل بالبيانات التاريخية ومنطق التحليل لإعادة التفعيل.',
  },
  {
    platformId: 'jahez',
    name: 'Jahez',
    nameAr: 'جاهز',
    enabled: true,
    hiddenFromUi: false,
    operationalImportEnabled: false,
    supportsExcelImport: false,
    isBuiltIn: true,
    description: 'حسابات ومعرّفات مناديب جاهز المرتبطة بملفات الشركة.',
  },
  {
    platformId: 'ninja',
    name: 'Ninja',
    nameAr: 'نينجا',
    enabled: false,
    hiddenFromUi: false,
    operationalImportEnabled: false,
    supportsExcelImport: false,
    isBuiltIn: true,
    description: 'منصة نينجا (قابلة للتفعيل من إدارة المنصات).',
  },
  {
    platformId: 'marsool',
    name: 'Marsool',
    nameAr: 'مرسول',
    enabled: false,
    hiddenFromUi: false,
    operationalImportEnabled: false,
    supportsExcelImport: false,
    isBuiltIn: true,
    description: 'منصة مرسول (قابلة للتفعيل من إدارة المنصات).',
  },
  {
    platformId: 'chefz',
    name: 'The Chefz',
    nameAr: 'ذا شفز',
    enabled: false,
    hiddenFromUi: false,
    operationalImportEnabled: false,
    supportsExcelImport: false,
    isBuiltIn: true,
    description: 'منصة ذا شفز (قابلة للتفعيل من إدارة المنصات).',
  },
  {
    platformId: 'amazon_logistics',
    name: 'Amazon Logistics',
    nameAr: 'أمازون لوجستكس',
    enabled: false,
    hiddenFromUi: false,
    operationalImportEnabled: false,
    supportsExcelImport: false,
    isBuiltIn: true,
    description: 'عمليات التوصيل عبر أمازون لوجستكس.',
  },
];

export function isKeetaActive(
  settings?: Pick<OperationalSettings, 'keetaEnabled' | 'keetaHidden'> | null,
  catalog?: PlatformCatalogEntry[]
): boolean {
  const catEntry = catalog?.find((p) => p.platformId === 'keeta');
  if (catEntry) {
    return Boolean(catEntry.enabled && !catEntry.hiddenFromUi);
  }
  return Boolean(settings?.keetaEnabled === true && settings?.keetaHidden !== true);
}

export function getMergedPlatformCatalog(
  catalog: PlatformCatalogEntry[] = [],
  settings?: Pick<OperationalSettings, 'keetaEnabled' | 'keetaHidden'> | null
): PlatformCatalogEntry[] {
  const byId = new Map<string, PlatformCatalogEntry>();
  for (const def of DEFAULT_PLATFORM_CATALOG) {
    const isKt = def.platformId === 'keeta';
    byId.set(def.platformId, {
      ...def,
      enabled: isKt ? Boolean(settings?.keetaEnabled === true) : def.enabled,
      hiddenFromUi: isKt ? settings?.keetaHidden !== false : def.hiddenFromUi,
      operationalImportEnabled: isKt ? Boolean(settings?.keetaEnabled === true) : def.operationalImportEnabled,
      createdByUid: '',
      allowedUids: [],
    });
  }
  for (const entry of catalog) {
    byId.set(entry.platformId, entry);
  }
  return Array.from(byId.values());
}

export function getDefaultErpNavForUser(
  user: UserProfile | null | undefined,
  roleTemplates: RoleTemplate[]
): string {
  if (!user) return 'executive_admin';
  const perms = resolveEffectivePermissions(user, roleTemplates);
  const roleKey = user.customRoleId || mapLegacyRoleToTemplateId(user.role);

  if (roleKey === 'super_admin' || isSuperAdminUser(user)) return 'executive_admin';
  if ((roleKey === 'hr_manager' || roleKey === 'hr_employee') && perms.hr.view) return 'hr_dashboard';
  if ((roleKey === 'fleet_manager' || roleKey === 'fleet_employee') && perms.fleet.view) return 'fleet_dashboard';
  if (roleKey === 'operations_manager' && perms.executive.view) return 'executive_admin';
  if (roleKey === 'platform_supervisor' && perms.applications.view) return 'hungerstation';
  if ((roleKey === 'accountant' || roleKey === 'reports_viewer') && perms.reports.view) return 'reports';

  if (perms.executive.view) return 'executive_admin';
  if (perms.hr.view) return 'hr_dashboard';
  if (perms.fleet.view) return 'fleet_dashboard';
  if (perms.applications.view) return 'apps_active';
  if (perms.operations.view) return 'operations';
  if (perms.reports.view) return 'reports';
  if (perms.alerts.view) return 'alerts';
  return 'executive_admin';
}
