import type {
  CompanyBrandingDoc,
  DynamicFieldDefinition,
  DynamicFieldType,
  DynamicFormDefinition,
  DynamicFormFieldPlacement,
  DynamicFormSection,
  DynamicModuleBinding,
  SystemSectionConfig,
  UserProfile,
} from '../types/fleet';
import { isSuperAdminUser, mapLegacyRoleToTemplateId } from '../shared/rbacCore';

export const DYNAMIC_FIELD_TYPE_META: Array<{
  type: DynamicFieldType;
  labelAr: string;
  labelEn: string;
  group: 'text' | 'numeric' | 'date' | 'choice' | 'file' | 'logic';
}> = [
  { type: 'short_text', labelAr: 'نص قصير', labelEn: 'Short Text', group: 'text' },
  { type: 'long_text', labelAr: 'نص طويل', labelEn: 'Long Text', group: 'text' },
  { type: 'number', labelAr: 'رقم', labelEn: 'Number', group: 'numeric' },
  { type: 'currency', labelAr: 'عملة (ر.س)', labelEn: 'Currency (SAR)', group: 'numeric' },
  { type: 'percentage', labelAr: 'نسبة مئوية (%)', labelEn: 'Percentage', group: 'numeric' },
  { type: 'date', labelAr: 'تاريخ', labelEn: 'Date', group: 'date' },
  { type: 'datetime', labelAr: 'تاريخ ووقت', labelEn: 'Date & Time', group: 'date' },
  { type: 'phone', labelAr: 'رقم جوال / هاتف', labelEn: 'Phone', group: 'text' },
  { type: 'email', labelAr: 'بريد إلكتروني', labelEn: 'Email', group: 'text' },
  { type: 'url', labelAr: 'رابط إلكتروني', labelEn: 'URL', group: 'text' },
  { type: 'dropdown', labelAr: 'قائمة منسدلة', labelEn: 'Dropdown', group: 'choice' },
  { type: 'multiselect', labelAr: 'اختيار متعدد', labelEn: 'Multi-Select', group: 'choice' },
  { type: 'checkbox', labelAr: 'خانة تأكيد (Checkbox)', labelEn: 'Checkbox', group: 'choice' },
  { type: 'boolean', labelAr: 'نعم / لا (Boolean)', labelEn: 'Yes / No', group: 'choice' },
  { type: 'image', labelAr: 'صورة (رفع آمن)', labelEn: 'Image Upload', group: 'file' },
  { type: 'pdf', labelAr: 'ملف PDF (رفع آمن)', labelEn: 'PDF Upload', group: 'file' },
  { type: 'file', labelAr: 'مرفق ملف عام', labelEn: 'File Upload', group: 'file' },
  { type: 'formula', labelAr: 'حقل محسوب (معادلة)', labelEn: 'Computed Formula', group: 'logic' },
];

export interface BuiltInFormCatalogEntry {
  formId: string;
  nameAr: string;
  nameEn: string;
  module: DynamicModuleBinding;
  targetEntity: string;
  description: string;
  coreFields: Array<{
    key: string;
    labelAr: string;
    labelEn: string;
    type: DynamicFieldType;
    required: boolean;
    editable: boolean;
  }>;
}

