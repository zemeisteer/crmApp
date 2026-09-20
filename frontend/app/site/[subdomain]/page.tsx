"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { tenantsApi, Tenant } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

type PublicTenant = Pick<Tenant, "id" | "name" | "subdomain" | "accentColor" | "plan">;

export default function PublicSitePage() {
  const { t, lang } = useLanguage();
  const params = useParams<{ subdomain: string }>();
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantsApi
      .bySubdomain(params.subdomain)
      .then(setTenant)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [params.subdomain]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
      </div>
    );
  }

  if (notFound || !tenant) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{t("publicSite.centerNotFound")}</div>
        <Link href="/" style={{ color: "#4F46E5", fontWeight: 600 }}>
          {t("publicSite.backToHome")}
        </Link>
      </div>
    );
  }

  const accent = tenant.accentColor || "#4F46E5";

  return (
    <div style={{ minHeight: "100vh", background: "#F7F7F5", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ padding: "24px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #EAE8E2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800 }}>
            {tenant.name.slice(0, 1).toUpperCase()}
          </div>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 18 }}>{tenant.name}</span>
        </div>
        <Link
          href={`/login`}
          style={{ fontWeight: 700, fontSize: 13.5, color: accent, border: `1px solid ${accent}`, padding: "8px 18px", borderRadius: 9 }}
        >
          {t("auth.login")}
        </Link>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "'Manrope', sans-serif", fontSize: 38, fontWeight: 800, lineHeight: 1.2 }}>
          {lang === "UZ" ? `${tenant.name}ga xush kelibsiz` : `${t("publicSite.welcomeSuffix")} ${tenant.name}`}
        </h1>
        <p style={{ fontSize: 16, color: "#4A4E58", marginTop: 16, lineHeight: 1.6 }}>
          {t("publicSite.description")}
        </p>
        <div
          style={{
            display: "inline-block",
            marginTop: 28,
            background: "#fff",
            border: `1px solid ${accent}`,
            color: accent,
            fontWeight: 700,
            fontSize: 15,
            padding: "14px 32px",
            borderRadius: 12,
          }}
        >
          {t("publicSite.contactCta")}
        </div>
      </div>

      <div style={{ textAlign: "center", padding: 24, color: "#8A8D96", fontSize: 12.5 }}>
        © {new Date().getFullYear()} {tenant.name}. {t("publicSite.poweredBy")}
      </div>
    </div>
  );
}
