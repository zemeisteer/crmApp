-- The card a center says it paid to, for the admin who checks the money.
-- Additive only: nothing existing changes or is deleted.
ALTER TABLE "platform_payment_claims" ADD COLUMN IF NOT EXISTS "card_number" text;
