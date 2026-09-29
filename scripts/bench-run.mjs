// Phase 19: times the busiest screens against the benchmark server (port 4100).
// Usage: node scripts/bench-run.mjs [label]
const B = process.env.BENCH_URL ?? 'http://127.0.0.1:4100/api/v1';
const label = process.argv[2] ?? 'run';

async function login(mobile) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'mobile', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1` }, body: JSON.stringify({ login: mobile, password: 'Rupeemap@123' }) });
  const j = await r.json();
  if (!j.data?.token) throw new Error(`login ${mobile}: ${JSON.stringify(j)}`);
  return j.data.token;
}

async function time(token, path, runs = 5) {
  const ms = [];
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await fetch(B + path, { headers: { authorization: `Bearer ${token}` } });
    await r.arrayBuffer();
    status = r.status;
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { status, median: Math.round(ms[Math.floor(runs / 2)]), worst: Math.round(ms[runs - 1]) };
}

const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
const admin = await login('9000000001');
// A benchmark DSA with real volume: its user id is looked up via the users list.
const dsaRow = (await (await fetch(`${B}/users?role=DSA&q=Bench%20DSA%201&pageSize=1`, { headers: { authorization: `Bearer ${admin}` } })).json()).data[0];

const checks = [
  ['Admin dashboard (all time)', admin, '/dashboard/summary'],
  ['Admin dashboard (this month)', admin, `/dashboard/summary?from=${monthAgo}`],
  ['Partner-wise table', admin, '/dashboard/partners'],
  ['All Cases, page 1', admin, '/cases?pageSize=20'],
  ['All Cases, search name', admin, '/cases?q=Customer%2099&pageSize=20'],
  ['All Cases, stuck', admin, '/cases?stuck=1&pageSize=20'],
  ['All Cases, one DSA', admin, `/cases?dsaId=${dsaRow.id}&pageSize=20`],
  ['Payouts, page 1', admin, '/payouts?pageSize=20'],
  ['Payouts, one DSA', admin, `/payouts?dsaId=${dsaRow.id}&pageSize=20`],
  ['Users list (DSA)', admin, '/users?role=DSA&pageSize=20'],
  ['Report: cases (screen)', admin, `/reports/run/cases?from=${monthAgo}`],
  ['Report: DSA performance', admin, '/reports/run/dsa-performance'],
  ['Report: banks', admin, '/reports/run/banks'],
  ['Audit log', admin, '/audit?pageSize=50'],
];

console.log(`\n${label}: 100,000 cases`);
for (const [name, token, path] of checks) {
  const r = await time(token, path);
  console.log(`${name.padEnd(30)} ${String(r.median).padStart(6)} ms  (worst ${r.worst} ms)${r.status !== 200 ? `  HTTP ${r.status}` : ''}`);
}
