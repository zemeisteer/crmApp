# CRMAPP — PRODUCT, ARCHITECTURE & AI DEVELOPMENT MASTER SPEC
Version: 2.0
Status: Architecture Baseline / Source of Truth
Audience: Antigravity and other AI coding agents, developers, reviewers
Product type: Multi-tenant Education SaaS / CRM + LMS + ERP + AI
Primary market: Education centers
Architecture direction: Modular monolith first, independently scalable workers/integrations where justified

---

# 0. AI AGENT DIRECTIVE — READ THIS FIRST

This file defines the intended product and architecture. It is NOT permission to blindly rebuild the repository.

Before changing code:

1. Read this entire file.
2. Read `SETUP.md`, `RUNBOOK.md`, package manifests, environment examples, Docker/CI files, database schema and migrations.
3. Inspect the actual backend and frontend source tree.
4. Map existing implementation to this specification.
5. Run existing tests/build/typecheck/lint where possible.
6. Produce an audit before large implementation work.
7. Preserve working functionality unless migration is necessary.
8. Never invent an existing implementation. Verify it from code.
9. Never weaken tenant isolation, authentication, authorization, payment verification or auditability to make a feature easier.
10. Never expose secrets or privileged data to the frontend.
11. Never make destructive schema/data changes without a migration and rollback plan.
12. Prefer small, reviewable changes over huge rewrites.
13. Do not implement every item in this document at once. Work phase-by-phase.
14. If code and this document conflict, report the conflict before a destructive/high-risk change.
15. Keep this document and technical documentation updated when architecture materially changes.

For every major task, output before implementation:

- Current implementation
- Gap
- Proposed design
- Files/modules affected
- Database changes
- API changes
- Authorization/tenant implications
- Background jobs/events
- Migration/rollback plan
- Tests required
- Risks

After implementation, output:

- What changed
- Files changed
- Migrations created
- Tests run and results
- Security/tenant checks
- Known limitations
- Next recommended task

---

# 1. PRODUCT VISION

CRMAPP should become a complete digital operating system for education centers.

It is not only a student CRM.

It combines:

CRM
+ Admissions
+ LMS
+ Academic operations
+ Attendance
+ Scheduling
+ Finance
+ HR
+ Exams
+ Parent portal
+ Student portal
+ Teacher workspace
+ Communication
+ Telegram
+ AI
+ Analytics
+ SaaS billing
+ Integrations
+ Public education-center website

Main platform:
    crmapp.com

Tenant:
    academy.crmapp.com

Future custom domain:
    academy.uz

An education center should be able to digitize most daily operations without assembling many disconnected tools.

---

# 2. PRODUCT BOUNDARIES

CRMAPP has THREE distinct surfaces.

## A. CRMAPP Platform

Owned by the SaaS operator.

Examples:
- crmapp.com marketing site
- signup/onboarding
- plan selection
- SaaS checkout
- platform SuperAdmin
- subscriptions
- tenant lifecycle
- global feature management
- platform support

## B. Education Center Workspace

Example:
    academy.crmapp.com

Used by:
- owner/admin
- manager
- receptionist
- accountant
- teacher
- other staff

## C. Education User Portals

Used by:
- student
- parent

These surfaces may share the same application/codebase, but permissions and UX must be clearly separated.

---

# 3. CURRENT REPOSITORY BASELINE — VERIFY FROM CODE

Repository:
    zemeisteer/crmApp

Known from current project documentation:
- Backend: NestJS 12
- ORM: Drizzle
- Database: PostgreSQL
- API: REST under `/api`
- Frontend: Next.js 16 App Router
- Docker Compose
- GitHub Actions
- Unit/E2E testing exists
- Tenant isolation exists
- RBAC exists
- Student/teacher/group modules exist
- Attendance/payments/salaries/homework/branches exist
- Excel import/export exists
- PDF receipt exists
- Audit logging exists
- SuperAdmin functionality exists
- Password reset/email verification/refresh token exist
- Telegram integration exists
- Click/Payme integration exists
- AI analysis/material features exist
- Database backup tooling exists

IMPORTANT:
Treat this list only as a discovery map. Inspect actual code before trusting completeness or quality.

Do not rebuild these modules until audited.

---

# 4. ARCHITECTURAL PRINCIPLES

## 4.1 Modular Monolith First

Do NOT prematurely split the system into microservices.

Preferred initial architecture:

    Next.js Frontend
           |
        REST API
           |
       NestJS App
    ┌──────┼──────────────┐
    Core  Education      Platform
    CRM   Finance/AI     SaaS
           |
       PostgreSQL
           |
    Redis / Queue / Workers
           |
    External Integrations

Separate workers are appropriate for:
- notifications
- scheduled reminders
- email/SMS/Telegram delivery
- AI generation
- imports/exports
- PDFs
- long reports
- webhooks/retries

Microservices may be introduced later only when scale/team/deployment boundaries justify them.

## 4.2 Domain Modules

Recommended domain boundaries:

platform/
tenancy/
identity/
organizations/
branches/
admissions/
students/
parents/
staff/
teachers/
subjects/
courses/
groups/
scheduling/
attendance/
homework/
materials/
exams/
certificates/
finance/
payroll/
billing/
notifications/
announcements/
telegram/
communications/
ai/
analytics/
files/
integrations/
audit/
support/

