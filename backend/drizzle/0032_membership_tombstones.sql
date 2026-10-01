-- CRMAPP: a removed member stays removed
-- Migration: 0032_membership_tombstones.sql (idempotent)
--
-- Access to a center now comes only from an ACTIVE membership row. Before,
-- an account with no membership rows at all was let in by its own
-- users.tenant_id / users.role ("legacy account") - which is also exactly
-- what an account looks like after its only membership was deleted.
ALTER TABLE "organization_memberships" ADD COLUMN IF NOT EXISTS "removed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD COLUMN IF NOT EXISTS "removed_by_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The one case that is not ambiguous: the founder of a center. An OWNER
-- cannot be removed through the staff API, so an OWNER account with no
-- membership anywhere, in a center that has no OWNER membership (active or
-- not) and no other such account, never had one. It gets the membership it
-- should have had.
--
-- Every other account without a membership (ADMIN, MANAGER, TEACHER, ...)
-- may be a deliberately removed member and is NOT given access back here.
-- `node scripts/list-unlinked-accounts.cjs` lists them; an owner adds the
-- ones who should work in the center again (Staff -> add, same e-mail).
INSERT INTO "organization_memberships" ("id", "user_id", "tenant_id", "role", "status")
SELECT 'om_founder_' || u."id", u."id", u."tenant_id", 'OWNER', 'ACTIVE'
FROM "users" u
WHERE u."role" = 'OWNER'
  AND u."tenant_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "organization_memberships" m WHERE m."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "organization_memberships" m WHERE m."tenant_id" = u."tenant_id" AND m."role" = 'OWNER')
  AND NOT EXISTS (
    SELECT 1 FROM "users" o
    WHERE o."id" <> u."id" AND o."tenant_id" = u."tenant_id" AND o."role" = 'OWNER'
      AND NOT EXISTS (SELECT 1 FROM "organization_memberships" m WHERE m."user_id" = o."id")
  )
ON CONFLICT DO NOTHING;
