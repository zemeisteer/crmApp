# Admissions & Sales CRM — Sprint Report

Sprint: Leads, Pipeline, Follow-ups, Trial Lessons & Student Conversion
Branch: `dev` (base commit `189fbc7`) · Date: 2026-09-24

---

## 1. Executive Summary

The admissions domain was rebuilt on top of the existing `leads` module. It was not written as a parallel module. It now has:

- a single, centralized lifecycle policy;
- an append-only timeline;
- first-class trial lessons that reuse the schedule conflict engine;
- per-tenant duplicate protection enforced **by the database**;
- validated manager assignment;
- follow-up queues with a `LeadFollowUpDue` emitter;
- an atomic, idempotent Lead → Student conversion (optional enrollment and first invoice go through the existing Enrollment model and `InvoicesService`);
- archive instead of hard delete;
- permission-based RBAC (`admissions.*`);
- snapshot and cohort funnel analytics with explicit denominators;
- a CSV export;
- a new frontend: list, pipeline, profile and a 6-step conversion wizard, in UZ/RU/EN.

The mandatory audit found three pre-existing blocking defects, all fixed with regression coverage:

- conversion was non-atomic and race-prone;
- conversion wrote tenant-less, capacity-unchecked enrollments;
- the versioned migration chain was missing 5 tables and 16 columns, so `db:migrate` could not build a working production DB.

It also found one project-wide timezone defect. That one is documented and contained for admissions, not fixed globally.

**Results**
- Backend unit: **140/140**.
- Backend E2E: **71/71**, including all **25/25** mandatory admissions cases.
- `nest build`, `next build` and `tsc` are clean; lint has 0 errors in both apps.

The frontend was verified by typecheck, lint and production build. It was **not** clicked through in a browser in this sprint (see §28).

---

## 2. Architecture Before vs After

| Area | Before | After |
|---|---|---|
| Module | `LeadsService` (662 lines, CRUD + convert) | `LeadsService` (profile, lifecycle, assignment, follow-ups, activities, archive, analytics, export), `LeadTrialsService`, `LeadConversionService`, `AdmissionsEventsService`, `LeadFollowUpScanner`, pure `lead-lifecycle.ts` and `phone.ts` |
| Status changes | Any status via `PATCH` | `POST /transition` checked against one policy; trial, loss and enrollment use dedicated flows |
| Authorization | `RolesGuard` (SUPERADMIN/ADMIN/TEACHER); OWNER passed implicitly; MANAGER/RECEPTIONIST locked out | `PermissionsGuard` + `admissions.*`; tenant always from the JWT |
| Delete | Hard `DELETE` | Archive/restore (soft), audited; `DELETE` now archives |
| Trials | `trial_date` / `trial_group_id` columns | `lead_trials` table with its own status machine and conflict checks |
| Timeline | none | `lead_activities` (append-only) |
| Conversion | Sequential writes, no transaction, no lock | One transaction, `SELECT … FOR UPDATE` on the lead and on groups; idempotent |
| Duplicates | none | Normalized phone/email with partial unique indexes per tenant |
| Events | none | `AdmissionsEventsService` (in-process bus, logs and tenant webhooks) |
| Public site form | Direct `insert(leads)` | `LeadsService.createFromPublicForm` (same normalization and dedupe) |
| Frontend | One 1246-line page, client-side filtering | Server-paginated list, pipeline board, profile page and conversion wizard |

---

## 3. Existing Functionality Reused

- **`ScheduleService.findConflicts`** handles teacher/room clashes for trial lessons (differences in §13).
- **`InvoicesService.create`** creates the optional first invoice. I added an optional `tx` argument so the invoice joins the conversion transaction; this is backward compatible, and every existing caller is unchanged.
- **`enrollments`** (unique on student and group) is used for enrollment, with reactivation of an inactive row.
- **`AuditService.log`** is used for security-relevant actions.
- **`WebhooksService.dispatch`** is the outbound event channel.
- **`getEffectivePermissions` and `PermissionsGuard`** had not been used by any controller before this sprint.
- **`organization_memberships`** is the source of truth for manager eligibility.
- Existing UI components are reused: `Modal`, `Select`, `MultiSelect`, `DatePicker`, `TimePicker`, `MonthPicker`, `Pagination`, and `i18n` `t()`.

---

## 4. Files Changed

**Backend — new**
- `src/leads/lead-lifecycle.ts` — transition policy, statuses, sources and lost reasons
- `src/leads/phone.ts` — phone/email normalization and log masking
- `src/leads/admissions-events.service.ts` — event boundary
- `src/leads/lead-trials.service.ts` — trial booking, reschedule, attend, miss, cancel, conflicts
- `src/leads/lead-conversion.service.ts` — atomic conversion
- `src/leads/lead-follow-up.scanner.ts` — periodic `LeadFollowUpDue`
- `src/leads/lead-lifecycle.spec.ts`, `phone.spec.ts`, `lead-conversion.service.spec.ts`
- `test/admissions.e2e-spec.ts` — the 25 mandatory cases
- `drizzle/0002_core_schema_catchup.sql`, `drizzle/0003_admissions_crm.sql`
- `scripts/apply-sql-migration.cjs` and the npm script `db:apply-sql`

