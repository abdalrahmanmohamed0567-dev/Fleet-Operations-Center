import { RotateCcw } from 'lucide-react';
import type { FilterState } from '../types/fleet';

interface FilterBarProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  options: {
    dates: string[];
    months: string[];
    cities: string[];
    branches: string[];
    contracts: string[];
    supervisors: string[];
    vehicles: string[];
  };
}

export const EMPTY_FILTERS: FilterState = {
  date: '',
  month: '',
  platform: 'all',
  city: '',
  branch: '',
  contract: '',
  supervisor: '',
  vehicleType: '',
  riderId: '',
};

const selectCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-slate-400 dark:focus:border-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none';

export function FilterBar({ filters, onChange, options }: FilterBarProps) {
  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="no-print rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">التاريخ</label>
          <select value={filters.date} onChange={(e) => update({ date: e.target.value })} className={selectCls}>
            <option value="">كل التواريخ</option>
            {options.dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">الشهر</label>
          <select value={filters.month} onChange={(e) => update({ month: e.target.value })} className={selectCls}>
            <option value="">كل الأشهر</option>
            {options.months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">المنصة</label>
          <select
            value={filters.platform}
            onChange={(e) => update({ platform: e.target.value as FilterState['platform'] })}
            className={selectCls}
          >
            <option value="all">الكل (هنقر + كيتا)</option>
            <option value="hungerstation">HungerStation</option>
            <option value="keeta">Keeta</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">المدينة</label>
          <select value={filters.city} onChange={(e) => update({ city: e.target.value })} className={selectCls}>
            <option value="">كل المدن</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">الفرع</label>
          <select value={filters.branch} onChange={(e) => update({ branch: e.target.value })} className={selectCls}>
            <option value="">كل الفروع</option>
            {options.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">العقد</label>
          <select value={filters.contract} onChange={(e) => update({ contract: e.target.value })} className={selectCls}>
            <option value="">كل العقود</option>
            {options.contracts.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">المشرف</label>
          <select value={filters.supervisor} onChange={(e) => update({ supervisor: e.target.value })} className={selectCls}>
            <option value="">كل المشرفين</option>
            {options.supervisors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">نوع المركبة</label>
          <select value={filters.vehicleType} onChange={(e) => update({ vehicleType: e.target.value })} className={selectCls}>
            <option value="">الكل</option>
            {options.vehicles.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">معرف / اسم المندوب</label>
          <input
            type="text"
            value={filters.riderId}
            onChange={(e) => update({ riderId: e.target.value })}
            placeholder="بحث بالمعرف..."
            className={`${selectCls} placeholder:text-slate-400 dark:placeholder:text-slate-500`}
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>تصفير</span>
          </button>
        </div>
      </div>
    </div>
  );
}
