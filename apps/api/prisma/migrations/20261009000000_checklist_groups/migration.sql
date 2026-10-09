-- Checklist page by loan family (HL/LAP, Business, Used Car) and profile, grouped into sections.
ALTER TABLE "checklist_templates" ADD COLUMN "loan_group" TEXT;
ALTER TABLE "checklist_template_items" ADD COLUMN "section" TEXT NOT NULL DEFAULT 'OTHER';
CREATE INDEX "checklist_templates_loan_group_profile_idx" ON "checklist_templates"("loan_group", "profile");
