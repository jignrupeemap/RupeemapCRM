-- Banker confirmation attachments on payouts (staff only; Admin-only soft delete).
CREATE TABLE "payout_attachments" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "note" TEXT,
    "uploaded_by" UUID NOT NULL,
    "uploaded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    CONSTRAINT "payout_attachments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payout_attachments_document_id_key" ON "payout_attachments"("document_id");
CREATE INDEX "payout_attachments_payout_id_idx" ON "payout_attachments"("payout_id");
ALTER TABLE "payout_attachments" ADD CONSTRAINT "payout_attachments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_attachments" ADD CONSTRAINT "payout_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
