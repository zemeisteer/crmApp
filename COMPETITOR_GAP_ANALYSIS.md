# Competitor gap analysis

Inspected 2026-10-06. The relevant market is education-center / tutoring /
language-school management, with the closest analogue being CIS/Uzbekistan
products. Advertised features below come from the vendors' own pages and
third-party comparisons; CRMApp capabilities are the ones I verified in this
audit (running app, API, tests), not from documentation claims.

## Sources

- Alfa CRM — CRM for education centers and schools, widely used across the
  CIS/Uzbekistan market: https://alfacrm.com/ (inspected 2026-10-06)
- Umai CRM — learning-center CRM (Kazakhstan), scheduling/WhatsApp/payroll/
  analytics: https://www.umaicrm.com/en/features.php (inspected 2026-10-06)
- Teachworks vs TutorBird (billing, parent portal, scheduling):
  https://www.wise.live/blog/tutorbird-vs-teachworks/ (inspected 2026-10-06)
- Teachworks vs TutorBird vs Teach 'n Go:
  https://www.teachngo.com/blog/teachworks-vs-tutorbird (inspected 2026-10-06)
- Best tutoring software with a parent portal:
  https://tutorbase.com/blog/best-tutoring-software-with-parent-portal (2026-10-06)

Advertised vs personally verified: competitor rows are *advertised*
functionality; CRMApp rows are *verified* in this session.

## Capability comparison

| Capability | CRMApp (verified) | Competitor (advertised) | User value | Effort/risk to close | Decision |
|---|---|---|---|---|---|
| Center onboarding | 8-step resumable wizard, server-side state | Alfa: guided setup; Teachworks: admin setup | Fast start | — | Keep (at parity) |
| Roles & permissions | 8 roles + per-member access lists, server-enforced | Alfa: configurable roles | Fine-grained control | — | Keep (ahead: per-member lists) |
| Student & parent portal | Phone+PIN cabinet, parent watch-only, schedule/attendance/homework/payments/invoices | Teachworks/TutorBird/Alfa: portals w/ schedule, notes, online pay | Family self-service | — | Keep (at parity) |
| Teacher workspace | Own groups only, attendance, homework grading, own salary | All: teacher views | Teacher focus | — | Keep |
| Scheduling & attendance | Recurring lessons, teacher/room/group conflict detection, tz-aware (Asia/Tashkent) | All: calendars; TutorBird: drag-drop, make-up credits, self-booking | Daily ops | — | Keep core |
| Calendar sync (Google/Outlook/Apple) | none | TutorBird, Teachworks | Convenience | Medium (OAuth per provider) | Backlog P3 |
| Make-up lessons / lesson credits | none (enrollment lifecycle only) | TutorBird (credit tracking) | Retention, fairness | Medium | Backlog P2 |
| Student self-booking of open slots | none | TutorBird open-slot registration | Admin time saved | Medium | Backlog P3 |
| Billing / invoices / debt | Invoices, partial payments, ledger, debtors, receipts, Click/Payme webhooks (verified e2e) | Teachworks: Stripe packages/auto-charge; Alfa: auto subscription calc | Revenue ops | — | Keep (local-payment fit) |
| Recurring auto-billing / saved-card auto-charge | none (Click/Payme are redirect checkout in UZ) | Teachworks auto-charge (Stripe) | Collection rate | High (local gateway limits) | Backlog P3, market-gated |
| Payroll / teacher salaries | Configurable models, storno, audit, reconciliation (verified e2e) | Alfa, Umai: salaries | Staff pay | — | Keep (ahead) |
| Reporting | Director report, finance summary, admissions funnel, cash day | All: analytics | Decisions | — | Keep |
| Notifications & comms | Telegram first-class (students/parents/teachers), SMS adapters, reminders, announcements | Umai: WhatsApp; others: e-mail/SMS | Reach in-market | — | Keep (ahead for UZ) |
| Two-way parent/teacher messaging | none (announcements one-way) | Some portals: messaging | Engagement | Medium | Backlog P2 (spec §34 future) |
| Multi-branch / multi-org | Branches + `organization_memberships` (one user, many centers) | Alfa: multi-branch | Chains | — | Keep (ahead: multi-org identity) |
| Localization | UZ / RU / EN, locale dates/currency, tenant tz | Mostly single/EN; Alfa RU | Market fit | — | Keep (ahead for UZ) |
| Mobile | Responsive (verified 390px), phone bottom nav | Varies; some native apps | On-the-go | — | Keep (web); native = future |
| AI | Tutor, material/exam generation, PDF question extraction, essay feedback | Rare among these | Differentiator | — | Keep (ahead) |
| Exams / mock tests | Exam engine + IELTS mock (listening/reading/writing/speaking) | Not in tutoring CRMs | Test-prep fit | — | Keep (ahead) |
| Admissions / leads | Lead funnel, sources, trials, conversion, analytics | Alfa: lead mgmt | Sales | — | Keep |
| Custom fields on student/lead | fixed schema | Alfa: custom fields/modules | Flexibility | Medium (schema + UI) | Backlog P2 |

## Reading

CRMApp already meets or beats this market on the capabilities that matter for
Uzbekistan education centers: trilingual UI, Telegram-first communication,
Click/Payme local payments, a real admissions funnel, AI tutoring/exam
tooling, IELTS mock tests, per-member permissions, and multi-org identity.
The genuine, worthwhile omissions are operational conveniences rather than
missing fundamentals:

1. **Make-up lessons / lesson credits** (P2) — real retention value; bounded.
2. **Two-way parent/teacher messaging** (P2) — the spec already lists it as a
   future module (§34); start with threaded messages on existing entities.
3. **Custom fields** on students/leads (P2) — Alfa's main flexibility edge.
4. **Calendar sync** and **student self-booking** (P3) — integration-heavy,
   lower urgency for the target market.
5. **Saved-card auto-charge** (P3) — gated by local gateway capabilities, not
   just engineering.

None of these are security or correctness gaps. Per the task's priority order,
they stay in the backlog; this audit spent its effort on the confirmed
security/correctness defects (see `AUDIT_FINDINGS.md`).
