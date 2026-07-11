DROP INDEX IF EXISTS "leads_org_contact_idx";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_contact_uq" UNIQUE("org_id","contact_id");