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

**F4 chat backend, cash, schedule race, pagination.** Commits `6f4b74a`, `ab3e518`.
- Tested: `chat.e2e-spec`, `schedule-race.e2e-spec` 3, `list-pagination.e2e-spec` 3.

**Frontend agent (make-ups and calendar).** Commit `ea8c8e5`.
- Verified by me after the agent: tsc PASS; lint 0 errors / 71 warnings; unit 24/24;
  backend rebuilt, browser build rebuilt, **full browser suite 26/26** in Chromium.

**L-02 and contrast.** Commit `7c1a66c`.
- Plans get `features_ru` / `features_en` (migration 0046 translates the shipped tiers
  only when untouched). The site and the pricing page show the visitor's language with
  an Uzbek fallback. The platform admin edits all three.
- Tested: `plan-languages.e2e` 2/2; `db:verify-migrations` scenario 9 PASS;
  `db:check-migrations` 47 agree; drift check "No schema changes"; `plans.test` 2/2.
- Contrast: late/medium chips `#EA7A3A` → `#B4531A` (5.0:1 with white), grey hints
  `#9CA3AF` → `#686B75`.

**Cross-feature (in progress).**
- The timetable page shows this week's make-ups on their day (`makeups.spec` extended).
- The chat frontend is being built by an agent; nothing from it is committed or claimed
  yet.

**Chat frontend.** Commit `de03f14`. The agent was stopped once by a usage limit and
resumed. Verified by me after it finished:
- tsc PASS; lint 0 errors / 71 warnings (unchanged); frontend unit 46/46.
- Backend and browser builds rebuilt; **full browser suite 31/31** (Chromium, 4.6 min).
- The stream runs on /messages only. Elsewhere the badge polls on load, on focus and
  once a minute. An always-open stream would keep Playwright's `networkidle` from ever
  settling on every page.

**Full backend e2e after the container restart** (PostgreSQL had to be restarted):
48 files / 319 PASS.

**Follow-up round: "finish what is not complete".** Commits `db85867`..`3aa5997`, plus docs.
- Browser runs can now be configured to run side by side: `BROWSER_DIST_DIR` plus their
  own ports and database. Two agents ran their browser suites in parallel this way.
- Chat across two API instances on one database (`chat-instances.e2e`). Fails with NOTIFY
  switched off, passes with it.
- Lists: the students and payments pages use server paging (agent; verified by me).
- Missing browser coverage (agent; verified by me):
  - make-up session, cancel, forfeit, reinstate, void;
  - group chat;
  - Google connected states against a local fake Google;
  - parent calendar link;
  - leads custom-field column. Its backend defect is fixed: the list API now returns
    values.
- Accessibility: the axe-core spec found 25 serious contrast findings and none of any
  other kind. Colours were fixed and the result is now 0.
- Final, run by me:
  - browser 38/38 and Google 1/1;
  - backend e2e 49 files / 320, unit 320;
  - frontend unit 55, tsc 0, lint 0 errors / 67 warnings.
