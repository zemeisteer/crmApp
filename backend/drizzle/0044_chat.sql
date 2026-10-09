-- Two-way messages: conversations (a student's cabinet with the center or a
-- teacher, or a group), messages in server order (seq) with a one-per-sender
-- client id so a retried send is one message, and each participant's read
-- position. New tables only; nothing existing is changed.
CREATE TABLE IF NOT EXISTS "chat_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"student_id" text,
	"teacher_user_id" text,
	"group_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" bigserial NOT NULL,
	"sender_key" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_user_id" text,
	"sender_student_id" text,
	"sender_viewer" text,
	"sender_name" text NOT NULL,
	"body" text NOT NULL,
	"client_message_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_reads" (
	"conversation_id" text NOT NULL,
	"participant_key" text NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reads_conversation_id_participant_key_pk" PRIMARY KEY("conversation_id","participant_key")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_teacher_user_id_users_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_student_id_students_id_fk" FOREIGN KEY ("sender_student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_center_uniq" ON "chat_conversations" USING btree ("tenant_id","student_id") WHERE kind = 'STUDENT_CENTER';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_teacher_uniq" ON "chat_conversations" USING btree ("tenant_id","student_id","teacher_user_id") WHERE kind = 'STUDENT_TEACHER';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_group_uniq" ON "chat_conversations" USING btree ("tenant_id","group_id") WHERE kind = 'GROUP';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_idx" ON "chat_conversations" USING btree ("tenant_id","kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_client_once" ON "chat_messages" USING btree ("conversation_id","sender_key","client_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_seq_idx" ON "chat_messages" USING btree ("conversation_id","seq");
