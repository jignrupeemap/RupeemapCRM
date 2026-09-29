'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { loginSchema, mobileSchema, passwordSchema } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

type Mode = 'login' | 'activate' | 'reset';

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const [mode, setMode] = useState<Mode>('login');
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="rounded-2xl bg-white p-3 self-start">
          <Image src="/rupeemap-logo.jpg" alt="Rupeemap" width={170} height={102} priority />
        </div>
        <div className="max-w-md">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-400">Loan DSA CRM</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight [text-wrap:balance]">Every case from Login to Handover, and every rupee of payout, in one place.</h1>
          <ul className="mt-8 space-y-3 text-ink-300">
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-teal-400" />Track Login, Sanction, Disbursed and Handover for your whole team</li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-gold" />Payout created automatically on Handover</li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-red" />Project Master, bankers and bank codes at hand</li>
          </ul>
        </div>
        <svg className="absolute -bottom-6 right-0 h-64 w-[420px] opacity-90" viewBox="0 0 420 260" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={40 + i * 50} y={200 - i * 26} width="28" height={60 + i * 26} rx="4" fill="#d9463b" opacity={0.25 + i * 0.1} />
          ))}
          <polyline points="30,190 90,150 140,168 200,110 250,124 310,60 380,20" fill="none" stroke="#3fa89a" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="352,18 382,18 382,48" fill="none" stroke="#3fa89a" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </section>

      <section className="flex items-center justify-center px-4 py-10 pt-[calc(40px+env(safe-area-inset-top))]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Image src="/rupeemap-logo.jpg" alt="Rupeemap" width={150} height={90} priority />
          </div>
          {mode === 'login' ? <LoginForm onMode={setMode} /> : <OtpFlow mode={mode} onMode={setMode} />}
        </div>
      </section>
    </div>
  );
}

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { login: '', password: '' } });
  const [err, setErr] = useState<string | null>(null);

  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      await api.post('/auth/login', v);
      await qc.invalidateQueries();
      const next = params.get('next');
      // Only same-site paths: "//evil" and "/\evil" would leave the CRM.
      router.replace(next && /^\/(?![/\\])/.test(next) ? next : '/');
    } catch (e) {
      setErr((e as ApiError).message);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h2 className="font-display text-2xl font-extrabold">Sign in</h2>
        <p className="mt-1 text-sm text-ink-500">Use your registered mobile number or username.</p>
      </div>
      {!err && params.get('expired') && (
        <p className="rounded-xl bg-brand-goldsoft px-3 py-2.5 text-sm font-medium text-amber-900" role="status">
          You were signed out after a period of no activity. Please sign in again.
        </p>
      )}
      {err && <p className="rounded-xl bg-brand-redsoft px-3 py-2.5 text-sm font-medium text-red-800" role="alert">{err}</p>}
      <Field label="Mobile number or username" htmlFor="login" error={form.formState.errors.login?.message}>
        <Input id="login" autoComplete="username" inputMode="text" placeholder="98XXXXXXXX" {...form.register('login')} aria-invalid={!!form.formState.errors.login} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} aria-invalid={!!form.formState.errors.password} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={() => onMode('reset')}>
          Forgot password?
        </button>
        <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={() => onMode('activate')}>
          Activate account
        </button>
      </div>
      <p className="border-t border-ink-200 pt-4 text-xs text-ink-500">
        Accounts are created by Rupeemap or your DSA. New users receive an SMS, then activate with an OTP.
      </p>
    </form>
  );
}

