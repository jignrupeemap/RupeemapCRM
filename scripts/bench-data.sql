-- Phase 19 benchmark data: run ONLY against the rupeemap_bench database, after migrate + seed.
-- 200 DSA Partners, 1,000 Team Partners, 100,000 cases over 2 years, payouts on handovers.
BEGIN;

INSERT INTO users (id, name, mobile, role, status, mobile_verified, created_at, updated_at)
SELECT gen_random_uuid(), 'Bench DSA ' || g, '71' || lpad(g::text, 8, '0'), 'DSA', 'ACTIVE', true, now(), now()
FROM generate_series(1, 200) g;

INSERT INTO dsa_partners (id, user_id, code, created_at)
SELECT gen_random_uuid(), u.id, 'BDSA-' || lpad(row_number() OVER (ORDER BY u.mobile)::text, 4, '0'), now()
FROM users u WHERE u.mobile LIKE '71%';

INSERT INTO users (id, name, mobile, role, status, mobile_verified, created_at, updated_at)
SELECT gen_random_uuid(), 'Bench TP ' || g, '72' || lpad(g::text, 8, '0'), 'TEAM_PARTNER', 'ACTIVE', true, now(), now()
FROM generate_series(1, 1000) g;

-- Each Team Partner belongs to one DSA (5 per DSA).
WITH d AS (SELECT id, row_number() OVER (ORDER BY code) AS n FROM dsa_partners WHERE code LIKE 'BDSA-%'),
     t AS (SELECT id, row_number() OVER (ORDER BY mobile) AS n FROM users WHERE mobile LIKE '72%')
INSERT INTO team_memberships (id, team_partner_user_id, dsa_id, started_on)
SELECT gen_random_uuid(), t.id, d.id, now() - interval '400 days' FROM t JOIN d ON d.n = ((t.n - 1) % 200) + 1;

INSERT INTO customers (id, name, mobile, created_at)
SELECT gen_random_uuid(), 'Bench Customer ' || g, '73' || lpad(g::text, 8, '0'), now() FROM generate_series(1, 100000) g;

CREATE TEMP TABLE bench_ids AS
SELECT row_number() OVER (ORDER BY c.mobile) AS n, c.id AS customer_id FROM customers c WHERE c.mobile LIKE '73%';

CREATE TEMP TABLE bench_people AS
SELECT row_number() OVER (ORDER BY m.team_partner_user_id) AS n, m.team_partner_user_id AS tp, d.user_id AS dsa
FROM team_memberships m JOIN dsa_partners d ON d.id = m.dsa_id WHERE d.code LIKE 'BDSA-%';

INSERT INTO loan_cases (id, case_no, customer_id, loan_type, applied_amount, bank_id, status, status_changed_at,
  sanction_amount, disbursed_total, handover_amount, dsa_id, team_partner_id, created_by, created_role, created_at, updated_at)
SELECT gen_random_uuid(), 'BENCH-' || lpad(b.n::text, 7, '0'), b.customer_id,
  (ARRAY['HOME_LOAN','LAP','BUSINESS_LOAN','PERSONAL_LOAN'])[1 + (b.n % 4)],
  500000 + (b.n % 90) * 50000,
  (SELECT id FROM banks ORDER BY name OFFSET (b.n % (SELECT count(*) FROM banks)) LIMIT 1),
  s.status::"CaseStatus",
  now() - ((b.n % 700) || ' days')::interval + interval '3 days',
  CASE WHEN s.status IN ('SANCTION','DISBURSED','HANDOVER') THEN 450000 + (b.n % 90) * 50000 END,
  CASE WHEN s.status IN ('DISBURSED','HANDOVER') THEN 450000 + (b.n % 90) * 50000 END,
  CASE WHEN s.status = 'HANDOVER' THEN 450000 + (b.n % 90) * 50000 END,
  p.dsa, CASE WHEN b.n % 4 = 0 THEN NULL ELSE p.tp END, p.dsa, 'DSA',
  now() - ((b.n % 700) || ' days')::interval, now()
FROM bench_ids b
JOIN bench_people p ON p.n = ((b.n - 1) % 1000) + 1
CROSS JOIN LATERAL (SELECT (ARRAY['LOGIN','LOGIN','SANCTION','DISBURSED','HANDOVER','HANDOVER','QUERY','REJECT','WITHDRAW'])[1 + (b.n % 9)] AS status) s;

-- Payouts: DSA share on every handover, Team Partner share where a TP sourced it.
INSERT INTO payouts (id, case_id, beneficiary_user_id, beneficiary_role, base_amount, percent_snapshot, amount, status, created_at, updated_at)
SELECT gen_random_uuid(), c.id, c.dsa_id, 'DSA', c.handover_amount, 0.3, round(c.handover_amount * 0.003, 2),
  (ARRAY['PENDING','CONFIRMED','PAID','HOLD'])[1 + (abs(hashtext(c.case_no)) % 4)]::"PayoutStatus", c.status_changed_at, now()
FROM loan_cases c WHERE c.case_no LIKE 'BENCH-%' AND c.status = 'HANDOVER';
INSERT INTO payouts (id, case_id, beneficiary_user_id, beneficiary_role, base_amount, percent_snapshot, amount, status, created_at, updated_at)
SELECT gen_random_uuid(), c.id, c.team_partner_id, 'TEAM_PARTNER', c.handover_amount, 0.5, round(c.handover_amount * 0.005, 2),
  (ARRAY['PENDING','CONFIRMED','PAID','HOLD'])[1 + (abs(hashtext(c.case_no)) % 4)]::"PayoutStatus", c.status_changed_at, now()
FROM loan_cases c WHERE c.case_no LIKE 'BENCH-%' AND c.status = 'HANDOVER' AND c.team_partner_id IS NOT NULL;

COMMIT;
ANALYZE;
SELECT (SELECT count(*) FROM loan_cases) AS cases, (SELECT count(*) FROM payouts) AS payouts, (SELECT count(*) FROM users) AS users;
