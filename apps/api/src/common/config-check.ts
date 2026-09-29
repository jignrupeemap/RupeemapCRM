/**
 * Refuses to start in production with missing or placeholder secrets, so a
 * misconfigured server fails loudly instead of running insecurely.
 * Returns the problems found (empty when fine); main.ts exits on any.
 */
export function configProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const out: string[] = [];
  const placeholder = (v?: string) => !v || /^<.*>$|change.?me|example|^dev$/i.test(v);
  if (!/^[0-9a-f]{64}$/i.test(env.FILE_ENCRYPTION_KEY ?? '')) out.push('FILE_ENCRYPTION_KEY must be 64 hex characters');
  if (placeholder(env.OTP_PEPPER) || (env.OTP_PEPPER ?? '').length < 32) out.push('OTP_PEPPER must be a random value of at least 32 characters');
  if (!env.DATABASE_URL || /rupeemap_dev@|:postgres@/.test(env.DATABASE_URL)) out.push('DATABASE_URL must use a production database user and password');
  if (!env.REDIS_URL || env.REDIS_URL.startsWith('memory://')) out.push('REDIS_URL must point to a real Redis server');
  const origins = (env.WEB_ORIGIN ?? '').split(',').filter(Boolean);
  if (!origins.length || origins.some((o) => !o.startsWith('https://'))) out.push('WEB_ORIGIN must list only https:// addresses');
  if (!env.SMS_PROVIDER || env.SMS_PROVIDER === 'console') out.push('SMS_PROVIDER must be a real SMS gateway, not console');
  return out;
}
