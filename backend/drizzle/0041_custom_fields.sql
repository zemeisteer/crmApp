-- Custom fields a center defines for its students and leads: the definitions
-- (type, options with stable ids, required, order, archive) and one value row
-- per record and field. New tables only; nothing existing is changed.
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"portal_visible" boolean DEFAULT false NOT NULL,
	"student_field_id" text,
	"option_map" jsonb,
	"archived_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_values" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"student_id" text,
	"lead_id" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "custom_field_values_one_owner" CHECK (("custom_field_values"."student_id" IS NULL) <> ("custom_field_values"."lead_id" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_student_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("student_field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_definitions_key_uniq" ON "custom_field_definitions" USING btree ("tenant_id","entity_type","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_definitions_tenant_idx" ON "custom_field_definitions" USING btree ("tenant_id","entity_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_student_uniq" ON "custom_field_values" USING btree ("definition_id","student_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_lead_uniq" ON "custom_field_values" USING btree ("definition_id","lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_values_student_idx" ON "custom_field_values" USING btree ("tenant_id","student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_values_lead_idx" ON "custom_field_values" USING btree ("tenant_id","lead_id");
