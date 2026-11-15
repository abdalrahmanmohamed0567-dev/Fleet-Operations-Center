import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  CheckCircle2,
  FileSearch,
  KeyRound,
  Plus,
  RefreshCw,
  Sliders,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { db } from '../lib/firebase';
import {
  BOOTSTRAPPED_OWNER_EMAIL_LOWER,
  createEmptyPermissionMatrix,
  DEFAULT_ROLE_TEMPLATES,
  getMergedPlatformCatalog,
  hasPermission,
  isKeetaActive,
  mapLegacyRoleToTemplateId,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  resolveDataScope,
  resolveEffectivePermissions,
} from '../shared/rbacCore';
import type {
  AuditLog,
  DataScope,
  ModulePermissions,
  OperationalSettings,
  PermissionAction,
  PermissionMatrix,
  PermissionModule,
  Platform,
  PlatformCatalogEntry,
  RiderMaster,
  RoleTemplate,
  UserProfile,
  UserRole,
} from '../types/fleet';
import { DataTable, type TableColumn } from './DataTable';
import {
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  Tabs,
  ToastBanner,
} from './ui/EnterpriseUI';

export type RbacSubTab = 'rbac_users' | 'rbac_roles' | 'rbac_audit';

interface RbacManagementModuleProps {
  usersList: UserProfile[];
  roleTemplates: RoleTemplate[];
  auditLogs: AuditLog[];
  riders: RiderMaster[];
  branches: string[];
  platformCatalog: PlatformCatalogEntry[];
  settings: OperationalSettings;
  currentUser: UserProfile;
  allowedUids: string[];
  initialSubTab?: RbacSubTab;
  onRefresh: () => Promise<void>;
}

function mapTemplateToLegacyRole(templateId: string): UserRole {
  switch (templateId) {
    case 'super_admin':
      return 'admin';
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
    case 'platform_supervisor':
      return 'supervisor';
    case 'accountant':
      return 'accountant';
    case 'reports_viewer':
    default:
      return 'viewer';
  }
}

