"use client";

import { useEffect, useState } from "react";
import { ApiError, cardPaymentsApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
const LBL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#4A4E58" };
/** "8600123412341234" -> "8600 1234 1234 1234" as it is typed. */
const formatCard = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");

/**
 * The card students pay to by transfer (no business account needed): shown
 * in the student cabinet, where they send a picture of the receipt.
 */
export default function CardSettings() {
  const { t } = useLanguage();
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [saved, setSaved] = useState<{ number: string; holder: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    cardPaymentsApi
      .getCard()
      .then((r) => {
        setSaved(r.card);
        setNumber(r.card?.number ?? "");
        setHolder(r.card?.holder ?? "");
      })
      .catch(() => setSaved(null));
  }, []);

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await cardPaymentsApi.setCard(clear ? { cardNumber: "", cardHolder: "" } : { cardNumber: number, cardHolder: holder });
      setSaved(r.card);
      if (clear) {
        setNumber("");
        setHolder("");
      }
      setNotice(clear ? t("cs.removed") : t("cs.saved"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (saved === undefined) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="card-settings"
      style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>💳 {t("cs.title")}</b>
        <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: saved ? "#E9F8EF" : "#F2F1EC", color: saved ? "#16794A" : "#686B75" }}>
          {saved ? t("pacc.connected") : t("pacc.off")}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.55 }}>{t("cs.hint")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
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
            value={number}
            onChange={(e) => setNumber(formatCard(e.target.value))}
            style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0.5 }}
          />
        </label>
        <label style={LBL}>
          {t("cs.holder")}
          <input className="field-input" required maxLength={80} placeholder="ALI VALIYEV" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </label>
      </div>
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
      {notice && <div role="status" style={{ color: "#16794A", fontSize: 12.5, fontWeight: 600 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {saved && (
          <button type="button" className="btn" disabled={busy} onClick={() => window.confirm(t("cs.confirmRemove")) && void save(true)} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}>
            {t("cs.remove")}
          </button>
        )}
      </div>
    </form>
  );
}
