import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from '../lib/erpDb';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { evaluatePlatformAccountAutoLink, writeErpAuditLog } from '../lib/erpHelpers';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { FleetDataset } from '../lib/fleetAnalytics';
import { getMergedPlatformCatalog, hasPermission, isKeetaActive } from '../shared/rbacCore';
import type {
  OperationalSettings,
  PlatformAccount,
  PlatformAccountStatus,
  PlatformCatalogEntry,
  RiderMaster,
  RoleTemplate,
  UserProfile,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { KpiCard } from './KpiCard';
import {
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  Tabs,
  Textarea,
  ToastBanner,
  type BadgeTone,
} from './ui/EnterpriseUI';

export type AppsSubTab = 'apps_active' | 'apps_accounts' | 'apps_linking';

interface ApplicationsModuleProps {
  platformCatalog: PlatformCatalogEntry[];
  platformAccounts: PlatformAccount[];
  riders: RiderMaster[];
  dataset: FleetDataset;
  settings: OperationalSettings;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  allowedUids: string[];
  initialSubTab?: AppsSubTab;
  onOpenRider360: (internalRiderId: string) => void;
  onGoToPlatformFlagSettings?: () => void;
  onRefresh: () => Promise<void>;
}

const ACCOUNT_STATUS_META: Record<PlatformAccountStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'نشط', tone: 'success' },
  suspended: { label: 'موقوف', tone: 'warning' },
  inactive: { label: 'مفصول / منتهي', tone: 'danger' },
};

const LINK_STATUS_META: Record<PlatformAccount['linkingStatus'], { label: string; tone: BadgeTone }> = {
  linked: { label: 'مربوط مؤكد', tone: 'success' },
  unlinked: { label: 'غير مربوط بسجلات', tone: 'neutral' },
  conflict_review: { label: 'تعارض يحتاج اعتماد', tone: 'danger' },
};

