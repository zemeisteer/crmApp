"use client";

import { useLanguage } from "@/lib/i18n-context";
import type { PublicQuestion } from "@/lib/tests";

const ACCENT = "#4F46E5";

// One question as a student answers it. The answer is always a string:
// option id for choices, text for written types, JSON {leftIndex: right}
// for matching.
export default function QuestionInput({ q, value, onChange, disabled }: { q: PublicQuestion; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useLanguage();

  if (q.type === "MCQ" || q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") {
    const labels: Record<string, string> = { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") };
    return (
      <div style={{ display: "grid", gridTemplateColumns: q.type === "MCQ" ? "repeat(auto-fit, minmax(200px, 1fr))" : `repeat(${(q.options ?? []).length}, minmax(0, 1fr))`, gap: 8 }}>
        {(q.options ?? []).map((o) => {
          const picked = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.id)}
              style={{ textAlign: "left", fontSize: 14, padding: "11px 12px", borderRadius: 10, cursor: disabled ? "default" : "pointer", border: `1.5px solid ${picked ? ACCENT : "#E2E8F0"}`, background: picked ? "#EEF0FF" : "#fff", color: "#0F172A", fontWeight: picked ? 700 : 500 }}
            >
              {q.type === "MCQ" && <b style={{ marginRight: 8, color: picked ? ACCENT : "#94A3B8" }}>{o.id}.</b>}
              {q.type === "MCQ" ? o.text : labels[o.id] ?? o.text}
            </button>
          );
        })}
      </div>
    );
  }

  if (q.type === "MATCHING") {
    let map: Record<string, string> = {};
    try {
      map = value ? JSON.parse(value) : {};
    } catch {
      map = {};
    }
    const set = (i: number, right: string) => onChange(JSON.stringify({ ...map, [i]: right }));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(q.left ?? []).map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, padding: "9px 12px", background: "#F7F6F2", borderRadius: 10 }}>
              {i + 1}) {l}
            </div>
            <select
              value={map[String(i)] ?? ""}
              disabled={disabled}
              onChange={(e) => set(i, e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${map[String(i)] ? ACCENT : "#E2E8F0"}`, fontSize: 14, background: "#fff", color: "#0F172A" }}
            >
              <option value="">{t("qt.pick")}</option>
              {(q.right ?? []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  }

  if (q.type === "WORD_ORDER") {
    // Chips may hold several words ("has lived"), so the answer is read
    // back by consuming known chips from the start of the text.
    const remaining = [...(q.words ?? [])];
    const used: string[] = [];
    let rest = value.trim();
    while (rest) {
      const idx = remaining
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => rest === w || rest.startsWith(`${w} `))
        .sort((a, b) => b.w.length - a.w.length)[0]?.i;
      if (idx === undefined) break;
      used.push(remaining[idx]);
      rest = rest.slice(remaining[idx].length).trim();
      remaining.splice(idx, 1);
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {remaining.map((w, i) => (
            <button key={`${w}-${i}`} type="button" disabled={disabled} onClick={() => onChange([...used, w].join(" "))} style={chip(false)}>
              {w}
            </button>
          ))}
        </div>
        <div style={{ minHeight: 44, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: 8, borderRadius: 10, border: "1.5px dashed #CBD5E1", background: "#FAFAF8" }}>
          {used.length === 0 ? (
            <span style={{ fontSize: 13, color: "#94A3B8" }}>{t("qt.tapWords")}</span>
          ) : (
            used.map((w, i) => (
              <button key={`${w}-${i}`} type="button" disabled={disabled} onClick={() => onChange(used.filter((_, j) => j !== i).join(" "))} style={chip(true)} title={t("common.clear")}>
                {w}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  if (q.type === "ESSAY") {
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    return (
      <div>
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={7}
          placeholder={t("qt.essayPh")}
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ fontSize: 12, color: "#94A3B8", textAlign: "right" }}>{words} {t("qt.words")}</div>
      </div>
    );
  }

  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("ex.typeAnswer")}
      style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14 }}
    />
  );
}

const chip = (placed: boolean): React.CSSProperties => ({
  fontSize: 14,
  fontWeight: 600,
  padding: "7px 12px",
  borderRadius: 8,
  cursor: "pointer",
  border: `1.5px solid ${placed ? ACCENT : "#E2E8F0"}`,
  background: placed ? "#EEF0FF" : "#fff",
  color: placed ? ACCENT : "#0F172A",
});
