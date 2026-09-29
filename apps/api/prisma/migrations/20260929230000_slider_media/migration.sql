-- AlterTable
ALTER TABLE "sliders" ADD COLUMN     "bank_id" UUID,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "document_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "sliders_document_id_key" ON "sliders"("document_id");

-- AddForeignKey
ALTER TABLE "sliders" ADD CONSTRAINT "sliders_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sliders" ADD CONSTRAINT "sliders_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

