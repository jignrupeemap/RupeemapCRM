-- Partner office and residence address (filled at registration, or later by Admin / Admin Executive).
ALTER TABLE "users" ADD COLUMN "office_address" TEXT;
ALTER TABLE "users" ADD COLUMN "residence_address" TEXT;
