"use client";

import { useEffect, useState } from "react";
import { ApiError, cardPaymentsApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";
const MAX_CARDS = 10;
const LBL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)" };
/** "8600123412341234" -> "8600 1234 1234 1234" as it is typed. */
const formatCard = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");

type Row = { number: string; holder: string };
const blank = (): Row => ({ number: "", holder: "" });

/**
 * The cards students pay to by transfer (no business account needed): shown
 * in the student cabinet, where they pick the one they paid to and send a
 * picture of the receipt.
 */
export default function CardSettings() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [saved, setSaved] = useState<Row[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function show(cards: Row[]) {
    setSaved(cards);
    setRows(cards.length ? cards.map((c) => ({ ...c })) : [blank()]);
  }

  useEffect(() => {
    cardPaymentsApi
      .getCard()
      .then((r) => show(r.cards ?? (r.card ? [r.card] : [])))
      .catch(() => setSaved([]));
  }, []);

  const change = (at: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === at ? { ...r, ...patch } : r)));

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const list = clear ? [] : rows.filter((r) => r.number.trim() || r.holder.trim()).map((r) => ({ cardNumber: r.number, cardHolder: r.holder }));
      const r = await cardPaymentsApi.setCards(list);
      show(r.cards);
      setNotice(r.cards.length ? t("cs.saved") : t("cs.removed"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (saved === undefined) return null;
  const on = saved.length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="card-settings"
      style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>💳 {t("cs.title")}</b>
        <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: on ? "var(--success-soft)" : "var(--surface-muted)", color: on ? "var(--success)" : "var(--text-muted)" }}>
          {on ? t("pacc.connected") : t("pacc.off")}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {t("cs.hint")} {t("cs.many")}
      </div>
      {rows.map((r, i) => (
        <div key={i} data-testid="card-settings-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={LBL}>
            {t("cs.number")}
            <input
              className="field-input"
              inputMode="numeric"
              autoComplete="off"
              required
              pattern="\d{4} \d{4} \d{4} \d{4}"
              title={t("cs.numberTitle")}
              placeholder="8600 0000 0000 0000"
              value={r.number}
              onChange={(e) => change(i, { number: formatCard(e.target.value) })}
              style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0.5 }}
            />
          </label>
          <label style={LBL}>
            {t("cs.holder")}
            <input className="field-input" required maxLength={80} placeholder="ALI VALIYEV" value={r.holder} onChange={(e) => change(i, { holder: e.target.value })} />
          </label>
          {rows.length > 1 && (
            <button type="button" className="btn" onClick={() => setRows((prev) => prev.filter((_, at) => at !== i))} style={{ justifySelf: "start", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
              {t("cs.removeOne")}
            </button>
          )}
        </div>
      ))}
      {rows.length < MAX_CARDS && (
        <button type="button" className="btn" onClick={() => setRows((prev) => [...prev, blank()])} style={{ alignSelf: "flex-start", background: "var(--primary-soft)", color: "var(--primary)", border: "1px solid var(--primary-border)", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
          + {t("cs.add")}
        </button>
      )}
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
      {notice && <div role="status" style={{ color: "var(--success)", fontSize: 12.5, fontWeight: 600 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {on && (
          <button type="button" className="btn" disabled={busy} onClick={() => window.confirm(t("cs.confirmRemove")) && void save(true)} style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
            {t("cs.remove")}
          </button>
        )}
      </div>
    </form>
  );
}
