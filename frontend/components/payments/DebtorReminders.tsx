"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import LoadError from "@/components/LoadError";
import { ApiError, notificationsApi, type DebtorReminderPreview, type DebtorReminderResult } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);

// Reminders to the month's debtors in two steps: first who would be reminded
// and how (nothing is sent), then the send. The server sends at most one
// reminder per student and day, so pressing again only reports "already".
export default function DebtorRemindersDialog({ forMonth, onClose }: { forMonth: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [data, setData] = useState<DebtorReminderPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebtorReminderResult | null>(null);

  const load = useCallback(() => {
    notificationsApi
      .debtorReminderPreview(forMonth)
      .then((p) => {
        setData(p);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t("drem.loadError")));
  }, [forMonth, t]);

  // Mounted only while open, so each opening starts from a fresh preview.
  useEffect(load, [load]);

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      setResult(await notificationsApi.sendDebtorReminders({ forMonth }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSending(false);
    }
  }

  const chip = (text: string, bg: string, fg: string) => (
    <span style={{ background: bg, color: fg, borderRadius: "var(--radius-xs)", padding: "4px 10px", fontSize: 12.5, fontWeight: 700 }}>{text}</span>
  );

  return (
    <Modal open onClose={onClose} title={t("drem.title").replace("{m}", forMonth)} width={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>{t("drem.hint")}</div>
        {loadError !== null ? (
          <LoadError message={loadError} onRetry={load} />
        ) : !data ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chip(`SMS: ${data.channels.sms ? t("drem.on") : t("drem.off")}`, data.channels.sms ? "var(--success-soft)" : "var(--danger-soft)", data.channels.sms ? "var(--success)" : "var(--danger)")}
              {chip(`Telegram: ${data.channels.telegram ? t("drem.on") : t("drem.off")}`, data.channels.telegram ? "var(--success-soft)" : "var(--danger-soft)", data.channels.telegram ? "var(--success)" : "var(--danger)")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chip(t("drem.willSend").replace("{n}", String(data.totals.reachable)), "var(--primary-soft)", ACCENT)}
              {chip(t("drem.already").replace("{n}", String(data.totals.remindedToday)), "var(--surface-muted)", "var(--text-soft)")}
              {chip(t("drem.unreachable").replace("{n}", String(data.totals.unreachable)), "var(--warning-soft)", "var(--warning)")}
            </div>

            {result && (
              <div role="status" style={{ background: "var(--success-soft)", color: "var(--success)", fontSize: 13, fontWeight: 700, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>
                {t("drem.result").replace("{s}", String(result.sent)).replace("{a}", String(result.alreadyToday)).replace("{u}", String(result.unreachable))}
              </div>
            )}
            {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>}

            {data.debtors.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("pay.noDebtors")}</div>
            ) : (
              <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                <table aria-label={t("drem.listLabel")}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>{t("drem.student")}</th>
                      <th style={{ textAlign: "right" }}>{t("drem.debt")}</th>
                      <th style={{ textAlign: "left" }}>{t("drem.via")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.debtors.map((d) => {
                      const via = [d.telegram ? "Telegram" : null, d.sms ? "SMS" : null].filter(Boolean).join(", ");
                      return (
                        <tr key={d.studentId}>
                          <td style={{ fontWeight: 600 }}>{d.fullName}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(d.debt)} {t("common.sumUnit")}</td>
                          <td style={{ fontSize: 12.5, color: d.remindedToday ? "var(--text-soft)" : via ? "var(--success)" : "var(--warning)" }}>
                            {d.remindedToday ? t("drem.sentToday") : via || t("drem.noContact")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {data.totals.reachable > 0 ? (
              <button type="button" className="btn" disabled={sending} onClick={() => void onSend()} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)" }}>
                {sending ? t("pay.sending") : t("drem.send").replace("{n}", String(data.totals.reachable))}
              </button>
            ) : (
              data.debtors.length > 0 && <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("drem.nothingToSend")}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
