"use client";

import type { ExaminerFeedback } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

// Criterion names of the public IELTS band descriptors.
const CRITERIA: Record<string, string> = {
  TR: "Task Response / Achievement",
  CC: "Coherence & Cohesion",
  LR: "Lexical Resource",
  GRA: "Grammar Range & Accuracy",
  FC: "Fluency & Coherence",
};

export function bandColor(b: number | null | undefined) {
  if (b == null) return "#686B75";
  return b >= 7 ? "#16794A" : b >= 5.5 ? "#4F46E5" : b >= 4 ? "#B45309" : "#DC2626";
}

// The AI examiner's (or teacher's) feedback: criterion bars, strengths,
// what to improve and corrected sentences.
export default function FeedbackView({ fb }: { fb: ExaminerFeedback }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 6 }}>
        {Object.entries(fb.criteria).map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 34px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <span style={{ color: "#4A4E58", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{CRITERIA[k] ?? k}</span>
            <span style={{ height: 7, background: "#F2F1EC", borderRadius: 99, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(v / 9) * 100}%`, background: bandColor(v), borderRadius: 99 }} />
            </span>
            <b style={{ textAlign: "right", color: bandColor(v) }}>{v}</b>
          </div>
        ))}
      </div>
      {fb.summary && <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "#33363D" }}>{fb.summary}</div>}
      {fb.strengths.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#167A48", marginBottom: 4 }}>✓ {t("mock.strengths")}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>{fb.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {fb.improvements.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#B45309", marginBottom: 4 }}>↗ {t("mock.improve")}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>{fb.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {fb.corrections && fb.corrections.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#4F46E5" }}>✎ {t("mock.corrections")}</div>
          {fb.corrections.map((c, i) => (
            <div key={i} style={{ fontSize: 13, background: "#F7F7F5", borderRadius: 10, padding: "8px 10px", lineHeight: 1.5 }}>
              <div style={{ color: "#B23A47", textDecoration: "line-through" }}>{c.original}</div>
              <div style={{ color: "#167A48" }}>{c.better}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
