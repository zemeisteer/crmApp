-- CRMAPP: map link per branch; center address moves to its branch
-- Migration: 0011_branch_map_url.sql (idempotent)
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "map_url" text;--> statement-breakpoint
-- The address and map link used to live on the center profile. Copy them to
-- the center's oldest branch when that branch has none yet.
UPDATE "branches" b
SET address = coalesce(b.address, t.address),
    map_url = coalesce(b.map_url, t.website)
FROM "tenants" t
WHERE t.id = b.tenant_id
  AND b.id = (SELECT b2.id FROM "branches" b2 WHERE b2.tenant_id = t.id ORDER BY b2.created_at LIMIT 1)
  AND (b.address IS NULL OR b.map_url IS NULL)
  AND (t.address IS NOT NULL OR t.website IS NOT NULL);
