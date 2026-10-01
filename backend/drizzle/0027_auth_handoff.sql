-- CRMAPP: one-time codes that carry a staff session to the center's own
-- address (<center>.<main domain>), where the browser keeps a separate login
-- Migration: 0027_auth_handoff.sql (idempotent)
CREATE TABLE IF NOT EXISTS "auth_handoff_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_handoff_codes_hash_idx" ON "auth_handoff_codes" USING btree ("code_hash");
