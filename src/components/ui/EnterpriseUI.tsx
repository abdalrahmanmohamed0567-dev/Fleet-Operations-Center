import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const sizeCls =
    size === 'sm'
      ? 'h-8 px-3 text-xs gap-1.5 rounded-lg'
      : size === 'lg'
        ? 'h-10 px-5 text-sm gap-2 rounded-lg'
        : 'h-9 px-4 text-xs font-semibold gap-2 rounded-lg';

  const variantCls =
    variant === 'primary'
      ? 'bg-[#0f1e36] text-white hover:bg-[#172c4d] dark:bg-blue-600 dark:hover:bg-blue-500 border border-transparent'
      : variant === 'accent'
        ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 border border-transparent'
        : variant === 'danger'
          ? 'bg-red-600 text-white hover:bg-red-700 border border-transparent'
          : variant === 'ghost'
            ? 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600';

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-55 ${sizeCls} ${variantCls} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Card & SectionHeader & PageHeader                                          */
/* -------------------------------------------------------------------------- */
interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  const padCls =
    padding === 'none'
      ? ''
      : padding === 'sm'
        ? 'p-4'
        : padding === 'lg'
          ? 'p-6'
          : 'p-5';
  return (
    <section
      className={`rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 ${padCls} ${className}`}
    >
      {children}
    </section>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, actions, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white [text-wrap:balance]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* StatusBadge (Structured, accessible, non-hue-only text badges)             */
/* -------------------------------------------------------------------------- */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
}

export function StatusBadge({ label, tone = 'neutral', icon, className = '' }: StatusBadgeProps) {
  const toneCls =
    tone === 'success'
      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70'
      : tone === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70'
        : tone === 'danger'
          ? 'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-200/80 dark:border-red-800/70'
          : tone === 'info'
            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/70'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0 ${toneCls} ${className}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Form Controls (FormField, Input, Select, Textarea)                         */
/* -------------------------------------------------------------------------- */
const BASE_INPUT_CLS =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs sm:text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:border-blue-600 dark:focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE_INPUT_CLS} h-9 ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${BASE_INPUT_CLS} h-9 ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE_INPUT_CLS} min-h-[84px] ${className}`} {...props} />;
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, required, hint, error, children, className = '' }: FormFieldProps) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {label}
          {required && <span className="mr-1 text-red-600 dark:text-red-400">*</span>}
        </span>
        {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{error}</p>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */
export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  icon?: ReactNode;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  variant?: 'segmented' | 'underline';
  className?: string;
}

export function Tabs<K extends string>({
  items,
  activeKey,
  onChange,
  variant = 'segmented',
  className = '',
}: TabsProps<K>) {
  if (variant === 'underline') {
    return (
      <div className={`flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 ${className}`}>
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`relative inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="font-mono-num text-[11px] text-slate-400 dark:text-slate-500">
                  ({item.count.toLocaleString('en-US')})
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 p-1 ${className}`}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-150 ${
              active
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="font-mono-num text-[11px] opacity-75">
                ({item.count.toLocaleString('en-US')})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RTL SlideDrawer (for quick forms & detail inspection)                      */
/* -------------------------------------------------------------------------- */
interface SlideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
}

export function SlideDrawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  children,
}: SlideDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widthCls =
    size === 'sm'
      ? 'max-w-md'
      : size === 'lg'
        ? 'max-w-2xl'
        : size === 'xl'
          ? 'max-w-4xl'
          : 'max-w-xl';

  return (
    <div
      className="no-print fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* In RTL dir="rtl", justify-end aligns the drawer cleanly on the reading-end (left) side */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative flex h-full w-full ${widthCls} flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto erp-scroll p-5 space-y-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ToastBanner                                                                */
/* -------------------------------------------------------------------------- */
interface ToastBannerProps {
  type: 'ok' | 'err' | 'info' | 'warn';
  message: string;
  onDismiss?: () => void;
}

export function ToastBanner({ type, message, onDismiss }: ToastBannerProps) {
  const styleCls =
    type === 'ok'
      ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200'
      : type === 'err'
        ? 'border-red-200 dark:border-red-800/80 bg-red-50 dark:bg-red-950/50 text-red-900 dark:text-red-200'
        : type === 'warn'
          ? 'border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
          : 'border-blue-200 dark:border-blue-800/80 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200';

  const Icon =
    type === 'ok'
      ? CheckCircle2
      : type === 'err' || type === 'warn'
        ? AlertTriangle
        : Info;

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${styleCls}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="leading-relaxed">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق التنبيه"
          className="rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState & TableSkeleton                                                 */
/* -------------------------------------------------------------------------- */
interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, subtitle, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500">
        {icon || <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h3>
      {subtitle && (
        <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="h-8 w-56 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-5 w-28 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="flex items-center gap-4 px-4 h-[44px]">
            {Array.from({ length: cols }).map((__, cIdx) => (
              <div
                key={cIdx}
                className="h-3.5 flex-1 rounded bg-slate-100 dark:bg-slate-800 animate-pulse"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
