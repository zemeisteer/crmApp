ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sender_person" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sender_about" text;--> statement-breakpoint
-- Messages written before the parts were stored: staff and students wrote
-- under their own name; a parent's child is the message's student, and a
-- parent with an account is that account's name.
UPDATE "chat_messages" SET "sender_person" = "sender_name"
  WHERE "sender_person" IS NULL AND ("sender_type" = 'USER' OR ("sender_type" = 'CABINET' AND coalesce("sender_viewer", 'student') <> 'parent'));--> statement-breakpoint
UPDATE "chat_messages" m SET "sender_about" = s."full_name"
  FROM "students" s
  WHERE m."sender_about" IS NULL AND m."sender_type" = 'CABINET' AND m."sender_viewer" = 'parent' AND s."id" = m."sender_student_id";--> statement-breakpoint
UPDATE "chat_messages" m SET "sender_person" = u."full_name"
  FROM "users" u
  WHERE m."sender_person" IS NULL AND m."sender_type" = 'CABINET' AND m."sender_viewer" = 'parent' AND u."id" = m."sender_user_id";
