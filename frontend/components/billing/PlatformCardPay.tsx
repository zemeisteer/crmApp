"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, platformBillingApi, type PlatformCardView } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { fileFingerprint, newKey } from "@/lib/send-key";

const ACCENT = "var(--primary)";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);

/** The picture's content hash (what the server compares); name, size and date where hashing is unavailable. */

/**
 * Paying the platform by card transfer: the platform's card, the tariff's
 * amount, a picture of the receipt. The platform admin checks it and the
 * paid time is extended; until then it shows as being checked.
 */
export default function PlatformCardPay({
  cards,
  plan,
  planName,
  amount,
  forMonth,
  onSent,
}: {
  cards: PlatformCardView["cards"];
  plan: string;
  planName: string;
  amount: number;
  forMonth: string;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const [chosen, setChosen] = useState(cards[0].number);
  // The list may have changed under an open page: what is shown is always one of today's cards.
  const card = cards.find((c) => c.number === chosen) ?? cards[0];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // One key per send, tied to what it carries (tariff, note, the picture's
  // content): retrying the same thing after a timeout or a lost answer keeps
  // the key, so the server returns the receipt already made; changing the
  // picture, the note or the tariff is a new send with a new key.
  const sendKey = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(card.number.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the number stays visible to copy by hand */
    }
  }

  async function submit() {
    if (!file) return setError(t("ct.needFile"));
    setBusy(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([plan, note.trim(), card.number, await fileFingerprint(file)]);
      if (sendKey.current?.fingerprint !== fingerprint) sendKey.current = { fingerprint, key: newKey() };
      const r = await platformBillingApi.sendCardClaim({ plan, note: note.trim() || undefined, cardNumber: card.number, file, idempotencyKey: sendKey.current.key });
      // The same send replayed after it was decided (an old tab): say so, never "sent".
      if (r.status === "REJECTED") {
        sendKey.current = null;
        return setError(t("pcp.err.replayRejected"));
      }
      onSent();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const code = e.body?.code;
        // KEY_REUSED cannot normally happen (the key follows the content); start over with a new key.
        if (code === "KEY_REUSED") sendKey.current = null;
        // PENDING: an earlier send (perhaps one whose answer was lost) is already being checked.
        setError(code === "PENDING" ? t("pcp.err.pendingExists") : e.message);
        return;
      }
      // A lost connection: the same key on "send" again cannot make a second receipt.
      setError(e instanceof ApiError ? (e.status === 0 ? t("pcp.err.sendNetwork") : e.message) : t("pcp.err.sendNetwork"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="platform-card-pay">
      {cards.length > 1 && (
        <div role="radiogroup" aria-label={t("pcp.chooseCard")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>{t("pcp.chooseCard")}</div>
          {cards.map((c) => (
            <label key={c.number} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", padding: "9px 12px", borderRadius: "var(--radius-sm)", border: `1.5px solid ${c.number === card.number ? "var(--primary)" : "var(--border)"}`, background: c.number === card.number ? "var(--primary-soft)" : "var(--surface)" }}>
              <input type="radio" name="platform-card" checked={c.number === card.number} onChange={() => setChosen(c.number)} />
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>•••• {c.number.slice(-4)}</span>
              <span style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: 12 }}>{c.holder}</span>
            </label>
          ))}
        </div>
      )}
      <div style={{ borderRadius: "var(--radius-lg)", padding: 16, color: "var(--on-ink)", background: "linear-gradient(135deg, var(--ink), var(--ink))" }}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>{t("ct.cardNumber")}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>{card.number}</div>
          <button type="button" onClick={copy} style={{ background: "rgba(255,255,255,0.15)", color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-xs)", padding: "6px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            {copied ? `✓ ${t("ct.copied")}` : t("ct.copy")}
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>{t("ct.holder")}</div>
        <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase" }}>{card.holder}</div>
      </div>

      <div style={{ fontSize: 13, background: "var(--primary-soft)", border: "1px solid var(--primary-border)", borderRadius: "var(--radius-sm)", padding: "10px 12px", lineHeight: 1.6 }}>
        {t("pcp.amountLine").replace("{plan}", planName).replace("{month}", forMonth)} <b>{money(amount)} {t("common.sumUnit")}</b>
      </div>

      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
        <li>{t("pcp.step1")}</li>
        <li>{t("ct.step2")}</li>
        <li>{t("pcp.step3")}</li>
      </ol>

      <label style={{ display: "flex", alignItems: "center", gap: 12, border: `1.5px dashed ${file ? "var(--success)" : "var(--border-strong)"}`, background: file ? "var(--success-soft)" : "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: 12, cursor: "pointer", position: "relative" }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: "var(--radius-xs)" }} />
        ) : (
          <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "var(--radius-xs)", background: "var(--primary-soft)", display: "grid", placeItems: "center", fontSize: 22 }}>{file ? "📄" : "📎"}</span>
        )}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: file ? "var(--success)" : ACCENT }}>{file ? t("ct.fileChosen") : t("ct.pickFile")}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : t("ct.pickHint")}</span>
        </span>
      </label>
      <input className="field-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pcp.noteHint")} aria-label={t("ct.note")} />
      {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>}
      <button type="button" className="btn" onClick={submit} disabled={busy} style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)", border: "none" }}>
        {busy ? t("common.loading") : t("ct.send")}
      </button>
    </div>
  );
}
