'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Briefcase, Building, Check, Home, Landmark, MoreHorizontal, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CUSTOMER_PROFILES, CUSTOMER_PROFILE_LABELS, CUSTOMER_PROFILE_SHORT, createCaseSchema, formatINR, type CustomerProfile } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Button, Card, cx, Field, Input, Select, Textarea } from '@/components/ui';

const DRAFT_KEY = 'rm:new-case-draft';
const STEPS = ['Customer', 'Loan', 'Bank & project', 'Review'] as const;
const LOAN_ICONS: Record<string, typeof Home> = { HOME_LOAN: Home, MORTGAGE_LOAN: Building, BUSINESS_LOAN: Briefcase, USED_CAR_LOAN: Car, OTHER: MoreHorizontal };

interface Form {
  customerName: string;
  customerMobile: string;
  customerPan: string;
  customerProfile: CustomerProfile | '';
  coApplicantName: string;
  loanType: string;
  appliedAmount: string;
  bankId: string;
  projectId: string;
  salesManagerId: string;
  salesManagerName: string;
  remarks: string;
  dsaId: string;
  teamPartnerId: string;
}
const EMPTY: Form = { customerName: '', customerMobile: '', customerPan: '', customerProfile: '', coApplicantName: '', loanType: '', appliedAmount: '', bankId: '', projectId: '', salesManagerId: '', salesManagerName: '', remarks: '', dsaId: '', teamPartnerId: '' };

type Dup = { visible: boolean; id?: string; caseNo?: string; customerName?: string; bank: string; status: string; createdAt: string };

