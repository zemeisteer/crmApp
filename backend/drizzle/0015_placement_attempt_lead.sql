-- CRMAPP: a placement test result is filed under the applicant's lead
-- Migration: 0015_placement_attempt_lead.sql (idempotent)
ALTER TABLE "placement_attempts" ADD COLUMN IF NOT EXISTS "lead_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_attempts_lead_idx" ON "placement_attempts" USING btree ("lead_id");
