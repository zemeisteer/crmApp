# Sprint progress — four features + security (started 2026-10-08)

Boundaries: no push, no PR, no merge, no deploy; disposable databases only;
synthetic data; external providers mocked; no tunnel.

## Starting point

| | |
|---|---|
| Remote `dev` | `fc4149b1d31186e93c63dbbd0fbbed6dc82e5d00` (not advanced since the review; CI run 95 green) |
| Local branch | `claude/admiring-goldberg-jkri02` @ `fc4149b`, tracking origin, clean tree |
| Pre-existing user changes | none (only ignored files: `backend/.env`, `frontend/.env.local`, build output, `backend/uploads/*`) |
| Container | restarted since the previous session: PostgreSQL 16 had to be started (`service postgresql start`); Redis not running (not required) |
| Databases (disposable) | `talimcrm_e2e` (backend e2e), `talimcrm_browser_e2e` (browser), `crmapp_audit` (manual runs), `talimcrm_test` |

## Baseline at `fc4149b` (run in this container, 2026-10-08, before any edit)

| Check | Command | Result |
|---|---|---|
| backend typecheck | `npx tsc --noEmit` | PASS |
| backend lint | `npm run lint` | PASS |
| migration journal | `npm run db:check-migrations` | PASS |
| backend unit | `npm run test` | **289/290 — 1 FAIL**: `outbound-url.spec.ts > accepts a public https URL` resolves `example.com` through real DNS, which this container cannot do. Environment limitation, not a code defect; the rewritten test injects a resolver. |
| backend e2e | `npm run test:e2e` | PASS 40 files, 250/250 |
| backend build | `npm run build` | PASS |
| frontend typecheck | `npx tsc --noEmit` | PASS |
| frontend lint | `npm run lint` | PASS (0 errors, 71 warnings) |
| frontend unit | `TZ=America/Los_Angeles npm test` | PASS 9/9 |
| browser | `NODE_ENV=production npm run build:frontend && npm test` | PASS 20/20 (`NODE_ENV=production` needed locally: `backend/.env` sets development and the browser build inherits it) |

Logs: scratchpad `sprint/baseline/*.log` (not part of the repo).

## Workstream checklist

| # | Workstream | Status |
|---|---|---|
| S1 | Outbound webhook validation + pinned transport | done (f9feabf) |
| S2 | Private attachment authorization | done (f9feabf); browser re-run pending with the next frontend batch |
| F1 | Custom fields | backend done (5ac2f89, 0f616db); frontend + 3 browser tests done, commit pending |
| F2 | Make-up lessons + credits | backend done (7a02575); frontend pending |
| F3 | Calendar: ICS + Google outbound | backend done (957ebf5); frontend pending |
| F4 | Two-way chat | backend done (commit pending); frontend pending |
| X | Cross-feature verification, extra gaps, reports, bundle | pending |

Acceptance criteria per workstream: `FOUR_FEATURES_SPEC.md`.

## Checkpoints

(appended per workstream)

### Checkpoint S1 + S2 — commit `f9feabf` (2026-10-08)

Implemented:
- **S1:** IPv6-normalising address classifier, pinned-lookup transport, whole-operation
  timeout, no redirects, production ignores `WEBHOOK_ALLOW_PRIVATE`, URL redacted in
  logs.
- **S2:**
  - `file_refs` (migration 0040, with backfill);
  - `/uploads` serves public kinds only;
  - signed `/api/files` links from `POST /api/files/sign` and
    `POST /api/portal/files/sign`;
  - all uploaders register their files;
  - the frontend renders private files via signed links;
  - nginx public caching and the uploads mount removed.

Tested (actually run):
- **Unit:** `npx vitest run src/common/outbound-url.spec.ts` 19/19. The old validator
  accepts `http://[::ffff:127.0.0.1]/` and `http://[::ffff:169.254.169.254]/`
  (scratchpad `oldcheck/old-results.txt`); the new one refuses both.
- **Backend e2e:** full suite 41 files / 262 tests PASS, including the new
  `file-access.e2e-spec.ts`, 12 tests:
  - anonymous;
  - another tenant;
  - an unassigned teacher;
  - a receptionist before and after their access list changes;
  - another student's cabinet;
  - a parent cabinet;
  - tampered, foreign and expired links;
  - a replaced file.
- **Backend unit:** 48 files / 304 PASS.
- **Migrations:** `db:verify-migrations` PASS, including new scenario 8 (0039 → 0040
  backfill: 9 references, an outside URL and broken JSON skipped, rows unchanged).
  `drizzle-kit generate` reports no schema changes.
- **Frontend:** tsc PASS, lint 0 errors (71 warnings, as at baseline).

Not yet run: browser suite against the new frontend (scheduled with the F1 batch).

Next: F1 custom fields.

### Checkpoint F1 / F2 / F3 backend (2026-10-08 → 2026-10-09)

**F1 custom fields.** Commits `5ac2f89`, `0f616db`.
- Migration 0041, definitions and values API.
- Student and lead integration, lead → student mapping.
- Export with formula guard; import of custom columns.
- Cabinet route (`portalVisible`).
- Tested: `custom-field-values.spec` 10, `custom-fields.e2e-spec` 13 (the task's
  acceptance scenario, isolation, concurrency, limits, export, import, cabinet).

**F2 make-up lessons.** Commit `7a02575`.
- Migration 0042, lesson occurrences, dated lesson cancellations, credits, bookings,
  attendance consumption, cabinet route.
- Tested: `makeups.e2e-spec` 11, including races for issue, last seat, double book
  and double mark, and payroll unchanged.
- The attendance DTO no longer accepts EXCUSED (it caused a 500 at the DB enum).

**F3 calendar.** Commit `957ebf5`.
- Migration 0043, ICS feeds (hash-only keys, rotation, live access re-check).
- Google OAuth (PKCE, one-time state).
- Durable sync with lease and backoff; disconnect removes only our events.
- Tested: `calendar.spec` 5, `calendar.e2e-spec` 13. Google is a **mock**: in memory,
  no network. A live Google check is **BLOCKED**: no OAuth client credentials in this
  environment.

**Full backend run after F3** (container restarted 2026-10-09; PostgreSQL restarted):
- unit 50 files / 320 PASS;
- e2e 44 files: 298 PASS, 1 FAIL. `file-access` parent-cabinet setup was racing a
  later PIN issue (a second PIN legitimately signs the first cabinet out). Test setup
  fixed: one PIN for both. Re-run 12/12.
- `db:verify-migrations` failed at scenario 8, because 0042 adds a tenants column.
  The scenario now compares at 0040 and then applies the rest. PASS.

**Frontend agent (custom fields).**
- Interrupted once by an API rate limit, resumed.
- Verified by me: tsc PASS; lint 0 errors / 71 warnings (baseline); unit 17/17
  (9 + 8 new); `custom-fields.spec.ts` 3/3 in Chromium.
