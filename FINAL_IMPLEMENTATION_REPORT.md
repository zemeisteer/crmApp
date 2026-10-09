# Final implementation report — sprint 2026-10-08/09

- **Branch:** `claude/admiring-goldberg-jkri02`
- **Starting commit:** `fc4149b`. It equals `origin/dev` and the remote branch.
- **Local commits on top:** 15 (this report included), kept in this cloud workspace. **Nothing was pushed.**

Companion documents:
- `FOUR_FEATURES_SPEC.md`: the design.
- `FOUR_FEATURES_TEST_MATRIX.md`: action-level rows.
- `SECURITY_RECHECK.md`: findings and evidence.
- `SPRINT_PROGRESS.md`: checkpoints.

## 1. Status

| Workstream | Status |
|---|---|
| Security A: outbound webhook addresses (mapped IPv6, DNS pinning, timeout, production override) | IMPLEMENTED AND VERIFIED |
| Security B: private attachments behind signed, authorized links | IMPLEMENTED AND VERIFIED |
| F1 Custom fields (students, leads, conversion, import/export, cabinet) | IMPLEMENTED AND VERIFIED |
| F2 Make-up lessons and credits | IMPLEMENTED AND VERIFIED |
| F3 Calendar: ICS subscription links | IMPLEMENTED AND VERIFIED |
| F3 Calendar: Google Calendar outbound sync | IMPLEMENTED (verified against a mock); LIVE INTEGRATION BLOCKED |
| F4 Two-way chat (staff ↔ cabinet, live) | IMPLEMENTED AND VERIFIED |
| Large lists paged on the server (students, payments, attendance) | IMPLEMENTED AND VERIFIED (API) |
| Timetable double booking under concurrency | IMPLEMENTED AND VERIFIED |
| `cash_closings` int4 overflow | IMPLEMENTED AND VERIFIED |
| Attendance `EXCUSED` 500 → 400 | IMPLEMENTED AND VERIFIED |
| L-02 tariff feature text per language | IMPLEMENTED AND VERIFIED |
| Remaining contrast nodes (status chips, grey hints) | IMPLEMENTED (colours computed ≥ 4.5:1; no new axe scan run) |

The students, payments and attendance pages still load what they loaded before. Paging
is in the API (`page`/`pageSize`), and the list pages are not switched to it yet (see
Limitations).

## 2. How to use

- **Custom fields.**
  1. Settings → Custom fields (owner or admin): add a field (text, number, date, yes/no,
     select, multi-select), mark it required or visible in the cabinet.
  2. It appears in the add/edit student or lead form and on the detail page.
  3. Converting a lead carries mapped values across.
  4. Import accepts the field label as a column header. Export includes the fields.
- **Make-ups.**
  1. Settings → Make-up credits: set the expiry, or none.
  2. Menu → Make-up lessons → Missed lessons: issue a credit for an absence or a
     cancelled lesson.
  3. Credits → Book: a seat in another group's lesson, or a separate session with a
     teacher and room.
  4. Roster: the teacher marks attended or missed. Attended uses the credit.
  5. Group page → Cancelled lessons: call off one dated lesson. Its students become
     eligible.
  6. This week's make-ups also show on the Timetable page. The cabinet shows the child's
     credits and bookings.
- **Calendar.**
  - Menu → Calendar → "Create link": copy it into Google, Apple or Outlook calendar
    (webcal). "New link" turns the old one off; "Turn off" stops it.
  - The cabinet has the child's own link.
  - Google Calendar (when configured): Connect → choose a calendar → events are kept in
    sync. Disconnect removes only the events this app created.
- **Chat.**
  - Staff: menu → Messages. Pick a conversation or start one: the center's inbox, a
    student, or a group.
  - Cabinet: the "Yozishmalar" tab writes to the center or to the student's own teachers.
  - Messages arrive live. The unread count shows on the menu item.
  - Enter sends and Shift+Enter adds a line. A failed send can be retried without
    duplicating.
- **Tariffs (platform admin):** Tariflar → edit a plan → Uzbek, Russian and English
  feature lists. An empty translation shows the Uzbek list.

