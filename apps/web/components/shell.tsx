'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BookUser,
  Building2,
  ClipboardCheck,
  FileStack,
  Hash,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  UserMinus,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Permission } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { useMe } from '@/lib/session';
import { cx, Skeleton } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  perm?: Permission;
  roles?: string[];
  soon?: boolean;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Work',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/cases', label: 'All Cases', icon: FileStack },
      { href: '/team', label: 'Team Data', icon: Users, perm: 'USER_VIEW', roles: ['DSA'] },
      { href: '/users', label: 'Users', icon: Users, perm: 'USER_VIEW', roles: ['ADMIN', 'EXECUTIVE'] },
      { href: '/inactive-partners', label: 'Inactive Partners', icon: UserMinus, perm: 'USER_VIEW', roles: ['ADMIN', 'EXECUTIVE'] },
      { href: '/payouts', label: 'Payout', icon: Wallet, perm: 'PAYOUT_VIEW' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { href: '/projects', label: 'Project Master', icon: Building2, perm: 'PROJECT_VIEW' },
      { href: '/bankers', label: 'Banker Directory', icon: BookUser, perm: 'BANKER_VIEW' },
      { href: '/checklist', label: 'Checklist', icon: ClipboardCheck, perm: 'CHECKLIST_VIEW', soon: true },
      { href: '/bank-codes', label: 'Bankwise Code', icon: Hash, perm: 'BANK_CODE_VIEW', soon: true },
    ],
  },
  {
    group: 'Support',
    items: [
      { href: '/queries', label: 'Raise Query', icon: HelpCircle, perm: 'QUERY_CREATE', soon: true },
      { href: '/assistance', label: 'Need Assistance', icon: LifeBuoy, perm: 'SUPPORT_CREATE', soon: true },
      { href: '/audit', label: 'Audit Log', icon: ShieldCheck, perm: 'AUDIT_VIEW', soon: true },
    ],
  },
];

function visible(item: NavItem, perms: Permission[], role: string) {
  if (item.perm && !perms.includes(item.perm)) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  return true;
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Rupeemap home">
      <Image src="/rupeemap-logo.jpg" alt="Rupeemap" width={compact ? 92 : 118} height={compact ? 55 : 70} priority className="h-auto rounded-md" />
    </Link>
  );
}

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<{ unreadCount: number }>('/notifications', { unread: '1' }),
    refetchInterval: 60_000,
  });
  const n = data?.unreadCount ?? 0;
  return (
    <Link href="/notifications" className="relative rounded-xl p-2.5 text-ink-700 hover:bg-ink-100" aria-label={`Notifications, ${n} unread`}>
      <Bell className="h-5 w-5" />
      {n > 0 && (
        <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[11px] font-bold text-white tabular-nums">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="relative hidden max-w-md flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/cases?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search case ID, customer, mobile, loan account"
        className="h-10 w-full rounded-xl border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-100"
        aria-label="Search cases"
      />
    </form>
  );
}

function ProfileMenu() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return <Skeleton className="h-9 w-9 rounded-full" />;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-ink-100" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{initials(me.name)}</span>
        <span className="hidden text-left lg:block">
          <span className="block text-sm font-semibold leading-tight text-ink">{me.name}</span>
          <span className="block text-xs text-ink-500">{ROLE_LABELS[me.role]}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-56 rounded-2xl border border-ink-200 bg-white p-1.5 shadow-pop">
          <div className="px-3 py-2">
            <p className="text-sm font-semibold">{me.name}</p>
            <p className="text-xs text-ink-500">
              {ROLE_LABELS[me.role]}
              {me.dsaCode ? ` · ${me.dsaCode}` : ''}
            </p>
          </div>
          <Link href="/profile" role="menuitem" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-ink-50" onClick={() => setOpen(false)}>
            <UserRound className="h-4 w-4" /> Profile
          </Link>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-brand-red hover:bg-brand-redsoft"
            onClick={async () => {
              await api.post('/auth/logout').catch(() => undefined);
              qc.clear();
              router.replace('/login');
            }}
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

const BOTTOM = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/cases', label: 'Cases', icon: FileStack },
  { href: '/cases/new', label: 'New', icon: Plus, fab: true },
  { href: '/payouts', label: 'Payout', icon: Wallet },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, isLoading, isError } = useMe();

  useEffect(() => {
    if (isError) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isError, pathname, router]);

  if (isLoading || !me)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || (pathname.startsWith(href + '/') && !(href === '/cases' && pathname === '/cases/new')));

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="flex h-20 items-center px-5">
          <Logo />
        </div>
        <div className="px-4 pb-3">
          <Link href="/cases/new" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ink font-semibold text-white hover:bg-ink-800">
            <Plus className="h-4 w-4" /> Add New Case
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Main">
          {NAV.map((g) => {
            const items = g.items.filter((i) => visible(i, me.permissions, me.role));
            if (!items.length) return null;
            return (
              <div key={g.group} className="mt-4">
                <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">{g.group}</p>
                {items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={cx(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                      active(i.href) ? 'bg-ink text-white' : 'text-ink-700 hover:bg-ink-100',
                    )}
                  >
                    <i.icon className="h-[18px] w-[18px]" />
                    <span className="flex-1">{i.label}</span>
                    {i.soon && <span className={cx('rounded px-1.5 text-[10px] font-bold uppercase', active(i.href) ? 'bg-white/15' : 'bg-ink-100 text-ink-500')}>Soon</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-ink-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <Link href="/cases" className="rounded-xl p-2.5 text-ink-700 hover:bg-ink-100 md:hidden" aria-label="Search cases">
              <Search className="h-5 w-5" />
            </Link>
            <NotificationBell />
            <ProfileMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Quick">
        <div className="grid grid-cols-5">
          {BOTTOM.map((b) =>
            b.fab ? (
              <Link key={b.href} href={b.href} className="flex flex-col items-center justify-center" aria-label="Add New Case">
                <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-pop ring-4 ring-white">
                  <Plus className="h-6 w-6" />
                </span>
              </Link>
            ) : (
              <Link key={b.href} href={b.href} className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold', active(b.href) ? 'text-ink' : 'text-ink-400')}>
                <b.icon className="h-5 w-5" />
                {b.label}
              </Link>
            ),
          )}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: string; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-medium text-ink-500 hover:text-ink">
            ← {back.label}
          </Link>
        )}
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink [text-wrap:balance]">{title}</h1>
        {sub && <div className="mt-1 text-sm text-ink-500">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
