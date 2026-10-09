"use client";

import { useEffect, useState } from "react";
import LoadError from "@/components/LoadError";
import { makeupsApi, type MakeupRosterItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays, rangeProblem } from "@/lib/makeups";
import { Badge, BOOKING_STATUS, DateRange, Empty, Loading, Notice, card, dayLabel, errorText, muted } from "./shared";

/**
 * Make-ups booked in a date range, by day, with Attended / Missed for the
 * ones not marked yet. Teachers see the sessions they run and the seats in
 * their own groups (the server decides).
 */
export default function RosterTab({ canMark }: { canMark: boolean }) {
  const { t, lang } = useLanguage();
  const clock = useCenterClock();
  const today = clock.today();
  const [from, setFrom] = useState(() => addDays(clock.today(), -7));
  const [to, setTo] = useState(() => addDays(clock.today(), 30));
  const [nonce, setNonce] = useState(0);
  // Results are kept with the query they answer: a new query shows "loading".
  const query = `${from}|${to}|${nonce}`;
  const [result, setResult] = useState<{ query: string; rows: MakeupRosterItem[] | null; error: boolean } | null>(null);
  const rows = result?.query === query ? result.rows : null;
  const loadError = result?.query === query && result.error;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const badRange = rangeProblem(from, to) !== null;
  useEffect(() => {
    if (badRange) return;
    let alive = true;
    makeupsApi
      .roster(from, to)
      .then((list) => alive && setResult({ query, rows: list, error: false }))
      .catch(() => alive && setResult({ query, rows: null, error: true }));
    return () => {
      alive = false;
    };
  }, [from, to, badRange, query]);

  async function mark(item: MakeupRosterItem, status: "ATTENDED" | "MISSED") {
    setBusyId(item.id);
    setMessage(null);
    try {
      await makeupsApi.mark(item.id, status);
      setMessage({ tone: "ok", text: (status === "ATTENDED" ? t("mk.markedAttended") : t("mk.markedMissed")).replace("{name}", item.student.fullName) });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err, t) });
    } finally {
      setBusyId(null);
      setNonce((n) => n + 1);
    }
  }

  const days = [...new Set((rows ?? []).map((r) => r.date))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={muted}>{t("mk.rosterHint")}</div>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} t={t} />
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {loadError ? (
        <LoadError message={t("mk.loadError")} onRetry={() => setNonce((n) => n + 1)} />
      ) : badRange ? null : rows === null ? (
        <Loading t={t} />
      ) : rows.length === 0 ? (
        <Empty text={t("mk.noRoster")} />
      ) : (
        days.map((d) => (
          <section key={d} aria-label={dayLabel(d, lang, t)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 800, color: d === today ? "#4F46E5" : "#4A4E58", textTransform: "uppercase", letterSpacing: "0.03em", margin: "4px 2px 0" }}>
              {dayLabel(d, lang, t)}
              {d === today ? ` · ${t("mk.today")}` : ""}
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.filter((r) => r.date === d).map((r) => {
                const st = BOOKING_STATUS[r.status];
                return (
                  <li key={r.id} aria-label={`${r.student.fullName} · ${r.startTime}`} style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ width: 58, flexShrink: 0, textAlign: "center", borderRight: "1px solid #EAE8E2", paddingRight: 10 }}>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15 }}>{r.startTime}</div>
                      <div style={{ fontSize: 12, color: "#686B75" }}>{r.endTime}</div>
                    </div>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{r.student.fullName}</div>
                      <div style={{ ...muted, marginTop: 2, overflowWrap: "anywhere" }}>{r.mode === "GROUP_LESSON" ? r.groupName ?? "—" : t("mk.session")}</div>
                    </div>
                    <Badge text={t(st.key)} color={st.color} bg={st.bg} />
                    {canMark && r.status === "BOOKED" && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === r.id}
                          onClick={() => mark(r, "ATTENDED")}
                          aria-label={`${t("mk.attended")}: ${r.student.fullName}`}
                          style={{ background: "#1FA463", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
                        >
                          {t("mk.attended")}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === r.id}
                          onClick={() => {
                            if (window.confirm(t("mk.confirmMissed"))) void mark(r, "MISSED");
                          }}
                          aria-label={`${t("mk.missed")}: ${r.student.fullName}`}
                          style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
                        >
                          {t("mk.missed")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
