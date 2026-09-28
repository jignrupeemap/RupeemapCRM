export { formatINR, formatINRCompact } from '@rupeemap/shared';

const dt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dtt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export const fmtDate = (d?: string | Date | null) => (d ? dt.format(new Date(d)) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? dtt.format(new Date(d)) : '—');

export function timeAgo(d: string | Date) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}

export function initials(name?: string) {
  return (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export const loanTypeName = (code: string) =>
  ({ HOME_LOAN: 'Home Loan', MORTGAGE_LOAN: 'Mortgage Loan', BUSINESS_LOAN: 'Business Loan', USED_CAR_LOAN: 'Used Car Loan', OTHER: 'Other' })[code] ?? code;
