import { doc, serverTimestamp, setDoc } from '../lib/erpDb';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileSearch,
  KeyRound,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { db, getActiveAuthToken } from '../lib/firebase';
import { safeParseJsonResponse } from '../lib/safeFetch';
import { ConfirmModal } from './ConfirmModal';
import {
  BOOTSTRAPPED_OWNER_EMAIL_LOWER,
  createEmptyCapabilities,
  createEmptyPermissionMatrix,
  DEFAULT_ROLE_TEMPLATES,
  getMergedPlatformCatalog,
  GRANULAR_CAPABILITIES,
  hasPermission,
  isKeetaActive,
  mapLegacyRoleToTemplateId,
  mapTemplateToLegacyRole,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  resolveDataScope,
  resolveEffectiveCapabilities,
  resolveEffectivePermissions,
} from '../shared/rbacCore';
import type {
  AuditLog,
  CapabilityMap,
  DataScope,
  GranularCapability,
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

  // Add User Drawer
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newUserForm, setNewUserForm] = useState<{
    displayName: string;
    phone: string;
    password: string;
    email: string;
    customRoleId: string;
    active: boolean;
    dataScope: DataScope;
  }>({
    displayName: '',
    phone: '',
    password: '',
    email: '',
    customRoleId: 'reports_viewer',
    active: true,
    dataScope: { allBranches: true, branches: [], cities: [], platforms: ['hungerstation'], riderIds: [] },
  });

  // Delete User Modal
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfile | null>(null);

  // User Edit Drawer
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userForm, setUserForm] = useState<{
    displayName: string;
    phone: string;
    newPassword: string;
    customRoleId: string;
    active: boolean;
    dataScope: DataScope;
    permissionOverrides: Partial<Record<PermissionModule, Partial<ModulePermissions>>>;
    capabilityOverrides: Partial<CapabilityMap>;
    useOverrides: boolean;
  }>({
    displayName: '',
    phone: '',
    newPassword: '',
    customRoleId: 'reports_viewer',
    active: true,
    dataScope: { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] },
    permissionOverrides: {},
    capabilityOverrides: {},
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
  const [roleCapsDraft, setRoleCapsDraft] = useState<CapabilityMap | null>(null);

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

  const canManageUsers = hasPermission(currentUser, mergedRoles, 'users', 'edit') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canAddUsers = hasPermission(currentUser, mergedRoles, 'users', 'add') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canDeleteUsers = hasPermission(currentUser, mergedRoles, 'users', 'delete') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canEditRoles = hasPermission(currentUser, mergedRoles, 'roles', 'edit') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canAddRoles = hasPermission(currentUser, mergedRoles, 'roles', 'add') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canViewAudit = hasPermission(currentUser, mergedRoles, 'audit', 'view') || currentUser.role === 'owner' || currentUser.role === 'admin';

  const selectedTemplate = useMemo(
    () => mergedRoles.find((r) => r.roleId === selectedRoleId) || mergedRoles[0],
    [mergedRoles, selectedRoleId]
  );

  const activeMatrix: PermissionMatrix = roleMatrixDraft || selectedTemplate?.permissions || createEmptyPermissionMatrix();
  const activeCapabilities: CapabilityMap = {
    ...createEmptyCapabilities(),
    ...(roleCapsDraft || selectedTemplate?.capabilities || {}),
  };

  const openCreateUser = () => {
    setShowNewPassword(false);
    setNewUserForm({
      displayName: '',
      phone: '',
      password: '',
      email: '',
      customRoleId: 'reports_viewer',
      active: true,
      dataScope: { allBranches: true, branches: [], cities: [], platforms: ['hungerstation'], riderIds: [] },
    });
    setCreateUserOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddUsers) return;
    setBusy(true);
    setToast(null);
    try {
      const token = await getActiveAuthToken();
      if (!token) throw new Error('انتهت جلسة تسجيل الدخول.');

      const validPlatforms: Platform[] = newUserForm.dataScope.platforms.filter(
        (p): p is Platform => p === 'hungerstation' || p === 'keeta'
      );

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: newUserForm.displayName.trim(),
          phone: newUserForm.phone.trim(),
          password: newUserForm.password,
          email: newUserForm.email.trim() || undefined,
          customRoleId: newUserForm.customRoleId,
          active: newUserForm.active,
          dataScope: newUserForm.dataScope,
          allowedPlatforms: validPlatforms.length > 0 ? validPlatforms : ['hungerstation'],
        }),
      });
      const json = await safeParseJsonResponse<{ ok?: boolean; user?: UserProfile; error?: string }>(res);
      if (!res.ok || !json.user) {
        throw new Error(json.error || 'تعذر إنشاء المستخدم.');
      }

      setCreateUserOpen(false);
      const roleName = mergedRoles.find((r) => r.roleId === newUserForm.customRoleId)?.nameAr || newUserForm.customRoleId;
      setToast({
        type: 'ok',
        msg: `تم إنشاء حساب "${json.user.displayName}" (${json.user.phone}) بدور "${roleName}" بنجاح.`,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل إضافة المستخدم.' });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteUserTarget || !canDeleteUsers) return;
    setBusy(true);
    setToast(null);
    try {
      const token = await getActiveAuthToken();
      if (!token) throw new Error('انتهت جلسة تسجيل الدخول.');
      const res = await fetch(`/api/users/${encodeURIComponent(deleteUserTarget.uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'تعذر حذف المستخدم.');
      }
      setDeleteUserTarget(null);
      setToast({ type: 'ok', msg: `تم حذف حساب "${deleteUserTarget.displayName}" نهائيًا.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حذف المستخدم.' });
    } finally {
      setBusy(false);
    }
  };

  const openEditUser = (u: UserProfile) => {
    const tplId = u.customRoleId || mapLegacyRoleToTemplateId(u.role);
    const scope = resolveDataScope(u);
    setEditingUser(u);
    setUserForm({
      displayName: u.displayName || '',
      phone: u.phone || '',
      newPassword: '',
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
      capabilityOverrides: u.capabilityOverrides ? { ...u.capabilityOverrides } : {},
      useOverrides: Boolean(
        (u.permissionOverrides && Object.keys(u.permissionOverrides).length > 0) ||
          (u.capabilityOverrides && Object.keys(u.capabilityOverrides).length > 0)
      ),
    });
  };

  const handleSaveUserRbac = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !canManageUsers) return;
    const isTargetOwner =
      editingUser.uid === 'owner_0559786939' ||
      editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER;

    setBusy(true);
    setToast(null);
    try {
      const token = await getActiveAuthToken();
      if (!token) throw new Error('انتهت جلسة تسجيل الدخول.');

      const legacyRole: UserRole = isTargetOwner ? 'owner' : mapTemplateToLegacyRole(userForm.customRoleId);
      const validPlatforms: Platform[] = userForm.dataScope.platforms.filter(
        (p): p is Platform => p === 'hungerstation' || p === 'keeta'
      );

      const patchPayload: Record<string, unknown> = {
        displayName: userForm.displayName.trim() || editingUser.displayName,
        phone: userForm.phone.trim() || undefined,
        role: legacyRole,
        customRoleId: isTargetOwner ? 'super_admin' : userForm.customRoleId,
        active: isTargetOwner ? true : userForm.active,
        allowedPlatforms: validPlatforms.length > 0 ? validPlatforms : ['hungerstation'],
        dataScope: isTargetOwner
          ? { allBranches: true, branches: [], cities: [], platforms: [], riderIds: [] }
          : userForm.dataScope,
        permissionOverrides: !isTargetOwner && userForm.useOverrides ? userForm.permissionOverrides : {},
        capabilityOverrides: !isTargetOwner && userForm.useOverrides ? userForm.capabilityOverrides : {},
      };
      if (userForm.newPassword.trim()) {
        patchPayload.password = userForm.newPassword.trim();
      }

      const res = await fetch(`/api/users/${encodeURIComponent(editingUser.uid)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patchPayload),
      });
      const json = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'فشل تحديث بيانات وصلاحيات المستخدم.');
      }

      setEditingUser(null);
      setToast({ type: 'ok', msg: `تم حفظ بيانات وصلاحيات المستخدم ${userForm.displayName || editingUser.displayName}.` });
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

  const toggleCapabilityCell = (capKey: GranularCapability) => {
    if (!canEditRoles || selectedTemplate?.roleId === 'super_admin') return;
    setRoleCapsDraft({
      ...activeCapabilities,
      [capKey]: !activeCapabilities[capKey],
    });
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
        capabilities: activeCapabilities,
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
        details: `تعديل مصفوفة الصلاحيات والقدرات للقالب: ${selectedTemplate.nameAr}`,
        oldValue: selectedTemplate.permissions,
        newValue: { permissions: activeMatrix, capabilities: activeCapabilities },
        user: currentUser,
        allowedUids,
      });

      setRoleMatrixDraft(null);
      setRoleCapsDraft(null);
      setToast({ type: 'ok', msg: `تم حفظ مصفوفة الصلاحيات والقدرات للدور "${selectedTemplate.nameAr}".` });
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
    const capabilities = copySrc?.capabilities ? { ...copySrc.capabilities } : createEmptyCapabilities();

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
        capabilities,
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
      setRoleCapsDraft(null);
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
      header: 'المستخدم ورقم الجوال',
      sortValue: (u) => u.displayName,
      render: (u) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{u.displayName}</div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
            {u.phone && <span dir="ltr">{u.phone}</span>}
            {u.phone && u.email && <span>·</span>}
            {u.email && <span>{u.email}</span>}
          </div>
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
      header: 'الإجراءات',
      render: (u) => {
        const isProtectedOwner =
          u.uid === 'owner_0559786939' ||
          u.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER ||
          u.uid === currentUser.uid;
        return (
          <div className="flex items-center gap-1.5">
            {canManageUsers ? (
              <Button size="sm" variant="secondary" onClick={() => openEditUser(u)}>
                إدارة الدور والبيانات
              </Button>
            ) : (
              <span className="text-xs text-slate-400">قراءة فقط</span>
            )}
            {canDeleteUsers && !isProtectedOwner && (
              <button
                type="button"
                onClick={() => setDeleteUserTarget(u)}
                title="حذف المستخدم"
                className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمون، الأدوار، مصفوفة الصلاحيات، وسجل التدقيق (RBAC)"
        subtitle="إدارة حسابات الدخول برقم الجوال وكلمة المرور · تحديد الأدوار الوظيفية ونطاق البيانات · تتبع سجل التدقيق"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canAddUsers && (
              <Button
                variant="primary"
                icon={<UserPlus className="h-4 w-4" />}
                onClick={openCreateUser}
              >
                إضافة مستخدم
              </Button>
            )}
            <Button
              variant="secondary"
              loading={busy}
              disabled={busy}
              onClick={() => void onRefresh()}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              تحديث
            </Button>
          </div>
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
          tableId="rbac_users"
          rows={usersList}
          columns={userColumns}
          rowKey={(u) => u.uid}
          searchPlaceholder="ابحث بالاسم أو رقم الجوال أو البريد أو الدور..."
          searchText={(u) => `${u.displayName} ${u.phone || ''} ${u.email} ${u.customRoleId || u.role} ${u.assignedBranch || ''}`}
          toolbarExtra={
            canAddUsers ? (
              <Button size="sm" variant="primary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={openCreateUser}>
                إضافة مستخدم
              </Button>
            ) : undefined
          }
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
                      setRoleCapsDraft(null);
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

          <Card className="lg:col-span-3 space-y-5">
            <SectionHeader
              title={selectedTemplate?.nameAr || ''}
              subtitle={selectedTemplate?.description}
              className="border-b border-slate-200 dark:border-slate-800 pb-3"
              actions={
                canEditRoles ? (
                  <>
                    {(roleMatrixDraft || roleCapsDraft) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRoleMatrixDraft(null);
                          setRoleCapsDraft(null);
                        }}
                      >
                        تراجع
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy}
                      disabled={busy || (!roleMatrixDraft && !roleCapsDraft)}
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

            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  القدرات والصلاحيات التنفيذية الدقيقة (Granular Capabilities)
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  تحكم دقيق في الطباعة، الأرشفة، الاسترجاع، بناء الحقول والنماذج، وتغيير الهوية وبيانات الشركة
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {GRANULAR_CAPABILITIES.map((cap) => {
                  const checked = Boolean(activeCapabilities[cap.key]);
                  return (
                    <label
                      key={cap.key}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                        checked
                          ? 'border-blue-200 dark:border-blue-800/80 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30'
                      } ${!canEditRoles || selectedTemplate?.roleId === 'super_admin' ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEditRoles || selectedTemplate?.roleId === 'super_admin'}
                        checked={checked}
                        onChange={() => toggleCapabilityCell(cap.key)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 accent-[#0f1e36] dark:accent-blue-600"
                      />
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">{cap.labelAr}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{cap.descriptionAr}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
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
                tableId="rbac_audit"
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
              <FormField label="الاسم الكامل" required>
                <Input
                  type="text"
                  required
                  value={userForm.displayName}
                  onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })}
                />
              </FormField>

              <FormField label="رقم الجوال (لتسجيل الدخول)" required>
                <Input
                  type="tel"
                  dir="ltr"
                  className="font-mono-num text-left"
                  value={userForm.phone}
                  onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                />
              </FormField>

              <FormField label="كلمة مرور جديدة" hint="اتركها فارغة للإبقاء على كلمة المرور الحالية">
                <Input
                  type="password"
                  dir="ltr"
                  className="font-mono-num text-left"
                  value={userForm.newPassword}
                  onChange={(e) => setUserForm({ ...userForm, newPassword: e.target.value })}
                  placeholder="••••"
                />
              </FormField>

              <FormField label="قالب الدور الوظيفي">
                <Select
                  value={userForm.customRoleId}
                  onChange={(e) => setUserForm({ ...userForm, customRoleId: e.target.value })}
                  disabled={
                    editingUser.uid === 'owner_0559786939' ||
                    editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER
                  }
                >
                  {mergedRoles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>{r.nameAr}</option>
                  ))}
                </Select>
              </FormField>

              <div className="sm:col-span-2 flex items-center pt-1">
                <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    disabled={
                      editingUser.uid === 'owner_0559786939' ||
                      editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER
                    }
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
                <div className="space-y-4 border-t border-slate-200 dark:border-slate-800 pt-2.5">
                  <div className="max-h-56 overflow-y-auto erp-scroll">
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

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      استثناءات القدرات الخاصة (Granular Capabilities)
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(() => {
                        const previewCaps = resolveEffectiveCapabilities(
                          {
                            ...editingUser,
                            customRoleId: userForm.customRoleId,
                            active: userForm.active,
                            capabilityOverrides: userForm.capabilityOverrides,
                          },
                          mergedRoles
                        );
                        return GRANULAR_CAPABILITIES.map((cap) => (
                          <label key={cap.key} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={editingUser.email.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL_LOWER}
                              checked={Boolean(previewCaps[cap.key])}
                              onChange={(e) =>
                                setUserForm({
                                  ...userForm,
                                  capabilityOverrides: {
                                    ...userForm.capabilityOverrides,
                                    [cap.key]: e.target.checked,
                                  },
                                })
                              }
                            />
                            <span className="font-medium text-slate-800 dark:text-slate-200">{cap.labelAr}</span>
                          </label>
                        ));
                      })()}
                    </div>
                  </div>
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

      {/* CREATE NEW USER DRAWER */}
      <SlideDrawer
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        size="lg"
        title="إضافة مستخدم جديد للنظام"
        subtitle="إنشاء حساب دخول برقم الجوال وكلمة المرور مع تحديد الدور الوظيفي ونطاق البيانات"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateUserOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              form="rbac-create-user-form"
              variant="primary"
              loading={busy}
              disabled={busy}
              icon={<UserPlus className="h-4 w-4" />}
            >
              {busy ? 'جاري الإنشاء...' : 'إنشاء المستخدم'}
            </Button>
          </>
        }
      >
        <form id="rbac-create-user-form" onSubmit={(e) => void handleCreateUser(e)} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="الاسم الكامل" required>
              <Input
                type="text"
                required
                value={newUserForm.displayName}
                onChange={(e) => setNewUserForm({ ...newUserForm, displayName: e.target.value })}
                placeholder="مثال: أحمد العتيبي"
              />
            </FormField>

            <FormField label="رقم الجوال (لتسجيل الدخول)" required>
              <Input
                type="tel"
                inputMode="tel"
                dir="ltr"
                required
                className="font-mono-num text-left"
                value={newUserForm.phone}
                onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                placeholder="05XXXXXXXX"
              />
            </FormField>

            <FormField label="كلمة المرور" required hint="4 أحرف أو أرقام على الأقل">
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  dir="ltr"
                  required
                  minLength={4}
                  className="font-mono-num text-left pl-9"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  placeholder="••••"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNewPassword((p) => !p)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </FormField>

            <FormField label="قالب الدور الوظيفي (الصلاحيات)" required>
              <Select
                value={newUserForm.customRoleId}
                onChange={(e) => setNewUserForm({ ...newUserForm, customRoleId: e.target.value })}
              >
                {mergedRoles.map((r) => (
                  <option key={r.roleId} value={r.roleId}>
                    {r.nameAr}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="البريد الإلكتروني (اختياري)">
              <Input
                type="email"
                dir="ltr"
                className="font-mono-num text-left"
                value={newUserForm.email}
                onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                placeholder="user@company.com"
              />
            </FormField>

            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newUserForm.active}
                  onChange={(e) => setNewUserForm({ ...newUserForm, active: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                />
                <span>تفعيل الحساب فورًا للسماح بالدخول</span>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                <Sliders className="h-3.5 w-3.5" />
                <span>نطاق البيانات المسموح بها (Data Scope)</span>
              </span>
              <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newUserForm.dataScope.allBranches}
                  onChange={(e) =>
                    setNewUserForm({
                      ...newUserForm,
                      dataScope: { ...newUserForm.dataScope, allBranches: e.target.checked },
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                />
                <span>الوصول لجميع الفروع</span>
              </label>
            </div>

            {!newUserForm.dataScope.allBranches && (
              <div>
                <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">تحديد الفروع:</div>
                <div className="flex flex-wrap gap-2">
                  {branches.map((br) => {
                    const checked = newUserForm.dataScope.branches.includes(br);
                    return (
                      <label key={br} className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...newUserForm.dataScope.branches, br]
                              : newUserForm.dataScope.branches.filter((x) => x !== br);
                            setNewUserForm({ ...newUserForm, dataScope: { ...newUserForm.dataScope, branches: next } });
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

            <div>
              <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5">المنصات المسموح بها:</div>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map((plat) => {
                  const checked = newUserForm.dataScope.platforms.includes(plat.platformId);
                  return (
                    <label key={plat.platformId} className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...newUserForm.dataScope.platforms, plat.platformId]
                            : newUserForm.dataScope.platforms.filter((x) => x !== plat.platformId);
                          setNewUserForm({ ...newUserForm, dataScope: { ...newUserForm.dataScope, platforms: next } });
                        }}
                      />
                      <span>{plat.nameAr}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </form>
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteUserTarget)}
        title="تأكيد حذف حساب المستخدم"
        description={
          deleteUserTarget
            ? `هل تريد حذف حساب المستخدم "${deleteUserTarget.displayName}" (${deleteUserTarget.phone || deleteUserTarget.email}) نهائيًا؟ لن يتمكن من تسجيل الدخول بعد الحذف.`
            : ''
        }
        danger
        busy={busy}
        onCancel={() => setDeleteUserTarget(null)}
        onConfirm={() => void handleConfirmDeleteUser()}
      />
    </div>
  );
}
