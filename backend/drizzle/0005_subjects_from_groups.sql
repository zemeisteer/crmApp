-- CRMAPP: one-time backfill of subjects (directions) from group subjects
-- Migration: 0005_subjects_from_groups.sql (idempotent, data only)
-- Groups store their subject as free text; lead forms pick from the
-- subjects table, which was empty for centers that never filled it.
INSERT INTO "subjects" ("id", "tenant_id", "name")
SELECT md5(random()::text || g.tenant_id || g.name), g.tenant_id, g.name
FROM (
  SELECT DISTINCT "tenant_id", trim("subject") AS name
  FROM "groups"
  WHERE "deleted_at" IS NULL AND trim(coalesce("subject", '')) <> ''
) g
ON CONFLICT ("tenant_id", "name") DO NOTHING;
