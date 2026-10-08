# Four features sprint — specification and decisions (2026-10-08)

Base: `dev` @ `fc4149b` (CI run 95 green). Work branch: `claude/admiring-goldberg-jkri02`
(local commits only). This file records what the code looked like before the
sprint, the decisions taken, and the acceptance criteria each workstream is
verified against.

## 0. Current architecture (inspected, not assumed)

**Lessons.** There is no table of dated lesson occurrences.
- `groups` carries the weekly rule: `scheduleDays` (comma list, Uzbek or MON..SUN names,
  `common/weekdays.ts`), `startTime`/`endTime` text, `maxStudents`, `monthlyPrice`.
- `schedules` rows: `dayOfWeek` (1-7) for weekly rows, `date` (YYYY-MM-DD) for one-off
  rows, `isRecurring`, `status` SCHEDULED|CANCELLED|COMPLETED, `teacherId`, `roomId`,
  `branchId`.
- `GroupsService.syncWeeklyLessons` deletes and re-inserts a group's weekly rows on
  every group edit. `schedules.id` is therefore not stable.
- A dated occurrence is identified only implicitly, as `(groupId, date)`. That is the
  key of `attendance`, `lesson_topics` and `teacher_attendance`.
- There is no per-date cancellation or exception. `status=CANCELLED` on a weekly row
  cancels every week.

**Attendance.**
- `attendance(studentId, groupId, date)` is unique. Status is the enum
  PRESENT|ABSENT|LATE. The DTO also allows EXCUSED, but the enum lacks it, so such a
  write fails at the database.
- Marks are written with `onConflictDoUpdate`, without a transaction.
- Teachers may mark only their own group, and only students with an ACTIVE enrollment.

**Conflicts.**
- `ScheduleService.findConflicts` loads the tenant's schedules into memory. It is
  check-then-insert: no transaction, no lock, no database constraint.
- Lead trials use advisory locks (`pg_advisory_xact_lock(hashtext('trial:t:…'))`) in a
  transaction. That pattern is reused for make-up sessions.

**Billing.** Monthly per group (`invoices.forMonth`, `groups.monthlyPrice`). Attendance
never affects billing.

**Payroll.** `SalaryService.calculatePayroll`:
- PER_LESSON counts planned weekly and one-off schedule occurrences of the teacher's
  groups, minus `teacher_attendance` absences, plus substitutions.
- Student attendance is never counted.

**Timezone.** `tenants.timezone` (default Asia/Tashkent). Server helpers live in
`common/timezone.ts` (`zonedParts`, `zonedTimeToUtc`); the frontend mirror is
`lib/center-time.ts`. Lesson times are wall-clock strings.

**Portal identity.**
- The cabinet JWT is student-scoped: `{sub: studentId, studentId, tenantId, role: 'STUDENT', viewer: 'student'|'parent'}`.
- It is obtained by:
  - a phone + per-student PIN, where `viewer` = parent when the phone matched
    `parentPhone`;
  - a Telegram link;
  - a PARENT user account: `POST /portal/auth/parent-account` mints one cabinet token
    per guardian-linked child.
- Revocation: the token dies when the PIN is re-issued (`iat < pin.updatedAt`) or the
  student is deleted.
- Before this sprint, a cabinet token minted for a parent account was **not** tied to
  the guardian link, so it survived unlinking for 30 days.
- A cabinet session does not identify a unique human.

**Staff identity.**
- The JWT carries `{sub, tenantId, role, sid}`.
- `JwtStrategy` re-reads the session row and the ACTIVE membership on every request
  (role and access list come from the database).

**Uploads.**
- Files are served from a flat `backend/uploads` directory by `useStaticAssets('/uploads')`,
  with no auth. The database stores bare names (`<cuid>.<ext>`).
- Writers:
  - homework attachment;
  - generated homework PDF;
  - portal homework submission;
  - exam material;
  - tenant logo (public);
  - site gallery images (public);
  - mock-test assets (JSON inside `mock_tests.content`);
  - mock import files (`mock_imports.files`);
  - speaking recordings (`mock_attempts.answers`).
