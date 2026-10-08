-- Uploaded files and the records they belong to. Until now every file under
-- /uploads was readable by anyone who had its name; from here a file is
-- served only through a reference: public kinds (center logo, public site
-- pictures) at /uploads/<name>, everything else through a short-lived
-- signed link given to a caller who may see the owning record.
-- New table, filled from the references that already exist, so homework,
-- exam and mock-test files uploaded before keep working for the people
-- allowed to see them. Nothing existing is changed.
CREATE TABLE IF NOT EXISTS "file_refs" (
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"student_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_refs_name_kind_owner_id_pk" PRIMARY KEY("name","kind","owner_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_refs_name_idx" ON "file_refs" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_refs_owner_idx" ON "file_refs" USING btree ("kind","owner_id");
--> statement-breakpoint
-- JSON kept in text columns: a value that does not parse is skipped, not fatal.
CREATE OR REPLACE FUNCTION pg_temp.file_refs_json(t text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Homework attachments (uploaded or generated PDF).
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT h."tenant_id", h."attachment_path", 'HOMEWORK_ATTACHMENT', h."id"
FROM "homework" h
WHERE h."attachment_path" ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Students' homework submissions.
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id", "student_id")
SELECT h."tenant_id", c."submission_attachment_url", 'HOMEWORK_SUBMISSION', h."id", c."student_id"
FROM "homework_completions" c
JOIN "homework" h ON h."id" = c."homework_id"
WHERE c."submission_attachment_url" ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Exam materials (staff only).
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT e."tenant_id", e."material_path", 'EXAM_MATERIAL', e."id"
FROM "exams" e
WHERE e."material_path" ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Center logos (public: shown on the login page and the public site).
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT t."id", t."logo_url", 'PUBLIC_LOGO', t."id"
FROM "tenants" t
WHERE t."logo_url" ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Public site gallery pictures.
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT t."id", g.v #>> '{}', 'PUBLIC_SITE', t."id"
FROM "tenants" t
CROSS JOIN LATERAL jsonb_path_query(pg_temp.file_refs_json(t."site_content"), 'lax $.**') AS g(v)
WHERE jsonb_typeof(g.v) = 'string'
  AND (g.v #>> '{}') ~ '^[A-Za-z0-9_-]{8,64}\.(jpe?g|png|webp)$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Mock-test recordings and pictures (any audioPath / imagePath in the content).
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT m."tenant_id", p.v #>> '{}', 'MOCK_ASSET', m."id"
FROM "mock_tests" m
CROSS JOIN LATERAL jsonb_path_query(pg_temp.file_refs_json(m."content"), 'lax $.**.audioPath') AS p(v)
WHERE jsonb_typeof(p.v) = 'string' AND (p.v #>> '{}') ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT m."tenant_id", p.v #>> '{}', 'MOCK_ASSET', m."id"
FROM "mock_tests" m
CROSS JOIN LATERAL jsonb_path_query(pg_temp.file_refs_json(m."content"), 'lax $.**.imagePath') AS p(v)
WHERE jsonb_typeof(p.v) = 'string' AND (p.v #>> '{}') ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Files of mock-test imports still on record.
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id")
SELECT i."tenant_id", f.v ->> 'path', 'MOCK_IMPORT', i."id"
FROM "mock_imports" i
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pg_temp.file_refs_json(i."files"), '[]'::jsonb)) AS f(v)
WHERE jsonb_typeof(f.v) = 'object' AND (f.v ->> 'path') ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Students' speaking recordings in mock attempts.
INSERT INTO "file_refs" ("tenant_id", "name", "kind", "owner_id", "student_id")
SELECT a."tenant_id", s.v #>> '{}', 'MOCK_SPEAKING', a."id", a."student_id"
FROM "mock_attempts" a
CROSS JOIN LATERAL jsonb_path_query(pg_temp.file_refs_json(a."answers"), 'lax $.speaking.*.audio') AS s(v)
WHERE jsonb_typeof(s.v) = 'string' AND (s.v #>> '{}') ~ '^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$'
ON CONFLICT DO NOTHING;
