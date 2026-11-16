import { doc, serverTimestamp, setDoc } from '../lib/erpDb';
import { ArrowDown, ArrowUp, Download, Eye, FileText, Image as ImageIcon, Printer, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { exportExcelInBrowser } from '../lib/clientExcelFallback';
import { formatDynamicFieldDisplayValue } from '../lib/dynamicSchemaEngine';
import { computeAllDocumentExpiries, EMPLOYEE_HR_STATUS_LABELS, VEHICLE_STATUS_LABELS, writeErpAuditLog } from '../lib/erpHelpers';
import { db, getActiveAuthToken } from '../lib/firebase';
import type { FleetDataset, UnifiedDailyRow } from '../lib/fleetAnalytics';
import { exportArabicTableToPdf } from '../lib/pdfExport';
import { safeParseJsonResponse } from '../lib/safeFetch';
import type { ExportColumn } from '../shared/exportCore';
import type {
  CompanyBrandingDoc,
  CustomEntityRecord,
  CustomReportTemplate,
  DynamicFieldDefinition,
  OperationalSettings,
  PrivateDocumentRecord,
  SystemPageConfig,
  UserProfile,
  VehicleMaintenanceRecord,
  VehicleMaster,
} from '../types/fleet';
import { ReportImageShareModal } from './ReportImageShareModal';
import {
  Button,
  Card,
  FormField,
  Input,
  SectionHeader,
  Select,
  ToastBanner,
} from './ui/EnterpriseUI';

interface CustomReportDesignerProps {
  dataset: FleetDataset;
  unifiedRows: UnifiedDailyRow[];
  vehicles: VehicleMaster[];
  maintenance: VehicleMaintenanceRecord[];
  privateDocs: PrivateDocumentRecord[];
  settings: OperationalSettings;
  branding: CompanyBrandingDoc;
  dynamicFields: DynamicFieldDefinition[];
  systemPages: SystemPageConfig[];
  customEntityRecords: CustomEntityRecord[];
  reportTemplates: CustomReportTemplate[];
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}

interface SourceColDef {
  key: string;
  header: string;
}

export function CustomReportDesigner({
  dataset,
  unifiedRows,
  vehicles,
  maintenance,
  privateDocs,
  settings,
  branding,
  dynamicFields,
  systemPages,
  customEntityRecords,
  reportTemplates,
  currentUser,
  allowedUids,
  onRefresh,
}: CustomReportDesignerProps) {
  const [sourceType, setSourceType] = useState<'riders' | 'vehicles' | 'operations_daily' | 'expiries' | 'maintenance' | 'custom_page'>('riders');
  const [customPageId, setCustomPageId] = useState<string>(systemPages[0]?.pageId || '');
  const [reportTitle, setReportTitle] = useState('تقرير مخصص — بيانات المندوبين');
  const [reportSubtitle, setReportSubtitle] = useState('نسخة رسمية معتمدة صادرة من مركز عمليات الأسطول');
  const [preparer, setPreparer] = useState(currentUser.displayName || currentUser.email);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [includeLogo, setIncludeLogo] = useState(true);
  const [includeCompanyDetails, setIncludeCompanyDetails] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(['internalRiderId', 'fullName', 'iqamaNumber', 'branch', 'status']);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const riderCustomFields = useMemo(() => dynamicFields.filter((f) => f.formId === 'hr_rider' && !f.archived), [dynamicFields]);
  const vehicleCustomFields = useMemo(() => dynamicFields.filter((f) => f.formId === 'fleet_vehicle' && !f.archived), [dynamicFields]);

  const availableColumns: SourceColDef[] = useMemo(() => {
    if (sourceType === 'riders') {
      return [
        { key: 'internalRiderId', header: 'رقم الشركة' },
        { key: 'fullName', header: 'الاسم الكامل' },
        { key: 'iqamaNumber', header: 'رقم الإقامة' },
        { key: 'iqamaExpiryDate', header: 'انتهاء الإقامة' },
        { key: 'phone', header: 'الجوال' },
        { key: 'nationality', header: 'الجنسية' },
        { key: 'branch', header: 'الفرع' },
        { key: 'city', header: 'المدينة' },
        { key: 'status', header: 'الحالة الوظيفية' },
        ...riderCustomFields.map((f) => ({ key: `cf_${f.key}`, header: f.labelAr })),
      ];
    }
    if (sourceType === 'vehicles') {
      return [
        { key: 'vehicleInternalId', header: 'رقم المركبة' },
        { key: 'plateNumber', header: 'رقم اللوحة' },
        { key: 'makeModel', header: 'الشركة والموديل' },
        { key: 'vehicleType', header: 'النوع' },
        { key: 'status', header: 'الحالة' },
        { key: 'currentRiderId', header: 'المندوب المستلم' },
        { key: 'istimaraExpiryDate', header: 'انتهاء الاستمارة' },
        { key: 'insuranceExpiryDate', header: 'انتهاء التأمين' },
        ...vehicleCustomFields.map((f) => ({ key: `cf_${f.key}`, header: f.labelAr })),
      ];
    }
    if (sourceType === 'operations_daily') {
      return [
        { key: 'date', header: 'التاريخ' },
        { key: 'platform', header: 'المنصة' },
        { key: 'riderId', header: 'معرف المندوب' },
        { key: 'riderName', header: 'الاسم' },
        { key: 'branch', header: 'الفرع' },
        { key: 'completedOrders', header: 'الطلبات المكتملة' },
        { key: 'workingHours', header: 'الساعات' },
        { key: 'totalKm', header: 'المسافة (كم)' },
      ];
    }
    if (sourceType === 'expiries') {
      return [
        { key: 'domain', header: 'القسم' },
        { key: 'entityName', header: 'المندوب / المركبة' },
        { key: 'docCategory', header: 'الوثيقة' },
        { key: 'docNumber', header: 'الرقم' },
        { key: 'expiryDate', header: 'تاريخ الانتهاء' },
        { key: 'daysRemaining', header: 'الأيام المتبقية' },
      ];
    }
    if (sourceType === 'maintenance') {
      return [
        { key: 'plateNumber', header: 'اللوحة' },
        { key: 'maintenanceType', header: 'نوع الصيانة' },
        { key: 'maintenanceDate', header: 'التاريخ' },
        { key: 'cost', header: 'التكلفة (ر.س)' },
        { key: 'workshop', header: 'الورشة' },
        { key: 'details', header: 'التفاصيل' },
      ];
    }
    const pageObj = systemPages.find((p) => p.pageId === customPageId) || systemPages[0];
    const formId = pageObj?.formId || pageObj?.pageId || '';
    const pageFields = dynamicFields.filter((f) => f.formId === formId && !f.archived);
    return [
      { key: 'recordId', header: 'المعرف' },
      { key: 'title', header: 'العنوان' },
      { key: 'status', header: 'الحالة' },
      ...pageFields.map((f) => ({ key: `cf_${f.key}`, header: f.labelAr })),
    ];
  }, [sourceType, riderCustomFields, vehicleCustomFields, systemPages, customPageId, dynamicFields]);

  const rawRows: Array<Record<string, unknown>> = useMemo(() => {
    if (sourceType === 'riders') {
      return dataset.riderMaster.map((r) => {
        const row: Record<string, unknown> = {
          internalRiderId: r.internalRiderId,
          fullName: r.fullName,
          iqamaNumber: r.iqamaNumber || '—',
          iqamaExpiryDate: r.iqamaExpiryDate || '—',
          phone: r.phone || '—',
          nationality: r.nationality || '—',
          branch: r.branch || '—',
          city: r.city || '—',
          status: EMPLOYEE_HR_STATUS_LABELS[r.status] || r.status,
        };
        for (const f of riderCustomFields) {
          row[`cf_${f.key}`] = formatDynamicFieldDisplayValue(f, r.customFields?.[f.key], r.customFields || {});
        }
        return row;
      });
    }
    if (sourceType === 'vehicles') {
      return vehicles.map((v) => {
        const row: Record<string, unknown> = {
          vehicleInternalId: v.vehicleInternalId,
          plateNumber: v.plateNumber,
          makeModel: `${v.make} ${v.model} ${v.year || ''}`.trim(),
          vehicleType: v.vehicleType,
          status: VEHICLE_STATUS_LABELS[v.status] || v.status,
          currentRiderId: v.currentRiderId || 'غير مسلمة',
          istimaraExpiryDate: v.istimaraExpiryDate || '—',
          insuranceExpiryDate: v.insuranceExpiryDate || '—',
        };
        for (const f of vehicleCustomFields) {
          row[`cf_${f.key}`] = formatDynamicFieldDisplayValue(f, v.customFields?.[f.key], v.customFields || {});
        }
        return row;
      });
    }
    if (sourceType === 'operations_daily') {
      return unifiedRows.slice(0, 400).map((r) => ({
        date: r.date,
        platform: r.platform === 'hungerstation' ? 'HungerStation' : 'Keeta',
        riderId: r.riderId,
        riderName: r.riderName,
        branch: r.branch || r.city || '—',
        completedOrders: r.completedOrders ?? 0,
        workingHours: r.workingHours ?? 0,
        totalKm: r.totalKm ?? 0,
      }));
    }
    if (sourceType === 'expiries') {
      return computeAllDocumentExpiries({
        riders: dataset.riderMaster,
        vehicles,
        privateDocs,
        settings,
      }).map((e) => ({
        domain: e.domain === 'fleet' ? 'الأسطول' : 'الموارد البشرية',
        entityName: e.entityName,
        docCategory: e.docCategory,
        docNumber: e.docNumber || '—',
        expiryDate: e.expiryDate,
        daysRemaining: e.daysRemaining,
      }));
    }
    if (sourceType === 'maintenance') {
      return maintenance.map((m) => ({
        plateNumber: m.plateNumber,
        maintenanceType: m.maintenanceType,
        maintenanceDate: m.maintenanceDate,
        cost: m.cost ?? 0,
        workshop: m.workshop || '—',
        details: m.details || '—',
      }));
    }
    const targetPage = systemPages.find((p) => p.pageId === customPageId) || systemPages[0];
    const formId = targetPage?.formId || targetPage?.pageId || '';
    const pageFields = dynamicFields.filter((f) => f.formId === formId && !f.archived);
    return customEntityRecords
      .filter((r) => targetPage && r.pageId === targetPage.pageId)
      .map((r) => {
        const row: Record<string, unknown> = {
          recordId: r.recordId,
          title: r.title || '—',
          status: r.status || 'active',
        };
        for (const f of pageFields) {
          row[`cf_${f.key}`] = formatDynamicFieldDisplayValue(f, r.customFields?.[f.key], r.customFields || {});
        }
        return row;
      });
  }, [sourceType, dataset.riderMaster, riderCustomFields, vehicles, vehicleCustomFields, unifiedRows, privateDocs, settings, maintenance, systemPages, customPageId, dynamicFields, customEntityRecords]);

  const activeColumns: ExportColumn[] = useMemo(() => {
    const map = new Map(availableColumns.map((c) => [c.key, c]));
    return selectedKeys
      .map((k) => map.get(k))
      .filter((c): c is SourceColDef => Boolean(c))
      .map((c) => ({ key: c.key, header: c.header, width: 20 }));
  }, [availableColumns, selectedKeys]);

  const handleSourceChange = (next: typeof sourceType) => {
    setSourceType(next);
    if (next === 'riders') setSelectedKeys(['internalRiderId', 'fullName', 'iqamaNumber', 'branch', 'status']);
    else if (next === 'vehicles') setSelectedKeys(['vehicleInternalId', 'plateNumber', 'makeModel', 'status', 'currentRiderId']);
    else if (next === 'operations_daily') setSelectedKeys(['date', 'riderId', 'riderName', 'completedOrders', 'workingHours']);
    else if (next === 'expiries') setSelectedKeys(['domain', 'entityName', 'docCategory', 'expiryDate', 'daysRemaining']);
    else if (next === 'maintenance') setSelectedKeys(['plateNumber', 'maintenanceType', 'maintenanceDate', 'cost', 'workshop']);
    else setSelectedKeys(['recordId', 'title', 'status']);
  };

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    const idx = selectedKeys.indexOf(key);
    if (idx < 0) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= selectedKeys.length) return;
    const copy = [...selectedKeys];
    [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
    setSelectedKeys(copy);
  };

  const handleSaveTemplate = async () => {
    if (!reportTitle.trim() || activeColumns.length === 0) return;
    setBusy(true);
    setToast(null);
    try {
      const templateId = `rpt_${Date.now().toString(36)}`;
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      await setDoc(doc(db, 'customReportTemplates', templateId), {
        templateId,
        nameAr: reportTitle.trim().slice(0, 140),
        dataSource: sourceType,
        ...(sourceType === 'custom_page' && customPageId ? { customPageId } : {}),
        columns: activeColumns.map((c) => ({ key: c.key, labelAr: c.header })),
        headerTitle: reportTitle.trim().slice(0, 180),
        headerSubtitle: reportSubtitle.trim().slice(0, 250),
        footerNote: (branding.company?.officialFooterText || '').slice(0, 300),
        preparerName: (preparer || currentUser.email).slice(0, 120),
        includeCompanyLogo: includeLogo,
        includeCompanyDetails,
        orientation,
        createdByUid: currentUser.uid,
        createdByEmail: currentUser.email,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeErpAuditLog({
        action: 'CUSTOM_REPORT_TEMPLATE_SAVED',
        targetCollection: 'customReportTemplates',
        targetId: templateId,
        entityType: 'report_template',
        details: `حفظ قالب تقرير مخصص: ${reportTitle.trim()}`,
        user: currentUser,
        allowedUids,
      });
      setToast({ type: 'ok', msg: 'تم حفظ قالب التقرير المخصص لاستخدامه لاحقًا.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل حفظ القالب.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportPdf = async () => {
    if (activeColumns.length === 0 || rawRows.length === 0) return;
    setBusy(true);
    try {
      await exportArabicTableToPdf({
        title: reportTitle,
        subtitle: reportSubtitle,
        columns: activeColumns,
        rows: rawRows,
        fileName: `custom_report_${new Date().toISOString().slice(0, 10)}.pdf`,
        branding,
        orientation,
        preparer,
        includeLogo,
        includeCompanyDetails,
      });
      setToast({ type: 'ok', msg: 'تم تصدير التقرير المخصص بصيغة PDF بنجاح.' });
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تصدير PDF.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportExcel = async () => {
    if (activeColumns.length === 0 || rawRows.length === 0) return;
    setBusy(true);
    try {
      const fileName = `custom_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const token = await getActiveAuthToken();
      if (token) {
        try {
          const res = await fetch('/api/export/excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ fileName, sheetName: reportTitle.slice(0, 30), columns: activeColumns, rows: rawRows }),
          });
          if (res.ok) {
            const json = await safeParseJsonResponse<{ fileBase64?: string }>(res);
            if (json.fileBase64) {
              const bytes = Uint8Array.from(atob(json.fileBase64), (c) => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              a.click();
              URL.revokeObjectURL(url);
              setToast({ type: 'ok', msg: `تم تصدير التقرير (${fileName}) بنجاح.` });
              return;
            }
          }
        } catch {
          // fallback to browser excel
        }
      }
      await exportExcelInBrowser({ title: reportTitle, fileName, sheetName: reportTitle.slice(0, 30), columns: activeColumns, rows: rawRows });
      setToast({ type: 'ok', msg: `تم تصدير التقرير (${fileName}) بنجاح.` });
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل تصدير Excel.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 no-print">
        <Card className="space-y-4">
          <SectionHeader title="إعدادات التقرير ومصدر البيانات" />

          {reportTemplates.length > 0 && (
            <FormField label="تحميل قالب محفوظ">
              <Select
                value=""
                onChange={(e) => {
                  const tpl = reportTemplates.find((t) => t.templateId === e.target.value);
                  if (!tpl) return;
                  setSourceType(tpl.dataSource);
                  if (tpl.customPageId) setCustomPageId(tpl.customPageId);
                  setReportTitle(tpl.headerTitle || tpl.nameAr);
                  setReportSubtitle(tpl.headerSubtitle || '');
                  if (tpl.preparerName) setPreparer(tpl.preparerName);
                  setSelectedKeys((tpl.columns || []).map((c) => c.key));
                  setIncludeLogo(tpl.includeCompanyLogo);
                  setIncludeCompanyDetails(tpl.includeCompanyDetails);
                  setOrientation(tpl.orientation);
                }}
              >
                <option value="">-- اختر قالبًا محفوظًا --</option>
                {reportTemplates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.nameAr}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          <FormField label="مصدر البيانات">
            <Select value={sourceType} onChange={(e) => handleSourceChange(e.target.value as typeof sourceType)}>
              <option value="riders">المندوبون والموارد البشرية (+ الحقول المخصصة)</option>
              <option value="vehicles">السيارات والأسطول (+ الحقول المخصصة)</option>
              <option value="operations_daily">العمليات اليومية للمندوبين</option>
              <option value="expiries">تواريخ انتهاء الوثائق والاقامات</option>
              <option value="maintenance">صيانة وتكاليف الأسطول</option>
              {systemPages.length > 0 && <option value="custom_page">صفحة إدارية مخصصة</option>}
            </Select>
          </FormField>

          {sourceType === 'custom_page' && (
            <FormField label="الصفحة المخصصة">
              <Select value={customPageId} onChange={(e) => setCustomPageId(e.target.value)}>
                {systemPages.map((p) => (
                  <option key={p.pageId} value={p.pageId}>
                    {p.titleAr}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          <FormField label="عنوان التقرير الرئيسي">
            <Input value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
          </FormField>
          <FormField label="العنوان الفرعي / الوصف">
            <Input value={reportSubtitle} onChange={(e) => setReportSubtitle(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="معد التقرير">
              <Input value={preparer} onChange={(e) => setPreparer(e.target.value)} />
            </FormField>
            <FormField label="اتجاه الورقة">
              <Select value={orientation} onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}>
                <option value="landscape">أفقي (Landscape)</option>
                <option value="portrait">عمودي (Portrait)</option>
              </Select>
            </FormField>
          </div>

          <div className="space-y-2 text-xs font-medium text-slate-700 dark:text-slate-200">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeLogo} onChange={(e) => setIncludeLogo(e.target.checked)} className="rounded" />
              <span>تضمين شعار الشركة في الترويسة</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeCompanyDetails} onChange={(e) => setIncludeCompanyDetails(e.target.checked)} className="rounded" />
              <span>تضمين السجل التجاري والضريبي وتذييل الشركة</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button size="sm" variant="secondary" icon={<Save className="h-3.5 w-3.5" />} loading={busy} onClick={() => void handleSaveTemplate()}>
              حفظ كقالب
            </Button>
            <Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreviewOpen((p) => !p)}>
              {previewOpen ? 'إخفاء المعاينة' : 'معاينة الطباعة'}
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2 space-y-4">
          <SectionHeader
            title={`اختيار وترتيب الأعمدة (${activeColumns.length} عمود · ${rawRows.length} سجل)`}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>
                  طباعة
                </Button>
                <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} loading={busy} onClick={() => void handleExportPdf()}>
                  PDF
                </Button>
                <Button
                  size="sm"
                  variant="accent"
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  disabled={rawRows.length === 0 || activeColumns.length === 0}
                  onClick={() => setImageModalOpen(true)}
                >
                  صورة ومشاركة
                </Button>
                <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} loading={busy} onClick={() => void handleExportExcel()}>
                  Excel
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">الحقول والأعمدة المتاحة</div>
              <div className="max-h-60 overflow-y-auto erp-scroll space-y-1.5">
                {availableColumns.map((col) => {
                  const checked = selectedKeys.includes(col.key);
                  return (
                    <label
                      key={col.key}
                      className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-800 px-2.5 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">{col.header}</span>
                      <input type="checkbox" checked={checked} onChange={() => toggleColumn(col.key)} className="rounded" />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">ترتيب الأعمدة في التقرير</div>
              <div className="max-h-60 overflow-y-auto erp-scroll space-y-1.5">
                {activeColumns.map((col, idx) => (
                  <div
                    key={col.key}
                    className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      <span className="font-mono-num text-slate-400 ml-1.5">{idx + 1}.</span>
                      {col.header}
                    </span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveColumn(col.key, -1)} className="p-1 text-slate-500 hover:text-slate-900">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => moveColumn(col.key, 1)} className="p-1 text-slate-500 hover:text-slate-900">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Live Print Preview Sheet */}
      {previewOpen && (
        <Card padding="lg" className="space-y-4 print:border-0 print:shadow-none">
          <div
            className="flex flex-wrap items-center justify-between gap-4 border-b-2 pb-4"
            style={{ borderColor: branding.branding?.primaryColor || '#0f1e36' }}
          >
            <div className="flex items-center gap-3">
              {includeLogo && branding.branding?.primaryLogoKey && (
                <img
                  src={`/api/branding/logo/${encodeURIComponent(branding.branding.primaryLogoKey)}`}
                  alt="Company Logo"
                  className="h-12 max-w-[120px] object-contain"
                />
              )}
              <div>
                <div className="text-xs font-bold" style={{ color: branding.branding?.primaryColor || '#0f1e36' }}>
                  {branding.company?.companyNameAr}
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{reportTitle}</h3>
                <p className="text-xs text-slate-500">{reportSubtitle}</p>
                {includeCompanyDetails && (
                  <p className="text-[11px] text-slate-400 font-mono-num mt-0.5">
                    {[
                      branding.company?.crNumber ? `س.ت: ${branding.company.crNumber}` : '',
                      branding.company?.vatNumber ? `ضريبي: ${branding.company.vatNumber}` : '',
                      branding.company?.phone || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <div className="text-left text-xs text-slate-500 font-mono-num">
              <div>التاريخ: {new Date().toISOString().slice(0, 10)}</div>
              {preparer && <div>أعدّه: {preparer}</div>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ backgroundColor: branding.branding?.primaryColor || '#0f1e36' }} className="text-white">
                  {activeColumns.map((c) => (
                    <th key={c.key} className="border border-slate-700/30 px-3 py-2 text-right font-semibold">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 30).map((r, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50 dark:bg-slate-900/40' : ''}>
                    {activeColumns.map((c) => (
                      <td key={c.key} className="border border-slate-200 dark:border-slate-800 px-3 py-2 text-slate-700 dark:text-slate-200 font-mono-num">
                        {r[c.key] === undefined || r[c.key] === null || r[c.key] === '' ? '—' : String(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-3 text-[11px] text-slate-500">
            <span>
              {includeCompanyDetails
                ? branding.company?.officialFooterText || branding.company?.companyNameAr
                : branding.branding?.systemNameAr}
            </span>
            <span className="font-mono-num">عرض معاينة {Math.min(30, rawRows.length)} من أصل {rawRows.length} سجل</span>
          </div>
        </Card>
      )}

      <ReportImageShareModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        title={reportTitle}
        subtitle={reportSubtitle}
        columns={activeColumns}
        rows={rawRows}
        fileName={`custom_report_${sourceType}_${new Date().toISOString().slice(0, 10)}.png`}
        branding={branding}
        preparer={preparer}
        defaultOrientation={orientation}
        defaultIncludeLogo={includeLogo}
        defaultIncludeCompanyDetails={includeCompanyDetails}
      />
    </div>
  );
}