- The frontend renders everything through `fileUrl(name)` → `/uploads/<name>` in
  `<img>`, `<audio>` or `<a>` tags. Bearer tokens live in localStorage and there are
  no cookies, so a plain GET cannot authenticate.
- nginx proxies `/uploads/` to the backend with `Cache-Control: public` for 30 days.

**Realtime.** None: no WebSocket, SSE or event bus beyond the admissions EventEmitter.

**Audit.** `AuditService.log(tenantId, userId, action, entityType, entityId, meta)`, called
explicitly and fire-and-forget.

**Access catalog.**
- `access/catalog.ts` lists every staff route that configurable roles
  (MANAGER/RECEPTIONIST/ACCOUNTANT/TEACHER) can reach.
- `test/staff-access.e2e-spec.ts` fails if a new route reachable by those roles is
  neither in the catalog (with a template equal to `@Roles`) nor on its FIXED list.
- Every key needs a `perm.<key>` label in UZ/RU/EN.

**Exports.** `export.service.ts` has no formula-injection protection; only the leads CSV
has it. Import supports teachers, groups and students, with declared columns.

**None of the four features existed before the sprint.**
- No custom-field, make-up, calendar or chat tables or modules.
- `PortalMessages` shows announcements only.
- `past-lessons.ts` calls an off-timetable attendance mark "a make-up lesson" (display
  text only).

## 1. Shared decisions

### Lesson occurrence identity
- `(tenantId, groupId, date)` with the group's weekly start and end, or a one-off
  `schedules` row `(scheduleId, date)`.
- Weekly occurrence UID: `grp-<groupId>-<date>`. It is stable across time, teacher or
  room edits.
- One-off UID: `one-<scheduleId>`.
- Make-up booking UID: `mk-<bookingId>`.

### Per-date cancellation
- New table `lesson_cancellations(tenantId, groupId, date, reason, cancelledByUserId)`,
  unique `(groupId, date)`. Staff cancel one occurrence of a group's weekly lesson.
- Feeds and Google show it as cancelled. Students enrolled that day become eligible for
  a make-up credit.
- Restoring the lesson deletes the row. Only possible while no credit was issued for it.

### Authorization
- Every new route is in the access catalog with a template that equals its `@Roles`.
- New keys:
  - `customFields.manage` (no configurable role by default; owner/admin);
  - `makeups.view` (ALL);
  - `makeups.manage` (M, R);
  - `makeups.attend` (T);
  - `lessons.cancel` (M);
  - `calendar.own` (ALL);
  - `chat.use` (ALL);
  - `chat.center` (M, R).
- Services still apply their own scope rules (teacher → own groups).

### Audit
- New writes log ids and statuses only.
- Never message bodies, tokens or OAuth codes.

### Configuration
All new variables are optional and documented in `.env.production.example`.
- **`PUBLIC_API_URL`**: ICS links. Falls back to `FRONTEND_URL` + `/api`.
- **`FILE_URL_SECRET`**: signed file URLs. Falls back to an HMAC of `JWT_SECRET`.
- **Google Calendar:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- **`CALENDAR_TOKEN_KEY`**: 32-byte base64 key that encrypts OAuth tokens at rest.
- **`CALENDAR_SYNC_MS`**: interval of the sync poller.

## 2. Security A — outbound webhook URLs

**Defect (reproduced).**
- `new URL('http://[::ffff:127.0.0.1]/')` normalises the host to `::ffff:7f00:1`.
- The old `ipv6Blocked` only matched the dotted mapped form, so it accepted the URL.
  The same applies to `::ffff:a9fe:a9fe` (169.254.169.254), NAT64 `64:ff9b::/96`,
  6to4 `2002::/16`, IPv4-compatible `::a.b.c.d` and site-local `fec0::/10`.
- Delivery then used `fetch`, which resolves the name again, so a DNS answer could
  change between the check and the connection (rebinding).
- `WEBHOOK_ALLOW_PRIVATE` was honoured in production.

**Fix.**
- **Address parsing:** IPv6 is parsed into 8 groups. The embedded IPv4 decides for the
  mapped, NAT64 and 6to4 forms.
- **Allowed ranges:**
  - IPv6: only global unicast `2000::/3`, excluding `2001::/23`, `2001:db8::/32` and
    `3fff::/20`.
  - IPv4: the existing private, link-local, CGNAT and multicast blocks, plus the
    documentation and relay ranges.
