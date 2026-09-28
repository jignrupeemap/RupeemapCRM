// Loads realistic demo cases through the public API (dev/staging only).
// Usage: node scripts/demo-cases.mjs [baseUrl]
const BASE = process.argv[2] ?? 'http://localhost:4000';
const PW = 'Rupeemap@123';

async function session(mobile) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: mobile, password: PW }) });
  if (!r.ok) throw new Error(`login ${mobile}: ${await r.text()}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', cookie, 'x-requested-with': 'rupeemap' }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    if (!j.success) throw new Error(`${method} ${path}: ${j.message}`);
    return j.data;
  };
}

const admin = await session('9000000001');
const exec = await session('9000000002');
const dsa = await session('9000000003');
const ravi = await session('9000000004');
const nisha = await session('9000000005');

const banks = await ravi('GET', '/banks');
const projects = (await ravi('GET', '/projects')) ;
const bank = (s) => banks.find((b) => b.shortName === s).id;
const proj = (n) => projects.find((p) => p.name.startsWith(n))?.id;

const people = [
  ['Bhavesh Modi', '9825011111', 'HOME_LOAN', 4500000, 'HDFC', 'Shivalik', ravi, 'HANDOVER'],
  ['Kajal Thakkar', '9825022222', 'HOME_LOAN', 6800000, 'ICICI', 'Goyal', ravi, 'DISBURSED'],
  ['Harsh Vyas', '9825033333', 'MORTGAGE_LOAN', 2500000, 'SBI', null, ravi, 'SANCTION'],
  ['Pooja Rathod', '9825044444', 'HOME_LOAN', 5200000, 'LICHFL', 'Raghuvir', nisha, 'HANDOVER'],
  ['Vikram Chauhan', '9825055555', 'BUSINESS_LOAN', 1500000, 'Kotak', null, nisha, 'QUERY'],
  ['Sneha Parikh', '9825066666', 'HOME_LOAN', 7500000, 'HDFC', 'Goyal', nisha, 'LOGIN'],
  ['Ramesh Solanki', '9825077777', 'USED_CAR_LOAN', 650000, 'Axis', null, dsa, 'REJECT'],
  ['Dhruv Shah', '9825088888', 'MORTGAGE_LOAN', 3200000, 'BoB', 'Titanium', dsa, 'DISBURSED'],
  ['Anjali Mehta', '9825099999', 'HOME_LOAN', 3900000, 'Bajaj', 'Shivalik', dsa, 'LOGIN'],
  ['Farhan Qureshi', '9825010101', 'BUSINESS_LOAN', 2200000, 'ABCL', null, ravi, 'WITHDRAW'],
  ['Meera Iyer', '9825012121', 'HOME_LOAN', 5600000, 'SBI', 'Shivalik', ravi, 'HANDOVER'],
  ['Jay Patel', '9825013131', 'HOME_LOAN', 4100000, 'ICICI', 'Raghuvir', nisha, 'SANCTION'],
];

let n = 0;
for (const [name, mobile, lt, amt, b, p, who, target] of people) {
  const c = await who('POST', '/cases', { customerName: name, customerMobile: mobile, loanType: lt, appliedAmount: amt, bankId: bank(b), projectId: p ? proj(p) : undefined, salesManagerName: 'Kunal Mehta' }).catch((e) => (console.log('skip', name, e.message), null));
  if (!c) continue;
  let v = 0;
  const step = async (action, data) => ((v = (await who('POST', `/cases/${c.id}/transitions`, { action, version: v, data })).version));
  const sanction = Math.round(amt * 0.92 / 1000) * 1000;
  if (target === 'REJECT') await step('REJECT', { reason: 'Low CIBIL score', remarks: 'CIBIL 612, below bank cut-off' });
  if (target === 'WITHDRAW') await step('WITHDRAW', { reason: 'Customer not interested', remarks: 'Customer postponed purchase to next year' });
  if (['SANCTION', 'DISBURSED', 'HANDOVER', 'QUERY'].includes(target)) await step('SANCTION', { sanctionAmount: sanction });
  if (target === 'QUERY') await step('RAISE_QUERY', { remarks: 'Bank needs last 2 years ITR and Form 26AS' });
  if (['DISBURSED', 'HANDOVER'].includes(target)) await step('DISBURSE', { disbursedAmount: sanction, disbursementType: 'FULL' });
  if (target === 'HANDOVER') await step('HANDOVER', { handoverAmount: sanction, otcPddCleared: true, loanAccountNo: `${b.toUpperCase()}${String(100000 + n * 7919).slice(0, 8)}`, salesManagerName: 'Kunal Mehta', salesManagerEmail: 'kunal.mehta@hdfcbank.example' });
  n++;
}

// Payout actions by the executive
const pays = await exec('GET', '/payouts?pageSize=50');
const first = pays.find((p) => p.status === 'PENDING');
if (first) await exec('PATCH', `/payouts/${first.id}/status`, { status: 'CONFIRMED', version: first.version, reason: 'Matched with bank MIS for September' });
const second = pays.find((p) => p.status === 'PENDING' && p.id !== first?.id);
if (second) await exec('PATCH', `/payouts/${second.id}/status`, { status: 'HOLD', version: second.version, reason: 'OTC pending with bank' });

await admin('POST', '/notifications', { audience: 'ALL', title: 'Diwali Disbursal Drive is live', body: 'Extra 0.10% payout on every Home Loan handover in October. Log your cases early.', priority: 'HIGH' });
console.log(`Created ${n} demo cases`);