export const BUILT_IN_FORMS_CATALOG: BuiltInFormCatalogEntry[] = [
  {
    formId: 'hr_rider',
    nameAr: 'بيانات المندوب (الموارد البشرية)',
    nameEn: 'Rider Master Form',
    module: 'hr',
    targetEntity: 'riderMaster',
    description: 'نموذج ملف المندوب الأساسي والإقامة والرخصة والتعيين',
    coreFields: [
      { key: 'internalRiderId', labelAr: 'المعرف الداخلي للمندوب', labelEn: 'Internal Rider ID', type: 'short_text', required: true, editable: false },
      { key: 'fullName', labelAr: 'الاسم الكامل', labelEn: 'Full Name', type: 'short_text', required: true, editable: true },
      { key: 'phone', labelAr: 'رقم الجوال', labelEn: 'Phone', type: 'phone', required: false, editable: true },
      { key: 'iqamaNumber', labelAr: 'رقم الإقامة / الهوية', labelEn: 'Iqama Number', type: 'short_text', required: false, editable: true },
      { key: 'iqamaExpiryDate', labelAr: 'تاريخ انتهاء الإقامة', labelEn: 'Iqama Expiry Date', type: 'date', required: false, editable: true },
      { key: 'driverLicenseNumber', labelAr: 'رقم رخصة القيادة', labelEn: 'Driver License', type: 'short_text', required: false, editable: true },
      { key: 'driverLicenseExpiryDate', labelAr: 'انتهاء رخصة القيادة', labelEn: 'License Expiry', type: 'date', required: false, editable: true },
      { key: 'branch', labelAr: 'الفرع', labelEn: 'Branch', type: 'dropdown', required: false, editable: true },
      { key: 'city', labelAr: 'المدينة', labelEn: 'City', type: 'short_text', required: false, editable: true },
      { key: 'status', labelAr: 'الحالة الوظيفية', labelEn: 'HR Status', type: 'dropdown', required: true, editable: true },
    ],
  },
  {
    formId: 'fleet_vehicle',
    nameAr: 'بيانات المركبة (إدارة الأسطول)',
    nameEn: 'Vehicle Master Form',
    module: 'fleet',
    targetEntity: 'vehicleMaster',
    description: 'نموذج تسجيل وتعديل المركبات والاستمارة والتأمين والفحص',
    coreFields: [
      { key: 'vehicleInternalId', labelAr: 'المعرف الداخلي للمركبة', labelEn: 'Vehicle Internal ID', type: 'short_text', required: true, editable: false },
      { key: 'plateNumber', labelAr: 'رقم اللوحة', labelEn: 'Plate Number', type: 'short_text', required: true, editable: true },
      { key: 'vehicleType', labelAr: 'نوع المركبة', labelEn: 'Vehicle Type', type: 'dropdown', required: true, editable: true },
      { key: 'make', labelAr: 'الشركة المصنعة', labelEn: 'Make', type: 'short_text', required: true, editable: true },
      { key: 'model', labelAr: 'الموديل', labelEn: 'Model', type: 'short_text', required: true, editable: true },
      { key: 'year', labelAr: 'سنة الصنع', labelEn: 'Year', type: 'number', required: false, editable: true },
      { key: 'istimaraExpiryDate', labelAr: 'انتهاء الاستمارة', labelEn: 'Istimara Expiry', type: 'date', required: false, editable: true },
      { key: 'insuranceExpiryDate', labelAr: 'انتهاء التأمين', labelEn: 'Insurance Expiry', type: 'date', required: false, editable: true },
      { key: 'status', labelAr: 'حالة المركبة', labelEn: 'Vehicle Status', type: 'dropdown', required: true, editable: true },
    ],
  },
  {
    formId: 'fleet_handover',
    nameAr: 'تسليم واستلام العهدة (المركبات)',
    nameEn: 'Vehicle Handover Form',
    module: 'fleet',
    targetEntity: 'vehicleAssignments',
    description: 'حقول إضافية مرفقة بنموذج تسليم المركبة للمندوب',
    coreFields: [
      { key: 'vehicleInternalId', labelAr: 'المركبة', labelEn: 'Vehicle ID', type: 'dropdown', required: true, editable: false },
      { key: 'companyRiderId', labelAr: 'المندوب المستلم', labelEn: 'Rider ID', type: 'dropdown', required: true, editable: false },
      { key: 'handoverDate', labelAr: 'تاريخ التسليم', labelEn: 'Handover Date', type: 'date', required: true, editable: true },
      { key: 'handoverOdometer', labelAr: 'قراءة العداد عند التسليم', labelEn: 'Handover Odometer', type: 'number', required: false, editable: true },
      { key: 'handoverCondition', labelAr: 'حالة المركبة', labelEn: 'Condition', type: 'short_text', required: true, editable: true },
    ],
  },
  {
    formId: 'fleet_maintenance',
    nameAr: 'صيانة المركبة (الأسطول)',
    nameEn: 'Vehicle Maintenance Form',
    module: 'fleet',
    targetEntity: 'vehicleMaintenance',
    description: 'حقول إضافية لتسجيل أوامر الصيانة وتكاليفها',
    coreFields: [
      { key: 'vehicleInternalId', labelAr: 'المركبة', labelEn: 'Vehicle ID', type: 'dropdown', required: true, editable: false },
      { key: 'maintenanceType', labelAr: 'نوع الصيانة', labelEn: 'Maintenance Type', type: 'short_text', required: true, editable: true },
      { key: 'maintenanceDate', labelAr: 'تاريخ الصيانة', labelEn: 'Date', type: 'date', required: true, editable: true },
      { key: 'cost', labelAr: 'التكلفة (ر.س)', labelEn: 'Cost', type: 'currency', required: false, editable: true },
      { key: 'odometer', labelAr: 'قراءة العداد', labelEn: 'Odometer', type: 'number', required: false, editable: true },
    ],
  },
  {
    formId: 'ops_case',
    nameAr: 'الحالة التشغيلية (العمليات)',
    nameEn: 'Operational Case Form',
    module: 'operations',
    targetEntity: 'operationalCases',
    description: 'تذاكر وحالات العمليات الميدانية للمندوبين',
    coreFields: [
      { key: 'caseId', labelAr: 'معرف الحالة', labelEn: 'Case ID', type: 'short_text', required: true, editable: false },
      { key: 'riderId', labelAr: 'المندوب', labelEn: 'Rider ID', type: 'short_text', required: true, editable: true },
      { key: 'title', labelAr: 'عنوان الحالة', labelEn: 'Title', type: 'short_text', required: true, editable: true },
      { key: 'priority', labelAr: 'الأولوية', labelEn: 'Priority', type: 'dropdown', required: true, editable: true },
      { key: 'status', labelAr: 'الحالة', labelEn: 'Status', type: 'dropdown', required: true, editable: true },
    ],
  },
  {
    formId: 'admin_note',
    nameAr: 'ملاحظة إدارية / مهمة متابعة',
    nameEn: 'Admin Note & Task Form',
    module: 'executive',
    targetEntity: 'entityNotesTasks',
    description: 'نموذج المهام الإدارية والملاحظات المرتبطة بالكيانات',
    coreFields: [
      { key: 'noteTaskId', labelAr: 'معرف المهمة', labelEn: 'Task ID', type: 'short_text', required: true, editable: false },
      { key: 'title', labelAr: 'العنوان', labelEn: 'Title', type: 'short_text', required: true, editable: true },
      { key: 'priority', labelAr: 'الأولوية', labelEn: 'Priority', type: 'dropdown', required: true, editable: true },
      { key: 'status', labelAr: 'الحالة', labelEn: 'Status', type: 'dropdown', required: true, editable: true },
    ],
  },
  {
    formId: 'internal_request',
    nameAr: 'طلب داخلي مخصص',
    nameEn: 'Internal Request Form',
    module: 'executive',
    targetEntity: 'customEntityRecords',
    description: 'نموذج عام للطلبات الإدارية والتشغيلية الداخلية',
    coreFields: [
      { key: 'title', labelAr: 'عنوان الطلب', labelEn: 'Request Title', type: 'short_text', required: true, editable: true },
      { key: 'status', labelAr: 'حالة الطلب', labelEn: 'Status', type: 'dropdown', required: true, editable: true },
    ],
  },
];