**Backend — modified**
- `src/leads/leads.service.ts`, `leads.controller.ts`, `leads.module.ts`, `dto/lead.dto.ts`, `leads.service.spec.ts` (see §24)
- `src/db/schema.ts` — lead columns, 3 enums, 2 tables, relations
- `src/common/permissions.ts` — 8 `admissions.*` permissions
- `src/invoices/invoices.service.ts` — optional `tx` parameter
- `src/tenants/tenants.service.ts`, `tenants.module.ts` — public form goes through `LeadsService`
- `drizzle/meta/_journal.json` — 0001 (previously missing), 0002 and 0003 added
- `package.json` — `db:apply-sql`

**Frontend**
- New: `app/leads/[id]/page.tsx`, `components/leads/{lead-ui.tsx, LeadFormModal.tsx, ConvertWizard.tsx}`
- Rewritten: `app/leads/page.tsx`
- Modified: `lib/api.ts` (lead types and `leadsApi`; `ApiError.body` added additively), `lib/auth-context.tsx` (mirrors the admissions role permissions), `lib/i18n.ts` (~190 `adm.*` keys in UZ/RU/EN), `app/globals.css` (responsive `adm-*` classes)

---

## 5. Database Changes

- **`lead_source`:** `RECOMMENDATION` → `REFERRAL` and `BANNER` → `ADVERTISEMENT` (renamed in place, so existing rows follow), plus `PHONE`.
- **New enums:** `lead_lost_reason`, `lead_activity_type`, `lead_trial_status`.
- **`leads` renames (data preserved):** `parent_phone` → `secondary_phone`, `branch_id` → `preferred_branch_id` (FK recreated with `ON DELETE SET NULL`), free-text `lost_reason` → `lost_note`.
- **`leads` new columns:** `phone_normalized`, `email`, `email_normalized`, `desired_subject_id`, `desired_course_id`, `assigned_manager_user_id`, `follow_up_at`, `follow_up_notified_at`, `lost_reason` (enum), `lost_at`, `converted_at`, `duplicate_of_lead_id`, `archived_at`, `created_by_user_id`.
- **Kept as legacy, non-authoritative, never written by the API:** `subject` (`legacySubject`), `trial_date`, `trial_group_id`.
- **New tables:** `lead_activities` and `lead_trials`.
- **Indexes:**
  - `(tenant, status)`, `(tenant, follow_up_at)`, `(tenant, manager)`, `(tenant, created_at)`;
  - partial unique indexes `leads_tenant_phone_active_uniq` and `leads_tenant_email_active_uniq` on `(tenant_id, *_normalized)` where the lead is not archived and not an explicit duplicate. Both are per tenant; there is no global uniqueness;
  - `lead_trials_one_booked_per_lead` (unique on `lead_id` where status is `BOOKED`).

---

## 6. Versioned Migration(s)

| File | Purpose |
|---|---|
| `0002_core_schema_catchup.sql` | **Pre-existing gap fix.** `subjects`, `courses`, `invitations`, `organization_memberships` and `student_guardians`, plus 16 columns on `branches`, `enrollments`, `groups`, `students`, `tenants` and `users`, existed only through `db:push`. A production DB built by `db:migrate` (the SETUP.md procedure) would have lacked the membership tables that login needs. The DDL was generated from `schema.ts` with drizzle-kit's API against a fresh 0000+0001 database and made idempotent. |
| `0003_admissions_crm.sql` | Admissions schema and backfill. |

**Properties**
- Both migrations are hand-finalized and idempotent (`IF NOT EXISTS`, `DO … EXCEPTION WHEN duplicate_object`, guarded renames).
- Nothing is dropped. Existing lead data is preserved and backfilled:
  - normalization (the SQL mirrors `normalizePhone`);
  - `LOST` → reason `OTHER` with `lost_at`;
  - `ENROLLED` → `converted_at`;
  - subject text → `desired_subject_id` only when exactly one subject in the tenant matches;
  - legacy trial dates → `lead_trials`;
  - pre-existing same-tenant duplicates → linked to the oldest lead through `duplicate_of_lead_id`, so the unique indexes can be built without deleting or hiding any row.

**Verification**
- Fresh empty DB: 0000 → 0001 → 0002 → 0003, then 0002 and 0003 re-applied, all succeeded. A programmatic comparison of every table, column and index against `schema.ts` found **zero drift**.
- Dev DB (built by push): legacy-shaped rows were seeded (three phone formats, `BANNER`/`RECOMMENDATION`, a free-text lost reason, a legacy trial). 0003 was applied twice. Renames, normalization, duplicate linking and trial backfill were all confirmed, then the seed rows were removed.
- `_journal.json` now lists 0000–0003. 0001 was never journaled before this sprint.
- For push-created databases, use `npm run db:apply-sql -- drizzle/000N_*.sql`, because `drizzle-kit migrate` would try to replay 0000.

