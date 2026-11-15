import {
  Activity,
  ArrowLeft,
  Globe,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Shield,
  Sun,
  Truck,
} from 'lucide-react';
import { useMemo } from 'react';
import { fmtNum, type FleetDataset } from '../lib/fleetAnalytics';
import { isKeetaActive } from '../shared/rbacCore';
import type {
  OperationalCase,
  OperationalSettings,
  Platform,
  PlatformCatalogEntry,
  UserProfile,
  WorkspaceMode,
} from '../types/fleet';
import { Button } from './ui/EnterpriseUI';

interface PlatformSelectorHomeProps {
  userProfile: UserProfile;
  allowedPlatforms: Platform[];
  canAccessGlobal: boolean;
  dataset: FleetDataset;
  operationalCases: OperationalCase[];
  settings?: OperationalSettings;
  platformCatalog?: PlatformCatalogEntry[];
  dataLoading: boolean;
  onRefreshData: () => void;
  onSignOut: () => void;
  onSelectWorkspace: (mode: Exclude<WorkspaceMode, 'selector'>) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function PlatformSelectorHome({
  userProfile,
  allowedPlatforms,
  canAccessGlobal,
  dataset,
  operationalCases,
  settings,
  platformCatalog = [],
  dataLoading,
  onRefreshData,
  onSignOut,
  onSelectWorkspace,
  theme,
  onToggleTheme,
}: PlatformSelectorHomeProps) {
  const keetaActive = isKeetaActive(settings, platformCatalog);

  const stats = useMemo(() => {
    const hsRiders = new Set(dataset.hungerDaily.map((r) => r.riderId)).size;
    const hsOrders = dataset.hungerDaily.reduce((s, r) => s + (r.completedDeliveries ?? 0), 0);
    const hsDates = dataset.hungerDaily.map((r) => r.date).sort();
    const hsLatest = hsDates[hsDates.length - 1] || 'لا توجد تقارير';
    const hsErrors = dataset.hungerDaily.filter((r) => Boolean(r.errorCodes && r.errorCodes.trim())).length;
    const hsOpenCases = operationalCases.filter(
      (c) => c.platform === 'hungerstation' && c.status !== 'closed' && c.status !== 'resolved'
    ).length;

    const ktRiders = keetaActive ? new Set(dataset.keetaDashboardDaily.map((r) => r.riderId)).size : 0;
    const ktOrders = keetaActive ? dataset.keetaDashboardDaily.reduce((s, r) => s + (r.deliveredTasks ?? 0), 0) : 0;
    const ktDates = keetaActive ? dataset.keetaDashboardDaily.map((r) => r.date).sort() : [];
    const ktLatest = ktDates[ktDates.length - 1] || 'لا توجد تقارير';
    const ktRankCount = keetaActive ? new Set(dataset.keetaRankSnapshots.map((r) => r.riderId)).size : 0;
    const ktOpenCases = keetaActive
      ? operationalCases.filter(
          (c) => c.platform === 'keeta' && c.status !== 'closed' && c.status !== 'resolved'
        ).length
      : 0;

    const totalHours =
      dataset.hungerDaily.reduce((s, r) => s + (r.actualWorkingHours ?? 0), 0) +
      (keetaActive ? dataset.keetaDashboardDaily.reduce((s, r) => s + (r.shiftOnlineHours ?? 0), 0) : 0);

    return {
      hsRiders,
      hsOrders,
      hsLatest,
      hsErrors,
      hsOpenCases,
      ktRiders,
      ktOrders,
      ktLatest,
      ktRankCount,
      ktOpenCases,
      totalRiders: hsRiders + ktRiders,
      totalOrders: hsOrders + ktOrders,
      totalHours: Number(totalHours.toFixed(1)),
      totalOpenCases: hsOpenCases + ktOpenCases,
    };
  }, [dataset, operationalCases, keetaActive]);

  const canHs = allowedPlatforms.includes('hungerstation');
  const canKt = keetaActive && allowedPlatforms.includes('keeta');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060b16] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Clean Enterprise Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f1e36] dark:bg-blue-600 text-white">
              <Truck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                Fleet Operations Center
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                منصة الإدارة اللوجستية والأسطول
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex flex-col items-end pl-2 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{userProfile.displayName}</span>
              <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                {userProfile.role} · {userProfile.email}
              </span>
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>

            <Button
              variant="secondary"
              size="md"
              disabled={dataLoading}
              onClick={onRefreshData}
              icon={<RefreshCw className={`h-3.5 w-3.5 ${dataLoading ? 'animate-spin' : ''}`} />}
            >
              <span className="hidden sm:inline">تحديث</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              onClick={onSignOut}
              className="text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40"
              icon={<LogOut className="h-3.5 w-3.5" />}
            >
              <span className="hidden sm:inline">خروج</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Selector Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
            محدد مساحات العمل والأنظمة
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white [text-wrap:balance]">
            اختر بيئة التشغيل للدخول إلى مساحة العمل المستقلة
          </h1>
          <p className="max-w-3xl text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
            يتم عزل بيانات ومندوبي وتقارير وفلاتر كل منصة بشكل كامل داخل مساحة عملها المستقلة، بينما يتيح نظام الإدارة المتكامل ERP التحكم في الموارد البشرية والأسطول والصلاحيات والتقارير التنفيذية.
          </p>
        </div>

        {/* Platform Cards */}
        <div className={`grid grid-cols-1 gap-6 ${keetaActive ? 'lg:grid-cols-2' : ''}`}>
          {/* Card 1: HungerStation Operations */}
          <div
            className={`flex flex-col justify-between rounded-xl border bg-white dark:bg-slate-900 p-6 transition-colors ${
              canHs
                ? 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                : 'border-slate-200 dark:border-slate-800 opacity-70'
            }`}
          >
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      مساحة العمل 01 · HungerStation
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      HungerStation Operations
                    </h2>
                  </div>
                </div>
                {!canHs && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <Lock className="h-3.5 w-3.5" />
                    <span>غير مصرح</span>
                  </span>
                )}
              </div>

              {/* Clean hairline stat strip (no nested bordered card-within-card boxes) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">مندوبو هنقر</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-slate-900 dark:text-white">
                    {fmtNum(stats.hsRiders)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">الطلبات المكتملة</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                    {fmtNum(stats.hsOrders)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">سجلات Error Codes</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-amber-700 dark:text-amber-400">
                    {fmtNum(stats.hsErrors)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">آخر تحديث</div>
                  <div className="mt-1 text-xs font-bold font-mono-num text-slate-800 dark:text-slate-200">
                    {stats.hsLatest}
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4 text-xs text-slate-600 dark:text-slate-300">
                <div className="font-bold text-slate-800 dark:text-slate-200">النطاقات المتوفرة داخل مساحة العمل:</div>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <li>· لوحة قيادة HungerStation والمؤشرات</li>
                  <li>· المندوبون وملف Rider 360° الخاص بهنقر</li>
                  <li>· مركز ذكاء أكواد الأخطاء (Error Intelligence)</li>
                  <li>· المسافات (Riders Distance) والمحفظة (Wallet)</li>
                  <li>· شرائح جودة التسليم الشهرية (Segmentation)</li>
                  <li>· التنبيهات، التقارير، ومركز استيراد هنقر</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
              <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                حالات مفتوحة: {fmtNum(stats.hsOpenCases)}
              </span>
              <Button
                variant="primary"
                size="lg"
                disabled={!canHs}
                onClick={() => onSelectWorkspace('hungerstation')}
              >
                <span>الدخول إلى HungerStation Operations</span>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Card 2: Keeta Operations (Shown only when enabled by Feature Flag) */}
          {keetaActive && (
            <div
              className={`flex flex-col justify-between rounded-xl border bg-white dark:bg-slate-900 p-6 transition-colors ${
                canKt
                  ? 'border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600'
                  : 'border-slate-200 dark:border-slate-800 opacity-70'
              }`}
            >
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                        مساحة العمل 02 · Keeta
                      </div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Keeta Operations
                      </h2>
                    </div>
                  </div>
                  {!canKt && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <Lock className="h-3.5 w-3.5" />
                      <span>غير مصرح</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
                  <div className="p-3.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">مندوبو كيتا</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-slate-900 dark:text-white">
                      {fmtNum(stats.ktRiders)}
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">المهام المسلمة</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                      {fmtNum(stats.ktOrders)}
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">لقطات RankPlan</div>
                    <div className="mt-1 text-lg font-bold font-mono-num text-blue-700 dark:text-blue-400">
                      {fmtNum(stats.ktRankCount)}
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">آخر تحديث</div>
                    <div className="mt-1 text-xs font-bold font-mono-num text-slate-800 dark:text-slate-200">
                      {stats.ktLatest}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4 text-xs text-slate-600 dark:text-slate-300">
                  <div className="font-bold text-slate-800 dark:text-slate-200">النطاقات المتوفرة داخل مساحة العمل:</div>
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <li>· لوحة قيادة Keeta والمؤشرات اليومية</li>
                    <li>· المندوبون وملف Rider 360° الخاص بكيتا</li>
                    <li>· بيانات VDA والشفتات (Online Day &amp; S1-S6)</li>
                    <li>· لقطات RankPlanProcess والمكافآت المعزولة</li>
                    <li>· تقارير التحقق من الهوية (Facial Recognition)</li>
                    <li>· التنبيهات، التقارير، ومركز استيراد كيتا</li>
                  </ul>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                  حالات مفتوحة: {fmtNum(stats.ktOpenCases)}
                </span>
                <Button
                  variant="accent"
                  size="lg"
                  disabled={!canKt}
                  onClick={() => onSelectWorkspace('keeta')}
                >
                  <span>الدخول إلى Keeta Operations</span>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Global Executive ERP Section */}
        {canAccessGlobal ? (
          <div className="rounded-xl border border-[#1e2f4d] bg-[#0b1628] p-6 text-white">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-400">
                  <Globe className="h-4 w-4" />
                  <span>بوابة الإدارة العليا والأنظمة المترابطة ERP</span>
                </div>
                <h2 className="text-xl font-bold text-white">
                  نظام الإدارة المتكامل ERP والتحكم التنفيذي
                </h2>
                <p className="max-w-2xl text-xs text-slate-300 leading-relaxed">
                  بوابة الموارد البشرية وإدارة الأسطول والتطبيقات والصلاحيات: تتضمن متابعة الوثائق الخاصة، الأسطول والصيانة، ربط حسابات المنصات، والتقارير التنفيذية الشاملة.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-[#1e2f4d] rounded-xl border border-[#1e2f4d] bg-[#070f1d] shrink-0">
                <div className="px-4 py-3">
                  <div className="text-[11px] text-slate-400">المندوبون النشطون</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-white">{fmtNum(stats.totalRiders)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] text-slate-400">إجمالي الطلبات</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-emerald-400">{fmtNum(stats.totalOrders)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] text-slate-400">ساعات العمل</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-white">{fmtNum(stats.totalHours, 1)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] text-slate-400">الحالات المفتوحة</div>
                  <div className="mt-1 text-lg font-bold font-mono-num text-amber-400">{fmtNum(stats.totalOpenCases)}</div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#1e2f4d] pt-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Shield className="h-4 w-4 text-blue-400 shrink-0" />
                <span>واجهة موحدة للموارد البشرية والأسطول والتطبيقات والصلاحيات وفق نطاق بيانات كل مستخدم.</span>
              </div>
              <button
                type="button"
                onClick={() => onSelectWorkspace('global')}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-5 text-xs font-bold text-[#0f1e36] hover:bg-slate-100 whitespace-nowrap shrink-0 transition-colors"
              >
                <span>الدخول إلى نظام الإدارة المتكامل ERP</span>
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-500 dark:text-slate-400">
            حسابك مخصص للعمل داخل مساحات المنصات المصرح لك بها فقط ({(keetaActive ? allowedPlatforms : allowedPlatforms.filter((p) => p !== 'keeta')).join(' · ')}).
          </div>
        )}
      </main>
    </div>
  );
}
