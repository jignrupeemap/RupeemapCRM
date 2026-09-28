-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DEACTIVATED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activated_at" TIMESTAMP(3),
ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivation_reason" TEXT,
ADD COLUMN     "inactivity_alerted_at" TIMESTAMP(3),
ADD COLUMN     "reactivated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "run_date" DATE NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name","run_date")
);


-- Existing activated accounts: count their inactivity from account creation.
UPDATE "users" SET "activated_at" = "created_at" WHERE "password_hash" IS NOT NULL AND "activated_at" IS NULL;
-- Latest payout per beneficiary is looked up by the inactivity report.
CREATE INDEX IF NOT EXISTS "payouts_beneficiary_created_idx" ON "payouts" ("beneficiary_user_id", "created_at" DESC);
