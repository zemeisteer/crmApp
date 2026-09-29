"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, isPracticeAttempt, MOCK_SECTIONS, portalMockApi, practiceResult, type PortalAnyAttempt, type PortalPractice as Practice } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { bandColor } from "@/components/mock-tests/FeedbackView";
import { SECTION_ICON, sectionKey } from "@/components/mock-tests/sections";
import MockRunner from "@/components/portal/MockRunner";
import PracticeRunner, { percentColor } from "@/components/portal/PracticeRunner";
import { levelKey } from "@/components/mock-tests/levels";
import { PORTAL_ACCENT as ACCENT, portalCard as card, TabTitle } from "@/components/portal/PortalTabs";

type Direction = Practice["directions"][number];
type TestCard = Direction["tests"][number];

const DIRECTION_ICON: Record<string, string> = { SAT: "🎓", ENGLISH: "🇬🇧", MATH: "📐", PROGRAMMING: "💻", GENERAL: "📘" };

// The practice area: the student's directions (their groups' subjects), each
// with the tests the center published for it. English directions get the
// IELTS mock; every direction gets practice tests on the same exam screen,
// and, when the center has AI on, practice sets the AI makes on a topic.
export default function PortalPractice({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useLanguage();
  const [data, setData] = useState<Practice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PortalAnyAttempt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    portalMockApi.list().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [t]);
  useEffect(load, [load]);

  async function open(testId: string, attemptId?: string) {
    setBusy(testId);
    setError(null);
    try {
      setAttempt(attemptId ? await portalMockApi.getAny(attemptId) : await portalMockApi.start(testId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  async function generate(subject: string, topic: string) {
    setBusy(`ai:${subject}`);
    setError(null);
    try {
      setAttempt(await portalMockApi.generate({ subject, topic: topic.trim() || undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  if (attempt) {
    const exit = () => { setAttempt(null); load(); };
    return isPracticeAttempt(attempt)
      ? <PracticeRunner initial={attempt} readOnly={readOnly} onExit={exit} />
      : <MockRunner initial={attempt} readOnly={readOnly} onExit={exit} />;
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
              <span aria-hidden>{DIRECTION_ICON[d.template] ?? "📘"}</span>
              <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "#4A4E58" }}>{d.subject}</span>
              {d.english && <span style={{ fontSize: 11, fontWeight: 800, color: ACCENT, background: "#EEF0FF", padding: "2px 8px", borderRadius: 100 }}>IELTS</span>}
            </div>
            {d.tests.length === 0 && (
              <div style={{ ...card, fontSize: 13.5, color: "#6B6E78" }}>{d.english ? t("pmk.noIelts") : t("pmk.noTests")}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
              {d.tests.map((x) => (
                <TestCardView key={x.id} x={x} readOnly={readOnly} busy={busy === x.id} onOpen={(attemptId) => open(x.id, attemptId)} />
              ))}
              {!readOnly && data.aiPractice && <AiPracticeCard subject={d.subject} left={data.aiPractice.left} busy={busy === `ai:${d.subject}`} onMake={(topic) => generate(d.subject, topic)} />}
            </div>
          </section>
        ))
      )}
      {data && !data.aiFeedback && data.directions.some((d) => d.tests.length > 0) && (
        <div style={{ fontSize: 12.5, color: "#8A8D96" }}>ℹ️ {t("pmk.noAi")}</div>
      )}
    </div>
  );
}

function TestCardView({ x, readOnly, busy, onOpen }: { x: TestCard; readOnly: boolean; busy: boolean; onOpen: (attemptId?: string) => void }) {
  const { t } = useLanguage();
  const last = x.attempts[0];
  const running = last?.status === "IN_PROGRESS";
  const practice = x.practice;
  const minutes = practice ? practice.reduce((n, s) => n + s.durationMin, 0) : x.durations.listening + x.durations.reading + x.durations.writing + 14;
  const btn = (primary: boolean): React.CSSProperties => primary
    ? { flex: 1, background: ACCENT, color: "#fff", border: "none", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }
    : { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: "pointer" };
  const overall = practice ? last?.results.overallPercent : last?.results.overall;
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12, background: x.mine ? "linear-gradient(160deg, #fff 60%, #ECFDF5)" : "linear-gradient(160deg, #fff 60%, #F5F3FF)" }}>
      <div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {x.mine && <span style={pill("#E9F8EF", "#1FA463")}>🤖 {t("prx.mine")}</span>}
          {!practice && <span style={pill("#F2F1EC", "#4A4E58")}>{x.level ? t(levelKey(x.level)) : t("mock.levelAll")}</span>}
          {!practice && x.module === "GENERAL" && <span style={pill("#F2F1EC", "#4A4E58")}>General Training</span>}
          {x.recommended && <span style={pill("#E9F8EF", "#1FA463")}>✓ {t("pmk.forYou")}</span>}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{x.title}</div>
        <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>
          ⏱ ~{minutes} {t("pmk.min")}{practice ? ` · ${practice.length} ${t("prx.sections")}` : ""}
        </div>
      </div>
      {practice ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {practice.map((s) => {
            const r = practiceResult(last?.results, s.key);
            return (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: "#F7F7F5", borderRadius: 9, padding: "6px 10px", fontSize: 12.5 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                <b style={{ color: percentColor(r?.percent), flexShrink: 0 }}>{r?.percent != null ? `${r.percent}%` : last?.sectionDone[s.key] ? (r?.status === "PENDING" ? "⏳" : "✓") : "—"}</b>
              </div>
            );
          })}
        </div>
      ) : (
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
      )}
      {overall != null && (
        <div style={{ fontSize: 13.5 }}>
          {practice ? t("prx.overall") : t("pmk.overall")}: <b style={{ color: practice ? percentColor(overall) : bandColor(overall), fontSize: 18 }}>{overall}{practice ? "%" : ""}</b>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
        {!readOnly && !x.open && (
          <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "#8A8D96", background: "#F7F7F5", borderRadius: 11, padding: "10px 12px", textAlign: "center" }}>🔒 {t("pmk.locked")}</div>
        )}
        {!readOnly && x.open && (
          <button type="button" disabled={busy} onClick={() => onOpen()} style={btn(true)}>
            {running ? `▶ ${t("pmk.continue")}` : last ? `↻ ${t("pmk.again")}` : `▶ ${t("pmk.start")}`}
          </button>
        )}
        {last && !running && (
          <button type="button" onClick={() => onOpen(last.id)} style={btn(false)}>📊 {t("pmk.results")}</button>
        )}
        {readOnly && last && running && (
          <button type="button" onClick={() => onOpen(last.id)} style={btn(false)}>👁 {t("pmk.view")}</button>
        )}
      </div>
    </div>
  );
}

const pill = (bg: string, color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 100, background: bg, color });

// Ask the AI for a practice set in this direction, on a topic.
function AiPracticeCard({ subject, left, busy, onMake }: { subject: string; left: number; busy: boolean; onMake: (topic: string) => void }) {
  const { t } = useLanguage();
  const [topic, setTopic] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!busy && left > 0) onMake(topic); }}
      style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: "#C7D2FE", background: "#FAFAFF" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }} aria-hidden>🤖</span>
        <div style={{ fontSize: 15.5, fontWeight: 800 }}>{t("prx.aiTitle")}</div>
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: left > 0 ? ACCENT : "#B45309" }}>{t("prx.left").replace("{n}", String(left))}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#6B6E78", lineHeight: 1.5 }}>{t("prx.aiHint")}</div>
      <input className="field-input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder={t("prx.topicPh")} aria-label={`${subject}: ${t("prx.topicPh")}`} />
      <button type="submit" disabled={busy || left <= 0} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 11, padding: "10px 14px", fontWeight: 700, cursor: busy || left <= 0 ? "default" : "pointer", opacity: left <= 0 ? 0.5 : 1 }}>
        {busy ? `⏳ ${t("prx.making")}` : `✨ ${t("prx.make")}`}
      </button>
    </form>
  );
}