export const DEFAULT_SYSTEM_SECTIONS: Omit<SystemSectionConfig, 'createdByUid' | 'allowedUids'>[] = [
  { sectionId: 'executive', titleAr: 'الإدارة العليا', titleEn: 'Executive', iconName: 'Shield', order: 1, visible: true, isBuiltIn: true },
  { sectionId: 'hr', titleAr: 'الموارد البشرية', titleEn: 'Human Resources', iconName: 'Users', order: 2, visible: true, isBuiltIn: true },
  { sectionId: 'applications', titleAr: 'التطبيقات والمنصات', titleEn: 'Applications', iconName: 'Smartphone', order: 3, visible: true, isBuiltIn: true },
  { sectionId: 'fleet', titleAr: 'إدارة الأسطول', titleEn: 'Fleet Management', iconName: 'Car', order: 4, visible: true, isBuiltIn: true },
  { sectionId: 'operations', titleAr: 'العمليات والتقارير', titleEn: 'Operations & Reports', iconName: 'Activity', order: 5, visible: true, isBuiltIn: true },
  { sectionId: 'admin', titleAr: 'الصلاحيات والإدارة', titleEn: 'Administration', iconName: 'Settings', order: 6, visible: true, isBuiltIn: true },
  { sectionId: 'builder', titleAr: 'مركز التحكم والتخصيص', titleEn: 'System Builder', iconName: 'Sliders', order: 7, visible: true, isBuiltIn: true },
];

