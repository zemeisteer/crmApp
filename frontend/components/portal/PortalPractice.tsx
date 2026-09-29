"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, MOCK_SECTIONS, portalMockApi, type PortalMockAttempt, type PortalPractice as Practice } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { bandColor } from "@/components/mock-tests/FeedbackView";
import { SECTION_ICON, sectionKey } from "@/components/mock-tests/sections";
import MockRunner from "@/components/portal/MockRunner";
import { levelKey } from "@/components/mock-tests/levels";
import { PORTAL_ACCENT as ACCENT, portalCard as card, TabTitle } from "@/components/portal/PortalTabs";

// The practice area: the student's directions (their groups' subjects), each
// with the mock tests the center published for it. English directions get
// the IELTS mock (Listening, Reading, Writing, Speaking in the app).
export default function PortalPractice({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useLanguage();
  const [data, setData] = useState<Practice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PortalMockAttempt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    portalMockApi.list().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [t]);
  useEffect(load, [load]);

  async function open(testId: string, attemptId?: string) {
    setBusy(testId);
    setError(null);
    try {
      setAttempt(attemptId ? await portalMockApi.get(attemptId) : await portalMockApi.start(testId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  if (attempt) {
    return <MockRunner initial={attempt} readOnly={readOnly} onExit={() => { setAttempt(null); load(); }} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabTitle title={t("pmk.title")} hint={t("pmk.hint")} />
      {data?.level && (
        <div style={{ ...card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", background: "#EEF0FF", borderColor: "#C7D2FE" }}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <span style={{ fontSize: 13.5 }}>{t("pmk.yourLevel")}: <b>{t(levelKey(data.level))}</b> — {t("pmk.levelHint")}</span>
        </div>
      )}
      {error && <div style={{ ...card, color: "#B23A47", fontSize: 13 }}>{error}</div>}
      {!data ? (
        <div style={{ ...card, color: "#8A8D96" }}>{t("common.loading")}</div>
      ) : data.directions.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#8A8D96", padding: "36px 20px" }}>
          <div style={{ fontSize: 34 }}>🎯</div>
          {t("pmk.noDirections")}
        </div>
      ) : (
        data.directions.map((d) => (
          <section key={d.subject} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "#4A4E58" }}>{d.subject}</span>
              {d.english && <span style={{ fontSize: 11, fontWeight: 800, color: ACCENT, background: "#EEF0FF", padding: "2px 8px", borderRadius: 100 }}>IELTS</span>}
            </div>
            {d.tests.length === 0 ? (
              <div style={{ ...card, fontSize: 13.5, color: "#6B6E78" }}>{d.english ? t("pmk.noIelts") : t("pmk.noTests")}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
                {d.tests.map((x) => {
                  const last = x.attempts[0];
                  const running = last?.status === "IN_PROGRESS";
                  return (
                    <div key={x.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 12, background: "linear-gradient(160deg, #fff 60%, #F5F3FF)" }}>
                      <div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 100, background: "#F2F1EC", color: "#4A4E58" }}>{x.level ? t(levelKey(x.level)) : t("mock.levelAll")}</span>
                          {x.module === "GENERAL" && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 100, background: "#F2F1EC", color: "#4A4E58" }}>General Training</span>}
                          {x.recommended && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 100, background: "#E9F8EF", color: "#1FA463" }}>✓ {t("pmk.forYou")}</span>}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800 }}>{x.title}</div>
                        <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>
                          ⏱ ~{x.durations.listening + x.durations.reading + x.durations.writing + 14} {t("pmk.min")}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                        {MOCK_SECTIONS.map((s) => {
                          const r = last?.results[s];
                          return (
                            <div key={s} style={{ textAlign: "center", background: "#F7F7F5", borderRadius: 10, padding: "6px 2px" }}>
                              <div style={{ fontSize: 16 }}>{SECTION_ICON[s]}</div>
                              <div style={{ fontSize: 10.5, color: "#6B6E78" }}>{t(sectionKey(s))}</div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: bandColor(r?.band) }}>{r?.band ?? (last?.sectionDone[s] ? (r?.status === "PENDING" ? "⏳" : "✓") : "—")}</div>
                            </div>
                          );
                        })}
                      </div>
                      {last?.results.overall != null && (
                        <div style={{ fontSize: 13.5 }}>{t("pmk.overall")}: <b style={{ color: bandColor(last.results.overall), fontSize: 18 }}>{last.results.overall}</b></div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                        {!readOnly && !x.open && (
                          <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "#8A8D96", background: "#F7F7F5", borderRadius: 11, padding: "10px 12px", textAlign: "center" }}>🔒 {t("pmk.locked")}</div>
                        )}
                        {!readOnly && x.open && (
                          <button type="button" disabled={busy === x.id} onClick={() => open(x.id)} style={{ flex: 1, background: ACCENT, color: "#fff", border: "none", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                            {running ? `▶ ${t("pmk.continue")}` : last ? `↻ ${t("pmk.again")}` : `▶ ${t("pmk.start")}`}
                          </button>
                        )}
                        {last && !running && (
                          <button type="button" onClick={() => open(x.id, last.id)} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                            📊 {t("pmk.results")}
                          </button>
                        )}
                        {readOnly && last && running && (
                          <button type="button" onClick={() => open(x.id, last.id)} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>👁 {t("pmk.view")}</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}
      {data && !data.aiFeedback && data.directions.some((d) => d.tests.length > 0) && (
        <div style={{ fontSize: 12.5, color: "#8A8D96" }}>ℹ️ {t("pmk.noAi")}</div>
      )}
    </div>
  );
}
