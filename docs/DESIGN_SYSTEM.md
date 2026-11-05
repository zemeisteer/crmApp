# TalimCRM design system

The frontend's look comes from **tokens** (CSS variables in `frontend/app/globals.css`), a few **primitives** (`frontend/components/ui/`) and a handful of **shared classes** (also in `globals.css`). Pages use them instead of raw colors, radii and fonts. A CI step (`scripts/redesign/check-no-raw-colors.mjs`) fails when a new raw hex color is added.

The design reference (mockup, reference frames, brief) is in `design-reference/`.

## Visual language

- **Canvas:** a soft pastel gradient (lavender, sky, blush), never a flat gray: `--canvas-gradient` on `body`.
- **Frame:** the staff app and the cabinet sit in a floating, rounded, slightly glassy frame (`.app-frame`, `.ptl-body`).
- **Cards:** white, `--radius-lg` (22px), a hairline border and a very soft shadow (`--shadow-card`). Dashboard widgets lift 3px on hover (`.card-lift`).
- **Ink:** primary actions and active states (active menu item, active tab, primary button) are ink black (`--primary`, which is `--ink`).
- **Accent:** orange, used for **one hero card per page**, a few highlights and chart accents.
- **Pastels:** `--lav`, `--sky`, `--mint`, `--peach` for grouped cards (groups, courses, cabinet tiles).
- **Status:** chips in soft fill + strong text: success, danger, warning, info.
- **Type:** Inter. Big titles and numbers use tight negative tracking; secondary text is muted gray.
- **Density:** tables and forms stay dense. The rounded/pastel look applies to containers and accents, not to rows.

## Tokens

All tokens are defined on `:root` and redefined for dark under `.dark` (and the platform skin, below).

| Group | Tokens |
|---|---|
| Brand | `--accent`, `--accent-2`, `--accent-soft`, `--accent-strong`, `--accent-gradient` |
| Ink / primary | `--ink`, `--ink-hover`, `--on-ink`, `--primary`, `--primary-hover`, `--primary-soft`, `--primary-border` |
| Text on fills | `--on-ink` (on ink), `--on-color` (white, on status/strong accent), `--on-accent` (ink, on the bright accent) |
| Canvas / surfaces | `--canvas`, `--canvas-gradient`, `--frame`, `--frame-border`, `--surface`, `--surface-muted`, `--surface-sunken`, `--card-border` |
| Text | `--text`, `--text-soft`, `--text-muted` (AA on white), `--text-faint` (placeholders, icons) |
| Lines | `--border`, `--border-strong` |
| Status | `--success`, `--danger`, `--warning`, `--info`, each with `-soft` and `-border` |
| Category | `--violet` (AI), `--teal`, `--pink` (parent view), each with `-soft` |
| Pastels | `--lav`, `--sky`, `--mint`, `--peach` |
| Shape | `--radius-xs` 8, `--radius-sm` 10, `--radius-md` 14, `--radius-lg` 22, `--radius-xl` 28, `--radius-pill`; `--shadow-card`, `--shadow-hover`, `--shadow-pop`, `--shadow-frame`, `--focus-ring` |
| Spacing | `--space-1` … `--space-8` (4px steps), `--page-pad`, `--page-head-pad` |
| Type | `--font-sans`, `--font-display` |
| Motion | `--ease-out`, `--dur-fast`, `--dur-enter` |

Tailwind 4 utilities map to the same tokens (`@theme inline` in `globals.css`): `bg-surface`, `bg-surface-muted`, `text-fg`, `text-soft`, `text-muted`, `text-faint`, `border-line`, `border-line-strong`, `bg-primary`, `bg-primary-soft`, `text-danger`, `bg-success-soft`, … Tailwind's `rounded-*` utilities follow the radius scale.

### Rules

- **Never write a raw hex color** in a component. Pick the token by meaning: text → `--text*`, fills → `--surface*`, status → `--success`/`--danger`/…; white text on a colored fill → `--on-color`; text on ink → `--on-ink`.
- **Contrast:** text must keep AA. White text never sits on the plain orange: use `--on-accent` (ink) on `--accent`, or `--accent-strong` behind white text.
- **Genuine one-offs** (other companies' brand colors such as Click/Payme, print-only HTML, a center's own chosen site color) may stay raw; they are counted per file in `scripts/redesign/raw-colors-baseline.json`. After a reviewed change, refresh it with `node scripts/redesign/check-no-raw-colors.mjs --update`.
- **Derived tokens** (`--primary: var(--ink)`, accent shades, gradients) resolve where they are declared. A theme applied on a nested element (like the platform skin) must redeclare them, as the `.dark, .theme-platform` block does.

## How to swap the accent

Change one line in `globals.css`:

```css
:root {
  --accent: #f26b3a;   /* old indigo: #4f46e5 */
}
```

`--accent-2`, `--accent-soft`, `--accent-strong` and `--accent-gradient` are derived from it with `color-mix`. Primary actions use `--primary` (ink); to make them the accent color too, set `--primary: var(--accent)` (and `--on-ink` accordingly).

## Themes

- **Dark:** add `class="dark"` on `<html>`. Every token has a dark value. Tailwind's `dark:` variant is wired to the same class (`@custom-variant dark`). No toggle is shipped yet.
- **Platform skin:** `DashboardShell` puts `theme-platform` on the shell in platform mode (a superadmin outside a center). It is the dark token set with a violet accent, so the platform never looks like a center's panel. No component is forked.

## Primitives (`frontend/components/ui/`)

| Primitive | Use |
|---|---|
| `Card` (+ `CardHeader`) | A card. `tone`: `surface`, `accent` (the page's hero), `ink`, `lav`, `sky`, `mint`, `peach`. `index` staggers its entrance; `lift` for dashboard widgets only. |
| `PageHeader` | Eyebrow + large title, KPI strip or actions on the right; wraps on phones. |
| `Stat`, `KpiChip` | A KPI: label, a big number counting up, an optional +/- chip. |
| `CountUp` | A number counting up once; screen readers and reduced motion get the final value. |
| `PillTabs` | Black pill tabs for sections inside a page (not for the main navigation). Arrow keys move between tabs. |
| `Badge` | Status chip by tone. |
| `EmptyState` | Icon, sentence, optional action. |
| `Section` | A titled block in settings and forms. |
| `ProgressBar` | Thin bar that fills in once. |
| `LineChart` | Smooth line with an area, drawn in; hover/focus readout. |

`BarChart` and `DonutChart` (`components/BarChart.tsx`) follow the same language: round bars that grow in, an arc that draws in.

Shared classes: `.btn` (base) with `.btn-primary`, `.btn-accent`, `.btn-ghost`, `.btn-danger`, `.btn-sm`; `.field-input`; `.badge` + `.badge-success|danger|warning|neutral|info|accent`; `.card`; `.page-title`; `.dash-grid` with `.c3 … .c12`, `.r2`; `.dash-row`, `.dash-link`, `.dash-round`.

## Adding a page

1. Wrap it in `DashboardShell` (staff) as the other pages do; the rail, top bar, notices and access checks come with it.
2. Header: `PageHeader` (or a header strip with `padding: var(--page-head-pad)` and an `h1` with `className="page-title"`).
3. Body: `padding: var(--page-pad)` (or the `.page-pad` class). Phones get their own values automatically.
4. Content in `Card`s. Data-heavy content (tables, forms) stays dense: plain `table`/`th`/`td`, `.field-input`.
5. At most **one** `Card tone="accent"` per page, for the most important number or action.
6. Sections inside the page: `PillTabs`.
7. Every string through `t("…")`, with the key in UZ, RU and EN.
8. Run `npm run lint`, `npx tsc --noEmit`, `npm test` and `node ../scripts/redesign/check-no-raw-colors.mjs`.

## Motion

- Staged entrance: `.rise-in` with `--i` (75ms stagger, 0.6s, ease-out).
- Bars grow in (`.grow-y`), progress bars fill (`.fill-x`), lines draw (`.draw-line` with `pathLength="1"`), donut arcs draw, KPI numbers count up (`CountUp`).
- At most about 700ms, ease-out. **No motion on tables or forms**, none on exam screens.
- All of it is off under `prefers-reduced-motion` (CSS block at the end of each motion section).
- Entrance animations use `animation-fill-mode: backwards`: no transform stays on an element once done, so `position: fixed` popups (selects, date pickers) inside cards keep their place. For the same reason, hover lift is opt-in (`.card-lift`) and never on cards holding popups.

## The codemods (`scripts/redesign/`)

Kept for reference and re-runs; all are idempotent and print a report.

| Script | What it does |
|---|---|
| `codemod-colors.mjs` | Raw hex → `var(--token)`, property-aware (text/background/border), with the map in `color-map.mjs`. Lists colors it does not know. |
| `codemod-shape.mjs` | Numeric `borderRadius` → radius tokens; Manrope → `var(--font-display)`. |
| `codemod-tailwind.mjs` | Tailwind palette classes (`slate-700`, `indigo-600`…) → semantic utilities. |
| `codemod-layout.mjs` | Page header strips and bodies → `--page-head-pad` / `--page-pad`; page `h1` → `.page-title`. |
| `codemod-tabs.mjs` | Segmented tabs → black pill tabs. |
| `check-no-raw-colors.mjs` | CI guard against new raw colors (baseline per file). |