export const DEFAULT_COMPANY_BRANDING: Omit<CompanyBrandingDoc, 'createdByUid' | 'allowedUids'> = {
  brandingId: 'default',
  company: {
    companyNameAr: 'شركة العمليات اللوجستية للأساطيل',
    companyNameEn: 'Fleet Logistics Operations Co.',
    shortName: 'FOC',
    vatNumber: '',
    crNumber: '',
    phone: '0559786939',
    email: '',
    address: 'المملكة العربية السعودية',
    city: 'الرياض',
    country: 'المملكة العربية السعودية',
    website: '',
    responsibleManager: '',
    officialFooterText: 'تقرير إداري وتشغيلي صادر عن نظام FLEET OPERATIONS CENTER',
  },
  branding: {
    systemNameAr: 'FLEET OPERATIONS CENTER',
    systemNameEn: 'Fleet Operations Center',
    primaryLogoKey: '',
    alternateLogoKey: '',
    iconLogoKey: '',
    primaryColor: '#0f1e36',
    secondaryColor: '#2563eb',
    buttonColor: '#1d4ed8',
    sidebarColor: '#0c1628',
    uiStyleMode: 'corporate',
    defaultThemeMode: 'light',
    loginScreenStyle: 'split',
    loginHeadlineAr: 'منصة إدارة الأساطيل والعمليات اللوجستية',
    loginSubheadlineAr: 'نظام مؤسسي موحد للموارد البشرية، إدارة الأسطول، حسابات المنصات، والتقارير التنفيذية.',
  },
  credits: {
    systemTitle: 'FLEET OPERATIONS CENTER',
    systemSummary: 'نظام متكامل لإدارة العمليات اللوجستية والموارد البشرية والأساطيل والتقارير التشغيلية.',
    developerName: 'م- عبدالرحمن محمد',
    developerPhone: '0559786939',
    version: 'v4.0 Enterprise',
    lastUpdated: new Date().toISOString().slice(0, 10),
    systemStatus: 'تشغيل مؤسسي نشط — Enterprise Production',
    copyrightText: 'جميع الحقوق محفوظة © FLEET OPERATIONS CENTER',
    changelog: [
      {
        version: 'v4.0 Enterprise',
        date: new Date().toISOString().slice(0, 10),
        notes: 'إطلاق مركز التحكم والتخصيص System Builder، منشئ الحقول والنماذج الديناميكية، هوية الشركة، البحث الشامل، والتقارير المخصصة.',
      },
      {
        version: 'v3.2 ERP Upgrade',
        date: '2026-10-01',
        notes: 'إعادة هيكلة النظام إلى 4 أنظمة مستقلة ومترابطة مع خزينة المستندات الخاصة ومصفوفة الصلاحيات.',
      },
    ],
  },
};

export function sanitizeFieldKey(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!cleaned) return `field_${Date.now().toString(36)}`;
  return /^[a-z]/.test(cleaned) ? cleaned.slice(0, 48) : `f_${cleaned.slice(0, 46)}`;
}

// Deterministic safe math formula parser & evaluator (zero eval / Function)
type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

function tokenizeFormula(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      const end = expr.indexOf('}', i + 1);
      if (end === -1) throw new Error('قوس مرجع الحقل غير مغلق');
      const ident = expr.slice(i + 1, end).trim();
      tokens.push({ kind: 'ident', value: ident });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        numStr += expr[i++];
      }
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error('رقم غير صالح');
      tokens.push({ kind: 'num', value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        ident += expr[i++];
      }
      tokens.push({ kind: 'ident', value: ident });
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`رمز غير مدعوم في المعادلة: ${ch}`);
  }
  return tokens;
}

