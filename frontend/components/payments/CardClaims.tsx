"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { PrivateImg, PrivateLink } from "@/components/PrivateFile";
import { ApiError, cardPaymentsApi, type CardClaim } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
type Filter = "PENDING" | "CONFIRMED" | "REJECTED";

/**
 * Receipts students sent from the cabinet after paying to the center's card:
 * each is checked against the bank and confirmed (it becomes a payment) or
 * rejected with a reason the student sees.
 */
export default function CardClaims({ canDecide, onCount }: { canDecide: boolean; onCount?: (n: number) => void }) {
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [items, setItems] = useState<CardClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CardClaim | null>(null);

  const load = useCallback(() => {
    cardPaymentsApi
      .claims(filter)
      .then((r) => {
        setItems(r.items);
        onCount?.(r.pending);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [filter, onCount, t]);
  useEffect(load, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="card-claims">
      <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.55, maxWidth: 720 }}>{t("cc.hint")}</div>
      <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["PENDING", "CONFIRMED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className="btn"
            style={{ background: filter === f ? ACCENT : "#fff", color: filter === f ? "#fff" : "#4A4E58", border: `1px solid ${filter === f ? ACCENT : "#EAE8E2"}`, borderRadius: 100, padding: "7px 14px", fontSize: 13, fontWeight: 700 }}
          >
            {t(`cc.f.${f}`)}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13 }}>{error}</div>}
      {items && items.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 28, textAlign: "center", color: "#686B75", fontSize: 14 }}>
          {filter === "PENDING" ? t("cc.nonePending") : t("cc.none")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {items?.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpen(c)}
            data-testid="card-claim"
            style={{ textAlign: "left", background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 12, display: "flex", gap: 12, cursor: "pointer", font: "inherit" }}
          >
            <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 10, overflow: "hidden", background: "#F2F1EC", display: "grid", placeItems: "center" }}>
              {/\.pdf$/i.test(c.receiptFile) ? <span style={{ fontSize: 22 }}>📄</span> : <PrivateImg name={c.receiptFile} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <b style={{ fontSize: 14, color: "#181A1F" }}>{c.studentName}</b>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15 }}>{money(c.amount)} {t("common.sumUnit")}</span>
              <span style={{ fontSize: 12, color: "#686B75" }}>{c.forMonth} · {formatDateTime(c.createdAt, lang)}</span>
              {c.status !== "PENDING" && (
                <span style={{ fontSize: 12, fontWeight: 700, color: c.status === "CONFIRMED" ? "#16794A" : "#B23A47" }}>
                  {t(`cc.f.${c.status}`)}{c.reviewedBy ? ` · ${c.reviewedBy}` : ""}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {open && (
        <ClaimModal
          claim={open}
          canDecide={canDecide}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ClaimModal({ claim, canDecide, onClose, onDone }: { claim: CardClaim; canDecide: boolean; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useLanguage();
  const [amount, setAmount] = useState(String(claim.amount));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = claim.status === "PENDING";
  const isPdf = /\.pdf$/i.test(claim.receiptFile);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`💳 ${claim.studentName}`} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6 }}>
          {claim.studentPhone && <>{claim.studentPhone} · </>}
          {t("cc.month")}: <b>{claim.forMonth}</b> · {t("cc.sent")}: {formatDateTime(claim.createdAt, lang)}
          {claim.sentBy === "parent" && <> · {t("cc.byParent")}</>}
        </div>
        {claim.note && <div style={{ fontSize: 13, background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>💬 {claim.note}</div>}
        <div style={{ background: "#F7F6F2", borderRadius: 12, padding: 8, display: "grid", placeItems: "center", minHeight: 160 }}>
          {isPdf ? (
            <PrivateLink name={claim.receiptFile} style={{ fontWeight: 700, color: ACCENT }}>📄 {t("cc.openPdf")}</PrivateLink>
          ) : (
            <PrivateLink name={claim.receiptFile} title={t("cc.openFull")}>
              <PrivateImg name={claim.receiptFile} alt={t("cc.receipt")} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, display: "block" }} />
            </PrivateLink>
          )}
        </div>

        {pending && canDecide && !rejecting && (
          <>
            <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("cc.checkHint")}</div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#4A4E58", maxWidth: 260 }}>
              {t("cc.amountSeen")}
              <input className="field-input" type="number" inputMode="numeric" min={1000} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </>
        )}
        {pending && canDecide && rejecting && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#4A4E58" }}>
            {t("cc.reason")}
            <textarea className="field-input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cc.reasonHint")} autoFocus />
          </label>
        )}
        {claim.status === "REJECTED" && claim.rejectReason && <div style={{ fontSize: 13, color: "#B23A47" }}>{t("cc.f.REJECTED")}: {claim.rejectReason}</div>}
        {pending && !canDecide && <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("cc.noRight")}</div>}
        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13, fontWeight: 600 }}>{error}</div>}

        {pending && canDecide && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!rejecting ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !(Number(amount) >= 1000)}
                  onClick={() =>
                    run(async () => {
                      const r = await cardPaymentsApi.confirm(claim.id, Number(amount));
                      // A payment the earlier code had already recorded: its amount stands.
                      if (r.adopted && r.amount !== Number(amount)) window.alert(t("cc.adopted").replace("{amount}", money(r.amount)));
                    })
                  }
                  style={{ background: "#16794A", color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
                >
                  ✓ {t("cc.confirm").replace("{amount}", money(Number(amount) || 0))}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setRejecting(true)} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
                  ✕ {t("cc.reject")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => run(() => cardPaymentsApi.reject(claim.id, reason.trim()))} style={{ background: "#B23A47", color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
                  {t("cc.rejectSend")}
                </button>
                <button type="button" className="btn" onClick={() => setRejecting(false)} style={{ background: "transparent", color: "#4A4E58", fontSize: 13, fontWeight: 600, padding: "10px 16px", borderRadius: 9 }}>
                  {t("common.cancel")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