Avoid circular dependencies and giant "common service" modules.

---

# 5. MULTI-TENANCY — NON-NEGOTIABLE

Every education center is a tenant/organization.

Example:
    academy-a.crmapp.com
    academy-b.crmapp.com

Tenant A must NEVER read, modify, infer or enumerate Tenant B data.

Requirements:
- Server-derived tenant context
- Tenant-aware database queries
- Tenant ownership validation
- Tenant-scoped unique constraints where appropriate
- Tenant indexes
- Tenant-aware cache keys
- Tenant-aware background jobs
- Tenant-aware object storage paths
- Tenant-aware analytics
- Tenant-aware exports
- Tenant-aware audit logs

Never trust `tenantId` from request body/query as authorization.

Cross-tenant tests are mandatory for every new tenant-owned module.

Test:
    authenticated Tenant A user
        -> requests Tenant B object
        -> receives denial/not-found
        -> zero Tenant B information leakage

SuperAdmin cross-tenant access must be explicit, audited and separated from normal tenant authorization.

---

# 6. TENANT LIFECYCLE

Possible tenant states:

TRIAL
ACTIVE
PAST_DUE
GRACE_PERIOD
SUSPENDED
CANCELLED
ARCHIVED

Rules:
- Failed SaaS payment must not immediately destroy customer data.
- Suspended tenant behavior must be defined.
- Data retention after cancellation must be configurable/documented.
- Reactivation must be possible within retention rules.
- Destructive deletion should require explicit workflow and audit trail.

---

# 7. SUBDOMAIN & DOMAIN RESOLUTION

Default:
    {slug}.crmapp.com

Future:
    academy.uz

Requirements:
- Unique normalized tenant slug
- Reserved slug list (`www`, `api`, `admin`, etc.)
- Domain verification
- HTTPS
- Secure tenant mapping
- Custom domain ownership verification
- Prevent host-header/domain spoofing
- Do not derive authorization solely from unvalidated Host header

---

# 8. IDENTITY, AUTHENTICATION & SESSIONS

Support as appropriate:
- Email/password
- Phone/OTP
- Email verification
- Password reset
- Refresh sessions
- Optional Google login
- Optional 2FA for privileged users

Security:
- Strong password hashing
- Token rotation/revocation
- Secure HttpOnly cookies where chosen
- Short-lived access credentials
- Refresh token reuse detection where applicable
- Logout all devices
- Session/device list
- Brute-force protection
- Rate limiting
- Login audit events

Do not store plaintext passwords/tokens.

---

# 9. RBAC + PERMISSIONS

Base roles:

PLATFORM_SUPERADMIN

Tenant roles:
OWNER
ADMIN
MANAGER
RECEPTIONIST
ACCOUNTANT
TEACHER
STUDENT
PARENT

Future:
CUSTOM_ROLE

Prefer capability-based permissions behind roles.

Examples:
students.read
students.create
students.update
payments.read
payments.create
attendance.mark
exams.publish
staff.manage
settings.manage
reports.export

Backend is final authority.

Frontend permission checks are UX only.

Branch-scoped permissions should be supported when required.

---

# 10. ORGANIZATION & BRANCHES

Organization:
- name
- legal/business details where required
- logo
- timezone
- locale
- currency
- contact details
- tenant slug
- custom domain
- plan/subscription
- settings

Branches:
- name
- address
- rooms
- staff
- groups
- schedules
- branch-specific reporting

Example:
    ABC Academy
      ├── Chilanzar
      ├── Yunusabad
      └── Sergeli

---

# 11. EDUCATION MODEL — SUBJECT AGNOSTIC

Never hard-code the product around English.

Core hierarchy:

Organization
  -> Subject
      -> Course/Program
          -> Level
              -> Group/Cohort
                  -> Enrollment

Examples:

English:
- General English
- IELTS
- CEFR
- Speaking

Mathematics:
- Algebra
- Geometry
- SAT Math

IT:
- Python
- Web Development
- AI Fundamentals

Mixed centers must use multiple subjects simultaneously.

---

# 12. ADMISSIONS / SALES CRM

A professional education CRM needs pre-student lead management.

Lead lifecycle:
NEW
CONTACTED
TRIAL_BOOKED
TRIAL_ATTENDED
QUALIFIED
ENROLLED
LOST

Features:
- Lead profile
- Source (Instagram, Telegram, referral, website, walk-in, ad)
- Desired subject/course
- Branch
- Assigned manager
- Follow-up date
- Notes
- Trial lesson
- Conversion to student
- Lost reason
- Funnel analytics

This must be separate from enrolled students while supporting one-click conversion.

Future:
- marketing campaign attribution
- UTM capture
- lead forms
- call integration

---

# 13. STUDENTS

Student profile:
- identity/contact
- parent/guardian links
- branch
- enrollments
- groups
- subjects/courses
- attendance
- homework
- exams/results
- payments/debt
- documents
- notes
- status
- communication preferences

Avoid putting every field into one giant students table. Normalize domain relationships.

Possible statuses:
ACTIVE
PAUSED
GRADUATED
LEFT
ARCHIVED

---

# 14. PARENTS / GUARDIANS

