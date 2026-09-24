# Core Education Operations Sprint Report

**Sprint Goal:** Make the core daily workflow of a real education center production-ready with full tenant isolation, relational data integrity, historical preservation, and multi-tenant security.  
**Execution Date:** September 23, 2026  
**Status:** Completed & Fully Verified  

---

## 1. Executive Summary

This sprint addressed the core operations layer of **CRMAPP**:
1. **Subjects & Courses Hierarchy:** Completed the relational hierarchy `Organization → Subject → Course / Program → Group`. Enforced tenant-scoped unique naming, active/archive lifecycle statuses, and cascading protection.
2. **Student Management & Lifecycles:** Introduced structured student lifecycles (`ACTIVE`, `PAUSED`, `GRADUATED`, `LEFT`), branch associations, profile notes, and avatar support.
3. **Parents / Guardians Relationship:** Established the first-class relational `student_guardians` junction table linking `User(role = 'PARENT')` to students with relationship metadata (`Ota`, `Ona`, `Vasiy`, etc.), primary guardian flags, and strict tenant-scoped parent portal authorization.
4. **Teacher Assignment & RBAC:** Enforced strict RBAC preventing teachers from inspecting or modifying groups, attendance, or schedules outside their assigned tenant and group assignments.
5. **Group Relational Integrity:** Connected groups to courses (`groups.courseId`) and lifecycle statuses (`PLANNED`, `ACTIVE`, `COMPLETED`, `ARCHIVED`).
6. **Enrollments History Preservation:** Replaced destructive enrollment row deletion with lifecycle state transitions (`status = 'CANCELLED'`, `leftAt = timestamp`). Implemented duplicate active enrollment rejection (`400 Bad Request`).
7. **Scheduling & Conflict Engine:** Hardened schedule validation against cross-tenant groups, rooms, and teachers. Room/teacher time collision detection successfully enforced (`409 Conflict`).
8. **Attendance Hardening:** Enforced tenant scoping, teacher group authorization, active group enrollment verification for all entries, and idempotent duplicate attendance updates.
9. **Parent Portal Integration:** Added dedicated endpoints for parent users to view only their explicitly linked children (`/api/portal/parent/students`) and child overviews (schedule, attendance, payments) with forbidden cross-tenant and unlinked child access.
10. **Automated Verification:** Added a 14-test end-to-end test suite (`backend/test/core-education.e2e-spec.ts`). All 14 tests pass, alongside 116/116 unit tests, 7/7 previous e2e tests, clean lints, and clean production builds for both backend and frontend.

---

## 2. Architecture Before vs. After

### Before
```
Tenant
  ├── Subject (text name, no status/archive, no unique check)
  │     └── Course (name, duration, price, no status, groups not linked)
  ├── Group (had subject text and level text, courseId was MISSING)
  ├── Student
  │     ├── parentPhone (flat text string only, no link to parent User)
  │     └── enrollments (hard-deleted on unenroll, destroying historical logs)
  ├── Teachers (teachers.userId not validated in DTO, groups not restricted on findOne)
  └── Attendance (accepted arbitrary student IDs without checking group enrollment or tenant)
```

### After
```
Tenant
  ├── Subject (status: ACTIVE | ARCHIVED, tenant-scoped unique name)
  │     └── Course (status: ACTIVE | ARCHIVED, tenant & subject scoped unique name)
  │           └── Group (courseId FK, status: PLANNED | ACTIVE | COMPLETED | ARCHIVED)
  │                 ├── Teacher (assigned via teacherId, teacher RBAC verified on findOne & mark)
  │                 ├── Room (verified in tenant, collision detection enabled)
  │                 └── Enrollments (tenantId, status: ACTIVE | PAUSED | COMPLETED | CANCELLED, joinedAt, leftAt)
  ├── Student (branchId FK, status: ACTIVE | PAUSED | GRADUATED | LEFT, notes, avatarUrl)
  │     ├── Enrollments (historical preservation on leave; duplicate active enrollment rejected)
  │     └── StudentGuardians (tenantId, studentId, userId FK to users.id, relationship, isPrimary)
  │           └── Parent User (authenticated with role PARENT, access strictly scoped to linked children)
  ├── Schedules / Lessons (tenantId, groupId, teacherId, roomId, dayOfWeek, date, collision engine)
  └── Attendance (idempotent, validates active group enrollment & tenant ownership, teacher RBAC checked)
```