---

## 7. Lead Domain Model

- **Lead ≠ Student.** A student is created only by `POST /leads/:id/convert`.
- The lead row is never deleted. It keeps `convertedStudentId` and `convertedAt` and stays readable as history.
- Relations are used instead of duplicate authoritative text: subject, course, branch, manager and student are all foreign keys.
- `duplicateOfLeadId` exists only on audited overrides.
- `createdByUserId` is recorded.
- Every API response restricts user relations to `{ id, fullName }`, so no password hash or token column can leak through `with:`.

---

## 8. Lifecycle State Machine

```
NEW → CONTACTED
CONTACTED → TRIAL_BOOKED* | QUALIFIED | LOST*
TRIAL_BOOKED → TRIAL_ATTENDED* | LOST*
TRIAL_ATTENDED → QUALIFIED | LOST*
QUALIFIED → ENROLLED* | LOST*
ENROLLED: terminal
LOST → (reopen, admissions.manage, audited) → CONTACTED
```

\* Dedicated flows:
- `TRIAL_BOOKED` via `POST /trials`;
- `TRIAL_ATTENDED` via `/trials/:id/attend`;
- `LOST` via `/lose`, which requires a reason;
- `ENROLLED` via `/convert`.

`POST /transition` rejects these targets with `400 DEDICATED_FLOW`.

**How it is enforced**
- There is one policy (`lead-lifecycle.ts`), and every path calls `assertTransition`.
- Illegal moves return `409 INVALID_TRANSITION` with the allowed targets.
- `PATCH` with `status` returns `400 STATUS_NOT_EDITABLE`.

**Atomicity**
- Each move takes a row lock (`FOR UPDATE`) and runs a conditional `UPDATE … WHERE status = <validated>`, writing its activity in the same transaction.
- A concurrent loser gets `409 CONCURRENT_UPDATE`.

**Reopen**
- A reopened lead restarts at `CONTACTED`, not `NEW`, so "new leads" counts don't double-count it.
- It clears the live `lost*` columns. The previous reason stays in both the `LOST` and `REOPENED` activities.

---

## 9. Duplicate Detection

- **Phone normalization:** 9 bare digits → `+998…`. Any `+998`, `998…` or `00998…` form → `+998XXXXXXXXX`. Other 8–15-digit numbers → `+<digits>`, so international numbers work. A leading `+` with 9 digits is not reinterpreted as Uzbek.
- **Email:** trimmed and lowercased.
- **Enforcement:**
  - a pre-check returns `409 DUPLICATE_LEAD` with the matches, scoped to the same tenant only;
  - the partial unique index catches races, and its violation is also mapped to `409`;
  - there is no silent merge.
