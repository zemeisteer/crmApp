# TASK: Full UI redesign of crmApp (all roles, all pages)

You are working in the `zemeisteer/crmApp` monorepo (`frontend/` = Next.js, `backend/` = NestJS-style API with Drizzle). Redesign the **entire frontend** to a new visual language, for **every role and every page**: admin/owner/manager/receptionist/accountant dashboards, teacher home, student portal, parent portal, superadmin (platform) pages, auth pages, public pages. **Do not change behavior, routes, API calls, permissions or data models.** This is a visual/UX redesign only.

Work autonomously and end to end. Do not stop to ask questions unless something is truly blocked; where this document leaves a choice open, decide, and note the decision in the final report.

---

## 0. Read first (mandatory, before writing any code)

1. `frontend/AGENTS.md` and `frontend/CLAUDE.md` — **this is NOT the Next.js you know** (Next 16, React 19). Read the relevant guides in `frontend/node_modules/next/dist/docs/` before touching routing/layout/metadata code. Run `npm ci` in `frontend/` first so those docs exist.
2. `docs/CRMAPP_MASTER_SPEC_V2.md`, `README.md`, `SETUP.md` — product context.
3. `frontend/app/globals.css`, `frontend/components/DashboardShell.tsx`, `frontend/components/Sidebar.tsx`, `frontend/app/dashboard/page.tsx`, `frontend/components/dashboard/TeacherHome.tsx`, `frontend/app/portal/page.tsx` + `frontend/components/portal/*`, `frontend/app/admin/**`.
4. The design reference pack in `design-reference/` (see section 2). **Open and study every file in it.**

## 1. Ground rules

- Work on a new branch: `redesign/ui-v2`. Never commit to `main`. Commit after every phase with a clear message. Open a PR at the end (do not merge).
- **No backend changes.** No API contract changes. No route renames. No removed features, buttons, or fields. If a screen shows something today, it must still show it (restyled).
- Keep **all i18n** working (`lib/i18n.ts`, `t("...")`). UI languages in use: Uzbek (Latin), Russian, English. Never hardcode user-facing strings; reuse existing keys. If you must add a key, add it in all three languages.
- Keep accessibility: focus-visible rings, `skip-link`, `sr-only`, aria roles on banners, keyboard navigation in menus/modals, contrast AA on text.
- Keep existing responsive/phone behavior and improve it; the **student and parent portals are used mostly on phones** — design those mobile-first.
- Keep the existing dark-mode hook (`@custom-variant dark`) working. Tokens must have a dark counterpart.
- Do not add heavy dependencies. Prefer CSS variables + Tailwind 4 + small local components. If you add an animation lib, it must be justified; plain CSS transitions/keyframes are preferred. Respect `prefers-reduced-motion`.
- Do not touch `.env*`, deployment files, `nginx/`, `docker-compose*`, `backend/`.

## 2. Design reference pack (`design-reference/`)

- `crm-mockup.html` — a working HTML mockup of the **target look** (open it in a browser, inspect its CSS). Pay attention to: card radius, soft shadow, pastel group cards, black pill tabs, round icon rail, KPI row with +/- chips, orange accent card, gauge, progress bars, count-up and staged entrance animations, line chart draw animation.
- `ref-a.png`, `ref-b.png` — frames from the inspiration video this mockup is based on (light pastel-gradient "glass" app shell, big page title, pill top tabs, rounded white cards, one bold orange accent card).

The mockup uses demo data and invented widgets ("lead response time", "teacher rating") that do **not** exist in the product. **Use the mockup for look and feel only; the real data and real widgets come from the existing pages.**

### Visual language (target)

