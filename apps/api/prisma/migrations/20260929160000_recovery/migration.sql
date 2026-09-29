-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('RECOVERY_PENDING', 'BANK_RECOVERY_RECEIVED', 'DEMAND_RAISED', 'PARTIALLY_RECOVERED', 'FULLY_RECOVERED', 'DISPUTED', 'WAIVED', 'CLOSED');

-- CreateTable
CREATE TABLE "recoveries" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "beneficiary_user_id" UUID NOT NULL,
    "recovery_amount" DECIMAL(15,2) NOT NULL,
    "amount_demanded" DECIMAL(15,2),
    "amount_received" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'RECOVERY_PENDING',
    "recovery_date" DATE NOT NULL,
    "due_date" DATE,
    "bank_remarks" TEXT,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_receipts" (
    "id" UUID NOT NULL,
    "recovery_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" TEXT,
    "entered_by" UUID NOT NULL,
    "entered_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_history" (
    "id" UUID NOT NULL,
    "recovery_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "prev_status" "RecoveryStatus",
    "new_status" "RecoveryStatus" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_by_name" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recoveries_status_due_date_idx" ON "recoveries"("status", "due_date");

-- CreateIndex
CREATE INDEX "recoveries_beneficiary_user_id_status_idx" ON "recoveries"("beneficiary_user_id", "status");

-- CreateIndex
CREATE INDEX "recoveries_case_id_idx" ON "recoveries"("case_id");

-- CreateIndex
CREATE INDEX "recovery_receipts_recovery_id_idx" ON "recovery_receipts"("recovery_id");

-- CreateIndex
CREATE INDEX "recovery_history_recovery_id_changed_at_idx" ON "recovery_history"("recovery_id", "changed_at");

-- AddForeignKey
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_receipts" ADD CONSTRAINT "recovery_receipts_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_history" ADD CONSTRAINT "recovery_history_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Receipts and history are the audit trail of money recovered: append-only.
CREATE TRIGGER recovery_history_append_only BEFORE UPDATE OR DELETE ON recovery_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER recovery_receipts_append_only BEFORE UPDATE OR DELETE ON recovery_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
ALTER TABLE recoveries ADD CONSTRAINT recovery_amounts_valid CHECK (recovery_amount > 0 AND (amount_demanded IS NULL OR amount_demanded >= 0) AND amount_received >= 0 AND (amount_demanded IS NULL OR amount_received <= amount_demanded));
ALTER TABLE recovery_receipts ADD CONSTRAINT recovery_receipt_positive CHECK (amount > 0);
