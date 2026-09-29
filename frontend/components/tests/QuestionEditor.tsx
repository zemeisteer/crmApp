"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { TF_OPTIONS, TFNG_OPTIONS, type QuestionType, type TestQuestion } from "@/lib/tests";
import TypePicker from "./TypePicker";

const ACCENT = "#4F46E5";

export const emptyQuestion = (type: QuestionType = "MCQ"): TestQuestion => ({
  type,
  prompt: "",
  options: type === "MCQ" ? ["A", "B", "C", "D"].map((id) => ({ id, text: "" })) : type === "MCQ_MULTI" ? ["A", "B", "C", "D", "E"].map((id) => ({ id, text: "" })) : type === "TRUE_FALSE" ? TF_OPTIONS : type === "TRUE_FALSE_NG" ? TFNG_OPTIONS : [],
  correctAnswer: "",
  pairs: type === "MATCHING" ? [{ left: "", right: "" }, { left: "", right: "" }] : null,
  words: type === "WORD_ORDER" ? [] : null,
  points: type === "ESSAY" ? 5 : 1,
});

// Switching type keeps the shared fields and resets the type-specific ones.
function retype(q: TestQuestion, type: QuestionType): TestQuestion {
  const fresh = emptyQuestion(type);
  const letters = (x: QuestionType) => x === "MCQ" || x === "MCQ_MULTI";
  const keepOptions = letters(type) && letters(q.type);
  return {
    ...fresh,
    prompt: q.prompt,
    section: q.section,
    instruction: q.instruction,
    passage: q.passage,
    explanation: q.explanation,
    level: q.level,
    points: type === "ESSAY" ? Math.max(q.points, 5) : q.points,
    options: keepOptions ? q.options : fresh.options,
    correctAnswer: keepOptions && type === q.type ? q.correctAnswer : "",
  };
}

// Edits one question of any type. Controlled: `value` in, full question out.
export default function QuestionEditor({ value: q, onChange, showLevel, excludeTypes }: { value: TestQuestion; onChange: (q: TestQuestion) => void; showLevel?: boolean; excludeTypes?: QuestionType[] }) {
  const { t } = useLanguage();
  const [showContext, setShowContext] = useState(Boolean(q.section || q.instruction || q.passage));
  const set = (patch: Partial<TestQuestion>) => onChange({ ...q, ...patch });

  const promptPh: Record<QuestionType, string> = {
    MCQ: t("qe.ph.MCQ"),
    MCQ_MULTI: t("qe.ph.MCQ_MULTI"),
    TRUE_FALSE: t("qe.ph.statement"),
    TRUE_FALSE_NG: t("qe.ph.statement"),
    FILL_BLANK: t("qe.ph.FILL_BLANK"),
    SHORT_ANSWER: t("qe.ph.SHORT_ANSWER"),
    MATCHING: t("qe.ph.MATCHING"),
    WORD_ORDER: t("qe.ph.WORD_ORDER"),
    ERROR_CORRECTION: t("qe.ph.ERROR_CORRECTION"),
    TRANSFORMATION: t("qe.ph.TRANSFORMATION"),
    WORD_FORMATION: t("qe.ph.WORD_FORMATION"),
    ESSAY: t("qe.ph.ESSAY"),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: showLevel ? "minmax(0,1fr) 80px 90px" : "minmax(0,1fr) 80px", gap: 8, alignItems: "end" }}>
        <div>
          <div style={lbl}>{t("qe.type")}</div>
          <TypePicker value={q.type} onChange={(type) => onChange(retype(q, type))} exclude={excludeTypes} />
        </div>
        <div>
          <div style={lbl}>{t("qe.points")}</div>
          <input className="field-input" type="number" min={1} max={100} value={q.points} onChange={(e) => set({ points: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} style={{ height: 40 }} />
        </div>
        {showLevel && (
          <div>
            <div style={lbl}>{t("qe.level")}</div>
            <select className="field-input" value={q.level ?? 1} onChange={(e) => set({ level: Number(e.target.value) as 1 | 2 | 3 })} style={{ height: 40 }}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
        )}
      </div>

      <button type="button" onClick={() => setShowContext((s) => !s)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: ACCENT, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        {showContext ? "▾" : "▸"} {t("qe.context")}
      </button>
      {showContext && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
          <input className="field-input" value={q.section ?? ""} onChange={(e) => set({ section: e.target.value })} placeholder={t("qe.sectionPh")} />
          <input className="field-input" value={q.instruction ?? ""} onChange={(e) => set({ instruction: e.target.value })} placeholder={t("qe.instructionPh")} />
          <textarea className="field-input" value={q.passage ?? ""} onChange={(e) => set({ passage: e.target.value })} placeholder={t("qe.passagePh")} rows={3} style={{ height: "auto", resize: "vertical" }} />
        </div>
      )}

      <div>
        <div style={lbl}>{q.type === "MATCHING" ? t("qe.promptOptional") : t("qe.prompt")}</div>
        <textarea className="field-input" value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder={promptPh[q.type]} rows={2} style={{ height: "auto", resize: "vertical" }} />
      </div>

      <AnswerFields q={q} set={set} />
    </div>
  );
}

