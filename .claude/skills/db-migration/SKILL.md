---
name: db-migration
description: Change the database schema safely - edit schema.ts, generate the migration with drizzle-kit, review the SQL for data loss, apply it to the local database with the project's runner, and run the backend e2e tests.
argument-hint: "<what changes, e.g. 'add nullable students.telegram_handle'>"
disable-model-invocation: true
---

# Database migration: $ARGUMENTS

Work in `backend/`. The change requested: **$ARGUMENTS**. If that is empty or unclear, ask what should change before touching anything.

Ground rules (from `backend/scripts/migrate.cjs`, SETUP.md "Migratsiyalar", CI):
- The schema is built only from versioned SQL in `backend/drizzle/`, in the order of `drizzle/meta/_journal.json`, applied by `npm run db:migrate` (`scripts/migrate.cjs`, one transaction per migration, recorded in `app_migrations`). CI, the Docker container and the e2e database use the same runner.
- Never `drizzle-kit migrate` (one transaction for everything: PostgreSQL refuses an enum value used in the transaction that added it). Never `npm run db:push` on a database that matters.
- Never edit a migration that is already committed. The PreToolUse hook blocks it; fix forward with a new migration.
- Migrations from 0001 on are idempotent (`IF NOT EXISTS`, guarded `DO $$ ... $$` blocks). Keep it that way.

## 1. Change the schema

Edit `backend/src/db/schema.ts` (and the code that uses it). Keep tenant-scoped tables carrying `tenant_id` with an index that starts with it, like the existing tables.

## 2. Generate the migration

```bash
cd backend
npx drizzle-kit generate --name <short_snake_case_name>
```

(`npm run db:generate` is the same command.) It writes `drizzle/NNNN_<name>.sql`, a snapshot in `drizzle/meta/` and a new `_journal.json` entry. Check the number follows the last one and that `npm run db:check-migrations` passes.

## 3. Review the generated SQL (do not skip)

Read the whole file and report each of these to the user **before applying**, quoting the statement:

| Look for | Why it is dangerous | What to do |
|---|---|---|
| `DROP TABLE`, `DROP COLUMN`, `DROP TYPE` | Data is gone for good | Confirm with the user; prefer keeping the column and stopping its use first |
| `ALTER COLUMN ... SET NOT NULL`, or `ADD COLUMN ... NOT NULL` without `DEFAULT` | Fails on any table that already has rows (production has rows) | Add a `DEFAULT`, or add nullable -> backfill `UPDATE` -> `SET NOT NULL` in a later step |
| A drop + add pair where you meant a rename (drizzle-kit may generate this for a renamed column/table) | The old column's data is lost | Replace with `ALTER TABLE ... RENAME COLUMN ...` by hand |
| `ALTER COLUMN ... TYPE` (narrowing, e.g. bigint -> integer, text -> varchar(n)) | Can fail or truncate | Check the real max values first; add `USING` if needed |
| New `UNIQUE` index / constraint | Fails if duplicates exist | Query for duplicates on the dev DB first |
| `ALTER TYPE ... ADD VALUE` and a use of that value in the same file | Fails inside one transaction | Put the use in the next migration |
| Missing `IF NOT EXISTS` / `IF EXISTS` | Breaks the idempotency the baseline relies on | Add them by hand |

Money columns stay `integer` so'm (capped by `MAX_MONEY` in `src/common/money.ts`); sums are cast `::bigint`.

Edit the new, not yet committed SQL as needed (the guard allows it until it is committed). If you edited it, run `npx drizzle-kit generate --name check` once more: it must answer "No schema changes" (CI fails otherwise). Delete anything that extra run created if it did produce a file.

## 4. Apply it to the local database

The connection string is `backend/.env` -> `DATABASE_URL` (do not print it). The local dev DB holds real old data: take a backup first.

```bash
npm run db:backup            # backups/talimcrm_<date>.sql.gz (git-ignored); needs pg_dump on PATH
# On Windows pg_dump is usually not on PATH: first
#   export PATH="/c/Program Files/PostgreSQL/<ver>/bin:$PATH"   (Git Bash)
npm run db:migrate:status    # the new migration is listed as pending
npm run db:migrate           # applies pending migrations
npm run db:check-drift       # database == schema.ts
```

If `db:migrate` stops on a database without a migration record, do not baseline on your own: show the message to the user (SETUP.md explains `--baseline`).

## 5. Verify

```bash
npm run db:check-migrations     # journal == files
npm run db:verify-migrations    # fresh install + upgrade paths, scratch databases
npx tsc --noEmit
npm run test                    # unit
npm run test:e2e                # real PostgreSQL, rebuilds <db>_e2e from all migrations
```

`test:e2e` takes several minutes: run it in the background and wait for it. Add or update an e2e test in `backend/test/` that covers the new column/table (the `e2e-test-writer` agent can do it).

## 6. Report

Tell the user: migration file name, what it does, every risky statement from step 3 and how it was handled, the commands run and their real results (pass/fail counts), and anything not verified.
