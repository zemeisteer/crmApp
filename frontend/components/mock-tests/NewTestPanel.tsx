"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DirectionSelect, { useDirectionOptions } from "@/components/DirectionSelect";
import { MOCK_LEVELS, mockTestsApi, type ExamInfo, type MockLevel, type PracticeTemplate } from "@/lib/api";
import { levelKey } from "@/components/mock-tests/levels";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";

/** What "create" sends for one starting point. */
export interface NewTestChoice {
  subject: string;
  sample?: boolean;
  template?: PracticeTemplate;
  // A practice test with an exam's real structure, for a level; `fill`: the AI writes the questions.
  exam?: string;
  examLevel?: string | null;
  fill?: boolean;
}

// The question types as teachers know them.
const TYPE_KEY: Record<string, TranslationKey> = {
  MCQ: "mock.qt.MCQ", MCQ_MULTI: "mock.qt.MCQ_MULTI", TRUE_FALSE: "mock.qt.TRUE_FALSE", TRUE_FALSE_NG: "mock.qt.TRUE_FALSE_NG",
  FILL_BLANK: "mock.qt.FILL_BLANK", SHORT_ANSWER: "mock.qt.SHORT_ANSWER", MATCHING: "mock.qt.MATCHING", WORD_ORDER: "mock.qt.WORD_ORDER",
  ERROR_CORRECTION: "mock.qt.ERROR_CORRECTION", TRANSFORMATION: "mock.qt.TRANSFORMATION", WORD_FORMATION: "mock.qt.WORD_FORMATION",
};
const LANG_CODE: Record<string, string> = {
  ENGLISH: "EN", RUSSIAN: "RU", GERMAN: "DE", FRENCH: "FR", TURKISH: "TR", ARABIC: "AR", KOREAN: "KO", JAPANESE: "JA", CHINESE: "ZH", SAT: "SAT", MATH: "∑", PROGRAMMING: "</>",
};

