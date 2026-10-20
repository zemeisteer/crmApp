-- Two-step sign-in hardening: a new key is pending until confirmed (and for
-- a short while), one-time recovery codes are kept hashed, and a session
-- records when it itself passed 2FA (handoff codes carry it across).
ALTER TABLE "auth_handoff_codes" ADD COLUMN IF NOT EXISTS "mfa_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_pending_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_pending_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_recovery_hashes" text[];
