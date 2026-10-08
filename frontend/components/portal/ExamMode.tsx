"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QuestionInput from "@/components/tests/QuestionInput";
import { ApiError, portalMockApi, type MockSection, type PortalMockAttempt } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { PrivateImg } from "@/components/PrivateFile";
import { useFileUrls } from "@/lib/files";

// The exam screen, laid out like computer-delivered IELTS: a plain top bar
// with the clock, the task in the middle, and a bar at the bottom with the
// parts and every question number (answered, current, flagged for review).
// Listening plays once, as in the exam, then gives 2 minutes to check.

type Text = Record<string, string>;
type PQ = PortalMockAttempt["test"]["content"]["reading"]["passages"][number]["questions"][number];
const REVIEW_MS = 2 * 60_000;
export const INK = "#111827";
export const LINE = "#D1D5DB";
export const BLUE = "#1D4ED8";

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const wordsOf = (s: string) => (s.trim().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
const numLabel = (q: PQ) => (q.span > 1 ? `${q.no}–${q.no + q.span - 1}` : String(q.no));
// Marks answered: a matching task counts each chosen item.
const answeredMarks = (q: PQ, v: string | undefined) => {
  const val = (v ?? "").trim();
  if (!val) return 0;
  if (q.type === "MATCHING") {
    try {
      return Math.min(q.span, Object.values(JSON.parse(val) as Record<string, string>).filter(Boolean).length);
    } catch {
      return 0;
    }
  }
  if (q.type === "MCQ_MULTI") return Math.min(q.span, val.split(",").filter(Boolean).length);
  return q.span;
};

export interface ExamProps {
  attempt: PortalMockAttempt;
  section: MockSection;
  answers: Text;
  onAnswer: (key: string, value: string) => void;
  onSubmit: (auto: boolean) => void;
  // Milliseconds left on the section clock (server time), null before start.
  left: number | null;
  now: number;
  onExit: () => void;
  onSpeakingSaved: () => void;
  // Starts the section clock on the server (first start only).
  onBegin: () => Promise<void>;
  // Autosave state shown in the top bar.
  saveState?: "idle" | "saving" | "saved" | "error";
}

export const EXAM_CSS = `
.exm-root{position:fixed;inset:0;z-index:200;background:#fff;display:flex;flex-direction:column}
.exm-head{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid #D1D5DB;background:#F9FAFB}
.exm-title{font-size:13px;color:#374151;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.exm-split{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.exm-split>*{min-height:0;height:100%}
.exm-panes{display:none}
@media(max-width:899px){
  .exm-split{grid-template-columns:minmax(0,1fr)}
  .exm-split[data-pane="text"]>.exm-q,.exm-split[data-pane="q"]>.exm-text{display:none}
  .exm-split>.exm-q{border-left:none!important}
  .exm-panes{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #D1D5DB;background:#fff}
  .exm-panes button{flex:1;border:1px solid #D1D5DB;background:#fff;border-radius:6px;padding:8px;font-weight:700;font-size:14px;cursor:pointer;color:#111827}
  .exm-panes button[aria-selected="true"]{background:#1D4ED8;border-color:#1D4ED8;color:#fff}
}
@media(max-width:640px){
  .exm-head{gap:8px;padding:6px 10px}
  .exm-title,.exm-hide-sm{display:none}
  .exm-logo{font-size:15px!important}
}
`;

export default function ExamMode(props: ExamProps) {
  const { t } = useLanguage();
  const { attempt, section, left } = props;
  const [started, setStarted] = useState(false);
  const [font, setFont] = useState(16);
  const [volume, setVolume] = useState(1);
  const [reviewEnds, setReviewEnds] = useState<number | null>(null);

  // Listening: after the recording, 2 minutes to check, then hand in.
  const effectiveLeft = section === "listening" && reviewEnds ? Math.min(left ?? Infinity, reviewEnds - props.now) : left;
  const sent = useRef(false);
  useEffect(() => {
    if (!started || sent.current || effectiveLeft === null || effectiveLeft > 0 || section === "speaking") return;
    sent.current = true;
    props.onSubmit(true);
  }, [effectiveLeft, started, section, props]);

  // Leaving by accident loses nothing (answers autosave), but warn anyway.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const title = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" }[section];

  const fs = useFullscreen();
  function start() {
    fs.enter();
    props.onBegin().then(() => setStarted(true)).catch(() => undefined);
  }

  return (
    <div className="exm-root" style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: font }}>
      <style>{EXAM_CSS}</style>
      <ExamHeader
        brand="IELTS"
        title={<>{attempt.test.title} · <b>{title}</b>{attempt.test.module === "GENERAL" && section === "reading" ? " (General Training)" : ""}</>}
        left={started && section !== "speaking" ? effectiveLeft : null}
        leftPrefix={reviewEnds ? t("exm.review") : undefined}
        saveState={started && section !== "speaking" ? props.saveState : undefined}
        extra={section === "listening" && started ? (
          <label className="exm-hide-sm" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            🔊 <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ width: 90 }} aria-label="volume" />
          </label>
        ) : null}
        onFont={(d) => setFont((f) => Math.max(13, Math.min(22, f + d)))}
        full={fs.full}
        onToggleFull={fs.toggle}
        onExit={props.onExit}
      />

      {!started ? (
        <Instructions section={section} attempt={attempt} onStart={start} resuming={!!attempt.sectionStarted[section] && (left ?? 1) < sectionMs(attempt, section) - 5000} />
      ) : section === "listening" ? (
        <ListeningExam {...props} volume={volume} onAudioDone={() => setReviewEnds((r) => r ?? props.now + REVIEW_MS)} />
      ) : section === "reading" ? (
        <ReadingExam {...props} />
      ) : section === "writing" ? (
        <WritingExam {...props} />
      ) : (
        <SpeakingExam {...props} />
      )}
    </div>
  );
}

