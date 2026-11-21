CREATE TABLE IF NOT EXISTS "portal_pin_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_pin_failures_phone_idx" ON "portal_pin_failures" USING btree ("phone_hash","created_at");