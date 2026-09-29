-- AlterTable
ALTER TABLE "banker_contacts" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "visible_to_partners" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "bank_codes" (
    "id" UUID NOT NULL,
    "bank_id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "branch" TEXT,
    "effective_from" DATE,
    "expires_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "visible_to_partners" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bank_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_codes_bank_id_product_idx" ON "bank_codes"("bank_id", "product");

-- CreateIndex
CREATE INDEX "bank_codes_code_idx" ON "bank_codes"("code");

-- AddForeignKey
ALTER TABLE "bank_codes" ADD CONSTRAINT "bank_codes_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The same code cannot be listed twice for one bank and product while active.
CREATE UNIQUE INDEX bank_codes_unique_active ON bank_codes (bank_id, lower(product), lower(code)) WHERE deleted_at IS NULL;
