"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, mockTestsApi, practiceResult, type MockAttemptDetail, type MockAttemptRow, type PracticeResults, type PracticeTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";
import { percentColor } from "@/components/portal/PracticeRunner";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

// Sittings of a practice test: percent per section, and a window where the
// teacher reads the writing tasks, sees the AI's comment and sets the score.
export default function PracticeAttempts({ test }: { test: PracticeTest }) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<MockAttemptRow[] | null>(null);
  const [open, setOpen] = useState<MockAttemptDetail | null>(null);
  const sections = test.content.sections;

  const load = useCallback(() => {
    mockTestsApi.attempts(test.id).then(setRows).catch(() => setRows([]));
  }, [test.id]);
  useEffect(load, [load]);

  const cell = (results: PracticeResults, key: string, done: boolean) => {
    const r = practiceResult(results, key);
    if (!done) return <span style={{ display: "block", textAlign: "center", color: "#C9C7C0" }}>·</span>;
    return (
      <span style={{ display: "block", textAlign: "center", fontWeight: 800, color: percentColor(r?.percent) }}>
        {r?.percent != null ? `${r.percent}%` : r?.status === "PENDING" ? "⏳" : <span style={{ fontSize: 11, color: "#B45309" }}>{t("mock.needsReview")}</span>}
      </span>
    );
  };

  return (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      {rows === null ? (
        <div style={{ padding: 16, color: "#686B75" }}>{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#686B75" }}>{t("mock.noAttempts")}</div>
      ) : (
        <table className="table" style={{ margin: 0, minWidth: 640 }}>
          <thead>
            <tr>
              <th>{t("mock.student")}</th>
              <th>{t("mock.date")}</th>
              {sections.map((s, i) => <th key={i} style={{ textAlign: "center", maxWidth: 140 }} title={s.title}>{i + 1}. {s.title.length > 14 ? `${s.title.slice(0, 13)}…` : s.title}</th>)}
              <th style={{ textAlign: "center" }}>{t("pre.overall")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const results = r.results as unknown as PracticeResults;
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700 }}>{r.studentName}</td>
                  <td style={{ fontSize: 12.5, color: "#6B6E78" }}>{formatDateTime(r.completedAt ?? r.createdAt, lang)}{r.status === "IN_PROGRESS" ? ` · ${t("mock.inProgress")}` : ""}</td>
                  {sections.map((_, i) => <td key={i} style={{ padding: "14px 8px" }}>{cell(results, `s${i}`, !!r.sectionDone[`s${i}`])}</td>)}
                  <td style={{ textAlign: "center", fontWeight: 800, color: percentColor(results.overallPercent) }}>{results.overallPercent != null ? `${results.overallPercent}%` : "—"}</td>
                  <td><button type="button" style={ghost} onClick={async () => setOpen(await mockTestsApi.attempt(r.id))}>{t("mock.review")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && <ReviewModal test={test} detail={open} onClose={() => setOpen(null)} onChanged={(d) => { setOpen(d); load(); }} />}
    </div>
  );
}

function ReviewModal({ test, detail, onClose, onChanged }: { test: PracticeTest; detail: MockAttemptDetail; onClose: () => void; onChanged: (d: MockAttemptDetail) => void }) {
  const { t } = useLanguage();
  const results = detail.results as unknown as PracticeResults;
  const answers = detail.answers as unknown as Record<string, Record<string, string>>;
  const withTasks = test.content.sections.map((s, i) => ({ s, key: `s${i}` })).filter(({ s, key }) => s.tasks.length > 0 && detail.sectionDone[key]);

  return (
    <Modal open onClose={onClose} title={`${detail.student.fullName} — ${detail.test.title}`} width={640}>
      <div style={{ display: "grid", gap: 16, maxHeight: "75vh", overflowY: "auto", paddingRight: 4 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {test.content.sections.map((s, i) => {
            const r = practiceResult(results, `s${i}`);
            return (
              <span key={i} style={{ background: "#F7F7F5", borderRadius: 10, padding: "6px 10px", fontSize: 13 }}>
                {s.title}: <b style={{ color: percentColor(r?.percent) }}>{r?.percent != null ? `${r.percent}%` : "—"}</b>
                {r && <span style={{ color: "#686B75" }}> ({Math.round(r.raw * 10) / 10}/{r.max})</span>}
              </span>
            );
          })}
          <span style={{ background: "#EEF0FF", borderRadius: 10, padding: "6px 10px", fontSize: 13, fontWeight: 800, color: ACCENT }}>{t("pre.overall")}: {results.overallPercent != null ? `${results.overallPercent}%` : "—"}</span>
        </div>
        {withTasks.length === 0 && <div style={{ color: "#686B75", fontSize: 13 }}>{t("pre.nothing")}</div>}
        {withTasks.map(({ s, key }) => (
          <SectionTasks key={key} detail={detail} sectionKey={key} title={s.title} tasks={s.tasks} answers={answers[key] ?? {}} onChanged={onChanged} />
        ))}
      </div>
    </Modal>
  );
}

function SectionTasks({ detail, sectionKey, title, tasks, answers, onChanged }: {
  detail: MockAttemptDetail;
  sectionKey: string;
  title: string;
  tasks: PracticeTest["content"]["sections"][number]["tasks"];
  answers: Record<string, string>;
  onChanged: (d: MockAttemptDetail) => void;
}) {
  const { t } = useLanguage();
  const r = practiceResult(detail.results as unknown as PracticeResults, sectionKey);
  const [scores, setScores] = useState<string[]>(tasks.map((_, i) => (r?.tasks?.[i]?.score != null ? String(r.tasks[i].score) : "")));
  const [comment, setComment] = useState(r?.teacherComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<MockAttemptDetail>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }
  const nums = scores.map((x) => (x.trim() === "" ? NaN : Number(x)));

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>✍️ {title} {r?.gradedBy === "AI" && <span style={{ fontSize: 11, color: ACCENT }}>· AI</span>}</h3>
      {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", padding: "8px 12px", borderRadius: 10, fontSize: 13 }}>{error}</div>}
      {tasks.map((task, i) => (
        <div key={i} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{task.title} · {r?.tasks?.[i]?.words ?? 0} {t("mock.words")}</div>
          <div style={{ fontSize: 12.5, color: "#6B6E78", whiteSpace: "pre-wrap" }}>{task.prompt}</div>
          <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.6, background: "#FAFAF8", borderRadius: 10, padding: 10, maxHeight: 260, overflowY: "auto" }}>{answers[`t${i}`] || "—"}</div>
          {r?.tasks?.[i]?.comment && <div style={{ fontSize: 13, background: "#EEF0FF", borderRadius: 8, padding: "8px 10px" }}>🤖 {r.tasks[i].comment}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <b>{t("pre.taskScore")}</b>
            <input className="field-input" style={{ width: 80 }} value={scores[i] ?? ""} inputMode="decimal" onChange={(e) => setScores((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        </div>
      ))}
      <textarea className="field-input" rows={2} placeholder={t("mock.commentPh")} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 10)} style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }}
          onClick={() => run(() => mockTestsApi.reviewPractice(detail.id, { section: sectionKey, scores: nums, comment }))}>
          💾 {t("pre.saveScores")}
        </button>
        <button type="button" disabled={busy} style={ghost} onClick={() => run(() => mockTestsApi.regrade(detail.id, sectionKey))}>🤖 {t("mock.aiRegrade")}</button>
      </div>
    </section>
  );
}
