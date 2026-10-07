"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DatePicker from "@/components/DatePicker";
import LoadError from "@/components/LoadError";
import { ApiError, cashApi, type CashClosing, type CashDay } from "@/lib/api";
import { centerWallClock } from "@/lib/center-time";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";

const ACCENT = "#4F46E5";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 18 };
const METHOD_LABEL: Record<string, string> = { CLICK: "Click", PAYME: "Payme", BANK_TRANSFER: "Bank" };

// The cash desk for one of the center's days: what came in by method and by
// whom, what went out, what should be in the drawer - and closing the day
// with the cash counted (once; later records are shown apart).
export default function CashDayPanel({ canClose }: { canClose: boolean }) {
  const { t } = useLanguage();
  const clock = useCenterClock();
  const [date, setDate] = useState(() => clock.today());
  const [data, setData] = useState<CashDay | null>(null);
  const [history, setHistory] = useState<CashClosing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Only the answer for the day on screen is shown.
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    cashApi
      .day(date)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : t("cash.loadError"));
      });
    cashApi
      .closings(date.slice(0, 7))
      .then((h) => { if (mine === seq.current) setHistory(h); })
      .catch(() => { if (mine === seq.current) setHistory([]); });
  }, [date, t]);

  useEffect(load, [load]);

  async function onClose(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(counted);
    if (counted.trim() === "" || !Number.isInteger(n) || n < 0) {
      setCloseError(t("cash.countedInvalid"));
      return;
    }
    setClosing(true);
    setCloseError(null);
    try {
      const d = await cashApi.close({ date, countedCash: n, note: note.trim() || undefined });
      setData(d);
      setCounted("");
      setNote("");
      load();
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setClosing(false);
    }
  }

  const time = (iso: string) => {
    const d = centerWallClock(iso, clock.tz);
    return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
  };
  const diffLabel = (n: number) => (n === 0 ? t("cash.exact") : n < 0 ? t("cash.short") : t("cash.over"));
  const diffColor = (n: number) => (n === 0 ? "#1FA463" : "#B23A47");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>{t("cash.day")}</span>
        <DatePicker value={date} onChange={(v) => v && setDate(v)} style={{ width: 200 }} />
        <span style={{ fontSize: 12, color: "#686B75" }}>{clock.tz}</span>
      </div>

      {error !== null ? (
        <LoadError message={error} onRetry={load} />
      ) : !data || data.date !== date ? (
        <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 14 }}>
            <Tile label={t("cash.cashIn")} value={money(data.in.CASH.amount)} sub={t("cash.count").replace("{n}", String(data.in.CASH.count))} />
            <Tile label={t("cash.otherIn")} value={money(data.in.CLICK.amount + data.in.PAYME.amount + data.in.BANK_TRANSFER.amount)} />
            <Tile label={t("cash.cashOut")} value={money(data.out.CASH.amount)} danger={data.out.CASH.amount > 0} />
            <Tile label={t("cash.expected")} value={money(data.expectedCash)} accent />
          </div>

          {/* Closing */}
          <section style={card} aria-labelledby="cash-close">
            <div id="cash-close" style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("cash.closeTitle")}</div>
            {data.closed ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
                <div>
                  {t("cash.closedBy")}: <strong>{data.closed.closedBy ?? "—"}</strong>, {time(data.closed.closedAt)}
                </div>
                <div>
                  {t("cash.expected")}: <strong>{money(data.closed.expectedCash)}</strong> · {t("cash.counted")}: <strong>{money(data.closed.countedCash)}</strong>
                </div>
                <div style={{ color: diffColor(data.closed.difference), fontWeight: 800 }}>
                  {t("cash.difference")}: {data.closed.difference > 0 ? "+" : ""}{money(data.closed.difference)} ({diffLabel(data.closed.difference)})
                </div>
                {data.closed.note && <div style={{ color: "#4A4E58" }}>“{data.closed.note}”</div>}
                {data.closed.changedAfterClosing !== 0 && (
                  <div role="alert" style={{ background: "#FEF3C7", color: "#B45309", borderRadius: 10, padding: "8px 12px", fontWeight: 700 }}>
                    {t("cash.changedAfter").replace("{sum}", money(data.closed.changedAfterClosing))}
                  </div>
                )}
              </div>
            ) : canClose ? (
              <form onSubmit={onClose} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>
                  {t("cash.counted")}
                  <input className="field-input" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))} style={{ marginTop: 6 }} />
                </label>
                {counted !== "" && Number.isInteger(Number(counted)) && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: diffColor(Number(counted) - data.expectedCash) }}>
                    {t("cash.difference")}: {Number(counted) - data.expectedCash > 0 ? "+" : ""}{money(Number(counted) - data.expectedCash)} ({diffLabel(Number(counted) - data.expectedCash)})
                  </div>
                )}
                <input className="field-input" placeholder={t("cash.notePh")} aria-label={t("cash.notePh")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                {closeError && <div role="alert" style={{ color: "#B23A47", fontSize: 13, fontWeight: 600 }}>{closeError}</div>}
                <button type="submit" className="btn" disabled={closing} style={{ background: ACCENT, color: "#fff", border: "none", fontWeight: 700, fontSize: 13.5, padding: "10px 16px", borderRadius: 10, alignSelf: "flex-start" }}>
                  {closing ? t("common.saving") : t("cash.closeBtn")}
                </button>
                <div style={{ fontSize: 11.5, color: "#686B75" }}>{t("cash.closeHint")}</div>
              </form>
            ) : (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("cash.closeHint")}</div>
            )}
          </section>

          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("cash.byCashier")}</div>
            {data.byCashier.length === 0 ? (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("cash.none")}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr><th /><th>{t("cash.cash")}</th><th>{t("cash.other")}</th><th>#</th></tr>
                  </thead>
                  <tbody>
                    {data.byCashier.map((c) => (
                      <tr key={c.userId ?? "none"}>
                        <td style={{ fontWeight: 700 }}>{c.name ?? t("cash.unknownCashier")}</td>
                        <td>{money(c.cash)}</td>
                        <td>{money(c.other)}</td>
                        <td>{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("cash.payments")}</div>
            {data.payments.length === 0 ? (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("cash.none")}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{time(p.paidAt)}</td>
                        <td style={{ fontWeight: 600 }}>{p.studentName}</td>
                        <td style={{ fontWeight: 700 }}>{money(p.amount)}</td>
                        <td>{p.method === "CASH" ? t("cash.cash") : METHOD_LABEL[p.method] ?? p.method}</td>
                        <td style={{ color: "#686B75" }}>{p.recordedByName ?? t("cash.unknownCashier")}</td>
                        <td>{p.afterClosing && <span className="badge badge-warning">{t("cash.afterClosing")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("cash.expenses")}</div>
            {data.expenses.length === 0 ? (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("cash.none")}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <tbody>
                    {data.expenses.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.title}</td>
                        <td style={{ fontWeight: 700 }}>{money(e.amount)}</td>
                        <td>{e.paymentMethod === "CASH" ? t("cash.cash") : METHOD_LABEL[e.paymentMethod] ?? e.paymentMethod}</td>
                        <td>{e.afterClosing && <span className="badge badge-warning">{t("cash.afterClosing")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {history.length > 0 && (
            <section style={card}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{t("cash.history")}</div>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.date} onClick={() => setDate(h.date)} style={{ cursor: "pointer" }}>
                        <td style={{ fontWeight: 700 }}>{h.date}</td>
                        <td>{money(h.expectedCash)}</td>
                        <td>{money(h.countedCash)}</td>
                        <td style={{ color: diffColor(h.difference), fontWeight: 700 }}>{h.difference > 0 ? "+" : ""}{money(h.difference)}</td>
                        <td style={{ color: "#686B75" }}>{h.closedBy ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, danger, accent }: { label: string; value: string; sub?: string; danger?: boolean; accent?: boolean }) {
  return (
    <div style={{ background: accent ? "#ECEBFB" : "#fff", border: `1px solid ${accent ? "#D7D3F8" : "#EAE8E2"}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 12, color: accent ? ACCENT : "#686B75" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: danger ? "#B23A47" : accent ? ACCENT : "#181A1F" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#686B75", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
