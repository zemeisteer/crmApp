"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { headerChanges, type TestQuestion } from "@/lib/tests";
import type { AiSuggestion } from "@/lib/api";
import { GroupHeader, TypeBadge } from "./QuestionView";

const ACCENT = "#4F46E5";

export interface ReviewItem {
  key: string;
  question: TestQuestion;
  answer: string;
  earned: number;
  max: number;
  pending: boolean;
  correct: boolean;
}

// A student's submitted test, question by question: what they answered, the
// key, and points. Written answers (essays) get a score field; the teacher
// may ask AI for a suggestion, then saves. Any question can be overridden.
export default function AttemptReview({
  items,
  manualScores,
  aiReview,
  onSave,
  onAiReview,
}: {
  items: ReviewItem[];
  manualScores: Record<string, number>;
  aiReview: Record<string, AiSuggestion>;
  onSave: (scores: Record<string, number>) => Promise<void>;
  onAiReview: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasEssay = items.some((it) => it.question.type === "ESSAY");
  const pendingCount = items.filter((it) => it.pending).length;
  const changed = Object.keys(draft).length > 0;

  async function run(kind: "save" | "ai") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "ai") await onAiReview();
      else {
        const scores: Record<string, number> = {};
        for (const [k, v] of Object.entries(draft)) if (v.trim() !== "" && Number.isFinite(Number(v))) scores[k] = Number(v);
        await onSave(scores);
        setDraft({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  const useAll = () => {
    const next: Record<string, string> = { ...draft };
    for (const [k, s] of Object.entries(aiReview)) next[k] = String(s.score);
    setDraft(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {(hasEssay || pendingCount > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: 10, borderRadius: 10, background: pendingCount ? "#FFFBEB" : "#F0FDF4", border: `1px solid ${pendingCount ? "#FCD34D" : "#BBF7D0"}` }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 600, color: pendingCount ? "#92400E" : "#166534" }}>
            {pendingCount ? `⏳ ${t("review.pendingCount")}: ${pendingCount}` : `✓ ${t("review.allGraded")}`}
          </div>
          {hasEssay && (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => run("ai")} style={{ ...btn, background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none" }}>
              {busy === "ai" ? t("review.aiBusy") : `✨ ${t("review.aiSuggest")}`}
            </button>
          )}
          {Object.keys(aiReview).length > 0 && (
            <button type="button" className="btn" onClick={useAll} style={btn}>
              {t("review.useAll")}
            </button>
          )}
        </div>
      )}
      {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8 }}>{error}</div>}

      {items.map((it, i) => {
        const q = it.question;
        const h = headerChanges(items.map((x) => x.question), i);
        const ai = aiReview[it.key];
        const manual = manualScores[it.key];
        const color = it.pending ? "#D97706" : it.earned >= it.max ? "#16A34A" : it.earned > 0 ? "#D97706" : "#DC2626";
        return (
          <div key={it.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <GroupHeader {...h} first={i === 0} />
            <div style={{ borderStyle: "solid", borderWidth: "1px 1px 1px 4px", borderColor: `${it.pending ? "#FCD34D" : "#E2E8F0"} ${it.pending ? "#FCD34D" : "#E2E8F0"} ${it.pending ? "#FCD34D" : "#E2E8F0"} ${color}`, borderRadius: 10, padding: 10, background: "#fff" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: "pre-wrap" }}>
                  <span style={{ color: ACCENT, marginRight: 4 }}>{i + 1}.</span>
                  {q.prompt}
                  <TypeBadge q={q} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color, whiteSpace: "nowrap" }}>
                  {it.pending ? "⏳" : `${it.earned}/${it.max}`}
                  {manual !== undefined && <span title={t("review.manual")}> ✎</span>}
                </div>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <Row label={t("review.studentAnswer")}>
                  <StudentAnswer q={q} answer={it.answer} />
                </Row>
                {q.type !== "ESSAY" && (
                  <Row label={t("review.key")}>
                    <KeyText q={q} />
                  </Row>
                )}
                {q.type === "ESSAY" && q.rubric && <Row label={t("qe.rubric")}><span style={{ color: "#475569" }}>{q.rubric}</span></Row>}
                {ai && (
                  <div style={{ fontSize: 12.5, background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 8, padding: "6px 10px", color: "#4C1D95" }}>
                    ✨ <b>{t("review.aiScore")}: {ai.score}/{it.max}</b> — {ai.comment}
                  </div>
                )}
                {(q.type === "ESSAY" || it.pending) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>{t("review.score")}:</span>
                    <input
                      type="number"
                      min={0}
                      max={it.max}
                      step={0.5}
                      className="field-input"
                      value={draft[it.key] ?? (manual !== undefined ? String(manual) : "")}
                      onChange={(e) => setDraft((d) => ({ ...d, [it.key]: e.target.value }))}
                      placeholder={ai ? String(ai.score) : "0"}
                      style={{ width: 90, height: 34 }}
                    />
                    <span style={{ fontSize: 12.5, color: "#94A3B8" }}>/ {it.max}</span>
                    {ai && draft[it.key] === undefined && (
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, [it.key]: String(ai.score) }))} style={{ ...btn, padding: "4px 10px" }}>
                        {t("review.useAi")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ position: "sticky", bottom: 0, background: "#fff", paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn" disabled={!changed || busy !== null} onClick={() => run("save")} style={{ ...btn, background: ACCENT, color: "#fff", border: "none", opacity: changed ? 1 : 0.5 }}>
          {busy === "save" ? t("common.saving") : t("review.save")}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", gap: 8, fontSize: 13 }}>
      <span style={{ color: "#94A3B8", fontWeight: 600 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function StudentAnswer({ q, answer }: { q: TestQuestion; answer: string }) {
  const { t } = useLanguage();
  if (!answer.trim()) return <span style={{ color: "#DC2626" }}>— {t("review.noAnswer")}</span>;
  if (q.type === "MCQ") {
    const o = (q.options ?? []).find((x) => x.id === answer);
    return <span>{o ? `${o.id}. ${o.text}` : answer}</span>;
  }
  if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") {
    const labels: Record<string, string> = { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") };
    return <span>{labels[answer] ?? answer}</span>;
  }
  if (q.type === "MATCHING") {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(answer);
    } catch {
      map = {};
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {(q.pairs ?? []).map((p, i) => {
          const given = map[String(i)] ?? "";
          const ok = given.trim().toLowerCase() === p.right.trim().toLowerCase();
          return (
            <span key={i}>
              {p.left} → <b style={{ color: ok ? "#16A34A" : "#DC2626" }}>{given || "—"}</b>
            </span>
          );
        })}
      </div>
    );
  }
  return <span style={{ whiteSpace: "pre-wrap" }}>{answer}</span>;
}

function KeyText({ q }: { q: TestQuestion }) {
  const { t } = useLanguage();
  if (q.type === "MCQ") {
    const o = (q.options ?? []).find((x) => x.id === q.correctAnswer);
    return <b style={{ color: "#16A34A" }}>{o ? `${o.id}. ${o.text}` : q.correctAnswer}</b>;
  }
  if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") {
    const labels: Record<string, string> = { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") };
    return <b style={{ color: "#16A34A" }}>{labels[q.correctAnswer] ?? q.correctAnswer}</b>;
  }
  if (q.type === "MATCHING") return <b style={{ color: "#16A34A" }}>{(q.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join("; ")}</b>;
  return <b style={{ color: "#16A34A" }}>{q.correctAnswer.split("|").join("  ·  ")}</b>;
}

const btn: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", color: "#0F172A", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer" };
