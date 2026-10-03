"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QuestionInput from "@/components/tests/QuestionInput";
import ExamMode from "@/components/portal/ExamMode";
import FeedbackView, { bandColor } from "@/components/mock-tests/FeedbackView";
import { SECTION_ICON, sectionKey } from "@/components/mock-tests/sections";
import { ApiError, fileUrl, MOCK_SECTIONS, portalMockApi, type MockSection, type PortalMockAttempt } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { PORTAL_ACCENT as ACCENT, portalCard as card } from "@/components/portal/PortalTabs";

type Text = Record<string, string>;
const DURATION_SPEAKING_MIN = 15;

const wordsOf = (s: string) => (s.trim().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const CSS = `
.mkr-read{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
@media (min-width:960px){.mkr-read{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}.mkr-read .mkr-passage{position:sticky;top:12px;max-height:calc(100vh - 120px);overflow-y:auto}}
`;

// One sitting of a mock test: pick a section, its clock runs from the first
// start (server time), answers autosave, time up hands the section in.
export default function MockRunner({ initial, readOnly, onExit }: { initial: PortalMockAttempt; readOnly: boolean; onExit: () => void }) {
  const { t } = useLanguage();
  const [a, setA] = useState(initial);
  const [section, setSection] = useState<MockSection | null>(null);
  const [answers, setAnswers] = useState<Record<"listening" | "reading" | "writing", Text>>({
    listening: initial.answers.listening ?? {},
    reading: initial.answers.reading ?? {},
    writing: initial.answers.writing ?? {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Server clock minus ours, so a wrong phone clock cannot add time.
  const skew = useRef(0);
  // Server-adjusted "now", ticking every second.
  const [now, setNow] = useState(() => Date.now());
  const content = a.test.content;
  const done = (s: MockSection) => !!a.sectionDone[s];
  const started = (s: MockSection) => !!a.sectionStarted[s];

  const apply = useCallback((next: PortalMockAttempt) => {
    skew.current = Date.parse(next.serverNow) - Date.now();
    setA(next);
  }, []);

  useEffect(() => {
    skew.current = Date.parse(initial.serverNow) - Date.now();
    const id = setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => clearInterval(id);
  }, [initial.serverNow]);

  // Writing/Speaking marked in the background: check back until they land.
  const pending = MOCK_SECTIONS.some((s) => a.results[s]?.status === "PENDING");
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => { portalMockApi.get(a.id).then(apply).catch(() => undefined); }, 5000);
    return () => clearInterval(id);
  }, [pending, a.id, apply]);

  const minutes = (s: MockSection) => (s === "speaking" ? DURATION_SPEAKING_MIN : content[s].durationMin);
  const deadline = (s: MockSection) => (a.sectionStarted[s] ? Date.parse(a.sectionStarted[s]) + minutes(s) * 60_000 : null);
  const left = section && deadline(section) ? deadline(section)! - now : null;

  // Autosave 1.5 s after the last change; at once when the student leaves
  // the section or the page, so nothing typed is lost.
  const dirty = useRef<Set<MockSection>>(new Set());
  const latest = useRef(answers);
  useEffect(() => { latest.current = answers; }, [answers]);
  const flush = useCallback(async (keepalive = false) => {
    const list = [...dirty.current].filter((s) => s !== "speaking" && !a.sectionDone[s]);
    dirty.current.clear();
    if (list.length === 0) return;
    setSaved("saving");
    let ok = true;
    for (const s of list) {
      try {
        await portalMockApi.save(a.id, s, latest.current[s as "listening"], keepalive);
      } catch {
        ok = false;
        dirty.current.add(s);
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
    const onVis = () => { if (document.visibilityState === "hidden") void flush(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [readOnly, flush]);

  const setAnswer = (s: "listening" | "reading" | "writing", key: string, v: string) => {
    dirty.current.add(s);
    setAnswers((prev) => ({ ...prev, [s]: { ...prev[s], [key]: v } }));
  };

  // The clock starts when the student presses Start on the instructions.
  async function begin(s: MockSection) {
    setError(null);
    try {
      apply(await portalMockApi.startSection(a.id, s));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
      throw e;
    }
  }

  const submit = useCallback(async (s: MockSection, auto = false) => {
    if (!auto && !confirm(t("pmk.submitConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      dirty.current.delete(s);
      apply(await portalMockApi.submit(a.id, s, s === "speaking" ? undefined : answers[s as "listening"]));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }, [a.id, answers, apply, t]);

  const overall = a.results.overall;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={() => (section ? setSection(null) : onExit())} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 14 }}>
          ← {section ? t("pmk.allSections") : t("pmk.back")}
        </button>
        <div style={{ fontWeight: 800, fontSize: 16, flex: 1, minWidth: 160 }}>{a.test.title}</div>
        {section && !done(section) && left !== null && (
          <div style={{ fontFamily: "'Manrope', monospace", fontWeight: 800, fontSize: 18, padding: "6px 12px", borderRadius: 10, background: left < 5 * 60_000 ? "#FEE2E2" : "#EEF0FF", color: left < 5 * 60_000 ? "#B91C1C" : ACCENT }}>
            ⏱ {mmss(left)}
          </div>
        )}
        {section && !done(section) && section !== "speaking" && <span style={{ fontSize: 12, color: saved === "error" ? "#B23A47" : "#8A8D96" }}>{saved === "saving" ? t("pmk.saving") : saved === "saved" ? `✓ ${t("pmk.saved")}` : saved === "error" ? `⚠ ${t("exm.saveError")}` : ""}</span>}
      </div>
      {error && <div role="alert" style={{ ...card, color: "#B23A47", fontSize: 13 }}>{error}</div>}

      {!section && (
        <>
          {overall != null && (
            <div style={{ ...card, display: "flex", alignItems: "center", gap: 16, background: "linear-gradient(135deg, #EEF0FF, #fff)" }}>
              <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: "#fff", border: `4px solid ${bandColor(overall)}`, fontSize: 26, fontWeight: 800, color: bandColor(overall) }}>{overall}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{t("pmk.overallBand")}</div>
                <div style={{ fontSize: 13, color: "#6B6E78" }}>{t("pmk.overallHint")}</div>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            {MOCK_SECTIONS.map((s) => {
              const r = a.results[s];
              const count = s === "listening" ? content.listening.parts.reduce((n, p) => n + p.questions.length, 0)
                : s === "reading" ? content.reading.passages.reduce((n, p) => n + p.questions.length, 0)
                : s === "writing" ? content.writing.tasks.length : content.speaking.parts.reduce((n, p) => n + p.questions.length, 0);
              if (count === 0) return null;
              return (
                <div key={s} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{SECTION_ICON[s]} {t(sectionKey(s))}</div>
                    {done(s) && <span style={{ fontSize: 20, fontWeight: 800, color: bandColor(r?.band) }}>{r?.band ?? (r?.status === "PENDING" ? "⏳" : "✓")}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#6B6E78" }}>
                    {count} {s === "writing" ? t("pmk.tasks") : t("pmk.questions")} · ⏱ {minutes(s)} {t("pmk.min")}
                  </div>
                  {done(s) ? (
                    <div style={{ fontSize: 12.5, color: r?.status === "REVIEW" ? "#B45309" : r?.status === "PENDING" ? ACCENT : "#1FA463", fontWeight: 700 }}>
                      {r?.status === "PENDING" ? t("pmk.aiMarking") : r?.status === "REVIEW" ? t("pmk.teacherMarks") : r?.raw !== undefined ? `${r.raw}/${r.max} ${t("pmk.correct")}` : t("pmk.marked")}
                    </div>
                  ) : null}
                  <button type="button" disabled={busy || (readOnly && !done(s) && !started(s))} onClick={() => setSection(s)}
                    style={{ marginTop: "auto", background: done(s) ? "#fff" : ACCENT, color: done(s) ? "#181A1F" : "#fff", border: done(s) ? "1px solid #EAE8E2" : "none", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                    {done(s) ? `📊 ${t("pmk.review")}` : started(s) ? `▶ ${t("pmk.continue")}` : `▶ ${t("pmk.startSection")}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, color: "#8A8D96", lineHeight: 1.5 }}>ℹ️ {t("pmk.rules")}</div>
        </>
      )}

      {section && !done(section) && !readOnly && (
        <ExamMode
          attempt={a}
          section={section}
          answers={section === "speaking" ? {} : answers[section]}
          onAnswer={(k, v) => section !== "speaking" && setAnswer(section, k, v)}
          onBegin={() => (started(section) ? Promise.resolve() : begin(section))}
          onSubmit={(auto) => submit(section, true).then(() => { if (!auto) setSection(null); })}
          left={left}
          now={now}
          saveState={saved}
          onExit={() => { void flush(); setSection(null); }}
          onSpeakingSaved={() => portalMockApi.get(a.id).then(apply).catch(() => undefined)}
        />
      )}

      {section === "listening" && (done("listening") || readOnly) && (
        <ObjectiveSection a={a} section="listening" answers={answers.listening} onAnswer={(k, v) => setAnswer("listening", k, v)} readOnly={readOnly || done("listening")}>
          {(pi) => <ListeningPlayer part={content.listening.parts[pi]} />}
        </ObjectiveSection>
      )}
      {section === "reading" && (done("reading") || readOnly) && <ObjectiveSection a={a} section="reading" answers={answers.reading} onAnswer={(k, v) => setAnswer("reading", k, v)} readOnly={readOnly || done("reading")} />}
      {section === "writing" && (done("writing") || readOnly) && <WritingSection a={a} answers={answers.writing} onAnswer={(k, v) => setAnswer("writing", k, v)} readOnly={readOnly || done("writing")} />}
      {section === "speaking" && (done("speaking") || readOnly) && <SpeakingSection a={a} readOnly={readOnly || done("speaking")} onSaved={() => portalMockApi.get(a.id).then(apply).catch(() => undefined)} />}

    </div>
  );
}

// ------------------------------------------------------------ Listening

function ListeningPlayer({ part }: { part: PortalMockAttempt["test"]["content"]["listening"]["parts"][number] }) {
  const { t } = useLanguage();
  const [plays, setPlays] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  if (part.audioPath) return <audio controls controlsList="nodownload" src={fileUrl(part.audioPath) ?? undefined} style={{ width: "100%" }} />;
  if (!part.tts) return null;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  function play() {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(part.tts!);
    u.lang = "en-GB";
    u.rate = 0.95;
    const voice = synth.getVoices().find((v) => v.lang.startsWith("en-GB")) ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
    if (voice) u.voice = voice;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    setPlays((n) => n + 1);
    synth.speak(u);
  }
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" disabled={!canSpeak || speaking || plays >= 2} onClick={play} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", opacity: plays >= 2 ? 0.5 : 1 }}>
        {speaking ? `🔊 ${t("pmk.playing")}` : `▶ ${t("pmk.play")}`}
      </button>
      {speaking && <button type="button" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>■</button>}
      <span style={{ fontSize: 12, color: "#8A8D96" }}>{canSpeak ? t("pmk.playsLeft").replace("{n}", String(Math.max(0, 2 - plays))) : t("pmk.noTts")}</span>
    </div>
  );
}

// ------------------------------------------------- Listening & Reading

function ObjectiveSection({ a, section, answers, onAnswer, readOnly, children }: {
  a: PortalMockAttempt;
  section: "listening" | "reading";
  answers: Text;
  onAnswer: (key: string, v: string) => void;
  readOnly: boolean;
  children?: (partIndex: number) => React.ReactNode;
}) {
  const { t } = useLanguage();
  const r = a.results[section];
  const keys = a.keys[section];
  const groups = section === "listening"
    ? a.test.content.listening.parts.map((p) => ({ title: p.title, instruction: p.instruction, text: null as string | null, questions: p.questions }))
    : a.test.content.reading.passages.map((p) => ({ title: p.title, instruction: null as string | null, text: p.text, questions: p.questions }));

  const questionList = (qs: typeof groups[number]["questions"]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {qs.map((q) => {
        const mark = r?.marks?.[Number(q.id)];
        return (
          <div key={q.id} style={{ ...card, padding: 12, borderColor: mark === true ? "#BBF7D0" : mark === false ? "#FECACA" : "#EAE8E2" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
              <span style={{ minWidth: 26, height: 26, padding: "0 4px", borderRadius: 8, background: "#EEF0FF", color: ACCENT, fontWeight: 800, fontSize: 12.5, display: "grid", placeItems: "center" }}>{q.span > 1 ? `${q.no}–${q.no + q.span - 1}` : q.no}</span>
              <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", flex: 1 }}>{q.prompt}</div>
              {mark !== undefined && <span style={{ fontSize: 16 }}>{mark ? "✅" : "❌"}</span>}
            </div>
            <QuestionInput q={q} value={answers[q.id] ?? ""} onChange={(v) => onAnswer(q.id, v)} disabled={readOnly} exam />
            {keys && mark === false && !(answers[q.id] ?? "").trim() && <div style={{ marginTop: 8, fontSize: 12.5, color: "#B45309", fontWeight: 700 }}>— {t("exm.noAnswer")}</div>}
            {keys && mark === false && <div style={{ marginTop: 6, fontSize: 12.5, color: "#1FA463", fontWeight: 700 }}>✓ {t("pmk.answer")}: {keys[Number(q.id)]}</div>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {r && (
        <div style={{ ...card, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#8A8D96", letterSpacing: "0.06em" }}>BAND</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: bandColor(r.band), lineHeight: 1.1 }}>{r.band}</div>
          </div>
          <div style={{ fontSize: 13.5 }}><b>{r.raw}/{r.max}</b> {t("pmk.correct")}{r.late ? ` · ${t("pmk.late")}` : ""}</div>
        </div>
      )}
      {groups.map((g, gi) => (
        <section key={gi} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{g.title}</div>
          {g.instruction && <div style={{ fontSize: 13, color: "#4A4E58", fontStyle: "italic" }}>{g.instruction}</div>}
          {children?.(gi)}
          {g.text ? (
            <div className="mkr-read">
              <div className="mkr-passage" style={{ ...card, fontSize: 14.5, lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "Georgia, 'Times New Roman', serif" }}>{g.text}</div>
              {questionList(g.questions)}
            </div>
          ) : questionList(g.questions)}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Writing

function WritingSection({ a, answers, onAnswer, readOnly }: { a: PortalMockAttempt; answers: Text; onAnswer: (key: string, v: string) => void; readOnly: boolean }) {
  const { t } = useLanguage();
  const r = a.results.writing;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {r && <ResultBanner band={r.band} status={r.status} comment={r.teacherComment} />}
      {a.test.content.writing.tasks.map((task, i) => {
        const text = answers[String(i)] ?? "";
        const words = wordsOf(text);
        const tr = r?.tasks?.[i];
        return (
          <section key={i} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{task.title}</div>
              {tr?.band != null && <b style={{ color: bandColor(tr.band), fontSize: 18 }}>{tr.band}</b>}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#F7F7F5", borderRadius: 12, padding: 12 }}>{task.prompt}</div>
            {task.imagePath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(task.imagePath) ?? ""} alt="" style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 12, border: "1px solid #EAE8E2" }} />
            )}
            <textarea
              value={text}
              readOnly={readOnly}
              onChange={(e) => onAnswer(String(i), e.target.value)}
              rows={readOnly ? 8 : 14}
              spellCheck={false}
              placeholder={t("pmk.writeHere")}
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #D9D6CE", padding: 14, fontSize: 15, lineHeight: 1.7, fontFamily: "inherit", resize: "vertical", background: readOnly ? "#FAFAF8" : "#fff" }}
            />
            <div style={{ fontSize: 12.5, fontWeight: 700, color: words >= task.minWords ? "#1FA463" : "#B45309" }}>
              {words} / {task.minWords}+ {t("mock.words")}
            </div>
            {tr?.feedback && <FeedbackView fb={tr.feedback} />}
          </section>
        );
      })}
    </div>
  );
}

function ResultBanner({ band, status, comment }: { band: number | null; status: string; comment?: string | null }) {
  const { t } = useLanguage();
  return (
    <div style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ fontSize: 30, fontWeight: 800, color: bandColor(band) }}>{band ?? (status === "PENDING" ? "⏳" : "—")}</div>
      <div style={{ fontSize: 13.5, color: "#4A4E58", flex: 1, minWidth: 200 }}>
        {status === "PENDING" ? t("pmk.aiMarking") : status === "REVIEW" ? t("pmk.teacherMarks") : t("pmk.marked")}
        {comment && <div style={{ marginTop: 6, color: "#14532D", background: "#ECFDF5", borderRadius: 10, padding: "8px 10px" }}>💬 {comment}</div>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Speaking

type SpeechRec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null };

function SpeakingSection({ a, readOnly, onSaved }: { a: PortalMockAttempt; readOnly: boolean; onSaved: () => void }) {
  const { t } = useLanguage();
  const r = a.results.speaking;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {r && <ResultBanner band={r.band} status={r.status} comment={r.teacherComment} />}
      {/* An AI Speaking band comes from the transcript alone: say so. */}
      {r?.gradedBy === "AI" && <div style={{ fontSize: 12.5, color: "#6B6E78", background: "#F7F7F5", border: "1px solid #EAE8E2", borderRadius: 10, padding: "9px 12px" }}>ℹ️ {t("mock.speakingTranscriptOnly")}</div>}
      {r?.feedback && <div style={card}><FeedbackView fb={r.feedback} /></div>}
      {!readOnly && <div style={{ fontSize: 12.5, color: "#6B6E78" }}>🎙 {t("pmk.micHint")}</div>}
      {a.test.content.speaking.parts.map((p, pi) => (
        <section key={pi} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{p.title}</div>
          {p.instruction && <div style={{ fontSize: 13, color: "#4A4E58", fontStyle: "italic" }}>{p.instruction}</div>}
          {p.questions.map((q, qi) => (
            <SpeakingQuestion key={qi} attemptId={a.id} k={`${pi}.${qi}`} question={q} prep={p.prepSeconds} limit={p.answerSeconds} saved={a.answers.speaking?.[`${pi}.${qi}`]} readOnly={readOnly} onSaved={onSaved} />
          ))}
        </section>
      ))}
    </div>
  );
}

function SpeakingQuestion({ attemptId, k, question, prep, limit, saved, readOnly, onSaved }: {
  attemptId: string; k: string; question: string; prep: number; limit: number;
  saved?: { audio: string | null; transcript: string; seconds: number | null };
  readOnly: boolean; onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<"idle" | "prep" | "rec" | "upload">("idle");
  const [count, setCount] = useState(0);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recog = useRef<SpeechRec | null>(null);
  const finalText = useRef("");
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => () => {
    stopTimer();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recog.current?.stop();
  }, []);

  const recognitionCtor = useMemo(() => {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }, []);

  function countdown(seconds: number, then: () => void) {
    stopTimer();
    setCount(seconds);
    const end = Date.now() + seconds * 1000;
    timer.current = setInterval(() => {
      const left = Math.ceil((end - Date.now()) / 1000);
      setCount(left);
      if (left <= 0) { stopTimer(); then(); }
    }, 250);
  }

  async function record() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("pmk.noMic"));
      setPhase("idle");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      recog.current?.stop();
      setPhase("upload");
      const seconds = (Date.now() - startedAt.current) / 1000;
      // Give the recogniser a moment to deliver its last words.
      await new Promise((res) => setTimeout(res, 600));
      try {
        await portalMockApi.speaking(attemptId, k, { audio: new Blob(chunks, { type: rec.mimeType || "audio/webm" }), transcript: finalText.current.trim(), seconds });
        onSaved();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
      } finally {
        setPhase("idle");
      }
    };
    finalText.current = "";
    setLive("");
    if (recognitionCtor) {
      try {
        const sr = new recognitionCtor();
        sr.lang = "en-GB";
        sr.continuous = true;
        sr.interimResults = true;
        sr.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) finalText.current += `${res[0].transcript} `;
            else interim += res[0].transcript;
          }
          setLive(`${finalText.current}${interim}`);
        };
        sr.onerror = () => undefined;
        sr.start();
        recog.current = sr;
      } catch {
        recog.current = null;
      }
    }
    startedAt.current = Date.now();
    rec.start();
    setPhase("rec");
    countdown(limit, () => rec.state === "recording" && rec.stop());
  }

  function begin() {
    if (prep > 0) {
      setPhase("prep");
      countdown(prep, () => void record());
    } else {
      void record();
    }
  }

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderColor: phase === "rec" ? "#FCA5A5" : saved ? "#BBF7D0" : "#EAE8E2" }}>
      <div style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>❓ {question}</div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {phase === "idle" && (
            <button type="button" onClick={begin} style={{ background: saved ? "#fff" : "#DC2626", color: saved ? "#DC2626" : "#fff", border: "1.5px solid #DC2626", borderRadius: 100, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>
              ● {saved ? t("pmk.reRecord") : prep > 0 ? t("pmk.prepare") : t("pmk.record")}
            </button>
          )}
          {phase === "prep" && (
            <>
              <span style={{ fontWeight: 800, color: "#B45309" }}>🧠 {t("pmk.prepTime")}: {count}s</span>
              <button type="button" onClick={() => { stopTimer(); void record(); }} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 100, padding: "8px 14px", cursor: "pointer", fontWeight: 700 }}>{t("pmk.startNow")}</button>
            </>
          )}
          {phase === "rec" && (
            <>
              <span style={{ fontWeight: 800, color: "#DC2626" }}>● REC {count}s</span>
              <button type="button" onClick={() => { stopTimer(); recorder.current?.stop(); }} style={{ background: "#181A1F", color: "#fff", border: "none", borderRadius: 100, padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>■ {t("pmk.stop")}</button>
            </>
          )}
          {phase === "upload" && <span style={{ color: ACCENT, fontWeight: 700 }}>⏫ {t("pmk.uploading")}</span>}
        </div>
      )}
      {phase === "rec" && live && <div style={{ fontSize: 13, color: "#4A4E58", fontStyle: "italic" }}>{live}</div>}
      {saved && phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {saved.audio && <audio controls src={fileUrl(saved.audio) ?? undefined} style={{ width: "100%", height: 36 }} />}
          <div style={{ fontSize: 12.5, color: "#6B6E78" }}>
            ✓ {t("pmk.recorded")}{saved.seconds ? ` · ${saved.seconds}s` : ""}{saved.transcript ? ` · “${saved.transcript}”` : ""}
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "#B23A47" }}>{error}</div>}
    </div>
  );
}
