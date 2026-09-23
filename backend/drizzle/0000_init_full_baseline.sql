CREATE TYPE "public"."attendance_status" AS ENUM('PRESENT', 'ABSENT', 'LATE');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('CLICK', 'PAYME');--> statement-breakpoint
CREATE TYPE "public"."billing_tx_status" AS ENUM('CREATED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('UZS', 'USD', 'RUB');--> statement-breakpoint
CREATE TYPE "public"."exam_question_type" AS ENUM('MCQ', 'TRUE_FALSE', 'SHORT_ANSWER');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'SUPPLIES', 'TAX', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('UZ', 'RU', 'EN');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('INSTAGRAM', 'TELEGRAM', 'WEBSITE', 'RECOMMENDATION', 'BANNER', 'WALK_IN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'QUALIFIED', 'ENROLLED', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('TELEGRAM', 'SMS', 'EMAIL', 'PUSH', 'IN_APP');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('ATTENDANCE_ABSENT', 'ATTENDANCE_LATE', 'PAYMENT_DUE', 'PAYMENT_RECEIVED', 'HOMEWORK_ASSIGNED', 'HOMEWORK_GRADED', 'EXAM_RESULT', 'ANNOUNCEMENT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CLICK', 'PAYME', 'BANK_TRANSFER', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PAID', 'PENDING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPERADMIN', 'ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER', 'ACCOUNTANT');--> statement-breakpoint
CREATE TYPE "public"."tenant_category" AS ENUM('TIL_MARKAZI', 'MATEMATIKA', 'IT', 'BOSHQA');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"target_audience" text DEFAULT 'ALL' NOT NULL,
	"target_group_id" text,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"send_telegram" boolean DEFAULT false NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"student_id" text NOT NULL,
	"date" text NOT NULL,
	"status" "attendance_status" DEFAULT 'PRESENT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"meta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_tx_id" text,
	"amount" integer NOT NULL,
	"for_month" text NOT NULL,
	"status" "billing_tx_status" DEFAULT 'CREATED' NOT NULL,
	"payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"group_id" text,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"grade" text,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"signatory_name" text DEFAULT 'O''quv bo''limi' NOT NULL,
	"signatory_title" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"group_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"student_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"score" integer DEFAULT 0 NOT NULL,
	"max_score" integer DEFAULT 0 NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"answers" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"prompt" text NOT NULL,
	"question_type" "exam_question_type" DEFAULT 'MCQ' NOT NULL,
	"options" text,
	"correct_answer" text NOT NULL,
	"explanation" text,
	"points" integer DEFAULT 1 NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_results" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"student_id" text NOT NULL,
	"score" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"max_score" integer DEFAULT 100 NOT NULL,
	"passing_score" integer,
	"duration_minutes" integer,
	"exam_date" timestamp,
	"material_path" text,
	"material_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" text,
	"title" text NOT NULL,
	"category" "expense_category" DEFAULT 'OTHER' NOT NULL,
	"amount" integer NOT NULL,
	"payment_method" "payment_method" DEFAULT 'CASH' NOT NULL,
	"date" text NOT NULL,
	"notes" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"level" text,
	"teacher_id" text,
	"start_date" timestamp,
	"max_students" integer DEFAULT 20 NOT NULL,
	"schedule" text,
	"schedule_days" text,
	"start_time" text,
	"monthly_price" integer DEFAULT 0 NOT NULL,
	"description" text,
	"duration_months" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"attachment_path" text,
	"attachment_name" text,
	"max_score" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_completions" (
	"id" text PRIMARY KEY NOT NULL,
	"homework_id" text NOT NULL,
	"student_id" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"submission_text" text,
	"submission_attachment_url" text,
	"submitted_at" timestamp,
	"score" integer,
	"feedback" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"parent_phone" text,
	"status" "lead_status" DEFAULT 'NEW' NOT NULL,
	"source" "lead_source" DEFAULT 'OTHER' NOT NULL,
	"subject" text,
	"branch_id" text,
	"trial_date" timestamp,
	"trial_group_id" text,
	"converted_student_id" text,
	"lost_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"student_id" text,
	"channel" "notification_channel" NOT NULL,
	"event" "notification_event" DEFAULT 'MANUAL' NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"recipient" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"error_message" text,
	"provider" text,
	"provider_message_id" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"amount" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"method" "payment_method" DEFAULT 'CASH' NOT NULL,
	"status" "payment_status" DEFAULT 'PAID' NOT NULL,
	"for_month" text NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"features" text DEFAULT '' NOT NULL,
	"popular" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"for_month" text NOT NULL,
	"status" "billing_tx_status" DEFAULT 'CREATED' NOT NULL,
	"provider" "billing_provider",
	"provider_tx_id" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"color" text DEFAULT '#4F46E5' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"amount" integer NOT NULL,
	"for_month" text NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"teacher_id" text,
	"room_id" text,
	"branch_id" text,
	"day_of_week" integer,
	"date" text,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_recurring" boolean DEFAULT true NOT NULL,
	"online_meeting_url" text,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"topic" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"full_name" text NOT NULL,
	"gender" "gender",
	"phone" text,
	"parent_phone" text,
	"birth_date" timestamp,
	"address" text,
	"telegram_username" text,
	"telegram_chat_id" text,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"full_name" text NOT NULL,
	"subject" text,
	"phone" text,
	"email" text,
	"birth_date" timestamp,
	"start_date" timestamp,
	"salary_type" text,
	"salary_value" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"category" "tenant_category" DEFAULT 'BOSHQA' NOT NULL,
	"accent_color" text DEFAULT '#4F46E5' NOT NULL,
	"logo_url" text,
	"phone" text,
	"address" text,
	"email" text,
	"telegram_username" text,
	"website" text,
	"website_label" text,
	"language" "language" DEFAULT 'UZ' NOT NULL,
	"currency" "currency" DEFAULT 'UZS' NOT NULL,
	"plan" text DEFAULT 'STARTER' NOT NULL,
	"status" "tenant_status" DEFAULT 'TRIAL' NOT NULL,
	"trial_ends_at" timestamp,
	"sms_provider" text DEFAULT 'eskiz' NOT NULL,
	"sms_api_token" text,
	"sms_sender" text DEFAULT '4546' NOT NULL,
	"notify_on_attendance" boolean DEFAULT true NOT NULL,
	"notify_on_payment" boolean DEFAULT true NOT NULL,
	"notify_on_homework" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" DEFAULT 'ADMIN' NOT NULL,
	"permissions" text[],
	"email_verified" boolean DEFAULT false NOT NULL,
	"reset_token_hash" text,
	"reset_token_expires_at" timestamp,
	"verify_token_hash" text,
	"two_factor_secret" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL,
	"event" text NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_target_group_id_groups_id_fk" FOREIGN KEY ("target_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_completions" ADD CONSTRAINT "homework_completions_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_completions" ADD CONSTRAINT "homework_completions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_trial_group_id_groups_id_fk" FOREIGN KEY ("trial_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_student_id_students_id_fk" FOREIGN KEY ("converted_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_tenant_idx" ON "announcements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "announcements_published_at_idx" ON "announcements" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "attendance_tenant_idx" ON "attendance" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "attendance_group_date_idx" ON "attendance" USING btree ("group_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_student_group_date_idx" ON "attendance" USING btree ("student_id","group_id","date");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "billing_tx_tenant_idx" ON "billing_transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "billing_tx_provider_tx_idx" ON "billing_transactions" USING btree ("provider","provider_tx_id");--> statement-breakpoint
CREATE INDEX "branches_tenant_idx" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "certificates_tenant_idx" ON "certificates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_code_idx" ON "certificates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "certificates_student_idx" ON "certificates" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_student_group_idx" ON "enrollments" USING btree ("student_id","group_id");--> statement-breakpoint
CREATE INDEX "exam_attempts_tenant_idx" ON "exam_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_attempts_exam_student_idx" ON "exam_attempts" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "exam_questions_tenant_idx" ON "exam_questions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_questions_exam_idx" ON "exam_questions" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_results_exam_student_idx" ON "exam_results" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "exams_tenant_idx" ON "exams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "exams_group_idx" ON "exams" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "expenses_tenant_idx" ON "expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_key_idx" ON "feature_flags" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "groups_tenant_idx" ON "groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "homework_tenant_idx" ON "homework" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "homework_group_idx" ON "homework" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "homework_completions_hw_student_idx" ON "homework_completions" USING btree ("homework_id","student_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_idx" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE INDEX "platform_subs_tenant_idx" ON "platform_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_subs_tenant_month_idx" ON "platform_subscriptions" USING btree ("tenant_id","for_month");--> statement-breakpoint
CREATE INDEX "rooms_tenant_idx" ON "rooms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "salary_payments_tenant_idx" ON "salary_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_payments_teacher_month_idx" ON "salary_payments" USING btree ("teacher_id","for_month");--> statement-breakpoint
CREATE INDEX "schedules_tenant_idx" ON "schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "schedules_group_idx" ON "schedules" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "schedules_teacher_idx" ON "schedules" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "schedules_room_idx" ON "schedules" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "students_tenant_idx" ON "students" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "teachers_tenant_idx" ON "teachers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_tokens_token_idx" ON "telegram_link_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_tenant_idx" ON "telegram_link_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_subdomain_idx" ON "tenants" USING btree ("subdomain");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhooks_tenant_idx" ON "webhooks" USING btree ("tenant_id");