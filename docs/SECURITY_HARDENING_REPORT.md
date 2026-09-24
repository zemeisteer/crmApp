# CRMAPP — Security Hardening Sprint Report

**Date:** September 23, 2026  
**Status:** Completed & Verified  
**Branch:** `dev`  
**Reference Specifications:** `POST_IMPLEMENTATION_AUDIT.md`, `CRMAPP_MASTER_SPEC_V2.md`

---

## Executive Summary

The **Security Hardening Sprint** is complete. All 6 priorities identified in the post-implementation audit have been remediated, verified, and automated with test suites. The core architectural change—transitioning `User` into a global identity and `organization_memberships` into the authoritative source of tenant relationships and access—is now fully enforced across staff management, invitations, workspace switching, and entity operations.

---

## 1. Files Changed

### Backend Modifications
- **`backend/src/staff/staff.service.ts`**:
  - Replaced legacy queries reliant on `users.tenantId` with queries to `organization_memberships`.
  - Refactored `findAll`, `create`, `update`, and `remove`.
  - Guaranteed non-destructive staff removal: removing staff in Tenant A deletes only the Tenant A membership record. The global `User` and their memberships in other tenants (e.g. Tenant B) remain completely untouched and active.
  - Added safeguards preventing self-removal and last-admin removal.
- **`backend/src/staff/staff.controller.ts`**:
  - Expanded `@Roles` decorator from `'ADMIN'` to `['ADMIN', 'OWNER']`.
- **`backend/src/invitations/invitations.service.ts`**:
  - Hardened invitation acceptance: eliminated invitation token account takeover. If the invited email/phone matches an existing CRMAPP user, acceptance strictly requires either an active session belonging to that exact user (`authenticatedUserId === user.id`) or explicit verification of their existing password via `bcrypt.compare`.
  - Removed `existingUser`/`existingUserName` from `validateToken` to prevent user enumeration.
  - Implemented parent invitation handling (`role = PARENT`): redirects to `/portal` without creating an education center or tenant.
- **`backend/src/invitations/invitations.controller.ts`**:
  - Extracted Bearer token for authenticated invitation acceptance.
  - Added endpoint rate limiting via `@Throttle` (10 req/min for `accept`, 20 req/min for `validate`).
- **`backend/src/onboarding/onboarding.controller.ts`**:
  - Added endpoint rate limiting via `@Throttle` (30 req/min) to `/api/onboarding/check-subdomain`.
- **`backend/src/auth/auth.service.ts`**:
  - Added `verifyAccessToken` helper.
  - Integrated `AuditService` logging when `SUPERADMIN` switches into any tenant workspace (`switch_workspace` event).
- **`backend/src/audit/audit.service.ts`**:
  - Expanded audit action union type to support `'switch_workspace' | string`.
- **`backend/src/branches/branches.service.ts`**:
  - Hardened `remove` to enforce tenant scoping by throwing `NotFoundException` (404) when attempting to delete a branch from another tenant.
- **`backend/src/attendance/attendance.service.ts`**:
  - Supported new `CRMAPP:STUDENT:` barcode/QR prefix while maintaining backward compatibility with `TALIMCRM:STUDENT:`.
- **`backend/src/email/email.service.ts`**:
  - Updated default `SMTP_FROM` to `CRMAPP <no-reply@crmapp.com>`.

### Frontend Modifications
- **`frontend/lib/api.ts`**:
  - Removed deprecated `existingUser`/`existingUserName` from `invitationsApi.validate` return type to match the hardened API.
- **`frontend/app/invite/[token]/page.tsx`**:
  - Updated acceptance UX to seamlessly use active session or require password verification without relying on user enumeration.
- **`frontend/app/layout.tsx`**:
  - Updated page title metadata from `TalimCRM` to `CRMAPP`.
- **`frontend/app/page.tsx`**:
  - Updated landing navigation header to `CRMAPP`.
- **`frontend/components/Sidebar.tsx`**:
  - Updated logo brand text to `CRMAPP` and user workspace domain to `${tenant.subdomain}.crmapp.com`.
- **`frontend/app/admin/page.tsx`**:
  - Updated tenant domain column to `${tn.subdomain}.crmapp.com`.
- **`frontend/app/settings/page.tsx`**:
  - Updated subdomain display to `${tenant.subdomain}.crmapp.com` and export filename to `crmapp-export-*.json`.