---

## 3. Database Schema Changes & Migrations

The database was updated using Drizzle ORM and pushed directly to PostgreSQL (`npm run db:push`):

### 1. `subjects`
- Added `status: text('status').notNull().default('ACTIVE')` (`'ACTIVE' | 'ARCHIVED'`).

### 2. `courses`
- Added `status: text('status').notNull().default('ACTIVE')` (`'ACTIVE' | 'ARCHIVED'`).

### 3. `groups`
- Added `courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' })`.
- Added `status: text('status').notNull().default('ACTIVE')` (`'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'`).
- Added index `groups_course_idx` on `courseId`.

### 4. `students`
- Added `branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' })`.
- Added `status: text('status').notNull().default('ACTIVE')` (`'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'LEFT'`).
- Added `notes: text('notes')`.
- Added `avatarUrl: text('avatar_url')`.
- Added index `students_branch_idx` on `branchId`.

### 5. `enrollments`
- Added `tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' })`.
- Added `status: text('status').notNull().default('ACTIVE')` (`'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'`).
- Added `leftAt: timestamp('left_at')`.
- Added index `enrollments_tenant_idx` on `tenantId`.

### 6. `student_guardians` (New Table)
```sql
CREATE TABLE student_guardians (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'PARENT',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX student_guardians_tenant_idx ON student_guardians(tenant_id);
CREATE INDEX student_guardians_student_idx ON student_guardians(student_id);
CREATE INDEX student_guardians_user_idx ON student_guardians(user_id);
CREATE UNIQUE INDEX student_guardians_student_user_idx ON student_guardians(student_id, user_id);
```

---

## 4. API & Backend Implementation Details

### Subjects & Courses (`backend/src/subjects`)
- `POST /api/subjects`: Checks unique name per tenant scope (`ConflictException` on duplicate).
- `GET /api/subjects?status=ACTIVE`: Filter by status.
- `POST /api/subjects/:id/archive`: Soft-archive subject.
- `DELETE /api/subjects/:id`: Checks if courses exist; if attached, safely archives rather than breaking foreign keys.
- `POST /api/subjects/courses`: Validates `subjectId` belongs to tenant; checks duplicate course name.
- `POST /api/subjects/courses/:id/archive`: Soft-archive course.
- `DELETE /api/subjects/courses/:id`: Checks if groups reference course; safely archives if referenced.

### Student Management & Lifecycles (`backend/src/students`)
- `POST /api/students`: Accepts `branchId`, `status`, `notes`, `avatarUrl`, initial `groupIds` with `tenantId` and `status: 'ACTIVE'`.
- `PATCH /api/students/:id`: Updates lifecycle status, branch, notes, avatar.
- `POST /api/students/:id/enroll/:groupId`:
  - Verifies student and group belong to tenant.
  - Rejects if student already has active enrollment (`400 Bad Request`).
  - Reactivates existing cancelled enrollment or inserts new active enrollment.
- `DELETE /api/students/:id/enroll/:groupId`:
  - Does NOT delete row! Transitions `status = 'CANCELLED'` and sets `leftAt = new Date()`.
- `GET /api/students/:id/guardians`: Lists all linked guardians with user details.
- `POST /api/students/:id/guardians`: Links a parent User (`userId` or existing phone) with relationship and primary flag.
- `DELETE /api/students/:id/guardians/:guardianId`: Unlinks guardian.

