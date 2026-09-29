-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('PAN', 'AADHAAR', 'CANCELLED_CHEQUE', 'PHOTO', 'GST_CERTIFICATE');

-- AlterTable
ALTER TABLE "kyc_profiles" ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "kyc_profile_id" UUID NOT NULL,
    "type" "KycDocType" NOT NULL,
    "version" INTEGER NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "document_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "scan_status" TEXT NOT NULL DEFAULT 'UNSCANNED',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_document_id_key" ON "kyc_documents"("document_id");

-- CreateIndex
CREATE INDEX "kyc_documents_kyc_profile_id_type_current_idx" ON "kyc_documents"("kyc_profile_id", "type", "current");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_kyc_profile_id_type_version_key" ON "kyc_documents"("kyc_profile_id", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "document_access_logs_document_id_at_idx" ON "document_access_logs"("document_id", "at");

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_profile_id_fkey" FOREIGN KEY ("kyc_profile_id") REFERENCES "kyc_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Who opened which private document is kept permanently.
CREATE TRIGGER document_access_logs_append_only BEFORE UPDATE OR DELETE ON document_access_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
