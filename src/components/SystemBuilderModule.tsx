import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BellRing,
  BookOpen,
  Boxes,
  DatabaseBackup,
  Download,
  Eye,
  FileCode2,
  GripVertical,
  History,
  LayoutGrid,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  analyzeDynamicFieldImpact,
  BUILT_IN_FORMS_CATALOG,
  buildEffectiveFormSchema,
  DEFAULT_SYSTEM_SECTIONS,
  DYNAMIC_FIELD_TYPE_META,
  evaluateFormula,
  sanitizeFieldKey,
} from '../lib/dynamicSchemaEngine';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { auth, db } from '../lib/firebase';
import { safeParseJsonResponse } from '../lib/safeFetch';
import { hasCapability } from '../shared/rbacCore';
import type {
  AuditLog,
  CompanyBrandingDoc,
  ConfigSnapshotRecord,
  CustomEntityRecord,
  CustomReportTemplate,
  DynamicFieldDefinition,
  DynamicFieldType,
  DynamicFormDefinition,
  DynamicFormFieldPlacement,
  DynamicFormSection,
  DynamicFormVersion,
  EntityNoteTask,
  NotificationRuleConfig,
  OperationalCase,
  RiderMaster,
  RoleTemplate,
  SystemPageConfig,
  SystemSectionConfig,
  TrashItemRecord,
  UserProfile,
  VehicleAssignment,
  VehicleMaintenanceRecord,
  VehicleMaster,
} from '../types/fleet';
import { ConfirmModal } from './ConfirmModal';
import { DataTable, type TableColumn } from './DataTable';
import { DynamicFieldsRenderer } from './DynamicFieldsRenderer';
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
  type TabItem,
} from './ui/EnterpriseUI';

export type SystemBuilderTab =
  | 'fields'
  | 'forms'
  | 'sections_pages'
  | 'dictionary'
  | 'rules'
  | 'backup_audit'
  | 'trash'
  | 'health';

interface SystemBuilderModuleProps {
  dynamicFields: DynamicFieldDefinition[];
  dynamicForms: DynamicFormDefinition[];
  dynamicFormVersions: DynamicFormVersion[];
  systemSections: SystemSectionConfig[];
  systemPages: SystemPageConfig[];
  customEntityRecords: CustomEntityRecord[];
  notificationRules: NotificationRuleConfig[];
  trashItems: TrashItemRecord[];
  configSnapshots: ConfigSnapshotRecord[];
  customReportTemplates: CustomReportTemplate[];
  companyBranding: CompanyBrandingDoc;
  roleTemplates: RoleTemplate[];
  auditLogs: AuditLog[];
  riders: RiderMaster[];
  vehicles: VehicleMaster[];
  assignments: VehicleAssignment[];
  maintenance: VehicleMaintenanceRecord[];
  operationalCases: OperationalCase[];
  entityNotesTasks: EntityNoteTask[];
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  memoryMb: { rss: number; heapUsed: number };
  firestore: { ok: boolean; latencyMs: number };
  privateVault: { ok: boolean; fileCount: number; totalSizeMb: number };
  collections: Record<string, number>;
  recentImportBatchesCount: number;
}