### Groups & Teachers (`backend/src/groups` & `backend/src/teachers`)
- `CreateTeacherDto` / `UpdateTeacherDto`: Added `userId?: string` to bind teacher profile to a CRM User identity.
- `POST /api/groups`: Validates `courseId`, `branchId`, and `teacherId` belong to the tenant.
- `GET /api/groups/:id`: If caller role is `TEACHER`, enforces that `group.teacherId === teacher.id` (`403 Forbidden` if unassigned).
- `GET /api/groups`: Teachers only receive their assigned groups.

### Attendance Hardening (`backend/src/attendance`)
- `POST /api/attendance`:
  - Validates group exists in tenant.
  - If caller is `TEACHER`, verifies group assignment.
  - Validates that every student ID in `entries` belongs to tenant, is not soft-deleted, and has an `ACTIVE` enrollment in that group.
  - Idempotent: `onConflictDoUpdate` updates status cleanly without duplicates.
- `POST /api/attendance/qr-checkin`: Excludes soft-deleted students and requires `ACTIVE` enrollment.

### Parent Portal (`backend/src/portal`)
- `GET /api/portal/parent/students`: Protected by `JwtAuthGuard` + `RolesGuard(@Roles('PARENT'))`. Returns only students linked to the authenticated user via `studentGuardians` in that tenant.
- `GET /api/portal/parent/students/:studentId/overview`: Verifies parent guardianship link (`403 Forbidden` if not linked or cross-tenant). Returns profile, schedule, attendance, payments.
- `GET /api/portal/parent/students/:studentId/schedule`: Verifies guardianship and returns schedule.
- `GET /api/portal/parent/students/:studentId/attendance`: Verifies guardianship and returns attendance.
- `GET /api/portal/parent/students/:studentId/payments`: Verifies guardianship and returns payment history and tuition balance.

---

## 5. Frontend Integration Details

Updated `frontend/lib/api.ts`:
- **`Group`**: Added `courseId`, `status`, `course`.
- **`Student`**: Added `branchId`, `status`, `notes`, `avatarUrl`, `branch`, `guardians`, and updated `enrollments`.
- **`StudentGuardian`**: Defined typed interface with user details.
- **`Subject` & `Course`**: Added `status: 'ACTIVE' | 'ARCHIVED'`.
- **`subjectsApi`**: Added status filtering, `archive`, `archiveCourse`.
- **`groupsApi`**: Added filter params (`courseId`, `status`, `branchId`).
- **`studentsApi`**: Added filter params (`status`, `branchId`), `getGuardians`, `linkGuardian`, `unlinkGuardian`.
- **`parentPortalApi`**: Added client wrapper for parent portal endpoints.

---

## 6. Automated Test Suite (14 Mandatory Tests)

Created `backend/test/core-education.e2e-spec.ts` covering all required scenarios:

| # | Test Scenario | Verified Result | Status |
|---|---------------|-----------------|--------|
| 1 | Tenant A cannot access Tenant B student | `GET /api/students/:studentB` returns `404 Not Found` | PASS |
| 2 | Tenant A cannot access Tenant B teacher | `GET /api/teachers/:teacherB` returns `404 Not Found` | PASS |
| 3 | Tenant A cannot access Tenant B group | `GET /api/groups/:groupB` returns `404 Not Found` | PASS |
| 4 | Parent can only access linked child | Parent sees child A; unlinked child A2 & cross-tenant child B return `403 Forbidden` | PASS |
| 5 | Teacher can access assigned group according to RBAC | Assigned group returns `200 OK`; unassigned group returns `403 Forbidden` | PASS |
| 6 | Student can enroll in a group | Active enrollment created; appears in student's active enrollments | PASS |
| 7 | Duplicate active enrollment is rejected | Re-enrolling active student throws `400 Bad Request` | PASS |
| 8 | Leaving a group preserves history | Unenroll transitions status to `CANCELLED`, sets `leftAt`, keeps row in database | PASS |
| 9 | Attendance can be created | `POST /api/attendance` marks `PRESENT` successfully | PASS |
| 10 | Duplicate attendance for same lesson/student is safely updated | Marking same student on same date updates status to `LATE` without duplicates | PASS |
| 11 | Cross-tenant attendance manipulation is rejected | Marking cross-tenant student returns `400`; marking cross-tenant group returns `404` | PASS |
| 12 | Schedule belongs to correct tenant/group | Cross-tenant group schedule returns `404`; valid group schedule returns `201` | PASS |
| 13 | Teacher scheduling conflict is handled | Overlapping schedule on same day/time for same teacher returns `409 Conflict` | PASS |
| 14 | Removing a group/student does not unexpectedly destroy historical records | Soft-delete sets `deletedAt`; attendance and payment history remain queryable | PASS |