- **Delivery (`postToPublicUrl`):** `http(s).request` with a `lookup` that resolves,
  checks every answer and hands exactly those addresses to the socket. The check and
  the connection share one answer.
  - TLS `servername` stays the URL host, so certificate verification is unchanged.
  - `agent: false`, so no connection is reused.
  - Redirects are not followed.
  - One timeout covers check, resolution, connection and response head.
  - The response body is not read.
- **Private targets:** allowed only when `WEBHOOK_ALLOW_PRIVATE=true` and
  `NODE_ENV !== 'production'`.
- **Logs:** they carry only scheme and host (`urlForLog`).

**Acceptance.**
- Unit tests fail on the old code and pass on the new.
- Fixture tests: no request reaches a 127.0.0.1 receiver in these cases:
  - private answer;
  - rebinding (public then private answer);
  - redirect target;
  - self-signed TLS.
- Two timeout tests.

## 3. Security B — private attachments

**Model.** Table `file_objects(name PK, tenantId, kind, visibility PUBLIC|PRIVATE, ownerId, studentId, createdAt)`.
- **Writers:** every upload writer registers its file.
- **Backfill:** a migration registers every file already referenced by
  `homework.attachment_path`, `homework_completions.submission_attachment_url`,
  `exams.material_path`, `tenants.logo_url`, `tenants.site_content.gallery`,
  `mock_tests.content` (`audioPath`/`imagePath`), `mock_imports.files` and
  `mock_attempts.answers` (speaking audio).

**Public files** (logo, site gallery):
- Served at `/uploads/<name>` as before.
- The static handler is replaced by a route that serves only `visibility=PUBLIC` names.
  Everything else gets 404, so an old private URL stops working.

**Private files** are served only through `GET /api/files/<name>?e=<expiry>&s=<hmac>`.
- The signature is HMAC-SHA256 over `name|expiry` and lives 15 minutes.
- `Cache-Control: private, max-age=…`.

**Signing** (`POST /api/files/sign`, `POST /api/portal/files/sign`) checks that the caller
may see the owning record:

| Kind | Staff | Cabinet |
|---|---|---|
| homework attachment | tenant staff with homework access; a teacher only for own groups | student enrolled in the homework's group |
| homework submission | same staff rule | that student only |
| exam material | staff only (teacher: own groups) | — |
| mock asset | staff with mock-test access | student who can open that test |
| mock import file | staff with mock-test access | — |
| speaking recording | staff with mock-test access | that student only |

**Frontend.** `fileUrl()` callers move to a signed-URL hook. Public logo and gallery keep
plain URLs.

**nginx.** `/uploads/` loses `Cache-Control: public` and the 30-day expiry.

**Acceptance.** Each of the following gets 401 or 403 from signing and cannot fetch
without a valid signature:
- anonymous;
- the other tenant;
- an unassigned teacher;
- an unrelated cabinet or parent.

Also: an expired or tampered signature gets 403; the public logo still loads
anonymously; existing homework and exam attachments still open for authorized users.

## 4. Custom fields (students, leads)

**Tables.**
- `custom_field_definitions(id, tenantId, entityType STUDENT|LEAD, key, label, fieldType, required, sortOrder, options jsonb [{id,label,archived}], portalVisible, studentFieldId, optionMap jsonb, archivedAt, createdAt, updatedAt)`
  - `fieldType`: TEXT|LONG_TEXT|NUMBER|DATE|BOOLEAN|SELECT|MULTI_SELECT.
  - Unique `(tenantId, entityType, key)`.
- `custom_field_values(tenantId, definitionId, entityId, value jsonb, updatedAt, updatedByUserId)`
  - Unique `(definitionId, entityId)`.
  - One row per field, so concurrent edits of different fields never overwrite each
    other.

**Values.**
- **Encoding:** each value is stored as typed JSON:
  - text and date as strings;
  - number as a finite number;
  - boolean as true/false;
  - SELECT as an option id;
  - MULTI_SELECT as an array of option ids.
