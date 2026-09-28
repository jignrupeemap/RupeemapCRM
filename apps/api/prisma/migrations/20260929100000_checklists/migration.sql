-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'RECEIVED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bank_id" UUID,
    "loan_type" TEXT,
    "project_id" UUID,
    "product" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "hint" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_checklist_items" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "template_item_id" UUID NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_by_name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_templates_bank_id_loan_type_idx" ON "checklist_templates"("bank_id", "loan_type");

-- CreateIndex
CREATE INDEX "checklist_template_items_template_id_sort_order_idx" ON "checklist_template_items"("template_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "case_checklist_items_case_id_template_item_id_key" ON "case_checklist_items"("case_id", "template_item_id");

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_checklist_items" ADD CONSTRAINT "case_checklist_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "loan_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_checklist_items" ADD CONSTRAINT "case_checklist_items_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "checklist_template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