- **Override:** `allowDuplicate` + `duplicateReason`. It requires `admissions.manage`, sets `duplicateOfLeadId` and writes an `AuditLog` entry `duplicate_override`.
- **Editing contact details** re-checks duplicates. There is no override on edit.
- **Restoring an archived lead** whose contact is now in use returns `409`.
- **Public site form:** a repeat application is appended to the existing lead's timeline, with the same response, so nothing leaks.
- **Cross-tenant:** the same phone in another tenant is allowed (E2E #6).

---

## 10. Manager Assignment Rules

- The assignee must have an **ACTIVE** `organization_memberships` row in the caller's tenant with role OWNER, ADMIN, MANAGER or RECEPTIONIST.
- This is checked against the database, not a token.
- A foreign user, an inactive member and a wrong role all get the same `400`, so user existence in another tenant is never confirmed.
- Assigning requires `admissions.assign`, including when setting a manager at create time.
- Reassignment:
  - replaces the manager;
  - writes a NOTE activity with `kind: ASSIGNED` and the from/to users;
  - writes an `assign` or `reassign` audit entry;
  - emits `LeadAssigned`.
- **When a manager leaves**, `assignedManagerUserId` is kept so history stays intact. `GET /leads/:id` returns `assignedManagerActive: false`, the UI shows a reassignment warning, and the `unassigned` / manager filters make these leads findable. There is no automatic reassignment.

---

## 11. Follow-Up Architecture

- `POST /leads/:id/follow-up` accepts a time, or `null` to clear it. Only open statuses can get a new follow-up. Each change records a `FOLLOW_UP_SCHEDULED` activity and resets `follow_up_notified_at`.
- **Queues are computed in the DB and are disjoint**, for open, non-archived leads only:
  - `overdue`: before now;
  - `today`: from now to the end of the Asia/Tashkent day (UTC+5, no DST);
  - `upcoming`: after that.
- Queues are exposed as list filters and through `GET /leads/follow-ups/summary?mine=`.
- **`LeadFollowUpDue`:** `scanDueFollowUps()` claims due rows with one conditional `UPDATE … RETURNING`, so multiple instances never double-emit, and emits the event through the event boundary. It never calls Telegram or email directly.
  - `LeadFollowUpScanner` runs it every `ADMISSIONS_FOLLOWUP_SCAN_MS` (default 5 minutes; `0` disables; off under tests).

---

## 12. Timeline

- `lead_activities` is append-only: the service only ever inserts, and there is no update or delete endpoint.
- Manual types (via `POST /activities`): `NOTE`, `CALL`, `MESSAGE`, `MEETING`. `occurredAt` cannot be in the future.
- System types: `STATUS_CHANGE`, `FOLLOW_UP_SCHEDULED`, `TRIAL_BOOKED`, `TRIAL_ATTENDED`, `CONVERTED`, `LOST`, `REOPENED`. Every stage move records `fromStatus` and `toStatus`.
- Assignment, archive, restore, missed/cancelled trial and public re-application are `NOTE` entries with a `metadata.kind`.
- `leads.notes` (the free profile note) is distinct from timeline activities.
- **Timeline ≠ audit:** `lead_activities` is the sales story; `audit_logs` records security-relevant actions (§18).

---

## 13. Trial Architecture

**Model.** `lead_trials` is a first-class record with branch, subject, course, teacher, group, room, `scheduledAt`, duration and a status of `BOOKED`, `ATTENDED`, `MISSED`, `CANCELLED` or `RESCHEDULED`. Trials never create attendance rows, so student attendance is untouched.

**Booking rules**
- Only from `CONTACTED`, which moves the lead to `TRIAL_BOOKED`, or from `TRIAL_BOOKED` after a missed or cancelled trial.
- At most one `BOOKED` trial per lead, enforced by a unique index (`409 TRIAL_ALREADY_BOOKED`).
- A trial cannot be booked in the past.
- Teacher, branch and course default from the group.
- Everything is validated per tenant; archived subjects/courses and closed groups are rejected.

**Status flow**
- Reschedule marks the old trial `RESCHEDULED` and creates a new `BOOKED` trial linked by `rescheduledFromTrialId`. It is audited.
- `MISSED` and `CANCELLED` keep the lead in `TRIAL_BOOKED`, so staff can rebook or mark the lead lost.
- Losing, archiving or converting a lead cancels its live trial.

**Conflicts.** `ScheduleService.findConflicts` is called with the trial converted to Tashkent wall-clock time. Trial-vs-trial clashes are also checked (same teacher or room, overlapping). Concurrent bookings are serialized with `pg_advisory_xact_lock` per teacher and room. A clash returns `409 TRIAL_CONFLICT` with details.

**Documented differences from lesson scheduling**
1. The trial's own group's lessons never count as conflicts, because sitting in on that lesson is the point.
2. The engine's rule "a one-off lesson on *any* date conflicts with a recurring slot" is narrowed to lessons actually on the trial's date or weekday.
3. Several leads may attend the same group lesson.
4. There is no `allowCollision` bypass for trials.

---

## 14. Conversion Transaction

All of the following runs in **one transaction**:

1. Lock the lead with `SELECT … FOR UPDATE`, scoped to the tenant.
2. **If already `ENROLLED`**, return the original student with `alreadyConverted: true` and no writes. This is idempotent: a concurrent caller waits on the lock, then takes this path.
3. Otherwise check the lead is not archived and assert `QUALIFIED → ENROLLED`.
4. Resolve the student (§15).
5. Enroll in the groups (§16).
6. Optionally create the invoice (§17).
7. Cancel any live trial.
8. Move the lead to `ENROLLED` with `convertedStudentId` and `convertedAt`, recording a `CONVERTED` activity.

**Rollback.** Any exception rolls back everything: student, enrollments, invoice, lead status and activity. E2E #22 (a foreign group) and #23 (the second group full, after the first enrollment and the invoice were already written) prove no partial state remains.

**After commit only:**
- audit entries: `convert`, plus `create student` and `create invoice` when applicable;
- the `student.created` webhook;
- the `LeadConverted` event.

**Guardian.** `guardianPhone` is stored as the student's `parentPhone`. Linking a guardian *user account* stays with the existing `POST /students/:id/guardians`; see §28.

---

## 15. Existing Student Resolution

**Candidates** are non-deleted students in the tenant whose `phone` **or** `parentPhone` normalizes to the lead's phone.

| Mode | Behaviour |
|---|---|
| `AUTO` (default) | No candidates → create a student. Exactly one candidate that is an **exact** match (own phone plus the same name, case- and whitespace-insensitive) → link it. Anything else → `409 STUDENT_MATCH_AMBIGUOUS` with the candidates. |
| `LINK_EXISTING` | `existingStudentId` must belong to the tenant and not be deleted. |
| `CREATE_NEW` | An explicit decision, recorded in the audit meta. |

`GET /leads/:id/student-match` previews the candidates for the wizard.

Linking never modifies the existing student's profile. The sibling case (a parent's number already used as another child's `parentPhone`) is ambiguous by design and requires an explicit choice (E2E #20).

---

## 16. Enrollment Integration

- Uses the existing `enrollments` table and its unique `(student, group)` index. **`tenantId` is always set**; the old convert path omitted it.
- Each group is locked with `FOR UPDATE`.
- Each group must belong to the tenant and not be deleted. `ARCHIVED` and `COMPLETED` groups are rejected.
- An already-`ACTIVE` enrollment → `409 ALREADY_ENROLLED`.
- **Capacity:** if active enrollments ≥ `maxStudents` → `409 GROUP_FULL`. The row lock makes this race-safe.
- An inactive enrollment row is reactivated rather than duplicated.
- At most 5 groups per conversion.

---

## 17. Billing Integration

- The optional first invoice is created **only** through `InvoicesService.create`, inside the conversion transaction. The amount defaults to the first group's `monthlyPrice`, and the invoice is linked to that group's new enrollment.
- The admissions code **never touches** `payments`, `payment_allocations`, `billing_transactions`, gateway providers, Click or Payme.
- E2E #21 asserts an `OPEN` invoice exists and **no** payment exists for the new student.
- The one change inside billing is additive: `InvoicesService.create(tenantId, dto, userId?, tx?)`. When `tx` is passed, the caller writes the audit entry after commit, so a rolled-back conversion leaves no orphan audit row.

---

## 18. Tenant Isolation

- `tenantId` always comes from the verified JWT (`ctx(user)`). No DTO accepts `tenantId`.
- Tenantless tokens (SUPERADMIN) get `403` instead of the previous 500.
- Every ID lookup is scoped to the tenant: lead, trial (also scoped to the lead), group, teacher, room, branch, subject, course, student and membership.
- Foreign IDs return `404` ("not found"), or the generic `400` for assignees, without revealing existence.
- Duplicate checks, analytics, follow-up scans (by tenant) and CSV export are all scoped per tenant.
- Verified by E2E #2, #3, #4 (and trial access in #15), #6, #10, #22 and #25.

**AuditLog entries:** `duplicate_override`, `assign` / `reassign`, `reopen`, `archive`, `restore`, `convert`, `trial_reschedule`, `trial_missed`, `trial_cancel`, `export`.

**Structured logs:** `{op/event, tenantId, leadId, actorUserId}`. Phones appear only masked (`***4567`); events and webhooks carry IDs only.

---

## 19. RBAC

| Permission | OWNER/ADMIN | MANAGER | RECEPTIONIST | ACCOUNTANT / TEACHER / STUDENT / PARENT |
|---|---|---|---|---|
| admissions.read | ✓ | ✓ | ✓ | ✗ |
| admissions.create | ✓ | ✓ | ✓ | ✗ |
| admissions.update (contact, notes, trials, follow-ups, activities, lose) | ✓ | ✓ | ✓ | ✗ |
| admissions.assign | ✓ | ✓ | ✗ | ✗ |
| admissions.convert | ✓ | ✓ | ✗ | ✗ |
| admissions.analytics | ✓ | ✓ | ✗ | ✗ |
| admissions.export | ✓ | ✓ | ✗ | ✗ |
| admissions.manage (duplicate override, reopen, archive/restore) | ✓ | ✓ | ✗ | ✗ |

- The backend is authoritative (`PermissionsGuard`). The frontend mirrors this table only to hide controls.
- Custom per-member permissions still merge in, as before.
- **Behaviour change:** TEACHER lost lead read access (least privilege for prospects' contact details). MANAGER and RECEPTIONIST gained access; they were previously locked out.

---

## 20. Funnel Definitions

`GET /leads/analytics?from&to` (the default window is the last 30 days). The response includes a `definitions` block.

**Snapshot.** The current status of every non-archived lead, whatever its creation date.

**Cohort.** Leads created in `[from, to)`, excluding archived ones.
- A stage counts as *reached* if the current status or any `toStatus` in the activity history equals it; every lead reaches `NEW`.
- Snapshot and cohort are never mixed in one ratio.

**Rates.** Each rate is `{numerator, denominator, rate}`, and `rate` is **`null` when the denominator is 0**, never a misleading 0%.

| Rate | Formula |
|---|---|
| contacted | reached CONTACTED / cohort |
| trialBooked | reached TRIAL_BOOKED / reached CONTACTED |
| trialAttended | reached TRIAL_ATTENDED / reached TRIAL_BOOKED |
| qualified | reached QUALIFIED / cohort |
| **conversion** | currently ENROLLED / cohort |
| lost | currently LOST / cohort |

**Also returned:**
- `bySource`: the conversion rate per source;
- `lostReasons`: counts of cohort leads currently lost, by reason;
- `managers`: factual counts only (assigned, enrolled, lost, open);
- the follow-up summary.

The legacy `GET /leads/funnel` snapshot shape is kept for compatibility and now excludes archived leads.

**Limitation.** Legacy leads have no activity history, so their "reached" stages come from their current status only.

---

## 21. Frontend Changes

**`/leads`**
- Stat cards: open leads, overdue follow-ups and today's follow-ups (both clickable filters), and the 30-day cohort conversion with numerator and denominator in its tooltip.
- Debounced server search.
- Filters: status, source, owner (all / me / unassigned / each manager), follow-up bucket, sort, show archived.
- Server pagination.
- **List view:** a table on desktop and cards on mobile.
- **Pipeline view:** one column per open stage, counts from the snapshot, "+N more" linking into the list. It has quick moves only for data-free transitions, with an optimistic update that **reverts on failure**, plus a toast. There is no drag-and-drop dependency.
- CSV export and new-lead buttons appear only with the matching permission.
- Loading, empty, error-with-retry and no-permission states.

**`/leads/[id]`**
- Header with a `tel:` call link (no automatic call logging; calls are logged manually), SMS (the existing feature, now also logged as a `MESSAGE` activity) and edit.
- Stage actions from `allowedTransitions` and the user's permissions: moves, book trial, convert (only when `QUALIFIED`), mark lost, reopen, archive, restore.
- Banners for archived, converted (links to the student), duplicate-of and inactive owner.
- Cards for details (with inline owner assignment), follow-up, and trials (attend, miss, reschedule, cancel; conflicts shown).
- Timeline with an activity composer.
- Controls are disabled while busy to prevent double submits.

**Create/edit modal**
- Subject → course cascade.
- Owner and follow-up fields on create.
- On `409`: the duplicate panel with links, and an override with reason when the user has `admissions.manage`.

**Conversion wizard, 6 steps:** Review → Student match (link / create new; pre-selects a single exact match) → Details → Groups → Invoice → Confirm.
- Submitting is disabled while the request runs, which prevents double submits.
- An ambiguity error returns to step 2.
- Success navigates to `/students/{id}`.

All strings are in UZ, RU and EN (`adm.*` keys).

---

## 22. 25-Case Results

`backend/test/admissions.e2e-spec.ts` — **25/25 passed.**

| # | Case | Result |
|---|---|---|
| 1 | Create lead (NEW, normalized, timeline, event) | ✅ |
| 2 | Cross-tenant read → 404, absent from list | ✅ |
| 3 | Cross-tenant update / transition / follow-up → 404, unchanged | ✅ |
| 4 | Cross-tenant delete / archive → 404, still active | ✅ |
| 5 | Same-tenant duplicate in another phone format, and by email → 409; override 403 for receptionist, 201 + audit for owner | ✅ |
| 6 | Same phone in another tenant allowed | ✅ |
| 7 | NEW → CONTACTED with activity and actor | ✅ |
| 8 | Invalid transition 409; PATCH status 400; ENROLLED via transition 400; unchanged | ✅ |
| 9 | Same-tenant manager assign (audit, event, "me" filter) | ✅ |
| 10 | Foreign-tenant user / wrong role → 400; receptionist → 403 | ✅ |
| 11 | Follow-up in the upcoming queue (not overdue), summary | ✅ |
| 12 | Overdue queue; `LeadFollowUpDue` emitted exactly once across two scans | ✅ |
| 13 | Trial booking (NEW rejected; defaults from group; second booking 409) | ✅ |
| 14 | Teacher-lesson conflict → 409 `TRIAL_CONFLICT`, no trial, status unchanged; own-group lesson allowed | ✅ |
| 15 | Attendance → TRIAL_ATTENDED; repeat 409; cross-tenant 404 | ✅ |
| 16 | LOST needs a reason (and a note for OTHER); filter; reopen 403 for receptionist, OK for manager; timeline and audit | ✅ |
| 17 | Conversion (refused before QUALIFIED; student, convertedAt, event, audit) | ✅ |
| 18 | Double conversion idempotent, one student | ✅ |
| 19 | 5 concurrent conversions → one student, one enrollment, all return the same student | ✅ |
| 20 | Exact existing-student match linked; sibling ambiguity 409, then explicit CREATE_NEW | ✅ |
| 21 | Conversion + enrollment (tenant set) + invoice via billing, no payment | ✅ |
| 22 | Cross-tenant group → 404, no student, no enrollment, lead QUALIFIED | ✅ |
| 23 | Group-full failure after earlier writes → full rollback | ✅ |
| 24 | Accountant 403 on read and write; receptionist 403 on convert, archive, analytics, export; archive is soft | ✅ |
| 25 | Cohort funnel exact counts and rates; other tenants excluded; empty window → `rate: null` | ✅ |

---

## 23. Full Regression Results

All existing suites still pass unchanged: `app`, `security`, `core-education`, `billing-gateways` (46 tests), plus every existing unit suite. The only existing test file modified is `src/leads/leads.service.spec.ts` (§24).

**Changes to the existing lead tests.** These are required by spec-mandated behaviour changes; none were weakened to force a pass.
- The funnel test is unchanged, verbatim.
- `findAll` / `findOne` / `create` / `update` were adapted to the paginated result and the new constructor. The same intent is asserted, including invalid branch → `BadRequest`.
- "Invalid trial group on create" was replaced by an unparseable-phone test. Trial fields left the create DTO; trial group validation is covered by E2E #13, #14 and #22.
- "Update status to QUALIFIED" is now **"refuses status via PATCH"**. The old behaviour was the lifecycle defect.
- The two convert tests moved to `lead-conversion.service.spec.ts`; the idempotent "already converted" case is kept.
- "remove hard-deletes" is now **"archive never deletes and audits"**. The old behaviour was the hard-delete defect.

---

## 24. Exact Unit/E2E Totals

| Suite | Before | After |
|---|---|---|
| Backend unit | 120 (21 files) | **140 (23 files)**: −11 old lead tests, +31 new (leads.service 18, lead-lifecycle 4, phone 6, lead-conversion 3) |
| Backend E2E | 46 (4 files) | **71 (5 files)**: +25 admissions |
| Billing tests inside the above | 25 | 25 (unchanged) |

---

## 25. Lint/Typecheck/Build

| Check | Result |
|---|---|
| Backend `nest build` | ✅ exit 0 |
| Backend `tsc --noEmit` | ✅ clean |
| Backend lint (oxlint) | ✅ 0 errors, 10 warnings, all pre-existing; 0 in admissions code |
| Frontend `tsc --noEmit` | ✅ clean |
| Frontend lint (eslint) | ✅ 0 errors, 102 warnings; 5 in new admissions files, the same `react-hooks/set-state-in-effect` pattern used across the repo |
| Frontend `next build` | ✅ exit 0; new dynamic route `/leads/[id]` |

---

## 26. Security Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | HIGH | Conversion was non-transactional: concurrent calls created duplicate students, and failures left partial state | **Fixed** (§14; E2E #18, #19, #23) |
| S2 | HIGH | Conversion inserted enrollments without `tenantId` and ignored group capacity | **Fixed** (§16; E2E #21, #23) |
| S3 | HIGH (pre-existing) | Versioned migrations lacked 5 tables and 16 columns; `db:migrate` produced a DB without `organization_memberships` | **Fixed**: `0002_core_schema_catchup.sql`, verified zero drift on a fresh DB |
| S4 | MEDIUM | `PATCH /leads/:id` accepted any status (e.g. ENROLLED with no student) | **Fixed** (E2E #8) |
| S5 | MEDIUM | `DELETE` destroyed leads and history | **Fixed**: archive only |
| S6 | MEDIUM | TEACHER could read prospects' contact details; OWNER access was implicit | **Fixed**: permission-based RBAC |
| S7 | MEDIUM (pre-existing, project-wide) | The DB session timezone is `Asia/Tashkent` and columns are `timestamp without time zone`. `defaultNow()` stores local wall-clock time while drizzle reads and writes UTC, so DB-defaulted timestamps are shifted +5 h against app-written ones. | **Contained for admissions** (every admissions timestamp is app-written; E2E #25 is the regression test). **Not fixed globally**; recommendation in §29. |
| S8 | LOW | A SUPERADMIN (tenantless) token on lead routes caused a 500 | **Fixed**: 403 |
| S9 | LOW | The public site form bypassed normalization and dedupe | **Fixed** |
| S10 | LOW | CSV export formula injection | **Mitigated**: cells starting with `= + - @` are prefixed |
| S11 | LOW (pre-existing) | `StudentsService.enroll` does not enforce `maxStudents` | Documented; out of scope |
| S12 | LOW (pre-existing) | `ScheduleService.findConflicts` flags every one-off lesson against any recurring slot, whatever the date | Documented; narrowed for trials only |

---

## 27. Technical Debt

- `drizzle/meta` has a snapshot only for 0000. `db:generate` will emit a noisy diff and prompt about the lead column renames. Regenerate the snapshots on a DB built from 0000–0003 before the next generated migration.
- The legacy lead columns (`subject`, `trial_date`, `trial_group_id`) and enum values are retained. Drop them after a release, once confirmed unused.
- Wizard groups show `maxStudents` but not the live seat count, because the groups list has no enrollment count. The server enforces capacity.
- Analytics aggregate the cohort in memory. This is fine for a center's volume (thousands of leads); move it to SQL aggregation for very large tenants.
- `@nestjs/schedule` is not installed, so the follow-up scanner uses `setInterval`.
- JWT-embedded permissions refresh only on token refresh (existing behaviour).

---

## 28. Known Limitations

- **The frontend was not exercised in a browser in this sprint.** I would not enter credentials in the browser, so the authenticated pages were verified by typecheck, lint and production build, and the backend contract by E2E. A manual walkthrough of `/leads`, `/leads/[id]` and the wizard is the one pending verification step. A local test center exists for it: `uitest-1790266363@test.uz` (password `password123`), with 4 seeded leads.
- A guardian *user account* is not created at conversion; only the guardian phone is stored.
- `LeadFollowUpDue` has no delivery channel yet beyond logs and tenant webhooks. Telegram/email subscribers are future work.
- Trial booking accepts no room picker in the UI (the API supports `roomId`).
- Rescheduling keeps the group and teacher.
- `NEW → LOST` is not allowed (per spec). A never-reached lead must be contacted first, or archived.
- There is no lead import. Existing import/export tooling does not cover leads; import is out of scope. A permissioned, audited CSV export was added.
- "Today" is fixed to Asia/Tashkent, although `tenants.timezone` exists.
- Out of scope, as specified: marketing automation, ads APIs, call center, WhatsApp, AI scoring, workflow builder, campaigns.

---

## 29. Recommended Next Sprint

1. A manual UI QA pass of the admissions pages on desktop and mobile. Fix anything found.
2. Fix S7 globally:
   - set the pool session to UTC (`new Pool({ …, options: '-c TimeZone=UTC' })`);
   - migrate the affected `defaultNow()` columns (subtract the offset from existing rows, or move to `timestamptz`);
   - add a regression test.
3. Regenerate the drizzle snapshots and adopt `db:migrate` end-to-end in CI (fresh DB → migrations → E2E).
4. A notification subscriber for `LeadFollowUpDue` and `TrialBooked` (Telegram/email reminders to the assigned manager).
5. Enforce capacity in `StudentsService.enroll` (S11) and fix the one-off/recurring rule in the schedule conflict engine (S12).
6. Use the tenant timezone for follow-up "today" buckets.

---

## Classification

**READY FOR NEXT SPRINT**

- All 25 mandatory cases pass.
- The full backend regression passes: 140 unit and 71 E2E tests.
- Both apps build, typecheck and lint with 0 errors.
- Every blocking defect found (S1–S3) is fixed with regression coverage.
- The versioned migration chain builds the complete schema from scratch.

Before this is merged or released, one item remains: the manual browser walkthrough of the new frontend (§28). Its logic is covered by the E2E-verified API, but the UI itself has not been exercised by a person. S7 is contained for admissions and scheduled as the next sprint's first engineering item.

---

## Addendum — follow-up work (same day, commits `90633f3`…`c879f81`)

The §29 recommendations 2–6 were implemented after the sprint report. Item 1 (manual UI walkthrough) is still open. It needs someone to sign in to the browser, which I don't do.

| Item | Change | Verification |
|---|---|---|
| S7 timezone | The DB pool pins sessions to `TimeZone=UTC`, so `defaultNow()` agrees with drizzle's UTC convention. `scripts/fix-local-timestamps.cjs` is an opt-in, dry-run-first repair of historical `created_at` values. **It has not been run on any database.** | `test/timestamps.e2e-spec.ts` fails without the fix and passes with it |
| Migrations | 0002 also adds role values `OWNER`, `STUDENT`, `PARENT`, which the versioned chain lacked (registration would fail on a migrated DB). There is now a real snapshot `drizzle/meta/0003_snapshot.json`, so `db:generate` reports "No schema changes". `npm run db:check-drift` added. | Fresh DB via `drizzle-kit migrate` → zero drift → **the full E2E suite passed on the migrated DB** |
| CI | `drizzle-kit push` replaced by `db:migrate` + drift check + a "no pending migration" check | Workflow edited; not yet run on GitHub (nothing pushed) |
| Reminders | `AdmissionsRemindersSubscriber` emails the active assigned manager on `LeadFollowUpDue` and `TrialBooked`, with no prospect contact data. `ADMISSIONS_EMAIL_REMINDERS=false` disables it. Staff have no Telegram link, so email is the only channel. | 4 unit tests |
| S11 capacity | `StudentsService.enroll` and `create(groupIds)` lock the group and enforce `maxStudents` (409 `GROUP_FULL`); a full group rolls back the whole create | Unit tests + E2E, including a 4-way concurrent enroll into a 2-seat group (exactly 2 succeed) |
| S12 conflicts | One-off vs weekly lessons are aligned by weekday in both directions | Unit + E2E regression tests |
| Timezone | Follow-up buckets, trial slot conversion and reminder texts use `tenants.timezone` (DST-correct helpers) | Helper unit tests + E2E with a UTC+14 center |

**Totals now:**
- backend unit **157/157** (25 files);
- backend E2E **78/78** (8 files);
- backend lint 0 errors;
- `nest build` clean;
- drift check clean.

The frontend was unchanged in this round.

**Remaining limitations:**
- Trial times entered in the UI are interpreted in the *browser's* timezone. That is correct for staff working at the center, but not for remote staff in another zone.
- Historical `updated_at`, `paid_at` and similar columns written in a non-UTC database cannot be repaired row by row, because app-written and DB-written values can't be told apart.
