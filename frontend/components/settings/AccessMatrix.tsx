"use client";

import { useCallback, useEffect, useState } from "react";
import LoadError from "@/components/LoadError";
import { ApiError, accessApi, type AccessMatrix } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ROLE_KEYS: Record<string, TranslationKey> = {
  OWNER: "role.owner",
  ADMIN: "role.admin",
  MANAGER: "role.manager",
  RECEPTIONIST: "role.receptionist",
  ACCOUNTANT: "role.accountant",
  TEACHER: "role.teacher",
};
const AREAS = ["students", "teaching", "admissions", "finance", "payroll", "center"] as const;

// Who can do what, by role - computed by the server from its own route
// rules, so it cannot say "yes" where the system says "no".
export default function AccessMatrixPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<AccessMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    accessApi
      .matrix()
      .then((m) => {
        setData(m);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t("acc.loadError")));
  }, [t]);
  useEffect(load, [load]);

  return (
    <section style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, marginTop: 20, maxWidth: 980 }} aria-labelledby="acc-title">
      <div id="acc-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("acc.title")}</div>
      <div style={{ fontSize: 12.5, color: "#8A8D96", marginBottom: 16, lineHeight: 1.5 }}>{t("acc.hint")}</div>
      {error !== null ? (
        <LoadError message={error} onRetry={load} />
      ) : !data ? (
        <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table aria-label={t("acc.title")}>
            <thead>
              <tr>
                <th />
                {data.roles.map((r) => (
                  <th key={r} scope="col" style={{ textAlign: "center", whiteSpace: "nowrap" }}>{t(ROLE_KEYS[r] ?? ("role.admin" as TranslationKey))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREAS.flatMap((area) => {
                const rows = data.capabilities.filter((c) => c.area === area);
                if (rows.length === 0) return [];
                return [
                  <tr key={area}>
                    <th colSpan={data.roles.length + 1} scope="colgroup" style={{ textAlign: "left", background: "#F7F7F5", fontSize: 12, color: "#4A4E58", paddingTop: 8, paddingBottom: 8 }}>
                      {t(`acc.area.${area}` as TranslationKey)}
                    </th>
                  </tr>,
                  ...rows.map((c) => (
                    <tr key={c.key}>
                      <th scope="row" style={{ textAlign: "left", fontWeight: 600, fontSize: 13 }}>
                        {t(`acc.cap.${c.key}` as TranslationKey)}
                        {c.note && <div style={{ fontSize: 11, color: "#8A8D96", fontWeight: 500 }}>{t(`acc.note.${c.note}` as TranslationKey)}</div>}
                      </th>
                      {data.roles.map((r) => (
                        <td key={r} style={{ textAlign: "center" }}>
                          {c.allowed[r] ? (
                            <span aria-label="✓" style={{ color: "#1FA463", fontWeight: 800 }}>✓</span>
                          ) : (
                            <span aria-label="—" style={{ color: "#C9C7C1" }}>—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