A parent may have multiple children.
A student may have multiple guardians.

Features:
- contact information
- linked children
- relationship type
- notification preferences
- attendance visibility
- academic visibility
- payment visibility
- teacher feedback
- announcements

Privacy rules must define what each guardian can see.

---

# 15. STAFF & TEACHERS

Teacher:
- profile
- subjects
- groups
- schedule
- attendance/workload
- salary rules
- academic performance metrics
- materials
- permissions

Other staff:
- admin
- manager
- receptionist
- accountant

Do not force all staff into teacher-specific models.

---

# 16. GROUPS, ENROLLMENTS & COHORTS

Group:
- subject
- course
- level
- teacher(s)
- branch
- room
- capacity
- schedule
- start/end dates
- status

Enrollment should represent student membership in a group/course over time.

Keep enrollment history.

Do not lose history when a student changes group.

---

# 17. SCHEDULING

Features:
- recurring lessons
- one-time lessons
- teacher
- group
- room
- branch
- online meeting link
- holiday/calendar exceptions
- substitutions
- rescheduling

Conflict detection:
- teacher collision
- room collision
- group collision

Timezone must be organization-aware.

---

# 18. ATTENDANCE

Statuses:
PRESENT
ABSENT
LATE
EXCUSED

Requirements:
- teacher/admin marking
- optional bulk marking
- correction history
- attendance analytics
- parent/student visibility
- event emission for notifications

Do not overwrite sensitive attendance history without auditability.

---

# 19. LMS / LEARNING MATERIALS

Materials:
- documents
- videos/links
- lesson notes
- exercises
- downloadable resources

Scope:
- subject
- course
- group
- lesson
- individual student where required

Permissions must prevent cross-tenant/file leakage.

---

# 20. HOMEWORK

Teacher:
- create
- attach resources
- assign
- deadline
- grading rubric
- review
- feedback

Student:
- view
- submit
- resubmit if allowed
- see grade/feedback

Parent:
- see status where allowed

Events:
HomeworkAssigned
HomeworkDeadlineApproaching
HomeworkSubmitted
HomeworkGraded

---

# 21. EXAM ENGINE

Build one reusable exam engine, not separate hard-coded engines for every subject.

Core entities:
Exam
ExamSection
QuestionBank
Question
QuestionOption
ExamAttempt
Answer
Result
Rubric

Question types:
- MCQ
- multiple select
- true/false
- matching
- short answer
- numeric
- essay
- reading-based
- listening-based
- file response
- custom extensible type

Capabilities:
- draft/publish
- scheduling
- attempt limits
- timer
- randomization
- question pools
- difficulty
- auto grading
- manual grading
- partial credit
- review policy
- analytics

Support through configuration:
- IELTS
- SAT
- CEFR
- DTM
- mathematics
- school tests
- custom exams

---

# 22. MOCK EXAMS

Mock exams are configured on top of Exam Engine.

Example:
IELTS:
- Listening
- Reading
- Writing
- Speaking

SAT:
- Math
- Reading/Writing if enabled

Store:
- attempts
- section scores
- total score
- evaluator feedback
- progress trend

Do not duplicate exam infrastructure.

---

# 23. CERTIFICATES

Optional module:
- certificate templates
- completion certificates
- exam certificates
- unique verification code
- public verification page with minimal safe data
- PDF generation

Never expose private student information through verification links.

---

# 24. FINANCE — STUDENT/CENTER

This is tenant business finance, separate from CRMAPP SaaS billing.

Features:
- tuition plans
- invoices/charges
- payments
- debt
- discounts
- scholarships/adjustments
- refunds where supported
- receipts
- cash/card/provider payment types
- payment history
- branch revenue
- cashier/accountant audit

Ledger-like financial history should be append-friendly and auditable.

Avoid silently editing historical transactions.

---

# 25. PAYROLL / TEACHER SALARIES

Support configurable salary models later:
- fixed
- per lesson
- per student
- percentage
- hybrid

Payroll calculation must be explainable and auditable.

Do not couple payroll directly to payment provider transactions.

---

# 26. CRMAPP SAAS BILLING — SEPARATE DOMAIN

Center pays CRMAPP.

Entities:
Plan
PlanFeature
Subscription
SubscriptionItem
Invoice
BillingTransaction
UsageMeter
Entitlement

Lifecycle:
trial
activation
renewal
upgrade
downgrade
past due
grace period
suspension
cancellation
reactivation

Never mix:
Student -> Center payment
with
Center -> CRMAPP subscription payment

---

# 27. CLICK / PAYME / PAYMENT PROVIDERS

Use provider adapters.

Example:
PaymentProvider
  ├── ClickAdapter
  ├── PaymeAdapter
  └── FutureProviderAdapter

Requirements:
- signature/auth verification
- server-side amount verification
- idempotency
- replay protection
- transaction state machine
- raw provider reference
- structured logs without secrets
- webhook retries
- duplicate webhook safety
- reconciliation strategy

Frontend "payment successful" is never authoritative.

---

# 28. PLANS, LIMITS & ENTITLEMENTS

Plans must be data-driven/configurable.

Possible limits:
- active students
- staff
- branches
- storage
- AI credits
- exam attempts
- SMS usage
- API usage
- custom domains

