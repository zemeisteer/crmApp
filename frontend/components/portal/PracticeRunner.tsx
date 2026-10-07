"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QuestionInput from "@/components/tests/QuestionInput";
import PracticeExam from "@/components/portal/PracticeExam";
import { ApiError, portalMockApi, practiceResult, type PortalPracticeAttempt, type PortalPracticeSection } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { PORTAL_ACCENT as ACCENT, portalCard as card } from "@/components/portal/PortalTabs";

type Text = Record<string, string>;

export const percentColor = (p: number | null | undefined) =>
  p == null ? "#686B75" : p >= 85 ? "#1FA463" : p >= 60 ? ACCENT : p >= 40 ? "#D97706" : "#DC2626";

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
        <span style={{ fontSize: 12, fontWeight: 800, color: "#4A4E58", background: "#F2F1EC", padding: "3px 10px", borderRadius: 100 }}>{a.test.subject}</span>
      </div>
      {error && <div role="alert" style={{ ...card, color: "#B23A47", fontSize: 13 }}>{error}</div>}

      {!open && (
        <>
          {overall != null && (
            <div style={{ ...card, display: "flex", alignItems: "center", gap: 16, background: "linear-gradient(135deg, #EEF0FF, #fff)" }}>
              <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: "#fff", border: `4px solid ${percentColor(overall)}`, fontSize: 22, fontWeight: 800, color: percentColor(overall) }}>{overall}%</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{t("prx.overall")}</div>
                <div style={{ fontSize: 13, color: "#6B6E78" }}>{t("prx.overallHint")}</div>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {sections.map((s) => {
              const r = practiceResult(a.results, s.key);
              const qn = s.parts.reduce((n, p) => n + p.questions.reduce((m, q) => m + q.span, 0), 0);
              return (
                <div key={s.key} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 800 }}>{s.title}</div>
                    {done(s.key) && <span style={{ fontSize: 19, fontWeight: 800, color: percentColor(r?.percent) }}>{r?.percent != null ? `${r.percent}%` : r?.status === "PENDING" ? "⏳" : "✓"}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#6B6E78" }}>
                    {[qn ? `${qn} ${t("pmk.questions")}` : null, s.tasks.length ? `${s.tasks.length} ${t("pmk.tasks")}` : null].filter(Boolean).join(" · ")} · ⏱ {s.durationMin} {t("pmk.min")}
                  </div>
                  {done(s.key) && (
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: r?.status === "REVIEW" ? "#B45309" : r?.status === "PENDING" ? ACCENT : "#1FA463" }}>
                      {r?.status === "PENDING" ? t("prx.aiMarking") : r?.status === "REVIEW" ? t("pmk.teacherMarks") : `${Math.round((r?.raw ?? 0) * 10) / 10}/${r?.max ?? 0} ${t("prx.points")}`}
                    </div>
                  )}
                  <button type="button" disabled={readOnly && !done(s.key)} onClick={() => setOpen(s.key)}
                    style={{ marginTop: "auto", background: done(s.key) ? "#fff" : ACCENT, color: done(s.key) ? "#181A1F" : "#fff", border: done(s.key) ? "1px solid #EAE8E2" : "none", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer", opacity: readOnly && !done(s.key) ? 0.5 : 1 }}>
                    {done(s.key) ? `📊 ${t("pmk.review")}` : started(s.key) ? `▶ ${t("pmk.continue")}` : `▶ ${t("pmk.startSection")}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>ℹ️ {t("pmk.rules")}</div>
        </>
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
        <div style={{ fontSize: 13.5, color: "#4A4E58", flex: 1, minWidth: 200 }}>
          <b>{Math.round((r?.raw ?? 0) * 10) / 10}/{r?.max ?? 0}</b> {t("prx.points")}{r?.late ? ` · ${t("pmk.late")}` : ""}
          {r?.status === "PENDING" && <div>{t("prx.aiMarking")}</div>}
          {r?.status === "REVIEW" && <div>{t("pmk.teacherMarks")}</div>}
          {r?.teacherComment && <div style={{ marginTop: 6, color: "#14532D", background: "#ECFDF5", borderRadius: 10, padding: "8px 10px" }}>💬 {r.teacherComment}</div>}
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
              <div key={q.id} style={{ ...card, padding: 12, borderColor: mark === true ? "#BBF7D0" : mark === false ? "#FECACA" : "#EAE8E2" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ minWidth: 26, height: 26, padding: "0 4px", borderRadius: 8, background: "#EEF0FF", color: ACCENT, fontWeight: 800, fontSize: 12.5, display: "grid", placeItems: "center" }}>{q.span > 1 ? `${q.no}–${q.no + q.span - 1}` : q.no}</span>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", flex: 1 }}>{q.prompt}</div>
                  {mark !== undefined && <span style={{ fontSize: 16 }}>{mark ? "✅" : "❌"}</span>}
                </div>
                <QuestionInput q={q} value={answers[q.id] ?? ""} onChange={() => undefined} disabled exam examWording={english} />
                {mark === false && !given && <div style={{ marginTop: 8, fontSize: 12.5, color: "#B45309", fontWeight: 700 }}>— {t("exm.noAnswer")}</div>}
                {keys && mark === false && <div style={{ marginTop: 6, fontSize: 12.5, color: "#167A48", fontWeight: 700 }}>✓ {t("pmk.answer")}: {keyLabel(keys[Number(q.id)])}</div>}
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
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#F7F7F5", borderRadius: 12, padding: 12 }}>{task.prompt}</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap", border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, background: "#FAFAF8" }}>
              {answers[`t${i}`]?.trim() || <span style={{ color: "#686B75" }}>{t("exm.noAnswer")}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: "#6B6E78" }}>{tr?.words ?? 0} {t("mock.words")}</div>
            {tr?.comment && <div style={{ borderLeft: `3px solid ${ACCENT}`, background: "#EEF0FF", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }}>🤖 {tr.comment}</div>}
          </section>
        );
      })}
    </div>
  );
}
