-- After the last lesson, teachers who left attendance unmarked are reminded;
-- the month's invoices are issued by themselves on the 1st. Both on by default.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "remind_attendance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "auto_invoices" boolean DEFAULT true NOT NULL;
