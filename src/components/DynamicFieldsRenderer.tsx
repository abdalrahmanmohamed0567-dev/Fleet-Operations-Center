import {
  Calculator,
  Check,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Lock,
  Paperclip,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  DynamicFieldDefinition,
  DynamicFormDefinition,
  UserProfile,
} from '../types/fleet';
import { getActiveAuthToken } from '../lib/firebase';
import {
  buildEffectiveFormSchema,
  canEditDynamicField,
  canViewDynamicField,
  evaluateFormula,
  formatDynamicFieldDisplayValue,
} from '../lib/dynamicSchemaEngine';
import { Button, FormField, Input, Select, StatusBadge, Textarea } from './ui/EnterpriseUI';

export interface UploadedCustomFileRef {
  docId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

interface DynamicFieldsRendererProps {
  formId: string;
  entityId: string;
  entityLabel?: string;
  dynamicFields: DynamicFieldDefinition[];
  dynamicForms: DynamicFormDefinition[];
  values: Record<string, unknown>;
  onChange?: (nextValues: Record<string, unknown>) => void;
  user: UserProfile | null;
  mode?: 'form' | 'readonly';
  errors?: Record<string, string>;
  contextValues?: Record<string, unknown>;
  title?: string;
}

function normalizeFileList(raw: unknown): UploadedCustomFileRef[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is UploadedCustomFileRef => typeof x === 'object' && x !== null && 'docId' in x);
  }
  if (typeof raw === 'object' && 'docId' in raw) {
    return [raw as UploadedCustomFileRef];
  }
  return [];
}

