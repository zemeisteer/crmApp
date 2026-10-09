"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import LoadError from "@/components/LoadError";
import { makeupsApi, type MakeupCredit, type MakeupCreditStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";
import { useCenterClock } from "@/lib/use-center-clock";
import { localDate } from "@/lib/makeups";
import BookModal from "./BookModal";
import { Badge, BOOKING_STATUS, CREDIT_STATUS, Empty, Loading, Notice, REASON_KEYS, card, dangerBtn, dayLabel, errorText, lbl, muted, primaryBtn, smallBtn } from "./shared";

const STATUSES: MakeupCreditStatus[] = ["ISSUED", "BOOKED", "USED", "FORFEITED", "CANCELLED"];

/**
 * Credits: what each student is owed and where it stands - book it, cancel
 * the booking, void an unused credit, or reinstate one lost by missing the
 * make-up. Expiry follows the center's policy (Settings).
 */
export default function CreditsTab({ canManage, refreshKey }: { canManage: boolean; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const clock = useCenterClock();
  // An instant (issued, expires) as the center's calendar day.
  const centerDay = (iso: string) => {
    const d = clock.dateOf(iso);
    return d ? formatDate(localDate(d), lang, "short") : "—";
  };
  const [status, setStatus] = useState<MakeupCreditStatus | "">("");
  const [search, setSearch] = useState("");
  const [nonce, setNonce] = useState(0);
  // Results are kept with the query they answer: a new query shows "loading".
  const query = `${status}|${nonce}|${refreshKey}`;
  const [result, setResult] = useState<{ query: string; rows: MakeupCredit[] | null; error: boolean } | null>(null);
  const rows = result?.query === query ? result.rows : null;
  const loadError = result?.query === query && result.error;
  const [booking, setBooking] = useState<MakeupCredit | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    makeupsApi
      .credits(status ? { status } : undefined)
      .then((list) => alive && setResult({ query, rows: list, error: false }))
      .catch(() => alive && setResult({ query, rows: null, error: true }));
    return () => {
      alive = false;
    };
  }, [status, query]);
  const reload = () => setNonce((n) => n + 1);

  async function act(id: string, fn: () => Promise<unknown>, ok: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(id);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err, t) });
    } finally {
      setBusyId(null);
      reload();
    }
  }

  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((c) => !q || (c.student?.fullName ?? "").toLowerCase().includes(q) || (c.originGroup?.name ?? "").toLowerCase().includes(q));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div role="group" aria-label={t("mk.statusFilter")} style={{ flex: "1 1 180px", maxWidth: 240, minWidth: 0 }}>
          <span style={lbl}>{t("mk.statusFilter")}</span>
          <Select
            ariaLabel={t("mk.statusFilter")}
            options={[{ value: "", label: t("mk.allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(CREDIT_STATUS[s].key) }))]}
            value={status}
            onChange={(v) => setStatus(v as MakeupCreditStatus | "")}
          />
        </div>
        <label style={{ flex: "2 1 200px", minWidth: 0 }}>
          <span style={lbl}>{t("mk.search")}</span>
          <input className="field-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mk.searchPh")} style={{ width: "100%" }} />
        </label>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {loadError ? (
        <LoadError message={t("mk.loadError")} onRetry={reload} />
      ) : rows === null ? (
        <Loading t={t} />
      ) : shown.length === 0 ? (
        <Empty text={rows.length === 0 ? t("mk.noCredits") : t("mk.noMatches")} />
      ) : (
        <ul aria-label={t("mk.tabCredits")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((c) => {
            const st = CREDIT_STATUS[c.status];
            // Bookings come newest first; the live one is the one not cancelled.
            const live = c.bookings.find((b) => b.status !== "CANCELLED") ?? null;
            const name = c.student?.fullName ?? "—";
            const busy = busyId === c.id;
            return (
              <li key={c.id} aria-label={`${name} · ${dayLabel(c.originDate, lang, t)}`} style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    {c.student ? (
                      <Link href={`/students/${c.student.id}`} style={{ fontSize: 14, fontWeight: 700, color: "#181A1F", overflowWrap: "anywhere" }}>{name}</Link>
                    ) : (
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{name}</span>
                    )}
                    <div style={{ ...muted, marginTop: 3, overflowWrap: "anywhere" }}>
                      {t("mk.missedOn")}: {c.originGroup?.name ?? "—"} · {dayLabel(c.originDate, lang, t)} · {t(REASON_KEYS[c.reason])}
                    </div>
                  </div>
                  <Badge text={t(st.key)} color={st.color} bg={st.bg} />
                  {c.expired && <Badge text={t("mk.expired")} color="#B23A47" bg="#FDEBEC" />}
                </div>
                <div style={{ ...muted, display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
                  <span>{t("mk.issuedOn")}: {centerDay(c.issuedAt)}</span>
                  {(c.status === "ISSUED" || c.status === "BOOKED") && (
                    <span style={c.expired ? { color: "#B23A47", fontWeight: 700 } : undefined}>
                      {c.expiresAt ? `${c.expired ? t("mk.expiredOn") : t("mk.expiresOn")}: ${centerDay(c.expiresAt)}` : t("mk.noExpiry")}
                    </span>
                  )}
                </div>
                {c.note && <div style={{ fontSize: 12.5, color: "#4A4E58", overflowWrap: "anywhere" }}>📝 {c.note}</div>}
                {live && (
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.6, display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{t("mk.makeup")}:</span>
                    <span style={{ overflowWrap: "anywhere" }}>
                      {live.mode === "GROUP_LESSON" ? live.targetGroup?.name ?? "—" : t("mk.session")} · {dayLabel(live.date, lang, t)} · {live.startTime}–{live.endTime}
                      {live.teacher ? ` · ${live.teacher.fullName}` : ""}
                      {live.room ? ` · ${live.room.name}` : ""}
                    </span>
                    <Badge text={t(BOOKING_STATUS[live.status].key)} color={BOOKING_STATUS[live.status].color} bg={BOOKING_STATUS[live.status].bg} />
                  </div>
                )}
                {canManage && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {c.status === "ISSUED" && !c.expired && (
                      <button type="button" className="btn" disabled={busy} onClick={() => setBooking(c)} style={primaryBtn} aria-label={`${t("mk.book")}: ${name}`}>
                        {t("mk.book")}
                      </button>
                    )}
                    {c.status === "BOOKED" && live && live.status === "BOOKED" && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={smallBtn}
                        onClick={() => act(c.id, () => makeupsApi.cancelBooking(live.id), t("mk.bookingCancelled"), t("mk.confirmCancelBooking"))}
                      >
                        {t("mk.cancelBooking")}
                      </button>
                    )}
                    {c.status === "ISSUED" && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={dangerBtn}
                        onClick={() => act(c.id, () => makeupsApi.voidCredit(c.id), t("mk.voided"), t("mk.confirmVoid"))}
                      >
                        {t("mk.void")}
                      </button>
                    )}
                    {c.status === "FORFEITED" && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={smallBtn}
                        onClick={() => act(c.id, () => makeupsApi.reinstate(c.id), t("mk.reinstated"), t("mk.confirmReinstate"))}
                      >
                        {t("mk.reinstate")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {booking && (
        <BookModal
          credit={booking}
          onClose={() => setBooking(null)}
          onBooked={(msg) => {
            setBooking(null);
            setMessage({ tone: "ok", text: msg });
            reload();
          }}
        />
      )}
    </div>
  );
}
