-- CreateEnum
CREATE TYPE "InsurancePayoutStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RECEIVED', 'HOLD');

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "product_name" TEXT,
    "policy_number" TEXT,
    "insurance_amount" DECIMAL(15,2) NOT NULL,
    "premium_amount" DECIMAL(15,2),
    "manager_name" TEXT,
    "manager_mobile" TEXT,
    "manager_email" TEXT,
    "remarks" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_payouts" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "InsurancePayoutStatus" NOT NULL DEFAULT 'PENDING',
    "received_on" TIMESTAMP(3),
    "reference" TEXT,
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_payout_history" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "prev_amount" DECIMAL(15,2),
    "new_amount" DECIMAL(15,2),
    "prev_status" "InsurancePayoutStatus",
    "new_status" "InsurancePayoutStatus",
    "reason" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_by_name" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_payout_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_policies_case_id_idx" ON "insurance_policies"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_payouts_policy_id_key" ON "insurance_payouts"("policy_id");

-- CreateIndex
CREATE INDEX "insurance_payouts_status_idx" ON "insurance_payouts"("status");

-- CreateIndex
CREATE INDEX "insurance_payout_history_payout_id_changed_at_idx" ON "insurance_payout_history"("payout_id", "changed_at");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_payouts" ADD CONSTRAINT "insurance_payouts_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_payout_history" ADD CONSTRAINT "insurance_payout_history_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "insurance_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Insurance payout history is append-only, like loan payout history.
CREATE TRIGGER insurance_payout_history_append_only BEFORE UPDATE OR DELETE ON insurance_payout_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
ALTER TABLE insurance_policies ADD CONSTRAINT insurance_amounts_non_negative CHECK (insurance_amount >= 0 AND (premium_amount IS NULL OR premium_amount >= 0));
ALTER TABLE insurance_payouts ADD CONSTRAINT insurance_payout_non_negative CHECK (amount >= 0);
