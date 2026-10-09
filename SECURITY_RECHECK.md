# Security recheck — sprint 2026-10-08/09

These are new findings and fixes from this sprint. They were reproduced and fixed in this
container, and each is pinned by a regression test. The earlier audit
(`AUDIT_FINDINGS.md`) is historical and is not restated here.

| ID | Area | Finding | Status |
|---|---|---|---|
| S-A1 | Outbound webhooks | IPv4-mapped IPv6 bypass: `new URL('http://[::ffff:127.0.0.1]/')` normalises to `::ffff:7f00:1`, which the old check accepted. The same held for `::ffff:a9fe:a9fe` (cloud metadata), NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible `::a.b.c.d` and site-local `fec0::/10`. | FIXED AND VERIFIED |
| S-A2 | Outbound webhooks | DNS answer checked, then resolved again by `fetch` (rebinding window). | FIXED AND VERIFIED |
| S-A3 | Outbound webhooks | `WEBHOOK_ALLOW_PRIVATE=true` also worked in production. Webhook URLs (which can carry secrets) were written to logs. | FIXED AND VERIFIED |
| S-B1 | Uploads | Every uploaded file was public at `/uploads/<name>`, with `Cache-Control: public` for 30 days in nginx. This covered homework, submissions, exam keys, speaking recordings and mock-test assets. | FIXED AND VERIFIED |
| S-C1 | Cabinet sessions | A cabinet token minted for a parent account survived unlinking the guardian (30-day token). | FIXED AND VERIFIED |
| S-D1 | Data integrity | Timetable conflict check and write were separate: concurrent requests double-booked a teacher or room. | FIXED AND VERIFIED |
| S-D2 | Data integrity | `cash_closings` amounts were int4, so closing a day with more than 2,147,483,647 so'm cash failed with 500. | FIXED AND VERIFIED |
| S-D3 | Validation | The attendance DTO accepted `EXCUSED`, which the database enum lacks, so the request failed with 500. | FIXED AND VERIFIED (now 400) |

## S-A1/2/3 — outbound webhook addresses

**Before.** Run against the actual exported validator of `fc4149b` (scratchpad
`sprint/oldcheck/old-results.txt`):

```
old isBlockedAddress ::ffff:7f00:1 => false
old isBlockedAddress ::ffff:a9fe:a9fe => false
old isBlockedAddress 64:ff9b::7f00:1 => false
old isBlockedAddress 2002:7f00:1::1 => false
old assertPublicHttpUrl http://[::ffff:127.0.0.1]/x => ACCEPTED http://[::ffff:7f00:1]/x
old assertPublicHttpUrl http://[::ffff:169.254.169.254]/latest/meta-data => ACCEPTED
```

**Fix** (`backend/src/common/outbound-url.ts`):
- **Address parsing.** IPv6 is parsed into its 8 groups. For the mapped, NAT64 and
  6to4 forms, the embedded IPv4 address decides. Otherwise only global unicast
  `2000::/3` passes, excluding `2001::/23`, documentation and relay ranges.
- **Delivery.** `postToPublicUrl` uses `http(s).request` with a `lookup` that resolves,
  checks every answer and hands exactly those addresses to the socket. The check and
  the connection therefore use one DNS answer. TLS still verifies the host name
  (`servername` is the URL host).
- **Request rules.** `agent: false`, no redirects, and one timeout for the whole
  operation (check, DNS, connect, response head).
- **Production.** `privateTargetsAllowed()` is false in production whatever the flag
  says.
- **Logs.** They carry scheme and host only (`urlForLog`).

**Evidence.** `backend/src/common/outbound-url.spec.ts`, 19 tests. The fixture tests
run on 127.0.0.1 with an injected resolver; nothing leaves the machine and no metadata
endpoint is contacted.
- Mapped and other textual forms are refused.
- Every DNS answer is checked.
- A private answer means zero requests reach the fixture receiver.
- Rebinding: a public answer for the check, a private one for the connection → refused,
  zero requests.
- A redirect is not followed.
- The timeout covers both a hung resolver and a hung server.
- A self-signed certificate is refused.

## S-B1 — private attachments

**Fix.**
- `file_refs` (migration 0040) records what every stored file belongs to. It is
  backfilled from existing references: homework, submissions, exam materials, logo,
  site gallery, mock-test assets, mock imports and speaking recordings.