export function DynamicFieldsRenderer({
  formId,
  entityId,
  entityLabel,
  dynamicFields,
  dynamicForms,
  values,
  onChange,
  user,
  mode = 'form',
  errors = {},
  contextValues = {},
  title,
}: DynamicFieldsRendererProps) {
  const schema = useMemo(
    () => buildEffectiveFormSchema({ formId, dynamicForms, dynamicFields }),
    [formId, dynamicForms, dynamicFields]
  );

  const visiblePlacements = useMemo(() => {
    return schema.placements.filter((p) => {
      const f = schema.fieldsById.get(p.fieldId);
      if (!f) return false;
      return canViewDynamicField(f, user);
    });
  }, [schema, user]);

  const activeSections = useMemo(() => {
    const usedIds = new Set(visiblePlacements.map((p) => p.sectionId));
    return schema.sections.filter((s) => usedIds.has(s.sectionId));
  }, [schema.sections, visiblePlacements]);

  const [activeTabId, setActiveTabId] = useState<string>('');
  const [wizardIdx, setWizardIdx] = useState(0);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');

  if (visiblePlacements.length === 0) return null;

  const effectiveTabId =
    activeTabId && activeSections.some((s) => s.sectionId === activeTabId)
      ? activeTabId
      : activeSections[0]?.sectionId || '';

  const effectiveWizardIdx = Math.min(wizardIdx, Math.max(0, activeSections.length - 1));
  const mergedFormulaCtx: Record<string, unknown> = { ...contextValues, ...values };

  const setFieldValue = (key: string, val: unknown) => {
    if (!onChange) return;
    onChange({ ...values, [key]: val });
  };

  const handleUploadCustomFile = async (field: DynamicFieldDefinition, file: File) => {
    setUploadError('');
    const maxMb = field.fileConfig?.maxSizeMb || 15;
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(`حجم الملف يتجاوز الحد المسموح (${maxMb} ميجابايت) لحقل ${field.labelAr}.`);
      return;
    }
    try {
      setUploadingKey(field.key);
      const token = await getActiveAuthToken();
      if (!token) throw new Error('يرجى تسجيل الدخول لرفع المرفق.');

      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'custom_field');
      fd.append('entityId', `${formId}_${entityId || 'draft'}`);
      fd.append('entityLabel', entityLabel || formId);
      fd.append('docTypeId', field.key);
      fd.append('docTypeName', field.labelAr);
      fd.append('title', `${field.labelAr} - ${file.name}`);

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = (await res.json()) as { document?: { docId: string }; error?: string };
      if (!res.ok || !data.document?.docId) {
        throw new Error(data.error || 'فشل رفع الملف للخزينة.');
      }

      const ref: UploadedCustomFileRef = {
        docId: data.document.docId,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      if (field.fileConfig?.multiple) {
        const prev = normalizeFileList(values[field.key]);
        setFieldValue(field.key, [...prev, ref]);
      } else {
        setFieldValue(field.key, ref);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'تعذر رفع الملف.');
    } finally {
      setUploadingKey(null);
    }
  };

  const openVaultFile = async (docId: string, download: boolean) => {
    try {
      const token = await getActiveAuthToken();
      if (!token) return;
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/file?download=${download ? '1' : '0'}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = download ? `${docId}` : '';
      if (!download) a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      // ignore
    }
  };

  const sectionsToRender =
    mode === 'readonly' || schema.formMeta.layoutMode === 'sections' || activeSections.length <= 1
      ? activeSections
      : schema.formMeta.layoutMode === 'tabs'
        ? activeSections.filter((s) => s.sectionId === effectiveTabId)
        : [activeSections[effectiveWizardIdx]].filter(Boolean);

  return (
    <div className="space-y-4">
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</h4>
          <StatusBadge label={`${visiblePlacements.length} حقل مخصص`} tone="info" />
        </div>
      )}

      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {uploadError}
        </div>
      )}

      {mode === 'form' && schema.formMeta.layoutMode === 'tabs' && activeSections.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
          {activeSections.map((sec) => (
            <button
              key={sec.sectionId}
              type="button"
              onClick={() => setActiveTabId(sec.sectionId)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                sec.sectionId === effectiveTabId
                  ? 'bg-[#0f1e36] text-white dark:bg-blue-600'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {sec.titleAr}
            </button>
          ))}
        </div>
      )}

      {mode === 'form' && schema.formMeta.layoutMode === 'wizard' && activeSections.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {activeSections.map((sec, idx) => (
              <button
                key={sec.sectionId}
                type="button"
                onClick={() => setWizardIdx(idx)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  idx === effectiveWizardIdx
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                <span className="font-mono-num">{idx + 1}</span>
                <span>{sec.titleAr}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={effectiveWizardIdx <= 0}
              onClick={() => setWizardIdx((i) => Math.max(0, i - 1))}
            >
              السابق
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={effectiveWizardIdx >= activeSections.length - 1}
              onClick={() => setWizardIdx((i) => Math.min(activeSections.length - 1, i + 1))}
            >
              التالي
            </Button>
          </div>
        </div>
      )}

      {sectionsToRender.map((sec) => {
        const secPlacements = visiblePlacements.filter((p) => p.sectionId === sec.sectionId);
        if (secPlacements.length === 0) return null;

        return (
          <div
            key={sec.sectionId}
            className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">{sec.titleAr}</h5>
                {sec.descriptionAr && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{sec.descriptionAr}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
              {secPlacements.map((placement) => {
                const field = schema.fieldsById.get(placement.fieldId)!;
                const widthCls =
                  placement.width === 'full'
                    ? 'md:col-span-12'
                    : placement.width === 'third'
                      ? 'md:col-span-4'
                      : 'md:col-span-6';
                const rawVal =
                  values[field.key] !== undefined ? values[field.key] : field.defaultValue ?? '';
                const editable = mode === 'form' && canEditDynamicField(field, placement, user);
                const err = errors[field.key];
                const isReq = placement.requiredOverride ?? field.required;

                if (mode === 'readonly') {
                  const fileRefs = normalizeFileList(rawVal);
                  return (
                    <div
                      key={field.fieldId}
                      className={`${widthCls} rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2`}
                    >
                      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {field.labelAr}
                      </div>
                      {fileRefs.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {fileRefs.map((fr) => (
                            <button
                              key={fr.docId}
                              type="button"
                              onClick={() => void openVaultFile(fr.docId, false)}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                            >
                              <Paperclip className="h-3 w-3" />
                              <span className="truncate max-w-[160px]">{fr.fileName}</span>
                            </button>
                          ))}
                        </div>
                      ) : field.type === 'url' && typeof rawVal === 'string' && rawVal.startsWith('http') ? (
                        <a
                          href={rawVal}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          <span className="truncate max-w-[220px]">{rawVal}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <div className="mt-0.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                          {formatDynamicFieldDisplayValue(field, rawVal, mergedFormulaCtx)}
                        </div>
                      )}
                    </div>
                  );
                }

                // Editable/Readonly Form Input Rendering across all 18 types
                return (
                  <div key={field.fieldId} className={widthCls}>
                    <FormField
                      label={field.labelAr}
                      required={isReq}
                      hint={
                        !editable
                          ? field.type === 'formula'
                            ? 'محسوب تلقائيًا'
                            : 'للقراءة فقط'
                          : field.description
                      }
                      error={err}
                    >
                      {field.type === 'formula' ? (
                        <div className="flex h-9 items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100">
                          <span className="font-mono-num">
                            {evaluateFormula(field.formulaExpression, mergedFormulaCtx) ?? '—'}
                          </span>
                          <Calculator className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                      ) : field.type === 'long_text' ? (
                        <Textarea
                          disabled={!editable}
                          value={String(rawVal ?? '')}
                          placeholder={field.placeholderAr || ''}
                          onChange={(e) => setFieldValue(field.key, e.target.value)}
                        />
                      ) : field.type === 'dropdown' ? (
                        <Select
                          disabled={!editable}
                          value={String(rawVal ?? '')}
                          onChange={(e) => setFieldValue(field.key, e.target.value)}
                        >
                          <option value="">— اختر —</option>
                          {(field.options || []).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.labelAr}
                            </option>
                          ))}
                        </Select>
                      ) : field.type === 'multiselect' ? (
                        <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 min-h-[38px]">
                          {(field.options || []).map((opt) => {
                            const selectedList = Array.isArray(rawVal) ? rawVal.map(String) : [];
                            const isSelected = selectedList.includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                disabled={!editable}
                                onClick={() => {
                                  const next = isSelected
                                    ? selectedList.filter((v) => v !== opt.value)
                                    : [...selectedList, opt.value];
                                  setFieldValue(field.key, next);
                                }}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                  isSelected
                                    ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3" />}
                                <span>{opt.labelAr}</span>
                              </button>
                            );
                          })}
                          {(!field.options || field.options.length === 0) && (
                            <span className="text-[11px] text-slate-400">لا توجد خيارات معرفة</span>
                          )}
                        </div>
                      ) : field.type === 'checkbox' ? (
                        <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3">
                          <input
                            type="checkbox"
                            disabled={!editable}
                            checked={rawVal === true || rawVal === 'true'}
                            onChange={(e) => setFieldValue(field.key, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          <span className="text-xs text-slate-700 dark:text-slate-200">
                            {field.placeholderAr || field.labelAr}
                          </span>
                        </div>
                      ) : field.type === 'boolean' ? (
                        <Select
                          disabled={!editable}
                          value={rawVal === true || rawVal === 'true' ? 'true' : rawVal === false || rawVal === 'false' ? 'false' : ''}
                          onChange={(e) =>
                            setFieldValue(
                              field.key,
                              e.target.value === '' ? '' : e.target.value === 'true'
                            )
                          }
                        >
                          <option value="">— اختر —</option>
                          <option value="true">نعم</option>
                          <option value="false">لا</option>
                        </Select>
                      ) : field.type === 'image' || field.type === 'pdf' || field.type === 'file' ? (
                        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label
                              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 ${
                                !editable ? 'pointer-events-none opacity-50' : ''
                              }`}
                            >
                              {field.type === 'image' ? (
                                <ImageIcon className="h-3.5 w-3.5 text-blue-600" />
                              ) : field.type === 'pdf' ? (
                                <FileText className="h-3.5 w-3.5 text-red-600" />
                              ) : (
                                <Upload className="h-3.5 w-3.5 text-blue-600" />
                              )}
                              <span>
                                {uploadingKey === field.key
                                  ? 'جاري الرفع...'
                                  : field.fileConfig?.multiple
                                    ? 'إرفاق ملفات'
                                    : 'اختيار ملف'}
                              </span>
                              <input
                                type="file"
                                className="hidden"
                                disabled={!editable || uploadingKey === field.key}
                                accept={
                                  field.type === 'image'
                                    ? 'image/png,image/jpeg,image/webp'
                                    : field.type === 'pdf'
                                      ? 'application/pdf'
                                      : '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.txt'
                                }
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void handleUploadCustomFile(field, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            <span className="text-[10px] text-slate-400">
                              الحد: {field.fileConfig?.maxSizeMb || 15} MB
                            </span>
                          </div>
                          {normalizeFileList(rawVal).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {normalizeFileList(rawVal).map((fr) => (
                                <div
                                  key={fr.docId}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-[11px]"
                                >
                                  <button
                                    type="button"
                                    onClick={() => void openVaultFile(fr.docId, false)}
                                    className="font-semibold text-blue-600 hover:underline truncate max-w-[150px]"
                                  >
                                    {fr.fileName}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void openVaultFile(fr.docId, true)}
                                    title="تنزيل"
                                    className="text-slate-500 hover:text-slate-800"
                                  >
                                    <Download className="h-3 w-3" />
                                  </button>
                                  {editable && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (field.fileConfig?.multiple) {
                                          setFieldValue(
                                            field.key,
                                            normalizeFileList(rawVal).filter((x) => x.docId !== fr.docId)
                                          );
                                        } else {
                                          setFieldValue(field.key, '');
                                        }
                                      }}
                                      className="text-red-500 hover:text-red-700"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="relative">
                          <Input
                            disabled={!editable}
                            type={
                              field.type === 'number' || field.type === 'currency' || field.type === 'percentage'
                                ? 'number'
                                : field.type === 'date'
                                  ? 'date'
                                  : field.type === 'datetime'
                                    ? 'datetime-local'
                                    : field.type === 'email'
                                      ? 'email'
                                      : field.type === 'url'
                                        ? 'url'
                                        : field.type === 'phone'
                                          ? 'tel'
                                          : 'text'
                            }
                            step={field.type === 'currency' || field.type === 'percentage' || field.type === 'number' ? 'any' : undefined}
                            dir={field.type === 'phone' || field.type === 'email' || field.type === 'url' ? 'ltr' : undefined}
                            value={String(rawVal ?? '')}
                            placeholder={field.placeholderAr || ''}
                            onChange={(e) => {
                              const v =
                                field.type === 'number' || field.type === 'currency' || field.type === 'percentage'
                                  ? e.target.value === ''
                                    ? ''
                                    : Number(e.target.value)
                                  : e.target.value;
                              setFieldValue(field.key, v);
                            }}
                            className={
                              field.type === 'currency' || field.type === 'percentage' || !editable ? 'pl-14' : ''
                            }
                          />
                          {field.type === 'currency' && (
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                              ر.س
                            </span>
                          )}
                          {field.type === 'percentage' && (
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                              %
                            </span>
                          )}
                          {!editable && field.type !== 'currency' && field.type !== 'percentage' && (
                            <Lock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                      )}
                    </FormField>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