## 3. Security fixes and evidence

Details and before/after evidence are in `SECURITY_RECHECK.md`. In short:

| Fix | Evidence |
|---|---|
| S-A1/2/3: mapped IPv6 and other textual forms refused; resolve, check and connect use one DNS answer; one timeout; no redirects; private targets never allowed in production; logs carry host only | `outbound-url.spec` (19); the old code accepted `http://[::ffff:127.0.0.1]/` (scratchpad `sprint/oldcheck/old-results.txt`) |
| S-B1: private files 404 on `/uploads`, served only via 30-minute HMAC links issued after an ownership/scope check; nginx no longer caches uploads publicly | `file-access.e2e` (12), `verify-migrations` scenario 8 |
| S-C1: a parent-account cabinet token ends when the guardian link or membership ends | `chat.e2e` |
| S-D1: timetable writes take advisory locks (teacher → room → group) | `schedule-race.e2e` (3). The old code double-booked in 3/3 runs |
| S-D2: cash closing amounts are bigint | `audit-hardening.e2e` |
| S-D3: `EXCUSED` attendance status → 400 | `makeups.e2e` |

The new surfaces of the four features (catalog keys, tenant isolation, hashed feed keys,
OAuth state and PKCE, encrypted tokens, live chat access checks, formula-safe exports)
are listed in `SECURITY_RECHECK.md` with their tests.

## 4. Migrations and configuration

**Migrations.** All are idempotent and applied by `npm run db:migrate`.

| Migration | What it does |
|---|---|
| 0040_file_refs | File ownership; backfilled from existing references |
| 0041_custom_fields | Definitions and values |
| 0042_makeup_lessons | Cancellations, credits, bookings; `tenants.makeup_credit_days` |
| 0043_calendar_sync | Feed keys, Google connections, events, OAuth states |
| 0044_chat | Conversations, participants, messages |
| 0045_cash_bigint | `cash_closings` amounts → bigint |
| 0046_plan_feature_languages | `plans.features_ru/en`; fills the shipped tiers only if untouched |

**Configuration** (all optional; passed through `docker-compose.prod.yml`, described in
`.env.production.example`):

| Variable | Purpose | Default |
|---|---|---|
| `FILE_URL_SECRET` | Signs private-file links | Derived from `JWT_SECRET` |
| `PUBLIC_API_URL` | Host of calendar links | `FRONTEND_URL` + `/api` |
| `CALENDAR_TOKEN_KEY` | base64 32-byte key for Google tokens at rest | Derived from `JWT_SECRET` (logged as a warning) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Calendar. All three are needed, otherwise Google is off. The redirect URI is `https://<domain>/api/calendar/google/callback` | Off |
| `CALENDAR_SYNC_MS`, `CHAT_HEARTBEAT_MS` | Sync interval and stream heartbeat | Built-in |
| `WEBHOOK_ALLOW_PRIVATE` | Development only; ignored in production | false |

## 5. Tests run in this container, final state

| Command | Result |
|---|---|
| `backend: npm run lint` (oxlint) | clean |
| `backend: npm test` | 50 files, **320/320** |
| `backend: npm run test:e2e` (disposable PostgreSQL 16) | 48 files, **319/319** |
| `backend: npm run db:check-migrations` | 47 migrations, journal and files agree |
| `backend: npm run db:verify-migrations` | scenarios 1–9 PASS |
| `backend: npx drizzle-kit generate` | "No schema changes" |
| `backend: npm run build` | OK |
| `frontend: npx tsc --noEmit` | 0 errors |
| `frontend: npm run lint` | 0 errors, 71 warnings (same as the starting point) |
| `frontend: TZ=America/Los_Angeles npm test` | **46/46** |
| `e2e-browser: NODE_ENV=production npm run build:frontend` | OK (production build) |
| `e2e-browser: npx playwright test` (Chromium) | **31/31**, 4.6 min |
| `docker compose -f docker-compose.prod.yml config` | valid |

## 6. Browser coverage

