-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "document_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_document_id_key" ON "notifications"("document_id");

-- CreateIndex
CREATE INDEX "notifications_sent_by_created_at_idx" ON "notifications"("sent_by", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

