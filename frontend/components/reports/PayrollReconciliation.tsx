"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LoadError from "@/components/LoadError";
import { ApiError, salaryApi, type PayrollReconciliation, type PayrollReconciliationStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);

const STATUS: Record<PayrollReconciliationStatus, { key: TranslationKey; color: string; bg: string }> = {
  LIKELY_DOUBLE_COUNTED: { key: "recon.double", color: "#B23A47", bg: "#FDEBEC" },
  AMOUNT_MISMATCH: { key: "recon.mismatch", color: "#B45309", bg: "#FEF3C7" },
  NO_EXPENSE: { key: "recon.noExpense", color: "#4B5563", bg: "#F3F4F6" },
};

// Read-only list of salary records made before payouts were linked to
// expenses, next to the salary expenses they may duplicate. Shown only when
// the month has any; nothing here changes data.
export default function PayrollReconciliationPanel({ month }: { month: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<PayrollReconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    salaryApi
      .reconciliation(month)
      .then((r) => {
        if (mine !== seq.current) return;
        setData(r);
        setError(null);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : t("recon.loadError"));
      });
  }, [month, t]);

  useEffect(load, [load]);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!data || data.forMonth !== month) return null;
  if (data.items.length === 0 && data.expensesWithoutPayroll.length === 0) return null;

  return (
    <section style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }} aria-labelledby="recon-title">
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #EAE8E2" }}>
        <div id="recon-title" style={{ fontSize: 14, fontWeight: 700 }}>{t("recon.title")}</div>
        <p style={{ fontSize: 12, color: "#8A8D96", margin: "4px 0 0", lineHeight: 1.5 }}>{t("recon.hint")}</p>
        {data.totals.likelyDoubleCounted > 0 && (
          <p style={{ fontSize: 12.5, color: "#B23A47", fontWeight: 700, margin: "6px 0 0" }}>
            {t("recon.doubleTotal").replace("{sum}", money(data.totals.likelyDoubleCounted))}
          </p>
        )}
      </div>
      {data.items.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ paddingTop: 14 }}>{t("recon.teacher")}</th>
                <th style={{ paddingTop: 14 }}>{t("recon.recorded")}</th>
                <th style={{ paddingTop: 14 }}>{t("recon.expenses")}</th>
                <th style={{ paddingTop: 14 }}>{t("recon.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const st = STATUS[i.status];
                return (
                  <tr key={i.salaryPaymentId}>
                    <td style={{ fontWeight: 700 }}>{i.teacherName}</td>
                    <td>{money(i.recordedAmount)}</td>
                    <td>
                      {money(i.matchedExpenseTotal)}
                      {i.matchedExpenses.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "#8A8D96" }}>
                          {i.matchedExpenses.map((e) => `${e.date}: ${money(e.amount)}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ background: st.bg, color: st.color, padding: "3px 8px", borderRadius: 6, fontSize: 11.5, fontWeight: 700 }}>{t(st.key)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.expensesWithoutPayroll.length > 0 && (
        <div style={{ padding: "12px 20px", borderTop: "1px solid #EAE8E2", fontSize: 12.5, color: "#4A4E58" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("recon.expenseOnly").replace("{sum}", money(data.totals.expensesWithoutPayroll))}</div>
          {data.expensesWithoutPayroll.map((e) => (
            <div key={e.id}>{e.date} · {e.title} · {money(e.amount)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