Possible features:
AI_TUTOR
AI_GENERATOR
MOCK_EXAMS
CUSTOM_DOMAIN
API_ACCESS
TELEGRAM
ADVANCED_ANALYTICS
MULTI_BRANCH
AUTO_PAYMENTS
CERTIFICATES

Do not scatter plan-name checks such as:
    if plan === "PRO"

Use entitlement/feature services.

---

# 29. FEATURE FLAGS

Feature flags and plan entitlements are related but not identical.

Feature flag use:
- staged rollout
- beta
- emergency disable
- tenant override
- environment control

Entitlement use:
- commercial plan access

Keep the distinction clear.

---

# 30. NOTIFICATION ENGINE

Central notification architecture:

Domain Event
   -> Notification Orchestrator
       -> preference/audience evaluation
       -> queue
           ├── Telegram
           ├── Email
           ├── SMS
           ├── Push
           └── In-App

Do not send every external notification synchronously inside request handlers.

Events:
LessonStartingSoon
LessonRescheduled
AttendanceMarked
HomeworkAssigned
HomeworkGraded
ExamPublished
ExamResultPublished
PaymentDue
PaymentReceived
AnnouncementPublished
SubscriptionPastDue

Requirements:
- retry
- delivery status
- deduplication
- user preferences
- templates
- localization
- quiet hours where appropriate
- provider error handling

---

# 31. TELEGRAM BOT — PRODUCT ROLE

Telegram is a first-class communication channel.

Student:
- today's schedule
- lesson reminders
- homework
- exam reminders
- results
- announcements
- payment reminders
- optional AI Tutor entry point

Parent:
- child attendance
- schedule changes
- homework
- results
- payment/debt reminders
- announcements

Teacher:
- daily schedule
- group updates
- submissions
- exam reminders
- admin announcements

Admin:
- optional operational alerts

Bot commands/UI may include:
- My Schedule
- Homework
- Exams
- Results
- Payments
- News
- Settings

Do not expose sensitive data before secure account linking.

---

# 32. TELEGRAM ACCOUNT LINKING — SECURITY CHANGE

Do NOT use an insecure flow like:

    /start <studentId>

A predictable student ID is not sufficient authentication.

Use short-lived, signed, single-use linking tokens.

Recommended flow:

Authenticated CRMAPP user
    -> clicks "Connect Telegram"
    -> backend creates random one-time token
    -> token has expiration + intended user + tenant
    -> deep link opens Telegram bot
    -> bot sends token to backend
    -> backend validates token
    -> stores Telegram numeric user ID
    -> token is consumed
    -> connection confirmed

Store:
- crmappUserId
- telegramUserId
- tenantId
- linkedAt
- status

Never use Telegram username as stable identity.

Allow disconnect/revoke.

Audit linking events.

---

# 33. ANNOUNCEMENTS & NEWS

Admin creates:
- title
- body
- audience
- branch
- group
- role
- publish time
- expiration
- channels
- priority

Audience examples:
- everyone
- students
- parents
- teachers
- specific branch
- specific group

Channels:
- in-app
- Telegram
- email
- SMS
- push

Scheduled publication should use jobs/queues.

---

# 34. IN-APP COMMUNICATION

Start simple:
- announcements
- system notifications
- teacher feedback
- admin broadcasts

Do not build Slack/WhatsApp-level chat during MVP unless required.

Future:
- direct messaging
- group messaging
- teacher-parent messaging
- moderation/retention controls

---

# 35. AI PLATFORM

AI must be an internal platform capability with provider abstraction.

Architecture:

AI Gateway/Service
  -> policy & entitlement
  -> usage/quota
  -> context builder
  -> provider adapter
      ├── OpenAI
      ├── Anthropic
      └── Google
  -> structured output validation
  -> audit/usage metadata

Features:
- AI Tutor
- Test generator
- Question generator
- Homework generator
- Lesson planner
- Material generator
- Essay feedback
- Speaking practice/evaluation
- Student progress summary
- Teacher assistant

Provider keys stay server-side.

Never allow a tenant to retrieve another tenant's AI context.

---

# 36. AI SAFETY & QUALITY

AI-generated educational content is not automatically authoritative.

Rules:
- teacher-generated content should be editable before publishing
- validate structured outputs
- show generation failures gracefully
- do not silently fabricate grades
- deterministic grading rules should remain deterministic where possible
- AI-assisted subjective grading should preserve teacher review when required
- store model/provider/version metadata where useful
- protect student personal data
- minimize unnecessary PII sent to providers
- enforce tenant AI quota
- add cost/usage monitoring

---

# 37. AI TUTOR

Tutor context may include only authorized/relevant:
- subject
- course
- level
- assigned materials
- student's own results/progress

Potential capabilities:
- explanations
- guided practice
- quizzes
- hints
- study plans

Do not provide raw hidden answers to active graded assessments unless product rules explicitly allow it.

---

# 38. ANALYTICS

Platform analytics:
- MRR/ARR if billing supports it
- active tenants
- trials
- conversion
- churn events
- payment failures
- feature usage
- AI usage
- storage/API usage

Tenant analytics:
- active students
- leads
- lead conversion
- attendance
- revenue
- debt
- retention
- group occupancy
- teacher workload
- exam performance
- course performance

