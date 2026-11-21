"use client";

import { useEffect, useState } from "react";
import { ApiError, makeupsApi, type MakeupRosterItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

/**
 * Students of other groups who come to this lesson to make up one they
 * missed ("guests"). The teacher marks them here, next to the group's own
 * attendance; marking "came" uses their make-up credit.
 */
export default function GroupMakeupGuests({ groupId, date, startTime }: { groupId: string; date: string; startTime?: string | null }) {
  const { t } = useLanguage();
  // The answer is kept with the lesson it is for: another lesson shows nothing until its own arrives.
  const key = `${groupId}|${date}|${startTime ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; items: MakeupRosterItem[] } | null>(null);
  const items = loaded?.key === key ? loaded.items : null;
  const setItems = (fn: (list: MakeupRosterItem[] | null) => MakeupRosterItem[]) => setLoaded((prev) => (prev ? { key: prev.key, items: fn(prev.items) } : prev));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    makeupsApi
      .roster(date, date)
      .then((list) => alive && setLoaded({ key, items: list.filter((x) => x.targetGroupId === groupId && x.status !== "CANCELLED" && (!startTime || x.startTime === startTime)) }))
      .catch(() => alive && setLoaded({ key, items: [] }));
    return () => {
      alive = false;
    };
  }, [groupId, date, startTime, key]);

  async function mark(item: MakeupRosterItem, status: "ATTENDED" | "MISSED") {
    setBusy(item.id);
    setError(null);
    try {
      const saved = await makeupsApi.mark(item.id, status);
      setItems((list) => (list ?? []).map((x) => (x.id === item.id ? { ...x, status: saved.status } : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  if (!items || items.length === 0) return null;
  const btn = (on: boolean, color: string): React.CSSProperties => ({
    border: `1px solid ${on ? color : "var(--border)"}`, background: on ? color : "var(--surface)", color: on ? "var(--on-ink)" : "var(--text-soft)",
    fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: "var(--radius-pill)", cursor: "pointer",
  });
  return (
    <section data-testid="makeup-guests" aria-label={t("mk.guestsTitle")} style={{ marginTop: 16, borderTop: "1px dashed var(--border)", paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>🔁 {t("mk.guestsTitle")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 10px" }}>{t("mk.guestsHint")}</div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600, marginBottom: 8 }}>{error}</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((x) => (
          <li key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 160px", fontWeight: 600, fontSize: 13.5 }}>
              {x.student.fullName}
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--primary)", background: "var(--primary-soft)", padding: "2px 8px", borderRadius: "var(--radius-pill)" }}>{t("mk.guestBadge")}</span>
            </span>
            <button type="button" disabled={busy === x.id} onClick={() => mark(x, "ATTENDED")} style={btn(x.status === "ATTENDED", "var(--success)")}>{t("mk.guestCame")}</button>
            <button type="button" disabled={busy === x.id} onClick={() => mark(x, "MISSED")} style={btn(x.status === "MISSED", "var(--danger)")}>{t("mk.guestMissed")}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
