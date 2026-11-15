import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Building2, Image as ImageIcon, Palette, Save, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_COMPANY_BRANDING } from '../lib/dynamicSchemaEngine';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { auth, db } from '../lib/firebase';
import { safeParseJsonResponse } from '../lib/safeFetch';
import { hasCapability } from '../shared/rbacCore';
import type { CompanyBrandingDoc, RoleTemplate, UserProfile } from '../types/fleet';
import {
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  Tabs,
  Textarea,
  ToastBanner,
} from './ui/EnterpriseUI';

interface CompanyBrandingModuleProps {
  branding: CompanyBrandingDoc;
  currentUser: UserProfile;
  roleTemplates: RoleTemplate[];
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}

export function CompanyBrandingModule({
  branding,
  currentUser,
  roleTemplates,
  allowedUids,
  onRefresh,
}: CompanyBrandingModuleProps) {
  const [subTab, setSubTab] = useState<'company' | 'visual'>('company');
  const [form, setForm] = useState<CompanyBrandingDoc>({ ...DEFAULT_COMPANY_BRANDING, ...branding });
  const [busy, setBusy] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    setForm({ ...DEFAULT_COMPANY_BRANDING, ...branding });
  }, [branding]);

  const canManageCompany = hasCapability(currentUser, roleTemplates, 'manage_company') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canChangeBranding = hasCapability(currentUser, roleTemplates, 'change_branding') || currentUser.role === 'owner' || currentUser.role === 'admin';

  const handleUploadLogo = async (slot: 'primary' | 'secondary' | 'icon', file: File) => {
    if (!canChangeBranding) return;
    setUploadingSlot(slot);
    setToast(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('يرجى تسجيل الدخول لرفع الشعار.');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('slot', slot);
      const res = await fetch('/api/branding/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await safeParseJsonResponse<{ success?: boolean; logoKey?: string; error?: string }>(res);
      if (!res.ok || !json.logoKey) {
        throw new Error(json.error || 'فشل رفع الشعار.');
      }
      setForm((prev) => ({
        ...prev,
        ...(slot === 'primary'
          ? { primaryLogoKey: json.logoKey }
          : slot === 'secondary'
            ? { secondaryLogoKey: json.logoKey }
            : { appIconKey: json.logoKey }),
      }));
      setToast({ type: 'ok', msg: 'تم رفع الشعار إلى الخزينة. اضغط "حفظ واعتماد التغييرات" لتعميمه.' });
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'فشل رفع الشعار.' });
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageCompany && !canChangeBranding) return;
    setBusy(true);
    setToast(null);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const cleanDoc: Record<string, unknown> = {
        ...form,
        brandingId: 'default',
        updatedByEmail: currentUser.email,
        createdByUid: currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'companyBranding', 'default'), cleanDoc, { merge: true });

      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await fetch('/api/branding/sync-public', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        }).catch(() => {});
      }

      await writeErpAuditLog({
        action: 'COMPANY_BRANDING_UPDATED',
        targetCollection: 'companyBranding',
        targetId: 'default',
        entityType: 'branding',
        details: `تحديث بيانات الشركة والهوية البصرية (${form.companyNameAr} · ${form.systemNameAr})`,
        oldValue: { companyNameAr: branding.companyNameAr, primaryColor: branding.primaryColor, loginScreenStyle: branding.loginScreenStyle },
        newValue: { companyNameAr: form.companyNameAr, primaryColor: form.primaryColor, loginScreenStyle: form.loginScreenStyle },
        user: currentUser,
        allowedUids,
      });

      setToast({ type: 'ok', msg: 'تم حفظ بيانات الشركة والهوية البصرية وتطبيقها فورًا على المنصة وشاشة الدخول.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر حفظ إعدادات الشركة والهوية.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="بيانات الشركة والهوية المؤسسية"
        subtitle="تخصيص المعلومات القانونية للشركة والشعارات والألوان ونمط شاشة الدخول والتقارير الرسمية"
        actions={
          <Button
            type="submit"
            form="company-branding-form"
            variant="primary"
            loading={busy}
            disabled={!canManageCompany && !canChangeBranding}
            icon={<Save className="h-3.5 w-3.5" />}
          >
            حفظ واعتماد التغييرات
          </Button>
        }
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      <Tabs
        variant="underline"
        activeKey={subTab}
        onChange={setSubTab}
        items={[
          { key: 'company', label: 'بيانات الشركة والاعتماد القانوني', icon: <Building2 className="h-3.5 w-3.5" /> },
          { key: 'visual', label: 'الهوية البصرية والشعارات ونمط الدخول', icon: <Palette className="h-3.5 w-3.5" /> },
        ]}
      />

      <form id="company-branding-form" onSubmit={(e) => void handleSave(e)} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          {subTab === 'company' ? (
            <Card className="space-y-4">
              <SectionHeader
                title="الملف المؤسسي والقانوني للشركة"
                subtitle="تُستخدم هذه البيانات في ترويسة وتذييل التقارير المطبوعة وملفات PDF الرسمية"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="اسم الشركة (عربي)" required>
                  <Input
                    required
                    disabled={!canManageCompany}
                    value={form.companyNameAr}
                    onChange={(e) => setForm({ ...form, companyNameAr: e.target.value })}
                  />
                </FormField>
                <FormField label="اسم الشركة (إنجليزي)" required>
                  <Input
                    required
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.companyNameEn}
                    onChange={(e) => setForm({ ...form, companyNameEn: e.target.value })}
                  />
                </FormField>
                <FormField label="الاسم المختصر (Short Name)">
                  <Input
                    disabled={!canManageCompany}
                    value={form.shortName || ''}
                    onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                  />
                </FormField>
                <FormField label="المدير المسؤول">
                  <Input
                    disabled={!canManageCompany}
                    value={form.responsibleManager || ''}
                    onChange={(e) => setForm({ ...form, responsibleManager: e.target.value })}
                  />
                </FormField>
                <FormField label="رقم السجل التجاري (CR)">
                  <Input
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.crNumber || ''}
                    onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="الرقم الضريبي (VAT)">
                  <Input
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.vatNumber || ''}
                    onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="رقم الهاتف الرسمي">
                  <Input
                    dir="ltr"
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </FormField>
                <FormField label="البريد الإلكتروني الرسمي">
                  <Input
                    type="email"
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.email || ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </FormField>
                <FormField label="المدينة">
                  <Input
                    disabled={!canManageCompany}
                    value={form.city || ''}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </FormField>
                <FormField label="الدولة">
                  <Input
                    disabled={!canManageCompany}
                    value={form.country || ''}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                  />
                </FormField>
                <FormField label="الموقع الإلكتروني">
                  <Input
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.website || ''}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="https://..."
                  />
                </FormField>
                <FormField label="العنوان التفصيلي">
                  <Input
                    disabled={!canManageCompany}
                    value={form.address || ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </FormField>
                <FormField label="تذييل التقارير والمستندات الرسمية" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    disabled={!canManageCompany}
                    value={form.officialFooterText || ''}
                    onChange={(e) => setForm({ ...form, officialFooterText: e.target.value })}
                  />
                </FormField>
              </div>
            </Card>
          ) : (
            <div className="space-y-5">
              <Card className="space-y-4">
                <SectionHeader title="مسمى النظام والشعارات" subtitle="تظهر في الشريط الجانبي وشاشة الدخول وترويسة التقارير" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="اسم النظام (عربي)">
                    <Input
                      disabled={!canChangeBranding}
                      value={form.systemNameAr}
                      onChange={(e) => setForm({ ...form, systemNameAr: e.target.value })}
                    />
                  </FormField>
                  <FormField label="اسم النظام (إنجليزي)">
                    <Input
                      dir="ltr"
                      disabled={!canChangeBranding}
                      value={form.systemNameEn}
                      onChange={(e) => setForm({ ...form, systemNameEn: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(
                    [
                      ['primary', 'الشعار الرئيسي', form.primaryLogoKey],
                      ['secondary', 'الشعار البديل (للوضع الداكن/التقارير)', form.secondaryLogoKey],
                      ['icon', 'أيقونة النظام المصغرة', form.appIconKey],
                    ] as const
                  ).map(([slot, label, keyVal]) => (
                    <div key={slot} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50/50 dark:bg-slate-950/40">
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</div>
                      <div className="h-16 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                        {keyVal ? (
                          <img
                            src={`/api/branding/logo/${encodeURIComponent(keyVal)}`}
                            alt={label}
                            className="max-h-14 max-w-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="h-6 w-6 text-slate-300" />
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100">
                          <Upload className="h-3 w-3" />
                          <span>{uploadingSlot === slot ? 'جاري الرفع...' : 'رفع صورة'}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="hidden"
                            disabled={!canChangeBranding || uploadingSlot === slot}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleUploadLogo(slot, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {keyVal && canChangeBranding && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                ...(slot === 'primary'
                                  ? { primaryLogoKey: '' }
                                  : slot === 'secondary'
                                    ? { secondaryLogoKey: '' }
                                    : { appIconKey: '' }),
                              }))
                            }
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            إزالة
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="space-y-4">
                <SectionHeader title="لوحة الألوان ونمط الواجهة وشاشة الدخول" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {(
                    [
                      ['primaryColor', 'اللون الرئيسي', form.primaryColor],
                      ['secondaryColor', 'اللون الثانوي', form.secondaryColor],
                      ['buttonColor', 'لون الأزرار', form.buttonColor],
                      ['sidebarColor', 'خلفية القائمة', form.sidebarColor],
                    ] as const
                  ).map(([fieldKey, label, val]) => (
                    <FormField key={fieldKey} label={label}>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          disabled={!canChangeBranding}
                          value={val}
                          onChange={(e) => setForm({ ...form, [fieldKey]: e.target.value })}
                          className="h-9 w-11 cursor-pointer rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                        />
                        <Input
                          dir="ltr"
                          className="font-mono-num text-xs"
                          disabled={!canChangeBranding}
                          value={val}
                          onChange={(e) => setForm({ ...form, [fieldKey]: e.target.value })}
                        />
                      </div>
                    </FormField>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField label="نمط الواجهة">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.uiStyleMode}
                      onChange={(e) => setForm({ ...form, uiStyleMode: e.target.value as CompanyBrandingDoc['uiStyleMode'] })}
                    >
                      <option value="corporate_navy">كحلي مؤسسي (Corporate Navy)</option>
                      <option value="slate_minimal">رمادي متزن (Slate Minimal)</option>
                      <option value="emerald_ops">تشغيلي أخضر (Emerald Ops)</option>
                    </Select>
                  </FormField>
                  <FormField label="الوضع الافتراضي للألوان">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.defaultThemeMode}
                      onChange={(e) => setForm({ ...form, defaultThemeMode: e.target.value as CompanyBrandingDoc['defaultThemeMode'] })}
                    >
                      <option value="system">تلقائي حسب النظام</option>
                      <option value="light">الوضع النهاري</option>
                      <option value="dark">الوضع الليلي</option>
                    </Select>
                  </FormField>
                  <FormField label="تصميم شاشة تسجيل الدخول">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.loginScreenStyle}
                      onChange={(e) => setForm({ ...form, loginScreenStyle: e.target.value as CompanyBrandingDoc['loginScreenStyle'] })}
                    >
                      <option value="split">مقسوم مؤسسي (Split)</option>
                      <option value="centered">بطاقة وسطية (Centered)</option>
                      <option value="minimal">مختصر نظيف (Minimal)</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="عنوان الترحيب في شاشة الدخول">
                    <Input
                      disabled={!canChangeBranding}
                      value={form.loginHeadlineAr || ''}
                      onChange={(e) => setForm({ ...form, loginHeadlineAr: e.target.value })}
                    />
                  </FormField>
                  <FormField label="الوصف التعريفي أسفل الترحيب">
                    <Input
                      disabled={!canChangeBranding}
                      value={form.loginSubheadlineAr || ''}
                      onChange={(e) => setForm({ ...form, loginSubheadlineAr: e.target.value })}
                    />
                  </FormField>
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Live Visual Branding Preview Panel */}
        <div className="space-y-4">
          <Card className="space-y-4 sticky top-4">
            <SectionHeader title="معاينة حية للهوية المؤسسية" subtitle="تشاهد هنا انعكاس الألوان والشعار قبل الاعتماد" />

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div
                className="px-4 py-3 text-white flex items-center justify-between"
                style={{ backgroundColor: form.sidebarColor || '#0f1e36' }}
              >
                <div className="flex items-center gap-2.5">
                  {form.primaryLogoKey ? (
                    <img
                      src={`/api/branding/logo/${encodeURIComponent(form.primaryLogoKey)}`}
                      alt="Logo"
                      className="h-7 w-7 rounded object-contain bg-white/10 p-0.5"
                    />
                  ) : (
                    <div
                      className="h-7 w-7 rounded flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: form.secondaryColor || '#1d4ed8' }}
                    >
                      FOC
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-bold">{form.systemNameAr || 'مركز عمليات الأسطول'}</div>
                    <div className="text-[10px] opacity-75">{form.companyNameAr}</div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {form.loginHeadlineAr || 'بوابة العمليات والتشغيل الموحدة'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {form.loginSubheadlineAr || form.systemNameEn}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
                    style={{ backgroundColor: form.buttonColor || '#0f1e36' }}
                  >
                    زر أساسي
                  </span>
                  <span
                    className="inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
                    style={{ backgroundColor: form.secondaryColor || '#1d4ed8' }}
                  >
                    إجراء ثانوي
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-[10px] text-slate-500">
                {form.officialFooterText || form.companyNameAr}
              </div>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
