"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

type Item = { id: string; label: string; value: string };

// The center's own fields it chose to show in the cabinet (label: value),
// read-only. Nothing is shown when there are none, or when they cannot be
// loaded (the rest of the cabinet does not depend on them).
export default function PortalCustomFields({ token }: { token: string | null }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    portalApi
      .customFields()
      .then((list) => alive && setItems(Array.isArray(list) ? list : []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (items.length === 0) return null;
  return (
    <section aria-labelledby="portal-cf-title" style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 16, marginTop: 14 }}>
      <h2 id="portal-cf-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{t("cf.portalTitle")}</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: "12px 16px", margin: 0 }}>
        {items.map((it) => (
          <div key={it.id} style={{ minWidth: 0 }}>
            <dt style={{ fontSize: 12.5, color: "#64748B" }}>{it.label}</dt>
            <dd style={{ margin: "3px 0 0", fontSize: 14.5, fontWeight: 600, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{it.value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
