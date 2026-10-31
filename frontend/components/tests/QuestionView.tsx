"use client";

import type { ReactNode } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { headerChanges, TYPE_INFO, type TestQuestion } from "@/lib/tests";

const ACCENT = "var(--primary)";

// Section title, instruction and passage, shown where a group starts.
export function GroupHeader({ section, instruction, passage, first }: { section: string | null; instruction: string | null; passage: string | null; first?: boolean }) {
  if (!section && !instruction && !passage) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: first ? 0 : 8 }}>
      {section && <div style={{ padding: "6px 10px", borderRadius: "var(--radius-xs)", background: "var(--ink)", color: "var(--on-ink)", fontSize: 12, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>{section}</div>}
      {instruction && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-soft)" }}>{instruction}</div>}
      {passage && (
        <details style={{ fontSize: 13, background: "var(--surface-muted)", borderLeft: `3px solid ${ACCENT}`, borderRadius: "var(--radius-xs)", padding: "8px 10px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text-soft)" }}>📖 {passage.slice(0, 80)}{passage.length > 80 ? "…" : ""}</summary>
          <div style={{ marginTop: 6, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{passage}</div>
        </details>
      )}
    </div>
  );
}

export function TypeBadge({ q }: { q: Pick<TestQuestion, "type"> }) {
  const { t } = useLanguage();
  const info = TYPE_INFO[q.type];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--violet)", background: "var(--violet-soft)", padding: "2px 7px", borderRadius: "var(--radius-pill)", marginLeft: 4, verticalAlign: "middle", whiteSpace: "nowrap" }}>
      {info.icon} {t(info.label)}
    </span>
  );
}

// The correct answer of a question, as text for the teacher.
export function AnswerKey({ q }: { q: TestQuestion }) {
  const { t } = useLanguage();
  const labels: Record<string, string> = { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") };
  if (q.type === "MCQ") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 5 }}>
        {(q.options ?? []).map((o) => (
          <div key={o.id} style={optionStyle(o.id === q.correctAnswer)}>
            <b style={{ marginRight: 6 }}>{o.id}.</b>
            {o.text}
          </div>
        ))}
      </div>
    );
  }
  if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") {
    return <div style={{ ...optionStyle(Boolean(q.correctAnswer)), display: "inline-block" }}>{q.correctAnswer ? labels[q.correctAnswer] : t("pdfq.noAnswer")}</div>;
  }
  if (q.type === "MATCHING") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {(q.pairs ?? []).map((p, i) => (
          <div key={i} style={{ fontSize: 13 }}>
            {i + 1}) {p.left} <span style={{ color: "var(--text-faint)" }}>→</span> <b style={{ color: p.right ? "var(--success)" : "var(--warning)" }}>{p.right || t("pdfq.noAnswer")}</b>
          </div>
        ))}
      </div>
    );
  }
  if (q.type === "ESSAY") {
    return <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>📝 {q.rubric ? `${t("qe.rubric")}: ${q.rubric}` : t("qt.teacherGrades")}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {q.type === "WORD_ORDER" && (q.words ?? []).length > 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{(q.words ?? []).join(" / ")}</div>}
      <div style={{ ...optionStyle(Boolean(q.correctAnswer)), display: "inline-block", alignSelf: "flex-start" }}>
        {q.correctAnswer ? `✓ ${q.correctAnswer.split("|").join("  ·  ")}` : t("pdfq.noAnswer")}
      </div>
    </div>
  );
}

// Numbered list of questions with answers (teacher view). `renderItem` may
// replace the body of a question (e.g. an editor) and `aside` adds controls.
export default function QuestionList({
  questions,
  aside,
  renderItem,
  meta,
  itemStyle,
}: {
  questions: TestQuestion[];
  aside?: (q: TestQuestion, i: number) => ReactNode;
  renderItem?: (q: TestQuestion, i: number) => ReactNode | null;
  meta?: (q: TestQuestion, i: number) => ReactNode;
  itemStyle?: (q: TestQuestion, i: number) => React.CSSProperties;
}) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {questions.map((q, i) => {
        const h = headerChanges(questions, i);
        const custom = renderItem?.(q, i);
        return (
          <div key={q.id ?? i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <GroupHeader {...h} first={i === 0} />
            <div style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: "var(--radius-sm)", padding: 10, background: "var(--surface)", ...itemStyle?.(q, i) }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {custom ?? (
                    <>
                      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: ACCENT, marginRight: 4 }}>{i + 1}.</span>
                        {q.prompt}
                        <TypeBadge q={q} />
                        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 6 }}>
                          {q.points} {t("qe.pointsShort")}
                        </span>
                        {meta?.(q, i)}
                      </div>
                      <AnswerKey q={q} />
                    </>
                  )}
                </div>
                {aside?.(q, i)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const optionStyle = (right: boolean): React.CSSProperties => ({
  textAlign: "left",
  fontSize: 13,
  padding: "6px 10px",
  borderRadius: "var(--radius-xs)",
  border: `1px solid ${right ? "var(--success)" : "var(--border)"}`,
  background: right ? "var(--success-soft)" : "var(--surface)",
  color: "var(--text)",
  fontWeight: right ? 700 : 500,
});
