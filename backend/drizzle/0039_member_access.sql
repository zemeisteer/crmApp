-- A staff member's own list of what they may do (keys of
-- src/access/catalog.ts). NULL, the value for everyone existing, means the
-- role's default - exactly what the role could do before - so nothing
-- changes until an owner edits someone's list.
ALTER TABLE "organization_memberships" ADD COLUMN IF NOT EXISTS "access" text[];
