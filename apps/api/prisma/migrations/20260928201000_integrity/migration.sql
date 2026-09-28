-- History tables are append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION forbid_history_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER case_stage_history_append_only BEFORE UPDATE OR DELETE ON case_stage_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER payout_history_append_only BEFORE UPDATE OR DELETE ON payout_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER case_remarks_append_only BEFORE UPDATE OR DELETE ON case_remarks
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

-- Fast fuzzy search on customer names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);

-- Money can never be negative.
ALTER TABLE loan_cases ADD CONSTRAINT loan_cases_amounts_non_negative CHECK (
  applied_amount > 0
  AND (sanction_amount IS NULL OR sanction_amount > 0)
  AND (disbursed_total IS NULL OR disbursed_total > 0)
  AND (handover_amount IS NULL OR handover_amount > 0));
ALTER TABLE payouts ADD CONSTRAINT payouts_amount_non_negative CHECK (amount >= 0 AND percent_snapshot >= 0 AND percent_snapshot <= 100);