Student:
- attendance
- results
- progress
- weak/strong areas
- learning activity

Analytics queries must remain tenant-scoped.

---

# 39. PUBLIC TENANT WEBSITE / CMS

Each center may optionally have a public-facing website under its subdomain/custom domain.

Example:
    academy.crmapp.com

Public sections:
- Home
- About
- Courses
- Teachers
- Results/achievements
- News
- Contact
- Branches
- Lead/application form

Tenant admin should manage public content without code.

Do not expose internal CRM routes/data publicly.

Public lead forms feed Admissions CRM.

---

# 40. CRMAPP MARKETING WEBSITE

crmapp.com should include:

Home:
- Hero
- clear value proposition
- product demo/screens
- role-based benefits
- feature categories
- AI
- Telegram/communication
- payment integrations
- analytics
- testimonials/clients when real
- achievements when real
- pricing CTA
- FAQ

Pages:
- Features
- Solutions
- Pricing
- AI
- Integrations
- Security
- About
- FAQ
- Contact
- Login
- Start Trial / Get Started

Never invent clients, statistics or testimonials.

---

# 41. ONBOARDING

Suggested flow:

Account
 -> verify
 -> organization name
 -> subdomain
 -> timezone/locale/currency
 -> branch
 -> subjects
 -> courses
 -> staff
 -> import students
 -> payment settings
 -> Telegram
 -> notification preferences
 -> launch checklist

Support save-and-resume.

Do not require every optional integration before the center can start.

---

# 42. LOCALIZATION

Architecture should support:
- Uzbek
- Russian
- English

Future languages should be possible.

Requirements:
- UI translation keys
- locale-aware dates/numbers
- tenant timezone
- configurable currency
- localized notification templates

Do not hard-code user-facing strings deep inside business logic.

---

# 43. FILES & OBJECT STORAGE

Use object storage for:
- profile images
- homework submissions
- documents
- materials
- certificates
- organization assets

Requirements:
- tenant ownership
- authorization
- file type allowlist
- file size limits
- malware scanning option for production
- signed/private URLs where required
- retention/deletion policy

Do not store large binary files directly in PostgreSQL.

---

# 44. IMPORT / EXPORT

Import:
- students
- parents
- teachers
- groups
- leads

Flow:
upload
 -> parse
 -> preview
 -> validate
 -> show valid/invalid/duplicate
 -> confirm
 -> transaction/batched import
 -> result report

Exports:
- Excel/CSV
- PDF reports where appropriate

Exports must enforce tenant and role permissions.

---

# 45. REPORTING

Reports:
- attendance
- students
- admissions funnel
- payments
- debt
- revenue
- teacher workload
- salaries
- group occupancy
- exams/results
- AI usage
- subscription usage

Large reports should be asynchronous.

---

# 46. API DESIGN

Version public/stable APIs:
    /api/v1/...

Use consistent:
- pagination
- filtering
- sorting
- validation
- error format
- authorization
- request IDs
- idempotency for appropriate mutations

Potential future:
- API keys
- OAuth
- webhooks
- developer portal
- usage limits

Do not expose raw database internals unnecessarily.

---

# 47. WEBHOOKS

CRMAPP may both receive and send webhooks.

Inbound:
- payment providers
- Telegram
- other integrations

Outbound future:
- student.created
- payment.received
- attendance.marked
- exam.result.published

Requirements:
- signatures
- timestamp/replay protection
- retries
- idempotency
- delivery logs
- secret rotation

---

# 48. BACKGROUND JOBS / QUEUES

Use Redis + a queue implementation if consistent with the stack.

Candidates:
- Telegram
- email
- SMS
- scheduled reminders
- AI jobs
- PDF generation
- imports
- exports
- report generation
- payment reconciliation/retry

Jobs must include tenant context.

Jobs must be retry-safe/idempotent.

Use dead-letter/failure visibility for critical jobs.

---

# 49. CACHE

If Redis caching is introduced:
- tenant ID must be part of tenant-scoped cache keys
- define TTL
- invalidate safely
- never cache privileged response under non-privileged key
- avoid cache-based cross-tenant leaks

Correct conceptual key:
    tenant:{tenantId}:student:{studentId}

---

# 50. DATABASE

PostgreSQL remains primary transactional DB.

Rules:
- migrations are mandatory for production
- review generated migrations
- foreign keys
- indexes
- tenant-aware composite uniqueness
- transactions for multi-step critical operations
- avoid N+1 patterns
- soft delete only where business/audit needs justify it
- do not treat soft delete as security
- timestamps
- immutable IDs
- explicit money representation; avoid floating point for money

Money:
Use integer minor units or a precise decimal strategy consistently.

---

# 51. DATA INTEGRITY

Examples:
- enrollment history cannot disappear when group changes
- paid transaction cannot silently become unpaid without audit
- duplicate payment webhook cannot double-credit
- teacher cannot be scheduled twice simultaneously
- room cannot be double-booked
- parent cannot see unrelated student
- tenant cannot exceed plan limits without defined behavior

Use database constraints when possible, not only application checks.

---

# 52. AUDIT LOG

Audit sensitive/admin actions.

Include:
- actor
- tenant
- action
- entity type
- entity ID
- timestamp
- request ID
- safe metadata
- before/after diff where appropriate