- **Missing values:** a missing value has no row.
- **Empty values:** `""`, `false`, `0` and `[]` are stored as given, so they stay
  distinct from missing.

**Rules.**
- **Required fields.** Enforced on create, and on update for any field the request
  supplies.
  - A required value may not be "", [] or null; `false` is a valid answer.
  - Records created before a field became required stay editable. The UI shows
    "required — missing" and asks for the value on the next edit of that field.
- **Type changes.** Allowed only while the field has no values; otherwise 409 (archive
  it and create a new field).
- **Options.** They have stable server-generated ids. Renaming a label keeps the id;
  removing an option that is in use archives it.
- **Archiving.** Archived fields keep their values: hidden from forms, still exported
  with an "(archived)" header, restorable.

**Limits.**

| What | Limit |
|---|---|
| active fields per entity | 30 |
| options per field | 50 |
| label | 80 chars |
| key | `[a-z][a-z0-9_]{0,39}` |
| text value | 500 chars |
| long text value | 5000 chars |
| number | absolute value ≤ 1e12 |
| date | YYYY-MM-DD |
| multi-select picks | ≤ 50 |

**Permissions.**
- **Definitions:** managed by OWNER/ADMIN (`customFields.manage`, no default for other
  roles). Any staff member may list them to render forms.
- **Values:** read and written through the existing student and lead routes. They follow
  `students.view/edit`, `leads.view/edit` and the teacher scope.
- **Portal:** never shows fields unless `portalVisible` (students only, read-only).

**Lead → student conversion.**
- A lead field maps to a student field only through an explicit `studentFieldId` of the
  same type. Labels are never matched.
- Select options are translated by the explicit `optionMap`.
- The convert request may override any student field.
- A mapped value that cannot be translated fails the conversion with 400 and names the
  field. It is never silently dropped.

**Export and import.**
- `students.xlsx` gets a column per student field.
- Every exported string cell is guarded against formula injection: a leading
  `= + - @ \t \r` gets a `'` prefix.
- Student import accepts custom-field columns by label or `cf:<key>`, with the same
  validation.

**Acceptance (task scenario).** For tenant A:
1. Create a required SELECT field on leads, and a student field it maps to.
2. Create a lead with the value.
3. Convert the lead and see the mapped student value.
4. Edit the value and reload.
5. Archive the definition.

Tenant B gets 404 for the definition and value routes and cannot list either.

## 5. Make-up lessons and lesson credits

**Tables.**
- `makeup_credits`:
  - columns: `id, tenantId, studentId, originGroupId, originDate, reason ABSENT|LESSON_CANCELLED, status ISSUED|BOOKED|USED|FORFEITED|CANCELLED, note, issuedByUserId, issuedAt, expiresAt, closedAt, closedByUserId`;
  - partial unique index on `(studentId, originGroupId, originDate)` where
    `status <> 'CANCELLED'`. One missed occurrence can never have two live credits.
- `makeup_bookings`:
  - columns: `id, tenantId, creditId, studentId, mode GROUP_LESSON|SESSION, targetGroupId, date, startTime, endTime, teacherId, roomId, branchId, status BOOKED|ATTENDED|MISSED|CANCELLED, createdByUserId, markedByUserId, markedAt, cancelledAt`;
  - partial unique on `(creditId)` where `status IN ('BOOKED','ATTENDED')`.
- `tenants.makeup_credit_days` (nullable): expiry policy. Null means no expiry.

**Workflow.**
1. **Eligibility.** For an ABSENT mark on (student, group, date), or a
   `lesson_cancellations` row for (group, date) with the student enrolled then.
2. **Issue.** Done by staff with `makeups.manage`. Never automatic.
3. **Book.**
   - GROUP_LESSON: a seat in another (or the same) group's lesson on a date when it
     runs. Capacity counts `maxStudents` against ACTIVE enrollments plus that date's
     booked make-ups.
   - SESSION: a dedicated make-up session with teacher, room and time. It is checked
     against `ScheduleService.findConflicts` and other sessions.
4. **Attendance.** The teacher of the target lesson or session (or staff) marks the
   booking ATTENDED or MISSED.
5. **Completion.** ATTENDED makes the credit USED. MISSED makes it FORFEITED.

