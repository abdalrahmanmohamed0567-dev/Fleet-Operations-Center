import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { updateFleetSettings } from '../../lib/fleetApi';
import type { FleetConfigSettings, VehicleDocumentCategory } from '../../types/fleet';
import { Button, Card, FormField, Input, SectionHeader, ToastBanner } from '../ui/EnterpriseUI';

const ALL_DOC_CATEGORIES: Array<{ key: VehicleDocumentCategory; labelAr: string }> = [
  { key: 'istimara', labelAr: 'رخصة السير (الاستمارة)' },
  { key: 'insurance', labelAr: 'وثيقة التأمين' },
  { key: 'periodic_inspection', labelAr: 'شهادة الفحص الدوري' },
  { key: 'operating_card', labelAr: 'بطاقة التشغيل' },
  { key: 'delegation', labelAr: 'تفويض قيادة المركبة' },
];

interface FleetSettingsTabProps {
  fleetConfig: FleetConfigSettings;
  canManage: boolean;
  onSaved: () => Promise<void>;
}

export function FleetSettingsTab({ fleetConfig, canManage, onSaved }: FleetSettingsTabProps) {
  const [mandatoryDocs, setMandatoryDocs] = useState<VehicleDocumentCategory[]>(fleetConfig.mandatoryDocCategories || []);
  const [docAlertDaysText, setDocAlertDaysText] = useState((fleetConfig.documentAlertDays || [90, 60, 30, 15, 7, 3, 0]).join(', '));
  const [delAlertDaysText, setDelAlertDaysText] = useState((fleetConfig.delegationAlertDays || [30, 15, 7, 3]).join(', '));
  const [maintAlertDays, setMaintAlertDays] = useState(String(fleetConfig.maintenanceAlertDays ?? 14));
  const [maintAlertKm, setMaintAlertKm] = useState(String(fleetConfig.maintenanceAlertKm ?? 1000));
  const [singleVehiclePerRider, setSingleVehiclePerRider] = useState(Boolean(fleetConfig.singleVehiclePerRider));
  const [strictSeparationOfDuties, setStrictSeparationOfDuties] = useState(Boolean(fleetConfig.strictSeparationOfDuties));
  const [requireOpsAndAdminForDelegation, setRequireOpsAndAdminForDelegation] = useState(
    Boolean(fleetConfig.requireOpsAndAdminForDelegation)
  );
  const [requirePhotosOnHandover, setRequirePhotosOnHandover] = useState(Boolean(fleetConfig.requirePhotosOnHandover));
  const [requirePhotosOnReturn, setRequirePhotosOnReturn] = useState(Boolean(fleetConfig.requirePhotosOnReturn));
  const [checklistItems, setChecklistItems] = useState(fleetConfig.defaultChecklistItems || []);
  const [accessories, setAccessories] = useState(fleetConfig.defaultAccessories || []);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newAccessoryLabel, setNewAccessoryLabel] = useState('');
  const [showLogo, setShowLogo] = useState(fleetConfig.companyReportHeader?.showLogo !== false);
  const [footerDisclaimerAr, setFooterDisclaimerAr] = useState(
    fleetConfig.companyReportHeader?.footerDisclaimerAr || ''
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setMandatoryDocs(fleetConfig.mandatoryDocCategories || []);
    setDocAlertDaysText((fleetConfig.documentAlertDays || [90, 60, 30, 15, 7, 3, 0]).join(', '));
    setDelAlertDaysText((fleetConfig.delegationAlertDays || [30, 15, 7, 3]).join(', '));
    setMaintAlertDays(String(fleetConfig.maintenanceAlertDays ?? 14));
    setMaintAlertKm(String(fleetConfig.maintenanceAlertKm ?? 1000));
    setSingleVehiclePerRider(Boolean(fleetConfig.singleVehiclePerRider));
    setStrictSeparationOfDuties(Boolean(fleetConfig.strictSeparationOfDuties));
    setRequireOpsAndAdminForDelegation(Boolean(fleetConfig.requireOpsAndAdminForDelegation));
    setRequirePhotosOnHandover(Boolean(fleetConfig.requirePhotosOnHandover));
    setRequirePhotosOnReturn(Boolean(fleetConfig.requirePhotosOnReturn));
    setChecklistItems(fleetConfig.defaultChecklistItems || []);
    setAccessories(fleetConfig.defaultAccessories || []);
    setShowLogo(fleetConfig.companyReportHeader?.showLogo !== false);
    setFooterDisclaimerAr(fleetConfig.companyReportHeader?.footerDisclaimerAr || '');
  }, [fleetConfig]);

  const toggleDoc = (key: VehicleDocumentCategory) => {
    setMandatoryDocs((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const parseDaysList = (raw: string, fallback: number[]) => {
    const nums = raw
      .split(/[,،\s]+/)
      .map((s) => Math.round(Number(s.trim())))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
    return nums.length > 0 ? Array.from(new Set(nums)).sort((a, b) => b - a) : fallback;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await updateFleetSettings({
        mandatoryDocCategories: mandatoryDocs,
        documentAlertDays: parseDaysList(docAlertDaysText, [90, 60, 30, 15, 7, 3, 0]),
        delegationAlertDays: parseDaysList(delAlertDaysText, [30, 15, 7, 3]),
        maintenanceAlertDays: Number(maintAlertDays) || 14,
        maintenanceAlertKm: Number(maintAlertKm) || 1000,
        singleVehiclePerRider,
        strictSeparationOfDuties,
        requireOpsAndAdminForDelegation,
        requirePhotosOnHandover,
        requirePhotosOnReturn,
        defaultChecklistItems: checklistItems,
        defaultAccessories: accessories,
        companyReportHeader: {
          showLogo,
          footerDisclaimerAr: footerDisclaimerAr.trim(),
        },
      });
      setToast({
        type: 'ok',
        text: `تم حفظ سياسات إدارة الأسطول بنجاح وإعادة تقييم جاهزية (${res.vehiclesUpdated}) مركبة.`,
      });
      await onSaved();
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'تعذر حفظ إعدادات الأسطول.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
      {toast && <ToastBanner type={toast.type} message={toast.text} onDismiss={() => setToast(null)} />}

      <Card>
        <SectionHeader
          title="1. حوكمة التسليم والاعتمادات ثنائية المرحلة"
          subtitle="القواعد الإلزامية التي يطبقها الخادم على طلبات الربط والتسليم والفحص"
          actions={
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <ShieldCheck className="h-4 w-4" />
              <span>محمية على مستوى الخادم</span>
            </div>
          }
          className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {[
            {
              label: 'منع تسليم أكثر من مركبة نشطة للمندوب الواحد',
              desc: 'يمنع إنشاء عهدة جديدة لمندوب لديه عهدة نشطة إلا بعد الإغلاق أو النقل الذري.',
              checked: singleVehiclePerRider,
              onChange: setSingleVehiclePerRider,
            },
            {
              label: 'الفصل الصارم بين الصلاحيات (Separation of Duties)',
              desc: 'يمنع غير الإداريين من اعتماد مرحلة التشغيل أو الإدارة لطلبات قاموا هم برفعها.',
              checked: strictSeparationOfDuties,
              onChange: setStrictSeparationOfDuties,
            },
            {
              label: 'إلزام اعتماد التشغيل + الإدارة + وثيقة التفويض قبل التسليم',
              desc: 'يتطلب اكتمال الموافقتين وإرفاق رقم وتاريخ التفويض قبل تنفيذ محضر التسليم.',
              checked: requireOpsAndAdminForDelegation,
              onChange: setRequireOpsAndAdminForDelegation,
            },
            {
              label: 'إلزام رفع صور التوثيق عند محضر التسليم',
              desc: 'يرفض محضر التسليم ما لم ترفق الصور الموثقة في الخزينة.',
              checked: requirePhotosOnHandover,
              onChange: setRequirePhotosOnHandover,
            },
            {
              label: 'إلزام رفع صور التوثيق عند محضر الاستلام والإرجاع',
              desc: 'يتطلب توثيق حالة المركبة بالصور عند استلامها من المندوب.',
              checked: requirePhotosOnReturn,
              onChange: setRequirePhotosOnReturn,
            },
          ].map((rule) => (
            <label
              key={rule.label}
              className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
            >
              <input
                type="checkbox"
                checked={rule.checked}
                disabled={!canManage}
                onChange={(e) => rule.onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-blue-600"
              />
              <div>
                <div className="font-bold text-slate-900 dark:text-slate-100">{rule.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{rule.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="2. الوثائق الإلزامية للجاهزية وعتبات التنبيه"
          subtitle="أي وثيقة محددة هنا تمنع تسليم المركبة تلقائيًا عند نقصها أو انتهائها"
          className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
        />

        <div className="flex flex-wrap gap-3 mb-4 text-xs">
          {ALL_DOC_CATEGORIES.map((doc) => {
            const active = mandatoryDocs.includes(doc.key);
            return (
              <label
                key={doc.key}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  active
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 font-semibold'
                    : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={!canManage}
                  onChange={() => toggleDoc(doc.key)}
                  className="accent-blue-600"
                />
                <span>{doc.labelAr}</span>
              </label>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label="أيام التنبيه لانتهاء الوثائق (مفصولة بفاصلة)">
            <Input
              type="text"
              dir="ltr"
              disabled={!canManage}
              className="font-mono-num"
              value={docAlertDaysText}
              onChange={(e) => setDocAlertDaysText(e.target.value)}
            />
          </FormField>
          <FormField label="أيام التنبيه لانتهاء التفويض (مفصولة بفاصلة)">
            <Input
              type="text"
              dir="ltr"
              disabled={!canManage}
              className="font-mono-num"
              value={delAlertDaysText}
              onChange={(e) => setDelAlertDaysText(e.target.value)}
            />
          </FormField>
          <FormField label="التنبيه قبل موعد الصيانة الدورية (يوم)">
            <Input
              type="number"
              min={1}
              max={180}
              disabled={!canManage}
              className="font-mono-num"
              value={maintAlertDays}
              onChange={(e) => setMaintAlertDays(e.target.value)}
            />
          </FormField>
          <FormField label="التنبيه قبل عداد الصيانة القادمة (كم)">
            <Input
              type="number"
              min={100}
              max={20000}
              disabled={!canManage}
              className="font-mono-num"
              value={maintAlertKm}
              onChange={(e) => setMaintAlertKm(e.target.value)}
            />
          </FormField>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <SectionHeader
            title={`3. بنود الفحص الافتراضية (${checklistItems.length})`}
            subtitle="تُحمّل تلقائيًا عند فتح محضر تسليم أو استلام جديد"
            className="mb-3"
          />
          <div className="space-y-2 mb-3 max-h-56 overflow-auto">
            {checklistItems.map((item, idx) => (
              <div
                key={`${item.itemKey}_${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
              >
                <span className="font-medium">{item.labelAr}</span>
                {canManage && checklistItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setChecklistItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 p-1 rounded"
                    aria-label="حذف بند الفحص"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newChecklistLabel}
                onChange={(e) => setNewChecklistLabel(e.target.value)}
                placeholder="أضف بند فحص جديد (مثال: جهاز التتبع GPS)..."
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  const lbl = newChecklistLabel.trim();
                  if (!lbl) return;
                  setChecklistItems((prev) => [...prev, { itemKey: `chk_${Date.now().toString(36)}`, labelAr: lbl }]);
                  setNewChecklistLabel('');
                }}
              >
                إضافة
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title={`4. الملحقات والعهد الافتراضية (${accessories.length})`}
            subtitle="تُدرج في محاضر التسليم والفحص للتحقق من توفرها"
            className="mb-3"
          />
          <div className="space-y-2 mb-3 max-h-56 overflow-auto">
            {accessories.map((acc, idx) => (
              <div
                key={`${acc.accessoryKey}_${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
              >
                <span className="font-medium">{acc.labelAr}</span>
                {canManage && accessories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setAccessories((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 p-1 rounded"
                    aria-label="حذف الملحق"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newAccessoryLabel}
                onChange={(e) => setNewAccessoryLabel(e.target.value)}
                placeholder="أضف ملحقًا جديدًا (مثال: حقيبة توصيل حرارية)..."
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  const lbl = newAccessoryLabel.trim();
                  if (!lbl) return;
                  setAccessories((prev) => [...prev, { accessoryKey: `acc_${Date.now().toString(36)}`, labelAr: lbl }]);
                  setNewAccessoryLabel('');
                }}
              >
                إضافة
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="5. ترويسة وتذييل المحاضر والتقارير الرسمية"
          subtitle="تظهر في محاضر التسليم والاستلام وبطاقة المركبة عند الطباعة أو التصدير"
          className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <label className="flex items-center gap-2.5 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={showLogo}
              disabled={!canManage}
              onChange={(e) => setShowLogo(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span>إظهار شعار الشركة في محاضر التسليم والاستلام</span>
          </label>
          <div className="md:col-span-2">
            <FormField label="نص الإقرار والتذييل الرسمي للمحاضر">
              <Input
                type="text"
                disabled={!canManage}
                value={footerDisclaimerAr}
                onChange={(e) => setFooterDisclaimerAr(e.target.value)}
                placeholder="مثال: يقر المستلم بمسؤوليته الكاملة عن العهدة والالتزام بأنظمة المرور والسلامة."
              />
            </FormField>
          </div>
        </div>
      </Card>

      {canManage && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} icon={<Save className="h-4 w-4" />}>
            حفظ سياسات وإعدادات الأسطول وإعادة تقييم الجاهزية
          </Button>
        </div>
      )}
    </form>
  );
}