- **Canvas:** soft pastel gradient background (lavender → sky → blush), never flat gray. Optional faint glass/blur on the outer app frame.
- **Cards:** white, radius 22–24px, hairline border `rgba(255,255,255,.9)` + very soft shadow, 20px padding. Hover lift 2–3px.
- **Shell:** floating rounded app frame; slim **round icon rail** on the left (active = black circle) that expands to full labels on hover/pin and becomes a bottom-sheet/drawer on mobile; top bar with brand pill, **black pill tab switcher** (used for in-page sections, NOT for all 20+ nav items), search, notifications, settings, avatar.
- **Page header:** small greeting/eyebrow + large (40–44px, tight tracking) page title; KPI strip on the right (number 28–32px + small colored delta chip).
- **Typography:** Inter (already used). Tight negative tracking on big numbers/titles; muted gray secondary text.
- **Color:** ink black `#16161d` for primary actions/active states; **accent orange `#F26B3A` → `#FF8A5C`** for the one hero card per page, key CTAs highlights and chart accent; pastel set for category cards (lavender `#E3DCFF`, sky `#DBE9FF`, mint `#DCF5E3`, peach `#FFE6D8`). Status colors: green/red/amber chips. The accent must be **a single token** so it can be swapped to the old indigo in one line (decision: ship orange).
- **Components to restyle:** buttons (`.btn` + variants), inputs/selects (`.field-input`), date/time/month/phone pickers, `Select`, `MultiSelect`, tables (`table/th/td`, `.adm-table`), badges, modals (`.modal-*`, `Modal.tsx`), skeletons, pagination, toasts/banners (TrialBanner etc.), charts (`BarChart.tsx`), empty states, tabs, chips, avatars, progress bars.
- **Motion:** staged card entrance (translate+fade, 60–90ms stagger), number count-up on KPIs, bar/line draw-in, progress-bar fill. Max ~700ms, ease-out. No motion on data tables or forms. All disabled under `prefers-reduced-motion`.
- **Density:** tables and forms (students, groups, payments, leads, exams, reports…) stay **dense and scannable**. Pastel/rounded look applies to containers and accents; do not waste vertical space in data-heavy pages.

## 3. The core problem: hardcoded styles → design tokens (Phase 1, do this first)

The codebase has about **5,400 inline `style={{...}}` occurrences across ~164 files** with hardcoded hex values (most frequent: `#686B75` ×710, `#EAE8E2` ×412, `#B23A47` ×258, `#4A4E58` ×249, `#181A1F` ×206, `#4F46E5` ×175, `#F2F1EC`, `#FDEBEC`, `#16794A`, `#EEF0FF`, `#B45309`, `#E9F8EF`, …). Tailwind slate/indigo/rose utilities are also used. A redesign by hand-editing each of these is not acceptable.

Do this instead:

1. Define a complete token set in `globals.css` (`:root` + `.dark`): surfaces, text (primary/muted/soft), borders, accent (+ soft/hover), ink, success/danger/warning/info (+ bg/text pairs), radii, shadows, spacing scale, the four pastels, gradient background.
2. Map Tailwind 4 theme (`@theme`) to the same tokens so `bg-indigo-600`-style usage can be replaced by semantic utilities (`bg-accent`, `text-muted`, …).
3. Write a **codemod script** in `scripts/redesign/` (Node, committed) that replaces the recurring hardcoded hex values in `frontend/app`, `frontend/components`, `frontend/lib` with the matching `var(--token)` (inline styles) or semantic Tailwind classes. It must be idempotent, print a report (counts per token, files touched), and leave unknown colors untouched but listed in the report for manual review. Run it, review the diff, fix leftovers by hand.
4. After the codemod, remaining raw hex in components should be limited to genuinely one-off cases (charts palettes, avatars, user-chosen colors). Add an ESLint rule or a simple CI script (`scripts/redesign/check-no-raw-colors.mjs`) that fails when new raw hex colors are added outside an allowlist.
5. Replace repeated inline-style patterns with shared primitives where it clearly reduces code: `Card`, `PageHeader`, `StatCard`/`KpiChip`, `PillTabs`, `Badge`, `EmptyState`, `Section`. Put them in `frontend/components/ui/`. Use them across pages gradually; do not rewrite page logic.

Commit Phase 1 on its own. The app must build and look **consistent (even if not yet beautiful)** after it.

## 4. Phases

**Phase 1 — Tokens + primitives + global styles** (section 3).

**Phase 2 — App shell.** `DashboardShell.tsx`, `Sidebar.tsx`, top bar, mobile menu/backdrop, `TrialBanner` & other banners, `TwoFactorGate`, skip-link. Role-aware nav stays exactly as is (`canSee`, `canOpenPath`, platform mode); only presentation changes: icon rail (collapsed) ↔ labeled (expanded), grouped sections, active state = black circle/pill, badges for unread. Tooltips on collapsed icons.

**Phase 3 — Dashboards.**
- `app/dashboard/page.tsx` (admin/owner/manager/receptionist/accountant variants) and `components/dashboard/TeacherHome.tsx`. Use the **real** widgets that exist today: today's lessons, active students, month revenue, debtors, groups count, total lessons, teachers count, total students, attendance activity (day/week/month), group fill rate, payment status this month (paid/pending/overdue), today's lessons list, revenue by month + year total, AI insight card, announcement banners, FirstSteps. Compose them like the mockup: KPI strip in the header, one orange hero card (pick the most important number for that role), pastel group cards, line/bar charts with draw-in animation, progress rows.
- Keep every data fetch/state/empty/loading/error path. Add proper skeletons in the new style.

