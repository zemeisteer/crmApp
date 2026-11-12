CREATE TABLE IF NOT EXISTS "mock_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "test_id" text NOT NULL REFERENCES "mock_tests"("id") ON DELETE cascade,
  "group_id" text NOT NULL REFERENCES "groups"("id") ON DELETE cascade,
  "starts_at" timestamp NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_sessions_tenant_idx" ON "mock_sessions" ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_sessions_group_idx" ON "mock_sessions" ("group_id");
