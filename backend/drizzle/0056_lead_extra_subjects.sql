-- A lead may be interested in more than one direction: the main one stays in
-- desired_subject_id, the others are kept here.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "extra_subject_ids" text[] DEFAULT '{}'::text[] NOT NULL;
