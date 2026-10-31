"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Pagination from "@/components/Pagination";
import { ApiError, platformApi, type PlatformCardClaim } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";

const ACCENT = "var(--primary)";
const PAGE_SIZE = 20;
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
type Filter = "PENDING" | "CONFIRMED" | "REJECTED";
type Receipt =
  | { state: "loading" }
  | { state: "ready"; src: string; pdf: boolean }
  | { state: "error"; status: number; message: string };

/** What went wrong, in words the admin can act on. */
function errorKey(status: number): TranslationKey {
  if (status === 0) return "pcp.err.network";
  if (status === 401) return "pcp.err.session";
  if (status === 403) return "pcp.err.forbidden";
  if (status === 404) return "pcp.err.notFound";
  return "pcp.err.other";
}

/**
 * The receipt of one claim, fetched with the admin's sign-in (with the
 * usual silent refresh; it is never a public file). A request for another
 * claim, or a closed window, cancels this one: a late answer never lands in
 * the wrong window.
 */
function useReceipt(id: string) {
  const [receipt, setReceipt] = useState<Receipt>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    let made: string | null = null;
    setReceipt({ state: "loading" });
    platformApi
      .cardClaimReceipt(id, ctrl.signal)
      .then((b) => {
        if (ctrl.signal.aborted) return;
        if (b.size === 0) return setReceipt({ state: "error", status: 422, message: "" });
        made = URL.createObjectURL(b);
        setReceipt({ state: "ready", src: made, pdf: b.type === "application/pdf" });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setReceipt({ state: "error", status: e instanceof ApiError ? e.status : 0, message: e instanceof ApiError ? e.message : "" });
      });
    return () => {
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, attempt]);
  return { receipt, retry: () => setAttempt((n) => n + 1) };
}

/**
 * Centers' subscription payments by card transfer: the platform admin checks
 * the money arrived and confirms (the center's paid time grows by a month)
 * or rejects with a reason the center sees. Waiting receipts come oldest
 * first, page by page, so none is pushed out of sight.
 */
