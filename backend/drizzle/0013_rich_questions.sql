-- CRMAPP: richer test questions and essay review
-- Migration: 0013_rich_questions.sql (idempotent)
ALTER TABLE "exam_questions" ALTER COLUMN "question_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exam_questions" ALTER COLUMN "question_type" SET DATA TYPE text USING "question_type"::text;--> statement-breakpoint
ALTER TABLE "exam_questions" ALTER COLUMN "question_type" SET DEFAULT 'MCQ';--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN IF NOT EXISTS "section" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN IF NOT EXISTS "instruction" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN IF NOT EXISTS "passage" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN IF NOT EXISTS "meta" text;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'DONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN IF NOT EXISTS "manual_scores" text;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN IF NOT EXISTS "ai_review" text;--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'DONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD COLUMN IF NOT EXISTS "manual_scores" text;--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD COLUMN IF NOT EXISTS "ai_review" text;
