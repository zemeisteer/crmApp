# De-vibecode polish: checkpoint

Branch `polish-local`, based on `sprint4-local` @ `0aec8f8` (= PR #3 head). Nothing is pushed.
The user decided: keep the brand color and font.

## Done (not yet validated by a full run)
- Landing text: no em dashes (UZ/RU/EN), no emoji in chat strings, `aiNew` without the sparkle.
- Dashboard: removed the fake "Barcha tizimlar ishlayapti" pill (and its i18n key); header uses "·".
- Schedule: event button is neutral (like "Xonalar"), without the trophy.
- Sparkles removed in the staff app (exams, ai-materials, homework, pricing, MaterialActions, AttemptReview,
  PlacementTestModal, GroupTutorReport, PracticeEditor) and PortalPractice; trophy removed in homework.
  Kept: category icon lists (settings/onboarding), SiteContentEditor icon picker, CenterEvents kind icons,
  student cabinet tab icons (PortalTabs, ptl.*, tutor.*).
- Leading emoji stripped from 21 staff i18n keys; `ex.emptyQHint` follows the button text.
- "Asosiy CRUD" -> "Asosiy imkoniyatlar": seed in `plans.service.ts` + migration `0059_starter_plan_wording`
  (only rows still holding the shipped text). check-migrations / verify-migrations pass.
- Skeleton loaders: `components/Skeleton.tsx` (ListSkeleton, DashboardSkeleton) + `.skeleton` CSS;
  used on dashboard, students, groups, leads, payments.
- Test label updated: sprint4-forms "O'qituvchilar davomati" (no emoji).
- Frontend tsc clean; eslint 0 errors / 76 warnings (same as base).

## Next
1. Rebuild: `npm --prefix backend run build`; in `e2e-browser`: `npm run build:frontend`
   (start postgresql + redis first after a container restart).
2. Screenshots with demo data (temporary `e2e-browser/tests/zz-*.spec.ts`, deleted after):
   staff dashboard (owner@bilimdon.uz / Demo12345) and student cabinet on a phone
   (+998901110001, PIN 123456), language via localStorage `talimcrm_lang` = UZ/RU/EN;
   save to `frontend/public/landing/dashboard-<lang>` and `portal-<lang>` (webp if a converter exists, else jpg).
3. `components/landing/Landing.tsx`:
   - hero mock (traffic-light browser, 3 panes) -> real dashboard screenshot in a plain frame;
   - portal phone mock -> real cabinet screenshot;
   - remove CLIENT LOGOS block + `.lp-track/.lp-left/.lp-right/.lp-pill` CSS + `clients` text keys;
   - remove `Dots`, `useRotate`, `lessonRow`, `stat`, `paneHead`, `paidRow` and the now-unused text keys;
   - WHO/FEATURES/WHY: uniform white cards and neutral icon chips (no pastel set);
   - AI section: flat color instead of gradients, non-sparkle first icon, flat badge;
   - pricing: keep the border highlight, drop the colored shadow.
4. Validate: frontend tsc/eslint/unit/build; backend unit + e2e; migrations; full browser suite.
5. Commit locally, Uzbek report with before/after screenshots, then ask the user where to push
   (new branch + PR, or onto PR #3).
