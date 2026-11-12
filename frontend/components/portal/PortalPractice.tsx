"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, isPracticeAttempt, MOCK_SECTIONS, portalMockApi, practiceResult, type MockProgress, type PortalAnyAttempt, type PortalPractice as Practice } from "@/lib/api";
import ProgressChart from "@/components/mock-tests/ProgressChart";
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
  const [progress, setProgress] = useState<MockProgress | null>(null);

  const load = useCallback(() => {
    portalMockApi.list().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
    portalMockApi.progress().then(setProgress).catch(() => setProgress(null));
  }, [t]);
  // Ticks so a mock day opens on the page when its time comes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
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
        <div style={{ ...card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", background: "var(--primary-soft)", borderColor: "var(--primary-border)" }}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <span style={{ fontSize: 13.5 }}>{t("pmk.yourLevel")}: <b>{t(levelKey(data.level))}</b> — {t("pmk.levelHint")}</span>
        </div>
      )}
      {error && <div role="alert" style={{ ...card, color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      {data?.mockDays?.map((m) => {
        const openNow = Date.parse(m.startsAt) <= now;
        return (
          <div key={m.id} data-testid="mock-day" style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderColor: openNow ? "var(--success-border)" : "var(--primary-border)", background: openNow ? "var(--success-soft)" : "var(--primary-soft)" }}>
            <span style={{ fontSize: 24 }} aria-hidden>🗓</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-soft)" }}>{t("pmk.mockDay")} · {m.groupName}</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{m.testTitle}</div>
              <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{openNow ? t("pmk.mockDayOpen") : t("pmk.mockDayOpens").replace("{d}", new Date(m.startsAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</div>
            </div>
            {openNow && !readOnly && (
              <button type="button" disabled={busy === m.testId} onClick={() => open(m.testId)} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>▶ {t("pmk.startSection")}</button>
            )}
          </div>
        );
      })}
      {progress && progress.points.length > 0 && <ProgressChart data={progress} card={card} />}
      {!data ? (
        <div style={{ ...card, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : data.directions.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", padding: "36px 20px" }}>
          <div style={{ fontSize: 34 }}>🎯</div>
          {t("pmk.noDirections")}
        </div>
      ) : (
        data.directions.map((d) => (
          <section key={d.subject} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden>{DIRECTION_ICON[d.template] ?? "📘"}</span>
              <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-soft)" }}>{d.subject}</span>
              {d.english && <span style={{ fontSize: 11, fontWeight: 800, color: ACCENT, background: "var(--primary-soft)", padding: "2px 8px", borderRadius: "var(--radius-pill)" }}>IELTS</span>}
            </div>
            {d.tests.length === 0 && (
              <div style={{ ...card, fontSize: 13.5, color: "var(--text-muted)" }}>{d.english ? t("pmk.noIelts") : t("pmk.noTests")}</div>
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
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>ℹ️ {t("pmk.noAi")}</div>
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
    ? { flex: 1, background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontWeight: 700, cursor: "pointer" }
    : { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontWeight: 700, cursor: "pointer" };
  const overall = practice ? last?.results.overallPercent : last?.results.overall;
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12, background: x.mine ? "linear-gradient(160deg, var(--surface) 60%, var(--success-soft))" : "linear-gradient(160deg, var(--surface) 60%, var(--violet-soft))" }}>
      <div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {x.mine && <span style={pill("var(--success-soft)", "var(--success)")}>🤖 {t("prx.mine")}</span>}
          {!practice && <span style={pill("var(--surface-muted)", "var(--text-soft)")}>{x.level ? t(levelKey(x.level)) : t("mock.levelAll")}</span>}
          {!practice && x.module === "GENERAL" && <span style={pill("var(--surface-muted)", "var(--text-soft)")}>General Training</span>}
          {x.recommended && <span style={pill("var(--success-soft)", "var(--success)")}>✓ {t("pmk.forYou")}</span>}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{x.title}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          ⏱ ~{minutes} {t("pmk.min")}{practice ? ` · ${practice.length} ${t("prx.sections")}` : ""}
        </div>
      </div>
      {practice ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {practice.map((s) => {
            const r = practiceResult(last?.results, s.key);
            return (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12.5 }}>
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
              <div key={s} style={{ textAlign: "center", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "6px 2px" }}>
                <div style={{ fontSize: 16 }}>{SECTION_ICON[s]}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t(sectionKey(s))}</div>
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
          <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "10px 12px", textAlign: "center" }}>🔒 {t("pmk.locked")}</div>
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

const pill = (bg: string, color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: bg, color });

// Ask the AI for a practice set in this direction, on a topic.
function AiPracticeCard({ subject, left, busy, onMake }: { subject: string; left: number; busy: boolean; onMake: (topic: string) => void }) {
  const { t } = useLanguage();
  const [topic, setTopic] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!busy && left > 0) onMake(topic); }}
      style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: "var(--primary-border)", background: "var(--primary-soft)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }} aria-hidden>🤖</span>
        <div style={{ fontSize: 15.5, fontWeight: 800 }}>{t("prx.aiTitle")}</div>
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: left > 0 ? ACCENT : "var(--warning)" }}>{t("prx.left").replace("{n}", String(left))}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t("prx.aiHint")}</div>
      <input className="field-input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder={t("prx.topicPh")} aria-label={`${subject}: ${t("prx.topicPh")}`} />
      <button type="submit" disabled={busy || left <= 0} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontWeight: 700, cursor: busy || left <= 0 ? "default" : "pointer", opacity: left <= 0 ? 0.5 : 1 }}>
        {busy ? t("prx.making") : t("prx.make")}
      </button>
    </form>
  );
}