- **`frontend/app/site/[subdomain]/page.tsx`**:
  - Updated public portal footer to `CRMAPP platformasida yaratilgan`.
- **`frontend/app/students/[id]/page.tsx`**:
  - Updated student ID card header to `CRMAPP Education`, domain to `crmapp.com`, and QR data prefix to `CRMAPP:STUDENT:`.
- **`frontend/app/verify/[code]/page.tsx`**:
  - Updated credential portal header and footer to `CRMAPP`.
- **`frontend/app/attendance/page.tsx`**:
  - Updated input placeholder example to `CRMAPP:STUDENT:...`.
- **`frontend/lib/i18n.ts`**:
  - Cleaned user-facing brand strings across UZ, RU, and EN translations.

### New Test Suites
- **`backend/src/staff/staff.service.spec.ts`**: Unit tests verifying multi-tenant staff listing, creation, and non-destructive removal.
- **`backend/src/invitations/invitations.service.spec.ts`**: Unit tests for hardened invitation acceptance and validation.
- **`backend/test/security.e2e-spec.ts`**: Automated E2E test suite covering Tests A, B, C, D, and E against real HTTP endpoints.

---

## 2. Security Issues Fixed

1. **Staff Deletion Cascade & Identity Destruction (Priority 1):**
   - *Previous:* Calling `DELETE /api/staff/:id` in Tenant A directly invoked `db.delete(users).where(eq(users.id, id))`, destroying the user's global identity, credentials, and memberships across all other organizations.
   - *Fix:* `remove` in `StaffService` now targets `organization_memberships` scoped strictly to `tenantId`. The `users` table is never deleted. The user retains their global identity and active memberships in all other tenants.

2. **Invitation Account Takeover & Session Hijacking (Priority 2):**
   - *Previous:* Anyone intercepting an invitation link addressed to an existing user could submit `POST /api/invitations/:token/accept` with an empty body and receive an authenticated JWT session for that user without knowing their password.
   - *Fix:* If the invited email/phone matches an existing CRMAPP user, acceptance strictly requires either an active session belonging to that exact user (`authenticatedUserId === user.id`) or explicit verification of their existing password via `bcrypt.compare`.

3. **User Enumeration in Invitation Validation:**
   - *Previous:* `GET /api/invitations/:token/validate` returned `existingUser: boolean` and `existingUserName: string`, leaking whether the target identity held an active CRMAPP account.
   - *Fix:* Removed identity leakage from the public validation response.

4. **Cross-Tenant IDOR on Individual Entity Operations (Priority 3 / Test C):**
   - *Previous:* While most endpoints were scoped by tenant, `branches.service.ts` delete operation did not verify whether the returned row existed before reporting success.
   - *Fix:* Hardened `branches.service.ts` to assert that the target entity was actually deleted for that tenant, throwing `NotFoundException` (404) on cross-tenant attempts.

5. **SuperAdmin Tenant Workspace Entry Unaudited (Priority 4):**
   - *Previous:* When a `SUPERADMIN` switched into a customer tenant workspace via `selectWorkspace`, no audit entry was generated.
   - *Fix:* Integrated `AuditService.log` to record an explicit `switch_workspace` event containing admin email, target tenant details, IP, and user-agent.

6. **Endpoint Rate Limiting (Priority 5):**
   - *Previous:* Sensitive endpoints (`checkSubdomain`, invitation acceptance) were governed only by broad defaults.
   - *Fix:* Added `@Throttle` decorators to `/api/onboarding/check-subdomain` (30 req/min), `/api/invitations/:token/accept` (10 req/min), and `/api/invitations/:token/validate` (20 req/min).

---

## 3. `users.tenantId` Occurrences and Handling

| Location | Usage Type | Action Taken |
| :--- | :--- | :--- |
| `backend/src/staff/staff.service.ts` | Membership Authority & Deletion Target | **REFACTORED.** Completely replaced with queries to `organization_memberships`. `users` table is never mutated or deleted on staff operations. |
| `backend/src/auth/auth.service.ts` | Fallback for legacy single-tenant users | **PRESERVED AS FALLBACK.** Only evaluated if `memberships.length === 0` to preserve backward compatibility for legacy records. |
| `backend/src/db/schema.ts` | Column definition `users.tenantId` | **PRESERVED.** Column retained as nullable foreign key for backward compatibility. |
| `backend/src/auth/auth.service.ts` (`register`) | Initial creation helper | **DEPRECATED VALUE.** Sets `users.tenantId` on initial insert for backward compatibility, while authoritative access is established via `organization_memberships`. |