function AnswerFields({ q, set }: { q: TestQuestion; set: (p: Partial<TestQuestion>) => void }) {
  const { t } = useLanguage();

  if (q.type === "MCQ" || q.type === "MCQ_MULTI") {
    const multi = q.type === "MCQ_MULTI";
    const picked = new Set(q.correctAnswer.split(",").filter(Boolean));
    // Choose TWO: one mark per right letter.
    const toggle = (id: string) => {
      const next = new Set(picked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const key = [...next].sort().join(",");
      set({ correctAnswer: key, points: Math.max(1, next.size) });
    };
    const options = q.options ?? [];
    const relabel = (list: typeof options) => list.map((o, i) => ({ ...o, id: String.fromCharCode(65 + i) }));
    return (
      <div>
        <div style={lbl}>{t("qe.optionsHint")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {options.map((o, i) => {
            const on = multi ? picked.has(o.id) : q.correctAnswer === o.id;
            return (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button type="button" title={t("qe.markCorrect")} onClick={() => (multi ? toggle(o.id) : set({ correctAnswer: o.id }))} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 8, cursor: "pointer", fontWeight: 800, border: `1.5px solid ${on ? "#16A34A" : "#E2E8F0"}`, background: on ? "#DCFCE7" : "#fff", color: on ? "#15803D" : "#64748B" }}>
                  {on ? "✓" : o.id}
                </button>
                <input className="field-input" value={o.text} onChange={(e) => set({ options: options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder={`${t("qe.option")} ${o.id}`} style={{ height: 36 }} />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      // Letters shift after a removal; keep the same option marked.
                      const next = relabel(options.filter((_, j) => j !== i));
                      if (multi) {
                        const keep = options.map((x, j) => (j !== i && picked.has(x.id) ? j : -1)).filter((j) => j >= 0);
                        set({ options: next, correctAnswer: keep.map((j) => next[j > i ? j - 1 : j].id).sort().join(",") });
                        return;
                      }
                      const c = options.findIndex((x) => x.id === q.correctAnswer);
                      set({ options: next, correctAnswer: c < 0 || c === i ? "" : next[c > i ? c - 1 : c].id });
                    }}
                    style={xBtn}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {options.length < 8 && (
          <button type="button" onClick={() => set({ options: relabel([...options, { id: "", text: "" }]) })} style={addBtn}>
            + {t("qe.addOption")}
          </button>
        )}
      </div>
    );
  }

  if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") {
    const labels: Record<string, string> = { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") };
    return (
      <div>
        <div style={lbl}>{t("qe.correct")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {(q.options ?? []).map((o) => {
            const on = q.correctAnswer === o.id;
            return (
              <button key={o.id} type="button" onClick={() => set({ correctAnswer: o.id })} style={{ flex: 1, padding: "9px 10px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `1.5px solid ${on ? "#16A34A" : "#E2E8F0"}`, background: on ? "#DCFCE7" : "#fff", color: on ? "#15803D" : "#334155" }}>
                {on && "✓ "}
                {labels[o.id] ?? o.text}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (q.type === "MATCHING") {
    const pairs = q.pairs ?? [];
    return (
      <div>
        <div style={lbl}>{t("qe.pairsHint")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {pairs.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
              <input className="field-input" value={p.left} onChange={(e) => set({ pairs: pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })} placeholder={`${i + 1}`} style={{ height: 36 }} />
              <span style={{ color: "#94A3B8" }}>→</span>
              <input className="field-input" value={p.right} onChange={(e) => set({ pairs: pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })} placeholder={t("qe.pairRight")} style={{ height: 36 }} />
              {pairs.length > 2 ? (
                <button type="button" onClick={() => set({ pairs: pairs.filter((_, j) => j !== i) })} style={xBtn}>✕</button>
              ) : (
                <span style={{ width: 30 }} />
              )}
            </div>
          ))}
        </div>
        {pairs.length < 12 && (
          <button type="button" onClick={() => set({ pairs: [...pairs, { left: "", right: "" }] })} style={addBtn}>
            + {t("qe.addPair")}
          </button>
        )}
      </div>
    );
  }

  if (q.type === "ESSAY") {
    return (
      <div>
        <div style={lbl}>{t("qe.rubric")}</div>
        <textarea className="field-input" value={q.rubric ?? ""} onChange={(e) => set({ rubric: e.target.value })} placeholder={t("qe.rubricPh")} rows={2} style={{ height: "auto", resize: "vertical" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {q.type === "WORD_ORDER" && (
        <div>
          <div style={lbl}>{t("qe.words")}</div>
          <input
            className="field-input"
            value={(q.words ?? []).join(" / ")}
            onChange={(e) => set({ words: e.target.value.split("/").map((w) => w.trim()).filter(Boolean) })}
            placeholder="has / she / lived / here / since 2020"
          />
        </div>
      )}
      <div>
        <div style={lbl}>{t("qe.answer")}</div>
        <input className="field-input" value={q.correctAnswer} onChange={(e) => set({ correctAnswer: e.target.value })} placeholder={q.type === "WORD_ORDER" ? "She has lived here since 2020" : t("qe.answerPh")} />
        <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 4 }}>{t("qe.answerHint")}</div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 5 };
const xBtn: React.CSSProperties = { width: 30, height: 30, flexShrink: 0, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", cursor: "pointer" };
const addBtn: React.CSSProperties = { marginTop: 6, background: "none", border: "1px dashed #CBD5E1", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: ACCENT, cursor: "pointer" };
