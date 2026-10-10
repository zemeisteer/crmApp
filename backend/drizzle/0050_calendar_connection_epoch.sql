-- Google Calendar connections: which account the grant belongs to (so that a
-- reconnect of the same account keeps the chosen calendar and another
-- account starts clean), a counter that stops a sync started before a
-- disconnect or a calendar switch, and how many events were left behind in
-- an account that can no longer be reached.
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "account_key" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "leftover_events" integer DEFAULT 0 NOT NULL;
