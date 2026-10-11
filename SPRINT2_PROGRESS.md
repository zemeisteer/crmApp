# Second stabilization sprint: checkpoints

Branch `claude/admiring-goldberg-jkri02`. Start: `40b8721aec656c9d56113ec7ed1c0a2f79300fc9`
(pushed; CI green for it). Work is done on the local machine, in local commits only:
nothing is pushed, no PR, no merge, no deploy.

**Checkpoint 1: tasks 1-4 (lesson identity, one write rule, group removal, credit basis).**

- Migration `0051_lesson_identity`: `makeup_bookings.target_schedule_id`,
  `lesson_cancellations.schedule_id`, `makeup_credits.origin_schedule_id`. Open bookings
  are bound only when exactly one lesson matches; `npm run db:report-makeup-links` lists
  the rest. NOT yet applied to the dev database `talimcrm`.
- A lesson is its timetable row (`les-<scheduleId>-<date>` in ICS/Google; a group with
  no rows keeps `grp-<groupId>-<date>`). Google events of existing connections are
  replaced once on the next sync (old keys removed, new ones created).
- `GroupsService` create/update/remove/restore write the group and its lessons in one
  transaction under the timetable lock, with `ScheduleService.findConflicts`; rows are
  changed in place (ids kept).
- `MakeupsService.issue` runs under the timetable lock with the shared rules in
  `makeups/eligibility.ts`; attendance corrections settle the credit.
- Tests: `test/lesson-identity.e2e-spec.ts` (16). With `lesson-integrity`, `makeups`,
  `calendar`, `calendar-google`: 70/70.

Next: task 5 (Google callback and worker ownership), then browser tests (6), load (7),
full verification and the report (8).

**Checkpoint 2: task 5 (Google connect and worker ownership).**

- Migration `0052_calendar_lease_owner`: `lock_token` and `next_*` (a grant for another
  account waiting for the old account's clean-up). Not yet applied to `talimcrm`.
- Callback: SAME / OTHER / UNKNOWN account. UNKNOWN changes nothing (`?google=unverified`);
  OTHER goes through the ordinary disconnect clean-up (`?google=switching`, retried, shown
  in the status) and then the new grant becomes the connection.
- Every worker write is conditional on its own lease token; the lease is renewed before
  each Google write.
- Tests (mocked Google only): `test/calendar-google-states.e2e-spec.ts` 24/24;
  `calendar-google` 12/12, `calendar` 13/13. No live Google check was made.

Next: browser tests (6), load (7), full verification and the report (8).

**Checkpoint 3: load measured (task 7), browser journeys written (task 6, partly).**

- `npm run test:load` (backend, e2e database): chat streams on two instances and conflict
  checks in a large center; numbers go to `backend/load-results.txt` (not committed).
- Chat delivery: staff streams are validated with two queries per delivery and the read
  check is asked once per reader (still at every delivery, nothing cached between
  messages). 400 streams: heard by all in ~537 ms before, ~65 ms after.
- Conflict check: candidates are narrowed to the weekday/date in SQL.
- The three Google/calendar suites sync only their own centers (`syncDue(limit, tenantIds)`):
  they ran into each other's connections in the full parallel run.
- `e2e-browser/tests/lesson-identity.spec.ts`: two journeys (make-up form race + one of
  two lessons; group deleted -> cabinet and calendar). Being run.
- Real nginx: BLOCKED (not installed; Docker daemon not running).

Next: full verification (e2e, unit, builds, lint, browser suite), migrations on an
upgraded database, the report, patch and bundle.
