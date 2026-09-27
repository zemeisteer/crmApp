"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, examsApi, type Exam, type ExamAttemptDetail } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";
import type { TestQuestion } from "@/lib/tests";
import AttemptReview from "@/components/tests/AttemptReview";

// One online exam attempt, loaded by id: answers, key, and grading of
// written answers (with an optional AI suggestion).
export function ExamAttemptReview({ examId, attemptId, onChanged }: { examId: string; attemptId: string; onChanged?: () => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<ExamAttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    examsApi.getAttempt(examId, attemptId).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [examId, attemptId, t]);

  if (error) return <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>;

  const pct = data.maxScore ? Math.round((data.score / data.maxScore) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat label={data.student.fullName} value={data.reviewStatus === "PENDING" ? `⏳ ${t("review.pendingShort")}` : `${data.score}/${data.maxScore} (${pct}%)`} sub={`${data.earnedPoints}/${data.totalPoints} ${t("pdfq.pts")}`} />
        <Stat label={t("placement.date")} value={formatDateTime(data.createdAt, lang)} sub={data.reviewStatus === "PENDING" ? undefined : data.passed ? `✓ ${t("ex.passed")}` : t("ex.recorded")} />
      </div>
      <AttemptReview
        items={data.breakdown.map((b) => ({
          key: b.questionId,
          question: {
            type: b.questionType,
            prompt: b.prompt,
            section: b.section,
            instruction: b.instruction,
            passage: b.passage,
            options: b.options,
            correctAnswer: b.correctAnswer,
            pairs: b.pairs,
            words: b.words,
            rubric: b.rubric,
            explanation: b.explanation,
            points: b.points,
          } satisfies TestQuestion,
          answer: b.studentAnswer,
          earned: b.earned,
          max: b.points,
          pending: b.pending,
          correct: b.isCorrect,
        }))}
        manualScores={data.manualScores}
        aiReview={data.aiReview}
        onAiReview={async () => setData(await examsApi.aiReviewAttempt(examId, attemptId))}
        onSave={async (scores) => {
          setData(await examsApi.gradeAttempt(examId, attemptId, scores));
          onChanged?.();
        }}
      />
    </div>
  );
}

// All online attempts of an exam; pending ones first, click to review.
export default function ExamAttemptsModal({ exam, onClose, onChanged }: { exam: Exam; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const attempts = [...(exam.attempts ?? [])].sort((a, b) => (a.reviewStatus === "PENDING" ? 0 : 1) - (b.reviewStatus === "PENDING" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));

  return (
    <Modal open onClose={onClose} title={`${t("review.attemptsTitle")}: ${exam.title}`} width={780}>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" onClick={() => setOpen(null)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#4F46E5", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0 }}>
            ← {t("placement.back")}
          </button>
          <div style={{ maxHeight: "65vh", overflowY: "auto", paddingRight: 4 }}>
            <ExamAttemptReview examId={exam.id} attemptId={open} onChanged={onChanged} />
          </div>
        </div>
      ) : attempts.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("review.noAttempts")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>{t("placement.studentName")}</th>
                <th style={{ textAlign: "right" }}>{t("placement.score")}</th>
                <th>{t("placement.date")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.student?.fullName ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>
                    {a.reviewStatus === "PENDING" ? "⏳" : `${a.score}/${a.maxScore}`}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(a.createdAt, lang)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setOpen(a.id)}
                      style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${a.reviewStatus === "PENDING" ? "#FCD34D" : "#E2E8F0"}`, background: a.reviewStatus === "PENDING" ? "#FEF3C7" : "#fff", color: a.reviewStatus === "PENDING" ? "#92400E" : "#0F172A" }}
                    >
                      {a.reviewStatus === "PENDING" ? `⏳ ${t("review.check")}` : t("placement.details")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160, padding: "10px 12px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
      <div style={{ fontSize: 11.5, color: "#64748B", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94A3B8" }}>{sub}</div>}
    </div>
  );
}
