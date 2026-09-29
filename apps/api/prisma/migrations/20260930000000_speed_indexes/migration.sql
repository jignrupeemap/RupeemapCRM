-- Phase 19: sort indexes for the busiest lists (All Cases, Payout) and the stuck-cases rule.
CREATE INDEX "loan_cases_created_at_idx" ON "loan_cases"("created_at" DESC);
CREATE INDEX "loan_cases_status_status_changed_at_idx" ON "loan_cases"("status", "status_changed_at");
CREATE INDEX "payouts_created_at_idx" ON "payouts"("created_at" DESC);