export function ApplicationsModule({
  platformCatalog,
  platformAccounts,
  riders,
  dataset,
  settings,
  currentUser,
  roleTemplates,
  allowedUids,
  initialSubTab = 'apps_active',
  onOpenRider360,
  onGoToPlatformFlagSettings,
  onRefresh,
}: ApplicationsModuleProps) {
  const [subTab, setSubTab] = useState<AppsSubTab>(initialSubTab);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [linkFilter, setLinkFilter] = useState<'all' | PlatformAccount['linkingStatus']>('all');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PlatformAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformAccount | null>(null);

  const [form, setForm] = useState({
    companyRiderId: '',
    platformId: 'hungerstation',
    platformRiderId: '',
    startDate: new Date().toISOString().slice(0, 10),
    deactivationDate: '',
    accountStatus: 'active' as PlatformAccountStatus,
    branch: '',
    city: '',
    supervisor: '',
    vehicleType: '',
    notes: '',
  });

  const canAdd = hasPermission(currentUser, roleTemplates, 'applications', 'add');
  const canEdit = hasPermission(currentUser, roleTemplates, 'applications', 'edit');
  const canDelete = hasPermission(currentUser, roleTemplates, 'applications', 'delete');
  const canApprove = hasPermission(currentUser, roleTemplates, 'applications', 'approve');
  const canManagePlatforms = hasPermission(currentUser, roleTemplates, 'platforms', 'edit');

  const keetaActive = isKeetaActive(settings, platformCatalog);

  // Respect Keeta Feature Flag: hide Keeta completely from visible platforms and visible accounts when inactive
  const mergedCatalog = useMemo(() => {
    const all = getMergedPlatformCatalog(platformCatalog, settings);
    return all.filter((p) => (p.platformId === 'keeta' ? keetaActive : !p.hiddenFromUi));
  }, [platformCatalog, settings, keetaActive]);

  const visibleAccounts = useMemo(() => {
    return platformAccounts.filter((a) => (a.platformId.toLowerCase() === 'keeta' ? keetaActive : true));
  }, [platformAccounts, keetaActive]);

  const riderById = useMemo(() => new Map(riders.map((r) => [r.internalRiderId, r])), [riders]);

  // Historical platform rider IDs in imported data not yet registered in Platform Accounts
  const unlinkedHistoricalIds = useMemo(() => {
    const registeredHs = new Set(
      visibleAccounts.filter((a) => a.platformId.toLowerCase() === 'hungerstation').map((a) => a.platformRiderId.trim())
    );
    const hsSet = new Set<string>();
    for (const r of dataset.hungerDaily) {
      if (!registeredHs.has(r.riderId.trim())) hsSet.add(r.riderId.trim());
    }
    const items: Array<{ platformId: string; platformName: string; platformRiderId: string; rowCount: number }> = [];
    hsSet.forEach((rid) => {
      items.push({
        platformId: 'hungerstation',
        platformName: 'هنقرستيشن (HungerStation)',
        platformRiderId: rid,
        rowCount: dataset.hungerDaily.filter((r) => r.riderId.trim() === rid).length,
      });
    });

    if (keetaActive) {
      const registeredKt = new Set(
        visibleAccounts.filter((a) => a.platformId.toLowerCase() === 'keeta').map((a) => a.platformRiderId.trim())
      );
      const ktSet = new Set<string>();
      for (const r of dataset.keetaDashboardDaily) {
        if (!registeredKt.has(r.riderId.trim())) ktSet.add(r.riderId.trim());
      }
      ktSet.forEach((rid) => {
        items.push({
          platformId: 'keeta',
          platformName: 'كيتا (Keeta)',
          platformRiderId: rid,
          rowCount: dataset.keetaDashboardDaily.filter((r) => r.riderId.trim() === rid).length,
        });
      });
    }
    return items.sort((a, b) => b.rowCount - a.rowCount);
  }, [visibleAccounts, dataset.hungerDaily, dataset.keetaDashboardDaily, keetaActive]);

  const filteredAccounts = useMemo(() => {
    return visibleAccounts.filter((a) => {
      if (platformFilter !== 'all' && a.platformId !== platformFilter) return false;
      if (linkFilter !== 'all' && a.linkingStatus !== linkFilter) return false;
      return true;
    });
  }, [visibleAccounts, platformFilter, linkFilter]);

  const conflictAccounts = useMemo(
    () => visibleAccounts.filter((a) => a.linkingStatus === 'conflict_review'),
    [visibleAccounts]
  );

  const openCreateAccount = (presetPlatformId = 'hungerstation', presetPlatformRiderId = '') => {
    setEditingAccount(null);
    setForm({
      companyRiderId: riders[0]?.internalRiderId || '',
      platformId: presetPlatformId,
      platformRiderId: presetPlatformRiderId,
      startDate: new Date().toISOString().slice(0, 10),
      deactivationDate: '',
      accountStatus: 'active',
      branch: riders[0]?.branch || '',
      city: riders[0]?.city || '',
      supervisor: riders[0]?.supervisor || '',
      vehicleType: riders[0]?.vehicleType || '',
      notes: '',
    });
    setAccountModalOpen(true);
  };

  const openEditAccount = (acc: PlatformAccount) => {
    setEditingAccount(acc);
    setForm({
      companyRiderId: acc.companyRiderId,
      platformId: acc.platformId,
      platformRiderId: acc.platformRiderId,
      startDate: acc.startDate || '',
      deactivationDate: acc.deactivationDate || '',
      accountStatus: acc.accountStatus,
      branch: acc.branch || '',
      city: acc.city || '',
      supervisor: acc.supervisor || '',
      vehicleType: acc.vehicleType || '',
      notes: acc.notes || '',
    });
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAccount && !canEdit) return;
    if (!editingAccount && !canAdd) return;
    if (!form.platformRiderId.trim()) {
      setToast({ type: 'err', msg: 'معرّف المندوب على المنصة مطلوب.' });
      return;
    }

    const platformMeta = mergedCatalog.find((p) => p.platformId === form.platformId);
    const linkEval = evaluatePlatformAccountAutoLink({
      platformId: form.platformId,
      platformRiderId: form.platformRiderId,
      companyRiderId: form.companyRiderId,
      existingAccounts: platformAccounts,
      dataset,
      ignoreAccountId: editingAccount?.accountId,
    });

    setBusy(true);
    setToast(null);
    try {
      const accountId =
        editingAccount?.accountId ||
        `acc_${form.platformId}_${form.platformRiderId.trim().replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const rider = riderById.get(form.companyRiderId);

      const payload: Record<string, unknown> = {
        accountId,
        companyRiderId: form.companyRiderId,
        platformId: form.platformId,
        platformName: platformMeta?.nameAr || platformMeta?.name || form.platformId,
        platformRiderId: form.platformRiderId.trim().slice(0, 64),
        accountStatus: form.accountStatus,
        linkingStatus: linkEval.linkingStatus,
        branch: (form.branch || rider?.branch || '').slice(0, 100),
        city: (form.city || rider?.city || '').slice(0, 100),
        supervisor: (form.supervisor || rider?.supervisor || '').slice(0, 100),
        vehicleType: (form.vehicleType || rider?.vehicleType || '').slice(0, 64),
        createdByUid: editingAccount?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
      };
      if (form.startDate) payload.startDate = form.startDate;
      if (form.deactivationDate) payload.deactivationDate = form.deactivationDate;
      if (form.notes) payload.notes = form.notes.slice(0, 800);
      if (linkEval.conflictCandidateRiderIds.length > 0) {
        payload.conflictCandidateRiderIds = linkEval.conflictCandidateRiderIds;
      }

      const ref = doc(db, 'platformAccounts', accountId);
      if (editingAccount) {
        await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() }).catch((err) =>
          handleFirestoreError(err, OperationType.UPDATE, `platformAccounts/${accountId}`)
        );
      } else {
        await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch((err) =>
          handleFirestoreError(err, OperationType.CREATE, `platformAccounts/${accountId}`)
        );
      }

      // Sync lightweight riderIdentityMapping when confirmed linked to hungerstation/keeta
      if (
        linkEval.linkingStatus === 'linked' &&
        form.companyRiderId &&
        (form.platformId === 'hungerstation' || form.platformId === 'keeta')
      ) {
        const mapId = `${form.platformId}_${form.platformRiderId.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        await setDoc(doc(db, 'riderIdentityMapping', mapId), {
          mappingId: mapId,
          internalRiderId: form.companyRiderId,
          platform: form.platformId,
          platformRiderId: form.platformRiderId.trim(),
          platformRiderName: rider?.fullName || form.platformRiderId.trim(),
          createdByUid: currentUser.uid,
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      await writeErpAuditLog({
        action: editingAccount ? 'PLATFORM_ACCOUNT_UPDATED' : 'PLATFORM_ACCOUNT_CREATED',
        targetCollection: 'platformAccounts',
        targetId: accountId,
        entityType: 'platform_account',
        details: `${editingAccount ? 'تحديث' : 'إضافة'} حساب منصة ${payload.platformName} (${payload.platformRiderId}) للمندوب ${form.companyRiderId || 'غير محدد'} — حالة الربط: ${LINK_STATUS_META[linkEval.linkingStatus].label}`,
        oldValue: editingAccount ? { companyRiderId: editingAccount.companyRiderId, status: editingAccount.accountStatus } : undefined,
        newValue: { companyRiderId: form.companyRiderId, platformRiderId: form.platformRiderId, linkingStatus: linkEval.linkingStatus },
        user: currentUser,
        allowedUids,
      });

      setAccountModalOpen(false);
      setToast({
        type: linkEval.linkingStatus === 'conflict_review' ? 'err' : 'ok',
        msg: linkEval.reason,
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ حساب المنصة.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRunAutoLinkScan = async () => {
    if (!canEdit && !canApprove) return;
    setBusy(true);
    let updatedCount = 0;
    try {
      for (const acc of visibleAccounts) {
        const res = evaluatePlatformAccountAutoLink({
          platformId: acc.platformId,
          platformRiderId: acc.platformRiderId,
          companyRiderId: acc.companyRiderId,
          existingAccounts: platformAccounts,
          dataset,
          ignoreAccountId: acc.accountId,
        });
        if (res.linkingStatus !== acc.linkingStatus) {
          await updateDoc(doc(db, 'platformAccounts', acc.accountId), {
            linkingStatus: res.linkingStatus,
            conflictCandidateRiderIds: res.conflictCandidateRiderIds,
            updatedAt: serverTimestamp(),
          });
          updatedCount++;
        }
      }
      await writeErpAuditLog({
        action: 'PLATFORM_AUTOLINK_SCAN',
        targetCollection: 'platformAccounts',
        targetId: 'batch_scan',
        entityType: 'platform_account',
        details: `تشغيل محرك الربط الحتمي على ${visibleAccounts.length} حساب وتحديث ${updatedCount} حالة`,
        user: currentUser,
        allowedUids,
      });
      setToast({ type: 'ok', msg: `اكتمل الفحص الحتمي: تم تحديث ${updatedCount} حساب وفق المعرّفات الدقيقة فقط.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر تشغيل فحص الربط.' });
    } finally {
      setBusy(false);
    }
  };

  const handleResolveConflict = async (acc: PlatformAccount) => {
    if (!canApprove) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'platformAccounts', acc.accountId), {
        linkingStatus: 'linked',
        conflictCandidateRiderIds: [],
        updatedAt: serverTimestamp(),
      });
      await writeErpAuditLog({
        action: 'PLATFORM_CONFLICT_APPROVED',
        targetCollection: 'platformAccounts',
        targetId: acc.accountId,
        entityType: 'platform_account',
        details: `اعتماد ربط حساب ${acc.platformName} (${acc.platformRiderId}) للمندوب ${acc.companyRiderId} بعد مراجعة التعارض`,
        oldValue: 'conflict_review',
        newValue: 'linked',
        user: currentUser,
        allowedUids,
      });
      setToast({ type: 'ok', msg: `تم اعتماد الربط وإغلاق حالة التعارض لحساب ${acc.platformRiderId}.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل اعتماد الربط.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteTarget || !canDelete) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'platformAccounts', deleteTarget.accountId));
      await writeErpAuditLog({
        action: 'PLATFORM_ACCOUNT_DELETED',
        targetCollection: 'platformAccounts',
        targetId: deleteTarget.accountId,
        entityType: 'platform_account',
        details: `حذف حساب ${deleteTarget.platformName} (${deleteTarget.platformRiderId})`,
        oldValue: deleteTarget,
        user: currentUser,
        allowedUids,
      });
      setDeleteTarget(null);
      setToast({ type: 'ok', msg: 'تم حذف حساب المنصة.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حذف الحساب.' });
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<PlatformAccount>[] = [
    {
      key: 'platform',
      header: 'التطبيق / المنصة',
      sortValue: (a) => a.platformName,
      render: (a) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{a.platformName}</div>
          <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">ID: {a.platformRiderId}</div>
        </div>
      ),
    },
    {
      key: 'rider',
      header: 'المندوب المرتبط (الشركة)',
      sortValue: (a) => a.companyRiderId,
      render: (a) => {
        const rider = riderById.get(a.companyRiderId);
        return a.companyRiderId ? (
          <button
            type="button"
            onClick={() => onOpenRider360(a.companyRiderId)}
            className="text-right hover:underline"
          >
            <div className="font-semibold text-blue-700 dark:text-blue-400">{rider?.fullName || a.companyRiderId}</div>
            <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">{a.companyRiderId}</div>
          </button>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-400">غير معين لمندوب</span>
        );
      },
    },
    {
      key: 'scope',
      header: 'الفرع / المشرف / المركبة',
      render: (a) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {[a.branch, a.city, a.supervisor, a.vehicleType].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'dates',
      header: 'تاريخ البدء / الإيقاف',
      render: (a) => (
        <div className="font-mono-num text-xs">
          <div>بدء: {a.startDate || '—'}</div>
          {a.deactivationDate && <div className="text-red-600 dark:text-red-400">إيقاف: {a.deactivationDate}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'حالة الحساب',
      sortValue: (a) => a.accountStatus,
      render: (a) => <StatusBadge label={ACCOUNT_STATUS_META[a.accountStatus].label} tone={ACCOUNT_STATUS_META[a.accountStatus].tone} />,
    },
    {
      key: 'linking',
      header: 'حالة الربط الحتمي',
      sortValue: (a) => a.linkingStatus,
      render: (a) => <StatusBadge label={LINK_STATUS_META[a.linkingStatus].label} tone={LINK_STATUS_META[a.linkingStatus].tone} />,
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (a) => (
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => openEditAccount(a)}>
              تعديل
            </Button>
          )}
          {a.linkingStatus === 'conflict_review' && canApprove && (
            <Button size="sm" variant="accent" onClick={() => void handleResolveConflict(a)}>
              اعتماد الربط
            </Button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteTarget(a)}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              aria-label="حذف"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة التطبيقات والمنصات وحسابات المندوبين"
        subtitle="ربط المناديب بمنصات التوصيل عبر معرفات حتمية دقيقة · عزل ومنع اختلاط البيانات · إدارة الحسابات النشطة والموقوفة"
        actions={
          <>
            {canManagePlatforms && onGoToPlatformFlagSettings && (
              <Button variant="secondary" onClick={onGoToPlatformFlagSettings} icon={<Settings className="h-3.5 w-3.5" />}>
                إعدادات المنصات والأعلام
              </Button>
            )}
            {(canEdit || canApprove) && (
              <Button
                variant="secondary"
                onClick={() => void handleRunAutoLinkScan()}
                disabled={busy}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                فحص الربط التلقائي
              </Button>
            )}
            {canAdd && (
              <Button variant="primary" onClick={() => openCreateAccount()} icon={<Plus className="h-4 w-4" />}>
                إضافة حساب تطبيق
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void onRefresh()}
              disabled={busy}
              icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
            >
              تحديث
            </Button>
          </>
        }
      />

      <Tabs
        variant="underline"
        activeKey={subTab}
        onChange={(k) => setSubTab(k)}
        items={[
          { key: 'apps_active', label: 'المنصات والتطبيقات المتاحة', icon: <Smartphone className="h-3.5 w-3.5" /> },
          { key: 'apps_accounts', label: 'حسابات المندوبين', count: visibleAccounts.length, icon: <Link2 className="h-3.5 w-3.5" /> },
          {
            key: 'apps_linking',
            label: 'المطابقة والتعارضات',
            count: conflictAccounts.length + unlinkedHistoricalIds.length,
            icon: <AlertTriangle className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      {/* TAB 1: ACTIVE PLATFORMS */}
      {subTab === 'apps_active' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="التطبيقات الظاهرة في النظام"
              value={String(mergedCatalog.length)}
              subtext={`مفعّل: ${mergedCatalog.filter((p) => p.enabled).length}`}
            />
            <KpiCard
              label="إجمالي الحسابات المسجلة"
              value={String(visibleAccounts.length)}
              subtext={`نشط: ${visibleAccounts.filter((a) => a.accountStatus === 'active').length}`}
              tone="good"
            />
            <KpiCard
              label="معرّفات تاريخية غير مربوطة"
              value={String(unlinkedHistoricalIds.length)}
              subtext="تظهر في تقارير Excel المستوردة"
              tone={unlinkedHistoricalIds.length > 0 ? 'warn' : 'good'}
              onClick={() => setSubTab('apps_linking')}
            />
            <KpiCard
              label="حسابات في قائمة التعارض"
              value={String(conflictAccounts.length)}
              subtext="تتطلب اعتماد مسؤول"
              tone={conflictAccounts.length > 0 ? 'critical' : 'good'}
              onClick={() => setSubTab('apps_linking')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mergedCatalog.map((plat) => {
              const platAccounts = visibleAccounts.filter((a) => a.platformId === plat.platformId);
              const activeCount = platAccounts.filter((a) => a.accountStatus === 'active').length;
              return (
                <Card key={plat.platformId} className="flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[15px] font-bold text-slate-900 dark:text-slate-100">
                        {plat.nameAr} <span className="text-xs font-normal text-slate-500">({plat.name})</span>
                      </div>
                      <StatusBadge label={plat.enabled ? 'مفعّلة' : 'موقوفة'} tone={plat.enabled ? 'success' : 'neutral'} />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {plat.description || 'منصة توصيل مرتبطة بالنظام'}
                    </p>
                    <div className="mt-3 text-xs font-mono-num text-slate-700 dark:text-slate-300">
                      الحسابات: {platAccounts.length} · النشطة: {activeCount} · الاستيراد: {plat.supportsExcelImport ? 'Excel تلقائي' : 'يدوي'}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPlatformFilter(plat.platformId);
                        setSubTab('apps_accounts');
                      }}
                    >
                      عرض الحسابات
                    </Button>
                    {canAdd && plat.enabled && (
                      <Button size="sm" variant="primary" onClick={() => openCreateAccount(plat.platformId)}>
                        + ربط حساب
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: ACCOUNTS DIRECTORY */}
      {subTab === 'apps_accounts' && (
        <DataTable
          rows={filteredAccounts}
          columns={columns}
          rowKey={(a) => a.accountId}
          searchPlaceholder="ابحث برقم المندوب على المنصة، رقم الشركة، الاسم، أو الفرع..."
          searchText={(a) =>
            `${a.platformName} ${a.platformRiderId} ${a.companyRiderId} ${riderById.get(a.companyRiderId)?.fullName || ''} ${a.branch || ''}`
          }
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="h-8 w-44"
              >
                <option value="all">جميع المنصات المتاحة</option>
                {mergedCatalog.map((p) => (
                  <option key={p.platformId} value={p.platformId}>
                    {p.nameAr}
                  </option>
                ))}
              </Select>
              <Select
                value={linkFilter}
                onChange={(e) => setLinkFilter(e.target.value as 'all' | PlatformAccount['linkingStatus'])}
                className="h-8 w-44"
              >
                <option value="all">كل حالات الربط</option>
                <option value="linked">مربوط مؤكد</option>
                <option value="unlinked">غير مربوط بسجلات</option>
                <option value="conflict_review">تعارض يحتاج مراجعة</option>
              </Select>
            </div>
          }
        />
      )}

      {/* TAB 3: LINKING CONFLICTS & UNLINKED HISTORICAL IDS */}
      {subTab === 'apps_linking' && (
        <div className="space-y-5">
          {conflictAccounts.length > 0 && (
            <Card className="border-red-200 dark:border-red-900">
              <SectionHeader
                title="تعارضات المعرّفات (يتطلب اعتماد المسؤول)"
                subtitle="معرّفات منصات ظهر لها ارتباط مسبق بأكثر من مندوب شركة"
              />
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {conflictAccounts.map((acc) => (
                  <div key={acc.accountId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {acc.platformName} · ID: <span className="font-mono-num">{acc.platformRiderId}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        مقترح لـ {acc.companyRiderId} · يتعارض مع: {(acc.conflictCandidateRiderIds || []).join(' ، ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <Button size="sm" variant="secondary" onClick={() => openEditAccount(acc)}>
                          تعديل التعيين
                        </Button>
                      )}
                      {canApprove && (
                        <Button size="sm" variant="accent" onClick={() => void handleResolveConflict(acc)}>
                          اعتماد وتأكيد الربط
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionHeader
              title={`معرفات منصات ظهرت في تقارير Excel ولم تُربط بحساب شركة بعد (${unlinkedHistoricalIds.length})`}
              subtitle="وفق قواعد النزاهة المعمارية، لا يتم ربط أي معرّف بالاسم فقط؛ اختر المندوب لربطه بالمعرّف الدقيق."
            />
            <div className="mt-4">
              {unlinkedHistoricalIds.length === 0 ? (
                <EmptyState
                  title="جميع المعرفات مربوطة"
                  subtitle="لا توجد معرّفات غير مربوطة في تقارير المنصات المستوردة."
                />
              ) : (
                <DataTable
                  rows={unlinkedHistoricalIds}
                  rowKey={(r) => `${r.platformId}_${r.platformRiderId}`}
                  searchPlaceholder="ابحث برقم المندوب على المنصة..."
                  searchText={(r) => `${r.platformName} ${r.platformRiderId}`}
                  columns={[
                    {
                      key: 'plat',
                      header: 'المنصة',
                      render: (r) => <span className="font-semibold text-xs">{r.platformName}</span>,
                    },
                    {
                      key: 'pid',
                      header: 'معرف المنصة',
                      sortValue: (r) => r.platformRiderId,
                      render: (r) => <span className="font-mono-num font-bold text-xs">{r.platformRiderId}</span>,
                    },
                    {
                      key: 'cnt',
                      header: 'عدد السجلات المستوردة',
                      sortValue: (r) => r.rowCount,
                      render: (r) => <span className="font-mono-num text-xs">{r.rowCount}</span>,
                    },
                    {
                      key: 'act',
                      header: 'الإجراء',
                      render: (r) =>
                        canAdd ? (
                          <Button size="sm" variant="primary" onClick={() => openCreateAccount(r.platformId, r.platformRiderId)}>
                            ربط بملف مندوب
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">عرض فقط</span>
                        ),
                    },
                  ]}
                />
              )}
            </div>
          </Card>
        </div>
      )}

      {/* RTL SLIDE-OVER DRAWER: ADD / EDIT ACCOUNT */}
      <SlideDrawer
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        title={editingAccount ? 'تعديل حساب تطبيق' : 'ربط / إضافة حساب تطبيق جديد'}
        subtitle="سيتم تقييم الربط الحتمي تلقائيًا عبر المعرف الدقيق عند الحفظ"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccountModalOpen(false)} disabled={busy}>
              إلغاء
            </Button>
            <Button type="submit" form="app-account-form" variant="primary" loading={busy}>
              حفظ الحساب وتقييم الربط
            </Button>
          </>
        }
      >
        <form id="app-account-form" onSubmit={(e) => void handleSaveAccount(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="المندوب (رقم الشركة)" required>
              <Select
                required
                value={form.companyRiderId}
                onChange={(e) => {
                  const r = riderById.get(e.target.value);
                  setForm({
                    ...form,
                    companyRiderId: e.target.value,
                    branch: form.branch || r?.branch || '',
                    city: form.city || r?.city || '',
                    supervisor: form.supervisor || r?.supervisor || '',
                    vehicleType: form.vehicleType || r?.vehicleType || '',
                  });
                }}
              >
                <option value="">-- اختر المندوب --</option>
                {riders.map((r) => (
                  <option key={r.internalRiderId} value={r.internalRiderId}>
                    {r.fullName} ({r.internalRiderId})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="المنصة / التطبيق" required>
              <Select required value={form.platformId} onChange={(e) => setForm({ ...form, platformId: e.target.value })}>
                {mergedCatalog.map((p) => (
                  <option key={p.platformId} value={p.platformId}>
                    {p.nameAr} ({p.name})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="معرّف المندوب على المنصة" required>
              <Input
                type="text"
                required
                className="font-mono-num"
                value={form.platformRiderId}
                onChange={(e) => setForm({ ...form, platformRiderId: e.target.value })}
              />
            </FormField>

            <FormField label="حالة الحساب">
              <Select
                value={form.accountStatus}
                onChange={(e) => setForm({ ...form, accountStatus: e.target.value as PlatformAccountStatus })}
              >
                <option value="active">نشط</option>
                <option value="suspended">موقوف</option>
                <option value="inactive">مفصول / منتهي</option>
              </Select>
            </FormField>

            <FormField label="تاريخ التفعيل">
              <Input
                type="date"
                className="font-mono-num"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </FormField>

            <FormField label="تاريخ الإيقاف">
              <Input
                type="date"
                className="font-mono-num"
                value={form.deactivationDate}
                onChange={(e) => setForm({ ...form, deactivationDate: e.target.value })}
              />
            </FormField>

            <FormField label="الفرع">
              <Input type="text" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </FormField>

            <FormField label="المشرف">
              <Input type="text" value={form.supervisor} onChange={(e) => setForm({ ...form, supervisor: e.target.value })} />
            </FormField>
          </div>

          <FormField label="ملاحظات">
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
        </form>
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="حذف حساب المنصة"
        description={`هل تريد حذف حساب ${deleteTarget?.platformName || ''} (${deleteTarget?.platformRiderId || ''})؟`}
        danger
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteAccount()}
      />
    </div>
  );
}