export function evaluateFormula(expr: string | undefined, values: Record<string, unknown>): number | null {
  if (!expr || !expr.trim()) return null;
  try {
    const tokens = tokenizeFormula(expr);
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    const parseExpr = (): number => {
      let left = parseTerm();
      while (peek()?.kind === 'op' && (peek()?.value === '+' || peek()?.value === '-')) {
        const op = (consume() as { kind: 'op'; value: '+' | '-' }).value;
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };

    const parseTerm = (): number => {
      let left = parseFactor();
      while (peek()?.kind === 'op' && (peek()?.value === '*' || peek()?.value === '/')) {
        const op = (consume() as { kind: 'op'; value: '*' | '/' }).value;
        const right = parseFactor();
        left = op === '*' ? left * right : right === 0 ? 0 : left / right;
      }
      return left;
    };

    const parseFactor = (): number => {
      const tok = peek();
      if (!tok) return 0;
      if (tok.kind === 'op' && tok.value === '-') {
        consume();
        return -parseFactor();
      }
      if (tok.kind === 'op' && tok.value === '+') {
        consume();
        return parseFactor();
      }
      if (tok.kind === 'op' && tok.value === '(') {
        consume();
        const val = parseExpr();
        if (peek()?.kind === 'op' && peek()?.value === ')') consume();
        return val;
      }
      if (tok.kind === 'num') {
        consume();
        return tok.value;
      }
      if (tok.kind === 'ident') {
        consume();
        const nameUpper = tok.value.toUpperCase();
        if (peek()?.kind === 'op' && peek()?.value === '(') {
          consume();
          const args: number[] = [];
          while (peek() && !(peek()?.kind === 'op' && peek()?.value === ')')) {
            args.push(parseExpr());
            if (peek()?.kind === 'op' && peek()?.value === ',') consume();
          }
          if (peek()?.kind === 'op' && peek()?.value === ')') consume();
          if (nameUpper === 'ROUND') return Number((args[0] ?? 0).toFixed(Math.max(0, Math.min(6, Math.round(args[1] ?? 2)))));
          if (nameUpper === 'MIN') return args.length ? Math.min(...args) : 0;
          if (nameUpper === 'MAX') return args.length ? Math.max(...args) : 0;
          if (nameUpper === 'ABS') return Math.abs(args[0] ?? 0);
          return args[0] ?? 0;
        }
        const rawVal = values[tok.value];
        const num = Number(rawVal);
        return Number.isFinite(num) ? num : 0;
      }
      return 0;
    };

    const result = parseExpr();
    return Number.isFinite(result) ? Number(result.toFixed(2)) : null;
  } catch {
    return null;
  }
}

export function canViewDynamicField(field: DynamicFieldDefinition, user: UserProfile | null | undefined): boolean {
  if (!field.visible || field.archived) return false;
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  const viewRoles = field.permissions?.viewRoles;
  if (!viewRoles || viewRoles.length === 0) return true;
  const roleKey = user.customRoleId || mapLegacyRoleToTemplateId(user.role);
  return viewRoles.includes(roleKey) || viewRoles.includes(user.role);
}

export function canEditDynamicField(
  field: DynamicFieldDefinition,
  placement: DynamicFormFieldPlacement | undefined,
  user: UserProfile | null | undefined
): boolean {
  if (!field.editable || field.type === 'formula' || placement?.readonly) return false;
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  const editRoles = field.permissions?.editRoles;
  if (!editRoles || editRoles.length === 0) return true;
  const roleKey = user.customRoleId || mapLegacyRoleToTemplateId(user.role);
  return editRoles.includes(roleKey) || editRoles.includes(user.role);
}

export function validateDynamicFieldValue(
  field: DynamicFieldDefinition,
  value: unknown,
  requiredOverride?: boolean
): string | null {
  const isRequired = requiredOverride ?? field.required;
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);

  if (field.type === 'formula') return null;

  if (isRequired) {
    if (field.type === 'checkbox' || field.type === 'boolean') {
      if (value !== true && value !== false && value !== 'true' && value !== 'false') {
        return field.validation?.customErrorAr || `الحقل "${field.labelAr}" مطلوب.`;
      }
    } else if (isEmpty) {
      return field.validation?.customErrorAr || `الحقل "${field.labelAr}" مطلوب.`;
    }
  }

  if (isEmpty) return null;

  const strVal = String(value).trim();

  if (field.type === 'number' || field.type === 'currency' || field.type === 'percentage') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return field.validation?.customErrorAr || `يجب إدخال قيمة رقمية صالحة في "${field.labelAr}".`;
    }
    if (field.validation?.min !== undefined && field.validation?.min !== null && num < field.validation.min) {
      return field.validation?.customErrorAr || `الحد الأدنى لحقل "${field.labelAr}" هو ${field.validation.min}.`;
    }
    if (field.validation?.max !== undefined && field.validation?.max !== null && num > field.validation.max) {
      return field.validation?.customErrorAr || `الحد الأقصى لحقل "${field.labelAr}" هو ${field.validation.max}.`;
    }
  }

  if (field.type === 'short_text' || field.type === 'long_text' || field.type === 'phone' || field.type === 'email' || field.type === 'url') {
    if (field.validation?.minLength && strVal.length < field.validation.minLength) {
      return field.validation?.customErrorAr || `الحد الأدنى لعدد الأحرف في "${field.labelAr}" هو ${field.validation.minLength}.`;
    }
    if (field.validation?.maxLength && strVal.length > field.validation.maxLength) {
      return field.validation?.customErrorAr || `الحد الأقصى لعدد الأحرف في "${field.labelAr}" هو ${field.validation.maxLength}.`;
    }
  }

  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
    return field.validation?.customErrorAr || `صيغة البريد الإلكتروني في "${field.labelAr}" غير صحيحة.`;
  }

  if (field.type === 'phone' && !/^[+0-9\s()-]{6,20}$/.test(strVal)) {
    return field.validation?.customErrorAr || `رقم الجوال في "${field.labelAr}" غير صحيح.`;
  }

  if (field.type === 'url') {
    try {
      const parsed = new URL(strVal);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return field.validation?.customErrorAr || `الرابط في "${field.labelAr}" يجب أن يبدأ بـ http أو https.`;
      }
    } catch {
      return field.validation?.customErrorAr || `صيغة الرابط في "${field.labelAr}" غير صالحة.`;
    }
  }

  if (field.validation?.pattern) {
    try {
      const regex = new RegExp(field.validation.pattern);
      if (!regex.test(strVal)) {
        return field.validation?.customErrorAr || `القيمة المدخلة في "${field.labelAr}" لا تطابق الصيغة المطلوبة.`;
      }
    } catch {
      // Ignore invalid regex definition safely
    }
  }

  return null;
}