Never put passwords, full secrets or sensitive payment credentials into audit logs.

---

# 53. SECURITY BASELINE

Required:
- tenant isolation
- RBAC
- authentication
- input validation
- rate limiting
- brute-force protection
- secure password hashing
- token/session security
- CSRF strategy if cookie auth is used
- XSS prevention
- security headers
- CORS allowlist
- SQL injection resistance
- safe file uploads
- SSRF awareness for URL integrations
- webhook verification
- secret management
- dependency scanning
- audit logging
- backup/restore testing

High-risk flows require focused tests:
- login/reset
- role changes
- tenant changes
- payments
- Telegram linking
- file downloads
- exports
- SuperAdmin operations

---

# 54. PRIVACY & DATA LIFECYCLE

Define:
- what student/parent data is collected
- why it is collected
- who can access it
- retention
- export
- correction
- deletion/anonymization where required
- backups retention
- account deletion
- organization cancellation handling

Legal/privacy text should be reviewed for the actual launch jurisdiction before production.

Required public policies eventually:
- Terms
- Privacy
- Subscription terms
- Refund/payment policy
- Cookie policy where applicable

---

# 55. OBSERVABILITY

Use:
- structured logs
- request IDs
- error tracking
- performance monitoring
- health checks
- DB monitoring
- queue monitoring
- provider health

Track:
- API errors/latency
- slow DB queries
- payment failures
- Telegram failures
- email/SMS failures
- AI failures/cost
- queue backlog
- storage usage
- subscription events

Do not log secrets.

---

# 56. BACKUP & DISASTER RECOVERY

Existing backup tooling must be audited.

Production:
- automated DB backups
- off-server/off-database storage
- encryption where appropriate
- retention schedule
- restore procedure
- periodic restore test
- object storage backup/versioning strategy
- documented RPO/RTO targets later

A backup that has never been restored in testing is not considered fully verified.

---

# 57. DEPLOYMENT

Environments:
DEVELOPMENT
STAGING
PRODUCTION

Requirements:
- Docker
- CI/CD
- migrations
- secret management
- health checks
- HTTPS
- wildcard DNS/certificate for subdomains
- rollback strategy
- zero/minimal downtime migrations where feasible
- staging payment/provider configuration
- production monitoring

Never use production keys in development.

---

# 58. CI/CD QUALITY GATES

On pull request / merge where feasible:
- install
- lint
- typecheck
- unit tests
- integration/E2E critical tests
- production build
- migration sanity check
- dependency/security checks

Do not deploy if critical tenant-isolation/security tests fail.

---

# 59. FRONTEND UX STANDARD

All important pages need:
- loading state
- empty state
- error state
- success feedback
- validation
- permission-aware controls
- responsive layout
- keyboard/accessibility basics
- confirmation for destructive actions

Dashboard UX must differ by role.

Avoid one giant admin UI reused awkwardly for students/parents.

---

# 60. DESIGN SYSTEM

Use a reusable design system:
- typography
- spacing
- buttons
- forms
- cards
- tables
- dialogs
- badges
- status colors/tokens
- charts
- navigation
- mobile behavior

Do not create inconsistent one-off components for every module.

Support tenant branding later:
- logo
- organization name
- limited brand color configuration
- custom domain

Tenant branding must not break accessibility.

---

# 61. SEARCH

Global tenant search may cover:
- students
- parents
- teachers
- leads
- groups
- invoices

Requirements:
- tenant scope
- permission scope
- pagination
- safe indexing

Do not expose existence of inaccessible records in search suggestions.

---

# 62. SUPPORT / HELP CENTER

Platform support:
- support ticket
- category
- priority
- status
- tenant
- assigned support user
- messages
- attachments
- audit

Knowledge base:
- setup
- payments
- Telegram
- users
- imports
- FAQ

Do not let platform support impersonate tenant users silently. Any impersonation/support-access feature must be explicit, limited and audited.

---

# 63. OPTIONAL FUTURE MODULES — NOT MVP

Keep architecture extensible, but do NOT implement now unless requested:
- native mobile apps
- advanced real-time chat
- gamification
- badges/leaderboards
- inventory
- library management
- transportation
- biometric attendance
- QR attendance
- call center integration
- marketing automation
- WhatsApp integration
- marketplace
- white-label mobile apps
- advanced workflow builder

Avoid scope explosion.

---

# 64. MVP / V1 DEFINITION

V1 should prove that a real education center can operate daily.

V1 priority:
1. Secure tenancy/auth/RBAC
2. Organization/branches/settings
3. Admissions leads
4. Students/parents
5. Teachers/staff
6. Subjects/courses/groups/enrollments
7. Schedule
8. Attendance
9. Homework/materials
10. Student payments/debt/receipts
11. Basic reports
12. Student/parent/teacher portals
13. Announcements
14. Secure Telegram notifications
15. CRMAPP plan/subscription foundation
16. Production hardening

AI and advanced exams can be layered after core data integrity is strong, unless existing implementations are already mature.

---

# 65. DEVELOPMENT ROADMAP