function readDraft(): Form {
  try {
    const d = localStorage.getItem(DRAFT_KEY);
    return d ? { ...EMPTY, ...JSON.parse(d) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Spoken-style amount for Indian users: 45,00,000 → "45 lakh". */
function amountInWords(v: string) {
  const n = Number(v);
  if (!n) return '';
  if (n >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} lakh`;
  return `${n.toLocaleString('en-IN')} rupees`;
}

export default function NewCasePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<Dup[]>([]);
  const [ackDup, setAckDup] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const d = readDraft();
    if (JSON.stringify(d) !== JSON.stringify(EMPTY)) {
      setF(d);
      setHasDraft(true);
    }
  }, []);
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    } catch {}
  }, [f, dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (k: keyof Form, v: string) => {
    setF((p) => ({ ...p, [k]: v, ...(k === 'bankId' ? { salesManagerId: '' } : {}), ...(k === 'dsaId' ? { teamPartnerId: '' } : {}) }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 3600_000 });
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string; isNbfc: boolean }[]>('/banks'), staleTime: 3600_000 });
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.page<{ id: string; name: string; city: string; locality: string }>('/projects', { pageSize: 100 }), staleTime: 300_000 });
  const bankers = useQuery({
    queryKey: ['bankers', f.bankId],
    queryFn: () => api.get<{ id: string; name: string; designation: { name: string } | null; branch: string | null }[]>('/bankers', { bankId: f.bankId }),
    enabled: !!f.bankId,
  });
  const isStaff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const dsas = useQuery({ queryKey: ['dsa-list'], queryFn: () => api.page<{ id: string; name: string; dsaCode: string }>('/users', { role: 'DSA', status: 'ACTIVE', pageSize: 100 }), enabled: isStaff });
  const teamOwner = isStaff ? f.dsaId : me?.role === 'DSA' ? me.id : '';
  const team = useQuery({
    queryKey: ['team-of', teamOwner],
    queryFn: () => api.page<{ id: string; name: string }>('/users', { role: 'TEAM_PARTNER', dsaId: teamOwner, status: 'ACTIVE', pageSize: 100 }),
    enabled: !!teamOwner && (isStaff || me?.role === 'DSA'),
  });

  const payload = useMemo(
    () => ({
      ...f,
      appliedAmount: f.appliedAmount,
      dsaId: f.dsaId || undefined,
      teamPartnerId: f.teamPartnerId || undefined,
      salesManagerName: f.salesManagerName || undefined,
      coApplicantName: f.coApplicantName || undefined,
      customerProfile: f.customerProfile || undefined,
      remarks: f.remarks || undefined,
    }),
    [f],
  );

  const stepFields: (keyof Form)[][] = [
    ['customerName', 'customerMobile', 'customerPan', 'coApplicantName'],
    ['loanType', 'appliedAmount'],
    ['bankId', 'projectId', 'salesManagerId', 'salesManagerName'],
    ['dsaId', 'teamPartnerId', 'remarks'],
  ];

  const validateStep = (i: number) => {
    const r = createCaseSchema.safeParse(payload);
    const errs: Record<string, string> = {};
    if (!r.success) for (const iss of r.error.issues) if (stepFields[i].includes(iss.path[0] as keyof Form) && !errs[iss.path[0] as string]) errs[iss.path[0] as string] = iss.message;
    if (i === 3 && isStaff && !f.dsaId) errs.dsaId = 'Choose the DSA for this case';
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const checkDup = async () => {
    if (!f.customerMobile && !f.customerPan) return setDups([]);
    try {
      const r = await api.post<Dup[]>('/cases/check-duplicate', { customerMobile: f.customerMobile || undefined, customerPan: f.customerPan || undefined, customerName: f.customerName });
      setDups(r);
      setAckDup(false);
    } catch {
      /* validation errors show on Next */
    }
  };

  const next = async () => {
    if (!validateStep(step)) return;
    if (step === 0) await checkDup();
    setStep((s) => Math.min(3, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = useMutation({
    mutationFn: () => api.post<{ id: string; caseNo: string }>('/cases', { ...payload, acknowledgeDuplicate: ackDup || undefined }),
    onSuccess: (r) => {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      setF(EMPTY);
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Case ${r.caseNo} created in Login`);
      router.push(`/cases/${r.id}`);
    },
    onError: (e: ApiError) => {
      if (e.code === 'DUPLICATE_SUSPECTED') {
        setDups(e.details?.duplicates ?? []);
        setStep(3);
        return;
      }
      setErrors(e.fields);
      toast.error(e.message);
      const s = stepFields.findIndex((fs) => fs.some((k) => e.fields[k]));
      if (s >= 0) setStep(s);
    },
  });

  const bank = banks.data?.find((b) => b.id === f.bankId);
  const project = projects.data?.data.find((p) => p.id === f.projectId);
  const sm = bankers.data?.find((b) => b.id === f.salesManagerId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add New Case" sub="The case starts in Login and moves to All Cases when you submit." back={{ href: '/cases', label: 'All Cases' }} />

      {hasDraft && step === 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <span>We restored your unsaved draft.</span>
          <button
            className="font-semibold underline"
            onClick={() => {
              setF(EMPTY);
              setHasDraft(false);
              try {
                localStorage.removeItem(DRAFT_KEY);
              } catch {}
            }}
          >
            Start fresh
          </button>
        </div>
      )}

      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step} className="w-full text-left" aria-current={i === step ? 'step' : undefined}>
              <span className={cx('block h-1.5 rounded-full', i <= step ? 'bg-ink' : 'bg-ink-200')} />
              <span className={cx('mt-1.5 hidden text-xs font-semibold sm:block', i === step ? 'text-ink' : 'text-ink-400')}>
                {i + 1}. {s}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mb-3 text-sm font-semibold sm:hidden">
        Step {step + 1} of 4 · {STEPS[step]}
      </p>

      <Card className="p-5 sm:p-6">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Customer name" required htmlFor="cn" error={errors.customerName}>
                <Input id="cn" autoFocus autoComplete="off" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} aria-invalid={!!errors.customerName} />
              </Field>
            </div>
            <Field label="Mobile number" htmlFor="cm" hint="Optional. Used to spot duplicate cases." error={errors.customerMobile}>
              <Input id="cm" inputMode="numeric" prefix="+91" value={f.customerMobile} onChange={(e) => set('customerMobile', e.target.value)} aria-invalid={!!errors.customerMobile} />
            </Field>
            <Field label="PAN" htmlFor="pan" hint="Optional" error={errors.customerPan}>
              <Input id="pan" className="uppercase" maxLength={10} value={f.customerPan} onChange={(e) => set('customerPan', e.target.value.toUpperCase())} aria-invalid={!!errors.customerPan} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Customer profile" htmlFor="cpf" hint="Decides the document checklist for this case. You can change it later.">
                <div id="cpf" role="radiogroup" aria-label="Customer profile" className="flex flex-wrap gap-2">
                  {CUSTOMER_PROFILES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      role="radio"
                      aria-checked={f.customerProfile === x}
                      title={CUSTOMER_PROFILE_LABELS[x]}
                      onClick={() => set('customerProfile', f.customerProfile === x ? '' : x)}
                      className={cx(
                        'rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition',
                        f.customerProfile === x ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
                      )}
                    >
                      {CUSTOMER_PROFILE_SHORT[x]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Co-applicant name" htmlFor="co" hint="Optional">
                <Input id="co" value={f.coApplicantName} onChange={(e) => set('coApplicantName', e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-700">
                Loan type <span className="text-brand-red">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {loanTypes.data?.map((l) => {
                  const Icon = LOAN_ICONS[l.code] ?? MoreHorizontal;
                  const on = f.loanType === l.code;
                  return (
                    <button
                      type="button"
                      key={l.code}
                      onClick={() => set('loanType', l.code)}
                      aria-pressed={on}
                      className={cx('flex flex-col items-center gap-2 rounded-2xl border p-3 text-sm font-semibold transition', on ? 'border-teal-700 bg-teal-700 text-white' : 'border-ink-200 hover:border-ink-400')}
                    >
                      <Icon className="h-5 w-5" />
                      {l.name}
                    </button>
                  );
                })}
              </div>
              {errors.loanType && <p className="mt-1.5 text-xs font-medium text-brand-red">{errors.loanType}</p>}
            </fieldset>
            <Field label="Applied loan amount" required htmlFor="amt" error={errors.appliedAmount} hint={amountInWords(f.appliedAmount)}>
              <Input id="amt" inputMode="decimal" prefix="₹" value={f.appliedAmount} onChange={(e) => set('appliedAmount', e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!errors.appliedAmount} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank / NBFC" required htmlFor="bank" error={errors.bankId}>
              <Select id="bank" value={f.bankId} onChange={(e) => set('bankId', e.target.value)} aria-invalid={!!errors.bankId}>
                <option value="">Choose bank</option>
                <optgroup label="Banks">{banks.data?.filter((b) => !b.isNbfc).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                <optgroup label="NBFC / HFC">{banks.data?.filter((b) => b.isNbfc).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="Project" htmlFor="proj" hint="Optional. From Project Master only." error={errors.projectId}>
              <Select id="proj" value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
                <option value="">No project / resale</option>
                {projects.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.locality ? `${p.locality}, ` : ''}
                    {p.city}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sales manager" htmlFor="sm" hint={f.bankId ? 'Optional. Pick from Banker Directory or type a name.' : 'Choose a bank first'}>
              <Select id="sm" value={f.salesManagerId} disabled={!f.bankId} onChange={(e) => set('salesManagerId', e.target.value)}>
                <option value="">Not listed / type below</option>
                {bankers.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.designation ? ` · ${b.designation.name}` : ''}
                    {b.branch ? ` · ${b.branch}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {!f.salesManagerId && (
              <Field label="Sales manager name" htmlFor="smn" hint="Optional">
                <Input id="smn" value={f.salesManagerName} onChange={(e) => set('salesManagerName', e.target.value)} />
              </Field>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            {dups.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-brand-goldsoft p-4 text-amber-900" role="alert">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="h-5 w-5" /> A case for this customer may already exist
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {dups.map((d, i) => (
                    <li key={i}>
                      {d.visible ? (
                        <Link href={`/cases/${d.id}`} className="font-semibold underline" target="_blank">
                          {d.caseNo} · {d.customerName}
                        </Link>
                      ) : (
                        <span className="font-semibold">A case outside your team</span>
                      )}{' '}
                      · {d.bank} · {d.status} · {fmtDate(d.createdAt)}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />
                  This is a different application (for example another bank or a top-up). Create it anyway.
                </label>
              </div>
            )}

            {isStaff && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="DSA" required htmlFor="dsa" error={errors.dsaId}>
                  <Select id="dsa" value={f.dsaId} onChange={(e) => set('dsaId', e.target.value)}>
                    <option value="">Choose DSA</option>
                    {dsas.data?.data.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.dsaCode}</option>)}
                  </Select>
                </Field>
                <Field label="Team Partner" htmlFor="tpn" hint="Optional">
                  <Select id="tpn" value={f.teamPartnerId} disabled={!f.dsaId} onChange={(e) => set('teamPartnerId', e.target.value)}>
                    <option value="">DSA's own case</option>
                    {team.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
              </div>
            )}
            {me?.role === 'DSA' && !!team.data?.data.length && (
              <Field label="Case sourced by" htmlFor="tpd" hint="Choose a Team Partner if they brought this customer">
                <Select id="tpd" value={f.teamPartnerId} onChange={(e) => set('teamPartnerId', e.target.value)}>
                  <option value="">Me ({me.name})</option>
                  {team.data.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            )}

            <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-ink-50 p-4 text-sm sm:grid-cols-2">
              {[
                ['Customer', f.customerName],
                ['Mobile', f.customerMobile || '—'],
                ['Loan type', loanTypes.data?.find((l) => l.code === f.loanType)?.name],
                ['Applied amount', f.appliedAmount ? formatINR(f.appliedAmount) : '—'],
                ['Bank', bank?.name],
                ['Project', project?.name ?? '—'],
                ['Sales manager', sm?.name ?? (f.salesManagerName || '—')],
                ['Customer profile', f.customerProfile ? CUSTOMER_PROFILE_SHORT[f.customerProfile] : '—'],
                ['Co-applicant', f.coApplicantName || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 sm:block">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="text-right font-semibold sm:text-left">{v}</dd>
                </div>
              ))}
            </dl>
            <Field label="Remarks" htmlFor="rm" hint="Optional. Visible on the case timeline.">
              <Textarea id="rm" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
            </Field>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-ink-100 pt-5 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => (step ? setStep(step - 1) : router.push('/cases'))}>
            {step ? 'Back' : 'Cancel'}
          </Button>
          {step < 3 ? (
            <Button onClick={next} size="lg">
              Continue
            </Button>
          ) : (
            <Button
              size="lg"
              variant="teal"
              icon={<Check className="h-4 w-4" />}
              loading={submit.isPending}
              disabled={dups.length > 0 && !ackDup}
              onClick={() => validateStep(3) && submit.mutate()}
            >
              Submit case in Login
            </Button>
          )}
        </div>
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
        <Landmark className="h-3.5 w-3.5" /> Drafts are kept on this device until you submit.
      </p>
    </div>
  );
}