export function validateDynamicFormValues(
  fields: DynamicFieldDefinition[],
  placements: DynamicFormFieldPlacement[],
  values: Record<string, unknown>,
  user: UserProfile | null | undefined
): Record<string, string> {
  const errors: Record<string, string> = {};
  const placementById = new Map(placements.map((p) => [p.fieldId, p]));

  for (const field of fields) {
    if (!canViewDynamicField(field, user)) continue;
    const pl = placementById.get(field.fieldId);
    if (pl?.hidden) continue;
    if (!canEditDynamicField(field, pl, user)) continue;
    const err = validateDynamicFieldValue(field, values[field.key], pl?.requiredOverride);
    if (err) errors[field.key] = err;
  }
  return errors;
}

export function buildEffectiveFormSchema(params: {
  formId: string;
  dynamicForms: DynamicFormDefinition[];
  dynamicFields: DynamicFieldDefinition[];
}): {
  formMeta: DynamicFormDefinition;
  sections: DynamicFormSection[];
  placements: DynamicFormFieldPlacement[];
  fieldsById: Map<string, DynamicFieldDefinition>;
} {
  const builtIn = BUILT_IN_FORMS_CATALOG.find((f) => f.formId === params.formId);
  const storedForm = params.dynamicForms.find((f) => f.formId === params.formId);
  const matchingFields = params.dynamicFields
    .filter((f) => f.formId === params.formId && !f.archived && f.visible)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const fieldsById = new Map(matchingFields.map((f) => [f.fieldId, f]));

  const defaultSections: DynamicFormSection[] = [
    {
      sectionId: 'sec_custom_default',
      titleAr: 'الحقول الإضافية المخصصة',
      titleEn: 'Custom Fields',
      order: 1,
    },
  ];

  const sections =
    storedForm && Array.isArray(storedForm.sections) && storedForm.sections.length > 0
      ? [...storedForm.sections].sort((a, b) => a.order - b.order)
      : defaultSections;

  const firstSectionId = sections[0]?.sectionId || 'sec_custom_default';
  const storedPlacements = storedForm?.placements || [];
  const placedIds = new Set(storedPlacements.map((p) => p.fieldId));

  // Merge published placements + any newly added fields for this form not yet explicitly placed
  const mergedPlacements: DynamicFormFieldPlacement[] = [
    ...storedPlacements.filter((p) => !p.hidden && fieldsById.has(p.fieldId)),
  ];

  let nextOrder = mergedPlacements.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  for (const field of matchingFields) {
    if (!placedIds.has(field.fieldId)) {
      mergedPlacements.push({
        fieldId: field.fieldId,
        fieldKey: field.key,
        sectionId: firstSectionId,
        order: nextOrder++,
        width: field.type === 'long_text' ? 'full' : 'half',
      });
    }
  }

  mergedPlacements.sort((a, b) => a.order - b.order);

  const formMeta: DynamicFormDefinition = storedForm || {
    formId: params.formId,
    nameAr: builtIn?.nameAr || params.formId,
    nameEn: builtIn?.nameEn || params.formId,
    description: builtIn?.description,
    module: builtIn?.module || 'custom',
    targetEntity: builtIn?.targetEntity || 'customEntityRecords',
    layoutMode: 'sections',
    sections,
    placements: mergedPlacements,
    publishedVersion: 1,
    status: 'published',
    createdByUid: '',
    allowedUids: [],
  };

  return {
    formMeta,
    sections,
    placements: mergedPlacements,
    fieldsById,
  };
}