export default function NewTestPanel({ busy, onCreate, onGenerate, onClose }: { busy: boolean; onCreate: (choice: NewTestChoice) => void; onGenerate: (level: MockLevel | null, module: "ACADEMIC" | "GENERAL") => void; onClose: () => void }) {
  const { t } = useLanguage();
  const directions = useDirectionOptions();
  // Until one is picked, the first direction of the list is the choice.
  const [picked, setDirection] = useState("");
  const direction = picked || directions[0] || "";
  const [exams, setExams] = useState<{ fit: ExamInfo[]; other: ExamInfo[] } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [examId, setExamId] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [ieltsLevel, setIeltsLevel] = useState<MockLevel | null>(null);
  const [module, setModule] = useState<"ACADEMIC" | "GENERAL">("ACADEMIC");

  // The exams that fit the direction; the first one is chosen.
  useEffect(() => {
    if (!direction) return;
    let alive = true;
    mockTestsApi
      .exams(direction)
      .then((list) => {
        if (!alive) return;
        setExams(list);
        setExamId((list.fit[0] ?? list.other[0])?.id ?? null);
        setShowOther(list.fit.length === 0);
        setLevel(null);
      })
      .catch(() => alive && setExams({ fit: [], other: [] }));
    return () => {
      alive = false;
    };
  }, [direction]);

  const all = [...(exams?.fit ?? []), ...(exams?.other ?? [])];
  const exam = all.find((e) => e.id === examId) ?? null;
  const chip = (on: boolean): React.CSSProperties => ({ border: `1.5px solid ${on ? ACCENT : "var(--border)"}`, background: on ? "var(--primary-soft)" : "var(--surface)", color: on ? ACCENT : "var(--text)", borderRadius: "var(--radius-pill)", padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" });
  const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 8 };

  const examCard = (e: ExamInfo) => {
    const on = e.id === examId;
    return (
      <button
        key={e.id}
        type="button"
        aria-pressed={on}
        onClick={() => { setExamId(e.id); setLevel(null); }}
        style={{ textAlign: "left", background: on ? "var(--primary-soft)" : "var(--surface)", border: `1.5px solid ${on ? ACCENT : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: 14, cursor: "pointer", display: "grid", gap: 6, alignContent: "start" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ minWidth: 34, height: 26, padding: "0 6px", boxSizing: "border-box", borderRadius: "var(--radius-xs)", background: on ? ACCENT : "var(--surface-muted)", color: on ? "var(--on-ink)" : "var(--text-soft)", fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{LANG_CODE[e.language] ?? "•"}</span>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: on ? ACCENT : "var(--text)" }}>{e.name}</span>
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{e.about}</span>
        {!e.ielts && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)" }}>
            {t("mock.ex.summary").replace("{s}", String(e.sections.length)).replace("{m}", String(e.durationMin)).replace("{q}", String(e.questions))}
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={{ background: "var(--surface)", border: `1.5px solid ${ACCENT}`, borderRadius: "var(--radius-lg)", padding: 18, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{t("mock.newTitle")}</div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} style={{ border: "none", background: "var(--surface-muted)", width: 30, height: 30, borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: 15, color: "var(--text-soft)" }}>×</button>
      </div>

      <div style={{ maxWidth: 360 }}>
        <span style={label}>{t("mock.pickDirection")}</span>
        <DirectionSelect value={direction} onChange={setDirection} directions={directions} placeholder={t("mock.pickDirectionPh")} ariaLabel={t("mock.pickDirection")} />
      </div>

      {directions.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--warning)", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
          {t("mock.noDirections")}{" "}
          <Link href="/groups" style={{ color: ACCENT, fontWeight: 700 }}>{t("nav.groups")}</Link>
        </div>
      ) : exams === null ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : (
        <>
          {/* 1. The exam */}
          <div>
            <span style={label}>1. {t("mock.ex.pick")}{exams.fit.length > 0 && <> — <span style={{ color: ACCENT }}>{direction}</span></>}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {exams.fit.map(examCard)}
              {showOther && exams.other.map(examCard)}
            </div>
            {exams.fit.length > 0 && exams.other.length > 0 && (
              <button type="button" onClick={() => setShowOther((v) => !v)} style={{ marginTop: 10, border: "none", background: "none", padding: 0, color: ACCENT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                {showOther ? t("mock.ex.fewer") : t("mock.ex.more")}
              </button>
            )}
          </div>

          {/* 2. IELTS: its own AI writer, the sample or an empty test */}
          {exam?.ielts && (
            <div data-testid="ai-generate" style={{ border: `1px solid ${ACCENT}`, background: "linear-gradient(135deg, var(--primary-soft), var(--surface))", borderRadius: "var(--radius-md)", padding: 16, display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>✨ {t("mock.gen.title")}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{t("mock.gen.text")}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={t("mock.gen.level")}>
                <button type="button" aria-pressed={ieltsLevel === null} onClick={() => setIeltsLevel(null)} style={chip(ieltsLevel === null)}>{t("mock.gen.mixed")}</button>
                {MOCK_LEVELS.map((l) => <button key={l} type="button" aria-pressed={ieltsLevel === l} onClick={() => setIeltsLevel(l)} style={chip(ieltsLevel === l)}>{t(levelKey(l))}</button>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {(["ACADEMIC", "GENERAL"] as const).map((m) => <button key={m} type="button" aria-pressed={module === m} onClick={() => setModule(m)} style={chip(module === m)}>{m === "ACADEMIC" ? "Academic" : "General Training"}</button>)}
                <button type="button" className="btn" disabled={busy} onClick={() => onGenerate(ieltsLevel, module)} style={{ marginLeft: "auto", background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 18px", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>✨ {t("mock.gen.go")}</button>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ℹ️ {t("mock.gen.note")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onCreate({ subject: direction, sample: true })}>🎧 {t("mock.smp.ieltsTitle")}</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onCreate({ subject: direction, sample: false })}>📄 {t("mock.smp.ieltsBlankTitle")}</button>
              </div>
            </div>
          )}

          {/* 2. Any other exam: its structure, the level, then create */}
          {exam && !exam.ielts && (
            <div data-testid="exam-detail" style={{ border: "1px solid var(--border)", background: "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: 16, display: "grid", gap: 14 }}>
              <div>
                <span style={label}>2. {t("mock.ex.structure")}</span>
                <div style={{ display: "grid", gap: 8 }}>
                  {exam.sections.map((s) => (
                    <div key={s.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px", display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, fontWeight: 800 }}>
                        <span>{s.title}</span>
                        <span style={{ color: "var(--text-muted)", fontWeight: 700, whiteSpace: "nowrap" }}>⏱ {s.durationMin} {t("mock.ex.min")}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {s.parts.map((p) => (
                          <span key={p.title} title={p.title} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "3px 10px" }}>
                            {TYPE_KEY[p.type] ? t(TYPE_KEY[p.type]) : p.type} × {p.count}
                          </span>
                        ))}
                        {s.task && <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: "var(--primary-soft)", borderRadius: "var(--radius-pill)", padding: "3px 10px" }}>✍️ {t("mock.ex.task")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span style={label}>3. {t("mock.ex.level")}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={t("mock.ex.level")}>
                  <button type="button" aria-pressed={level === null} onClick={() => setLevel(null)} style={chip(level === null)}>{t("mock.gen.mixed")}</button>
                  {exam.levels.map((l) => <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} style={chip(level === l)}>{l}</button>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn" disabled={busy} data-testid="exam-create-ai" onClick={() => onCreate({ subject: direction, exam: exam.id, examLevel: level, fill: true })} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "11px 18px", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
                  ✨ {t("mock.ex.createAi")}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onCreate({ subject: direction, exam: exam.id, examLevel: level })}>
                  {t("mock.ex.createEmpty")}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>ℹ️ {t("mock.ex.note")}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
