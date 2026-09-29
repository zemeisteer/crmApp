"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fileUrl, type MockPublicQuestion, type PortalPracticeAttempt, type PortalPracticeSection } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { BLUE, confirmSubmit, EXAM_CSS, ExamHeader, INK, LINE, NavBar, PaneTabs, Passage, QuestionBlock, useFlags, useFullscreen, wordsOf } from "@/components/portal/ExamMode";

type Text = Record<string, string>;

// One timed section of a practice test (any direction) on the same exam
// screen as the IELTS mock: instructions, then parts with the text beside
// the questions, writing tasks with a word count, the question palette,
// flags for review, autosave and a hand-in when the time is up.
export default function PracticeExam({ attempt, section, answers, onAnswer, onBegin, onSubmit, left, onExit, saveState }: {
  attempt: PortalPracticeAttempt;
  section: PortalPracticeSection;
  answers: Text;
  onAnswer: (key: string, value: string) => void;
  onBegin: () => Promise<void>;
  onSubmit: (auto: boolean) => void;
  left: number | null;
  onExit: () => void;
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  const [started, setStarted] = useState(false);
  const [font, setFont] = useState(16);
  const fs = useFullscreen();

  const sent = useRef(false);
  useEffect(() => {
    if (!started || sent.current || left === null || left > 0) return;
    sent.current = true;
    onSubmit(true);
  }, [left, started, onSubmit]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function start() {
    fs.enter();
    onBegin().then(() => setStarted(true)).catch(() => undefined);
  }

  const resuming = !!attempt.sectionStarted[section.key] && (left ?? 1) < section.durationMin * 60_000 - 5000;
  return (
    <div className="exm-root" style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: font }}>
      <style>{EXAM_CSS}</style>
      <ExamHeader
        brand={attempt.test.subject}
        title={<>{attempt.test.title} · <b>{section.title}</b></>}
        left={started ? left : null}
        saveState={started ? saveState : undefined}
        onFont={(d) => setFont((f) => Math.max(13, Math.min(22, f + d)))}
        full={fs.full}
        onToggleFull={fs.toggle}
        onExit={onExit}
      />
      {!started ? (
        <Instructions section={section} resuming={resuming} onStart={start} />
      ) : (
        <Body attempt={attempt} section={section} answers={answers} onAnswer={onAnswer} onSubmit={() => onSubmit(false)} />
      )}
    </div>
  );
}