export function SystemBuilderModule({
  dynamicFields,
  dynamicForms,
  dynamicFormVersions,
  systemSections,
  systemPages,
  customEntityRecords,
  notificationRules,
  trashItems,
  configSnapshots,
  customReportTemplates,
  companyBranding,
  roleTemplates,
  auditLogs,
  riders,
  vehicles,
  assignments,
  maintenance,
  operationalCases,
  entityNotesTasks,
  currentUser,
  allowedUids,
  onRefresh,
}: SystemBuilderModuleProps) {
  const [subTab, setSubTab] = useState<SystemBuilderTab>('fields');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const canCreateFields = hasCapability(currentUser, roleTemplates, 'create_fields') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canEditFields = hasCapability(currentUser, roleTemplates, 'edit_fields') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canManageForms = hasCapability(currentUser, roleTemplates, 'manage_forms') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canManageSections = hasCapability(currentUser, roleTemplates, 'manage_sections') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canManageSettings = hasCapability(currentUser, roleTemplates, 'manage_settings') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canRestoreTrash = hasCapability(currentUser, roleTemplates, 'restore') || currentUser.role === 'owner' || currentUser.role === 'admin';

  // Combined Forms List (Built-in + Custom Pages)
  const allForms = useMemo(() => {
    const customForms = systemPages.map((p) => ({
      formId: p.formId || p.pageId,
      nameAr: `صفحة مخصصة: ${p.titleAr}`,
      nameEn: p.titleEn,
      module: p.sectionId,
      targetEntity: 'customEntityRecords',
      description: p.descriptionAr || 'نموذج صفحة إدارية مخصصة',
      coreFields: [],
    }));
    return [...BUILT_IN_FORMS_CATALOG, ...customForms];
  }, [systemPages]);

  const effectiveSections = useMemo(() => {
    const map = new Map<string, SystemSectionConfig>();
    for (const def of DEFAULT_SYSTEM_SECTIONS) {
      map.set(def.sectionId, { ...def, createdByUid: currentUser.uid, allowedUids });
    }
    for (const s of systemSections) {
      map.set(s.sectionId, s);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order);
  }, [systemSections, currentUser.uid, allowedUids]);

  // -------------------------------------------------------
  // TAB 1: DYNAMIC FIELD BUILDER STATE & HANDLERS
  // -------------------------------------------------------
  const [selectedFormFilter, setSelectedFormFilter] = useState<string>('hr_rider');
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const [editingField, setEditingField] = useState<DynamicFieldDefinition | null>(null);
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<{ field: DynamicFieldDefinition; impactCount: number } | null>(null);

  const [fForm, setFForm] = useState({
    formId: 'hr_rider',
    key: '',
    labelAr: '',
    labelEn: '',
    type: 'short_text' as DynamicFieldType,
    placeholderAr: '',
    description: '',
    defaultValue: '',
    required: false,
    visible: true,
    editable: true,
    showInTable: false,
    min: '',
    max: '',
    minLength: '',
    maxLength: '',
    pattern: '',
    customErrorAr: '',
    multipleFiles: false,
    maxSizeMb: '15',
    formulaExpression: '',
    optionsText: '',
    viewRoles: [] as string[],
    editRoles: [] as string[],
  });

  const filteredDynamicFields = useMemo(
    () =>
      dynamicFields
        .filter((f) => !f.archived && (selectedFormFilter === 'all' || f.formId === selectedFormFilter))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [dynamicFields, selectedFormFilter]
  );

  const countRecordsUsingField = (field: DynamicFieldDefinition): number => {
    if (field.formId === 'hr_rider') return analyzeDynamicFieldImpact(field.key, riders);
    if (field.formId === 'fleet_vehicle') return analyzeDynamicFieldImpact(field.key, vehicles);
    if (field.formId === 'fleet_handover') return analyzeDynamicFieldImpact(field.key, assignments);
    if (field.formId === 'fleet_maintenance') return analyzeDynamicFieldImpact(field.key, maintenance);
    if (field.formId === 'ops_case') return analyzeDynamicFieldImpact(field.key, operationalCases);
    if (field.formId === 'admin_note') return analyzeDynamicFieldImpact(field.key, entityNotesTasks);
    return analyzeDynamicFieldImpact(field.key, customEntityRecords.filter((r) => r.formId === field.formId));
  };

  const openCreateField = () => {
    setEditingField(null);
    setFForm({
      formId: selectedFormFilter === 'all' ? 'hr_rider' : selectedFormFilter,
      key: '',
      labelAr: '',
      labelEn: '',
      type: 'short_text',
      placeholderAr: '',
      description: '',
      defaultValue: '',
      required: false,
      visible: true,
      editable: true,
      showInTable: false,
      min: '',
      max: '',
      minLength: '',
      maxLength: '',
      pattern: '',
      customErrorAr: '',
      multipleFiles: false,
      maxSizeMb: '15',
      formulaExpression: '',
      optionsText: '',
      viewRoles: [],
      editRoles: [],
    });
    setFieldDrawerOpen(true);
  };

  const openEditField = (f: DynamicFieldDefinition) => {
    setEditingField(f);
    setFForm({
      formId: f.formId,
      key: f.key,
      labelAr: f.labelAr,
      labelEn: f.labelEn,
      type: f.type,
      placeholderAr: f.placeholderAr || '',
      description: f.description || '',
      defaultValue: f.defaultValue !== undefined ? String(f.defaultValue) : '',
      required: Boolean(f.required),
      visible: f.visible !== false,
      editable: f.editable !== false,
      showInTable: Boolean(f.showInTable),
      min: f.validation?.min !== undefined ? String(f.validation.min) : '',
      max: f.validation?.max !== undefined ? String(f.validation.max) : '',
      minLength: f.validation?.minLength !== undefined ? String(f.validation.minLength) : '',
      maxLength: f.validation?.maxLength !== undefined ? String(f.validation.maxLength) : '',
      pattern: f.validation?.pattern || '',
      customErrorAr: f.validation?.customErrorAr || '',
      multipleFiles: Boolean(f.fileConfig?.multiple),
      maxSizeMb: String(f.fileConfig?.maxSizeMb || 15),
      formulaExpression: f.formulaExpression || '',
      optionsText: (f.options || []).map((o) => `${o.value}|${o.labelAr}`).join('\n'),
      viewRoles: f.permissions?.viewRoles || [],
      editRoles: f.permissions?.editRoles || [],
    });
    setFieldDrawerOpen(true);
  };

  const handleSaveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateFields && !canEditFields) return;
    if (!fForm.labelAr.trim()) {
      setToast({ type: 'err', msg: 'الاسم العربي للحقل مطلوب.' });
      return;
    }
    const formMeta = allForms.find((x) => x.formId === fForm.formId);
    const sanitizedKey = editingField
      ? editingField.key
      : sanitizeFieldKey(fForm.key || fForm.labelEn || fForm.labelAr);

    if (!editingField) {
      const dup = dynamicFields.find((f) => f.formId === fForm.formId && f.key === sanitizedKey && !f.archived);
      if (dup) {
        setToast({ type: 'err', msg: `المفتاح (${sanitizedKey}) مستخدم بالفعل في هذا النموذج.` });
        return;
      }
    }

    if (editingField && editingField.type !== fForm.type) {
      const used = countRecordsUsingField(editingField);
      if (used > 0) {
        setToast({
          type: 'err',
          msg: `تنبيه حماية البيانات: يوجد ${used} سجل يحتوي بيانات لهذا الحقل (${editingField.type}). لتجنب فقدان القيم، أنشئ حقلاً جديداً أو احتفظ بالنوع الحالي.`,
        });
        return;
      }
    }

    setBusy(true);
    setToast(null);
    try {
      const fieldId = editingField?.fieldId || `fld_${fForm.formId}_${sanitizedKey}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const nextOrder = editingField
        ? editingField.order
        : dynamicFields.filter((x) => x.formId === fForm.formId).reduce((m, x) => Math.max(m, x.order || 0), 0) + 1;

      const parsedOptions =
        fForm.type === 'dropdown' || fForm.type === 'multiselect'
          ? fForm.optionsText
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, idx) => {
                const [val, lbl] = line.includes('|') ? line.split('|') : [line, line];
                return { value: val.trim() || `opt_${idx + 1}`, labelAr: (lbl || val).trim() };
              })
          : [];

      const validationObj: Record<string, unknown> = {};
      if (fForm.min !== '') validationObj.min = Number(fForm.min);
      if (fForm.max !== '') validationObj.max = Number(fForm.max);
      if (fForm.minLength !== '') validationObj.minLength = Number(fForm.minLength);
      if (fForm.maxLength !== '') validationObj.maxLength = Number(fForm.maxLength);
      if (fForm.pattern.trim()) validationObj.pattern = fForm.pattern.trim();
      if (fForm.customErrorAr.trim()) validationObj.customErrorAr = fForm.customErrorAr.trim();

      const payload: Record<string, unknown> = {
        fieldId,
        key: sanitizedKey,
        module: formMeta?.module || 'custom',
        formId: fForm.formId,
        labelAr: fForm.labelAr.trim().slice(0, 120),
        labelEn: (fForm.labelEn.trim() || sanitizedKey).slice(0, 120),
        type: fForm.type,
        placeholderAr: fForm.placeholderAr.trim().slice(0, 140),
        description: fForm.description.trim().slice(0, 300),
        defaultValue: fForm.defaultValue,
        required: fForm.required,
        visible: fForm.visible,
        editable: fForm.editable,
        showInTable: fForm.showInTable,
        order: nextOrder,
        options: parsedOptions,
        validation: validationObj,
        fileConfig: {
          multiple: fForm.multipleFiles,
          maxSizeMb: Number(fForm.maxSizeMb) || 15,
        },
        formulaExpression: fForm.type === 'formula' ? fForm.formulaExpression.trim() : '',
        permissions: {
          viewRoles: fForm.viewRoles,
          editRoles: fForm.editRoles,
        },
        archived: false,
        createdByUid: editingField?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        updatedAt: serverTimestamp(),
      };

      if (editingField) {
        await updateDoc(doc(db, 'dynamicFields', fieldId), payload);
      } else {
        await setDoc(doc(db, 'dynamicFields', fieldId), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      await writeErpAuditLog({
        action: editingField ? 'DYNAMIC_FIELD_UPDATED' : 'DYNAMIC_FIELD_CREATED',
        targetCollection: 'dynamicFields',
        targetId: fieldId,
        entityType: 'dynamic_field',
        details: `${editingField ? 'تعديل' : 'إضافة'} الحقل "${fForm.labelAr.trim()}" (${sanitizedKey} · ${fForm.type}) في نموذج ${fForm.formId}`,
        oldValue: editingField ? { labelAr: editingField.labelAr, type: editingField.type, required: editingField.required } : undefined,
        newValue: { labelAr: fForm.labelAr.trim(), type: fForm.type, required: fForm.required, formId: fForm.formId },
        user: currentUser,
        allowedUids,
      });

      setFieldDrawerOpen(false);
      setToast({ type: 'ok', msg: `تم حفظ الحقل "${fForm.labelAr.trim()}" وتفعيله في النظام بنجاح.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حفظ الحقل.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReorderField = async (sourceId: string, targetId: string) => {
    if (!canEditFields || sourceId === targetId) return;
    const list = [...filteredDynamicFields];
    const fromIdx = list.findIndex((x) => x.fieldId === sourceId);
    const toIdx = list.findIndex((x) => x.fieldId === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setBusy(true);
    try {
      await Promise.all(
        list.map((f, idx) =>
          updateDoc(doc(db, 'dynamicFields', f.fieldId), {
            order: idx + 1,
            updatedAt: serverTimestamp(),
          })
        )
      );
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteField = async () => {
    if (!deleteFieldTarget || !canEditFields) return;
    const { field } = deleteFieldTarget;
    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const trashId = `trash_fld_${field.fieldId}_${Date.now().toString(36)}`;
      await setDoc(doc(db, 'trashItems', trashId), {
        trashId,
        sourceCollection: 'dynamicFields',
        sourceDocId: field.fieldId,
        entityType: 'dynamic_field',
        titleAr: `حقل: ${field.labelAr} (${field.formId})`,
        snapshot: JSON.parse(JSON.stringify(field)),
        deletedByUid: currentUser.uid,
        deletedByEmail: currentUser.email,
        deletedAt: new Date().toISOString(),
        status: 'deleted',
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'dynamicFields', field.fieldId));
      await writeErpAuditLog({
        action: 'DYNAMIC_FIELD_ARCHIVED_TO_TRASH',
        targetCollection: 'dynamicFields',
        targetId: field.fieldId,
        entityType: 'dynamic_field',
        details: `حذف الحقل "${field.labelAr}" ونقله لسلة المحذوفات`,
        oldValue: { labelAr: field.labelAr, key: field.key, formId: field.formId },
        user: currentUser,
        allowedUids,
      });
      setDeleteFieldTarget(null);
      setToast({ type: 'ok', msg: `تم نقل الحقل "${field.labelAr}" إلى سلة المحذوفات بأمان.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حذف الحقل.' });
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 2: DYNAMIC FORM BUILDER (3-PANE STUDIO + VERSIONING)
  // -------------------------------------------------------
  const [designerFormId, setDesignerFormId] = useState<string>('hr_rider');
  const [draftLayoutMode, setDraftLayoutMode] = useState<'sections' | 'tabs' | 'wizard'>('sections');
  const [draftSections, setDraftSections] = useState<DynamicFormSection[]>([]);
  const [draftPlacements, setDraftPlacements] = useState<DynamicFormFieldPlacement[]>([]);
  const [loadedDesignFormId, setLoadedDesignFormId] = useState<string>('');
  const [newSectionTitleAr, setNewSectionTitleAr] = useState('');
  const [previewSampleValues, setPreviewSampleValues] = useState<Record<string, unknown>>({});
  const [dragPlacementId, setDragPlacementId] = useState<string | null>(null);

  const loadFormIntoStudio = (targetFormId: string) => {
    const schema = buildEffectiveFormSchema({
      formId: targetFormId,
      dynamicForms,
      dynamicFields,
    });
    setDesignerFormId(targetFormId);
    setDraftLayoutMode(schema.formMeta.layoutMode);
    setDraftSections(schema.sections);
    setDraftPlacements(schema.placements);
    setLoadedDesignFormId(targetFormId);
  };

  if (loadedDesignFormId !== designerFormId) {
    loadFormIntoStudio(designerFormId);
  }

  const formFieldsMap = useMemo(() => {
    const map = new Map<string, DynamicFieldDefinition>();
    for (const f of dynamicFields) {
      if (f.formId === designerFormId && !f.archived) map.set(f.fieldId, f);
    }
    return map;
  }, [dynamicFields, designerFormId]);

  const unplacedFormFields = useMemo(() => {
    const placedSet = new Set(draftPlacements.map((p) => p.fieldId));
    return Array.from(formFieldsMap.values()).filter((f) => !placedSet.has(f.fieldId));
  }, [formFieldsMap, draftPlacements]);

  const addSectionToStudio = () => {
    if (!newSectionTitleAr.trim()) return;
    const secId = `sec_${Date.now().toString(36)}`;
    setDraftSections((prev) => [
      ...prev,
      {
        sectionId: secId,
        titleAr: newSectionTitleAr.trim(),
        order: prev.length + 1,
      },
    ]);
    setNewSectionTitleAr('');
  };

  const handleSaveOrPublishForm = async (publish: boolean) => {
    if (!canManageForms) return;
    const catalogMeta = allForms.find((x) => x.formId === designerFormId);
    const existingStored = dynamicForms.find((x) => x.formId === designerFormId);
    const nextVersionNum = (existingStored?.publishedVersion || 0) + (publish ? 1 : 0);

    setBusy(true);
    setToast(null);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const formPayload: Record<string, unknown> = {
        formId: designerFormId,
        nameAr: catalogMeta?.nameAr || designerFormId,
        nameEn: catalogMeta?.nameEn || designerFormId,
        description: catalogMeta?.description || '',
        module: catalogMeta?.module || 'custom',
        targetEntity: catalogMeta?.targetEntity || 'customEntityRecords',
        layoutMode: draftLayoutMode,
        sections: draftSections,
        placements: draftPlacements.map((p, idx) => ({ ...p, order: idx + 1 })),
        publishedVersion: Math.max(1, nextVersionNum || 1),
        status: publish ? 'published' : existingStored?.status || 'draft',
        createdByUid: existingStored?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        updatedAt: serverTimestamp(),
      };
      if (!existingStored) formPayload.createdAt = serverTimestamp();

      await setDoc(doc(db, 'dynamicForms', designerFormId), formPayload, { merge: true });

      if (publish) {
        const versionNumber = Math.max(1, nextVersionNum);
        const versionId = `${designerFormId}_v${versionNumber}_${Date.now().toString(36)}`;
        await setDoc(doc(db, 'dynamicFormVersions', versionId), {
          versionId,
          formId: designerFormId,
          versionNumber,
          layoutMode: draftLayoutMode,
          sections: draftSections,
          placements: draftPlacements.map((p, idx) => ({ ...p, order: idx + 1 })),
          publishedByUid: currentUser.uid,
          publishedByEmail: currentUser.email,
          notes: `نشر الإصدار رقم ${versionNumber}`,
          createdByUid: currentUser.uid,
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await writeErpAuditLog({
        action: publish ? 'DYNAMIC_FORM_PUBLISHED' : 'DYNAMIC_FORM_DRAFT_SAVED',
        targetCollection: 'dynamicForms',
        targetId: designerFormId,
        entityType: 'dynamic_form',
        details: `${publish ? 'نشر واعتماد' : 'حفظ مسودة'} نموذج "${catalogMeta?.nameAr || designerFormId}" (${draftPlacements.length} حقل)`,
        user: currentUser,
        allowedUids,
      });

      setToast({
        type: 'ok',
        msg: publish ? 'تم نشر النموذج وحفظ نسخة قابلة للاسترجاع بنجاح.' : 'تم حفظ مسودة النموذج.',
      });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ النموذج.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRollbackFormVersion = async (ver: DynamicFormVersion) => {
    if (!canManageForms) return;
    setDraftLayoutMode(ver.layoutMode);
    setDraftSections(ver.sections);
    setDraftPlacements(ver.placements);
    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(
        doc(db, 'dynamicForms', ver.formId),
        {
          layoutMode: ver.layoutMode,
          sections: ver.sections,
          placements: ver.placements,
          publishedVersion: ver.versionNumber,
          status: 'published',
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeErpAuditLog({
        action: 'DYNAMIC_FORM_ROLLBACK',
        targetCollection: 'dynamicForms',
        targetId: ver.formId,
        entityType: 'dynamic_form',
        details: `استعادة الإصدار رقم v${ver.versionNumber} لنموذج ${ver.formId}`,
        user: currentUser,
        allowedUids,
      });
      setToast({ type: 'ok', msg: `تمت استعادة الإصدار v${ver.versionNumber} بنجاح.` });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 3: SECTIONS & CUSTOM PAGES
  // -------------------------------------------------------
  const [secForm, setSecForm] = useState({ sectionId: '', titleAr: '', titleEn: '', visible: true });
  const [pageForm, setPageForm] = useState({
    pageId: '',
    titleAr: '',
    titleEn: '',
    descriptionAr: '',
    sectionId: effectiveSections[0]?.sectionId || 'sec_operations',
  });

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSections || !secForm.titleAr.trim()) return;
    setBusy(true);
    try {
      const sectionId = secForm.sectionId || `sec_${sanitizeFieldKey(secForm.titleEn || secForm.titleAr)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const existing = effectiveSections.find((s) => s.sectionId === sectionId);
      await setDoc(
        doc(db, 'systemSections', sectionId),
        {
          sectionId,
          titleAr: secForm.titleAr.trim(),
          titleEn: secForm.titleEn.trim() || secForm.titleAr.trim(),
          iconName: existing?.iconName || 'Layers',
          order: existing?.order || effectiveSections.length + 1,
          visible: secForm.visible,
          builtIn: Boolean(existing?.builtIn),
          createdByUid: existing?.createdByUid || currentUser.uid,
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSecForm({ sectionId: '', titleAr: '', titleEn: '', visible: true });
      setToast({ type: 'ok', msg: 'تم حفظ القسم وتحديث القائمة الجانبية.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ القسم.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSections || !pageForm.titleAr.trim()) return;
    setBusy(true);
    try {
      const slug = sanitizeFieldKey(pageForm.titleEn || pageForm.titleAr);
      const pageId = pageForm.pageId || `page_${slug}_${Date.now().toString(36).slice(-4)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(
        doc(db, 'systemPages', pageId),
        {
          pageId,
          slug,
          sectionId: pageForm.sectionId || 'sec_operations',
          titleAr: pageForm.titleAr.trim(),
          titleEn: pageForm.titleEn.trim() || pageForm.titleAr.trim(),
          descriptionAr: pageForm.descriptionAr.trim(),
          formId: pageId,
          order: systemPages.length + 1,
          visible: true,
          builtIn: false,
          allowedRoles: ['owner', 'admin', 'ops_manager'],
          visibleTableColumns: [],
          createdByUid: currentUser.uid,
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeErpAuditLog({
        action: 'CUSTOM_PAGE_SAVED',
        targetCollection: 'systemPages',
        targetId: pageId,
        entityType: 'system_page',
        details: `إنشاء/تحديث صفحة إدارية مخصصة: ${pageForm.titleAr.trim()}`,
        user: currentUser,
        allowedUids,
      });
      setPageForm({ pageId: '', titleAr: '', titleEn: '', descriptionAr: '', sectionId: pageForm.sectionId });
      setToast({ type: 'ok', msg: `تم حفظ الصفحة الإدارية "${pageForm.titleAr.trim()}" وإضافتها للقائمة.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ الصفحة المخصصة.' });
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 5: SMART NOTIFICATION RULES
  // -------------------------------------------------------
  const [ruleForm, setRuleForm] = useState({
    nameAr: '',
    module: 'hr' as NotificationRuleConfig['module'],
    eventType: 'expiry_threshold' as NotificationRuleConfig['eventType'],
    thresholdDays: '30',
    severity: 'warning' as 'critical' | 'warning' | 'info',
  });

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings || !ruleForm.nameAr.trim()) return;
    setBusy(true);
    try {
      const ruleId = `rule_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'notificationRules', ruleId), {
        ruleId,
        nameAr: ruleForm.nameAr.trim(),
        module: ruleForm.module,
        eventType: ruleForm.eventType,
        thresholdDays: Number(ruleForm.thresholdDays) || 30,
        severity: ruleForm.severity,
        targetRoles: ['owner', 'admin', 'hr_manager', 'fleet_manager'],
        active: true,
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRuleForm({ ...ruleForm, nameAr: '' });
      setToast({ type: 'ok', msg: 'تم إنشاء قاعدة التنبيه الذكية.' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 6: BACKUP SNAPSHOTS & DIFF PREVIEW
  // -------------------------------------------------------
  const [snapshotTitle, setSnapshotTitle] = useState('');
  const [importJsonText, setImportJsonText] = useState('');

  const buildConfigBundle = () => ({
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser.email,
    systemSections,
    systemPages,
    dynamicFields,
    dynamicForms,
    companyBranding,
    notificationRules,
    customReportTemplates,
    roleTemplates,
  });

  const parsedImportDiff = useMemo(() => {
    if (!importJsonText.trim()) return null;
    try {
      const parsed = JSON.parse(importJsonText) as Record<string, unknown>;
      return {
        valid: true as const,
        data: parsed,
        summary: [
          { label: 'الأقسام', incoming: Array.isArray(parsed.systemSections) ? parsed.systemSections.length : 0, current: systemSections.length },
          { label: 'الصفحات المخصصة', incoming: Array.isArray(parsed.systemPages) ? parsed.systemPages.length : 0, current: systemPages.length },
          { label: 'الحقول الديناميكية', incoming: Array.isArray(parsed.dynamicFields) ? parsed.dynamicFields.length : 0, current: dynamicFields.length },
          { label: 'النماذج', incoming: Array.isArray(parsed.dynamicForms) ? parsed.dynamicForms.length : 0, current: dynamicForms.length },
          { label: 'قواعد التنبيه', incoming: Array.isArray(parsed.notificationRules) ? parsed.notificationRules.length : 0, current: notificationRules.length },
        ],
      };
    } catch {
      return { valid: false as const };
    }
  }, [importJsonText, systemSections.length, systemPages.length, dynamicFields.length, dynamicForms.length, notificationRules.length]);

  const handleDownloadJsonBackup = () => {
    const blob = new Blob([JSON.stringify(buildConfigBundle(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet_ops_config_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveSnapshot = async () => {
    if (!canManageSettings || !snapshotTitle.trim()) return;
    setBusy(true);
    try {
      const snapshotId = `snap_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'configSnapshots', snapshotId), {
        snapshotId,
        titleAr: snapshotTitle.trim(),
        createdByEmail: currentUser.email,
        payloadJson: JSON.stringify(buildConfigBundle()),
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSnapshotTitle('');
      setToast({ type: 'ok', msg: 'تم حفظ لقطة النسخ الاحتياطي لإعدادات النظام.' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleApplyConfigBundle = async (bundle: Record<string, unknown>) => {
    if (!canManageSettings) return;
    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const applyCollection = async (col: string, idKey: string, items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (typeof item !== 'object' || item === null) continue;
          const obj = item as Record<string, unknown>;
          const idVal = String(obj[idKey] || '');
          if (!idVal) continue;
          await setDoc(
            doc(db, col, idVal),
            {
              ...obj,
              createdByUid: currentUser.uid,
              allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      };

      await applyCollection('systemSections', 'sectionId', bundle.systemSections);
      await applyCollection('systemPages', 'pageId', bundle.systemPages);
      await applyCollection('dynamicFields', 'fieldId', bundle.dynamicFields);
      await applyCollection('dynamicForms', 'formId', bundle.dynamicForms);
      await applyCollection('notificationRules', 'ruleId', bundle.notificationRules);

      await writeErpAuditLog({
        action: 'SYSTEM_CONFIG_BACKUP_RESTORED',
        targetCollection: 'configSnapshots',
        targetId: 'bundle_import',
        entityType: 'config_snapshot',
        details: 'استعادة وتطبيق حزمة إعدادات النظام الديناميكية',
        user: currentUser,
        allowedUids,
      });

      setImportJsonText('');
      setToast({ type: 'ok', msg: 'تم استيراد وتطبيق إعدادات النظام بنجاح.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تطبيق الحزمة.' });
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 7: TRASH & RECOVERY
  // -------------------------------------------------------
  const activeTrash = useMemo(() => trashItems.filter((t) => t.status === 'deleted'), [trashItems]);

  const handleRestoreTrashItem = async (item: TrashItemRecord) => {
    if (!canRestoreTrash) return;
    setBusy(true);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(
        doc(db, item.sourceCollection, item.sourceDocId),
        {
          ...item.snapshot,
          createdByUid: currentUser.uid,
          allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await updateDoc(doc(db, 'trashItems', item.trashId), {
        status: 'restored',
        restoredByEmail: currentUser.email,
        restoredAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      await writeErpAuditLog({
        action: 'TRASH_ITEM_RESTORED',
        targetCollection: item.sourceCollection,
        targetId: item.sourceDocId,
        entityType: item.entityType,
        details: `استعادة العنصر "${item.titleAr}" من سلة المحذوفات`,
        user: currentUser,
        allowedUids,
      });
      setToast({ type: 'ok', msg: `تمت استعادة "${item.titleAr}" بنجاح.` });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذرت الاستعادة.' });
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------
  // TAB 8: SYSTEM HEALTH
  // -------------------------------------------------------
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const fetchSystemHealth = async () => {
    setHealthLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/system/health', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeParseJsonResponse<HealthResponse>(res);
      if (res.ok) setHealthData(json);
    } catch {
      // handled cleanly in UI
    } finally {
      setHealthLoading(false);
    }
  };

  // Data Dictionary Combined Rows
  const dictionaryRows = useMemo(() => {
    const rows: Array<{
      id: string;
      key: string;
      labelAr: string;
      labelEn: string;
      type: string;
      formName: string;
      source: 'أساسي' | 'مخصص';
      required: boolean;
      editable: boolean;
    }> = [];

    for (const f of BUILT_IN_FORMS_CATALOG) {
      for (const cf of f.coreFields) {
        rows.push({
          id: `core_${f.formId}_${cf.key}`,
          key: cf.key,
          labelAr: cf.labelAr,
          labelEn: cf.labelEn,
          type: cf.type,
          formName: f.nameAr,
          source: 'أساسي',
          required: Boolean(cf.required),
          editable: cf.key !== 'internalRiderId' && cf.key !== 'vehicleInternalId',
        });
      }
    }
    for (const df of dynamicFields.filter((x) => !x.archived)) {
      const formLabel = allForms.find((f) => f.formId === df.formId)?.nameAr || df.formId;
      rows.push({
        id: df.fieldId,
        key: df.key,
        labelAr: df.labelAr,
        labelEn: df.labelEn,
        type: DYNAMIC_FIELD_TYPE_META[df.type]?.labelAr || df.type,
        formName: formLabel,
        source: 'مخصص',
        required: df.required,
        editable: df.editable,
      });
    }
    return rows;
  }, [dynamicFields, allForms]);

  const TABS: TabItem<SystemBuilderTab>[] = [
    { key: 'fields', label: 'منشئ الحقول', count: dynamicFields.filter((f) => !f.archived).length, icon: <Sliders className="h-3.5 w-3.5" /> },
    { key: 'forms', label: 'منشئ النماذج', count: allForms.length, icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { key: 'sections_pages', label: 'الأقسام والصفحات', count: systemPages.length, icon: <Boxes className="h-3.5 w-3.5" /> },
    { key: 'dictionary', label: 'قاموس البيانات', count: dictionaryRows.length, icon: <BookOpen className="h-3.5 w-3.5" /> },
    { key: 'rules', label: 'قواعد التنبيهات', count: notificationRules.length, icon: <BellRing className="h-3.5 w-3.5" /> },
    { key: 'backup_audit', label: 'النسخ والتدقيق', count: configSnapshots.length, icon: <DatabaseBackup className="h-3.5 w-3.5" /> },
    { key: 'trash', label: 'سلة المحذوفات', count: activeTrash.length, icon: <Trash2 className="h-3.5 w-3.5" /> },
    { key: 'health', label: 'صحة النظام', icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  const dictColumns: TableColumn<(typeof dictionaryRows)[number]>[] = [
    { key: 'key', header: 'المفتاح (Key)', sortValue: (r) => r.key, render: (r) => <span className="font-mono-num text-xs font-bold">{r.key}</span> },
    { key: 'ar', header: 'الاسم العربي', sortValue: (r) => r.labelAr, render: (r) => <span className="font-semibold text-xs">{r.labelAr}</span> },
    { key: 'type', header: 'النوع', render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.type}</span> },
    { key: 'form', header: 'النموذج المرتبط', sortValue: (r) => r.formName, render: (r) => <span className="text-xs">{r.formName}</span> },
    {
      key: 'src',
      header: 'المصدر',
      render: (r) => <StatusBadge label={r.source} tone={r.source === 'مخصص' ? 'info' : 'neutral'} />,
    },
    {
      key: 'req',
      header: 'إلزامي',
      render: (r) => <StatusBadge label={r.required ? 'مطلوب' : 'اختياري'} tone={r.required ? 'warning' : 'neutral'} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="مركز التحكم والتخصيص الشامل (System Builder)"
        subtitle="إدارة الحقول الديناميكية الـ 18 · تصميم النماذج وإصداراتها · الأقسام والصفحات · النسخ الاحتياطي · سلة المحذوفات · صحة النظام"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
            onClick={() => void onRefresh()}
          >
            تحديث
          </Button>
        }
      />

      <Tabs
        variant="underline"
        activeKey={subTab}
        onChange={(k) => {
          setSubTab(k);
          if (k === 'health' && !healthData) void fetchSystemHealth();
        }}
        items={TABS}
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      {/* 1. DYNAMIC FIELD BUILDER */}
      {subTab === 'fields' && (
        <div className="space-y-4">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">النموذج المستهدف:</span>
              <Select
                value={selectedFormFilter}
                onChange={(e) => setSelectedFormFilter(e.target.value)}
                className="!w-64"
              >
                <option value="all">كل النماذج ({dynamicFields.filter((f) => !f.archived).length})</option>
                {allForms.map((f) => (
                  <option key={f.formId} value={f.formId}>
                    {f.nameAr}
                  </option>
                ))}
              </Select>
            </div>
            {canCreateFields && (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreateField}>
                إضافة حقل مخصص جديد
              </Button>
            )}
          </Card>

          {filteredDynamicFields.length === 0 ? (
            <EmptyState
              title="لا توجد حقول مخصصة في هذا النموذج بعد"
              subtitle="اضغط «إضافة حقل مخصص جديد» لإضافة حقول نصية، رقمية، هواتف، مرفقات، قوائم، أو معادلات حسابية تظهر تلقائيًا في النماذج والجداول."
              action={
                canCreateFields ? (
                  <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreateField}>
                    إضافة أول حقل مخصص
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Card padding="none">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDynamicFields.map((f) => (
                  <div
                    key={f.fieldId}
                    draggable={canEditFields}
                    onDragStart={() => setDragFieldId(f.fieldId)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFieldId) void handleReorderField(dragFieldId, f.fieldId);
                      setDragFieldId(null);
                    }}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <GripVertical className="h-4 w-4 text-slate-400 cursor-grab shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">{f.labelAr}</span>
                          <span className="font-mono-num text-[11px] rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-slate-600 dark:text-slate-300">
                            {f.key}
                          </span>
                          <StatusBadge label={DYNAMIC_FIELD_TYPE_META[f.type]?.labelAr || f.type} tone="info" />
                          {f.required && <StatusBadge label="إلزامي" tone="warning" />}
                          {f.showInTable && <StatusBadge label="ظاهر بالجدول" tone="success" />}
                          {!f.visible && <StatusBadge label="مخفي" tone="neutral" />}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          النموذج: {allForms.find((x) => x.formId === f.formId)?.nameAr || f.formId}
                          {f.type === 'formula' && f.formulaExpression ? ` · المعادلة: ${f.formulaExpression}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {canEditFields && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => openEditField(f)}>
                            تعديل
                          </Button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteFieldTarget({ field: f, impactCount: countRecordsUsingField(f) })
                            }
                            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            title="حذف الحقل"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* 2. DYNAMIC FORM BUILDER (3-PANE STUDIO) */}
      {subTab === 'forms' && (
        <div className="space-y-4">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <FormField label="النموذج" className="min-w-[240px]">
                <Select
                  value={designerFormId}
                  onChange={(e) => loadFormIntoStudio(e.target.value)}
                >
                  {allForms.map((f) => (
                    <option key={f.formId} value={f.formId}>
                      {f.nameAr}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="نمط العرض" className="w-44">
                <Select
                  value={draftLayoutMode}
                  onChange={(e) => setDraftLayoutMode(e.target.value as 'sections' | 'tabs' | 'wizard')}
                >
                  <option value="sections">أقسام متتالية (Sections)</option>
                  <option value="tabs">تبويبات (Tabs)</option>
                  <option value="wizard">خطوات متدرجة (Wizard)</option>
                </Select>
              </FormField>
            </div>
            {canManageForms && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" loading={busy} onClick={() => void handleSaveOrPublishForm(false)}>
                  حفظ مسودة
                </Button>
                <Button size="sm" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void handleSaveOrPublishForm(true)}>
                  نشر واعتماد إصدار جديد
                </Button>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left Pane: Field Palette */}
            <Card className="lg:col-span-3 space-y-3">
              <SectionHeader title="حقول النموذج المتاحة" subtitle="أضف الحقول إلى الأقسام" />
              <div className="space-y-1.5">
                {unplacedFormFields.map((f) => (
                  <div
                    key={f.fieldId}
                    className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{f.labelAr}</div>
                      <div className="text-[10px] text-slate-500">{DYNAMIC_FIELD_TYPE_META[f.type]?.labelAr}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const targetSec = draftSections[0]?.sectionId || 'sec_custom_default';
                        setDraftPlacements((prev) => [
                          ...prev,
                          {
                            fieldId: f.fieldId,
                            fieldKey: f.key,
                            sectionId: targetSec,
                            order: prev.length + 1,
                            width: f.type === 'long_text' ? 'full' : 'half',
                          },
                        ]);
                      }}
                    >
                      + إضافة
                    </Button>
                  </div>
                ))}
                {unplacedFormFields.length === 0 && (
                  <p className="text-xs text-slate-400">جميع حقول هذا النموذج موضوعة على اللوحة.</p>
                )}
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">إضافة قسم / خطوة جديدة</div>
                <div className="flex gap-1.5">
                  <Input
                    value={newSectionTitleAr}
                    onChange={(e) => setNewSectionTitleAr(e.target.value)}
                    placeholder="اسم القسم الجديد..."
                    className="text-xs"
                  />
                  <Button size="sm" variant="secondary" onClick={addSectionToStudio}>
                    إضافة
                  </Button>
                </div>
              </div>
            </Card>

            {/* Center Pane: Visual Layout Canvas */}
            <Card className="lg:col-span-5 space-y-4">
              <SectionHeader title="لوحة تصميم النموذج (السحب والترتيب والعرض)" />
              {draftSections.map((sec) => {
                const secPlacements = draftPlacements.filter((p) => p.sectionId === sec.sectionId);
                return (
                  <div key={sec.sectionId} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/30">
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        value={sec.titleAr}
                        onChange={(e) =>
                          setDraftSections((prev) =>
                            prev.map((s) => (s.sectionId === sec.sectionId ? { ...s, titleAr: e.target.value } : s))
                          )
                        }
                        className="h-8 text-xs font-bold"
                      />
                      {draftSections.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const fallbackSec = draftSections.find((s) => s.sectionId !== sec.sectionId)?.sectionId || '';
                            setDraftPlacements((prev) =>
                              prev.map((p) => (p.sectionId === sec.sectionId ? { ...p, sectionId: fallbackSec } : p))
                            );
                            setDraftSections((prev) => prev.filter((s) => s.sectionId !== sec.sectionId));
                          }}
                          className="text-xs text-red-600 hover:underline shrink-0"
                        >
                          حذف القسم
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {secPlacements.map((p) => {
                        const field = formFieldsMap.get(p.fieldId);
                        if (!field) return null;
                        return (
                          <div
                            key={p.fieldId}
                            draggable
                            onDragStart={() => setDragPlacementId(p.fieldId)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (!dragPlacementId || dragPlacementId === p.fieldId) return;
                              setDraftPlacements((prev) => {
                                const list = [...prev];
                                const from = list.findIndex((x) => x.fieldId === dragPlacementId);
                                const to = list.findIndex((x) => x.fieldId === p.fieldId);
                                if (from < 0 || to < 0) return prev;
                                const [item] = list.splice(from, 1);
                                item.sectionId = sec.sectionId;
                                list.splice(to, 0, item);
                                return list.map((x, idx) => ({ ...x, order: idx + 1 }));
                              });
                              setDragPlacementId(null);
                            }}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <GripVertical className="h-3.5 w-3.5 text-slate-400 cursor-grab" />
                              <span className="font-semibold text-slate-800 dark:text-slate-100">{field.labelAr}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <select
                                value={p.width}
                                onChange={(e) =>
                                  setDraftPlacements((prev) =>
                                    prev.map((x) =>
                                      x.fieldId === p.fieldId ? { ...x, width: e.target.value as 'full' | 'half' | 'third' } : x
                                    )
                                  )
                                }
                                className="rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-[11px]"
                              >
                                <option value="full">عرض كامل</option>
                                <option value="half">نصف السطر</option>
                                <option value="third">ثلث السطر</option>
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftPlacements((prev) =>
                                    prev.map((x) =>
                                      x.fieldId === p.fieldId ? { ...x, readonly: !x.readonly } : x
                                    )
                                  )
                                }
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  p.readonly ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {p.readonly ? 'قراءة فقط' : 'قابل للتعديل'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {secPlacements.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 text-center text-[11px] text-slate-400">
                          لا توجد حقول في هذا القسم بعد
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Form Version History & Rollback */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <History className="h-3.5 w-3.5 text-blue-600" />
                  <span>سجل الإصدارات المنشورة والتراجع</span>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto erp-scroll">
                  {dynamicFormVersions
                    .filter((v) => v.formId === designerFormId)
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map((v) => (
                      <div
                        key={v.versionId}
                        className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs"
                      >
                        <div>
                          <span className="font-mono-num font-bold">v{v.versionNumber}</span> ·{' '}
                          <span className="text-slate-500">{v.publishedByEmail}</span>
                        </div>
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} onClick={() => void handleRollbackFormVersion(v)}>
                          استعادة
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            </Card>

            {/* Right Pane: Live Interactive Preview */}
            <Card className="lg:col-span-4 space-y-3">
              <SectionHeader title="المعاينة التفاعلية المباشرة" icon={<Eye className="h-4 w-4 text-blue-600" />} />
              <DynamicFieldsRenderer
                formId={designerFormId}
                entityId="preview"
                entityLabel="معاينة النموذج"
                dynamicFields={Array.from(formFieldsMap.values())}
                dynamicForms={[
                  {
                    formId: designerFormId,
                    nameAr: designerFormId,
                    nameEn: designerFormId,
                    module: 'preview',
                    targetEntity: 'preview',
                    layoutMode: draftLayoutMode,
                    sections: draftSections,
                    placements: draftPlacements,
                    publishedVersion: 1,
                    status: 'published',
                    createdByUid: currentUser.uid,
                    allowedUids,
                  },
                ]}
                values={previewSampleValues}
                onChange={setPreviewSampleValues}
                user={currentUser}
                mode="form"
              />
            </Card>
          </div>
        </div>
      )}

      {/* 3. SECTIONS & CUSTOM PAGES */}
      {subTab === 'sections_pages' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="space-y-4">
            <SectionHeader title="إدارة أقسام القائمة الجانبية" subtitle="تعديل التسمية والإظهار والترتيب أو إضافة أقسام جديدة" />
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {effectiveSections.map((sec, idx) => (
                <div key={sec.sectionId} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{sec.titleAr}</div>
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      {sec.sectionId} · {sec.builtIn ? 'أساسي' : 'مخصص'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void setDoc(
                          doc(db, 'systemSections', sec.sectionId),
                          {
                            ...sec,
                            visible: !sec.visible,
                            allowedUids: Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20),
                            updatedAt: serverTimestamp(),
                          },
                          { merge: true }
                        ).then(onRefresh)
                      }
                    >
                      {sec.visible ? 'إخفاء' : 'إظهار'}
                    </Button>
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void setDoc(
                            doc(db, 'systemSections', sec.sectionId),
                            { ...sec, order: Math.max(1, sec.order - 1), updatedAt: serverTimestamp() },
                            { merge: true }
                          ).then(onRefresh)
                        }
                        className="p-1 text-slate-500 hover:text-slate-900"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void setDoc(
                          doc(db, 'systemSections', sec.sectionId),
                          { ...sec, order: sec.order + 1, updatedAt: serverTimestamp() },
                          { merge: true }
                        ).then(onRefresh)
                      }
                      className="p-1 text-slate-500 hover:text-slate-900"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {canManageSections && (
              <form onSubmit={(e) => void handleSaveSection(e)} className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">إضافة قسم مخصص جديد</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    required
                    placeholder="اسم القسم بالعربية"
                    value={secForm.titleAr}
                    onChange={(e) => setSecForm({ ...secForm, titleAr: e.target.value })}
                  />
                  <Input
                    placeholder="Section Title (EN)"
                    value={secForm.titleEn}
                    onChange={(e) => setSecForm({ ...secForm, titleEn: e.target.value })}
                  />
                </div>
                <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
                  حفظ القسم
                </Button>
              </form>
            )}
          </Card>

          <Card className="space-y-4">
            <SectionHeader title="الصفحات الإدارية المخصصة" subtitle="تُضاف مباشرة للقائمة الجانبية وترتبط بنموذج ديناميكي وجدول وسلة المحذوفات" />
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {systemPages.length === 0 ? (
                <p className="py-4 text-xs text-slate-400">لم يتم إنشاء صفحات إدارية مخصصة بعد.</p>
              ) : (
                systemPages.map((pg) => (
                  <div key={pg.pageId} className="flex items-center justify-between py-2.5 text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{pg.titleAr}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        القسم: {effectiveSections.find((s) => s.sectionId === pg.sectionId)?.titleAr || pg.sectionId} · {pg.pageId}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedFormFilter(pg.formId || pg.pageId);
                          setSubTab('fields');
                        }}
                      >
                        حقول الصفحة
                      </Button>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteDoc(doc(db, 'systemPages', pg.pageId)).then(onRefresh)
                        }
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {canManageSections && (
              <form onSubmit={(e) => void handleSaveCustomPage(e)} className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">إنشاء صفحة إدارية جديدة</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    required
                    placeholder="عنوان الصفحة بالعربية (مثال: عهد الشرائح)"
                    value={pageForm.titleAr}
                    onChange={(e) => setPageForm({ ...pageForm, titleAr: e.target.value })}
                  />
                  <Input
                    placeholder="Page Title (EN)"
                    value={pageForm.titleEn}
                    onChange={(e) => setPageForm({ ...pageForm, titleEn: e.target.value })}
                  />
                  <Select
                    value={pageForm.sectionId}
                    onChange={(e) => setPageForm({ ...pageForm, sectionId: e.target.value })}
                  >
                    {effectiveSections.map((s) => (
                      <option key={s.sectionId} value={s.sectionId}>
                        القسم: {s.titleAr}
                      </option>
                    ))}
                  </Select>
                  <Input
                    placeholder="وصف مختصر للصفحة"
                    value={pageForm.descriptionAr}
                    onChange={(e) => setPageForm({ ...pageForm, descriptionAr: e.target.value })}
                  />
                </div>
                <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
                  إنشاء الصفحة وفتح حقولها
                </Button>
              </form>
            )}
          </Card>
        </div>
      )}

      {/* 4. DATA DICTIONARY */}
      {subTab === 'dictionary' && (
        <DataTable
          rows={dictionaryRows}
          columns={dictColumns}
          rowKey={(r) => r.id}
          searchPlaceholder="ابحث في قاموس البيانات باسم الحقل أو المفتاح أو النموذج..."
          searchText={(r) => `${r.key} ${r.labelAr} ${r.labelEn} ${r.formName} ${r.type}`}
        />
      )}

      {/* 5. NOTIFICATION RULES */}
      {subTab === 'rules' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="space-y-4">
            <SectionHeader title="إنشاء قاعدة تنبيه ذكية" />
            <form onSubmit={(e) => void handleSaveRule(e)} className="space-y-3">
              <FormField label="اسم القاعدة" required>
                <Input
                  required
                  placeholder="مثال: تنبيه انتهاء الإقامة قبل 14 يوماً"
                  value={ruleForm.nameAr}
                  onChange={(e) => setRuleForm({ ...ruleForm, nameAr: e.target.value })}
                />
              </FormField>
              <FormField label="الوحدة">
                <Select
                  value={ruleForm.module}
                  onChange={(e) => setRuleForm({ ...ruleForm, module: e.target.value as NotificationRuleConfig['module'] })}
                >
                  <option value="hr">الموارد البشرية</option>
                  <option value="fleet">الأسطول والمركبات</option>
                  <option value="operations">العمليات</option>
                  <option value="applications">التطبيقات</option>
                  <option value="custom">مخصص</option>
                </Select>
              </FormField>
              <FormField label="نوع الحدث">
                <Select
                  value={ruleForm.eventType}
                  onChange={(e) => setRuleForm({ ...ruleForm, eventType: e.target.value as NotificationRuleConfig['eventType'] })}
                >
                  <option value="expiry_threshold">عتبة انتهاء وثيقة</option>
                  <option value="sla_overdue">تأخر SLA حالة تشغيلية</option>
                  <option value="status_change">تغيير حالة</option>
                  <option value="conflict_detected">كشف تعارض ربط</option>
                </Select>
              </FormField>
              <div className="grid grid-cols-2 gap-2">
                <FormField label="العتبة (أيام)">
                  <Input
                    type="number"
                    className="font-mono-num"
                    value={ruleForm.thresholdDays}
                    onChange={(e) => setRuleForm({ ...ruleForm, thresholdDays: e.target.value })}
                  />
                </FormField>
                <FormField label="مستوى التنبيه">
                  <Select
                    value={ruleForm.severity}
                    onChange={(e) => setRuleForm({ ...ruleForm, severity: e.target.value as 'critical' | 'warning' | 'info' })}
                  >
                    <option value="critical">حرج</option>
                    <option value="warning">تحذير</option>
                    <option value="info">معلومة</option>
                  </Select>
                </FormField>
              </div>
              <Button type="submit" variant="primary" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
                حفظ القاعدة
              </Button>
            </form>
          </Card>

          <Card className="lg:col-span-2 space-y-3">
            <SectionHeader title={`القواعد النشطة (${notificationRules.length})`} />
            {notificationRules.length === 0 ? (
              <EmptyState title="لا توجد قواعد تنبيه مخصصة بعد" subtitle="استخدم النموذج الجانبي لإضافة قواعد تنبيه مخصصة تدمج في جرس الإشعارات." />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {notificationRules.map((r) => (
                  <div key={r.ruleId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{r.nameAr}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {r.module} · {r.eventType} · عتبة: {r.thresholdDays ?? 0} يوم
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={r.active ? 'مفعّلة' : 'معطّلة'} tone={r.active ? 'success' : 'neutral'} />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void updateDoc(doc(db, 'notificationRules', r.ruleId), {
                            active: !r.active,
                            updatedAt: serverTimestamp(),
                          }).then(onRefresh)
                        }
                      >
                        {r.active ? 'تعطيل' : 'تفعيل'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => void deleteDoc(doc(db, 'notificationRules', r.ruleId)).then(onRefresh)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 6. BACKUP SNAPSHOTS, DIFF & AUDIT LOGS */}
      {subTab === 'backup_audit' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="space-y-4">
              <SectionHeader title="تصدير وحفظ لقطة إعدادات النظام" />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={handleDownloadJsonBackup}>
                  تنزيل نسخة احتياطية JSON
                </Button>
              </div>
              <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Input
                  placeholder="اسم اللقطة الاحتياطية (مثال: قبل تعديل حقول HR)"
                  value={snapshotTitle}
                  onChange={(e) => setSnapshotTitle(e.target.value)}
                />
                <Button variant="secondary" loading={busy} onClick={() => void handleSaveSnapshot()}>
                  حفظ لقطة
                </Button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto erp-scroll">
                {configSnapshots.map((snap) => (
                  <div key={snap.snapshotId} className="flex items-center justify-between py-2 text-xs">
                    <div>
                      <div className="font-bold">{snap.titleAr}</div>
                      <div className="text-[11px] text-slate-500">{snap.createdByEmail}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setImportJsonText(snap.payloadJson)}
                    >
                      معاينة الفروقات
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <SectionHeader title="استيراد ومقارنة التغييرات قبل التطبيق (Diff Preview)" />
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5" />
                  <span>رفع ملف JSON</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void f.text().then(setImportJsonText);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <Textarea
                rows={4}
                dir="ltr"
                className="font-mono-num text-xs"
                placeholder='{"systemSections": [...], "dynamicFields": [...]}'
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
              />
              {parsedImportDiff && parsedImportDiff.valid && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 p-3 space-y-2 text-xs">
                  <div className="font-bold text-blue-900 dark:text-blue-200">ملخص الفروقات قبل التطبيق:</div>
                  <div className="grid grid-cols-2 gap-2">
                    {parsedImportDiff.summary.map((s) => (
                      <div key={s.label} className="flex justify-between rounded bg-white/80 dark:bg-slate-900 px-2 py-1">
                        <span>{s.label}</span>
                        <span className="font-mono-num font-bold">
                          الحالي {s.current} ← المستورد {s.incoming}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button variant="primary" size="sm" loading={busy} onClick={() => void handleApplyConfigBundle(parsedImportDiff.data)}>
                    اعتماد وتطبيق الحزمة الآن
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <Card className="space-y-3">
            <SectionHeader title="سجل تغييرات منشئ النظام والإعدادات (Audit Diff Timeline)" />
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto erp-scroll text-xs">
              {auditLogs.slice(0, 40).map((log) => (
                <div key={log.logId} className="py-2.5 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{log.details}</div>
                    <div className="font-mono-num text-[11px] text-slate-500">
                      {log.action} · {log.actorEmail} · {log.targetCollection}/{log.targetId}
                    </div>
                  </div>
                  {(log.oldValue !== undefined || log.newValue !== undefined) && (
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-mono-num">
                      {log.oldValue !== undefined && (
                        <span className="rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-2 py-0.5 max-w-xs truncate">
                          قبل: {typeof log.oldValue === 'string' ? log.oldValue : JSON.stringify(log.oldValue)}
                        </span>
                      )}
                      {log.newValue !== undefined && (
                        <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 max-w-xs truncate">
                          بعد: {typeof log.newValue === 'string' ? log.newValue : JSON.stringify(log.newValue)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 7. TRASH & RECOVERY */}
      {subTab === 'trash' && (
        <Card className="space-y-4">
          <SectionHeader
            title={`سلة المحذوفات والاسترجاع الآمن (${activeTrash.length})`}
            subtitle="السجلات والحقول المحذوفة تُحفظ بلقطة كاملة تتيح الاسترجاع الفوري دون فقدان البيانات"
          />
          {activeTrash.length === 0 ? (
            <EmptyState title="سلة المحذوفات فارغة" subtitle="أي سجل أو حقل يتم حذفه بأمان سيظهر هنا لإمكانية استرجاعه." />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {activeTrash.map((item) => (
                <div key={item.trashId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{item.titleAr}</div>
                    <div className="font-mono-num text-[11px] text-slate-500">
                      {item.sourceCollection}/{item.sourceDocId} · حُذف بواسطة {item.deletedByEmail} · {item.deletedAt.slice(0, 10)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canRestoreTrash && (
                      <Button
                        size="sm"
                        variant="accent"
                        icon={<ArchiveRestore className="h-3.5 w-3.5" />}
                        loading={busy}
                        onClick={() => void handleRestoreTrashItem(item)}
                      >
                        استرجاع
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteDoc(doc(db, 'trashItems', item.trashId)).then(onRefresh)}
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                      title="حذف نهائي"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 8. SYSTEM HEALTH */}
      {subTab === 'health' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="secondary" icon={<RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? 'animate-spin' : ''}`} />} onClick={() => void fetchSystemHealth()}>
              فحص صحة الخادم وقاعدة البيانات الآن
            </Button>
          </div>
          {healthData ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="حالة قاعدة البيانات Firestore"
                  value={healthData.firestore.ok ? 'متصل' : 'خطأ'}
                  subtext={`زمن الاستجابة: ${healthData.firestore.latencyMs} ms`}
                  tone={healthData.firestore.ok ? 'good' : 'critical'}
                />
                <KpiCard
                  label="الخزينة الخاصة للمستندات"
                  value={`${healthData.privateVault.fileCount} ملف`}
                  subtext={`المساحة: ${healthData.privateVault.totalSizeMb} MB`}
                  tone={healthData.privateVault.ok ? 'good' : 'warn'}
                />
                <KpiCard
                  label="حالة الخادم والذاكرة"
                  value={`${healthData.memoryMb.heapUsed} MB`}
                  subtext={`RSS: ${healthData.memoryMb.rss} MB · تشغيل ${Math.round(healthData.uptimeSeconds / 60)} د`}
                />
                <KpiCard
                  label="دفعات استيراد Excel"
                  value={String(healthData.recentImportBatchesCount)}
                  subtext="مسجلة في Firestore"
                />
              </div>
              <Card className="space-y-3">
                <SectionHeader title="إحصائيات المجموعات الحية" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  {Object.entries(healthData.collections).map(([col, cnt]) => (
                    <div key={col} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between">
                      <span className="font-mono-num text-slate-600 dark:text-slate-300">{col}</span>
                      <span className="font-mono-num font-bold text-slate-900 dark:text-white">{cnt}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <EmptyState title="جاري تحميل مؤشرات صحة النظام..." subtitle="يتم فحص اتصال Firestore والخزينة الخاصة وحالة الخادم." />
          )}
        </div>
      )}

      {/* ADD / EDIT FIELD DRAWER (ALL 18 TYPES) */}
      <SlideDrawer
        open={fieldDrawerOpen}
        onClose={() => setFieldDrawerOpen(false)}
        size="lg"
        title={editingField ? `تعديل الحقل: ${editingField.labelAr}` : 'إضافة حقل ديناميكي جديد'}
        subtitle="اختر نوع الحقل من بين 18 نوعًا قياسيًا واضبط شروط التحقق والصلاحيات"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFieldDrawerOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="dynamic-field-editor-form" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
              {editingField ? 'حفظ تعديلات الحقل' : 'إنشاء وتفعيل الحقل'}
            </Button>
          </>
        }
      >
        <form id="dynamic-field-editor-form" onSubmit={(e) => void handleSaveField(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="النموذج المستهدف" required>
              <Select
                disabled={Boolean(editingField)}
                value={fForm.formId}
                onChange={(e) => setFForm({ ...fForm, formId: e.target.value })}
              >
                {allForms.map((f) => (
                  <option key={f.formId} value={f.formId}>
                    {f.nameAr}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="نوع الحقل (18 نوعاً)" required>
              <Select
                value={fForm.type}
                onChange={(e) => setFForm({ ...fForm, type: e.target.value as DynamicFieldType })}
              >
                {(Object.keys(DYNAMIC_FIELD_TYPE_META) as DynamicFieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {DYNAMIC_FIELD_TYPE_META[t].labelAr} ({t})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="اسم الحقل بالعربية" required>
              <Input
                required
                value={fForm.labelAr}
                onChange={(e) => setFForm({ ...fForm, labelAr: e.target.value })}
                placeholder="مثال: رقم الشريحة الاحتياطية"
              />
            </FormField>
            <FormField label="اسم الحقل بالإنجليزية">
              <Input
                dir="ltr"
                value={fForm.labelEn}
                onChange={(e) => setFForm({ ...fForm, labelEn: e.target.value })}
                placeholder="Backup SIM Number"
              />
            </FormField>
            <FormField label="المفتاح البرمجي (Key)" hint="يُولد تلقائيًا ويمكن تعديله عند الإنشاء فقط">
              <Input
                dir="ltr"
                className="font-mono-num"
                disabled={Boolean(editingField)}
                value={fForm.key}
                onChange={(e) => setFForm({ ...fForm, key: e.target.value })}
                placeholder="backup_sim_number"
              />
            </FormField>
            <FormField label="نص إرشادي (Placeholder)">
              <Input
                value={fForm.placeholderAr}
                onChange={(e) => setFForm({ ...fForm, placeholderAr: e.target.value })}
              />
            </FormField>
            <FormField label="القيمة الافتراضية" className="sm:col-span-2">
              <Input
                value={fForm.defaultValue}
                onChange={(e) => setFForm({ ...fForm, defaultValue: e.target.value })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs font-semibold">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fForm.required} onChange={(e) => setFForm({ ...fForm, required: e.target.checked })} />
              <span>حقل مطلوب</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fForm.visible} onChange={(e) => setFForm({ ...fForm, visible: e.target.checked })} />
              <span>ظاهر</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fForm.editable} onChange={(e) => setFForm({ ...fForm, editable: e.target.checked })} />
              <span>قابل للتعديل</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fForm.showInTable} onChange={(e) => setFForm({ ...fForm, showInTable: e.target.checked })} />
              <span>إظهار كعمود بالجدول</span>
            </label>
          </div>

          {(fForm.type === 'dropdown' || fForm.type === 'multiselect') && (
            <FormField label="خيارات القائمة (سطر لكل خيار، أو value|التسمية)" required>
              <Textarea
                rows={4}
                value={fForm.optionsText}
                onChange={(e) => setFForm({ ...fForm, optionsText: e.target.value })}
                placeholder={'stc|STC\nmobily|موبايلي\nzain|زين'}
              />
            </FormField>
          )}

          {fForm.type === 'formula' && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20 p-3">
              <FormField label="تعبير المعادلة الحسابية (Formula)" hint="مثال: ROUND({salary} + {bonus}, 2)">
                <Input
                  dir="ltr"
                  className="font-mono-num"
                  value={fForm.formulaExpression}
                  onChange={(e) => setFForm({ ...fForm, formulaExpression: e.target.value })}
                />
              </FormField>
              <div className="flex flex-wrap gap-1.5">
                {dynamicFields
                  .filter((x) => x.formId === fForm.formId && !x.archived && ['number', 'currency', 'percentage'].includes(x.type))
                  .map((chip) => (
                    <button
                      key={chip.fieldId}
                      type="button"
                      onClick={() => setFForm((p) => ({ ...p, formulaExpression: `${p.formulaExpression}{${chip.key}}` }))}
                      className="inline-flex items-center gap-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-mono-num"
                    >
                      <FileCode2 className="h-3 w-3 text-blue-600" />
                      {chip.labelAr} ({chip.key})
                    </button>
                  ))}
              </div>
              {fForm.formulaExpression && (
                <div className="text-[11px] text-slate-500 font-mono-num">
                  اختبار صيغة المعادلة: {evaluateFormula(fForm.formulaExpression, {}) ?? 'تأكد من الصياغة'}
                </div>
              )}
            </div>
          )}

          {(fForm.type === 'image' || fForm.type === 'pdf' || fForm.type === 'file') && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <FormField label="الحد الأقصى للملف (MB)">
                <Input
                  type="number"
                  className="font-mono-num"
                  value={fForm.maxSizeMb}
                  onChange={(e) => setFForm({ ...fForm, maxSizeMb: e.target.value })}
                />
              </FormField>
              <label className="flex items-center gap-2 text-xs font-semibold pt-6">
                <input
                  type="checkbox"
                  checked={fForm.multipleFiles}
                  onChange={(e) => setFForm({ ...fForm, multipleFiles: e.target.checked })}
                />
                <span>السماح برفع عدة ملفات</span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField label="أدنى رقم">
              <Input type="number" className="font-mono-num" value={fForm.min} onChange={(e) => setFForm({ ...fForm, min: e.target.value })} />
            </FormField>
            <FormField label="أقصى رقم">
              <Input type="number" className="font-mono-num" value={fForm.max} onChange={(e) => setFForm({ ...fForm, max: e.target.value })} />
            </FormField>
            <FormField label="تعبير Regex">
              <Input dir="ltr" className="font-mono-num" value={fForm.pattern} onChange={(e) => setFForm({ ...fForm, pattern: e.target.value })} />
            </FormField>
            <FormField label="رسالة الخطأ المخصصة">
              <Input value={fForm.customErrorAr} onChange={(e) => setFForm({ ...fForm, customErrorAr: e.target.value })} />
            </FormField>
          </div>
        </form>
      </SlideDrawer>

      <ConfirmModal
        open={Boolean(deleteFieldTarget)}
        title="تأكيد حذف الحقل ونقله إلى سلة المحذوفات"
        description={
          deleteFieldTarget
            ? deleteFieldTarget.impactCount > 0
              ? `تنبيه: يوجد ${deleteFieldTarget.impactCount} سجل يحتوي بيانات محفوظة للحقل "${deleteFieldTarget.field.labelAr}". لن تُحذف قيم السجلات القديمة، وسيتم نقل تعريف الحقل إلى سلة المحذوفات لإمكانية استرجاعه.`
              : `هل تريد حذف الحقل "${deleteFieldTarget.field.labelAr}" ونقله إلى سلة المحذوفات؟`
            : ''
        }
        danger
        busy={busy}
        onCancel={() => setDeleteFieldTarget(null)}
        onConfirm={() => void handleConfirmDeleteField()}
      />
    </div>
  );
}