---

## 4. Tests Added & Verification Results

### A. Backend Unit Tests (`npm test`)
```text
 RUN  v4.1.11 C:/Users/user/Documents/GitHub/crmApp/backend

 ✓ src/leads/leads.service.spec.ts (11 tests)
 ✓ src/teachers/teachers.service.spec.ts (9 tests)
 ✓ src/expenses/expenses.service.spec.ts (5 tests)
 ✓ src/students/students.service.spec.ts (13 tests)
 ✓ src/telegram/telegram.service.spec.ts (6 tests)
 ✓ src/attendance/attendance.service.spec.ts (4 tests)
 ✓ src/staff/staff.service.spec.ts (5 tests)
 ✓ src/notifications/notifications.service.spec.ts (5 tests)
 ✓ src/portal/portal.service.spec.ts (6 tests)
 ✓ src/exams/exams.service.spec.ts (4 tests)
 ✓ src/invitations/invitations.service.spec.ts (12 tests)
 ✓ src/common/permissions.guard.spec.ts (5 tests)
 ✓ src/common/roles.guard.spec.ts (4 tests)
 ✓ src/onboarding/onboarding.service.spec.ts (7 tests)
 ✓ src/common/trial.guard.spec.ts (7 tests)
 ✓ src/salary/salary.service.spec.ts (2 tests)
 ✓ src/payments/payments.service.spec.ts (3 tests)
 ✓ src/homework/homework.service.spec.ts (3 tests)
 ✓ src/schedule/schedule.service.spec.ts (5 tests)

 Test Files  19 passed (19)
      Tests  116 passed (116)
```

### B. Backend E2E Tests (`npm run test:e2e`)
```text
 RUN  v4.1.11 C:/Users/user/Documents/GitHub/crmApp/backend

 ✓ test/app.e2e-spec.ts (2 tests)
     ✓ registers two separate tenants and keeps their groups isolated
 ✓ test/security.e2e-spec.ts (5 tests)
     ✓ Test A: admin creates PARENT invitation, parent accepts, role is PARENT, no new org created
     ✓ Test B: rejects workspace switching if user has no active membership in target tenant
     ✓ Test C: enforces tenant scoping on direct fetch, update, and delete across entities
     ✓ Test D: removing staff from Tenant A does NOT delete global User or Tenant B membership
     ✓ Test E: requires password or active matching session to accept invitation for existing user

 Test Files  2 passed (2)
      Tests  7 passed (7)
```

### C. Lint / Typecheck / Build Results
- **Backend Lint (`npm run lint`):** 0 errors.
- **Backend Build (`npm run build`):** Exit code 0 (clean compilation).
- **Frontend Typecheck (`npx tsc --noEmit`):** Exit code 0 (0 type errors).
- **Frontend Lint (`npm run lint`):** Exit code 0 (0 errors).
- **Frontend Build (`npm run build`):** Exit code 0 (all 35 routes compiled).

---

## 5. Security Checklist Confirmation

1. [x] **Non-destructive staff removal:** Removing staff from Tenant A cannot delete Tenant B identity or access.
2. [x] **No unauthenticated account takeover:** An invitation token alone cannot authenticate an existing CRMAPP user.
3. [x] **Unauthorized workspace switching blocked:** A user cannot select a workspace without an `ACTIVE` membership (returns 401).
4. [x] **Cross-tenant IDOR mitigated:** Tenant B cannot directly fetch, update, or delete Tenant A entities by knowing their IDs (returns 404).
5. [x] **Parent invitations verified:** Role `PARENT` assigns to portal without creating an organization.
6. [x] **SuperAdmin audit logging:** SuperAdmin workspace entries create explicit audit records.
7. [x] **Branding cleanup:** User-facing domains updated to `*.crmapp.com` and brand to `CRMAPP`.
8. [x] **Existing flows intact:** Multi-organization login and registration continue to work seamlessly.

---

## 6. Sprint Gate Decision

**The system is verified and SAFE to proceed to the next product-development sprint.**
