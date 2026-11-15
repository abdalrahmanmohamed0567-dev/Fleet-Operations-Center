import { RotateCcw } from 'lucide-react';
import type { FilterState, Platform } from '../types/fleet';
import { Button, Card, Input, Select } from './ui/EnterpriseUI';

interface FilterBarProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  lockedPlatform?: Platform;
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

export function FilterBar({ filters, onChange, lockedPlatform, options }: FilterBarProps) {
  const update = (patch: Partial<FilterState>) =>
    onChange({
      ...filters,
      ...patch,
      platform: lockedPlatform || patch.platform || filters.platform,
    });

  const handleReset = () =>
    onChange({
      ...EMPTY_FILTERS,
      platform: lockedPlatform || 'all',
    });

  return (
    <Card padding="sm" className="no-print">
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${lockedPlatform ? 'xl:grid-cols-9' : 'xl:grid-cols-10'}`}>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">التاريخ</label>
          <Select value={filters.date} onChange={(e) => update({ date: e.target.value })} className="font-mono-num">
            <option value="">كل التواريخ</option>
            {options.dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">الشهر</label>
          <Select value={filters.month} onChange={(e) => update({ month: e.target.value })} className="font-mono-num">
            <option value="">كل الأشهر</option>
            {options.months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </div>

        {!lockedPlatform && (
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">المنصة</label>
            <Select
              value={filters.platform}
              onChange={(e) => update({ platform: e.target.value as FilterState['platform'] })}
            >
              <option value="all">الكل (هنقر + كيتا)</option>
              <option value="hungerstation">HungerStation</option>
              <option value="keeta">Keeta</option>
            </Select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">المدينة</label>
          <Select value={filters.city} onChange={(e) => update({ city: e.target.value })}>
            <option value="">كل المدن</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">الفرع</label>
          <Select value={filters.branch} onChange={(e) => update({ branch: e.target.value })}>
            <option value="">كل الفروع</option>
            {options.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">العقد</label>
          <Select value={filters.contract} onChange={(e) => update({ contract: e.target.value })}>
            <option value="">كل العقود</option>
            {options.contracts.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">المشرف</label>
          <Select value={filters.supervisor} onChange={(e) => update({ supervisor: e.target.value })}>
            <option value="">كل المشرفين</option>
            {options.supervisors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">نوع المركبة</label>
          <Select value={filters.vehicleType} onChange={(e) => update({ vehicleType: e.target.value })}>
            <option value="">الكل</option>
            {options.vehicles.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">معرف / اسم المندوب</label>
          <Input
            type="text"
            value={filters.riderId}
            onChange={(e) => update({ riderId: e.target.value })}
            placeholder="بحث بالمعرف..."
          />
        </div>

        <div className="flex items-end">
          <Button
            variant="secondary"
            size="md"
            onClick={handleReset}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            className="w-full"
          >
            تصفير
          </Button>
        </div>
      </div>
    </Card>
  );
}
