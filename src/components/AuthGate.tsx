import { CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, Smartphone, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_COMPANY_BRANDING } from '../lib/dynamicSchemaEngine';
import type { UserProfile } from '../types/fleet';
import { Button, FormField, Input, ToastBanner } from './ui/EnterpriseUI';

interface AuthGateProps {
  loading: boolean;
  error: string | null;
  pendingProfile: UserProfile | null;
  onSignIn: (phone: string, password: string) => void | Promise<void>;
  onSignOut: () => void;
}

interface PublicBrandingPayload {
  companyNameAr?: string;
  companyNameEn?: string;
  systemNameAr?: string;
  systemNameEn?: string;
  primaryLogoKey?: string;
  primaryColor?: string;
  secondaryColor?: string;
  loginScreenStyle?: 'split' | 'centered' | 'minimal';
  loginHeadlineAr?: string;
  loginSubheadlineAr?: string;
  developerName?: string;
  version?: string;
}

export function AuthGate({ loading, error, pendingProfile, onSignIn, onSignOut }: AuthGateProps) {
  const [pubBrand, setPubBrand] = useState<PublicBrandingPayload | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/branding/public')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data === 'object') {
          const obj = (data as { branding?: PublicBrandingPayload }).branding || (data as PublicBrandingPayload);
          setPubBrand(obj);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const systemNameEn = pubBrand?.systemNameEn || DEFAULT_COMPANY_BRANDING.branding.systemNameEn;
  const systemNameAr = pubBrand?.systemNameAr || DEFAULT_COMPANY_BRANDING.branding.systemNameAr;
  const companyNameAr = pubBrand?.companyNameAr || DEFAULT_COMPANY_BRANDING.company.companyNameAr;
  const headline = pubBrand?.loginHeadlineAr || DEFAULT_COMPANY_BRANDING.branding.loginHeadlineAr;
  const subheadline = pubBrand?.loginSubheadlineAr || DEFAULT_COMPANY_BRANDING.branding.loginSubheadlineAr;
  const primaryColor = pubBrand?.primaryColor || DEFAULT_COMPANY_BRANDING.branding.primaryColor;
  const secondaryColor = pubBrand?.secondaryColor || DEFAULT_COMPANY_BRANDING.branding.secondaryColor;
  const loginStyle = pubBrand?.loginScreenStyle || DEFAULT_COMPANY_BRANDING.branding.loginScreenStyle || 'split';
  const logoKey = !logoFailed ? pubBrand?.primaryLogoKey : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    void onSignIn(phone.trim(), password);
  };

  const renderBrandHeader = () => (
    <div className="flex items-center gap-3.5">
      {logoKey ? (
        <img
          src={`/api/branding/logo/${encodeURIComponent(logoKey)}`}
          alt={systemNameAr}
          onError={() => setLogoFailed(true)}
          className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white object-contain p-1"
        />
      ) : (
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: primaryColor }}
        >
          <Truck className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">{systemNameEn}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {companyNameAr || systemNameAr}
        </p>
      </div>
    </div>
  );

  const renderAuthBody = () =>
    pendingProfile ? (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-bold">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          <span>الحساب بانتظار التفعيل الإداري</span>
        </div>
        <p className="text-xs sm:text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
          الحساب المرتبط برقم الجوال{' '}
          <span className="font-mono-num font-semibold text-slate-900 dark:text-white" dir="ltr">
            {pendingProfile.phone || pendingProfile.email}
          </span>{' '}
          موقوف أو بانتظار التفعيل حاليًا. يرجى التواصل مع مدير النظام لتفعيل الصلاحيات.
        </p>
        <Button variant="secondary" onClick={onSignOut} className="w-full">
          تسجيل الخروج
        </Button>
      </div>
    ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
            تسجيل الدخول إلى منصة الإدارة
          </h2>
          <p className="mt-1 text-xs sm:text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            أدخل رقم الجوال وكلمة المرور المعتمدة للوصول إلى لوحة العمليات والموارد البشرية وإدارة الأسطول.
          </p>
        </div>

        {error && <ToastBanner type="err" message={error} />}

        <FormField label="رقم الجوال" required>
          <div className="relative">
            <Smartphone className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="username"
              dir="ltr"
              required
              disabled={loading}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05XXXXXXXX"
              className="font-mono-num pr-9 text-left"
            />
          </div>
        </FormField>

        <FormField label="كلمة المرور" required>
          <div className="relative">
            <Lock className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              className="font-mono-num pr-9 pl-10 text-left"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={loading || !phone.trim() || !password}
          className="w-full mt-2"
        >
          {loading ? 'جاري التحقق والدخول...' : 'تسجيل الدخول'}
        </Button>
      </form>
    );

  if (loginStyle === 'split') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#060b16] text-slate-900 dark:text-slate-100 grid grid-cols-1 lg:grid-cols-12">
        <div
          className="hidden lg:flex lg:col-span-6 flex-col justify-between p-10 text-white relative overflow-hidden"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex items-center gap-3.5 relative z-10">
            {logoKey ? (
              <img
                src={`/api/branding/logo/${encodeURIComponent(logoKey)}`}
                alt={systemNameAr}
                onError={() => setLogoFailed(true)}
                className="h-12 w-12 rounded-xl bg-white/95 object-contain p-1.5"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: secondaryColor }}
              >
                <Truck className="h-6 w-6" />
              </div>
            )}
            <div>
              <div className="text-base font-bold tracking-tight">{systemNameEn}</div>
              <div className="text-xs text-slate-300">{companyNameAr}</div>
            </div>
          </div>

          <div className="space-y-5 max-w-lg relative z-10">
            <h2 className="text-2xl font-bold leading-snug">{headline}</h2>
            <p className="text-sm text-slate-200/90 leading-relaxed">{subheadline}</p>
            <div className="grid grid-cols-1 gap-2.5 pt-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300 shrink-0" />
                <span>ملف مندوب موحّد 360° يربط الموارد البشرية بالمنصات والمركبات</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300 shrink-0" />
                <span>خزينة مستندات خاصة ومصفوفة صلاحيات مؤسسية محمية</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300 shrink-0" />
                <span>نسخ احتياطي تلقائي يومي ومركز تخصيص متكامل (System Builder)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-300/80 border-t border-white/10 pt-4 relative z-10">
            <span>{pubBrand?.developerName || DEFAULT_COMPANY_BRANDING.credits.developerName}</span>
            <span className="font-mono-num">{pubBrand?.version || DEFAULT_COMPANY_BRANDING.credits.version}</span>
          </div>
        </div>

        <div className="lg:col-span-6 flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 sm:p-8 shadow-sm">
            <div className="lg:hidden mb-6">{renderBrandHeader()}</div>
            <div className="hidden lg:block mb-6">
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">{systemNameAr}</div>
              <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{companyNameAr}</div>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-6">{renderAuthBody()}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060b16] text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-6">
      <div
        className={`w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm ${
          loginStyle === 'minimal' ? 'max-w-sm p-6' : 'max-w-md p-7 sm:p-8'
        }`}
      >
        {renderBrandHeader()}
        {loginStyle !== 'minimal' && headline && (
          <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 px-3.5 py-2.5">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{headline}</div>
            {subheadline && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{subheadline}</div>}
          </div>
        )}
        <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-6">{renderAuthBody()}</div>
      </div>
      {loginStyle !== 'minimal' && (
        <div className="mt-4 text-[11px] text-slate-400 dark:text-slate-500 font-mono-num">
          {pubBrand?.version || DEFAULT_COMPANY_BRANDING.credits.version} ·{' '}
          {pubBrand?.developerName || DEFAULT_COMPANY_BRANDING.credits.developerName}
        </div>
      )}
    </div>
  );
}
