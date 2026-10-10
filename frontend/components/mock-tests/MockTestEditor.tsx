"use client";

import { useState } from "react";
import QuestionEditor, { emptyQuestion } from "@/components/tests/QuestionEditor";
import Select from "@/components/Select";
import DirectionSelect from "@/components/DirectionSelect";
import { ApiError, MOCK_LEVELS, mockTestsApi, type MockContent, type MockLevel, type MockSection, type MockTest } from "@/lib/api";
import { hasAnswer, type TestQuestion } from "@/lib/tests";
import { useLanguage } from "@/lib/i18n-context";
import { SECTION_ICON, sectionKey } from "@/components/mock-tests/sections";
import { levelKey } from "@/components/mock-tests/levels";
import { PrivateImg, PrivateAudio } from "@/components/PrivateFile";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };
const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6, display: "block" };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

// Edits one mock test: title, direction, publish state and the four sections.
export default function MockTestEditor({ test, onSaved }: { test: MockTest; onSaved: (t: MockTest) => void }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(test.title);
  const [subject, setSubject] = useState(test.subject);
  const [level, setLevel] = useState<MockLevel | null>(test.level);
  const [module, setModule] = useState(test.module);
  const [content, setContent] = useState<MockContent>(test.content);
  const [section, setSection] = useState<MockSection>("listening");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const edit = (fn: (c: MockContent) => MockContent) => {
    setContent((c) => fn(structuredClone(c)));
    setDirty(true);
  };

  async function save(status?: "DRAFT" | "PUBLISHED") {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await mockTestsApi.update(test.id, { title, subject, level, module, content, ...(status ? { status } : {}) });
      onSaved(saved);
      setContent(saved.content);
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
      const res = await mockTestsApi.uploadAsset(test.id, file);
      apply(res.path);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("common.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  const counts: Record<MockSection, number> = {
    listening: content.listening.parts.reduce((s, p) => s + p.questions.length, 0),
    reading: content.reading.passages.reduce((s, p) => s + p.questions.length, 0),
    writing: content.writing.tasks.length,
    speaking: content.speaking.parts.reduce((s, p) => s + p.questions.length, 0),
  };

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
            <DirectionSelect value={subject} onChange={(v) => { setSubject(v); setDirty(true); }} ariaLabel={t("mock.direction")} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <span style={label}>{t("mock.level")}</span>
            <Select
              value={level ?? ""}
              onChange={(v) => { setLevel((v || null) as MockLevel | null); setDirty(true); }}
              options={[{ value: "", label: t("mock.levelAll") }, ...MOCK_LEVELS.map((l) => ({ value: l, label: t(levelKey(l)) }))]}
              sheetOnPhone
            />
          </div>
          <div>
            <span style={label}>{t("mock.module")}</span>
            <Select
              value={module}
              onChange={(v) => { setModule(v as "ACADEMIC" | "GENERAL"); setDirty(true); }}
              options={[{ value: "ACADEMIC", label: "Academic" }, { value: "GENERAL", label: "General Training" }]}
              sheetOnPhone
            />
          </div>
          {test.source && (
            <div>
              <span style={label}>{t("mock.source")}</span>
              <div style={{ fontSize: 13.5, padding: "10px 0", color: "#4A4E58" }}>📚 {test.source}</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: test.status === "PUBLISHED" ? "#E9F8EF" : "#F2F1EC", color: test.status === "PUBLISHED" ? "#16794A" : "#6B6E78" }}>
            {test.status === "PUBLISHED" ? t("mock.published") : t("mock.draft")}
          </span>
          {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "#16794A" : "#B23A47" }}>{msg.text}</span>}
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
        {(Object.keys(SECTION_ICON) as MockSection[]).map((s) => (
          <button key={s} type="button" onClick={() => setSection(s)} style={{ border: `1.5px solid ${section === s ? ACCENT : "#EAE8E2"}`, background: section === s ? "#EEF0FF" : "#fff", color: section === s ? ACCENT : "#4A4E58", borderRadius: 11, padding: "9px 14px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            {SECTION_ICON[s]} {t(sectionKey(s))} <span style={{ color: "#686B75", fontWeight: 600 }}>{counts[s]}</span>
          </button>
        ))}
      </div>

      {section !== "speaking" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: "#6B6E78" }}>⏱ {t("mock.duration")}</span>
          <input type="number" min={5} max={120} className="field-input" style={{ width: 90 }} value={content[section].durationMin}
            onChange={(e) => edit((c) => { c[section].durationMin = Number(e.target.value) || 0; return c; })} />
          <span style={{ color: "#6B6E78" }}>{t("mock.minutes")}</span>
        </div>
      )}

      {section === "listening" && (
        <>
          <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>🎧 {t("mock.sectionAudio")}</span>
            {content.listening.audioPath ? (
              <>
                <PrivateAudio controls name={content.listening.audioPath} scope="staff" style={{ height: 36 }} />
                <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => edit((c) => { c.listening.audioPath = null; return c; })}>✕</button>
              </>
            ) : (
              <label style={{ ...ghost, display: "inline-flex", gap: 6 }}>
                🎵 {t("mock.uploadAudio")}
                <input type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files?.[0], (path) => edit((c) => { c.listening.audioPath = path; return c; }))} />
              </label>
            )}
            <span style={{ fontSize: 12, color: "#686B75" }}>{t("mock.sectionAudioHint")}</span>
          </div>
          {content.listening.parts.map((p, pi) => (
            <div key={pi} style={{ ...card, display: "grid", gap: 10 }}>
              <PartHeader title={p.title} onTitle={(v) => edit((c) => { c.listening.parts[pi].title = v; return c; })} onRemove={() => edit((c) => { c.listening.parts.splice(pi, 1); return c; })} />
              <input className="field-input" placeholder={t("mock.instructionPh")} value={p.instruction ?? ""} onChange={(e) => edit((c) => { c.listening.parts[pi].instruction = e.target.value; return c; })} />
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {p.audioPath ? (
                  <>
                    <PrivateAudio controls name={p.audioPath} scope="staff" style={{ height: 36 }} />
                    <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => edit((c) => { c.listening.parts[pi].audioPath = null; return c; })}>✕ {t("mock.removeAudio")}</button>
                  </>
                ) : (
                  <label style={{ ...ghost, display: "inline-flex", gap: 6 }}>
                    🎵 {t("mock.uploadAudio")}
                    <input type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files?.[0], (path) => edit((c) => { c.listening.parts[pi].audioPath = path; return c; }))} />
                  </label>
                )}
              </div>
              <ImageField path={p.imagePath} onUpload={(f) => upload(f, (path) => edit((c) => { c.listening.parts[pi].imagePath = path; return c; }))} onClear={() => edit((c) => { c.listening.parts[pi].imagePath = null; return c; })} />
              <div>
                <span style={label}>{t("mock.transcript")}</span>
                <textarea className="field-input" rows={4} value={p.transcript ?? ""} onChange={(e) => edit((c) => { c.listening.parts[pi].transcript = e.target.value; return c; })} placeholder={t("mock.transcriptPh")} />
              </div>
              <QuestionsEditor start={content.listening.parts.slice(0, pi).reduce((n, x) => n + x.questions.length, 0)} questions={p.questions} onChange={(qs) => edit((c) => { c.listening.parts[pi].questions = qs; return c; })} />
            </div>
          ))}
          {content.listening.parts.length < 4 && (
            <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT }} onClick={() => edit((c) => { c.listening.parts.push({ title: `Part ${c.listening.parts.length + 1}`, instruction: null, audioPath: null, transcript: null, imagePath: null, questions: [] }); return c; })}>
              + {t("mock.addPart")}
            </button>
          )}
        </>
      )}

      {section === "reading" && (
        <>
          {content.reading.passages.map((p, pi) => (
            <div key={pi} style={{ ...card, display: "grid", gap: 10 }}>
              <PartHeader title={p.title} onTitle={(v) => edit((c) => { c.reading.passages[pi].title = v; return c; })} onRemove={() => edit((c) => { c.reading.passages.splice(pi, 1); return c; })} />
              <ImageField path={p.imagePath} onUpload={(f) => upload(f, (path) => edit((c) => { c.reading.passages[pi].imagePath = path; return c; }))} onClear={() => edit((c) => { c.reading.passages[pi].imagePath = null; return c; })} />
              <textarea className="field-input" rows={10} value={p.text} onChange={(e) => edit((c) => { c.reading.passages[pi].text = e.target.value; return c; })} placeholder={t("mock.passagePh")} />
              <QuestionsEditor start={content.reading.passages.slice(0, pi).reduce((n, x) => n + x.questions.length, 0)} questions={p.questions} onChange={(qs) => edit((c) => { c.reading.passages[pi].questions = qs; return c; })} />
            </div>
          ))}
          {content.reading.passages.length < 3 && (
            <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT }} onClick={() => edit((c) => { c.reading.passages.push({ title: `Passage ${c.reading.passages.length + 1}`, text: "", imagePath: null, questions: [] }); return c; })}>
              + {t("mock.addPassage")}
            </button>
          )}
        </>
      )}

      {section === "writing" && (
        <>
          {content.writing.tasks.map((task, ti) => (
            <div key={ti} style={{ ...card, display: "grid", gap: 10 }}>
              <PartHeader title={task.title} onTitle={(v) => edit((c) => { c.writing.tasks[ti].title = v; return c; })} onRemove={() => edit((c) => { c.writing.tasks.splice(ti, 1); return c; })} />
              <textarea className="field-input" rows={6} value={task.prompt} onChange={(e) => edit((c) => { c.writing.tasks[ti].prompt = e.target.value; return c; })} placeholder={t("mock.taskPh")} />
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <span style={{ color: "#6B6E78" }}>{t("mock.minWords")}</span>
                <input type="number" min={20} max={1000} className="field-input" style={{ width: 90 }} value={task.minWords} onChange={(e) => edit((c) => { c.writing.tasks[ti].minWords = Number(e.target.value) || 0; return c; })} />
                {task.imagePath ? (
                  <>
                    <PrivateImg name={task.imagePath} scope="staff" alt="" style={{ height: 60, borderRadius: 8, border: "1px solid #EAE8E2" }} />
                    <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => edit((c) => { c.writing.tasks[ti].imagePath = null; return c; })}>✕</button>
                  </>
                ) : (
                  <label style={{ ...ghost, display: "inline-flex", gap: 6 }}>
                    🖼 {t("mock.uploadImage")}
                    <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0], (path) => edit((c) => { c.writing.tasks[ti].imagePath = path; return c; }))} />
                  </label>
                )}
              </div>
            </div>
          ))}
          {content.writing.tasks.length < 2 && (
            <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT }} onClick={() => edit((c) => { const n = c.writing.tasks.length; c.writing.tasks.push({ title: `Task ${n + 1}`, prompt: "", minWords: n === 0 ? 150 : 250, imagePath: null }); return c; })}>
              + {t("mock.addTask")}
            </button>
          )}
        </>
      )}

      {section === "speaking" && (
        <>
          {content.speaking.parts.map((p, pi) => (
            <div key={pi} style={{ ...card, display: "grid", gap: 10 }}>
              <PartHeader title={p.title} onTitle={(v) => edit((c) => { c.speaking.parts[pi].title = v; return c; })} onRemove={() => edit((c) => { c.speaking.parts.splice(pi, 1); return c; })} />
              <input className="field-input" placeholder={t("mock.instructionPh")} value={p.instruction ?? ""} onChange={(e) => edit((c) => { c.speaking.parts[pi].instruction = e.target.value; return c; })} />
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <span style={{ color: "#6B6E78" }}>{t("mock.prepSeconds")}</span>
                <input type="number" min={0} max={300} className="field-input" style={{ width: 80 }} value={p.prepSeconds} onChange={(e) => edit((c) => { c.speaking.parts[pi].prepSeconds = Number(e.target.value) || 0; return c; })} />
                <span style={{ color: "#6B6E78" }}>{t("mock.answerSeconds")}</span>
                <input type="number" min={10} max={300} className="field-input" style={{ width: 80 }} value={p.answerSeconds} onChange={(e) => edit((c) => { c.speaking.parts[pi].answerSeconds = Number(e.target.value) || 0; return c; })} />
              </div>
              <div>
                <span style={label}>{t("mock.speakingQuestions")}</span>
                <textarea className="field-input" rows={5} value={p.questions.join("\n")} onChange={(e) => edit((c) => { c.speaking.parts[pi].questions = e.target.value.split("\n"); return c; })} />
              </div>
            </div>
          ))}
          {content.speaking.parts.length < 3 && (
            <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT }} onClick={() => edit((c) => { const n = c.speaking.parts.length; c.speaking.parts.push({ title: `Part ${n + 1}`, instruction: null, prepSeconds: n === 1 ? 60 : 0, answerSeconds: n === 1 ? 120 : 45, questions: [] }); return c; })}>
              + {t("mock.addPart")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export { levelKey };

// Map / plan / diagram picture of a part or passage.
export function ImageField({ path, onUpload, onClear }: { path: string | null; onUpload: (f: File | undefined) => void; onClear: () => void }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {path ? (
        <>
          <PrivateImg name={path} scope="staff" alt="" style={{ height: 70, borderRadius: 8, border: "1px solid #EAE8E2" }} />
          <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={onClear}>✕</button>
        </>
      ) : (
        <label style={{ ...ghost, display: "inline-flex", gap: 6 }}>
          🗺 {t("mock.uploadMap")}
          <input type="file" accept="image/*" hidden onChange={(e) => onUpload(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

export function PartHeader({ title, onTitle, onRemove }: { title: string; onTitle: (v: string) => void; onRemove: () => void }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input className="field-input" value={title} onChange={(e) => onTitle(e.target.value)} style={{ fontWeight: 800, flex: 1 }} />
      <button type="button" style={{ ...ghost, color: "#B23A47" }} onClick={() => { if (confirm(t("mock.removePartConfirm"))) onRemove(); }} title={t("common.delete")}>🗑</button>
    </div>
  );
}

// Questions of one part/passage: a compact numbered list, one open editor.
export function QuestionsEditor({ questions, onChange, start = 0 }: { questions: TestQuestion[]; onChange: (qs: TestQuestion[]) => void; start?: number }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, q: TestQuestion) => onChange(questions.map((x, j) => (j === i ? q : x)));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={label}>{t("mock.questions")} ({questions.length})</span>
      {questions.map((q, i) => (
        <div key={i} style={{ border: `1px solid ${hasAnswer(q) ? "#EAE8E2" : "#FECACA"}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: open === i ? "#F7F6FF" : "#fff", cursor: "pointer" }} onClick={() => setOpen(open === i ? null : i)}>
            <b style={{ width: 24, color: "#686B75" }}>{start + i + 1}.</b>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.prompt || <i style={{ color: "#686B75" }}>{t("mock.emptyQuestion")}</i>}</span>
            <span style={{ fontSize: 11, color: "#686B75" }}>{q.type}</span>
            {!hasAnswer(q) && <span style={{ fontSize: 11, color: "#B23A47", fontWeight: 700 }}>{t("mock.noKey")}</span>}
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(questions.filter((_, j) => j !== i)); setOpen(null); }} style={{ background: "none", border: "none", color: "#B23A47", cursor: "pointer" }}>✕</button>
          </div>
          {open === i && (
            <div style={{ padding: 10, borderTop: "1px solid #F0EEE8" }}>
              <QuestionEditor value={q} onChange={(nq) => set(i, nq)} excludeTypes={["ESSAY"]} />
            </div>
          )}
        </div>
      ))}
      <button type="button" style={{ ...ghost, borderStyle: "dashed", color: ACCENT, justifySelf: "start" }} onClick={() => { onChange([...questions, emptyQuestion("FILL_BLANK")]); setOpen(questions.length); }}>
        + {t("mock.addQuestion")}
      </button>
    </div>
  );
}
