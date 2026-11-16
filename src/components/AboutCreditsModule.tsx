import { doc, serverTimestamp, setDoc } from '../lib/erpDb';
import { Award, CheckCircle2, Edit3, Info, Phone, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_COMPANY_BRANDING } from '../lib/dynamicSchemaEngine';
import { writeErpAuditLog } from '../lib/erpHelpers';
import { db, getActiveAuthToken } from '../lib/firebase';
import type { CompanyBrandingDoc, UserProfile } from '../types/fleet';
import {
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  SectionHeader,
  SlideDrawer,
  StatusBadge,
  Textarea,
  ToastBanner,
} from './ui/EnterpriseUI';

interface AboutCreditsModuleProps {
  branding: CompanyBrandingDoc;
  currentUser: UserProfile;
  allowedUids: string[];
  onRefresh: () => Promise<void>;
}

const CHANGELOG_ITEMS = [
  {
    version: 'v4.0 Enterprise Builder',
    date: '2026',
    highlights: [
      'إطلاق مركز التحكم والتخصيص الشامل (System Builder) ومنشئ الحقول الديناميكي بـ 18 نوع حقل.',
      'منشئ النماذج المرئي مع دعم التبويبات والأقسام والخطوات المتدرجة وإدارة الإصدارات والتراجع.',
      'إدارة بيانات الشركة والهوية البصرية والشعارات ونمط شاشة الدخول.',
      'مصمم التقارير والطباعة المخصص مع تصدير PDF وExcel وسلة المحذوفات للاسترجاع الآمن.',
    ],
  },
  {
    version: 'v3.0 Unified ERP',
    date: '2025',
    highlights: [
      'إعادة هيكلة النظام حول 4 أنظمة مترابطة: الموارد البشرية، التطبيقات، الأسطول، والإدارة التنفيذية.',
      'ملف المندوب الموحد Rider 360° ومراقبة انتهاء الإقامات والرخص والاستمارات.',
      'خزينة المستندات الخاصة المحمية بالصلاحيات ومصفوفة الصلاحيات التفصيلية.',
    ],
  },
];

