-- SMS goes through the platform's provider account: a plan says whether SMS is part
-- of it (on for every plan, as before), and a center can switch it off.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sms_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_enabled" boolean DEFAULT true NOT NULL;