---

## 7. Exact Verification Results

### 1. Backend Unit Tests
```
RUN v4.1.11 C:/Users/user/Documents/GitHub/crmApp/backend

✓ src/onboarding/onboarding.service.spec.ts (7 tests)
✓ src/teachers/teachers.service.spec.ts (9 tests)
✓ src/staff/staff.service.spec.ts (5 tests)
✓ src/expenses/expenses.service.spec.ts (5 tests)
✓ src/students/students.service.spec.ts (13 tests)
✓ src/leads/leads.service.spec.ts (11 tests)
✓ src/telegram/telegram.service.spec.ts (6 tests)
✓ src/attendance/attendance.service.spec.ts (4 tests)
✓ src/portal/portal.service.spec.ts (6 tests)
✓ src/exams/exams.service.spec.ts (4 tests)
✓ src/invitations/invitations.service.spec.ts (12 tests)
✓ src/common/permissions.guard.spec.ts (5 tests)
✓ src/common/roles.guard.spec.ts (4 tests)
✓ src/schedule/schedule.service.spec.ts (5 tests)
✓ src/common/trial.guard.spec.ts (7 tests)
✓ src/salary/salary.service.spec.ts (2 tests)
✓ src/payments/payments.service.spec.ts (3 tests)
✓ src/homework/homework.service.spec.ts (3 tests)
✓ src/notifications/notifications.service.spec.ts (5 tests)

Test Files  19 passed (19)
     Tests  116 passed (116)
  Duration  15.58s
```

### 2. Backend E2E Tests
```
RUN v4.1.11 C:/Users/user/Documents/GitHub/crmApp/backend

✓ test/app.e2e-spec.ts (2 tests) 2121ms
✓ test/core-education.e2e-spec.ts (14 tests) 2591ms
✓ test/security.e2e-spec.ts (5 tests) 4645ms

Test Files  3 passed (3)
     Tests  21 passed (21)
  Duration  17.93s
```

### 3. Backend Lint & Build
```
npm run lint:
Finished in 162ms on 171 files with 96 rules using 12 threads.
0 errors. (Exit code: 0)

npm run build:
> nest build
Compiled successfully. (Exit code: 0)
```

### 4. Frontend Typecheck, Lint & Build
```
npx tsc --noEmit:
Zero type errors. (Exit code: 0)

npm run lint:
0 errors. (Exit code: 0)

npm run build:
▲ Next.js 16.3.5 (Turbopack)
✓ Compiled successfully in 5.3s
✓ Running TypeScript passed in 41s
✓ Generating static pages using 11 workers (35/35) in 12.7s
Finalizing page optimization ... (Exit code: 0)
```

---

## 8. Files Changed

