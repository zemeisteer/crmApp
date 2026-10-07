"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import Sidebar, { canOpenPath, isPlatformMode } from "./Sidebar";

const ACCENT = "#4F46E5";

function TrialBanner() {
  const { tenant, user } = useAuth();
  const { t } = useLanguage();
  if (!tenant || user?.role === "SUPERADMIN") return null;

  if (tenant.status === "SUSPENDED") {
    return (
      <div style={{ background: "#FDEBEC", color: "#B23A47", padding: "10px 24px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
        {t("shell.accountSuspended")}{" "}
        <Link href="/settings" style={{ textDecoration: "underline" }}>
          {t("shell.activatePlan")}
        </Link>
        .
      </div>
    );
  }

  if (tenant.status === "TRIAL" && tenant.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= 3) {
      const expired = daysLeft <= 0;
      return (
        <div
          style={{
            background: expired ? "#FDEBEC" : "#FFF7E6",
            color: expired ? "#B23A47" : "#A15C00",
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {expired ? t("shell.trialExpired") : t("shell.trialEndsIn").replace("{n}", String(daysLeft))}{" "}
          <Link href="/settings" style={{ textDecoration: "underline" }}>
            {t("shell.choosePlan")}
          </Link>
        </div>
      );
    }
  }
  return null;
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { user, tenant, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The superadmin outside a center has no center pages: the platform
  // panel is their home.
  const platformMode = isPlatformMode(user?.role, !!tenant);
  const misplaced = platformMode && !canOpenPath(pathname, user?.role, false, user?.access);
  useEffect(() => {
    if (misplaced) router.replace("/admin");
  }, [misplaced, router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div style={{ display: "flex", background: "#F7F7F5", minHeight: "100vh" }}>
      {/* Keyboard users jump past the ~17 menu links straight to the page. */}
      <a href="#main-content" className="skip-link">{t("shell.skipToContent")}</a>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main id="main-content" tabIndex={-1} className="dashboard-content" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, outline: "none" }}>
        <button
          className="mobile-menu-btn btn"
          onClick={() => setMenuOpen(true)}
          aria-label={t("shell.menuAriaLabel")}
          style={{
            position: "fixed",
            top: 14,
            left: 14,
            zIndex: 40,
            background: "#12131A",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            width: 38,
            height: 38,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <TrialBanner />
        {misplaced ? null : canOpenPath(pathname, user.role, !!tenant, user.access) ? (
          children
        ) : (
          <div role="alert" style={{ flex: 1, display: "grid", placeContent: "center", justifyItems: "center", gap: 10, padding: 24, textAlign: "center" }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 17, fontWeight: 800 }}>{t("shell.noAccessTitle")}</div>
            <div style={{ fontSize: 13.5, color: "#686B75" }}>{t("shell.noAccessText")}</div>
            <Link href="/dashboard" style={{ marginTop: 6, background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10, textDecoration: "none" }}>
              {t("shell.noAccessBack")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
