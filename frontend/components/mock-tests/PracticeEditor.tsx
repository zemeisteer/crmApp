"use client";

import { useState } from "react";
import { ApiError, mockTestsApi, type MockTest, type PracticeContent, type PracticeTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { ImageField, PartHeader, QuestionsEditor } from "@/components/mock-tests/MockTestEditor";
import { PrivateImg } from "@/components/PrivateFile";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };
const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6, display: "block" };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const MAX_SECTIONS = 6;

type Section = PracticeContent["sections"][number];
const emptySection = (n: number): Section => ({ title: `Section ${n}`, durationMin: 20, instruction: null, parts: [{ title: "Part 1", text: null, imagePath: null, questions: [] }], tasks: [] });

// Edits a practice test (any direction): sections with their own time,
// parts (optional text, code or picture + questions, AI can write them)
// and writing tasks the AI marks 0-10.
export default function PracticeEditor({ test, onSaved }: { test: PracticeTest; onSaved: (t: MockTest) => void }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(test.title);
  const [subject, setSubject] = useState(test.subject);
  const [content, setContent] = useState<PracticeContent>(test.content);
  const [si, setSi] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const edit = (fn: (c: PracticeContent) => void) => {
    setContent((c) => {
      const next = structuredClone(c);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const section = content.sections[si];

  async function save(status?: "DRAFT" | "PUBLISHED") {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await mockTestsApi.update(test.id, { title, subject, content, ...(status ? { status } : {}) });
      onSaved(saved);
      setContent((saved as unknown as PracticeTest).content);
      setDirty(false);
      setMsg({ ok: true, text: status === "PUBLISHED" ? t("mock.publishedMsg") : t("mock.saved") });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("common.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined, apply: (path: string) => void) {
    if (!file) return;
    setBusy(true);
    try {
      apply((await mockTestsApi.uploadAsset(test.id, file)).path);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("common.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <div>
            <span style={label}>{t("mock.testTitle")}</span>
            <input className="field-input" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          </div>
          <div>
            <span style={label}>{t("mock.direction")}</span>
            <input className="field-input" value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} placeholder="Matematika" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: test.status === "PUBLISHED" ? "#E9F8EF" : "#F2F1EC", color: test.status === "PUBLISHED" ? "#1FA463" : "#6B6E78" }}>
            {test.status === "PUBLISHED" ? t("mock.published") : t("mock.draft")}
          </span>
          {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "#1FA463" : "#B23A47" }}>{msg.text}</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button type="button" className="btn" disabled={busy || !dirty} onClick={() => save()} style={{ ...ghost, opacity: dirty ? 1 : 0.5 }}>💾 {t("common.save")}</button>
            {test.status === "PUBLISHED" ? (
              <button type="button" className="btn" disabled={busy} onClick={() => save("DRAFT")} style={ghost}>{t("mock.unpublish")}</button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => save("PUBLISHED")} style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }}>🚀 {t("mock.publish")}</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {content.sections.map((s, i) => {
          const n = s.parts.reduce((m, p) => m + p.questions.length, 0) + s.tasks.length;
          return (
            <button key={i} type="button" onClick={() => setSi(i)} style={{ border: `1.5px solid ${si === i ? ACCENT : "#EAE8E2"}`, background: si === i ? "#EEF0FF" : "#fff", color: si === i ? ACCENT : "#4A4E58", borderRadius: 11, padding: "9px 14px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {i + 1}. {s.title} <span style={{ color: "#686B75", fontWeight: 600 }}>{n}</span>
            </button>
          );
        })}
        {content.sections.length < MAX_SECTIONS && (
          <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT }} onClick={() => { edit((c) => { c.sections.push(emptySection(c.sections.length + 1)); }); setSi(content.sections.length); }}>
            + {t("pre.addSection")}
          </button>
        )}
      </div>

      {section && (
        <>
          <div style={{ ...card, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px" }}>
                <span style={label}>{t("pre.sectionTitle")}</span>
                <input className="field-input" value={section.title} onChange={(e) => edit((c) => { c.sections[si].title = e.target.value; })} style={{ fontWeight: 700 }} />
              </div>
              <div>
                <span style={label}>⏱ {t("mock.duration")} ({t("mock.minutes")})</span>
                <input type="number" min={1} max={180} className="field-input" style={{ width: 100 }} value={section.durationMin} onChange={(e) => edit((c) => { c.sections[si].durationMin = Number(e.target.value) || 0; })} />
              </div>
              {content.sections.length > 1 && (
                <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => { if (confirm(t("mock.removePartConfirm"))) { edit((c) => { c.sections.splice(si, 1); }); setSi(Math.max(0, si - 1)); } }}>🗑 {t("pre.removeSection")}</button>
              )}
            </div>
            <input className="field-input" placeholder={t("pre.instructionPh")} value={section.instruction ?? ""} onChange={(e) => edit((c) => { c.sections[si].instruction = e.target.value || null; })} />
          </div>

          {section.parts.map((p, pi) => (
            <div key={pi} style={{ ...card, display: "grid", gap: 10 }}>
              <PartHeader title={p.title} onTitle={(v) => edit((c) => { c.sections[si].parts[pi].title = v; })} onRemove={() => edit((c) => { c.sections[si].parts.splice(pi, 1); })} />
              <div>
                <span style={label}>{t("pre.partText")}</span>
                <textarea className="field-input" rows={4} value={p.text ?? ""} onChange={(e) => edit((c) => { c.sections[si].parts[pi].text = e.target.value || null; })} style={{ fontFamily: "inherit" }} />
              </div>
              <ImageField path={p.imagePath} onUpload={(f) => upload(f, (path) => edit((c) => { c.sections[si].parts[pi].imagePath = path; }))} onClear={() => edit((c) => { c.sections[si].parts[pi].imagePath = null; })} />
              <QuestionsEditor
                start={section.parts.slice(0, pi).reduce((n, x) => n + x.questions.length, 0)}
                questions={p.questions}
                onChange={(qs) => edit((c) => { c.sections[si].parts[pi].questions = qs; })}
              />
              <AiQuestions subject={subject} onAdd={(qs) => edit((c) => { c.sections[si].parts[pi].questions.push(...qs); })} />
            </div>
          ))}
          <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT, justifySelf: "start" }} onClick={() => edit((c) => { c.sections[si].parts.push({ title: `Part ${c.sections[si].parts.length + 1}`, text: null, imagePath: null, questions: [] }); })}>
            + {t("pre.addPart")}
          </button>

          <div style={{ ...card, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>✍️ {t("pre.tasks")}</div>
            {section.tasks.map((task, ti) => (
              <div key={ti} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
                <PartHeader title={task.title} onTitle={(v) => edit((c) => { c.sections[si].tasks[ti].title = v; })} onRemove={() => edit((c) => { c.sections[si].tasks.splice(ti, 1); })} />
                <textarea className="field-input" rows={4} value={task.prompt} onChange={(e) => edit((c) => { c.sections[si].tasks[ti].prompt = e.target.value; })} placeholder={t("mock.taskPh")} style={{ fontFamily: "inherit" }} />
                <input className="field-input" value={task.rubric ?? ""} onChange={(e) => edit((c) => { c.sections[si].tasks[ti].rubric = e.target.value || null; })} placeholder={t("pre.rubricPh")} />
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                  <span style={{ color: "#6B6E78" }}>{t("mock.minWords")}</span>
                  <input type="number" min={0} max={2000} className="field-input" style={{ width: 90 }} value={task.minWords} onChange={(e) => edit((c) => { c.sections[si].tasks[ti].minWords = Number(e.target.value) || 0; })} />
                  {task.imagePath ? (
                    <>
                      <PrivateImg name={task.imagePath} scope="staff" alt="" style={{ height: 60, borderRadius: 8, border: "1px solid #EAE8E2" }} />
                      <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => edit((c) => { c.sections[si].tasks[ti].imagePath = null; })}>✕</button>
                    </>
                  ) : (
                    <label style={{ ...ghost, display: "inline-flex", gap: 6 }}>
                      🖼 {t("mock.uploadImage")}
                      <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0], (path) => edit((c) => { c.sections[si].tasks[ti].imagePath = path; }))} />
                    </label>
                  )}
                </div>
              </div>
            ))}
            {section.tasks.length < 4 && (
              <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT, justifySelf: "start" }} onClick={() => edit((c) => { c.sections[si].tasks.push({ title: `Task ${c.sections[si].tasks.length + 1}`, prompt: "", minWords: 80, rubric: null, imagePath: null }); })}>
                + {t("pre.addTask")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The AI writes questions on a topic for this part; the teacher checks them.
function AiQuestions({ subject, onAdd }: { subject: string; onAdd: (qs: import("@/lib/tests").TestQuestion[]) => void }) {
  const { t } = useLanguage();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const qs = await mockTestsApi.generateQuestions({ subject, topic: topic.trim() || undefined, count });
      onAdd(qs);
      setNote({ ok: true, text: t("pre.aiAdded").replace("{n}", String(qs.length)) });
    } catch (e) {
      setNote({ ok: false, text: e instanceof ApiError ? e.message : t("common.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#FAFAFF", border: "1px dashed #C7D2FE", borderRadius: 12, padding: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>🤖 {t("pre.aiQuestions")}</span>
      <input className="field-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("pre.aiTopicPh")} style={{ flex: "1 1 200px" }} />
      <input type="number" min={1} max={30} className="field-input" value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} style={{ width: 70 }} aria-label="count" />
      <button type="button" className="btn" disabled={busy} onClick={run} style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }}>{busy ? "⏳" : "✨"} {t("pre.aiAdd")}</button>
      {note && <span style={{ fontSize: 12.5, fontWeight: 600, color: note.ok ? "#1FA463" : "#B23A47", width: "100%" }}>{note.text}</span>}
    </div>
  );
}
