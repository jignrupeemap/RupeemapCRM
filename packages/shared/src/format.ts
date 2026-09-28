const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** ₹12,34,567.50 — Indian digit grouping. */
export function formatINR(value: number | string | null | undefined, opts: { whole?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return (opts.whole ? inrWhole : inr).format(n);
}

/** ₹1.25 Cr, ₹45.5 L, ₹75,000 — compact form for KPI tiles. */
export function formatINRCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${trim(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${trim(n / 1e5)} L`;
  return inrWhole.format(n);
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Mask a mobile number for display in shared messages: 98XXXXXX21. */
export function maskMobile(m?: string | null): string {
  if (!m || m.length < 4) return m ?? '';
  return m.slice(0, 2) + 'X'.repeat(m.length - 4) + m.slice(-2);
}