export function AboutCreditsModule({
  branding,
  currentUser,
  allowedUids,
  onRefresh,
}: AboutCreditsModuleProps) {
  const isOwner = currentUser.role === 'owner' || currentUser.role === 'admin';
  const merged: Omit<CompanyBrandingDoc, 'createdByUid' | 'allowedUids'> = {
    brandingId: branding?.brandingId || 'default',
    company: { ...DEFAULT_COMPANY_BRANDING.company, ...(branding?.company || {}) },
    branding: { ...DEFAULT_COMPANY_BRANDING.branding, ...(branding?.branding || {}) },
    credits: { ...DEFAULT_COMPANY_BRANDING.credits, ...(branding?.credits || {}) },
  };

  const [editOpen, setEditOpen] = useState(false);
  const [devName, setDevName] = useState(merged.credits.developerName || 'م- عبدالرحمن محمد');
  const [devPhone, setDevPhone] = useState(merged.credits.developerPhone || '0559786939');
  const [versionLabel, setVersionLabel] = useState(merged.credits.version || 'v4.0 Enterprise');
  const [copyrightAr, setCopyrightAr] = useState(
    merged.credits.copyrightText || 'جميع الحقوق محفوظة · FLEET OPERATIONS CENTER'
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const handleSaveCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setBusy(true);
    setToast(null);
    try {
      const teamAllowed = Array.from(new Set([currentUser.uid, ...allowedUids].filter(Boolean))).slice(0, 20);
      const nextCredits = {
        ...merged.credits,
        developerName: devName.trim(),
        developerPhone: devPhone.trim(),
        version: versionLabel.trim(),
        copyrightText: copyrightAr.trim(),
        lastUpdated: new Date().toISOString().slice(0, 10),
      };
      const patch = {
        brandingId: 'default',
        company: merged.company,
        branding: merged.branding,
        credits: nextCredits,
        updatedByEmail: currentUser.email,
        createdByUid: branding?.createdByUid || currentUser.uid,
        allowedUids: teamAllowed.length > 0 ? teamAllowed : [currentUser.uid],
        ...(branding?.createdAt ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'companyBranding', 'default'), patch, { merge: true });

      const token = await getActiveAuthToken();
      if (token) {
        await fetch('/api/branding/sync-public', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            company: merged.company,
            branding: merged.branding,
            credits: nextCredits,
          }),
        }).catch(() => {});
      }

      await writeErpAuditLog({
        action: 'SYSTEM_CREDITS_UPDATED',
        targetCollection: 'companyBranding',
        targetId: 'default',
        entityType: 'branding',
        details: `تحديث اعتمادات وإصدار النظام (${versionLabel.trim()})`,
        user: currentUser,
        allowedUids,
      });

      setEditOpen(false);
      setToast({ type: 'ok', msg: 'تم تحديث معلومات النظام والاعتماد بنجاح.' });
      await onRefresh();
    } catch (err) {
      setToast({ type: 'err', msg: err instanceof Error ? err.message : 'تعذر تحديث المعلومات.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="حول النظام والاعتمادات"
        subtitle="بيانات الإصدار والمنصة ومعلومات التطوير والتصميم المعتمدة"
        actions={
          isOwner ? (
            <Button variant="secondary" icon={<Edit3 className="h-3.5 w-3.5" />} onClick={() => setEditOpen(true)}>
              تعديل بيانات الاعتماد والإصدار
            </Button>
          ) : undefined
        }
      />

      {toast && <ToastBanner type={toast.type} message={toast.msg} onDismiss={() => setToast(null)} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              {merged.branding.primaryLogoKey ? (
                <img
                  src={`/api/branding/logo/${encodeURIComponent(merged.branding.primaryLogoKey)}`}
                  alt="System Logo"
                  className="h-12 w-12 rounded-xl object-contain border border-slate-200 dark:border-slate-700 p-1 bg-white"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0f1e36] text-white font-bold text-sm">
                  {merged.company.shortName || 'FOC'}
                </div>
              )}
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {merged.branding.systemNameEn || 'FLEET OPERATIONS CENTER'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {merged.branding.systemNameAr || 'مركز عمليات الأسطول وإدارة المندوبين'} — {merged.company.companyNameAr}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={`الإصدار ${merged.credits.version || 'v4.0 Enterprise'}`} tone="info" className="font-mono-num" />
              <StatusBadge label="حالة التشغيل: مستقر" tone="success" />
            </div>
          </div>

          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {merged.credits.systemSummary ||
              'منصة مؤسسية متكاملة لإدارة عمليات شركات التوصيل وتشغيل الأساطيل، تجمع بين الموارد البشرية للمندوبين، إدارة حسابات التطبيقات، تتبع السيارات والعهد والصيانة، مركز الحالات والتنبيهات، ومنشئ النماذج والحقول الديناميكي القابل للتخصيص الكامل دون تعديل الكود.'}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="text-[11px] text-slate-500">الشركة المشغلة</div>
              <div className="mt-1 text-xs font-bold text-slate-900 dark:text-slate-100">{merged.company.companyNameAr}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="text-[11px] text-slate-500">رقم الإصدار</div>
              <div className="mt-1 text-xs font-bold font-mono-num text-slate-900 dark:text-slate-100">
                {merged.credits.version || 'v4.0 Enterprise'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="text-[11px] text-slate-500">الاعتماد والأمان</div>
              <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>RBAC + Private Vault</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <SectionHeader title="التطوير والتصميم والاعتماد" actions={<Award className="h-4 w-4 text-blue-600" />} />
          <div className="rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/30 p-4 space-y-2.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>تم التطوير والتصميم بواسطة</span>
            </div>
            <div className="text-base font-bold text-slate-900 dark:text-white">
              {merged.credits.developerName || 'م- عبدالرحمن محمد'}
            </div>
            <div className="inline-flex items-center gap-1.5 font-mono-num text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Phone className="h-3.5 w-3.5 text-slate-500" />
              <span dir="ltr">{merged.credits.developerPhone || '0559786939'}</span>
            </div>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            {merged.credits.copyrightText || 'جميع الحقوق محفوظة · FLEET OPERATIONS CENTER'}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <SectionHeader title="سجل التحديثات والتطويرات (Changelog)" actions={<Info className="h-4 w-4 text-slate-500" />} />
        <div className="space-y-4">
          {CHANGELOG_ITEMS.map((item) => (
            <div key={item.version} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">{item.version}</span>
                <span className="font-mono-num text-xs text-slate-500">{item.date}</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                {item.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <SlideDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="تعديل اعتمادات المطور وإصدار النظام"
        subtitle="متاح لمالك النظام ومسؤول النظام الأعلى فقط"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" form="about-credits-form" variant="primary" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
              حفظ
            </Button>
          </>
        }
      >
        <form id="about-credits-form" onSubmit={(e) => void handleSaveCredits(e)} className="space-y-4">
          <FormField label="اسم المطور / المصمم" required>
            <Input required value={devName} onChange={(e) => setDevName(e.target.value)} />
          </FormField>
          <FormField label="رقم التواصل" required>
            <Input dir="ltr" className="font-mono-num" required value={devPhone} onChange={(e) => setDevPhone(e.target.value)} />
          </FormField>
          <FormField label="إصدار النظام" required>
            <Input dir="ltr" className="font-mono-num" required value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} />
          </FormField>
          <FormField label="نص حقوق الملكية">
            <Textarea rows={2} value={copyrightAr} onChange={(e) => setCopyrightAr(e.target.value)} />
          </FormField>
        </form>
      </SlideDrawer>
    </div>
  );
}
