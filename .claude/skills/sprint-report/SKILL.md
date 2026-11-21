---
name: sprint-report
description: Write a sprint report (final report or progress checkpoints) in the project's established format, from the git log since the last report, real test results and open issues, and save it under docs/.
argument-hint: "[final|progress] [sprint name or number]"
disable-model-invocation: true
---

# Sprint report: $ARGUMENTS

First word of the arguments: `final` (default) = closing report, `progress` = checkpoint file. The rest is the sprint's name/number; if missing, ask once.

The format comes from the third sprint's files. They were removed from `dev` in `8ce3a6c` and live in git history; read them before writing, to match tone and detail:

```bash
git show 8ce3a6c^:STABILIZATION_SPRINT3_REPORT.md    # final report (Uzbek)
git show 8ce3a6c^:SPRINT3_PROGRESS.md                # checkpoints (English)
```

## 1. Find the range

- The previous report: the newest file in `docs/` matching `*SPRINT*`, `*REPORT*` or `*PROGRESS*` by commit date: `git log -1 --format='%H %cs %s' -- docs/`. Read it: its "BLOCKED" and "next tasks" sections are the starting list of open issues. If `docs/` has none, use the sprint-3 files above (`8ce3a6c^`) and say so.
- Range start = the commit that added that report (or the start SHA the user names). Range end = `HEAD`.
- `git log --oneline --no-merges <start>..HEAD`, `git diff --stat <start>..HEAD`, and `git log <start>..HEAD --name-only -- backend/drizzle/` for new migrations.
- Branch, `git rev-parse HEAD`, whether it is pushed (`git status -sb`), PRs (`gh pr list --head <branch>` / `gh pr view`), CI (`gh run list --branch <branch> -L 3`). If `gh` is not signed in, write that CI could not be read (BLOCKED), never a guessed status.

## 2. Collect real results (run them, do not copy old numbers)

Run each and record the command and its actual outcome (pass/fail counts, warnings). Long ones in the background; stop preview dev servers first.

| Check | Command (folder) |
|---|---|
| Backend typecheck | `npx tsc --noEmit` (backend) |
| Backend lint | `npm run lint` (backend) |
| Backend unit | `npm run test` (backend) |
| Backend e2e (real PostgreSQL) | `npm run test:e2e` (backend) |
| Backend build | `npm run build` (backend) |
| Migration journal | `npm run db:check-migrations` (backend) |
| Fresh install + upgrade chain | `npm run db:verify-migrations` (backend) |
| Schema drift (dev DB) | `npm run db:check-drift` (backend) |
| Frontend typecheck / lint / unit | `npx tsc --noEmit`, `npm run lint`, `npm test` (frontend) |
| Browser | `npm --prefix ../backend run build && npm run build:frontend && npm test` (e2e-browser) |

A check you did not run is listed as "not run" with the reason. Known local-only failures (e.g. a unit test needing `openssl` on Windows) are named as such, not hidden. A flaky test that passed on rerun is reported as flaky, with both runs.

## 3. Open issues

From: the previous report's BLOCKED / next-task lists (still open or now done, with the commit), `gh issue list --state open` if available, `TODO`/`FIXME` added in the range (`git diff <start>..HEAD | grep '^+.*\(TODO\|FIXME\)'`), and anything that failed in step 2.

## 4. Write it

Language: the final report in Uzbek, like sprint 3; checkpoints in English. Plain facts, commit SHAs and file paths in backticks, numbers only from this session.

**`final`** -> `docs/SPRINT<N>_REPORT.md` (or `docs/STABILIZATION_SPRINT<N>_REPORT.md` for a stabilization sprint):

```
# <Sprint>: <one-line theme>. Yakuniy hisobot

Sana: <YYYY-MM-DD>. Branch: `<branch>`.
**Ish joyi.** <where the work ran: local/cloud, what was pushed, PR, merge, deploy - or not>
**CI.** <CI status for the end SHA, with run id, or BLOCKED and why>

## 1. Boshlang'ich va yakuniy holat      (start SHA, end SHA; table | Commit | Mazmuni |)
## 2. Tuzatilgan muammolar               (numbered: bold symptom, then the fix, then the test that proves it)
## 3. <Domain rules decided this sprint>  (only if the sprint fixed behaviour rules; else drop)
## 4. Migratsiyalar va ma'lumotlar        (| Migratsiya | Nima |; counts from db:report-* scripts if run)
## 5. Bajarilgan testlar va haqiqiy natijalar (shu sessiyada)
      (| Tekshiruv | Buyruq | Natija |; then new tests with counts; then "Yashirmasdan:" list of
       failures, flakiness, test-side mistakes; then **Moliyaviy ta'sir.** if money code was touched)
## 6. BLOCKED yoki tekshirilmagan
## 7. Bilib qo'yish kerak bo'lganlar
## 8. Patch va bundle                     (only if handoff/ files were made)
## 9. Keyingi eng muhim vazifalar         (numbered, most important first)
```

**`progress`** -> `docs/SPRINT<N>_PROGRESS.md`; append to it if it exists:

```
# <Sprint>: checkpoints

Branch `<branch>`. Start: `<full SHA>` (<pushed or not>). <where the work runs; push/PR/merge state>.

**Checkpoint <k>: <task>.** <what changed, endpoints/tables, test file and counts>
Next: <remaining tasks>.

## Design decided for <tasks> (so a resumed session does not re-derive it)
**<Topic> (migration NNNN).** <decisions as short bullets>
```

## 5. Finish

Save under `docs/` only (never the repo root). Show the user the file path, the range covered, the test table, and the open issues. Do not commit unless the user asks.