export default function PlatformCardClaims({ onPendingChange }: { onPendingChange?: (n: number) => void }) {
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof platformApi.cardClaims>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PlatformCardClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    let current = true;
    setLoading(true);
    platformApi
      .cardClaims({ status: filter, page, pageSize: PAGE_SIZE })
      .then((d) => {
        if (!current) return;
        setData(d);
        setError(null);
        onPendingChange?.(d.pending);
      })
      .catch((e) => current && setError(e instanceof ApiError ? e.message : t("pcp.err.network")))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [filter, page, onPendingChange, t]);
  useEffect(() => load(), [load]);

  const chip = (active: boolean): React.CSSProperties => ({ background: active ? ACCENT : "var(--surface)", color: active ? "var(--on-ink)" : "var(--text-soft)", border: `1px solid ${active ? ACCENT : "var(--border)"}`, borderRadius: "var(--radius-pill)", padding: "7px 14px", fontSize: 13, fontWeight: 700 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="platform-card-claims-admin">
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, maxWidth: 760 }}>{t("pcp.adminHint")}</div>
      {data && !data.card && <div role="note" style={{ fontSize: 13, color: "var(--warning)", background: "var(--warning-soft)", borderRadius: "var(--radius-sm)", padding: "10px 14px" }}>{t("pcp.noCard")}</div>}
      <div role="tablist" aria-label={t("pcp.adminTab")} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["PENDING", "CONFIRMED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className="btn"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            style={chip(filter === f)}
          >
            {t(`cc.f.${f}`)}
            {f === "PENDING" && data && data.pending > 0 ? ` · ${data.pending}` : ""}
          </button>
        ))}
      </div>
      {notice && <div role="status" style={{ color: "var(--success)", background: "var(--success-soft)", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{notice}</div>}
      {error && (
        <div role="alert" style={{ color: "var(--danger)", background: "var(--danger-soft)", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontSize: 13, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {error}
          <button type="button" className="btn" onClick={load} style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-xs)", padding: "5px 10px", fontSize: 12.5, fontWeight: 700 }}>{t("pcp.retry")}</button>
        </div>
      )}
      {loading && !data && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</div>}
      {data && data.items.length === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          {filter === "PENDING" ? t("cc.nonePending") : t("cc.none")}
        </div>
      )}
      {data && data.items.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflowX: "auto", opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
          <table className="adm-table" style={{ minWidth: 640 }}>
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
                <tr key={c.id} data-testid="platform-card-claim">
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.centerName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{c.subdomain}</div>
                  </td>
                  <td>{c.plan}</td>
                  <td>{c.forMonth}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.amount)}</td>
                  <td style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    {formatDateTime(c.createdAt, lang)}
                    {c.status !== "PENDING" && <div style={{ fontWeight: 700, color: c.status === "CONFIRMED" ? "var(--success)" : "var(--danger)" }}>{t(`cc.f.${c.status}`)}{c.reviewedBy ? ` · ${c.reviewedBy}` : ""}</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn" onClick={() => { setNotice(null); setOpen(c); }} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}>
                      {c.status === "PENDING" ? t("pcp.check") : t("pcp.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE_SIZE && <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      {open && (
        <ClaimModal
          key={open.id}
          claim={open}
          onClose={() => setOpen(null)}
          onDone={(msg) => {
            setOpen(null);
            setNotice(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function ClaimModal({ claim, onClose, onDone }: { claim: PlatformCardClaim; onClose: () => void; onDone: (notice: string) => void }) {
  const { t, lang } = useLanguage();
  const { receipt, retry } = useReceipt(claim.id);
  const [broken, setBroken] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = claim.status === "PENDING";

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(done);
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 0 ? t("pcp.err.network") : e.message) : t("pcp.err.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`💳 ${claim.centerName}`} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="platform-card-claim-modal">
        <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
          {claim.plan} · {t("cc.month")}: <b>{claim.forMonth}</b> · <b>{money(claim.amount)} {t("common.sumUnit")}</b> · {formatDateTime(claim.createdAt, lang)}
        </div>
        {claim.note && <div style={{ fontSize: 13, background: "var(--primary-soft)", borderRadius: "var(--radius-xs)", padding: "8px 12px" }}>💬 {claim.note}</div>}
        <div style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: 8, display: "grid", placeItems: "center", minHeight: 160 }} aria-busy={receipt.state === "loading"}>
          {receipt.state === "loading" ? (
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("pcp.loadingReceipt")}</span>
          ) : receipt.state === "error" ? (
            <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
              {t(receipt.status === 422 ? "pcp.err.broken" : errorKey(receipt.status))}
              <button type="button" className="btn" onClick={retry} style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-xs)", padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>{t("pcp.retry")}</button>
            </div>
          ) : receipt.pdf ? (
            <a href={receipt.src} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: ACCENT }}>📄 {t("cc.openPdf")}</a>
          ) : broken ? (
            <div role="alert" style={{ color: "var(--danger)", fontSize: 13, textAlign: "center" }}>
              {t("pcp.err.broken")} <a href={receipt.src} download style={{ color: ACCENT, fontWeight: 700 }}>{t("pcp.download")}</a>
            </div>
          ) : (
            <a href={receipt.src} target="_blank" rel="noreferrer" title={t("cc.openFull")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receipt.src} alt={t("cc.receipt")} onError={() => setBroken(true)} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: "var(--radius-xs)", display: "block" }} />
            </a>
          )}
        </div>
        {claim.status === "REJECTED" && claim.rejectReason && <div style={{ fontSize: 13, color: "var(--danger)" }}>{t("cc.f.REJECTED")}: {claim.rejectReason}</div>}
        {pending && rejecting && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)" }}>
            {t("cc.reason")}
            <textarea className="field-input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cc.reasonHint")} autoFocus />
          </label>
        )}
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {pending && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!rejecting ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => window.confirm(t("pcp.confirmQ").replace("{center}", claim.centerName)) && void run(() => platformApi.confirmCardClaim(claim.id), t("pcp.doneConfirm").replace("{center}", claim.centerName))}
                  style={{ background: "var(--success)", color: "var(--on-ink)", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)" }}
                >
                  {busy ? t("common.saving") : `✓ ${t("pcp.confirm")}`}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setRejecting(true)} style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)" }}>
                  ✕ {t("cc.reject")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => run(() => platformApi.rejectCardClaim(claim.id, reason.trim()), t("pcp.doneReject").replace("{center}", claim.centerName))} style={{ background: "var(--danger)", color: "var(--on-ink)", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)" }}>
                  {busy ? t("common.saving") : t("cc.rejectSend")}
                </button>
                <button type="button" className="btn" onClick={() => setRejecting(false)} style={{ background: "transparent", color: "var(--text-soft)", fontSize: 13, fontWeight: 600, padding: "10px 16px", borderRadius: "var(--radius-sm)" }}>
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