### Backend Files
- [schema.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/db/schema.ts) — Added `studentGuardians` table, relations, and lifecycle columns to `subjects`, `courses`, `groups`, `students`, `enrollments`.
- [subject.dto.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/subjects/dto/subject.dto.ts) — Added `status` validation to subject & course DTOs.
- [subjects.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/subjects/subjects.service.ts) — Added tenant uniqueness check, status filtering, and safe archive methods.
- [subjects.controller.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/subjects/subjects.controller.ts) — Added status query and archive endpoints.
- [student.dto.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/students/dto/student.dto.ts) — Added lifecycle status, branchId, notes, avatarUrl, and LinkGuardianDto.
- [students.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/students/students.service.ts) — Implemented duplicate active enrollment rejection, history-preserving unenroll, and guardian management.
- [students.controller.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/students/students.controller.ts) — Exposed guardian management routes and status filters.
- [students.service.spec.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/students/students.service.spec.ts) — Updated unit test mocks for enrollment preservation.
- [teacher.dto.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/teachers/dto/teacher.dto.ts) — Added `userId` to teacher DTOs.
- [group.dto.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/groups/dto/group.dto.ts) — Added `courseId` and `status` to group DTOs.
- [groups.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/groups/groups.service.ts) — Added `courseId` validation, status filter, and teacher assignment RBAC check.
- [groups.controller.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/groups/groups.controller.ts) — Injected caller user & role into findOne.
- [attendance.dto.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/attendance/dto/attendance.dto.ts) — Added `EXCUSED` status.
- [attendance.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/attendance/attendance.service.ts) — Added active group enrollment verification, teacher authorization, and cross-tenant checks.
- [attendance.controller.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/attendance/attendance.controller.ts) — Injected caller user & role.
- [schedule.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/schedule/schedule.service.ts) — Added tenant validation for teacher and room on create/update.
- [portal.service.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/portal/portal.service.ts) — Added parent student querying and guardianship verification methods.
- [portal.controller.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/src/portal/portal.controller.ts) — Added protected parent portal routes.
- [vitest.config.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/vitest.config.ts) — Added `testTimeout: 15000` to prevent CPU-intensive bcrypt timeouts in parallel runs.
- [core-education.e2e-spec.ts](file:///c:/Users/user/Documents/GitHub/crmApp/backend/test/core-education.e2e-spec.ts) — 14 new automated e2e test cases.

### Frontend Files
- [api.ts](file:///c:/Users/user/Documents/GitHub/crmApp/frontend/lib/api.ts) — Updated `Group`, `Student`, `Subject`, `Course` interfaces, `groupsApi`, `studentsApi`, `subjectsApi`, and added `parentPortalApi`.

---

## 9. Security Findings & Data Integrity Measures

1. **Anti-IDOR on Direct Entity IDs:** All endpoints for `students`, `teachers`, `groups`, `subjects`, `courses`, and `schedules` require tenant verification. Probing an ID from another tenant always returns `404 Not Found` (or `403 Forbidden`).
2. **Guardian Authorization Boundary:** A user with role `PARENT` cannot view any student details unless a corresponding record exists in `student_guardians` for that tenant. Unlinked or cross-tenant access returns `403 Forbidden`.
3. **Teacher Assignment Boundary:** Teachers can only inspect details and submit attendance for groups where `group.teacherId === teacher.id`.
4. **Attendance Spoofing Prevention:** Attendance submission verifies that all provided student IDs are not deleted, belong to the tenant, and possess an active enrollment in the group.
5. **Historical Integrity:** When students leave a group, their enrollment record transitions to `CANCELLED` with a `leftAt` timestamp. Attendance records, payments, and homework completions remain tied to the historical enrollment.

---

## 10. Remaining Technical Debt & Next Steps

1. **Advisory Conflict Warnings in UI:** The collision engine in `schedule.service.ts` can detect room and teacher overlaps. The group edit modal in the frontend should display visual warnings when an overlapping schedule is configured.
2. **Parent Self-Service Portal UI:** While the API endpoints (`/api/portal/parent/...`) are production-ready, the frontend portal view can be further enhanced with dedicated parent-specific tabs (child switcher, consolidated tuition payments).

### Recommended Next Sprint
**Sprint: Billing & Payment Gateway Integration (Click & Payme Automated Webhooks)**  
With education operations, student enrollments, and tuition schedules hardened, the next logical milestone is productionizing online billing: Click/Payme webhook verification, signature validation, automatic receipt generation, and debtor notifications.
