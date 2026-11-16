import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from '../lib/erpDb';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  buildEffectiveFormSchema,
  canViewDynamicField,
  formatDynamicFieldDisplayValue,
  sanitizeCustomFieldsForFirestore,
  validateDynamicFormValues,
} from '../lib/dynamicSchemaEngine';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { db } from '../lib/firebase';
import { hasCapability, mapLegacyRoleToTemplateId } from '../shared/rbacCore';
import type {
  CustomEntityRecord,
  DynamicFieldDefinition,
  DynamicFormDefinition,
  SavedViewConfig,
  SystemPageConfig,
  UserProfile,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
import { KpiCard } from './KpiCard';
import { SavedViewsBar } from './SavedViewsBar';
import {
  Button,
  FormField,
  Input,
  PageHeader,
  Select,
  SlideDrawer,
  StatusBadge,
  ToastBanner,
} from './ui/EnterpriseUI';

interface CustomPageModuleProps {
  page: SystemPageConfig;
  records: CustomEntityRecord[];
  dynamicFields: DynamicFieldDefinition[];
  dynamicForms: DynamicFormDefinition[];
  savedViews: SavedViewConfig[];
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}

const RECORD_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  draft: 'مسودة',
  archived: 'مؤرشف',
};

export function CustomPageModule({
  page,
  records,
  dynamicFields,
  dynamicForms,
  savedViews,
  currentUser,
  allowedUids,
  onRefresh,
}: CustomPageModuleProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'archived'>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CustomEntityRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomEntityRecord | null>(null);
  const [titleAr, setTitleAr] = useState('');
  const [recordStatus, setRecordStatus] = useState<'active' | 'draft' | 'archived'>('active');
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const userRoleKey = currentUser.customRoleId || mapLegacyRoleToTemplateId(currentUser.role);
  const isPrivileged = currentUser.role === 'owner' || currentUser.role === 'admin';
  const canEdit =
    isPrivileged ||
    !page.allowedRoles?.length ||
    page.allowedRoles.includes(userRoleKey) ||
    page.allowedRoles.includes(currentUser.role);
  const canArchiveOrDelete = isPrivileged || hasCapability(currentUser, [], 'archive');

  const formId = page.formId || page.pageId;
  const schema = useMemo(
    () => buildEffectiveFormSchema({ formId, dynamicForms, dynamicFields }),
    [formId, dynamicForms, dynamicFields]
  );

  const pageRecords = useMemo(
    () =>
      records
        .filter((r) => r.pageId === page.pageId)
        .filter((r) => statusFilter === 'all' || (r.status || 'active') === statusFilter),
    [records, page.pageId, statusFilter]
  );

  const allPageRecordsCount = useMemo(
    () => records.filter((r) => r.pageId === page.pageId).length,
    [records, page.pageId]
  );

  const openCreate = () => {
    setEditingRecord(null);
    setTitleAr('');
    setRecordStatus('active');
    setCustomValues({});
    setCustomErrors({});
    setDrawerOpen(true);
  };

  const openEdit = (rec: CustomEntityRecord) => {
    setEditingRecord(rec);
    setTitleAr(rec.title || '');
    setRecordStatus(rec.status === 'draft' || rec.status === 'archived' ? rec.status : 'active');
    setCustomValues(rec.customFields ? { ...rec.customFields } : {});
    setCustomErrors({});
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!titleAr.trim()) {
      setToast({ type: 'err', msg: 'عنوان السجل الأساسي مطلوب.' });
      return;
    }

    const activeFields = Array.from(schema.fieldsById.values());
    const dynErrs = validateDynamicFormValues(activeFields, schema.placements, customValues, currentUser);
    if (Object.keys(dynErrs).length > 0) {
      setCustomErrors(dynErrs);
      setToast({ type: 'err', msg: Object.values(dynErrs)[0] || 'يرجى استكمال الحقول المطلوبة.' });
      return;
    }
    setCustomErrors({});

    setBusy(true);
    setToast(null);
    try {
      const recordId = editingRecord?.recordId || `rec_${page.pageId}_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const cleanCustom = sanitizeCustomFieldsForFirestore(customValues);

      const payload: Record<string, unknown> = {
        recordId,
        pageId: page.pageId,
        formId,
        title: titleAr.trim().slice(0, 200),
        status: recordStatus,
        customFields: cleanCustom,
        createdByUid: editingRecord?.createdByUid || currentUser.uid,
        createdByEmail: editingRecord?.createdByEmail || currentUser.email,
        ...(editingRecord ? { updatedByEmail: currentUser.email } : {}),
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        updatedAt: serverTimestamp(),
      };

      if (editingRecord) {
        await updateDoc(doc(db, 'customEntityRecords', recordId), payload);
      } else {
        await setDoc(doc(db, 'customEntityRecords', recordId), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      await writeErpAuditLog({
        action: editingRecord ? 'CUSTOM_RECORD_UPDATED' : 'CUSTOM_RECORD_CREATED',
        targetCollection: 'customEntityRecords',
        targetId: recordId,
        entityType: page.pageId,
        details: `${editingRecord ? 'تعديل' : 'إضافة'} سجل في صفحة "${page.titleAr}": ${titleAr.trim()}`,
        user: currentUser,
        allowedUids,
      });

      setDrawerOpen(false);
      setToast({ type: 'ok', msg: `تم حفظ السجل "${titleAr.trim()}" بنجاح.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حفظ السجل.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!deleteTarget || !canArchiveOrDelete) return;
    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const trashId = `trash_crec_${deleteTarget.recordId}_${Date.now().toString(36)}`;
      await setDoc(doc(db, 'trashItems', trashId), {
        trashId,
        itemType: 'custom_record',
        sourceCollection: 'customEntityRecords',
        sourceDocId: deleteTarget.recordId,
        titleAr: `${page.titleAr}: ${deleteTarget.title || deleteTarget.recordId}`,
        snapshotJson: JSON.stringify(deleteTarget),
        deletedByUid: currentUser.uid,
        deletedByEmail: currentUser.email,
        status: 'deleted',
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'customEntityRecords', deleteTarget.recordId));
      await writeErpAuditLog({
        action: 'CUSTOM_RECORD_DELETED',
        targetCollection: 'customEntityRecords',
        targetId: deleteTarget.recordId,
        entityType: page.pageId,
        details: `نقل السجل "${deleteTarget.title}" من صفحة "${page.titleAr}" إلى سلة المحذوفات`,
        user: currentUser,
        allowedUids,
      });
      setDeleteTarget(null);
      setToast({ type: 'ok', msg: 'تم نقل السجل إلى سلة المحذوفات مع إمكانية الاسترجاع.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حذف السجل.' });
    } finally {
      setBusy(false);
    }
  };

  const visibleTableFields = useMemo(() => {
    const allowedSet = page.tableColumns?.length ? new Set(page.tableColumns) : null;
    return dynamicFields
      .filter((f) => f.formId === formId && !f.archived && canViewDynamicField(f, currentUser))
      .filter((f) => (allowedSet ? allowedSet.has(f.key) : f.showInTable !== false))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .slice(0, 8);
  }, [dynamicFields, formId, page.tableColumns, currentUser]);

  const columns: TableColumn<CustomEntityRecord>[] = [
    {
      key: 'title',
      header: 'العنوان / السجل',
      sortValue: (r) => r.title || r.recordId,
      render: (r) => (
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{r.title || 'بدون عنوان'}</div>
          <div className="font-mono-num text-[11px] text-slate-500">{r.recordId}</div>
        </div>
      ),
    },
    ...visibleTableFields.map(
      (f): TableColumn<CustomEntityRecord> => ({
        key: `cf_${f.key}`,
        header: f.labelAr,
        sortValue: (r) => String(r.customFields?.[f.key] ?? ''),
        render: (r) => (
          <span className="text-xs text-slate-700 dark:text-slate-200 font-mono-num">
            {formatDynamicFieldDisplayValue(f, r.customFields?.[f.key], r.customFields || {})}
          </span>
        ),
      })
    ),
    {
      key: 'status',
      header: 'الحالة',
      sortValue: (r) => r.status || 'active',
      render: (r) => (
        <StatusBadge
          label={RECORD_STATUS_LABELS[r.status || 'active'] || 'نشط'}
          tone={r.status === 'archived' ? 'neutral' : r.status === 'draft' ? 'warning' : 'success'}
        />
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>
              تعديل
            </Button>
          )}
          {canArchiveOrDelete && (
            <button
              type="button"
              onClick={() => setDeleteTarget(r)}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label="نقل للسلة"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={page.titleAr}
        subtitle={page.description || `${page.titleEn} · وحدة إدارية مخصصة من منشئ النظام`}
        actions={
          <>
            {canEdit && (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                إضافة سجل جديد
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
              onClick={() => void onRefresh()}
            >
              تحديث
            </Button>
          </>
        }
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="إجمالي السجلات" value={String(allPageRecordsCount)} />
        <KpiCard
          label="السجلات النشطة"
          value={String(records.filter((r) => r.pageId === page.pageId && (r.status || 'active') === 'active').length)}
          tone="good"
        />
        <KpiCard label="الحقول المربوطة بالصفحة" value={String(schema.fieldsById.size)} />
      </div>

      <SavedViewsBar
        scope={`custom_page_${page.pageId}`}
        user={currentUser}
        allowedUids={allowedUids}
        savedViews={savedViews}
        currentFilters={{ statusFilter }}
        onApplyView={(f) => {
          if (typeof f.statusFilter === 'string') {
            setStatusFilter(f.statusFilter as 'all' | 'active' | 'draft' | 'archived');
          }
        }}
        onChanged={onRefresh}
      />

      <DataTable
        tableId={`custom_page_${page.pageId}`}
        rows={pageRecords}
        columns={columns}
        rowKey={(r) => r.recordId}
        onRowClick={canEdit ? openEdit : undefined}
        searchPlaceholder="ابحث بالعنوان أو قيم الحقول المخصصة..."
        searchText={(r) => `${r.recordId} ${r.title || ''} ${Object.values(r.customFields || {}).join(' ')}`}
        emptyTitle="لا توجد سجلات بعد في هذه الصفحة"
        emptySubtitle="استخدم زر «إضافة سجل جديد» لإدخال البيانات أو أضف حقولًا لهذا النموذج من مركز التحكم والتخصيص."
        toolbarExtra={
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'draft' | 'archived')}
            className="!w-36"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="draft">مسودة</option>
            <option value="archived">مؤرشف</option>
          </Select>
        }
      />

      <SlideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title={editingRecord ? `تعديل: ${editingRecord.title}` : `إضافة سجل — ${page.titleAr}`}
        subtitle="يتم التحقق تلقائيًا من قواعد الإلزام والصيغ والبيانات حسب إعدادات منشئ النظام"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="custom-page-record-form" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
              {editingRecord ? 'حفظ التعديلات' : 'اعتماد وحفظ السجل'}
            </Button>
          </>
        }
      >
        <form id="custom-page-record-form" onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="عنوان السجل / المرجع" required className="sm:col-span-2">
              <Input
                type="text"
                required
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
                placeholder="أدخل اسم أو عنوان السجل..."
              />
            </FormField>
            <FormField label="حالة السجل">
              <Select value={recordStatus} onChange={(e) => setRecordStatus(e.target.value as 'active' | 'draft' | 'archived')}>
                <option value="active">نشط</option>
                <option value="draft">مسودة</option>
                <option value="archived">مؤرشف</option>
              </Select>
            </FormField>
          </div>

          <DynamicFieldsRenderer
            formId={formId}
            entityId={editingRecord?.recordId || 'custom_draft'}
            entityLabel={titleAr || page.titleAr}
            dynamicFields={dynamicFields}
            dynamicForms={dynamicForms}
            values={customValues}
            onChange={setCustomValues}
            user={currentUser}
            mode="form"
            errors={customErrors}
            contextValues={{ ...customValues }}
            title={`حقول ${page.titleAr}`}
          />
        </form>
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="نقل السجل إلى سلة المحذوفات"
        description={`سيتم نقل السجل "${deleteTarget?.title || ''}" إلى سلة المحذوفات ويمكن استعادته لاحقًا من مركز التحكم.`}
        danger
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleSoftDelete()}
      />
    </div>
  );
}
