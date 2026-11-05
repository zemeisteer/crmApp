"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, placementApi, type PublicPlacementTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { Lang } from "@/lib/i18n";
import { placementLevelName } from "@/lib/placement";
import { isAnswered } from "@/lib/tests";
import TestPaper from "@/components/tests/TestPaper";
import PhoneInput from "@/components/PhoneInput";
import { isCompleteUzPhone } from "@/lib/validation";

const ACCENT = "var(--primary)";

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
  const [result, setResult] = useState<{ correct: number; total: number; percent: number; suggestedLevel: 1 | 2 | 3; pending: boolean } | null>(null);

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

  const answered = test ? test.questions.filter((q, i) => isAnswered(q, answers[i])).length : 0;

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      setError(t("pt.nameRequired"));
      return;
    }
    // The phone files the result with the center's admissions team.
    if (!isCompleteUzPhone(phone)) {
      setError(t("pt.phoneRequired"));
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
    <div style={{ minHeight: "100vh", background: "var(--surface-muted)", padding: "24px 16px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{test?.centerName ?? "TalimCRM"}</div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["UZ", "RU", "EN"] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 8px", borderRadius: "var(--radius-xs)", border: "none", cursor: "pointer", background: lang === l ? ACCENT : "var(--border)", color: lang === l ? "var(--on-ink)" : "var(--text-soft)" }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "22px 20px" }}>
          {loadError ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 34 }}>🔒</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 8 }}>{t("pt.notFound")}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>{t("pt.notFoundHint")}</div>
            </div>
          ) : !test ? (
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
          ) : step === "intro" ? (
            <form onSubmit={start} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.4 }}>{t("placement.title")}</div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: "4px 0 6px" }}>{test.title}</h1>
                <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>
                  {test.subject} · {test.questions.length} {t("placement.questions")}
                </div>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.55, background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: 12 }}>{t("pt.introHint")}</div>
              <div>
                <div style={lbl}>{t("pt.fullName")} *</div>
                <input className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("std.namePh")} maxLength={120} />
              </div>
              <div>
                <div style={lbl}>{t("pt.phone")} *</div>
                <PhoneInput className="field-input" value={phone} onChange={setPhone} />
              </div>
              {error && <div role="alert" style={alertStyle}>{error}</div>}
              <button type="submit" className="btn" style={primary}>{t("pt.start")} →</button>
            </form>
          ) : step === "test" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ position: "sticky", top: 0, background: "var(--surface)", paddingBottom: 8, zIndex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                  <span>{test.title}</span>
                  <span style={{ color: ACCENT }}>{answered}/{test.questions.length}</span>
                </div>
                <div style={{ height: 6, background: "var(--surface-muted)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                  <div style={{ width: `${(answered / test.questions.length) * 100}%`, height: "100%", background: ACCENT, transition: "width 0.2s" }} />
                </div>
              </div>
              <TestPaper questions={test.questions} answers={answers} onAnswer={setAnswer} />
              {error && <div role="alert" style={alertStyle}>{error}</div>}
              {/* Always in reach on long tests. */}
              <div style={{ position: "sticky", bottom: 0, zIndex: 1, margin: "0 -20px -22px", padding: "12px 20px 16px", background: "linear-gradient(to top, var(--surface) 75%, rgba(255,255,255,0))", borderRadius: "0 0 18px 18px" }}>
                <button type="button" className="btn" onClick={submit} disabled={submitting} style={{ ...primary, width: "100%", minHeight: 50, boxShadow: "0 10px 24px -12px rgba(79,70,229,0.7)", opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? t("pt.submitting") : `${t("pt.finish")} (${answered}/${test.questions.length})`}
                </button>
              </div>
            </div>
          ) : (
            result && (
              <div style={{ textAlign: "center", padding: "12px 4px" }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0" }}>{t("pt.thanks")}, {fullName.trim()}!</h1>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 44, color: ACCENT }}>{result.percent}%</div>
                <div style={{ fontSize: 14, color: "var(--text-soft)" }}>
                  {result.correct} / {result.total} {t("pt.points")}
                </div>
                {result.pending ? (
                  <div style={{ marginTop: 14, display: "inline-block", background: "var(--warning-soft)", color: "var(--warning)", fontWeight: 700, fontSize: 13.5, padding: "8px 16px", borderRadius: "var(--radius-md)" }}>
                    ⏳ {t("pt.pendingReview")}
                  </div>
                ) : (
                  <div style={{ marginTop: 14, display: "inline-block", background: "var(--primary-soft)", color: ACCENT, fontWeight: 700, fontSize: 14, padding: "8px 16px", borderRadius: "var(--radius-pill)" }}>
                    {t("placement.suggested")}: {placementLevelName(test.subject, result.suggestedLevel, t)}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.5 }}>{t("pt.contactSoon")}</div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 };
const primary: React.CSSProperties = { background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 15, fontWeight: 700, padding: 13, borderRadius: "var(--radius-sm)", cursor: "pointer" };
const alertStyle: React.CSSProperties = { background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" };
