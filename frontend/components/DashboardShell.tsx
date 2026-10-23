"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import Sidebar, { canOpenPath, isPlatformMode, PLATFORM_HOME } from "./Sidebar";
import TwoFactorGate from "./TwoFactorGate";
import { formatDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";

function TrialBanner() {
  const { tenant, user } = useAuth();
  const { t, lang } = useLanguage();
  if (!tenant || user?.role === "SUPERADMIN") return null;

  // Suspended for non-payment: paying lifts it at once.
  if (tenant.status === "SUSPENDED" && tenant.billing?.suspendedForNonPayment) {
    return (
      <div role="status" style={{ background: "#FDEBEC", color: "#B23A47", padding: "10px 24px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
        {t("billing.suspended")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("billing.payNow")}
        </Link>
      </div>
    );
  }

  // The paid period ran out: the center still works until the grace date.
  if (tenant.status === "PAST_DUE") {
    return (
      <div role="status" style={{ background: "#FFF7E6", color: "#A15C00", padding: "10px 24px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
        {t("billing.pastDue").replace("{date}", tenant.billing?.graceUntil ? formatDate(tenant.billing.graceUntil, lang) : "")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("billing.payNow")}
        </Link>
      </div>
    );
  }

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

  // Locked: the page itself says so (TrialLocked), no banner on top.
  if (tenant.trial?.stage === "LOCKED") return null;

  // The trial ended: everything can be looked at, nothing changed, until the lock date.
  if (tenant.trial?.stage === "READ_ONLY") {
    return (
      <div role="status" style={{ background: "#FDEBEC", color: "#B23A47", padding: "10px 24px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
        {t("trial.readOnly").replace("{date}", tenant.trial.lockAt ? formatDate(tenant.trial.lockAt, lang) : "")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("shell.choosePlan")}
        </Link>
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

/** The trial ended and its read-only days too: only the plans and payment remain. */
function TrialLocked({ purgeAt }: { purgeAt: string | null }) {
  const { t, lang } = useLanguage();
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
      <div role="alert" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 28, maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 12, textAlign: "center" }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{t("trial.lockedTitle")}</h1>
        <p style={{ fontSize: 13.5, color: "#4A4E58", lineHeight: 1.6, margin: 0 }}>{t("trial.lockedText")}</p>
        {purgeAt && (
          <p style={{ fontSize: 13, color: "#B23A47", fontWeight: 600, lineHeight: 1.6, margin: 0 }}>
            {t("trial.purgeOn").replace("{date}", formatDate(purgeAt, lang))}
          </p>
        )}
        <Link href="/pricing" style={{ background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 14, padding: "12px 18px", borderRadius: 10, textDecoration: "none", marginTop: 6 }}>
          {t("shell.choosePlan")}
        </Link>
      </div>
    </div>
  );
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
    if (misplaced) router.replace(PLATFORM_HOME);
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
        {user.role === "SUPERADMIN" && user.twoFactorRequired && !user.sessionTwoFactor ? (
          // The platform pages open once two-step sign-in is on.
          <TwoFactorGate />
        ) : tenant?.trial?.stage === "LOCKED" && user.role !== "SUPERADMIN" && pathname !== "/pricing" ? (
          <TrialLocked purgeAt={tenant.trial.purgeAt} />
        ) : misplaced ? null : canOpenPath(pathname, user.role, !!tenant, user.access) ? (
          // Keyed by the address: each page opened fades in.
          <div key={pathname} className="page-enter" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {children}
          </div>
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