**Phase 4 — Student & parent portals** (`app/portal/page.tsx`, `components/portal/*`, `app/t/[token]`, `app/invite/[token]`, `PortalLogin`, `PortalHome`, `PortalTabs`, `PortalTutor`, `PortalExams`, `ExamMode`, `MockRunner`, `PracticeRunner`, `PortalMessages`, `PortalMakeups`, `PortalCalendar`, `CardTransfer`, …). Mobile-first: bottom tab bar on phones, big touch targets (≥44px), single-column cards, the same pastel/orange language but friendlier. **Exam/test-taking screens (`ExamMode`, `MockRunner`, `PracticeRunner`, `PracticeExam`) must stay distraction-free** — calm neutral surface, no decorative motion, timer and question navigation clearly visible. Parent view and student view must be visually distinguishable (e.g. different greeting/accent chip) but share components.

**Phase 5 — Superadmin / platform pages** (`app/admin/**`: overview, subscriptions, trials, flags, integrations, and the platform-mode shell). Same system, but a **distinct "platform" skin** (e.g. dark ink canvas or a different accent) so a superadmin never confuses platform mode with a center's panel. Make it a theme class on the shell, not a fork of components.

**Phase 6 — Everything else.** Auth (`login`, `register`, `forgot-password`, `reset-password`, `verify-email`, `onboarding`), `students` (+ `[id]`, trash), `groups` (+ `[id]`, trash), `teachers` (+ `[id]`, trash), `leads` (+ `[id]`, pipeline/ConvertWizard), `payments` (CardClaims, CashDay, DebtorReminders), `schedule`, `calendar`, `makeups`, `exams`, `mock-tests`, `homework`, `reports`, `signals`, `ai-insights`, `ai-materials`, `messages`/chat, `announcements`, `certificates`, `hiring`, `audit-log`, `settings` (+ all `components/settings/*`), `pricing`, `terms`, `privacy`, `verify/[code]`, public `site/[subdomain]` pages, and the landing (`components/landing/*`, `public/landing`). Not-found/error pages. Print views (`print-test.ts`, certificates) must remain print-friendly (no gradients/shadows in print CSS).

## 5. Quality gates (every phase)

Run from `frontend/`:
- `npm run lint` — no new warnings.
- `npm test` — all pass.
- `npm run build` — succeeds with no type errors.
- `e2e-browser/` — read its README/scripts, run the suite against a local stack (`docker-compose.yml`, see `SETUP.md`). Update **selectors only if the redesign genuinely changed the DOM**; prefer keeping `data-testid`/roles/labels stable so tests don't need edits. If a test must change, explain why in the commit.
- Visual check with Playwright (already installed in this environment; do not reinstall): capture screenshots at **1440×900 and 390×844** for each role's home + 3 representative pages. Roles: SUPERADMIN (platform mode), OWNER/ADMIN, MANAGER, RECEPTIONIST, ACCOUNTANT, TEACHER, PARENT, STUDENT (portal). Seed data via the existing dev/staging seed scripts (`backend/scripts`, `scripts/staging`). Look at the screenshots yourself and fix: overflow, clipped text, low contrast, broken wrapping in uz/ru (Russian strings are long), dark-mode problems, empty states.
- Test with all three languages on at least dashboard, one table page, one form page, portal home.
- Lighthouse-style sanity: no layout shift on load from the entrance animations, no console errors.

## 6. Deliverables

1. Branch `redesign/ui-v2` with one commit per phase and a PR with:
   - summary per phase,
   - before/after screenshots (desktop + mobile) for each role,
   - codemod report (how many raw colors replaced, what remains and why),
   - list of any tests changed and why,
   - list of decisions you made where this spec was open,
   - list of things you intentionally did **not** do (and why), and suggested follow-ups (e.g. widgets from the mockup that would need new backend data: lead response time, teacher rating, branch map).
2. `docs/DESIGN_SYSTEM.md`: tokens, primitives, usage rules, how to swap the accent, how to add a new page in the system, motion rules.
3. A short final report in Uzbek (Latin script only, no Cyrillic) for the owner (call him "boss"): what changed, how to run it, how to review the PR, risks.

## 7. Definition of done

- No page or role is left on the old look; no mixed old/new styling inside a page.
- Zero functional regressions: lint, unit tests, build and e2e green.
- Accent/theme changeable from tokens only.
- Phone layouts for portal pages are verified by screenshots, not assumed.
- Final PR is ready for the owner to review; nothing is merged or deployed.