export function RbacManagementModule({
  usersList,
  roleTemplates,
  auditLogs,
  riders,
  branches,
  platformCatalog,
  settings,
  currentUser,
  allowedUids,
  initialSubTab = 'rbac_users',
  onRefresh,
}: RbacManagementModuleProps) {
  const [subTab, setSubTab] = useState<RbacSubTab>(initialSubTab);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // User Edit Drawer
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userForm, setUserForm] = useState<{
    customRoleId: string;
    active: boolean;
    dataScope: DataScope;
    permissionOverrides: Partial<Record<PermissionModule, Partial<ModulePermissions>>>;
    useOverrides: boolean;
  }>({
    customRoleId: 'reports_viewer',
    active: true,
    dataScope: { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] },
    permissionOverrides: {},
    useOverrides: false,
  });

  // Role Template Editor
  const [selectedRoleId, setSelectedRoleId] = useState<string>('super_admin');
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({
    roleId: '',
    nameAr: '',
    nameEn: '',
    description: '',
    copyFromId: 'platform_supervisor',
  });
  const [roleMatrixDraft, setRoleMatrixDraft] = useState<PermissionMatrix | null>(null);

  // Audit filters
  const [auditSourceFilter, setAuditSourceFilter] = useState<string>('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState<string>('all');

  const mergedRoles = useMemo(() => {
    const map = new Map<string, RoleTemplate>();
    for (const d of DEFAULT_ROLE_TEMPLATES) {
      map.set(d.roleId, { ...d, createdByUid: currentUser.uid, allowedUids });
    }
    for (const r of roleTemplates) {
      map.set(r.roleId, r);
    }
    return Array.from(map.values());
  }, [roleTemplates, currentUser.uid, allowedUids]);

  const keetaActive = isKeetaActive(settings, platformCatalog);
  const availablePlatforms = useMemo(() => {
    return getMergedPlatformCatalog(platformCatalog, settings).filter((p) =>
      p.platformId === 'keeta' ? keetaActive : !p.hiddenFromUi
    );
  }, [platformCatalog, settings, keetaActive]);

  const citiesList = useMemo(() => {
    const s = new Set<string>();
    for (const r of riders) if (r.city) s.add(r.city);
    return Array.from(s).sort();
  }, [riders]);

  const canManageUsers = hasPermission(currentUser, mergedRoles, 'users', 'edit') || currentUser.role === 'owner';
  const canEditRoles = hasPermission(currentUser, mergedRoles, 'roles', 'edit') || currentUser.role === 'owner';
  const canAddRoles = hasPermission(currentUser, mergedRoles, 'roles', 'add') || currentUser.role === 'owner';
  const canViewAudit = hasPermission(currentUser, mergedRoles, 'audit', 'view') || currentUser.role === 'owner';

  const selectedTemplate = useMemo(
    () => mergedRoles.find((r) => r.roleId === selectedRoleId) || mergedRoles[0],
    [mergedRoles, selectedRoleId]
  );

  const activeMatrix: PermissionMatrix = roleMatrixDraft || selectedTemplate?.permissions || createEmptyPermissionMatrix();

  const openEditUser = (u: UserProfile) => {
    const tplId = u.customRoleId || mapLegacyRoleToTemplateId(u.role);
    const scope = resolveDataScope(u);
    setEditingUser(u);
    setUserForm({
      customRoleId: tplId,
      active: Boolean(u.active),
      dataScope: {
        allBranches: scope.allBranches,
        branches: [...scope.branches],
        cities: [...scope.cities],
        platforms: [...scope.platforms],
        riderIds: [...scope.riderIds],
      },
      permissionOverrides: u.permissionOverrides ? JSON.parse(JSON.stringify(u.permissionOverrides)) : {},
      useOverrides: Boolean(u.permissionOverrides && Object.keys(u.permissionOverrides).length > 0),
    });
  };

  const handleSaveUserRbac = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !canManageUsers) return;
    const isTargetOwner = editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER;

    setBusy(true);
    setToast(null);
    try {
      const legacyRole: UserRole = isTargetOwner ? 'owner' : mapTemplateToLegacyRole(userForm.customRoleId);
      const validPlatforms: Platform[] = userForm.dataScope.platforms.filter(
        (p): p is Platform => p === 'hungerstation' || p === 'keeta'
      );

      const patch: Record<string, unknown> = {
        role: legacyRole,
        customRoleId: isTargetOwner ? 'super_admin' : userForm.customRoleId,
        active: isTargetOwner ? true : userForm.active,
        allowedPlatforms: validPlatforms.length > 0 ? validPlatforms : ['hungerstation'],
        dataScope: isTargetOwner
          ? { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] }
          : userForm.dataScope,
        assignedBranch: userForm.dataScope.branches[0] || '',
        assignedCity: userForm.dataScope.cities[0] || '',
        permissionOverrides: !isTargetOwner && userForm.useOverrides ? userForm.permissionOverrides : {},
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'users', editingUser.uid), patch);

      await writeErpAuditLog({
        action: 'RBAC_USER_UPDATED',
        targetCollection: 'users',
        targetId: editingUser.uid,
        entityType: 'user',
        details: `تحديث صلاحيات ونطاق المستخدم ${editingUser.email} -> الدور: ${userForm.customRoleId}`,
        oldValue: { role: editingUser.role, customRoleId: editingUser.customRoleId, active: editingUser.active },
        newValue: { role: legacyRole, customRoleId: userForm.customRoleId, active: patch.active, dataScope: userForm.dataScope },
        user: currentUser,
        allowedUids,
      });

      setEditingUser(null);
      setToast({ type: 'ok', msg: `تم حفظ صلاحيات ونطاق المستخدم ${editingUser.email}.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تحديث صلاحيات المستخدم.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleMatrixCell = (mod: PermissionModule, act: PermissionAction) => {
    if (!canEditRoles) return;
    const base = activeMatrix;
    const next: PermissionMatrix = {
      ...base,
      [mod]: {
        ...base[mod],
        [act]: !base[mod]?.[act],
      },
    };
    setRoleMatrixDraft(next);
  };

  const toggleModuleRowAll = (mod: PermissionModule, val: boolean) => {
    if (!canEditRoles) return;
    const next: PermissionMatrix = {
      ...activeMatrix,
      [mod]: { view: val, add: val, edit: val, delete: val, export: val, approve: val },
    };
    setRoleMatrixDraft(next);
  };

  const handleSaveRoleTemplate = async () => {
    if (!selectedTemplate || !canEditRoles) return;
    setBusy(true);
    setToast(null);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'roleTemplates', selectedTemplate.roleId), {
        roleId: selectedTemplate.roleId,
        nameAr: selectedTemplate.nameAr,
        nameEn: selectedTemplate.nameEn,
        description: selectedTemplate.description || '',
        isSystemPreset: selectedTemplate.isSystemPreset,
        permissions: activeMatrix,
        createdByUid: selectedTemplate.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await writeErpAuditLog({
        action: 'RBAC_ROLE_MATRIX_UPDATED',
        targetCollection: 'roleTemplates',
        targetId: selectedTemplate.roleId,
        entityType: 'role_template',
        details: `تعديل مصفوفة الصلاحيات للقالب: ${selectedTemplate.nameAr}`,
        oldValue: selectedTemplate.permissions,
        newValue: activeMatrix,
        user: currentUser,
        allowedUids,
      });

      setRoleMatrixDraft(null);
      setToast({ type: 'ok', msg: `تم حفظ مصفوفة الصلاحيات للدور "${selectedTemplate.nameAr}".` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ مصفوفة الدور.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddRoles) return;
    const roleId =
      newRoleForm.roleId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || `custom_${Date.now().toString(36)}`;
    const copySrc = mergedRoles.find((r) => r.roleId === newRoleForm.copyFromId);
    const permissions = copySrc ? JSON.parse(JSON.stringify(copySrc.permissions)) : createEmptyPermissionMatrix();

    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'roleTemplates', roleId), {
        roleId,
        nameAr: newRoleForm.nameAr.trim(),
        nameEn: (newRoleForm.nameEn.trim() || newRoleForm.nameAr.trim()).slice(0, 120),
        description: newRoleForm.description.trim().slice(0, 400),
        isSystemPreset: false,
        permissions,
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await writeErpAuditLog({
        action: 'RBAC_ROLE_CREATED',
        targetCollection: 'roleTemplates',
        targetId: roleId,
        entityType: 'role_template',
        details: `إنشاء قالب دور وظيفي مخصص: ${newRoleForm.nameAr} (منسوخ من ${newRoleForm.copyFromId})`,
        user: currentUser,
        allowedUids,
      });

      setCreateRoleOpen(false);
      setSelectedRoleId(roleId);
      setRoleMatrixDraft(null);
      setToast({ type: 'ok', msg: `تم إنشاء قالب الدور "${newRoleForm.nameAr}" بنجاح.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل إنشاء الدور.' });
    } finally {
      setBusy(false);
    }
  };

  const filteredAudit = useMemo(() => {
    return auditLogs
      .filter((l) => (auditSourceFilter === 'all' ? true : (l.source || 'UI') === auditSourceFilter))
      .filter((l) => (auditEntityFilter === 'all' ? true : (l.entityType || l.targetCollection) === auditEntityFilter))
      .slice()
      .sort((a, b) => String(b.createdAt || b.logId).localeCompare(String(a.createdAt || a.logId)));
  }, [auditLogs, auditSourceFilter, auditEntityFilter]);

  const userColumns: TableColumn<UserProfile>[] = [
    {
      key: 'user',
      header: 'المستخدم',
      sortValue: (u) => u.displayName,
      render: (u) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{u.displayName}</div>
          <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">{u.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'قالب الدور الوظيفي',
      sortValue: (u) => u.customRoleId || u.role,
      render: (u) => {
        const tplId = u.customRoleId || mapLegacyRoleToTemplateId(u.role);
        const tpl = mergedRoles.find((r) => r.roleId === tplId);
        return (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">{tpl?.nameAr || tplId}</span>
            {u.permissionOverrides && Object.keys(u.permissionOverrides).length > 0 && (
              <StatusBadge label="استثناءات فردية" tone="warning" />
            )}
          </div>
        );
      },
    },
    {
      key: 'scope',
      header: 'نطاق البيانات (Data Scope)',
      render: (u) => {
        const s = resolveDataScope(u);
        return (
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {s.allBranches ? 'كافة الفروع' : `فروع: ${s.branches.join('، ') || 'محدد'}`}
            {s.cities.length > 0 ? ` · مدن: ${s.cities.join('، ')}` : ''}
            {s.platforms.length > 0 ? ` · منصات: ${s.platforms.join('، ')}` : ''}
          </span>
        );
      },
    },
    {
      key: 'active',
      header: 'الحالة',
      render: (u) => (
        <StatusBadge
          label={u.active ? 'نشط ومفعّل' : 'معلّق / بانتظار التفعيل'}
          tone={u.active ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'act',
      header: 'تخصيص الصلاحيات',
      render: (u) =>
        canManageUsers ? (
          <Button size="sm" variant="secondary" onClick={() => openEditUser(u)}>
            إدارة الدور والنطاق
          </Button>
        ) : (
          <span className="text-xs text-slate-400">قراءة فقط</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمون، الأدوار، مصفوفة الصلاحيات، وسجل التدقيق (RBAC)"
        subtitle="صلاحيات تفصيلية (13 وحدة × 6 إجراءات) · عزل نطاق الفروع والمدن والمنصات · تتبع كامل في سجل النشاط"
        actions={
          <Button
            variant="secondary"
            loading={busy}
            disabled={busy}
            onClick={() => void onRefresh()}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            تحديث
          </Button>
        }
      />

      <Tabs
        variant="underline"
        activeKey={subTab}
        onChange={setSubTab}
        items={[
          { key: 'rbac_users', label: 'المستخدمون وتحديد النطاق', count: usersList.length, icon: <Users className="h-3.5 w-3.5" /> },
          { key: 'rbac_roles', label: 'مصفوفة الأدوار والصلاحيات', count: mergedRoles.length, icon: <KeyRound className="h-3.5 w-3.5" /> },
          { key: 'rbac_audit', label: 'سجل النشاط والتدقيق', count: auditLogs.length, icon: <FileSearch className="h-3.5 w-3.5" /> },
        ]}
      />

      {toast && (
        <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />
      )}

      {/* TAB 1: USERS & DATA SCOPE */}
      {subTab === 'rbac_users' && (
        <DataTable
          rows={usersList}
          columns={userColumns}
          rowKey={(u) => u.uid}
          searchPlaceholder="ابحث بالاسم أو البريد الإلكتروني أو الدور..."
          searchText={(u) => `${u.displayName} ${u.email} ${u.customRoleId || u.role} ${u.assignedBranch || ''}`}
        />
      )}

      {/* TAB 2: INTERACTIVE PERMISSION MATRIX */}
      {subTab === 'rbac_roles' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          <Card className="space-y-3">
            <SectionHeader
              title="قوالب الأدوار"
              actions={
                canAddRoles ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => setCreateRoleOpen(true)}
                  >
                    دور جديد
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-1.5">
              {mergedRoles.map((r) => {
                const active = r.roleId === selectedTemplate?.roleId;
                return (
                  <button
                    key={r.roleId}
                    type="button"
                    onClick={() => {
                      setSelectedRoleId(r.roleId);
                      setRoleMatrixDraft(null);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-right transition-colors ${
                      active
                        ? 'border-[#0f1e36] dark:border-blue-500 bg-[#0f1e36] dark:bg-blue-600 text-white'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">{r.nameAr}</div>
                    <div className={`text-[11px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                      {r.isSystemPreset ? 'قالب قياسي قابل للتخصيص' : 'دور مخصص'}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="lg:col-span-3 space-y-4">
            <SectionHeader
              title={selectedTemplate?.nameAr || ''}
              subtitle={selectedTemplate?.description}
              className="border-b border-slate-200 dark:border-slate-800 pb-3"
              actions={
                canEditRoles ? (
                  <>
                    {roleMatrixDraft && (
                      <Button size="sm" variant="secondary" onClick={() => setRoleMatrixDraft(null)}>
                        تراجع
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy}
                      disabled={busy || !roleMatrixDraft}
                      onClick={() => void handleSaveRoleTemplate()}
                    >
                      حفظ مصفوفة الصلاحيات
                    </Button>
                  </>
                ) : undefined
              }
            />

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <th className="px-3 py-2.5 text-right font-bold">الوحدة / النظام (Module)</th>
                    {PERMISSION_ACTIONS.map((act) => (
                      <th key={act.key} className="px-2.5 py-2.5 text-center font-bold">
                        {act.labelAr}
                      </th>
                    ))}
                    <th className="px-2.5 py-2.5 text-center font-bold">تحديد الكل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {PERMISSION_MODULES.map((mod) => {
                    const rowPerm = activeMatrix[mod.key] || { view: false, add: false, edit: false, delete: false, export: false, approve: false };
                    const allOn = PERMISSION_ACTIONS.every((a) => rowPerm[a.key]);
                    return (
                      <tr key={mod.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                          {mod.labelAr}
                          <div className="text-[10px] font-normal text-slate-400">{mod.labelEn}</div>
                        </td>
                        {PERMISSION_ACTIONS.map((act) => (
                          <td key={act.key} className="px-2.5 py-2.5 text-center">
                            <input
                              type="checkbox"
                              disabled={!canEditRoles || selectedTemplate?.roleId === 'super_admin'}
                              checked={Boolean(rowPerm[act.key])}
                              onChange={() => toggleMatrixCell(mod.key, act.key)}
                              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 accent-[#0f1e36] dark:accent-blue-600 cursor-pointer"
                            />
                          </td>
                        ))}
                        <td className="px-2.5 py-2.5 text-center">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canEditRoles || selectedTemplate?.roleId === 'super_admin'}
                            onClick={() => toggleModuleRowAll(mod.key, !allOn)}
                          >
                            {allOn ? 'إلغاء' : 'الكل'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: CENTRAL AUDIT LOG VIEWER */}
      {subTab === 'rbac_audit' && (
        <div className="space-y-4">
          {!canViewAudit ? (
            <ToastBanner type="warn" message="صلاحية عرض سجل التدقيق (audit.view) غير مفعلة لحسابك." />
          ) : (
            <>
              <Card padding="sm" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="المصدر">
                  <Select value={auditSourceFilter} onChange={(e) => setAuditSourceFilter(e.target.value)}>
                    <option value="all">جميع المصادر</option>
                    <option value="UI">واجهة النظام (UI)</option>
                    <option value="API">خادم API</option>
                    <option value="Import">الاستيراد</option>
                    <option value="System">النظام</option>
                  </Select>
                </FormField>
                <FormField label="نوع الكيان">
                  <Select value={auditEntityFilter} onChange={(e) => setAuditEntityFilter(e.target.value)}>
                    <option value="all">الكل</option>
                    <option value="rider">مندوب</option>
                    <option value="document">مستند خاص</option>
                    <option value="platform_account">حساب منصة</option>
                    <option value="vehicle">مركبة</option>
                    <option value="vehicle_assignment">عهدة سيارة</option>
                    <option value="user">مستخدم / صلاحيات</option>
                    <option value="report">تصدير تقارير</option>
                  </Select>
                </FormField>
              </Card>

              <DataTable
                rows={filteredAudit}
                rowKey={(l) => l.logId}
                searchPlaceholder="ابحث بالإجراء، المنفذ، رقم السجل، أو التفاصيل..."
                searchText={(l) => `${l.action} ${l.actorEmail} ${l.targetId} ${l.details} ${l.oldValue || ''} ${l.newValue || ''}`}
                columns={[
                  {
                    key: 'act',
                    header: 'الإجراء والمصدر',
                    sortValue: (l) => l.action,
                    render: (l) => (
                      <div>
                        <div className="font-mono-num font-bold text-xs text-slate-900 dark:text-slate-100">{l.action}</div>
                        <div className="text-[11px] text-slate-500">
                          {l.source || 'UI'} · {l.targetCollection}/{l.targetId}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'actor',
                    header: 'المنفذ',
                    sortValue: (l) => l.actorEmail,
                    render: (l) => <span className="font-mono-num text-xs">{l.actorEmail}</span>,
                  },
                  {
                    key: 'details',
                    header: 'التفاصيل والتغيير (قبل / بعد)',
                    render: (l) => (
                      <div className="text-xs max-w-md whitespace-normal">
                        <div className="text-slate-800 dark:text-slate-200">{l.details}</div>
                        {(l.oldValue || l.newValue) && (
                          <div className="mt-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                            {l.oldValue ? `قبل: ${l.oldValue.slice(0, 90)}` : ''}
                            {l.oldValue && l.newValue ? ' ← ' : ''}
                            {l.newValue ? `بعد: ${l.newValue.slice(0, 90)}` : ''}
                          </div>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* EDIT USER RBAC & DATA SCOPE DRAWER */}
      <SlideDrawer
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        size="lg"
        title={editingUser ? `تخصيص الصلاحيات ونطاق البيانات — ${editingUser.displayName}` : ''}
        subtitle={editingUser?.email}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingUser(null)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="rbac-edit-user-form"
              variant="primary"
              loading={busy}
              disabled={busy}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {busy ? 'جاري الحفظ...' : 'اعتماد صلاحيات المستخدم'}
            </Button>
          </>
        }
      >
        {editingUser && (
          <form id="rbac-edit-user-form" onSubmit={(e) => void handleSaveUserRbac(e)} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="قالب الدور الوظيفي">
                <Select
                  value={userForm.customRoleId}
                  onChange={(e) => setUserForm({ ...userForm, customRoleId: e.target.value })}
                  disabled={editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER}
                >
                  {mergedRoles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>{r.nameAr}</option>
                  ))}
                </Select>
              </FormField>

              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    disabled={editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER}
                    onChange={(e) => setUserForm({ ...userForm, active: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                  />
                  <span>حساب مفعّل ويسمح له بالدخول</span>
                </label>
              </div>
            </div>

            {/* Data Scope Controls */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                  <Sliders className="h-3.5 w-3.5" />
                  <span>نطاق البيانات المسموح بها (Data Scope)</span>
                </span>
                <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={userForm.dataScope.allBranches}
                    onChange={(e) =>
                      setUserForm({
                        ...userForm,
                        dataScope: { ...userForm.dataScope, allBranches: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                  />
                  <span>الوصول لجميع الفروع</span>
                </label>
              </div>

              {!userForm.dataScope.allBranches && (
                <div>
                  <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">تحديد الفروع المسموح بها:</div>
                  <div className="flex flex-wrap gap-2">
                    {branches.map((br) => {
                      const checked = userForm.dataScope.branches.includes(br);
                      return (
                        <label key={br} className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...userForm.dataScope.branches, br]
                                : userForm.dataScope.branches.filter((x) => x !== br);
                              setUserForm({ ...userForm, dataScope: { ...userForm.dataScope, branches: next } });
                            }}
                          />
                          <span>{br}</span>
                        </label>
                      );
                    })}
                    {branches.length === 0 && <span className="text-slate-400">لا توجد فروع مسجلة بعد.</span>}
                  </div>
                </div>
              )}

              {citiesList.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">تقييد حسب المدن (اختياري):</div>
                  <div className="flex flex-wrap gap-2">
                    {citiesList.map((city) => {
                      const checked = userForm.dataScope.cities.includes(city);
                      return (
                        <label key={city} className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...userForm.dataScope.cities, city]
                                : userForm.dataScope.cities.filter((x) => x !== city);
                              setUserForm({ ...userForm, dataScope: { ...userForm.dataScope, cities: next } });
                            }}
                          />
                          <span>{city}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">المنصات المسموح بها:</div>
                <div className="flex flex-wrap gap-2">
                  {availablePlatforms.map((plat) => {
                    const checked = userForm.dataScope.platforms.includes(plat.platformId);
                    return (
                      <label key={plat.platformId} className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...userForm.dataScope.platforms, plat.platformId]
                              : userForm.dataScope.platforms.filter((x) => x !== plat.platformId);
                            setUserForm({ ...userForm, dataScope: { ...userForm.dataScope, platforms: next } });
                          }}
                        />
                        <span>{plat.nameAr}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Individual Permission Overrides */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-4 space-y-2.5">
              <label className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userForm.useOverrides}
                  onChange={(e) => setUserForm({ ...userForm, useOverrides: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                />
                <span>تطبيق استثناءات صلاحيات مخصصة لهذا المستخدم (Overrides)</span>
              </label>
              {userForm.useOverrides && (
                <div className="max-h-56 overflow-y-auto erp-scroll border-t border-slate-200 dark:border-slate-800 pt-2.5">
                  {(() => {
                    const previewEffective = resolveEffectivePermissions(
                      {
                        ...editingUser,
                        customRoleId: userForm.customRoleId,
                        active: userForm.active,
                        permissionOverrides: userForm.permissionOverrides,
                      },
                      mergedRoles
                    );
                    return PERMISSION_MODULES.map((mod) => (
                      <div key={mod.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[11px] border-b border-slate-100 dark:border-slate-800/70 last:border-b-0">
                        <span className="font-medium w-44 truncate text-slate-800 dark:text-slate-200">{mod.labelAr}</span>
                        <div className="flex flex-wrap items-center gap-3">
                          {PERMISSION_ACTIONS.map((act) => (
                            <label key={act.key} className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(previewEffective[mod.key]?.[act.key])}
                                onChange={(e) => {
                                  const nextMod = {
                                    ...(userForm.permissionOverrides[mod.key] || {}),
                                    [act.key]: e.target.checked,
                                  };
                                  setUserForm({
                                    ...userForm,
                                    permissionOverrides: { ...userForm.permissionOverrides, [mod.key]: nextMod },
                                  });
                                }}
                              />
                              <span>{act.labelAr}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </form>
        )}
      </SlideDrawer>

      {/* CREATE CUSTOM ROLE DRAWER */}
      <SlideDrawer
        open={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        size="sm"
        title="إنشاء قالب دور وظيفي مخصص"
        subtitle="نسخ صلاحيات أولية من قالب قياسي وتخصيصها في المصفوفة"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateRoleOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="rbac-create-role-form"
              variant="primary"
              loading={busy}
              disabled={busy}
            >
              إنشاء الدور
            </Button>
          </>
        }
      >
        <form id="rbac-create-role-form" onSubmit={(e) => void handleCreateCustomRole(e)} className="space-y-4">
          <FormField label="اسم الدور بالعربية" required>
            <Input
              type="text"
              required
              value={newRoleForm.nameAr}
              onChange={(e) => setNewRoleForm({ ...newRoleForm, nameAr: e.target.value })}
              placeholder="مثال: مشرف عمليات الرياض"
            />
          </FormField>

          <FormField label="الاسم بالإنجليزية">
            <Input
              type="text"
              value={newRoleForm.nameEn}
              onChange={(e) => setNewRoleForm({ ...newRoleForm, nameEn: e.target.value })}
              placeholder="Riyadh Ops Supervisor"
            />
          </FormField>

          <FormField label="نسخ الصلاحيات الأولية من">
            <Select
              value={newRoleForm.copyFromId}
              onChange={(e) => setNewRoleForm({ ...newRoleForm, copyFromId: e.target.value })}
            >
              {mergedRoles.map((r) => (
                <option key={r.roleId} value={r.roleId}>{r.nameAr}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="الوصف">
            <Input
              type="text"
              value={newRoleForm.description}
              onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
            />
          </FormField>
        </form>
      </SlideDrawer>
    </div>
  );
}