export const smallBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: "#fff", borderRadius: 6, padding: "5px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: INK };

// Full screen while a section runs, like the test centre's computer. Enter
// only from a click (browsers allow it only then); leave on unmount.
export function useFullscreen() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const enter = () => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else enter();
  };
  return { full, enter, toggle };
}

// The exam's top bar: brand, title, clock, save state, text size, full
// screen and leave. Compact on phones.
export function ExamHeader({ brand, title, left, leftPrefix, saveState, extra, onFont, full, onToggleFull, onExit }: {
  brand: string;
  title: React.ReactNode;
  left: number | null;
  leftPrefix?: string;
  saveState?: "idle" | "saving" | "saved" | "error";
  extra?: React.ReactNode;
  onFont: (delta: number) => void;
  full: boolean;
  onToggleFull: () => void;
  onExit: () => void;
}) {
  const { t } = useLanguage();
  const save = saveState ?? "idle";
  return (
    <header className="exm-head">
      <div className="exm-logo" style={{ fontWeight: 900, letterSpacing: 1, color: "#B91C1C", fontSize: 18, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{brand}</div>
      <div className="exm-title">{title}</div>
      {left !== null && (
        <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", color: left < 5 * 60_000 ? "#B91C1C" : INK, marginLeft: "auto" }} aria-live="polite">
          {leftPrefix ? <span className="exm-hide-sm">{leftPrefix} </span> : ""}⏱ {mmss(left)}<span className="exm-hide-sm"> {t("exm.left")}</span>
        </div>
      )}
      {save !== "idle" && (
        <span title={t("pmk.saved")} style={{ fontSize: 12, whiteSpace: "nowrap", color: save === "error" ? "#B91C1C" : "#6B7280" }}>
          {save === "saving" ? "⏳" : save === "error" ? "⚠" : "✓"}<span className="exm-hide-sm"> {save === "saving" ? t("pmk.saving") : save === "error" ? t("exm.saveError") : t("pmk.saved")}</span>
        </span>
      )}
      {extra}
      <div style={{ display: "flex", gap: 4, marginLeft: left !== null ? 0 : "auto" }}>
        <button type="button" onClick={() => onFont(-1)} style={smallBtn} aria-label="smaller text">A−</button>
        <button type="button" onClick={() => onFont(1)} style={smallBtn} aria-label="bigger text">A+</button>
        <button type="button" onClick={onToggleFull} style={smallBtn} aria-label={t("exm.fullscreen")} title={t("exm.fullscreen")}>{full ? "⤡" : "⛶"}</button>
      </div>
      <button type="button" onClick={onExit} style={{ ...smallBtn, padding: "5px 10px", whiteSpace: "nowrap" }}>✕<span className="exm-hide-sm"> {t("exm.pause")}</span></button>
    </header>
  );
}

function sectionMs(a: PortalMockAttempt, s: MockSection) {
  return (s === "speaking" ? 15 : a.test.content[s].durationMin) * 60_000;
}

// ---------------------------------------------------------- instructions

function Instructions({ section, attempt, onStart, resuming }: { section: MockSection; attempt: PortalMockAttempt; onStart: () => void; resuming: boolean }) {
  const { t } = useLanguage();
  const c = attempt.test.content;
  const count = section === "listening" ? c.listening.parts.reduce((n, p) => n + p.questions.reduce((m, q) => m + q.span, 0), 0)
    : section === "reading" ? c.reading.passages.reduce((n, p) => n + p.questions.reduce((m, q) => m + q.span, 0), 0) : 0;
  const lines: Record<MockSection, string[]> = {
    listening: [t("exm.i.l1").replace("{n}", String(c.listening.parts.length)).replace("{q}", String(count)), t("exm.i.l2"), t("exm.i.l3"), t("exm.i.l4")],
    reading: [t("exm.i.r1").replace("{n}", String(c.reading.passages.length)).replace("{q}", String(count)).replace("{m}", String(c.reading.durationMin)), t("exm.i.r2"), t("exm.i.r3")],
    writing: [t("exm.i.w1").replace("{m}", String(c.writing.durationMin)), t("exm.i.w2"), t("exm.i.w3")],
    speaking: [t("exm.i.s1"), t("exm.i.s2"), t("exm.i.s3")],
  };
  const time = section === "speaking" ? "11–14" : String(c[section].durationMin);
  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ maxWidth: 680, width: "100%", border: `1px solid ${LINE}`, borderRadius: 8, padding: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>IELTS {section[0].toUpperCase() + section.slice(1)}</div>
        <div style={{ color: "#4B5563", marginBottom: 18 }}>{t("exm.time")}: {time} {t("exm.minutes")}</div>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{t("exm.instructions")}</div>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>{lines[section].map((l, i) => <li key={i}>{l}</li>)}</ul>
        {resuming && <div style={{ marginTop: 16, padding: 12, background: "#FEF3C7", borderRadius: 6, fontSize: 14 }}>⚠️ {t("exm.resume")}</div>}
        <button type="button" onClick={onStart} style={{ marginTop: 24, background: BLUE, color: "#fff", border: "none", borderRadius: 6, padding: "12px 26px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
          {resuming ? t("exm.continue") : t("exm.start")} ▶
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------- question bits

// A gap-fill line with the box inside the sentence, numbered like the paper.
function GapLine({ q, value, onChange }: { q: PQ; value: string; onChange: (v: string) => void }) {
  const parts = q.prompt.split(/_{3,}|\.{4,}|…{2,}/);
  const box = (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={String(q.no)}
      aria-label={`Question ${q.no}`}
      autoComplete="off"
      spellCheck={false}
      style={{ width: Math.max(130, Math.min(260, value.length * 10 + 40)), padding: "4px 8px", border: `1px solid ${value ? BLUE : "#6B7280"}`, borderRadius: 3, fontSize: "inherit", fontFamily: "inherit", textAlign: value ? "left" : "center", margin: "0 4px" }}
    />
  );
  if (parts.length < 2) {
    return <div style={{ lineHeight: 2.1 }}>{q.prompt} {box}</div>;
  }
  return (
    <div style={{ lineHeight: 2.1, whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => (
        <span key={i}>{p}{i < parts.length - 1 && i === 0 ? box : i < parts.length - 1 ? " ______ " : ""}</span>
      ))}
    </div>
  );
}

export function QuestionBlock({ q, prev, value, onAnswer, flagged, onFlag, sectionKey, examWording = true }: {
  q: PQ; prev?: PQ; value: string; onAnswer: (v: string) => void; flagged: boolean; onFlag: () => void; sectionKey: string; examWording?: boolean;
}) {
  const showSection = q.section && q.section !== prev?.section;
  const showInstr = q.instruction && (q.instruction !== prev?.instruction || showSection);
  const gap = q.type === "FILL_BLANK";
  // Matching imported as one choice question per item: the shared list is
  // printed once (like "List of Headings"), each item gets a dropdown.
  const boxed = q.type === "MCQ" && (q.options ?? []).length > 5;
  const showBox = boxed && !(prev && prev.type === "MCQ" && sameOptions(prev, q));
  return (
    <div id={`q-${sectionKey}-${q.id}`} style={{ scrollMarginTop: 16 }}>
      {showSection && <div style={{ fontWeight: 800, marginTop: 18, marginBottom: 4 }}>{q.section}</div>}
      {showInstr && <div style={{ fontStyle: "italic", marginBottom: 10, whiteSpace: "pre-wrap" }}>{q.instruction}</div>}
      {q.passage && q.passage !== prev?.passage && (
        <div style={{ border: `1px solid ${LINE}`, background: "#F9FAFB", padding: "12px 14px", margin: "6px 0 10px", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{q.passage}</div>
      )}
      {showBox && (
        <div style={{ border: `1px solid ${INK}`, padding: "10px 14px", margin: "6px 0 10px", maxWidth: 560 }}>
          {(q.options ?? []).map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 10, lineHeight: 1.6 }}>
              <b style={{ minWidth: 28 }}>{o.id}</b>
              {o.text !== o.id && <span>{o.text}</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderLeft: flagged ? "3px solid #F59E0B" : "3px solid transparent", paddingLeft: 8 }}>
        <button type="button" onClick={onFlag} title="Review" aria-pressed={flagged}
          style={{ minWidth: 34, height: 28, border: `1px solid ${flagged ? "#F59E0B" : LINE}`, background: flagged ? "#FEF3C7" : "#fff", borderRadius: 4, fontWeight: 800, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>
          {numLabel(q)}{flagged ? " ⚑" : ""}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {gap ? (
            <GapLine q={q} value={value} onChange={onAnswer} />
          ) : boxed ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
              <span style={{ flex: "1 1 220px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{q.prompt}</span>
              <div style={{ flex: "1 1 220px", maxWidth: 360 }}><QuestionInput q={q} value={value} onChange={onAnswer} exam examWording={examWording} /></div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{q.prompt}</div>
              <QuestionInput q={q} value={value} onChange={onAnswer} exam examWording={examWording} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Bottom bar: parts and question numbers; click jumps to the question.
export function NavBar({ groups, current, onPart, onJump, answers, flags, sectionKey, onSubmit, submitLabel }: {
  groups: Array<{ label: string; questions: PQ[] }>;
  current: number;
  onPart: (i: number) => void;
  // Called before jumping to a question (phones switch to the questions pane).
  onJump?: () => void;
  answers: Text;
  flags: Set<string>;
  sectionKey: string;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const jump = (gi: number, id: string) => {
    onJump?.();
    onPart(gi);
    setTimeout(() => document.getElementById(`q-${sectionKey}-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  return (
    <nav style={{ borderTop: `1px solid ${LINE}`, background: "#F9FAFB", padding: "6px 10px", display: "flex", alignItems: "center", gap: 10, overflowX: "auto" }}>
      <button type="button" disabled={current === 0} onClick={() => onPart(current - 1)} style={{ ...smallBtn, opacity: current === 0 ? 0.4 : 1 }} aria-label="previous part">◀</button>
      {groups.map((g, gi) => {
        const answered = g.questions.reduce((n, q) => n + answeredMarks(q, answers[q.id]), 0);
        const total = g.questions.reduce((n, q) => n + q.span, 0);
        return (
          <div key={gi} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 6, background: gi === current ? "#DBEAFE" : "transparent", flexShrink: 0 }}>
            <button type="button" onClick={() => onPart(gi)} style={{ border: "none", background: "none", fontWeight: 800, cursor: "pointer", fontSize: 13, color: INK, whiteSpace: "nowrap" }}>
              {g.label} <span style={{ fontWeight: 500, color: "#4B5563" }}>{answered}/{total}</span>
            </button>
            {gi === current && g.questions.map((q) => {
              const done = answeredMarks(q, answers[q.id]) >= q.span;
              const flag = flags.has(q.id);
              return (
                <button key={q.id} type="button" onClick={() => jump(gi, q.id)} title={flag ? "Review" : undefined}
                  style={{ minWidth: 28, height: 26, padding: "0 4px", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${flag ? "#F59E0B" : done ? BLUE : "#9CA3AF"}`, background: flag ? "#FEF3C7" : done ? BLUE : "#fff", color: done && !flag ? "#fff" : INK }}>
                  {numLabel(q)}
                </button>
              );
            })}
          </div>
        );
      })}
      <button type="button" disabled={current === groups.length - 1} onClick={() => onPart(current + 1)} style={{ ...smallBtn, opacity: current === groups.length - 1 ? 0.4 : 1 }} aria-label="next part">▶</button>
      <button type="button" onClick={onSubmit} style={{ marginLeft: "auto", background: "#15803D", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>✓ {submitLabel}</button>
    </nav>
  );
}

// Phones: the text and the questions (or the answer box) are two tabs
// instead of two cramped columns.
export function PaneTabs({ pane, onPane, textLabel, qLabel }: { pane: "text" | "q"; onPane: (p: "text" | "q") => void; textLabel: string; qLabel: string }) {
  return (
    <div className="exm-panes" role="tablist">
      <button type="button" role="tab" aria-selected={pane === "text"} onClick={() => onPane("text")}>{textLabel}</button>
      <button type="button" role="tab" aria-selected={pane === "q"} onClick={() => onPane("q")}>{qLabel}</button>
    </div>
  );
}

const sameOptions = (a: PQ, b: PQ) =>
  (a.options ?? []).length === (b.options ?? []).length && (a.options ?? []).every((o, i) => o.id === b.options?.[i]?.id && o.text === b.options?.[i]?.text);

export function useFlags() {
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => setFlags((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  return { flags, toggle };
}

export function confirmSubmit(t: (k: import("@/lib/i18n").TranslationKey) => string, questions: PQ[], answers: Text) {
  const missing = questions.reduce((n, q) => n + q.span - answeredMarks(q, answers[q.id]), 0);
  return confirm(missing > 0 ? t("exm.confirmMissing").replace("{n}", String(missing)) : t("exm.confirm"));
}

// ------------------------------------------------------------ Listening

function ListeningExam(props: ExamProps & { volume: number; onAudioDone: () => void }) {
  const { t } = useLanguage();
  const { attempt, answers, onAnswer } = props;
  const L = attempt.test.content.listening;
  const [part, setPart] = useState(0);
  const { flags, toggle } = useFlags();
  const all = L.parts.flatMap((p) => p.questions);
  const { status, progress } = useListeningAudio(attempt, props.volume, props.onAudioDone);

  return (
    <>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#EFF6FF", fontSize: 14 }}>
        <b>{L.parts[part]?.title}</b>
        {L.parts[part]?.questions.length ? ` — ${t("exm.questions")} ${L.parts[part].questions[0].no}–${L.parts[part].questions.at(-1)!.no + L.parts[part].questions.at(-1)!.span - 1}` : ""}
        <span style={{ marginLeft: 12, color: "#1E40AF" }}>{status}</span>
        {progress && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12, verticalAlign: "middle" }}>
            <span style={{ width: 140, height: 6, borderRadius: 6, background: "#BFDBFE", overflow: "hidden", display: "inline-block" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.min(100, (progress.at / progress.total) * 100)}%`, background: BLUE }} />
            </span>
            <span style={{ fontSize: 12.5, color: "#1E40AF", fontVariantNumeric: "tabular-nums" }}>{mmss(progress.at * 1000)} / {mmss(progress.total * 1000)}</span>
          </span>
        )}
      </div>
      <main style={{ flex: 1, overflowY: "auto", padding: "12px 20px 40px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {L.parts[part]?.instruction && <div style={{ fontStyle: "italic", margin: "8px 0" }}>{L.parts[part].instruction}</div>}
          {L.parts[part]?.imagePath && (
            <PrivateImg name={L.parts[part].imagePath} scope="portal" alt="" style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain", border: `1px solid ${LINE}`, margin: "8px 0" }} />
          )}
          {L.parts[part]?.questions.map((q, i, list) => (
            <QuestionBlock key={q.id} q={q} prev={list[i - 1]} value={answers[q.id] ?? ""} onAnswer={(v) => onAnswer(q.id, v)} flagged={flags.has(q.id)} onFlag={() => toggle(q.id)} sectionKey="listening" />
          ))}
        </div>
      </main>
      <NavBar groups={L.parts.map((p, i) => ({ label: `Part ${i + 1}`, questions: p.questions }))} current={part} onPart={setPart} answers={answers} flags={flags} sectionKey="listening"
        submitLabel={t("exm.submit")} onSubmit={() => { if (confirmSubmit(t, all, answers)) props.onSubmit(false); }} />
    </>
  );
}

// Plays the recording(s) once, in order, from where the clock says the
// student is (after a reload). Without recordings the browser reads the
// scripts aloud. Returns a status line.
function useListeningAudio(attempt: PortalMockAttempt, volume: number, onDone: () => void) {
  const { t } = useLanguage();
  const L = attempt.test.content.listening;
  const [status, setStatus] = useState("");
  // Seconds played / total of the recording(s), for the progress bar.
  const [progress, setProgress] = useState<{ at: number; total: number } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  // Signed links (private recordings): playback starts once all are known.
  const names = useMemo(() => (L.audioPath ? [L.audioPath] : L.parts.map((p) => p.audioPath).filter((x): x is string => !!x)), [L]);
  const links = useFileUrls(names, "portal");
  const ready = names.every((n) => n in links);
  const sources = useMemo(() => (ready ? names.map((n) => links[n]).filter((x): x is string => !!x) : null), [ready, names, links]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  const started = useRef(false);
  useEffect(() => {
    if (sources === null || started.current) return;
    started.current = true;
    let cancelled = false;
    const startedAt = Date.parse(attempt.sectionStarted.listening ?? new Date().toISOString());
    const finish = () => { if (!cancelled) { setStatus(`✓ ${t("exm.audioEnded")}`); doneRef.current(); } };

    if (sources.length === 0) {
      const scripts = L.parts.map((p) => p.tts).filter((x): x is string => !!x);
      if (!scripts.length || typeof window === "undefined" || !("speechSynthesis" in window)) { finish(); return; }
      const synth = window.speechSynthesis;
      const key = `mock-tts-${attempt.id}`;
      let i = Number(localStorage.getItem(key) ?? 0);
      const speak = () => {
        if (cancelled) return;
        if (i >= scripts.length) { localStorage.removeItem(key); finish(); return; }
        setStatus(`🔊 ${t("exm.playing")} Part ${i + 1}`);
        const u = new SpeechSynthesisUtterance(scripts[i]);
        u.lang = "en-GB";
        u.rate = 0.95;
        u.volume = volume;
        const voice = synth.getVoices().find((v) => v.lang.startsWith("en-GB")) ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
        if (voice) u.voice = voice;
        let moved = false;
        const onward = () => {
          if (moved) return;
          moved = true;
          i++;
          try { localStorage.setItem(key, String(i)); } catch { /* private mode */ }
          setTimeout(speak, 1500);
        };
        // A browser without voices may never end the utterance.
        const guard = setTimeout(onward, 4000 + wordsOf(scripts[i]) * 450);
        u.onend = () => { clearTimeout(guard); onward(); };
        u.onerror = () => { clearTimeout(guard); onward(); };
        synth.speak(u);
      };
      speak();
      return () => { cancelled = true; synth.cancel(); };
    }

    // Durations first, to resume at the right place after a reload.
    const probe = async (src: string) => new Promise<number>((res) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => res(0);
      a.src = src;
    });
    (async () => {
      const durations = await Promise.all(sources.map(probe));
      if (cancelled) return;
      let offset = Math.max(0, (Date.now() - startedAt) / 1000 - 2);
      let index = 0;
      while (index < sources.length && durations[index] > 0 && offset >= durations[index]) { offset -= durations[index]; index++; }
      if (index >= sources.length) { finish(); return; }
      const total = durations.reduce((x, y) => x + y, 0);
      const before = (i: number) => durations.slice(0, i).reduce((x, y) => x + y, 0);
      const play = (i: number, at: number) => {
        if (cancelled) return;
        if (i >= sources.length) { finish(); return; }
        const a = new Audio(sources[i]);
        audio.current = a;
        a.volume = volume;
        a.ontimeupdate = () => { if (total > 0) setProgress({ at: before(i) + a.currentTime, total }); };
        a.onended = () => play(i + 1, 0);
        a.onerror = () => play(i + 1, 0);
        a.onloadedmetadata = () => { if (at > 0) a.currentTime = at; };
        setStatus(`🔊 ${t("exm.playing")}${sources.length > 1 ? ` (${i + 1}/${sources.length})` : ""}`);
        a.play().catch(() => setStatus(`⚠️ ${t("exm.audioBlocked")}`));
      };
      play(index, offset);
    })();
    return () => { cancelled = true; audio.current?.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once per mount, when the links are known
  }, [sources]);

  return { status, progress };
}

// -------------------------------------------------------------- Reading

function ReadingExam(props: ExamProps) {
  const { t } = useLanguage();
  const { attempt, answers, onAnswer } = props;
  const R = attempt.test.content.reading;
  const [part, setPart] = useState(0);
  const { flags, toggle } = useFlags();
  const all = R.passages.flatMap((p) => p.questions);
  const p = R.passages[part];
  const [pane, setPane] = useState<"text" | "q">("text");
  return (
    <>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#EFF6FF", fontSize: 14 }}>
        <b>Part {part + 1}</b>
        {p?.questions.length ? ` — ${t("exm.readTheText")} ${p.questions[0].no}–${p.questions.at(-1)!.no + p.questions.at(-1)!.span - 1}` : ""}
      </div>
      <PaneTabs pane={pane} onPane={setPane} textLabel={`📄 ${t("exm.paneText")}`} qLabel={`✏️ ${t("exm.paneQuestions")}`} />
      <div className="exm-split" data-pane={pane}>
        <Passage key={part} title={p?.title ?? ""} text={p?.text ?? ""} imagePath={p?.imagePath ?? null} />
        <main className="exm-q" style={{ overflowY: "auto", padding: "8px 20px 40px", borderLeft: `1px solid ${LINE}` }}>
          {p?.questions.map((q, i, list) => (
            <QuestionBlock key={q.id} q={q} prev={list[i - 1]} value={answers[q.id] ?? ""} onAnswer={(v) => onAnswer(q.id, v)} flagged={flags.has(q.id)} onFlag={() => toggle(q.id)} sectionKey="reading" />
          ))}
        </main>
      </div>
      <NavBar groups={R.passages.map((x, i) => ({ label: `Part ${i + 1}`, questions: x.questions }))} current={part} onPart={(i) => { setPart(i); }} onJump={() => setPane("q")} answers={answers} flags={flags} sectionKey="reading"
        submitLabel={t("exm.submit")} onSubmit={() => { if (confirmSubmit(t, all, answers)) props.onSubmit(false); }} />
    </>
  );
}

// The passage with highlighting: select text, press "Highlight"; click a
// highlight to remove it (as in the computer exam).
export function Passage({ title, text, imagePath }: { title: string; text: string; imagePath: string | null }) {
  const { t } = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const range = useRef<Range | null>(null);

  function onUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !box.current || !box.current.contains(sel.anchorNode)) { setMenu(null); return; }
    range.current = sel.getRangeAt(0).cloneRange();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setMenu({ x: rect.left + rect.width / 2, y: rect.top - 8 });
  }

  function highlight() {
    const r = range.current;
    if (!r) return;
    const mark = document.createElement("mark");
    mark.style.background = "#FDE68A";
    mark.style.cursor = "pointer";
    mark.dataset.hl = "1";
    try {
      mark.appendChild(r.extractContents());
      r.insertNode(mark);
    } catch {
      /* selection across blocks: ignore */
    }
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function onClick(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    if (el.dataset.hl && window.getSelection()?.isCollapsed) {
      el.replaceWith(...Array.from(el.childNodes));
    }
  }

  return (
    <section className="exm-text" style={{ overflowY: "auto", padding: "8px 24px 40px", position: "relative" }} onMouseUp={onUp} onTouchEnd={onUp}>
      <div ref={box} onClick={onClick}>
        <h2 style={{ fontSize: "1.2em", margin: "10px 0 14px" }}>{title}</h2>
        {imagePath && (
          <PrivateImg name={imagePath} scope="portal" alt="" style={{ maxWidth: "100%", marginBottom: 12, border: `1px solid ${LINE}` }} />
        )}
        {text.split(/\n\s*\n/).map((para, i) => <p key={i} style={{ lineHeight: 1.75, margin: "0 0 14px", whiteSpace: "pre-wrap" }}>{para}</p>)}
      </div>
      {menu && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={highlight}
          style={{ position: "fixed", left: menu.x, top: menu.y, transform: "translate(-50%, -100%)", zIndex: 300, background: INK, color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          🖍 {t("exm.highlight")}
        </button>
      )}
    </section>
  );
}

// -------------------------------------------------------------- Writing

function WritingExam(props: ExamProps) {
  const { t } = useLanguage();
  const { attempt, answers, onAnswer } = props;
  const W = attempt.test.content.writing;
  const [task, setTask] = useState(0);
  const tk = W.tasks[task];
  const text = answers[String(task)] ?? "";
  const words = wordsOf(text);
  const [pane, setPane] = useState<"text" | "q">("text");
  return (
    <>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#EFF6FF", fontSize: 14 }}>
        <b>{tk?.title}</b> — {t("exm.writeAtLeast").replace("{n}", String(tk?.minWords ?? 0))}
      </div>
      <PaneTabs pane={pane} onPane={setPane} textLabel={`📄 ${t("exm.paneTask")}`} qLabel={`✍️ ${t("exm.paneAnswer")} (${words})`} />
      <div className="exm-split" data-pane={pane}>
        <section className="exm-text" style={{ overflowY: "auto", padding: "16px 24px" }}>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{tk?.prompt}</div>
          {tk?.imagePath && (
            <PrivateImg name={tk.imagePath} scope="portal" alt="" style={{ maxWidth: "100%", marginTop: 14, border: `1px solid ${LINE}` }} />
          )}
        </section>
        <main className="exm-q" style={{ display: "flex", flexDirection: "column", padding: 16, borderLeft: `1px solid ${LINE}`, minHeight: 320 }}>
          <textarea value={text} onChange={(e) => onAnswer(String(task), e.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off"
            style={{ flex: 1, minHeight: 280, width: "100%", boxSizing: "border-box", border: `1px solid #9CA3AF`, borderRadius: 4, padding: 12, fontSize: "inherit", fontFamily: "inherit", lineHeight: 1.7, resize: "none" }} />
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: words >= (tk?.minWords ?? 0) ? "#15803D" : "#B45309" }}>{t("exm.wordCount")}: {words}</div>
        </main>
      </div>
      <nav style={{ borderTop: `1px solid ${LINE}`, background: "#F9FAFB", padding: "6px 10px", display: "flex", gap: 8, alignItems: "center" }}>
        {W.tasks.map((x, i) => (
          <button key={i} type="button" onClick={() => { setTask(i); setPane("text"); }} style={{ ...smallBtn, background: i === task ? "#DBEAFE" : "#fff", padding: "6px 14px" }}>
            {x.title} <span style={{ fontWeight: 500 }}>({wordsOf(answers[String(i)] ?? "")})</span>
          </button>
        ))}
        <button type="button" onClick={() => { if (confirm(t("exm.confirm"))) props.onSubmit(false); }} style={{ marginLeft: "auto", background: "#15803D", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 800, cursor: "pointer" }}>✓ {t("exm.submit")}</button>
      </nav>
    </>
  );
}

// ------------------------------------------------------------- Speaking

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null };

// The examiner (browser voice) asks each question; recording starts when
// the question ends and stops at the time limit or on "Next". Part 2: the
// cue card, one minute to prepare with notes, then up to two minutes.
function SpeakingExam(props: ExamProps) {
  const { t } = useLanguage();
  const { attempt } = props;
  const S = attempt.test.content.speaking;
  const queue = useMemo(() => S.parts.flatMap((p, pi) => p.questions.map((q, qi) => ({ pi, qi, q, prep: p.prepSeconds, limit: p.answerSeconds, part: p }))), [S]);
  const firstOpen = queue.findIndex((x) => !attempt.answers.speaking?.[`${x.pi}.${x.qi}`]);
  const [pos, setPos] = useState(firstOpen < 0 ? queue.length : firstOpen);
  const [phase, setPhase] = useState<"ask" | "prep" | "rec" | "type" | "save" | "done">(firstOpen < 0 ? "done" : "ask");
  // No microphone (or no permission): answers are typed instead.
  const [typed, setTyped] = useState(false);
  const [typedText, setTypedText] = useState("");
  const typedRef = useRef("");
  const [count, setCount] = useState(0);
  const [live, setLive] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const sr = useRef<Rec | null>(null);
  const finalText = useRef("");
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const item = queue[pos];

  const stopTick = () => { if (tick.current) clearInterval(tick.current); tick.current = null; };
  const countdown = (sec: number, then: () => void) => {
    stopTick();
    const end = Date.now() + sec * 1000;
    setCount(sec);
    tick.current = setInterval(() => { const l = Math.ceil((end - Date.now()) / 1000); setCount(l); if (l <= 0) { stopTick(); then(); } }, 250);
  };

  useEffect(() => () => { stopTick(); window.speechSynthesis?.cancel(); stream.current?.getTracks().forEach((x) => x.stop()); }, []);

  const say = (text: string) => new Promise<void>((res) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { res(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 0.95;
    const v = window.speechSynthesis.getVoices().find((x) => x.lang.startsWith("en-GB"));
    if (v) u.voice = v;
    // Some browsers never fire "end" (no voices installed): go on anyway
    // after about the time the text takes to read.
    let settled = false;
    const done = () => { if (!settled) { settled = true; res(); } };
    const guard = setTimeout(done, 2500 + wordsOf(text) * 450);
    u.onend = () => { clearTimeout(guard); done(); };
    u.onerror = () => { clearTimeout(guard); done(); };
    window.speechSynthesis.speak(u);
  });

  function startTyping() {
    if (!item) return;
    typedRef.current = "";
    setTypedText("");
    setPhase("type");
    countdown(item.limit, () => void saveTyped());
  }

  async function saveTyped() {
    if (!item) return;
    stopTick();
    const text = typedRef.current.trim();
    if (text) {
      setPhase("save");
      try {
        await portalMockApi.speaking(attempt.id, `${item.pi}.${item.qi}`, { transcript: text, seconds: item.limit });
        props.onSpeakingSaved();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
      }
    }
    next();
  }

  async function record() {
    if (!item) return;
    setError(null);
    if (typed) { startTyping(); return; }
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("no recorder");
      stream.current = stream.current ?? await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setTyped(true);
      startTyping();
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current);
    rec.current = r;
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = async () => {
      sr.current?.stop();
      setPhase("save");
      await new Promise((res) => setTimeout(res, 500));
      try {
        await portalMockApi.speaking(attempt.id, `${item.pi}.${item.qi}`, { audio: new Blob(chunks, { type: r.mimeType || "audio/webm" }), transcript: finalText.current.trim(), seconds: (Date.now() - startedAt.current) / 1000 });
        props.onSpeakingSaved();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
      }
      next();
    };
    finalText.current = "";
    setLive("");
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      try {
        const s = new Ctor();
        s.lang = "en-GB";
        s.continuous = true;
        s.interimResults = true;
        s.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText.current += `${e.results[i][0].transcript} `;
            else interim += e.results[i][0].transcript;
          }
          setLive(finalText.current + interim);
        };
        s.onerror = () => undefined;
        s.start();
        sr.current = s;
      } catch {
        sr.current = null;
      }
    }
    startedAt.current = Date.now();
    r.start();
    setPhase("rec");
    countdown(item.limit, () => { if (r.state === "recording") r.stop(); });
  }

  function next() {
    const n = pos + 1;
    setNotes("");
    if (n >= queue.length) { setPos(n); setPhase("done"); return; }
    setPos(n);
    setPhase("ask");
  }

  // Each question: the examiner reads it, then prep (Part 2) or recording.
  useEffect(() => {
    if (phase !== "ask" || !item) return;
    let off = false;
    (async () => {
      const intro = item.qi === 0 && item.part.instruction ? `${item.part.instruction} ` : "";
      await say(intro + (item.prep > 0 ? "Here is your topic." : item.q));
      if (off) return;
      if (item.prep > 0) {
        setPhase("prep");
        countdown(item.prep, async () => { await say("Please start speaking now."); void record(); });
      } else {
        void record();
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per question
  }, [phase, pos]);

  const partNo = item ? item.pi + 1 : S.parts.length;
  return (
    <>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#EFF6FF", fontSize: 14 }}>
        <b>{item ? item.part.title : "Speaking"}</b>
        {item && ` — ${t("exm.question")} ${pos + 1}/${queue.length}`}
      </div>
      <main style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "30px 16px" }}>
        <div style={{ maxWidth: 720, width: "100%", display: "flex", flexDirection: "column", gap: 18, alignItems: "center", textAlign: "center" }}>
          {phase === "done" ? (
            <>
              <div style={{ fontSize: 42 }}>🎤</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{t("exm.speakingDone")}</div>
              <button type="button" onClick={() => props.onSubmit(false)} style={{ background: "#15803D", color: "#fff", border: "none", borderRadius: 6, padding: "12px 24px", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>✓ {t("exm.submit")}</button>
            </>
          ) : item ? (
            <>
              <div style={{ fontSize: 13, color: "#6B7280" }}>Part {partNo}</div>
              <div style={{ border: item.prep > 0 ? `2px solid ${INK}` : "none", borderRadius: 6, padding: item.prep > 0 ? 20 : 0, fontSize: item.prep > 0 ? "1.05em" : "1.35em", fontWeight: item.prep > 0 ? 500 : 700, whiteSpace: "pre-wrap", textAlign: item.prep > 0 ? "left" : "center", lineHeight: 1.6 }}>
                {item.q}
              </div>
              {phase === "ask" && <div style={{ color: "#1E40AF", fontWeight: 700 }}>🗣 {t("exm.examinerAsks")}</div>}
              {phase === "prep" && (
                <>
                  <div style={{ fontWeight: 800, color: "#B45309", fontSize: 18 }}>🧠 {t("pmk.prepTime")}: {count}s</div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("exm.notes")} rows={5} style={{ width: "100%", maxWidth: 520, border: `1px solid ${LINE}`, borderRadius: 4, padding: 10, fontFamily: "inherit" }} />
                  <button type="button" onClick={() => { stopTick(); void say("Please start speaking now.").then(record); }} style={smallBtn}>{t("pmk.startNow")}</button>
                </>
              )}
              {phase === "rec" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 800, color: "#B91C1C" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#DC2626", animation: "exmPulse 1s infinite" }} /> REC {count}s
                  </div>
                  <style>{`@keyframes exmPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
                  {live && <div style={{ fontStyle: "italic", color: "#374151" }}>{live}</div>}
                  <button type="button" onClick={() => { stopTick(); if (rec.current?.state === "recording") rec.current.stop(); }} style={{ background: INK, color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                    {t("exm.finishAnswer")} ▶
                  </button>
                </>
              )}
              {phase === "type" && (
                <>
                  <div style={{ fontSize: 13.5, color: "#92400E", background: "#FEF3C7", borderRadius: 6, padding: "6px 10px" }}>⌨️ {t("exm.typeAnswer")} · {count}s</div>
                  <textarea
                    autoFocus
                    value={typedText}
                    onChange={(e) => { typedRef.current = e.target.value; setTypedText(e.target.value); }}
                    placeholder={t("exm.typePh")}
                    rows={6}
                    style={{ width: "100%", maxWidth: 620, border: `1px solid #9CA3AF`, borderRadius: 4, padding: 10, fontFamily: "inherit", fontSize: "inherit", lineHeight: 1.6 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => void saveTyped()} style={{ background: INK, color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("exm.saveNext")} ▶</button>
                  </div>
                </>
              )}
              {phase === "save" && <div style={{ color: "#1E40AF", fontWeight: 700 }}>⏫ {t("pmk.uploading")}</div>}
              {error && <div role="alert" style={{ color: "#B91C1C" }}>{error}</div>}
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