**Concurrency.** One transaction, with advisory locks on:
- the credit;
- the student;
- the teacher and the room (session);
- the target group and date.

The credit row is taken `FOR UPDATE` and status changes are conditional
(`WHERE status = 'BOOKED'`). Two concurrent books or marks therefore cannot both
succeed. The partial unique indexes back this up.

**Policies.**
- **Cancel a booking:** the credit returns to ISSUED (released).
- **Forfeited credit:** staff may reinstate it to ISSUED, explicitly and audited.
- **Void credit:** staff may cancel an ISSUED credit (CANCELLED), which frees the
  original occurrence for a new credit.
- **Expiry:** an expired credit (past `expiresAt`) cannot be booked.
- **No cash value.** No invoice, payment or ledger change.
- **Payroll unchanged.** Make-up sessions are not added to teacher payroll
  automatically; pay adjustments stay separate.
- **History preserved.** The original ABSENT attendance row is never changed, and
  enrollments are untouched.

**Substitute teacher.**
- A teacher assigned to a session, or teaching the target group, sees that booking with
  the student's name only.
- They can mark that booking only, and gain no access to the original group or the
  student's profile.

**Visibility.**
- Staff: the make-up screen.
- Teacher: their make-up roster.
- Portal: the student/parent sees credits, upcoming make-ups and calendar events.
- ICS/Google: one event per booking (`mk-<bookingId>`), shown as cancelled when
  cancelled.

**Acceptance.**
- Issue and book.
- A duplicate issue is refused with 409.
- An unauthorized or cross-tenant book is refused with 403/404.
- Two parallel books on one credit: exactly one 201. Two parallel attended marks:
  exactly one success. The credit is USED once.
- Cancelling the booking puts the credit back to ISSUED.
- The calendar shows the booking once.
- Payroll output is identical before and after.

## 6. Calendar

### ICS subscriptions (live, read-only)

**Table.** `calendar_feeds(id, tenantId, scope TEACHER|STUDENT|PARENT|CENTER, userId?, studentId?, tokenHash, tokenHint, createdAt, revokedAt, lastFetchedAt)`.
- The token has 32 random bytes and only its SHA-256 hash is stored.
- Rotating revokes the old feed.

**URL.** `<PUBLIC_API_URL>/calendar/feed/<token>.ics`. The path is redacted in request
logs.

**Who may fetch.** Access is re-checked on every fetch:

| Scope | Requirement |
|---|---|
| user feeds | membership ACTIVE |
| TEACHER | the user is still linked to a teacher |
| PARENT | the current guardian links |
| STUDENT | student not deleted, and feed created after the last PIN issue |
| CENTER | role still OWNER/ADMIN/MANAGER |

