# De-vibecode polish: done

Branch `polish-local`, based on `sprint4-local` @ `0aec8f8` (= PR #3 head). Pushed to `claude/polish-wip` (no PR).
The user decided: keep the brand color and font.

## Done
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

- Landing (`components/landing/Landing.tsx`, `landing-text.ts`):
  - hero: a real screenshot of the staff dashboard with demo data (`public/landing/dashboard-{uz,ru,en}.webp`,
    1600x1000, ~50 KB) instead of the drawn browser with three rotating panes;
  - student cabinet: a real phone screenshot (`public/landing/portal-{uz,ru,en}.webp`) instead of the drawn phone;
  - the fake "LOGO 1-12" clients strip and its CSS are gone;
  - who / features / AI / why: one card style and one icon chip (brand color on a neutral chip), no pastel sets;
  - AI section: flat light section, flat badge, a document icon instead of the sparkle; no gradients left;
  - pricing: the popular plan keeps its border, without the colored shadow;
  - removed the rotation code and 26 text keys only the drawn mocks used; added alt texts in three languages.
  Screenshots were taken with `backend/scripts/demo-seed.cjs` data through a temporary Playwright spec (deleted).

## Validation (this branch)
- Frontend: tsc clean; eslint 0 errors / 76 warnings (same as base); unit 55/55; production build OK.
- Backend: tsc clean; oxlint clean; unit 340/340; e2e 482/482; migrations: 60 in journal and files,
  verify-migrations chain OK (fresh install, no drift, re-run nothing to do).
- Landing in UZ/RU/EN: both screenshots load; no sideways scroll at 390px.
- Browser (Playwright, production builds): 56/56.
