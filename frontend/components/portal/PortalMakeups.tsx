"use client";

import { useEffect, useState } from "react";
import { portalMakeupsApi, type PortalMakeups as Data } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { centerToday, isoToCenterParts } from "@/lib/center-time";
import { localDate } from "@/lib/makeups";
import { formatDate } from "@/lib/format-date";
import { Badge, BOOKING_STATUS, CREDIT_STATUS, REASON_KEYS, dayLabel } from "@/components/makeups/shared";
import { portalCard } from "./PortalTabs";

/**
 * The student's make-up lessons in the cabinet, read-only: credits waiting
 * to be booked (and until when), upcoming make-ups, and past ones.
 * The center books them; this only shows where things stand.
 */
export default function PortalMakeups({ tz }: { tz: string }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    portalMakeupsApi
      .get()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const today = centerToday(tz);
  const waiting = (data?.credits ?? []).filter((c) => c.status === "ISSUED");
  const upcoming = (data?.bookings ?? []).filter((b) => b.status === "BOOKED" && b.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  // A cancelled booking gave its credit back (it is waiting again); a missed one shows as missed.
  const past = (data?.bookings ?? []).filter((b) => b.status !== "CANCELLED" && !(b.status === "BOOKED" && b.date >= today));
  const nothing = data && waiting.length === 0 && upcoming.length === 0 && past.length === 0;
  const expiryDay = (iso: string) => {
    const d = isoToCenterParts(iso, tz)?.date;
    return d ? formatDate(localDate(d), lang, "short") : "—";
  };

  const row: React.CSSProperties = { border: "1px solid #EAE8E2", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
  const sub: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, color: "#4A4E58", textTransform: "uppercase", letterSpacing: "0.03em", margin: "4px 0 0" };

  return (
    <section aria-labelledby="portal-makeups-title" style={{ ...portalCard, marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="portal-makeups-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("mk.portalTitle")}</h2>
      <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.5 }}>{t("mk.portalHint")}</div>
      {error ? (
        <div role="alert" style={{ fontSize: 13, color: "#B23A47", fontWeight: 600 }}>{t("mk.loadError")}</div>
      ) : !data ? (
        <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
      ) : nothing ? (
        <div style={{ fontSize: 13.5, color: "#686B75" }}>{t("mk.portalNone")}</div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <h3 style={sub}>{t("mk.portalUpcoming")}</h3>
              {upcoming.map((b) => (
                <div key={b.id} style={{ ...row, borderColor: "#C7D2FE" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{dayLabel(b.date, lang, t)} · {b.startTime}–{b.endTime}</div>
                    <div style={{ fontSize: 12.5, color: "#6B6E78", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px", overflowWrap: "anywhere" }}>
                      <span>{b.mode === "GROUP_LESSON" ? b.groupName ?? "—" : t("mk.session")}</span>
                      {b.teacherName && <span>👤 {b.teacherName}</span>}
                      {b.roomName && <span>🚪 {b.roomName}</span>}
                      {b.branchName && <span>📍 {b.branchName}</span>}
                    </div>
                  </div>
                  <Badge text={t(BOOKING_STATUS.BOOKED.key)} color={BOOKING_STATUS.BOOKED.color} bg={BOOKING_STATUS.BOOKED.bg} />
                </div>
              ))}
            </>
          )}
          {waiting.length > 0 && (
            <>
              <h3 style={sub}>{t("mk.portalWaiting")}</h3>
              {waiting.map((c) => (
                <div key={c.id} style={row}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{c.originGroupName ?? "—"} · {dayLabel(c.originDate, lang, t)}</div>
                    <div style={{ fontSize: 12.5, color: "#6B6E78", marginTop: 3 }}>
                      {t(REASON_KEYS[c.reason])}
                      {" · "}
                      {c.expiresAt ? t("mk.portalUseBy").replace("{date}", expiryDay(c.expiresAt)) : t("mk.noExpiry")}
                    </div>
                  </div>
                  <Badge text={t(CREDIT_STATUS.ISSUED.key)} color={CREDIT_STATUS.ISSUED.color} bg={CREDIT_STATUS.ISSUED.bg} />
                </div>
              ))}
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 style={sub}>{t("mk.portalPast")}</h3>
              {past.map((b) => {
                const st = BOOKING_STATUS[b.status];
                return (
                  <div key={b.id} style={row}>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel(b.date, lang, t)} · {b.startTime}–{b.endTime}</div>
                      <div style={{ fontSize: 12.5, color: "#6B6E78", marginTop: 3, overflowWrap: "anywhere" }}>
                        {b.mode === "GROUP_LESSON" ? b.groupName ?? "—" : t("mk.session")}
                        {b.teacherName ? ` · ${b.teacherName}` : ""}
                      </div>
                    </div>
                    <Badge text={t(st.key)} color={st.color} bg={st.bg} />
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </section>
  );
}
