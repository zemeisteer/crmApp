-- What a plan includes (plans/entitlements.ts); empty means everything, as before.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL;
