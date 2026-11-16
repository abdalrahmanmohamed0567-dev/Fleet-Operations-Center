import { doc, serverTimestamp, setDoc } from '../lib/erpDb';
import { Building2, Image as ImageIcon, Palette, Save, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_COMPANY_BRANDING } from '../lib/dynamicSchemaEngine';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { db, getActiveAuthToken } from '../lib/firebase';
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

function mergeBrandingDoc(branding?: Partial<CompanyBrandingDoc> | null): Omit<CompanyBrandingDoc, 'createdByUid' | 'allowedUids'> {
  return {
    brandingId: branding?.brandingId || 'default',
    company: {
      ...DEFAULT_COMPANY_BRANDING.company,
      ...(branding?.company || {}),
    },
    branding: {
      ...DEFAULT_COMPANY_BRANDING.branding,
      ...(branding?.branding || {}),
    },
    credits: {
      ...DEFAULT_COMPANY_BRANDING.credits,
      ...(branding?.credits || {}),
      changelog: branding?.credits?.changelog || DEFAULT_COMPANY_BRANDING.credits.changelog,
    },
  };
}

export function CompanyBrandingModule({
  branding,
  currentUser,
  roleTemplates,
  allowedUids,
  onRefresh,
}: CompanyBrandingModuleProps) {
  const [subTab, setSubTab] = useState<'company' | 'visual'>('company');
  const [form, setForm] = useState(() => mergeBrandingDoc(branding));
  const [busy, setBusy] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    setForm(mergeBrandingDoc(branding));
  }, [branding]);

  const canManageCompany = hasCapability(currentUser, roleTemplates, 'manage_company') || currentUser.role === 'owner' || currentUser.role === 'admin';
  const canChangeBranding = hasCapability(currentUser, roleTemplates, 'change_branding') || currentUser.role === 'owner' || currentUser.role === 'admin';

  const updateCompany = (patch: Partial<CompanyBrandingDoc['company']>) =>
    setForm((prev) => ({ ...prev, company: { ...prev.company, ...patch } }));

  const updateVisual = (patch: Partial<CompanyBrandingDoc['branding']>) =>
    setForm((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }));

  const handleUploadLogo = async (slot: 'primary' | 'alternate' | 'icon', file: File) => {
    if (!canChangeBranding) return;
    setUploadingSlot(slot);
    setToast(null);
    try {
      const token = await getActiveAuthToken();
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
      updateVisual(
        slot === 'primary'
          ? { primaryLogoKey: json.logoKey }
          : slot === 'alternate'
            ? { alternateLogoKey: json.logoKey }
            : { iconLogoKey: json.logoKey }
      );
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
        brandingId: 'default',
        company: form.company,
        branding: form.branding,
        credits: form.credits,
        updatedByEmail: currentUser.email,
        createdByUid: branding?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        ...(branding?.createdAt ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'companyBranding', 'default'), cleanDoc, { merge: true });

      const token = await getActiveAuthToken();
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
        details: `تحديث بيانات الشركة والهوية البصرية (${form.company.companyNameAr} · ${form.branding.systemNameAr})`,
        oldValue: {
          companyNameAr: branding?.company?.companyNameAr || '',
          primaryColor: branding?.branding?.primaryColor || '',
          loginScreenStyle: branding?.branding?.loginScreenStyle || '',
        },
        newValue: {
          companyNameAr: form.company.companyNameAr,
          primaryColor: form.branding.primaryColor,
          loginScreenStyle: form.branding.loginScreenStyle,
        },
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
                    value={form.company.companyNameAr}
                    onChange={(e) => updateCompany({ companyNameAr: e.target.value })}
                  />
                </FormField>
                <FormField label="اسم الشركة (إنجليزي)" required>
                  <Input
                    required
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.company.companyNameEn}
                    onChange={(e) => updateCompany({ companyNameEn: e.target.value })}
                  />
                </FormField>
                <FormField label="الاسم المختصر (Short Name)">
                  <Input
                    disabled={!canManageCompany}
                    value={form.company.shortName || ''}
                    onChange={(e) => updateCompany({ shortName: e.target.value })}
                  />
                </FormField>
                <FormField label="المدير المسؤول">
                  <Input
                    disabled={!canManageCompany}
                    value={form.company.responsibleManager || ''}
                    onChange={(e) => updateCompany({ responsibleManager: e.target.value })}
                  />
                </FormField>
                <FormField label="رقم السجل التجاري (CR)">
                  <Input
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.company.crNumber || ''}
                    onChange={(e) => updateCompany({ crNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="الرقم الضريبي (VAT)">
                  <Input
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.company.vatNumber || ''}
                    onChange={(e) => updateCompany({ vatNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="رقم الهاتف الرسمي">
                  <Input
                    dir="ltr"
                    className="font-mono-num"
                    disabled={!canManageCompany}
                    value={form.company.phone || ''}
                    onChange={(e) => updateCompany({ phone: e.target.value })}
                  />
                </FormField>
                <FormField label="البريد الإلكتروني الرسمي">
                  <Input
                    type="email"
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.company.email || ''}
                    onChange={(e) => updateCompany({ email: e.target.value })}
                  />
                </FormField>
                <FormField label="المدينة">
                  <Input
                    disabled={!canManageCompany}
                    value={form.company.city || ''}
                    onChange={(e) => updateCompany({ city: e.target.value })}
                  />
                </FormField>
                <FormField label="الدولة">
                  <Input
                    disabled={!canManageCompany}
                    value={form.company.country || ''}
                    onChange={(e) => updateCompany({ country: e.target.value })}
                  />
                </FormField>
                <FormField label="الموقع الإلكتروني">
                  <Input
                    dir="ltr"
                    disabled={!canManageCompany}
                    value={form.company.website || ''}
                    onChange={(e) => updateCompany({ website: e.target.value })}
                    placeholder="https://..."
                  />
                </FormField>
                <FormField label="العنوان التفصيلي">
                  <Input
                    disabled={!canManageCompany}
                    value={form.company.address || ''}
                    onChange={(e) => updateCompany({ address: e.target.value })}
                  />
                </FormField>
                <FormField label="تذييل التقارير والمستندات الرسمية" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    disabled={!canManageCompany}
                    value={form.company.officialFooterText || ''}
                    onChange={(e) => updateCompany({ officialFooterText: e.target.value })}
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
                      value={form.branding.systemNameAr}
                      onChange={(e) => updateVisual({ systemNameAr: e.target.value })}
                    />
                  </FormField>
                  <FormField label="اسم النظام (إنجليزي)">
                    <Input
                      dir="ltr"
                      disabled={!canChangeBranding}
                      value={form.branding.systemNameEn}
                      onChange={(e) => updateVisual({ systemNameEn: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(
                    [
                      ['primary', 'الشعار الرئيسي', form.branding.primaryLogoKey],
                      ['alternate', 'الشعار البديل (للوضع الداكن/التقارير)', form.branding.alternateLogoKey],
                      ['icon', 'أيقونة النظام المصغرة', form.branding.iconLogoKey],
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
                              updateVisual(
                                slot === 'primary'
                                  ? { primaryLogoKey: '' }
                                  : slot === 'alternate'
                                    ? { alternateLogoKey: '' }
                                    : { iconLogoKey: '' }
                              )
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
                      ['primaryColor', 'اللون الرئيسي', form.branding.primaryColor],
                      ['secondaryColor', 'اللون الثانوي', form.branding.secondaryColor],
                      ['buttonColor', 'لون الأزرار', form.branding.buttonColor],
                      ['sidebarColor', 'خلفية القائمة', form.branding.sidebarColor],
                    ] as const
                  ).map(([fieldKey, label, val]) => (
                    <FormField key={fieldKey} label={label}>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          disabled={!canChangeBranding}
                          value={val}
                          onChange={(e) => updateVisual({ [fieldKey]: e.target.value })}
                          className="h-9 w-11 cursor-pointer rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                        />
                        <Input
                          dir="ltr"
                          className="font-mono-num text-xs"
                          disabled={!canChangeBranding}
                          value={val}
                          onChange={(e) => updateVisual({ [fieldKey]: e.target.value })}
                        />
                      </div>
                    </FormField>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField label="نمط الواجهة">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.branding.uiStyleMode}
                      onChange={(e) =>
                        updateVisual({ uiStyleMode: e.target.value as CompanyBrandingDoc['branding']['uiStyleMode'] })
                      }
                    >
                      <option value="corporate">كحلي مؤسسي متوازن (Corporate)</option>
                      <option value="modern">عصري مرن (Modern)</option>
                      <option value="compact">مكثف للعمل السريع (Compact)</option>
                    </Select>
                  </FormField>
                  <FormField label="الوضع الافتراضي للألوان">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.branding.defaultThemeMode}
                      onChange={(e) =>
                        updateVisual({ defaultThemeMode: e.target.value as CompanyBrandingDoc['branding']['defaultThemeMode'] })
                      }
                    >
                      <option value="light">الوضع النهاري</option>
                      <option value="dark">الوضع الليلي</option>
                    </Select>
                  </FormField>
                  <FormField label="تصميم شاشة تسجيل الدخول">
                    <Select
                      disabled={!canChangeBranding}
                      value={form.branding.loginScreenStyle}
                      onChange={(e) =>
                        updateVisual({ loginScreenStyle: e.target.value as CompanyBrandingDoc['branding']['loginScreenStyle'] })
                      }
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
                      value={form.branding.loginHeadlineAr || ''}
                      onChange={(e) => updateVisual({ loginHeadlineAr: e.target.value })}
                    />
                  </FormField>
                  <FormField label="الوصف التعريفي أسفل الترحيب">
                    <Input
                      disabled={!canChangeBranding}
                      value={form.branding.loginSubheadlineAr || ''}
                      onChange={(e) => updateVisual({ loginSubheadlineAr: e.target.value })}
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
                style={{ backgroundColor: form.branding.sidebarColor || '#0c1628' }}
              >
                <div className="flex items-center gap-2.5">
                  {form.branding.primaryLogoKey ? (
                    <img
                      src={`/api/branding/logo/${encodeURIComponent(form.branding.primaryLogoKey)}`}
                      alt="Logo"
                      className="h-7 w-7 rounded object-contain bg-white/10 p-0.5"
                    />
                  ) : (
                    <div
                      className="h-7 w-7 rounded flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: form.branding.secondaryColor || '#2563eb' }}
                    >
                      {form.company.shortName || 'FOC'}
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-bold">{form.branding.systemNameAr || 'مركز عمليات الأسطول'}</div>
                    <div className="text-[10px] opacity-75">{form.company.companyNameAr}</div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {form.branding.loginHeadlineAr || 'بوابة العمليات والتشغيل الموحدة'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {form.branding.loginSubheadlineAr || form.branding.systemNameEn}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
                    style={{ backgroundColor: form.branding.buttonColor || '#1d4ed8' }}
                  >
                    زر أساسي
                  </span>
                  <span
                    className="inline-flex items-center rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
                    style={{ backgroundColor: form.branding.secondaryColor || '#2563eb' }}
                  >
                    إجراء ثانوي
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-[10px] text-slate-500">
                {form.company.officialFooterText || form.company.companyNameAr}
              </div>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
