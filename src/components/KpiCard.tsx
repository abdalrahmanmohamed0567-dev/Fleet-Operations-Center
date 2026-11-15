import { ArrowUpLeft } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string;
  subtext?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'critical';
  statusText?: string;
  deltaText?: string;
  deltaTone?: 'good' | 'critical' | 'neutral';
  onClick?: () => void;
}

export function KpiCard({
  label,
  value,
  subtext,
  tone = 'neutral',
  statusText,
  deltaText,
  deltaTone = 'neutral',
  onClick,
}: KpiCardProps) {
  const toneColor =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'critical'
          ? 'text-red-700 dark:text-red-400'
          : 'text-slate-900 dark:text-slate-50';

  const statusTagCls =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/70 dark:border-emerald-800/70'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-200/70 dark:border-amber-800/70'
        : tone === 'critical'
          ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/60 border-red-200/70 dark:border-red-800/70'
          : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700';

  const deltaColor =
    deltaTone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : deltaTone === 'critical'
        ? 'text-red-700 dark:text-red-400'
        : 'text-slate-500 dark:text-slate-400';

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {label}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusTagCls}`}>
              {statusText}
            </span>
          )}
          {onClick && (
            <ArrowUpLeft className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
          )}
        </div>
      </div>
      <div className={`mt-2.5 text-2xl font-bold font-mono-num tracking-tight ${toneColor}`}>
        {value}
      </div>
      {(subtext || deltaText) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80 pt-2 text-[11px]">
          <span className="text-slate-500 dark:text-slate-400 truncate">{subtext || ''}</span>
          {deltaText && (
            <span className={`font-mono-num font-semibold shrink-0 ${deltaColor}`}>
              {deltaText}
            </span>
          )}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group w-full text-right rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transition-colors duration-150 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      {content}
    </div>
  );
}
