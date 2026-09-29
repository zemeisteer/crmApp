-- CRMAPP: what was covered in each lesson (per group and local date), entered
-- with attendance and shown in the student cabinet's past lessons.
-- Migration: 0024_lesson_topics.sql (idempotent)
CREATE TABLE IF NOT EXISTS "lesson_topics" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "group_id" text NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "topic" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_topics_group_date_idx" ON "lesson_topics" ("group_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_topics_tenant_idx" ON "lesson_topics" ("tenant_id");
