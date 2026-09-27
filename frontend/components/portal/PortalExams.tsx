"use client";

import { useEffect, useState } from "react";
import { ApiError, portalApi, type PortalAvailableExam, type SubmitAttemptResult } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
type Running = Awaited<ReturnType<typeof portalApi.startExam>>;

// Exams of the student's groups that they can take on their own device
// (one attempt each). Shown at the top of the portal's results tab.
export default function PortalExams({ onFinished }: { onFinished?: () => void }) {
  const { t } = useLanguage();
  const [list, setList] = useState<PortalAvailableExam[] | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => portalApi.getAvailableExams().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);

  async function start(id: string) {
    setError(null);
    setBusy(true);
    try {
      const data = await portalApi.startExam(id);
      setRunning(data);
      setAnswers({});
      setResult(null);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!running) return;
    const left = running.questions.length - Object.values(answers).filter((a) => a.trim()).length;
    if (left > 0 && !window.confirm(t("pt.confirmUnanswered").replace("{n}", String(left)))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await portalApi.submitExam(running.exam.id, answers);
      setResult(res);
      setRunning(null);
      load();
      onFinished?.();
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (running) {
    const answered = running.questions.filter((q) => answers[q.id]?.trim()).length;
    return (
      <div style={card}>
        <div style={{ position: "sticky", top: 0, background: "#fff", paddingBottom: 10, zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15 }}>
            <span>{running.exam.title}</span>
            <span style={{ color: ACCENT }}>{answered}/{running.questions.length}</span>
          </div>
          <div style={{ height: 6, background: "#F1F5F9", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${(answered / running.questions.length) * 100}%`, height: "100%", background: ACCENT }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 8 }}>
          {running.questions.map((q, i) => (
            <div key={q.id}>
              <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 8, lineHeight: 1.45 }}>
                <span style={{ color: ACCENT, marginRight: 6 }}>{i + 1}.</span>
                {q.prompt}
              </div>
              {q.options.length === 0 ? (
                <input
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder={t("ex.typeAnswer")}
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14 }}
                />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                  {q.options.map((o) => {
                    const picked = answers[q.id] === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                        style={{ textAlign: "left", fontSize: 14, padding: "11px 12px", borderRadius: 10, cursor: "pointer", border: `1.5px solid ${picked ? ACCENT : "#E2E8F0"}`, background: picked ? "#EEF2FF" : "#fff", color: "#0F172A", fontWeight: picked ? 700 : 500 }}
                      >
                        {q.questionType === "MCQ" && <b style={{ marginRight: 8, color: picked ? ACCENT : "#94A3B8" }}>{o.id}.</b>}
                        {o.text}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <div style={alertStyle}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={() => setRunning(null)} style={ghost}>{t("common.cancel")}</button>
          <button type="button" onClick={submit} disabled={busy} style={{ ...primary, flex: 1, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("pt.submitting") : `${t("pt.finish")} (${answered}/${running.questions.length})`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>📝 {t("pex.title")}</div>
      {result && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 12, background: result.passed ? "#ECFDF5" : "#FFF7ED", border: `1px solid ${result.passed ? "#A7F3D0" : "#FED7AA"}` }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{result.passed ? t("ex.passed") : t("ex.recorded")}</div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>
            {t("ex.correctAnswers")} <b>{result.earnedPoints} / {result.totalPoints}</b> · {result.score}/{result.maxScore}
          </div>
        </div>
      )}
      {error && <div style={alertStyle}>{error}</div>}
      {list === null ? (
        <div style={{ fontSize: 13, color: "#64748B" }}>{t("common.loading")}</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 13, color: "#64748B" }}>{t("pex.none")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: "1px solid #E2E8F0", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div>
                <div style={{ fontSize: 12, color: "#64748B" }}>
                  {e.groupName ? `${e.groupName} · ` : ""}{e.questionCount} {t("placement.questions")}
                </div>
              </div>
              {e.taken ? (
                <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>✓ {e.score}/{e.maxScore}</span>
              ) : (
                <button type="button" onClick={() => start(e.id)} disabled={busy} style={primary}>{t("pex.start")} →</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", padding: 18, marginBottom: 16 };
const primary: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 10, cursor: "pointer" };
const ghost: React.CSSProperties = { background: "#F1F5F9", color: "#334155", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 10, cursor: "pointer" };
const alertStyle: React.CSSProperties = { background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginTop: 10 };