Each new screen has at least one action-level browser row in
`FOUR_FEATURES_TEST_MATRIX.md`.

- **Custom fields:** define, fill, edit, required error, archive, lead → student carry,
  390 px.
- **Make-ups:** set the policy; issue, book into a group lesson, roster attended, credit
  used; the timetable shows the week's make-up; cancel a dated lesson and restore it;
  the cabinet view.
- **Calendar:** create, copy and fetch a link; new link turns off the old one; turn off;
  the "Google not configured" state; the cabinet link.
- **Chat:** two separate browser contexts (a fresh teacher and a student cabinet).
  - Messages go both ways live; the unread badge goes up and clears.
  - A double-click, two clicks at once, and a retry after a lost reply each store one
    message.
  - Another teacher and another center get not-found/404.
  - The phone layout works.
- **Tariffs:** the main site in UZ/RU/EN shows each language's list.
- **Mobile:** `/makeups`, `/calendar` and `/messages` (list and thread) fit a 390 px
  screen.

These have no browser test (API tests only):
- make-up separate-session booking, void, reinstate and cancel booking;
- Google connected states;
- group chat conversations.

## 7. Mock vs live integrations

- **Google Calendar: mock.** It runs in memory with Google's id and error semantics:
  409 on duplicate ids, 410/404 on deletes, 429/503 backoff, `invalid_grant`.
  - Live is **BLOCKED**: there are no OAuth client credentials, and
    `accounts.google.com` / `www.googleapis.com` are outside this environment's network
    policy.
  - The browser suite runs with the Google variables blank.
- **Outbound webhooks:** only local fixture servers on 127.0.0.1 with an injected
  resolver. No external host or metadata endpoint was contacted.
- **Sent nothing real:** e-mail, SMS, Telegram, Click/Payme and AI providers are switched
  off in the test environments.
- **Real and disposable:** PostgreSQL 16 (LISTEN/NOTIFY for chat), the NestJS API, the
  Next.js production build and Chromium all ran for real in this container. The
  databases and accounts were disposable and synthetic.

## 8. Limitations and follow-ups

- **List paging:** the students, payments and attendance pages do not use the new API
  paging yet. Without `page`, the API still returns what it returned before.
- **Chat stream scope:** the live stream runs on the Messages page only. Elsewhere the
  menu badge refreshes on load, on focus and once a minute. An always-open stream would
  keep Playwright's `networkidle` from ever settling.
- **Chat fan-out:** across several API instances it goes through PostgreSQL NOTIFY. Only
  one process was exercised.
- **Chat sender names:** a parent's sender name carries "(ota-ona)" in Uzbek in every
  language (it comes from the server).
- **Accessibility:** contrast was fixed by computed ratios, and no new axe scan was run
  for this sprint. Screen readers were not tested, and only Chromium was used.
- **Parent accounts:** there is no link from the cabinet to the parent's own staff-side
  calendar link. The child's link is in the cabinet.
- **Leads list:** it has no custom-field column. Fields appear on the lead page and in
  forms.

## 9. Bundle and resume

- **Bundle:** in the session scratchpad `deliverables/` folder, also sent as files.
  - `crm-sprint.bundle` (git bundle `fc4149b..HEAD`);
  - `crm-sprint-patches/` (`git format-patch`);
  - `crm-sprint.diff`;
  - `SHA256SUMS`.
- **Apply check:** it was verified to apply to `fc4149b` in a separate worktree. The
  working copy was not touched.
- **Resume:**
  - `git fetch <bundle> HEAD:sprint && git checkout sprint`, or apply the patches with
    `git am` on `fc4149b`.
  - Then `service postgresql start` (in a container), `cd backend && npm ci && npm run
    db:migrate`, `cd frontend && npm ci`, and the commands in section 5.

## 10. Boundaries kept

- **Repository:** no git push, pull request, merge, deployment or publish.
- **Data and messages:** no production database, no real customer data, and no real
  messages, e-mails, SMS, payments or calendar invitations.
- **Secrets:** no secrets in reports, logs, patches or archives. The bundle was scanned
  before delivery.
