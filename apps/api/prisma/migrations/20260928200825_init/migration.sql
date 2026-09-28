-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EXECUTIVE', 'DSA', 'TEAM_PARTNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'BLOCKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('LOGIN', 'SANCTION', 'DISBURSED', 'HANDOVER', 'QUERY', 'REJECT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "DisbursementType" AS ENUM ('PART', 'PART_TO_FULL', 'FULL');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID', 'HOLD');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('DOCUMENTS_PENDING', 'UPLOADED', 'UNDER_ADMIN_VERIFICATION', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL');

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('SQFT', 'SQYD', 'SBA', 'CARPET');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('ACTIVATE', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "password_hash" TEXT,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "mobile_verified" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_verifications" (
    "id" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "set_by" UUID NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "dsa_partners" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "firm_name" TEXT,
    "gst_applicable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dsa_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "team_partner_user_id" UUID NOT NULL,
    "dsa_id" UUID NOT NULL,
    "started_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_on" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_rates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bank_id" UUID,
    "loan_type" TEXT,
    "percent" DECIMAL(6,3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "set_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'DOCUMENTS_PENDING',
    "gst_applicable" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "loan_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "is_nbfc" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banker_designations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "banker_designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banker_contacts" (
    "id" UUID NOT NULL,
    "bank_id" UUID NOT NULL,
    "designation_id" UUID,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "branch" TEXT,
    "city" TEXT,
    "region" TEXT,
    "product" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "banker_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "locality" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "rera_number" TEXT,
    "project_type" "ProjectType" NOT NULL,
    "unit_types" TEXT[],
    "price_min" DECIMAL(15,2),
    "price_max" DECIMAL(15,2),
    "measurement_unit" "MeasurementUnit",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "pan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_counters" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "case_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "loan_cases" (
    "id" UUID NOT NULL,
    "case_no" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "co_applicant_name" TEXT,
    "loan_type" TEXT NOT NULL,
    "applied_amount" DECIMAL(15,2) NOT NULL,
    "bank_id" UUID NOT NULL,
    "project_id" UUID,
    "sales_manager_id" UUID,
    "sales_manager_name" TEXT,
    "sales_manager_email" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'LOGIN',
    "status_before_query" "CaseStatus",
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sanction_amount" DECIMAL(15,2),
    "sanction_date" TIMESTAMP(3),
    "disbursed_total" DECIMAL(15,2),
    "disbursement_type" "DisbursementType",
    "disbursed_date" TIMESTAMP(3),
    "handover_amount" DECIMAL(15,2),
    "otc_pdd_cleared" BOOLEAN,
    "loan_account_no" TEXT,
    "handover_date" TIMESTAMP(3),
    "dsa_id" UUID NOT NULL,
    "team_partner_id" UUID,
    "assigned_executive_id" UUID,
    "created_by" UUID NOT NULL,
    "created_role" "Role" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "loan_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_stage_history" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "CaseStatus",
    "to_status" "CaseStatus" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "remarks" TEXT,
    "changed_by" UUID NOT NULL,
    "changed_by_name" TEXT NOT NULL,
    "changed_role" "Role" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_disbursements" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" "DisbursementType" NOT NULL,
    "disbursed_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_by" UUID NOT NULL,

    CONSTRAINT "case_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_remarks" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "beneficiary_user_id" UUID NOT NULL,
    "beneficiary_role" "Role" NOT NULL,
    "base_amount" DECIMAL(15,2) NOT NULL,
    "percent_snapshot" DECIMAL(6,3) NOT NULL,
    "rate_id" UUID,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "received_from_bank" BOOLEAN NOT NULL DEFAULT false,
    "bank_received_amount" DECIMAL(15,2),
    "bank_received_on" TIMESTAMP(3),
    "paid_on" TIMESTAMP(3),
    "payment_ref" TEXT,
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_history" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "prev_amount" DECIMAL(15,2),
    "new_amount" DECIMAL(15,2),
    "prev_status" "PayoutStatus",
    "new_status" "PayoutStatus",
    "prev_percent" DECIMAL(6,3),
    "new_percent" DECIMAL(6,3),
    "reason" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_by_name" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "audience" TEXT NOT NULL,
    "case_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "sent_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "sliders" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "media_type" TEXT NOT NULL DEFAULT 'IMAGE',
    "media_url" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'emerald',
    "cta_label" TEXT,
    "cta_url" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sliders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "otp_verifications_mobile_purpose_created_at_idx" ON "otp_verifications"("mobile", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "password_history_user_id_created_at_idx" ON "password_history"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dsa_partners_user_id_key" ON "dsa_partners"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dsa_partners_code_key" ON "dsa_partners"("code");

-- CreateIndex
CREATE INDEX "team_memberships_dsa_id_ended_on_idx" ON "team_memberships"("dsa_id", "ended_on");

-- CreateIndex
CREATE INDEX "team_memberships_team_partner_user_id_ended_on_idx" ON "team_memberships"("team_partner_user_id", "ended_on");

-- CreateIndex
CREATE INDEX "payout_rates_user_id_effective_from_idx" ON "payout_rates"("user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_user_id_key" ON "kyc_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key" ON "banks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "banker_designations_name_key" ON "banker_designations"("name");

-- CreateIndex
CREATE INDEX "banker_contacts_bank_id_idx" ON "banker_contacts"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_normalized_key" ON "projects"("name_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "projects_rera_number_key" ON "projects"("rera_number");

-- CreateIndex
CREATE INDEX "projects_city_idx" ON "projects"("city");

-- CreateIndex
CREATE INDEX "customers_mobile_idx" ON "customers"("mobile");

-- CreateIndex
CREATE INDEX "customers_pan_idx" ON "customers"("pan");

-- CreateIndex
CREATE UNIQUE INDEX "loan_cases_case_no_key" ON "loan_cases"("case_no");

-- CreateIndex
CREATE INDEX "loan_cases_dsa_id_created_at_idx" ON "loan_cases"("dsa_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "loan_cases_team_partner_id_created_at_idx" ON "loan_cases"("team_partner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "loan_cases_status_created_at_idx" ON "loan_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "loan_cases_bank_id_idx" ON "loan_cases"("bank_id");

-- CreateIndex
CREATE INDEX "loan_cases_project_id_idx" ON "loan_cases"("project_id");

-- CreateIndex
CREATE INDEX "loan_cases_loan_account_no_idx" ON "loan_cases"("loan_account_no");

-- CreateIndex
CREATE INDEX "case_stage_history_case_id_changed_at_idx" ON "case_stage_history"("case_id", "changed_at");

-- CreateIndex
CREATE INDEX "case_disbursements_case_id_idx" ON "case_disbursements"("case_id");

-- CreateIndex
CREATE INDEX "case_remarks_case_id_created_at_idx" ON "case_remarks"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_beneficiary_user_id_status_idx" ON "payouts"("beneficiary_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_case_id_beneficiary_user_id_key" ON "payouts"("case_id", "beneficiary_user_id");

-- CreateIndex
CREATE INDEX "payout_history_payout_id_changed_at_idx" ON "payout_history"("payout_id", "changed_at");

-- CreateIndex
CREATE INDEX "notification_recipients_user_id_read_at_idx" ON "notification_recipients"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "sliders_active_sort_order_idx" ON "sliders"("active", "sort_order");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_at_idx" ON "audit_logs"("actor_id", "at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsa_partners" ADD CONSTRAINT "dsa_partners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_partner_user_id_fkey" FOREIGN KEY ("team_partner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_dsa_id_fkey" FOREIGN KEY ("dsa_id") REFERENCES "dsa_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_rates" ADD CONSTRAINT "payout_rates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banker_contacts" ADD CONSTRAINT "banker_contacts_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banker_contacts" ADD CONSTRAINT "banker_contacts_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "banker_designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_cases" ADD CONSTRAINT "loan_cases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_cases" ADD CONSTRAINT "loan_cases_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_cases" ADD CONSTRAINT "loan_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_cases" ADD CONSTRAINT "loan_cases_sales_manager_id_fkey" FOREIGN KEY ("sales_manager_id") REFERENCES "banker_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_history" ADD CONSTRAINT "case_stage_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_disbursements" ADD CONSTRAINT "case_disbursements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_remarks" ADD CONSTRAINT "case_remarks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
