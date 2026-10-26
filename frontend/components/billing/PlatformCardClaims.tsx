"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, getToken, platformApi, type PlatformCardClaim } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
type Filter = "PENDING" | "CONFIRMED" | "REJECTED";

/** A receipt fetched with the admin's sign-in (it is never a public file). */
function useReceipt(id: string | null) {
  const [url, setUrl] = useState<{ src: string; pdf: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let made: string | null = null;
    const token = getToken();
    fetch(`${API_URL}/platform/card-claims/${id}/receipt`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!alive || !b) return;
        made = URL.createObjectURL(b);
        setUrl({ src: made, pdf: b.type === "application/pdf" });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}

/**
 * Centers' subscription payments by card transfer: the platform admin checks
 * the money arrived and confirms (the center's paid time grows by a month)
 * or rejects with a reason the center sees.
 */
export default function PlatformCardClaims() {
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [data, setData] = useState<{ pending: number; card: { number: string; holder: string } | null; items: PlatformCardClaim[] } | null>(null);
  const [open, setOpen] = useState<PlatformCardClaim | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    platformApi
      .cardClaims(filter)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [filter, t]);
  useEffect(load, [load]);

  const chip = (active: boolean): React.CSSProperties => ({ background: active ? ACCENT : "#fff", color: active ? "#fff" : "#4A4E58", border: `1px solid ${active ? ACCENT : "#EAE8E2"}`, borderRadius: 100, padding: "7px 14px", fontSize: 13, fontWeight: 700 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="platform-card-claims-admin">
      <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.55, maxWidth: 760 }}>{t("pcp.adminHint")}</div>
      {data && !data.card && <div role="note" style={{ fontSize: 13, color: "#B45309", background: "#FFF7E6", borderRadius: 10, padding: "10px 14px" }}>{t("pcp.noCard")}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["PENDING", "CONFIRMED", "REJECTED"] as const).map((f) => (
          <button key={f} type="button" className="btn" onClick={() => setFilter(f)} style={chip(filter === f)}>
            {t(`cc.f.${f}`)}
            {f === "PENDING" && data && data.pending > 0 ? ` · ${data.pending}` : ""}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13 }}>{error}</div>}
      {data && data.items.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 24, textAlign: "center", color: "#686B75", fontSize: 14 }}>
          {filter === "PENDING" ? t("cc.nonePending") : t("cc.none")}
        </div>
      )}
      {data && data.items.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t("pf.sub.colCenter")}</th>
                <th>{t("pf.sub.colPlan")}</th>
                <th>{t("cc.month")}</th>
                <th style={{ textAlign: "right" }}>{t("ct.amount")}</th>
                <th>{t("cc.sent")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.centerName}</div>
                    <div style={{ fontSize: 11.5, color: "#686B75" }}>{c.subdomain}</div>
                  </td>
                  <td>{c.plan}</td>
                  <td>{c.forMonth}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.amount)}</td>
                  <td style={{ fontSize: 12.5, color: "#686B75" }}>
                    {formatDateTime(c.createdAt, lang)}
                    {c.status !== "PENDING" && <div style={{ fontWeight: 700, color: c.status === "CONFIRMED" ? "#16794A" : "#B23A47" }}>{t(`cc.f.${c.status}`)}{c.reviewedBy ? ` · ${c.reviewedBy}` : ""}</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn" onClick={() => setOpen(c)} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}>
                      {c.status === "PENDING" ? t("pcp.check") : t("pcp.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <ClaimModal
          claim={open}
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

function ClaimModal({ claim, onClose, onDone }: { claim: PlatformCardClaim; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useLanguage();
  const receipt = useReceipt(claim.id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = claim.status === "PENDING";

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
    <Modal open onClose={onClose} title={`💳 ${claim.centerName}`} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6 }}>
          {claim.plan} · {t("cc.month")}: <b>{claim.forMonth}</b> · <b>{money(claim.amount)} {t("common.sumUnit")}</b> · {formatDateTime(claim.createdAt, lang)}
        </div>
        {claim.note && <div style={{ fontSize: 13, background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>💬 {claim.note}</div>}
        <div style={{ background: "#F7F6F2", borderRadius: 12, padding: 8, display: "grid", placeItems: "center", minHeight: 160 }}>
          {!receipt ? (
            <span style={{ color: "#686B75", fontSize: 13 }}>{t("common.loading")}</span>
          ) : receipt.pdf ? (
            <a href={receipt.src} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: ACCENT }}>📄 {t("cc.openPdf")}</a>
          ) : (
            <a href={receipt.src} target="_blank" rel="noreferrer" title={t("cc.openFull")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receipt.src} alt={t("cc.receipt")} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, display: "block" }} />
            </a>
          )}
        </div>
        {claim.status === "REJECTED" && claim.rejectReason && <div style={{ fontSize: 13, color: "#B23A47" }}>{t("cc.f.REJECTED")}: {claim.rejectReason}</div>}
        {pending && rejecting && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#4A4E58" }}>
            {t("cc.reason")}
            <textarea className="field-input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cc.reasonHint")} autoFocus />
          </label>
        )}
        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {pending && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!rejecting ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => window.confirm(t("pcp.confirmQ").replace("{center}", claim.centerName)) && void run(() => platformApi.confirmCardClaim(claim.id))}
                  style={{ background: "#16794A", color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
                >
                  ✓ {t("pcp.confirm")}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setRejecting(true)} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
                  ✕ {t("cc.reject")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => run(() => platformApi.rejectCardClaim(claim.id, reason.trim()))} style={{ background: "#B23A47", color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
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
