-- Suggest-only message classification: the model's guess and the person's answer.
CREATE TABLE IF NOT EXISTS "message_classifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"input_text" text NOT NULL,
	"options" jsonb NOT NULL,
	"chosen" text,
	"probability" real,
	"probabilities" jsonb,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"latency_ms" integer,
	"rule_action" text,
	"final_label" text,
	"final_action" text,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "message_classifications" ADD CONSTRAINT "message_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "message_classifications" ADD CONSTRAINT "message_classifications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_classifications_tenant_created_idx" ON "message_classifications" USING btree ("tenant_id","created_at");