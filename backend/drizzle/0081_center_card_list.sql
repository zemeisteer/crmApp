-- A center may show several cards in the cabinet; a receipt remembers the
-- card it was paid to. Additive only: a center with one card keeps it in
-- card_number / card_holder, read as a list of one.
ALTER TABLE "payment_claims" ADD COLUMN IF NOT EXISTS "card_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "card_list" jsonb;
