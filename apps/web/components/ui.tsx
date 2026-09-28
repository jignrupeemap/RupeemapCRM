'use client';
/**
 * Rupeemap design system: small, accessible building blocks shared by every
 * screen. Colours come from the Tailwind theme (logo palette).
 */
import * as Dialog from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Inbox, Loader2, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CASE_STATUS_LABELS, PAYOUT_STATUS_LABELS, type CaseStatus, type PayoutStatus } from '@rupeemap/shared';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-800 disabled:bg-ink-400',
  teal: 'bg-teal text-white hover:bg-teal-700 disabled:bg-teal-400',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-ink-200 hover:bg-ink-50 disabled:text-ink-400',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-brand-red text-white hover:brightness-95 disabled:opacity-60',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
          size === 'sm' && 'h-9 px-3 text-sm',
          size === 'md' && 'h-11 px-4 text-sm',
          size === 'lg' && 'h-12 px-5 text-base',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

export function Field({ label, error, hint, children, required, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-700">
        {label}
        {required && <span className="text-brand-red"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-brand-red" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  'h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-[15px] text-ink placeholder:text-ink-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100 disabled:bg-ink-50 aria-[invalid=true]:border-brand-red';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: string }>(function Input({ className, prefix, ...rest }, ref) {
  if (prefix)
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-500">{prefix}</span>
        <input ref={ref} className={cx(inputBase, 'pl-8 tabular-nums', className)} {...rest} />
      </div>
    );
  return <input ref={ref} className={cx(inputBase, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputBase, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%236b746f%27 stroke-width=%272%27%3E%3Cpath d=%27m4 6 4 4 4-4%27/%3E%3C/svg%3E")] bg-[right_12px_center] bg-no-repeat pr-9', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'h-auto min-h-[88px] py-2.5', className)} {...rest} />;
});

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: any }) {
  return <As className={cx('rounded-2xl border border-ink-200/70 bg-white shadow-card', className)}>{children}</As>;
}

export function SectionTitle({ title, action, sub }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        {sub && <p className="text-sm text-ink-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const CASE_TONE: Record<CaseStatus, string> = {
  LOGIN: 'bg-sky-50 text-sky-800 ring-sky-200',
  SANCTION: 'bg-violet-50 text-violet-800 ring-violet-200',
  DISBURSED: 'bg-teal-50 text-teal-800 ring-teal-200',
  HANDOVER: 'bg-emerald-600 text-white ring-emerald-600',
  QUERY: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  REJECT: 'bg-brand-redsoft text-red-800 ring-red-200',
  WITHDRAW: 'bg-ink-100 text-ink-600 ring-ink-200',
};

export function StatusChip({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', CASE_TONE[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

const PAYOUT_TONE: Record<PayoutStatus, string> = {
  PENDING: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-sky-50 text-sky-800 ring-sky-200',
  PAID: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  HOLD: 'bg-brand-redsoft text-red-800 ring-red-200',
};

export function PayoutChip({ status }: { status: PayoutStatus }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', PAYOUT_TONE[status])}>{PAYOUT_STATUS_LABELS[status]}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'gold' | 'red' | 'dark' }) {
  const t = {
    neutral: 'bg-ink-100 text-ink-700',
    teal: 'bg-teal-100 text-teal-800',
    gold: 'bg-brand-goldsoft text-amber-800',
    red: 'bg-brand-redsoft text-red-800',
    dark: 'bg-ink text-white',
  }[tone];
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', t)}>{children}</span>;
}

export function Kpi({ label, value, sub, tone = 'neutral', href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'teal' | 'gold' | 'red'; href?: string }) {
  const accent = { neutral: 'before:bg-ink-200', teal: 'before:bg-teal', gold: 'before:bg-brand-gold', red: 'before:bg-brand-red' }[tone];
  const body = (
    <div className={cx('relative h-full overflow-hidden rounded-2xl border border-ink-200/70 bg-white p-4 shadow-card transition before:absolute before:inset-x-0 before:top-0 before:h-1', accent, href && 'hover:border-ink-300 hover:shadow-pop')}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-ink-100', className)} aria-hidden />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
      <TriangleAlert className="h-6 w-6 text-brand-red" />
      <p className="font-semibold text-ink">Could not load this</p>
      <p className="text-sm text-ink-500">{(error as Error)?.message ?? 'Please try again.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className={cx(
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-pop focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6',
            wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-bold text-ink">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-ink-500">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-ink-200 px-4 sm:mx-0 sm:px-0" aria-label="Sections">
      {children}
    </TabsPrimitive.List>
  );
}
export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="relative -mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-ink-500 transition hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
    >
      {children}
      {count ? <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-xs text-ink-600">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}
export const TabPanel = TabsPrimitive.Content;

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-3 text-sm text-ink-500">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
      </div>
    </div>
  );
}

export function DetailGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{k}</dt>
          <dd className="mt-1 break-words text-[15px] text-ink tabular-nums">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Banner({ tone = 'gold', title, children, action }: { tone?: 'gold' | 'red' | 'teal'; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = { gold: 'border-amber-200 bg-brand-goldsoft text-amber-900', red: 'border-red-200 bg-brand-redsoft text-red-900', teal: 'border-teal-200 bg-teal-50 text-teal-900' }[tone];
  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between', t)} role="status">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">{title}</p>
          {children && <div className="text-sm opacity-90">{children}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}
