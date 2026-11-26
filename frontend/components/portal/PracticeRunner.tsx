"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QuestionInput from "@/components/tests/QuestionInput";
import PracticeExam from "@/components/portal/PracticeExam";
import ExamOverview, { type OverviewItem } from "@/components/portal/ExamOverview";
import { ApiError, portalMockApi, practiceResult, type PortalPracticeAttempt, type PortalPracticeSection } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { PORTAL_ACCENT as ACCENT, portalCard as card } from "@/components/portal/PortalTabs";

type Text = Record<string, string>;

export const percentColor = (p: number | null | undefined) =>
  p == null ? "var(--text-muted)" : p >= 85 ? "var(--success)" : p >= 60 ? ACCENT : p >= 40 ? "var(--warning)" : "var(--danger)";

// One sitting of a practice test: the sections as cards, each with its own
// clock (server time) from the first start; answers autosave; a finished
// section shows the score, the right answers and the task feedback.
export default function PracticeRunner({ initial, readOnly, onExit }: { initial: PortalPracticeAttempt; readOnly: boolean; onExit: () => void }) {
  const { t } = useLanguage();
  const [a, setA] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Text>>(initial.answers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const sections = a.test.content.sections;
  const done = (k: string) => !!a.sectionDone[k];
  const started = (k: string) => !!a.sectionStarted[k];

  const apply = useCallback((next: PortalPracticeAttempt) => {
    skew.current = Date.parse(next.serverNow) - Date.now();
    setA(next);
  }, []);

  useEffect(() => {
    skew.current = Date.parse(initial.serverNow) - Date.now();
    const id = setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => clearInterval(id);
  }, [initial.serverNow]);

  // Writing tasks marked by the AI in the background: check back.
  const pending = sections.some((s) => practiceResult(a.results, s.key)?.status === "PENDING");
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      portalMockApi.getAny(a.id).then((x) => apply(x as PortalPracticeAttempt)).catch(() => undefined);
    }, 5000);
    return () => clearInterval(id);
  }, [pending, a.id, apply]);

  // Autosave (as in the IELTS runner): 1.5 s after a change, at once when
  // leaving the section or the page.
  const dirty = useRef<Set<string>>(new Set());
  const latest = useRef(answers);
  useEffect(() => { latest.current = answers; }, [answers]);
  const flush = useCallback(async (keepalive = false) => {
    const list = [...dirty.current].filter((k) => !a.sectionDone[k]);
    dirty.current.clear();
    if (list.length === 0) return;
    setSaved("saving");
    let ok = true;
    for (const k of list) {
      try {
        await portalMockApi.save(a.id, k, latest.current[k] ?? {}, keepalive);
      } catch {
        ok = false;
        dirty.current.add(k);
      }
    }
    setSaved(ok ? "saved" : "error");
  }, [a.id, a.sectionDone]);
  useEffect(() => {
    if (readOnly || dirty.current.size === 0) return;
    const id = setTimeout(() => void flush(), 1500);
    return () => clearTimeout(id);
  }, [answers, readOnly, flush]);
  useEffect(() => {
    if (readOnly) return;
    const onHide = () => void flush(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [readOnly, flush]);

  const setAnswer = (k: string, key: string, v: string) => {
    dirty.current.add(k);
    setAnswers((prev) => ({ ...prev, [k]: { ...prev[k], [key]: v } }));
  };

  const deadline = (s: PortalPracticeSection) => (a.sectionStarted[s.key] ? Date.parse(a.sectionStarted[s.key]) + s.durationMin * 60_000 : null);
  const current = sections.find((s) => s.key === open) ?? null;
  const left = current && deadline(current) ? deadline(current)! - now : null;

  async function begin(k: string) {
    setError(null);
    try {
      apply(await portalMockApi.startPractice(a.id, k));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
      throw e;
    }
  }

  const submit = useCallback(async (k: string) => {
    setError(null);
    try {
      dirty.current.delete(k);
      apply(await portalMockApi.submitPractice(a.id, k, latest.current[k] ?? {}));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    }
  }, [a.id, apply, t]);

  const overall = a.results.overallPercent ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={() => (open ? setOpen(null) : onExit())} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 14 }}>
          ← {open ? t("pmk.allSections") : t("pmk.back")}
        </button>
        <div style={{ fontWeight: 800, fontSize: 16, flex: 1, minWidth: 160 }}>{a.test.title}</div>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-soft)", background: "var(--surface-muted)", padding: "3px 10px", borderRadius: "var(--radius-pill)" }}>{a.test.subject}</span>
      </div>
      {error && <div role="alert" style={{ ...card, color: "var(--danger)", fontSize: 13 }}>{error}</div>}

      {!open && (
        <ExamOverview
          title={a.test.title}
          tags={[a.test.subject, ...(a.test.content.exam?.level ? [a.test.content.exam.level] : [])]}
          stats={[
            `⏱ ${sections.reduce((n, s) => n + s.durationMin, 0)} ${t("pmk.min")}`,
            `📚 ${sections.length} ${t("pmk.sections")}`,
            `❓ ${sections.reduce((n, s) => n + s.parts.reduce((m, p) => m + p.questions.reduce((k, q) => k + q.span, 0), 0), 0)} ${t("pmk.questions")}`,
          ]}
          result={overall != null ? { value: `${overall}%`, label: t("prx.overall"), hint: t("prx.overallHint"), color: percentColor(overall) } : null}
          items={sections.map((s): OverviewItem => {
            const r = practiceResult(a.results, s.key);
            const qn = s.parts.reduce((n, p) => n + p.questions.reduce((m, q) => m + q.span, 0), 0);
            const d = deadline(s);
            return {
              key: s.key,
              icon: s.tasks.length && !qn ? "✍️" : /math|matem|матем/i.test(s.title) ? "📐" : /read|чтен|lesen|okuma|읽기|読解|阅读|القراءة/i.test(s.title) ? "📖" : "📝",
              title: s.title,
              meta: `${[qn ? `${qn} ${t("pmk.questions")}` : null, s.tasks.length ? `${s.tasks.length} ${t("pmk.tasks")}` : null].filter(Boolean).join(" · ")} · ⏱ ${s.durationMin} ${t("pmk.min")}`,
              state: done(s.key) ? (r?.status === "PENDING" ? "pending" : r?.status === "REVIEW" ? "review" : "done") : started(s.key) ? "started" : "todo",
              leftMs: started(s.key) && !done(s.key) && d ? d - now : null,
              score: done(s.key) && r?.percent != null ? `${r.percent}%` : null,
              scoreColor: percentColor(r?.percent),
              note: done(s.key) ? (r?.status === "PENDING" ? t("prx.aiMarking") : r?.status === "REVIEW" ? t("pmk.teacherMarks") : `${Math.round((r?.raw ?? 0) * 10) / 10}/${r?.max ?? 0} ${t("prx.points")}`) : null,
              cta: {
                label: done(s.key) ? `📊 ${t("pmk.review")}` : started(s.key) ? `▶ ${t("pmk.continue")}` : `▶ ${t("pmk.startSection")}`,
                onClick: () => setOpen(s.key),
                disabled: readOnly && !done(s.key),
              },
            };
          })}
          tips={[
            { icon: "⏱", title: t("pmk.tipTimerT"), text: t("pmk.tipTimer") },
            { icon: "💾", title: t("pmk.tipSaveT"), text: t("pmk.tipSave") },
            { icon: "📊", title: t("pmk.tipResultT"), text: t("pmk.tipResult") },
          ]}
        />
      )}

      {current && !done(current.key) && !readOnly && (
        <PracticeExam
          attempt={a}
          section={current}
          answers={answers[current.key] ?? {}}
          onAnswer={(key, v) => setAnswer(current.key, key, v)}
          onBegin={() => (started(current.key) ? Promise.resolve() : begin(current.key))}
          onSubmit={(auto) => void submit(current.key).then(() => { if (!auto) setOpen(null); })}
          left={left}
          saveState={saved}
          onExit={() => { void flush(); setOpen(null); }}
        />
      )}

      {current && done(current.key) && <SectionReview a={a} section={current} answers={answers[current.key] ?? a.answers[current.key] ?? {}} />}
    </div>
  );
}

