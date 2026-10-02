-- Profile-wise document checklists (Salaried, SENP, SEP, NRI, Pensioner).
ALTER TABLE "checklist_templates" ADD COLUMN "profile" TEXT;
ALTER TABLE "loan_cases" ADD COLUMN "customer_profile" TEXT;
CREATE INDEX "checklist_templates_profile_idx" ON "checklist_templates"("profile");
