"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, placementApi, type PublicPlacementTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { Lang } from "@/lib/i18n";
import { placementLevelName } from "@/lib/placement";

const ACCENT = "#4F46E5";

// Public placement test: a new student opens the link on their own phone or
// computer, enters name and phone, answers and sees their result. The
// center sees the same result in Students > Placement test.
export default function PublicPlacementPage() {
  const { t, lang, setLang } = useLanguage();
  const params = useParams();
  const token = (params?.token as string) || "";
  const [test, setTest] = useState<PublicPlacementTest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<"intro" | "test" | "done">("intro");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ correct: number; total: number; percent: number; suggestedLevel: 1 | 2 | 3 } | null>(null);

  useEffect(() => {
    if (!token) return;
    placementApi
      .publicGet(token)
      .then((data) => {
        setTest(data);
        setAnswers(data.questions.map(() => ""));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t("pt.notFound")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const answered = answers.filter((a) => a.trim()).length;

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      setError(t("pt.nameRequired"));
      return;
    }
    setError(null);
    setStep("test");
    window.scrollTo(0, 0);
  }

  async function submit() {
    if (!test) return;
    if (answered < test.questions.length && !window.confirm(t("pt.confirmUnanswered").replace("{n}", String(test.questions.length - answered)))) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await placementApi.publicSubmit(token, { fullName: fullName.trim(), phone: phone.trim() || undefined, answers });
      setResult(res);
      setStep("done");
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  const setAnswer = (i: number, v: string) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));

  return (
    <div style={{ minHeight: "100vh", background: "#F7F6F2", padding: "24px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16, color: "#181A1F" }}>{test?.centerName ?? "CRMAPP"}</div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["UZ", "RU", "EN"] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", background: lang === l ? ACCENT : "#EAE8E2", color: lang === l ? "#fff" : "#4A4E58" }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 18, padding: "22px 20px" }}>
          {loadError ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 34 }}>🔒</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 8 }}>{t("pt.notFound")}</div>
              <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 6 }}>{t("pt.notFoundHint")}</div>
            </div>
          ) : !test ? (
            <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
          ) : step === "intro" ? (
            <form onSubmit={start} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.4 }}>{t("placement.title")}</div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: "4px 0 6px" }}>{test.title}</h1>
                <div style={{ fontSize: 13.5, color: "#4A4E58" }}>
                  {test.subject} · {test.questions.length} {t("placement.questions")}
                </div>
              </div>
              <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.55, background: "#F7F6F2", borderRadius: 10, padding: 12 }}>{t("pt.introHint")}</div>
              <div>
                <div style={lbl}>{t("pt.fullName")} *</div>
                <input className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("std.namePh")} maxLength={120} />
              </div>
              <div>
                <div style={lbl}>{t("pt.phone")}</div>
                <input className="field-input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" maxLength={30} />
              </div>
              {error && <div role="alert" style={alertStyle}>{error}</div>}
              <button type="submit" className="btn" style={primary}>{t("pt.start")} →</button>
            </form>
          ) : step === "test" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ position: "sticky", top: 0, background: "#fff", paddingBottom: 8, zIndex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                  <span>{test.title}</span>
                  <span style={{ color: ACCENT }}>{answered}/{test.questions.length}</span>
                </div>
                <div style={{ height: 6, background: "#F2F1EC", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                  <div style={{ width: `${(answered / test.questions.length) * 100}%`, height: "100%", background: ACCENT, transition: "width 0.2s" }} />
                </div>
              </div>
              {test.questions.map((q, i) => (
                <div key={i}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, lineHeight: 1.45 }}>
                    <span style={{ color: ACCENT, marginRight: 6 }}>{i + 1}.</span>
                    {q.prompt}
                  </div>
                  {q.type === "SHORT_ANSWER" ? (
                    <input className="field-input" value={answers[i]} onChange={(e) => setAnswer(i, e.target.value)} placeholder={t("ex.typeAnswer")} maxLength={200} />
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: q.type === "TRUE_FALSE" ? "1fr 1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                      {q.options.map((o, oi) => {
                        const picked = answers[i] === String(oi);
                        return (
                          <button
                            key={oi}
                            type="button"
                            onClick={() => setAnswer(i, String(oi))}
                            style={{ textAlign: "left", fontSize: 14, padding: "11px 12px", borderRadius: 10, cursor: "pointer", border: `1.5px solid ${picked ? ACCENT : "#EAE8E2"}`, background: picked ? "#EEF0FF" : "#fff", color: "#181A1F", fontWeight: picked ? 700 : 500 }}
                          >
                            {q.type === "MCQ" && <b style={{ marginRight: 8, color: picked ? ACCENT : "#8A8D96" }}>{"ABCDEFGH"[oi]}.</b>}
                            {q.type === "TRUE_FALSE" ? (oi === 0 ? t("pt.true") : t("pt.false")) : o}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {error && <div role="alert" style={alertStyle}>{error}</div>}
              <button type="button" className="btn" onClick={submit} disabled={submitting} style={{ ...primary, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? t("pt.submitting") : `${t("pt.finish")} (${answered}/${test.questions.length})`}
              </button>
            </div>
          ) : (
            result && (
              <div style={{ textAlign: "center", padding: "12px 4px" }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0" }}>{t("pt.thanks")}, {fullName.trim()}!</h1>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 44, color: ACCENT }}>{result.percent}%</div>
                <div style={{ fontSize: 14, color: "#4A4E58" }}>
                  {result.correct} / {result.total} {t("placement.correct")}
                </div>
                <div style={{ marginTop: 14, display: "inline-block", background: "#EEF0FF", color: ACCENT, fontWeight: 700, fontSize: 14, padding: "8px 16px", borderRadius: 999 }}>
                  {t("placement.suggested")}: {placementLevelName(test.subject, result.suggestedLevel, t)}
                </div>
                <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 16, lineHeight: 1.5 }}>{t("pt.contactSoon")}</div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const primary: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 15, fontWeight: 700, padding: 13, borderRadius: 11, cursor: "pointer" };
const alertStyle: React.CSSProperties = { background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 };
