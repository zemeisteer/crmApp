"use client";

import { headerChanges, type PublicQuestion } from "@/lib/tests";
import QuestionInput from "./QuestionInput";

const ACCENT = "var(--primary)";

// A whole test as the student sees it: numbered questions, with section
// titles, instructions and reading passages shown once where they start.
export default function TestPaper({
  questions,
  answers,
  onAnswer,
  disabled,
}: {
  questions: PublicQuestion[];
  answers: string[];
  onAnswer: (index: number, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {questions.map((q, i) => {
        const h = headerChanges(questions, i);
        return (
          <div key={q.id ?? i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {h.section && (
              <div style={{ marginTop: i === 0 ? 0 : 10, padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--ink)", color: "var(--on-ink)", fontSize: 13, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>
                {h.section}
              </div>
            )}
            {h.instruction && <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-soft)" }}>{h.instruction}</div>}
            {h.passage && (
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text)", background: "var(--surface-muted)", borderLeft: `4px solid ${ACCENT}`, borderRadius: "var(--radius-sm)", padding: "12px 14px", whiteSpace: "pre-wrap" }}>
                {h.passage}
              </div>
            )}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                <span style={{ color: ACCENT, marginRight: 6 }}>{i + 1}.</span>
                {q.prompt}
                {q.points && q.points > 1 ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginLeft: 6 }}>({q.points})</span> : null}
              </div>
              <QuestionInput q={q} value={answers[i] ?? ""} onChange={(v) => onAnswer(i, v)} disabled={disabled} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
