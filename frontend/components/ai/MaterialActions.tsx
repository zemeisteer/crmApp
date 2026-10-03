"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import QuestionDraftsModal from "@/components/tests/QuestionDraftsModal";
import { ApiError, aiApi, examsApi, homeworkApi, type Exam, type Group } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TestQuestion } from "@/lib/tests";

const ACCENT = "#4F46E5";

// Cuts the answer key off a material (a heading or line such as "Javoblar
// kaliti", "Answer key", "Ответы") so students don't get the answers.
export function stripAnswerKey(text: string) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^[#*\s]*(javoblar(\s+kaliti)?|to'g'ri javoblar|answer\s*key|answers|ключ(\s+ответов)?|ответы)(\s|:|\*|$)/i.test(l.trim()));
  if (at <= 0) return { text, removed: false };
  let end = at;
  // Drop a separator line right above the key too.
  while (end > 0 && /^\s*(-{3,}|\*{3,}|_{3,})?\s*$/.test(lines[end - 1])) end--;
  return { text: lines.slice(0, end).join("\n").trimEnd(), removed: true };
}

export interface MaterialLike {
  topic: string;
  subject: string;
  level?: string;
  content: string;
}

// What a teacher can do with an AI material: give it to groups as homework
// (the text becomes an attached PDF), turn it into exam questions, or
// download it as a PDF. Until then a material is only visible to staff.
export default function MaterialActions({ material, groups, defaultGroupId }: { material: MaterialLike; groups: Group[]; defaultGroupId?: string }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<null | "homework" | "exam">(null);
  const [busy, setBusy] = useState<null | "pdf">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function downloadPdf() {
    setBusy("pdf");
    setError(null);
    try {
      await aiApi.downloadPdf({ title: material.topic, subtitle: [material.subject, material.level].filter(Boolean).join(" · "), content: material.content });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => { setNotice(null); setMode("homework"); }} style={{ ...btn, background: ACCENT, color: "#fff", border: "none" }}>
          📤 {t("aim.toHomework")}
        </button>
        <button type="button" className="btn" onClick={() => { setNotice(null); setMode("exam"); }} style={btn}>
          📝 {t("aim.toExam")}
        </button>
        <button type="button" className="btn" onClick={downloadPdf} disabled={busy === "pdf"} style={btn}>
          {busy === "pdf" ? t("common.loading") : `⬇️ ${t("aim.downloadPdf")}`}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{t("aim.visibilityHint")}</div>
      {notice && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#15803D", background: "#ECFDF5", borderRadius: 8, padding: "8px 12px" }}>✓ {notice}</div>}
      {error && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#B23A47", background: "#FDEBEC", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}

      {mode === "homework" && (
        <HomeworkModal
          material={material}
          groups={groups}
          defaultGroupId={defaultGroupId}
          onClose={() => setMode(null)}
          onDone={(n) => {
            setMode(null);
            setNotice(t("aim.sentHomework").replace("{n}", String(n)));
          }}
        />
      )}
      {mode === "exam" && (
        <ExamModal
          material={material}
          onClose={() => setMode(null)}
          onDone={(n, title) => {
            setMode(null);
            setNotice(t("aim.addedToExam").replace("{n}", String(n)).replace("{exam}", title));
          }}
        />
      )}
    </div>
  );
}

function HomeworkModal({ material, groups, defaultGroupId, onClose, onDone }: { material: MaterialLike; groups: Group[]; defaultGroupId?: string; onClose: () => void; onDone: (groups: number) => void }) {
  const { t } = useLanguage();
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroupId ? [defaultGroupId] : []);
  const [title, setTitle] = useState(material.topic);
  const [description, setDescription] = useState(t("aim.hwDefaultDesc"));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyCut = stripAnswerKey(material.content);
  const [hideKey, setHideKey] = useState(keyCut.removed);
  const sorted = [...groups].sort((a, b) => Number(b.subject === material.subject) - Number(a.subject === material.subject));

  async function submit() {
    if (groupIds.length === 0 || !title.trim()) {
      setError(t("homework.selectAtLeastOneGroup"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await homeworkApi.create({ groupIds, title: title.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined });
      await Promise.all(created.map((h) => homeworkApi.attachText(h.id, { title: title.trim(), content: hideKey ? keyCut.text : material.content })));
      onDone(created.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`📤 ${t("aim.toHomework")}`} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={lbl}>{t("homework.fieldGroups")}</div>
          <MultiSelect options={sorted.map((g) => ({ value: g.id, label: `${g.name}${g.subject ? ` · ${g.subject}` : ""}` }))} selected={groupIds} onChange={setGroupIds} placeholder={t("homework.selectGroups")} />
        </div>
        <div>
          <div style={lbl}>{t("homework.fieldTitle")}</div>
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </div>
        <div>
          <div style={lbl}>{t("homework.fieldDescription")}</div>
          <textarea className="field-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: "vertical" }} />
        </div>
        <div>
          <div style={lbl}>{t("homework.fieldDueDate")}</div>
          <DatePicker value={dueDate} onChange={setDueDate} />
        </div>
        <div style={{ fontSize: 12, color: "#6D28D9", background: "#F5F3FF", borderRadius: 8, padding: "8px 12px" }}>📄 {t("aim.hwFileNote")}</div>
        {keyCut.removed && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>
            <input type="checkbox" checked={hideKey} onChange={(e) => setHideKey(e.target.checked)} style={{ marginTop: 2, accentColor: ACCENT }} />
            <span>🔑 {t("aim.hideKey")}</span>
          </label>
        )}
        {error && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#B23A47", background: "#FDEBEC", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
        <button type="button" className="btn" disabled={saving} onClick={submit} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}>
          {saving ? t("homework.adding") : t("homework.assign")}
        </button>
      </div>
    </Modal>
  );
}

function ExamModal({ material, onClose, onDone }: { material: MaterialLike; onClose: () => void; onDone: (count: number, exam: string) => void }) {
  const { t } = useLanguage();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [examId, setExamId] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<TestQuestion[] | null>(null);

  useEffect(() => {
    examsApi.list().then((list) => {
      setExams(list);
      const match = list.find((e) => e.group?.subject === material.subject) ?? list[0];
      if (match) setExamId(match.id);
    }).catch(() => setExams([]));
  }, [material.subject]);

  async function read() {
    if (!examId) return;
    setReading(true);
    setError(null);
    try {
      const res = await examsApi.parseTextQuestions(examId, material.content);
      setDrafts(res.questions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setReading(false);
    }
  }

  const exam = exams?.find((e) => e.id === examId);
  if (drafts && exam) {
    return (
      <QuestionDraftsModal
        title={`${t("aim.toExam")}: ${exam.title}`}
        questions={drafts}
        onClose={onClose}
        onSave={async (chosen) => {
          const created = await examsApi.batchQuestions(exam.id, chosen);
          onDone(created.length, exam.title);
        }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title={`📝 ${t("aim.toExam")}`} width={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.5 }}>{t("aim.toExamHint")}</div>
        {exams === null ? (
          <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
        ) : exams.length === 0 ? (
          <div style={{ fontSize: 13, color: "#B23A47" }}>{t("aim.noExams")}</div>
        ) : (
          <div>
            <div style={lbl}>{t("aim.pickExam")}</div>
            <Select value={examId} onChange={setExamId} options={exams.map((e) => ({ value: e.id, label: `${e.title}${e.group?.name ? ` · ${e.group.name}` : ""}` }))} />
          </div>
        )}
        {error && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#B23A47", background: "#FDEBEC", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
        <button type="button" className="btn" disabled={reading || !examId} onClick={read} style={{ background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, opacity: examId ? 1 : 0.6 }}>
          {reading ? t("aim.reading") : `✨ ${t("aim.readQuestions")}`}
        </button>
      </div>
    </Modal>
  );
}

const btn: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 9, cursor: "pointer" };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
