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
    const mcq = q.type === "MCQ";
    return (
      <div style={{ display: "grid", gridTemplateColumns: mcq ? "repeat(auto-fit, minmax(220px, 1fr))" : "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
        {(q.options ?? []).map((o) => {
          const picked = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.id)}
              aria-pressed={picked}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                justifyContent: mcq ? "flex-start" : "center",
                textAlign: "left",
                minHeight: 48,
                fontSize: 14.5,
                lineHeight: 1.35,
                padding: "10px 12px",
                borderRadius: 12,
                cursor: disabled ? "default" : "pointer",
                border: `1.5px solid ${picked ? ACCENT : "#E2E8F0"}`,
                background: picked ? "#EEF0FF" : "#fff",
                color: "#0F172A",
                fontWeight: picked ? 700 : 500,
                boxShadow: picked ? "0 0 0 3px rgba(79,70,229,0.12)" : "none",
                transition: "border-color .15s, background .15s",
              }}
            >
              {mcq && (
                <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, background: picked ? ACCENT : "#F1F5F9", color: picked ? "#fff" : "#64748B" }}>
                  {o.id}
                </span>
              )}
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{mcq ? o.text : labels[o.id] ?? o.text}</span>
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
    const set = (i: number, right: string) => {
      const next = { ...map };
      if (next[String(i)] === right) delete next[String(i)];
      else next[String(i)] = right;
      onChange(JSON.stringify(next));
    };
    const used = new Set(Object.values(map));
    // No dropdowns: each item shows the choices as buttons (easy on phones,
    // long answers wrap instead of being cut off). Tap again to clear.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(q.left ?? []).map((l, i) => {
          const chosen = map[String(i)] ?? "";
          return (
            <div key={i} style={{ border: `1.5px solid ${chosen ? ACCENT : "#E2E8F0"}`, borderRadius: 12, padding: 10, background: chosen ? "#FAFAFF" : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>
                  <span style={{ color: ACCENT, marginRight: 6 }}>{i + 1})</span>
                  {l}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: chosen ? ACCENT : "#94A3B8", whiteSpace: "nowrap" }}>{chosen ? `→ ${chosen}` : t("qt.pick")}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(q.right ?? []).map((r) => {
                  const on = chosen === r;
                  const elsewhere = !on && used.has(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabled}
                      onClick={() => set(i, r)}
                      aria-pressed={on}
                      style={{
                        fontSize: 13.5,
                        fontWeight: on ? 700 : 500,
                        padding: "8px 12px",
                        borderRadius: 100,
                        cursor: disabled ? "default" : "pointer",
                        border: `1.5px solid ${on ? ACCENT : "#E2E8F0"}`,
                        background: on ? ACCENT : "#fff",
                        color: on ? "#fff" : elsewhere ? "#94A3B8" : "#0F172A",
                        textAlign: "left",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
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
