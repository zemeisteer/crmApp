ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "is_individual" boolean DEFAULT false NOT NULL;
