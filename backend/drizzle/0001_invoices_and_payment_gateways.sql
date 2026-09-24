-- CRMAPP Sprint: Billing & Payment Gateway Integration
-- Migration: 0001_invoices_and_payment_gateways.sql

DO $$ BEGIN
  CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TYPE "public"."billing_tx_status" ADD VALUE IF NOT EXISTS 'PENDING';--> statement-breakpoint
ALTER TYPE "public"."billing_tx_status" ADD VALUE IF NOT EXISTS 'FAILED';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
	"enrollment_id" text REFERENCES "enrollments"("id") ON DELETE SET NULL,
	"amount" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"remaining_amount" integer NOT NULL,
	"currency" "currency" DEFAULT 'UZS' NOT NULL,
	"due_date" timestamp NOT NULL,
	"for_month" text NOT NULL,
	"description" text,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_tenant_idx" ON "invoices" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_student_idx" ON "invoices" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_month_idx" ON "invoices" ("for_month");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"payment_id" text NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
	"invoice_id" text NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payment_allocations_tenant_idx" ON "payment_allocations" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx" ON "payment_allocations" ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_idx" ON "payment_allocations" ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_allocations_payment_invoice_uniq" ON "payment_allocations" ("payment_id", "invoice_id");--> statement-breakpoint

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "invoice_id" text REFERENCES "invoices"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_tx_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "receipt_number" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_invoice_idx" ON "payments" ("invoice_id");--> statement-breakpoint

ALTER TABLE "billing_transactions" ADD COLUMN IF NOT EXISTS "invoice_id" text REFERENCES "invoices"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_tx_invoice_idx" ON "billing_transactions" ("invoice_id");--> statement-breakpoint