function Instructions({ section, resuming, onStart }: { section: PortalPracticeSection; resuming: boolean; onStart: () => void }) {
  const { t } = useLanguage();
  const questions = section.parts.reduce((n, p) => n + p.questions.reduce((m, q) => m + q.span, 0), 0);
  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ maxWidth: 680, width: "100%", border: `1px solid ${LINE}`, borderRadius: 8, padding: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{section.title}</div>
        <div style={{ color: "#4B5563", marginBottom: 18 }}>{t("exm.time")}: {section.durationMin} {t("exm.minutes")}</div>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{t("exm.instructions")}</div>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          {section.instruction && <li style={{ whiteSpace: "pre-wrap" }}>{section.instruction}</li>}
          <li>{t("prx.i1").replace("{q}", String(questions)).replace("{t}", String(section.tasks.length)).replace("{m}", String(section.durationMin))}</li>
          <li>{t("prx.i2")}</li>
          <li>{t("prx.i3")}</li>
        </ul>
        {resuming && <div style={{ marginTop: 16, padding: 12, background: "#FEF3C7", borderRadius: 6, fontSize: 14 }}>⚠️ {t("exm.resume")}</div>}
        <button type="button" onClick={onStart} style={{ marginTop: 24, background: BLUE, color: "#fff", border: "none", borderRadius: 6, padding: "12px 26px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
          {resuming ? t("exm.continue") : t("exm.start")} ▶
        </button>
      </div>
    </div>
  );
}

function Body({ attempt, section, answers, onAnswer, onSubmit }: {
  attempt: PortalPracticeAttempt;
  section: PortalPracticeSection;
  answers: Text;
  onAnswer: (key: string, value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useLanguage();
  const { flags, toggle } = useFlags();
  // English tests keep the paper's words (TRUE / NOT GIVEN); others use the
  // interface language.
  const english = /ingliz|english|ielts|sat|англ/i.test(attempt.test.subject);
  const [group, setGroup] = useState(0);
  const [pane, setPane] = useState<"text" | "q">("text");

  // The palette's groups: each part, then the writing tasks (as "W1"...).
  const lastNo = section.parts.flatMap((p) => p.questions).reduce((n, q) => Math.max(n, q.no + q.span - 1), 0);
  const taskItems = useMemo<MockPublicQuestion[]>(
    () => section.tasks.map((task, i) => ({ id: `t${i}`, no: lastNo + i + 1, span: 1, type: "ESSAY", prompt: task.prompt })),
    [section.tasks, lastNo],
  );
  const groups = [
    ...section.parts.map((p, i) => ({ label: p.title || `Part ${i + 1}`, questions: p.questions })),
    ...(section.tasks.length ? [{ label: t("prx.writing"), questions: taskItems }] : []),
  ];
  const all = groups.flatMap((g) => g.questions);
  const isTasks = section.tasks.length > 0 && group === section.parts.length;
  const part = isTasks ? null : section.parts[group];
  const split = !!part && !!(part.text || part.imagePath);

  const questions = part && (
    <div style={{ maxWidth: split ? undefined : 860, margin: split ? undefined : "0 auto" }}>
      {part.questions.map((q, i, list) => (
        <QuestionBlock key={q.id} q={q} prev={list[i - 1]} value={answers[q.id] ?? ""} onAnswer={(v) => onAnswer(q.id, v)} flagged={flags.has(q.id)} onFlag={() => toggle(q.id)} sectionKey={section.key} examWording={english} />
      ))}
    </div>
  );

  return (
    <>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#EFF6FF", fontSize: 14 }}>
        <b>{groups[group]?.label}</b>
        {part?.questions.length ? ` — ${t("exm.questions")} ${part.questions[0].no}–${part.questions.at(-1)!.no + part.questions.at(-1)!.span - 1}` : ""}
      </div>
      {split && <PaneTabs pane={pane} onPane={setPane} textLabel={`📄 ${t("exm.paneText")}`} qLabel={`✏️ ${t("exm.paneQuestions")}`} />}
      {split ? (
        <div className="exm-split" data-pane={pane}>
          <Passage key={group} title={part!.title} text={part!.text ?? ""} imagePath={part!.imagePath} />
          <main className="exm-q" style={{ overflowY: "auto", padding: "8px 20px 40px", borderLeft: `1px solid ${LINE}` }}>{questions}</main>
        </div>
      ) : (
        <main style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px 40px" }}>
          {part ? questions : (
            <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
              {section.tasks.map((task, i) => {
                const text = answers[`t${i}`] ?? "";
                const words = wordsOf(text);
                return (
                  <section key={i} id={`q-${section.key}-t${i}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontWeight: 800 }}>{task.title}</div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{task.prompt}</div>
                    {task.imagePath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(task.imagePath) ?? ""} alt="" style={{ maxWidth: "100%", border: `1px solid ${LINE}` }} />
                    )}
                    <textarea value={text} onChange={(e) => onAnswer(`t${i}`, e.target.value)} spellCheck={false} rows={12}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #9CA3AF", borderRadius: 4, padding: 12, fontSize: "inherit", fontFamily: "inherit", lineHeight: 1.7, resize: "vertical" }} />
                    <div style={{ fontSize: 14, fontWeight: 700, color: task.minWords && words < task.minWords ? "#B45309" : "#15803D" }}>
                      {t("exm.wordCount")}: {words}{task.minWords ? ` / ${task.minWords}+` : ""}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </main>
      )}
      <NavBar groups={groups} current={group} onPart={(i) => { setGroup(i); setPane("text"); }} onJump={() => setPane("q")} answers={answers} flags={flags} sectionKey={section.key}
        submitLabel={t("exm.submit")} onSubmit={() => { if (confirmSubmit(t, all, answers)) onSubmit(); }} />
    </>
  );
}
