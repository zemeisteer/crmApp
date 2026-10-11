-- Google Calendar connections: who holds the lease (so that a worker that
-- lost it can neither free the new holder's lease nor overwrite the row),
-- and a grant for another Google account waiting until the old account's
-- events have been removed with the old grant.
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "lock_token" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "next_access_token_enc" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "next_refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "next_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "next_account_key" text;
