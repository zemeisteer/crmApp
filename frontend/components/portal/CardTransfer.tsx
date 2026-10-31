"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, portalApi, type PortalCardPayment } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "var(--primary)";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 };

/**
 * Paying to the center's card: the card to transfer to, then "I paid" with
 * a picture of the receipt. The center checks it and the payment appears in
 * the history; until then it shows as being checked.
 */
export default function CardTransfer({ debt, forMonth, onSent }: { debt: number; forMonth?: string; onSent?: () => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<PortalCardPayment | null>(null);
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // A thumbnail of the chosen picture, so the student sees it is the right one.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const load = useCallback(() => {
    portalApi.getCardPayment().then(setData).catch(() => setData(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (debt > 0 && !amount) setAmount(String(debt));
  }, [debt, amount]);

  if (!data?.card) return null;
  const pending = data.claims.filter((c) => c.status === "PENDING");

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.card!.number.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the number stays visible to copy by hand */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError(t("ct.needFile"));
    setBusy(true);
    setError(null);
    try {
      await portalApi.sendCardPayment({ amount: Number(amount), forMonth, note: note.trim() || undefined, file });
      setSent(true);
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      load();
      onSent?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }} data-testid="card-transfer">
      <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700 }}>💳 {t("ct.title")}</div>
      <div style={{ borderRadius: "var(--radius-lg)", padding: 16, color: "var(--on-ink)", background: "linear-gradient(135deg, var(--ink), var(--ink))" }}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>{t("ct.cardNumber")}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>{data.card.number}</div>
          <button type="button" onClick={copy} style={{ background: "rgba(255,255,255,0.15)", color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-xs)", padding: "6px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            {copied ? `✓ ${t("ct.copied")}` : t("ct.copy")}
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>{t("ct.holder")}</div>
        <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase" }}>{data.card.holder}</div>
      </div>

      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
        <li>{t("ct.step1")}</li>
        <li>{t("ct.step2")}</li>
        <li>{t("ct.step3")}</li>
      </ol>

      {sent && <div role="status" style={{ background: "var(--success-soft)", color: "var(--success)", borderRadius: "var(--radius-sm)", padding: "10px 12px", fontSize: 13, fontWeight: 600 }}>✓ {t("ct.sent")}</div>}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
          {t("ct.amount")}
          <input className="field-input" type="number" inputMode="numeric" min={1000} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
          {t("ct.receipt")}
          {/* A big target for a thumb: the picker opens the gallery or the camera. */}
          <label style={{ display: "flex", alignItems: "center", gap: 12, border: `1.5px dashed ${file ? "var(--success)" : "var(--border-strong)"}`, background: file ? "var(--success-soft)" : "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: 12, cursor: "pointer" }}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: "var(--radius-xs)" }} />
            ) : (
              <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "var(--radius-xs)", background: "var(--primary-soft)", display: "grid", placeItems: "center", fontSize: 22 }}>{file ? "📄" : "📎"}</span>
            )}
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 700, color: file ? "var(--success)" : ACCENT }}>{file ? t("ct.fileChosen") : t("ct.pickFile")}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : t("ct.pickHint")}</span>
            </span>
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
          {t("ct.note")}
          <input className="field-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ct.noteHint")} />
        </label>
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", minHeight: 46, borderRadius: "var(--radius-md)", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
          {busy ? t("common.loading") : t("ct.send")}
        </button>
      </form>

      {data.claims.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{t("ct.mine")}{pending.length ? ` · ${t("ct.checking")}: ${pending.length}` : ""}</div>
          {data.claims.slice(0, 5).map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "var(--surface-muted)" }}>
              <span>{money(c.amount)} · {formatDate(c.createdAt, lang)}</span>
              <span style={{ fontWeight: 700, color: c.status === "CONFIRMED" ? "var(--success)" : c.status === "REJECTED" ? "var(--danger)" : "var(--warning)" }}>
                {t(`ct.s.${c.status}`)}
                {c.status === "REJECTED" && c.rejectReason ? `: ${c.rejectReason}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
