"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { checklistApi, type ChecklistKey } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
// Where each step is done.
const HREF: Record<ChecklistKey, string> = {
  group: "/groups",
  students: "/students",
  attendance: "/groups",
  payment: "/payments",
  team: "/settings",
  telegram: "/settings",
  site: "/settings",
};

/**
 * The dashboard's "first steps" for a new center: what it has done so far
 * (from its own data) and a link to each step left. Hidden once everything
 * is done, or when the owner closes it (remembered in this browser).
 */
export default function FirstSteps() {
  const { t } = useLanguage();
  const { user, tenant } = useAuth();
  const [data, setData] = useState<Awaited<ReturnType<typeof checklistApi.get>> | null>(null);
  const [hidden, setHidden] = useState(true);
  const key = tenant ? `first-steps-hidden:${tenant.id}` : "";
  const admin = user?.role === "OWNER" || user?.role === "ADMIN";

  useEffect(() => {
    if (!admin || !key) return;
    let closed = false;
    try {
      closed = localStorage.getItem(key) === "1";
    } catch {
      closed = false;
    }
    setHidden(closed);
    if (!closed) checklistApi.get().then(setData).catch(() => setData(null));
  }, [admin, key]);

  if (!admin || hidden || !data || data.done === data.total) return null;
  return (
    <section className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="first-steps-title" data-testid="first-steps">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <h2 id="first-steps-title" style={{ fontSize: 16, fontWeight: 800 }}>{t("fs.title")}</h2>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{t("fs.progress").replace("{done}", String(data.done)).replace("{total}", String(data.total))}</div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {
              // private mode: hidden for this visit only
            }
            setHidden(true);
          }}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
        >
          {t("fs.hide")}
        </button>
      </div>
      <div role="progressbar" aria-labelledby="first-steps-title" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} style={{ height: 6, background: "var(--surface-muted)", borderRadius: "var(--radius-pill)" }}>
        <div style={{ height: 6, width: `${(data.done / data.total) * 100}%`, background: ACCENT, borderRadius: "var(--radius-pill)" }} />
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
        {data.items.map((i) => (
          <li key={i.key}>
            {i.done ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--success)", padding: "8px 10px" }}>
                <span aria-hidden="true">✓</span> <s style={{ color: "var(--text-muted)" }}>{t(`fs.${i.key}` as TranslationKey)}</s>
              </span>
            ) : (
              <Link href={HREF[i.key]} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text)", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textDecoration: "none" }}>
                <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: "var(--radius-pill)", border: "2px solid var(--text-faint)", display: "inline-block" }} />
                {t(`fs.${i.key}` as TranslationKey)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