export function formatDynamicFieldDisplayValue(
  field: DynamicFieldDefinition,
  value: unknown,
  allValues: Record<string, unknown> = {}
): string {
  if (field.type === 'formula') {
    const computed = evaluateFormula(field.formulaExpression, allValues);
    return computed !== null ? String(computed) : '—';
  }
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'boolean' || field.type === 'checkbox') {
    return value === true || value === 'true' ? 'نعم' : 'لا';
  }
  if (field.type === 'currency') {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toLocaleString('en-US')} ر.س` : String(value);
  }
  if (field.type === 'percentage') {
    const num = Number(value);
    return Number.isFinite(num) ? `${num}%` : String(value);
  }
  if (field.type === 'dropdown' && field.options?.length) {
    const found = field.options.find((o) => o.value === String(value));
    return found ? found.labelAr : String(value);
  }
  if (field.type === 'multiselect' && Array.isArray(value)) {
    return value
      .map((v) => field.options?.find((o) => o.value === String(v))?.labelAr || String(v))
      .join('، ');
  }
  if ((field.type === 'image' || field.type === 'pdf' || field.type === 'file')) {
    if (Array.isArray(value)) return `${value.length} مرفق`;
    if (typeof value === 'object' && value !== null && 'fileName' in value) {
      return String((value as { fileName?: string }).fileName || 'مرفق محفوظ');
    }
    return String(value);
  }
  return String(value);
}

export function analyzeDynamicFieldImpact(
  fieldKey: string,
  records: Array<{ customFields?: Record<string, unknown> }>
): number {
  let count = 0;
  for (const r of records) {
    const v = r.customFields?.[fieldKey];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
      count++;
    }
  }
  return count;
}

export function sanitizeCustomFieldsForFirestore(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

