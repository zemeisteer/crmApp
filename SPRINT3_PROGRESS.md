# Third sprint: checkpoints

Branch `claude/admiring-goldberg-jkri02`. Start: `224e5ade7d2d4ea1e4523a2a302e35fe10e3c8ac`
(pushed). Work is done on the local machine (the user's choice, again), in local commits
only: nothing is pushed, no PR, no merge, no deploy. Cloud preview: BLOCKED (not a cloud
session).

CI for `224e5ad` could not be read from here (`gh` is not signed in). The brief says
backend unit 334/334, backend e2e 422/422, frontend, images and ops-scripts passed, and
browser and recovery were still running.

**Checkpoint 1: task 1 (group form conflict endpoint).** `GET /api/groups/schedule-conflicts`
now takes the viewer: the group asked about must be the center's (404 otherwise), a
teacher asks about their own groups only, an unknown or foreign teacher id answers
nothing, and the conflicts go through `redactConflicts` before the answer is built.
Test: `backend/test/group-conflicts-access.e2e-spec.ts` (3 tests; 2 of them fail on the
code before the fix).

Next: task 2 (attendance per lesson), 3 (make-up credits per lesson), 4 (membership
periods), 5 (linked modules), 6 (browser), 7 (verification, report, patch).

## Design decided for tasks 2-4 (so a resumed session does not re-derive it)

**Attendance per lesson (migration 0053).**
- `attendance.schedule_id text` (plain key = the lesson's timetable row, NOT a foreign
  key: history must survive the row), `attendance.start_time text` (snapshot of the
  lesson's start when marked). NULL schedule_id = a day-level mark: groups without
  timetable rows, dates with no timetable lesson, and old rows that could not be bound.
- Unique: `(student_id, group_id, date) WHERE schedule_id IS NULL` and
  `(student_id, schedule_id, date) WHERE schedule_id IS NOT NULL`.
- Migration binds an old row only when exactly one live timetable row of the group gives
  a lesson on that date (weekly row of that weekday, or a one-off of that date); 0 or 2+
  stay NULL ("legacy"). Report: `npm run db:report-attendance-links` + `GET /api/attendance/legacy`.
- POST /api/attendance takes `scheduleId`; several lessons that day and none named ->
  400 LESSON_AMBIGUOUS; a cancelled lesson takes no new marks (409 LESSON_CANCELLED);
  a date with no timetable lesson keeps the old day-level mark. Explicitly marking a
  lesson adopts the student's legacy day mark of that group/date (same row id).
- A teacher marks lessons of their own group, or a lesson assigned to them.

**Make-up credits (task 3).** An ABSENT credit carries `origin_schedule_id` = the mark's
schedule_id; the two partial unique indexes from 0051 already allow one credit per lesson.
`settleAbsenceCredits` works per lesson.

**Membership periods (task 4, migration 0054).** Table `enrollment_periods`
(student, group, enrollment, started_at, ended_at, source RECORDED|LEGACY). One open
period per (student, group) (partial unique index). The enrollment row stays the current
state; every join opens a period, every leave/pause closes it, reactivation opens a new
one. PAUSED = not a member for lessons (period closed), seat rules unchanged.
Helper `membership.ts`: `memberAt(periods, instant)` half-open [start, end);
`memberOnDay(periods, date, tz)` when no lesson time is known. Migrated rows: one LEGACY
period per enrollment from joined_at/left_at (earlier stays are unknown, not invented).

**Checkpoint 2: tasks 2-3, backend.** Migration `0053_attendance_per_lesson` (not yet
applied to the dev database `talimcrm`). `AttendanceService.mark` resolves the lesson
(`scheduleId`), adopts legacy day marks, upserts per lesson in one transaction; QR scan
picks the lesson that is on; `GET /api/attendance/unbound` (admins) and
`npm run db:report-attendance-links`. ABSENT credits carry the lesson; settle is per
lesson. Tests: `test/attendance-per-lesson.e2e-spec.ts` 9/9; full e2e before these tests
57 files / 425.

Still to do for task 2: frontend (lesson picker on the attendance page, per-lesson results
in the student/parent portal, the unbound notice for admins); portal/report readers of
attendance reviewed for "one row per student, group and day" assumptions.

**Checkpoint 3: task 4 (membership stays), backend, and their use (part of task 5).**
Migration `0054_enrollment_periods` (not yet applied to `talimcrm`).
`backend/src/enrollments/membership.ts` is the one place that answers "was the student in
the group at this lesson" (instant rule [start, end); day rule: the stay touches the day;
strict / lenient). Stays are opened/closed in: student create, enroll, unenroll, student
status change (PAUSED/LEFT/GRADUATED close, ACTIVE reopens), remove/restore, lead
conversion. Readers switched: make-up eligible + issue, attendance.mark validation
(NOT_A_MEMBER), student/parent calendar, cabinet past lessons. New:
`GET /api/students/:id/memberships`, `npm run db:report-membership`.
Also fixed: two simultaneous enrolments of one student into one group answered 500.
Tests: `test/membership-history.e2e-spec.ts` 5/5, `src/enrollments/membership.spec.ts` 4/4.
Full e2e: 58 of 59 files pass; `staff-access.e2e-spec.ts` times out at 30 s in the full
parallel run on a cold cache and passes alone (9/9) - an existing test near its limit,
left as it is.

Still to do: frontend (attendance lesson picker, cabinet per-lesson results, unbound
notice, membership history on the student page), cabinet per-lesson attendance in
`past-lessons.ts`, reports/readers review, browser tests, migrations on the dev DB,
final verification, report, patch.
