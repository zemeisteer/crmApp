"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import LoadError from "@/components/LoadError";
import { ApiError, notificationsApi, type DebtorReminderPreview, type DebtorReminderResult } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
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
    <span style={{ background: bg, color: fg, borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontWeight: 700 }}>{text}</span>
  );

  return (
    <Modal open onClose={onClose} title={t("drem.title").replace("{m}", forMonth)} width={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.5 }}>{t("drem.hint")}</div>
        {loadError !== null ? (
          <LoadError message={loadError} onRetry={load} />
        ) : !data ? (
          <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chip(`SMS: ${data.channels.sms ? t("drem.on") : t("drem.off")}`, data.channels.sms ? "#EBF8F2" : "#FDEBEC", data.channels.sms ? "#16794A" : "#B23A47")}
              {chip(`Telegram: ${data.channels.telegram ? t("drem.on") : t("drem.off")}`, data.channels.telegram ? "#EBF8F2" : "#FDEBEC", data.channels.telegram ? "#16794A" : "#B23A47")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chip(t("drem.willSend").replace("{n}", String(data.totals.reachable)), "#EEF2FF", ACCENT)}
              {chip(t("drem.already").replace("{n}", String(data.totals.remindedToday)), "#F3F4F6", "#4B5563")}
              {chip(t("drem.unreachable").replace("{n}", String(data.totals.unreachable)), "#FEF3C7", "#B45309")}
            </div>

            {result && (
              <div role="status" style={{ background: "#EBF8F2", color: "#167A48", fontSize: 13, fontWeight: 700, padding: "10px 14px", borderRadius: 10 }}>
                {t("drem.result").replace("{s}", String(result.sent)).replace("{a}", String(result.alreadyToday)).replace("{u}", String(result.unreachable))}
              </div>
            )}
            {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}

            {data.debtors.length === 0 ? (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("pay.noDebtors")}</div>
            ) : (
              <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #EAE8E2", borderRadius: 10 }}>
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
                          <td style={{ fontSize: 12.5, color: d.remindedToday ? "#4B5563" : via ? "#16794A" : "#B45309" }}>
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
              <button type="button" className="btn" disabled={sending} onClick={() => void onSend()} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}>
                {sending ? t("pay.sending") : t("drem.send").replace("{n}", String(data.totals.reachable))}
              </button>
            ) : (
              data.debtors.length > 0 && <div style={{ fontSize: 13, color: "#4A4E58" }}>{t("drem.nothingToSend")}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
