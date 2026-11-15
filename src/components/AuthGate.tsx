import { ShieldCheck, Truck } from 'lucide-react';
import type { UserProfile } from '../types/fleet';
import { Button, ToastBanner } from './ui/EnterpriseUI';

interface AuthGateProps {
  loading: boolean;
  error: string | null;
  pendingProfile: UserProfile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AuthGate({ loading, error, pendingProfile, onSignIn, onSignOut }: AuthGateProps) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060b16] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0f1e36] dark:bg-blue-600 text-white">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">
              Fleet Operations Center
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              منظومة إدارة الأسطول والموارد البشرية والتشغيل
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-6">
          {pendingProfile ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-bold">
                <ShieldCheck className="h-5 w-5 shrink-0" />
                <span>الحساب بانتظار التفعيل الإداري</span>
              </div>
              <p className="text-xs sm:text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                تم تسجيل دخولك بالبريد{' '}
                <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                  {pendingProfile.email}
                </span>{' '}
                بدور مبدئي (<span className="font-mono-num">{pendingProfile.role}</span>)، ولكن الحساب غير مفعّل بعد. يرجى التواصل مع مدير النظام لتفعيل الصلاحيات.
              </p>
              <Button variant="secondary" onClick={onSignOut} className="w-full">
                تسجيل الخروج
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
                  تسجيل الدخول إلى منصة الإدارة
                </h2>
                <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                  سجّل الدخول بحساب Google المعتمد للوصول إلى لوحات العمليات، الموارد البشرية، إدارة الأسطول، وتقارير Excel السحابية.
                </p>
              </div>

              {error && <ToastBanner type="err" message={error} />}

              <button
                type="button"
                onClick={onSignIn}
                disabled={loading}
                className="gsi-material-button w-full"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="block h-5 w-5">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {loading ? 'جاري التحقق وتسجيل الدخول...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