/** Activate a new account or reset a password: mobile → OTP → new password. */
function OtpFlow({ mode, onMode }: { mode: 'activate' | 'reset'; onMode: (m: Mode) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<'mobile' | 'otp' | 'password'>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const purpose = mode === 'activate' ? 'ACTIVATE' : 'RESET_PASSWORD';

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = () =>
    run(async () => {
      const m = mobileSchema.safeParse(mobile);
      if (!m.success) throw new ApiError('VALIDATION_ERROR', m.error.issues[0].message, 400);
      setMobile(m.data);
      const r = await api.post<{ cooldownSeconds: number }>('/auth/otp/request', { mobile: m.data, purpose });
      setCooldown(r.cooldownSeconds);
      setStep('otp');
      // Development preview only: the console SMS provider exposes the last OTP.
      api.get<{ otp?: string } | null>(`/auth/dev/last-sms/${m.data}`).then((s) => setDevOtp(s?.otp ?? null)).catch(() => setDevOtp(null));
      toast.success('If this number is registered, an OTP has been sent by SMS');
    });

  const verify = () =>
    run(async () => {
      const r = await api.post<{ token: string; name: string }>('/auth/otp/verify', { mobile, purpose, otp });
      setToken(r.token);
      setStep('password');
      toast.success(`Mobile verified. Welcome, ${r.name.split(' ')[0]}`);
    });

  const setPw = () =>
    run(async () => {
      const p = passwordSchema.safeParse(password);
      if (!p.success) throw new ApiError('VALIDATION_ERROR', p.error.issues[0].message, 400);
      if (password !== confirm) throw new ApiError('VALIDATION_ERROR', 'Passwords do not match', 400);
      await api.post('/auth/password/set', { token, password });
      await qc.invalidateQueries();
      toast.success(mode === 'activate' ? 'Account activated' : 'Password updated');
      router.replace('/');
    });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-extrabold">{mode === 'activate' ? 'Activate your account' : 'Reset password'}</h2>
        <ol className="mt-3 flex gap-2 text-xs font-semibold" aria-label="Steps">
          {['Mobile', 'OTP', 'Password'].map((s, i) => {
            const idx = ['mobile', 'otp', 'password'].indexOf(step);
            return (
              <li key={s} className={`flex-1 rounded-full py-1 text-center ${i <= idx ? 'bg-ink text-white' : 'bg-ink-100 text-ink-500'}`} aria-current={i === idx ? 'step' : undefined}>
                {s}
              </li>
            );
          })}
        </ol>
      </div>
      {err && <p className="rounded-xl bg-brand-redsoft px-3 py-2.5 text-sm font-medium text-red-800" role="alert">{err}</p>}

      {step === 'mobile' && (
        <form onSubmit={(e) => (e.preventDefault(), requestOtp())} className="space-y-5">
          <Field label="Registered mobile number" htmlFor="m">
            <Input id="m" inputMode="numeric" autoComplete="tel-national" prefix="+91" placeholder="98XXXXXXXX" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Button size="lg" className="w-full" loading={busy} type="submit">
            Send OTP
          </Button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={(e) => (e.preventDefault(), verify())} className="space-y-5">
          <Field label={`6-digit OTP sent to +91 ${mobile}`} htmlFor="otp" hint="Valid for 5 minutes. Never share your OTP.">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-display text-2xl tracking-[0.5em]" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          </Field>
          {devOtp && (
            <p className="rounded-xl border border-dashed border-teal-400 bg-teal-50 px-3 py-2 text-xs text-teal-900">
              Preview mode, no real SMS sent. OTP: <b className="tabular-nums">{devOtp}</b>
            </p>
          )}
          <Button size="lg" className="w-full" loading={busy} type="submit" disabled={otp.length !== 6}>
            Verify OTP
          </Button>
          <button type="button" disabled={cooldown > 0 || busy} onClick={requestOtp} className="w-full text-sm font-semibold text-teal-700 disabled:text-ink-400">
            {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => (e.preventDefault(), setPw())} className="space-y-5">
          <Field label="New password" htmlFor="pw" hint="At least 8 characters with a letter and a number">
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password" htmlFor="pw2">
            <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button size="lg" className="w-full" loading={busy} type="submit">
            {mode === 'activate' ? 'Activate and sign in' : 'Save password and sign in'}
          </Button>
        </form>
      )}

      <button type="button" className="text-sm font-semibold text-ink-500 hover:text-ink" onClick={() => onMode('login')}>
        ← Back to sign in
      </button>
    </div>
  );
}