- `/uploads/<name>` now serves only public kinds (logo, site gallery). Everything else
  gets 404.
- Private files are reached only through a 30-minute HMAC-signed `/api/files/<name>`
  link. `POST /api/files/sign` (staff) and `POST /api/portal/files/sign` (cabinet) hand
  the link out after checking the caller against the owning record:
  - group scope for teachers;
  - the caller's access list (`homework.view`, `exams.view`, `mockTests.manage`);
  - the student's own submissions and recordings;
  - published or attempted tests for the cabinet.
- nginx no longer caches uploads publicly and no longer mounts the uploads volume.
- The frontend renders private files only through signed links.

**Evidence.** `backend/test/file-access.e2e-spec.ts`, 12 tests:
- an anonymous request is 404 or 401;
- another tenant gets nothing;
- an unassigned teacher gets nothing;
- a receptionist's files follow their access list (granted → removed);
- another student's cabinet gets nothing; a parent cabinet sees what the student sees;
- tampered, foreign-file and expired links get 403;
- a replaced homework file goes out of reach;
- path traversal on `/uploads` gets 404.

Migration evidence: `verify-migrations` scenario 8 (0039 data → 9 references
registered, rows untouched).

## S-C1 — parent-account cabinet tokens

**Fix.**
- Cabinet tokens minted by `POST /portal/auth/parent-account` carry `parentUserId`.
- `PortalAuthGuard` requires the guardian link and an ACTIVE membership on every
  request. Chat streams re-check the same on every heartbeat.

**Evidence.** `backend/test/chat.e2e-spec.ts` "a parent account writes as itself;
unlinking ends that cabinet": after `DELETE /students/:id/guardians/:user`, the same
token gets 401 for reads and sends.

## S-D1 — timetable double booking

**Fix.** `ScheduleService.createSchedule/updateSchedule` take advisory locks inside one
transaction with the write, in the order teacher → room → group. The keys are the same
ones lead trials and make-up sessions use.

**Evidence.** `backend/test/schedule-race.e2e-spec.ts`, 3 tests (three groups book one
teacher at once, two groups one room, two moves into one slot).
- With the old service, 3 runs gave 2, 2 and 3 failures (double bookings).
- With the fix: 3/3 pass.

## S-D2 — cash closing above int4

**Fix.** Migration 0045 changes `expected_cash`, `counted_cash` and `difference` to
bigint (exact widening).

**Evidence.**
- `audit-hardening.e2e-spec.ts` "a day's cash past 2^31 so'm can be counted and
  closed": 2 × 1.2 bn cash → closed, the stored difference is exact.
- An int4 column refuses 2,400,000,000 with `integer out of range`, shown directly in
  PostgreSQL.

## New surfaces added by the features (reviewed in this sprint)

| Surface | Control | Test |
|---|---|---|
| Custom-field definitions | OWNER/ADMIN only; tenant-scoped ids → 404 across centers | custom-fields.e2e |
| Custom-field values | Through student/lead routes and their permissions (teacher scope kept); unknown/archived ids refused | custom-fields.e2e |
| Exports | Formula injection guard on every text cell (students, payments) | custom-fields.e2e (export test) |
| Make-up routes | Access catalog keys `makeups.view/manage/attend`, `lessons.cancel`; a teacher marks only their lessons; cross-tenant ids → 404 | makeups.e2e, staff-access.e2e |
| ICS feeds | 32-byte keys, SHA-256 stored only, rotation, re-check on every fetch (membership, role, teacher, guardians, PIN), key redacted in logs | calendar.e2e, log-redact.spec |
| Google OAuth | One-time hashed state (10 min) + PKCE; identity from the state only; tokens AES-256-GCM; least-privilege scopes; disconnect deletes only own events | calendar.e2e (mock), calendar.spec |
| Chat | Actor from the session; access computed live on every read, send and stream event; ids grant nothing (404); per-sender idempotency; 2000-character limit; 30/min sends; bodies not logged or audited; streams closed on revocation | chat.e2e |

## Not verified here

- Real Google OAuth / Calendar API: **BLOCKED**. No client credentials, and
  `accounts.google.com` is outside this environment's network policy. The integration
  runs against an in-memory mock with Google's id and error semantics.
- A multi-instance chat fan-out over PostgreSQL NOTIFY was exercised with one API
  process (LISTEN/NOTIFY runs through the real database). Two processes were not run.
