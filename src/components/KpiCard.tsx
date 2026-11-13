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

  const deltaColor =
    deltaTone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : deltaTone === 'critical'
        ? 'text-red-700 dark:text-red-400'
        : 'text-slate-500 dark:text-slate-400';

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span className={`text-[11px] font-semibold ${toneColor}`}>{statusText}</span>
          )}
          {onClick && (
            <ArrowUpLeft className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors" />
          )}
        </div>
      </div>
      <div className={`mt-2 text-2xl font-bold font-mono-num tracking-tight ${toneColor}`}>
        {value}
      </div>
      {(subtext || deltaText) && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400 truncate">{subtext || ''}</span>
          {deltaText && (
            <span className={`font-mono-num font-semibold shrink-0 ${deltaColor}`}>{deltaText}</span>
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
        className="group w-full text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transition-colors hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      {content}
    </div>
  );
}