function SectionReview({ a, section, answers }: { a: PortalPracticeAttempt; section: PortalPracticeSection; answers: Text }) {
  const { t } = useLanguage();
  const r = practiceResult(a.results, section.key);
  const keys = a.keys[section.key];
  const english = /ingliz|english|ielts|sat|англ/i.test(a.test.subject);
  // True / False / Not Given keys in the interface language.
  const keyLabel = (k: string | undefined) =>
    english || !k ? k : ({ True: t("pt.true"), False: t("pt.false"), "Not Given": t("qt.notGiven") } as Record<string, string>)[k] ?? k;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: percentColor(r?.percent) }}>{r?.percent != null ? `${r.percent}%` : r?.status === "PENDING" ? "⏳" : "—"}</div>
        <div style={{ fontSize: 13.5, color: "var(--text-soft)", flex: 1, minWidth: 200 }}>
          <b>{Math.round((r?.raw ?? 0) * 10) / 10}/{r?.max ?? 0}</b> {t("prx.points")}{r?.late ? ` · ${t("pmk.late")}` : ""}
          {r?.status === "PENDING" && <div>{t("prx.aiMarking")}</div>}
          {r?.status === "REVIEW" && <div>{t("pmk.teacherMarks")}</div>}
          {r?.teacherComment && <div style={{ marginTop: 6, color: "var(--success)", background: "var(--success-soft)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>💬 {r.teacherComment}</div>}
        </div>
      </div>
      {section.parts.map((p, pi) => (
        <section key={pi} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{p.title}</div>
          {p.text && (
            <details style={{ ...card, fontSize: 14, lineHeight: 1.7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>📄 {t("exm.paneText")}</summary>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{p.text}</div>
            </details>
          )}
          {p.questions.map((q) => {
            const mark = r?.marks?.[Number(q.id)];
            const given = (answers[q.id] ?? "").trim();
            return (
              <div key={q.id} style={{ ...card, padding: 12, borderColor: mark === true ? "var(--success-border)" : mark === false ? "var(--danger-border)" : "var(--border)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ minWidth: 26, height: 26, padding: "0 4px", borderRadius: "var(--radius-xs)", background: "var(--primary-soft)", color: ACCENT, fontWeight: 800, fontSize: 12.5, display: "grid", placeItems: "center" }}>{q.span > 1 ? `${q.no}–${q.no + q.span - 1}` : q.no}</span>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", flex: 1 }}>{q.prompt}</div>
                  {mark !== undefined && <span style={{ fontSize: 16 }}>{mark ? "✅" : "❌"}</span>}
                </div>
                <QuestionInput q={q} value={answers[q.id] ?? ""} onChange={() => undefined} disabled exam examWording={english} />
                {mark === false && !given && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--warning)", fontWeight: 700 }}>— {t("exm.noAnswer")}</div>}
                {keys && mark === false && <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--success)", fontWeight: 700 }}>✓ {t("pmk.answer")}: {keyLabel(keys[Number(q.id)])}</div>}
              </div>
            );
          })}
        </section>
      ))}
      {section.tasks.map((task, i) => {
        const tr = r?.tasks?.[i];
        return (
          <section key={i} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{task.title}</div>
              {tr?.score != null && <b style={{ color: percentColor(tr.score * 10), fontSize: 18 }}>{tr.score}/10</b>}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: 12 }}>{task.prompt}</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12, background: "var(--surface-muted)" }}>
              {answers[`t${i}`]?.trim() || <span style={{ color: "var(--text-muted)" }}>{t("exm.noAnswer")}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{tr?.words ?? 0} {t("mock.words")}</div>
            {tr?.comment && <div style={{ borderLeft: `3px solid ${ACCENT}`, background: "var(--primary-soft)", borderRadius: "var(--radius-xs)", padding: "8px 10px", fontSize: 13.5 }}>🤖 {tr.comment}</div>}
          </section>
        );
      })}
    </div>
  );
}
