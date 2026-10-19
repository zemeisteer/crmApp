"use client";

import { useEffect, useState } from "react";
import { portalEventsApi, type PortalEvent } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";
import { KIND_STYLE, kindKey } from "@/components/schedule/CenterEvents";
import { portalCard } from "./PortalTabs";

/**
 * The center's coming events for students and parents: meetings,
 * competitions and the like (the next 60 days), with the place or the
 * online link. Nothing is shown when there are none.
 */
export default function PortalEvents() {
  const { t, lang } = useLanguage();
  const [events, setEvents] = useState<PortalEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    portalEventsApi
      .list()
      .then((list) => alive && setEvents(list))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!error && (events === null || events.length === 0)) return null;

  return (
    <section aria-labelledby="portal-events-title" style={{ ...portalCard, marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="portal-events-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("ev.portalTitle")}</h2>
      {error ? (
        <div role="alert" style={{ fontSize: 13, color: "#B23A47", fontWeight: 600 }}>{t("ev.portalLoadError")}</div>
      ) : (
        events!.map((ev) => {
          const s = KIND_STYLE[ev.kind] ?? KIND_STYLE.OTHER;
          const place = ev.format === "ONLINE" ? t("ev.online") : [ev.roomName, ev.location].filter(Boolean).join(" · ") || t("ev.offline");
          return (
            <div key={ev.id} style={{ border: "1px solid #EAE8E2", borderLeft: `4px solid ${s.color}`, borderRadius: 12, padding: "10px 12px", display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 999, padding: "3px 9px" }}>
                  {s.icon} {t(kindKey(ev.kind))}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {formatDate(`${ev.date}T12:00:00`, lang, "dayMonth")} · {ev.startTime}
                  {ev.endTime ? `–${ev.endTime}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#181A1F" }}>{ev.title}</div>
              <div style={{ fontSize: 13, color: "#4A4E58" }}>{place}</div>
              {ev.description && <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.5 }}>{ev.description}</div>}
              {ev.format === "ONLINE" && ev.meetingUrl && (
                <a href={ev.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
                  {t("ev.join")} ↗
                </a>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