## PHASE 0 — REPOSITORY AUDIT & ARCHITECTURE LOCK
- inventory modules
- run tests/build
- inspect DB schema/migrations
- tenant isolation audit
- RBAC/auth audit
- payment audit
- Telegram audit
- AI audit
- frontend route audit
- identify dead/duplicate code
- dependency/security audit
- architecture decision records

OUTPUT ONLY AUDIT + PLAN FIRST.

## PHASE 1 — CORE DOMAIN CORRECTIONS
- organization
- branches
- identity
- RBAC
- subjects
- courses
- enrollments
- normalized relationships
- migrations
- tenant tests

## PHASE 2 — ADMISSIONS + PEOPLE
- leads
- conversion
- students
- parents
- staff
- teachers

## PHASE 3 — ACADEMIC OPERATIONS
- groups
- scheduling
- rooms
- attendance
- homework
- materials

## PHASE 4 — FINANCE
- student invoices/charges
- payments
- debt
- receipts
- salary/payroll foundation
- Click/Payme hardening

## PHASE 5 — PORTALS & COMMUNICATION
- student
- parent
- teacher
- notification engine
- announcements
- secure Telegram linking
- email/SMS abstraction

## PHASE 6 — EXAMS
- question bank
- exam engine
- attempts
- grading
- mock configurations
- analytics

## PHASE 7 — AI
- provider abstraction
- quota
- tutor
- generators
- structured outputs
- teacher review
- usage analytics

## PHASE 8 — SAAS COMMERCIAL LAYER
- plans
- entitlements
- usage limits
- SaaS invoices
- renewals
- grace period
- feature flags
- custom domains

## PHASE 9 — PUBLIC SITES & GROWTH
- crmapp.com
- tenant CMS/public site
- lead forms
- SEO
- onboarding

## PHASE 10 — PRODUCTION HARDENING
- security review
- E2E
- load tests
- backup restore test
- observability
- CI/CD
- staging
- production

---

# 66. REQUIRED CRITICAL TEST MATRIX

Every critical domain must test happy path + unauthorized + cross-tenant + invalid state.

Mandatory scenarios:

1. Tenant A cannot read Tenant B student.
2. Tenant A cannot update/delete Tenant B entity.
3. Parent cannot see unrelated child.
4. Teacher cannot perform admin-only finance action.
5. Suspended tenant behavior matches policy.
6. Duplicate payment webhook does not duplicate payment.
7. Forged payment callback fails.
8. Expired Telegram link token fails.
9. Reused Telegram link token fails.
10. Telegram link token for User A cannot link User B.
11. File URL/access cannot leak cross-tenant data.
12. Export includes only permitted tenant data.
13. Background job preserves tenant context.
14. Cache cannot leak tenant data.
15. Subscription limit enforcement is consistent.
16. Concurrent schedule creation cannot double-book.
17. Group change preserves enrollment history.
18. Migration can apply cleanly on staging-like DB.
19. Critical workflows survive provider failure.
20. SuperAdmin actions are audited.

---

# 67. DEFINITION OF DONE

A feature is complete only when relevant items are satisfied:

- domain model correct
- migration exists
- backend implemented
- authorization implemented
- tenant isolation enforced
- API validated
- frontend implemented
- responsive UX
- loading/error/empty states
- audit logging where required
- notifications/events where required
- tests
- build/typecheck/lint pass
- docs updated
- no secrets exposed
- rollback/production impact understood

"Page exists" is not Done.

"Endpoint returns 200" is not Done.

---

# 68. CODING RULES FOR ANTIGRAVITY

1. Follow existing project conventions unless they are unsafe.
2. Prefer typed DTOs/schemas and strict validation.
3. Do not use `any` to bypass type problems without justification.
4. Do not duplicate business rules between controllers.
5. Keep controllers thin; business logic belongs in services/domain layer.
6. Keep provider-specific payment/AI/notification code behind adapters.
7. Never concatenate raw SQL from user input.
8. Never log credentials/tokens.
9. Never hard-code plan names, tenant IDs, API secrets or production domains.
10. Do not silently catch errors.
11. Use transactions for critical multi-write operations.
12. Make webhook/job handlers idempotent.
13. Preserve backwards compatibility or document migration.
14. Add indexes based on real query patterns.
15. Avoid premature optimization, but prevent obvious N+1 and unbounded queries.
16. All list APIs must have sane pagination.
17. All tenant-owned new tables require explicit tenant ownership strategy.
18. All destructive endpoints require authorization and appropriate confirmation/audit.
19. No fake/demo business data in production paths.
20. Never claim tests passed unless actually executed.

---

# 69. DATABASE CHANGE PROTOCOL

For every schema change:

1. Explain reason.
2. Identify existing data impact.
3. Create migration.
4. Avoid destructive change when additive migration works.
5. Backfill safely if required.
6. Add constraints after data is valid.
7. Add indexes.
8. Test migration.
9. Define rollback/forward-fix approach.
10. Update schema docs.

Do not use dev `db:push` as the production migration strategy.

---

# 70. API CHANGE PROTOCOL

For every meaningful API change:
- endpoint
- method
- auth
- permission
- tenant behavior
- request schema
- response schema
- errors
- pagination
- idempotency if relevant
- backward compatibility

Avoid random endpoint naming.

---

# 71. SECURITY REVIEW QUESTIONS FOR EVERY FEATURE

Before marking done, ask:

- Can Tenant A access Tenant B data?
- Can a lower role call this endpoint directly?
- Can IDs be guessed?
- Can input be replayed?
- Can the action be duplicated?
- Can a race condition corrupt state?
- Does this expose PII?
- Does this log secrets?
- Can uploaded content be abused?
- Can external URLs cause SSRF?
- Is there rate limiting where abuse is realistic?
- Is this action auditable?
- What happens if external provider is down?

---

# 72. PERFORMANCE PRINCIPLES

Do not optimize blindly.

But enforce:
- pagination
- indexes
- bounded queries
- background processing for slow jobs
- DB connection management
- avoid N+1
- caching only with correct tenant isolation
- load test high-value endpoints

Likely hot paths:
- dashboard
- students list/search
- attendance
- schedules
- notifications
- payment webhook
- analytics

---

# 73. FAILURE DESIGN

External providers will fail.

System must degrade gracefully.

Telegram unavailable:
- store failure
- retry
- core attendance still succeeds

AI unavailable:
- core CRM continues
- show retryable error
- do not corrupt assignment/exam

Payment provider timeout:
- do not assume success/failure incorrectly
- reconcile

Email unavailable:
- queue/retry
- surface operational status

Design failure behavior intentionally.

---

# 74. PRODUCT METRICS

Instrument later:
- tenant activation
- onboarding completion
- active centers
- active students
- lead conversion
- attendance usage
- payment collection usage
- Telegram connection rate
- notification delivery rate
- AI adoption
- exam usage
- subscription conversion
- churn reason

Do not collect unnecessary personal data just for analytics.

---

# 75. IMMEDIATE TASK FOR ANTIGRAVITY

DO NOT START FEATURE DEVELOPMENT YET.

Perform a repository-wide technical audit.

Inspect:
- root files
- backend package/config
- backend module tree
- controllers/services/guards
- database schema
- migrations
- tenant implementation
- auth/session implementation
- RBAC
- students/teachers/groups
- attendance
- scheduling
- payments
- billing
- salaries
- homework
- branches
- audit logs
- Telegram
- Click
- Payme
- AI
- SuperAdmin
- files/import/export
- frontend routes/layouts
- role dashboards
- API client
- middleware
- Docker
- CI/CD
- tests
- env handling
- logs/backups

Run, where available:
- install
- lint
- typecheck
- tests
- E2E
- production build

Then produce:

## A. Executive Summary

## B. Architecture Map

## C. Module Audit Table

Columns:
MODULE | STATUS | CURRENT CODE | GAPS | SECURITY RISK | DEPENDENCIES | PRIORITY

Status:
🟢 READY
🟡 IMPROVE
🔴 REWORK
⚪ MISSING

## D. Database Audit
- tables
- relationships
- tenant ownership
- missing constraints
- missing indexes
- risky schema choices

## E. Security Audit
- auth
- RBAC
- tenant isolation
- secrets
- payment webhooks
- Telegram linking
- file access
- SuperAdmin

## F. Frontend Audit
- routes
- role UX
- missing states
- responsive/accessibility
- API consistency

## G. Infrastructure Audit
- Docker
- CI
- migrations
- backup
- observability
- production readiness

## H. Test Coverage Gaps

## I. Technical Debt

## J. Recommended Architecture Changes

## K. Ordered Implementation Backlog
P0 / P1 / P2 / P3

## L. First Safe Implementation Sprint
Small enough to review, test and revert.

Do not modify code until this audit is complete, unless a tiny change is required only to make the project auditable and it is explicitly documented.

---

# 76. P0 PRIORITY DEFINITION

P0:
Security/data-loss/tenant-isolation/payment-integrity blocker.

P1:
Core product architecture or daily operation blocker.

P2:
Important product capability.

P3:
Enhancement/polish/future scale.

Security and data integrity always override visual priority.

---

# 77. ARCHITECTURE DECISION RECORDS

For major decisions create lightweight ADRs, for example:

docs/adr/0001-multi-tenancy.md
docs/adr/0002-auth-session-strategy.md
docs/adr/0003-notification-queue.md
docs/adr/0004-payment-domain-separation.md
docs/adr/0005-ai-provider-abstraction.md

ADR:
- context
- decision
- alternatives
- consequences

This prevents future AI agents from randomly reversing architecture.

---

# 78. DOCUMENTATION STRUCTURE RECOMMENDATION

Eventually maintain:

README.md
CRMAPP_MASTER_SPEC.md
SETUP.md
RUNBOOK.md

docs/
  architecture.md
  database.md
  api.md
  security.md
  tenancy.md
  billing.md
  telegram.md
  ai.md
  deployment.md
  adr/

Documentation must describe actual code, not imaginary future implementation.

---

# 79. FINAL PRODUCT RULES

CRMAPP must remain:

- Multi-tenant
- Secure
- Modular
- Subject-agnostic
- Role-aware
- Auditable
- Localizable
- API-ready
- Integration-ready
- Payment-safe
- AI-extensible
- Production-operable

Core product principle:

"One education platform, configurable for many types of education centers."

Core engineering principle:

"Correct tenant boundaries and data integrity before feature velocity."

Core AI-agent principle:

"Inspect first. Plan second. Implement third. Verify last."

END OF MASTER SPEC