**Events.**
- Window: 30 days back to 120 days ahead. Individual occurrences, no RRULE, UTC times
  (correct whatever the client's timezone).
- Cancelled occurrences and bookings stay in the feed with `STATUS:CANCELLED`.
- Event text: group/subject name, room, teacher. No other students, no money. A
  teacher's make-up session shows the one student's name.
- RFC 5545 escaping and line folding, CRLF.
- Refresh timing is up to the subscribing client (Google refreshes roughly every 8–24
  hours).

### Google Calendar (outbound only)

**OAuth.**
- Authorization-code flow with PKCE and a one-time `state` row (hash, 10 minutes).
- Scopes are least-privilege: `calendar.events` + `calendar.calendarlist.readonly`, the
  latter only to offer target-calendar selection.
- Tokens are AES-256-GCM encrypted with `CALENDAR_TOKEN_KEY`.
- The user and tenant come from the state row, never from the callback query.

**Sync.**
- The desired events are the user's feed events (same generator).
- `calendar_event_links(connectionId, eventKey, googleEventId, calendarId, hash)`.
- The Google event id is deterministic (base32hex of sha256 of
  connection + eventKey), so a retried insert cannot create a duplicate (409 means it
  already exists, and it is patched).
- Changed hash → patch. Gone or cancelled → event deleted.

**Durability.**
- `calendar_connections.syncRequestedAt / nextAttemptAt / attempts / lastError / status ACTIVE|NEEDS_RECONNECT`.
- Schedule, group, cancellation and make-up writes mark the tenant's connections
  dirty in the database.
- A poller syncs dirty connections and also does a periodic full reconcile.
- A restart loses nothing.

**Failure handling.**
- **429/5xx:** exponential backoff of 1 minute × 2^n, capped at 1 hour.
- **invalid_grant / 401 after refresh:** NEEDS_RECONNECT, shown in the UI.

**Disconnect.**
- Deletes only events recorded in our link table and revokes the token.
- Never touches other events.

**Not offered (documented in the UI):**
- inbound sync: Google edits never change CRM lessons;
- two-way sync;
- Google sync for cabinet (PIN) sessions: they use ICS.

**Testing.** Mocked provider client in unit/e2e tests. A live Google check is BLOCKED
without credentials.

## 7. Two-way human chat

**Participants.**
- Staff users.
- The student's cabinet: one participant per student, with `viewer` student/parent
  recorded per message. When the cabinet session came from a parent account, the
  parent's user id and name are recorded too.
- PIN cabinets do not identify a unique human, and the UI says "from <student>'s
  cabinet (parent)". Cabinet tokens minted for a parent account now carry
  `parentUserId`, and the portal guard re-checks the guardian link on every request.

**Conversations.**
- `chat_conversations(id, tenantId, kind STUDENT_CENTER|STUDENT_TEACHER|GROUP, studentId?, teacherUserId?, groupId?, createdAt, lastMessageAt)`.
- Unique per `(tenant, kind, studentId, teacherUserId)` and per `(tenant, groupId)`.
- STUDENT_CENTER:
  - members: staff with `chat.center` (OWNER/ADMIN always) and the student's cabinet;
  - started by: staff, or the cabinet.
- STUDENT_TEACHER:
  - members: the teacher user, while the student has an ACTIVE enrollment in one of
    their groups, and the cabinet;
  - started by: the teacher, or the cabinet (only its own current teachers).
- GROUP:
  - members: the group's teacher and the cabinets of actively enrolled students;
  - started by: the teacher or OWNER/ADMIN.
- **Administrator access is explicit.**
  - OWNER/ADMIN read and write center conversations.
  - They can read teacher and group conversations (read-only, for safeguarding).
  - The chat header tells participants this.
  - Nobody else gets implicit access.

**Messages.**
- `chat_messages(id, tenantId, conversationId, seq bigserial, senderType USER|CABINET, senderUserId?, senderStudentId?, senderViewer?, senderName, body ≤ 2000, clientMessageId, createdAt)`.
- Unique `(conversationId, senderKey, clientMessageId)`: a retried send returns the
  original message.
- Ordering is by `seq`. Cursor pages use `before` and `after`.
- `chat_reads(conversationId, participantKey, lastReadSeq)`. Unread means
  `seq > lastReadSeq` and not sent by me.

**Delivery.**
- A fetch-streamed SSE endpoint per auth family: `/api/chat/stream`,
  `/api/portal/chat/stream`. It carries a bearer header, never a token in the URL.
- Events carry `{conversationId, seq}` only. The client then fetches the messages,
  which re-checks access.
- Server fan-out uses PostgreSQL `LISTEN/NOTIFY`, so it works with several API
  instances.
- On every event and every 25-second heartbeat, the stream re-validates the caller:
  - staff: session row and ACTIVE membership;
  - cabinet: student, PIN and guardian link.
- A revoked caller gets the stream closed. An event for a conversation the caller can
  no longer access is not sent.
- Reconnect re-reads the unread counts and fetches `after=lastSeq`.

**Safety.**
- Sender identity comes from the token.
- Access is computed from live enrollments, guardians, memberships and teacher links
  on every call. A conversation id alone grants nothing (404).
- Bodies are plain text, rendered as text.
- Sends are throttled to 30 per minute.
- Message bodies are never logged or audited (conversation creation is audited).
- Announcements stay announcements.
- No attachments in this sprint.

**Acceptance.**
- Two fresh accounts in two browser contexts exchange messages.
- After a reload, history and unread counts persist.
- A retried send with the same clientMessageId does not duplicate.
- Unenrolling the student (or unlinking the guardian) makes the next read, send and
  stream event fail.
- Cross-tenant ids give 404.
