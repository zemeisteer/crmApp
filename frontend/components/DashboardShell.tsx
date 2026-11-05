"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import Sidebar, { canOpenPath, isPlatformMode, PLATFORM_HOME } from "./Sidebar";
import TwoFactorGate from "./TwoFactorGate";
import AppTopBar from "./AppTopBar";
import { formatDate } from "@/lib/format-date";

const ACCENT = "var(--primary)";

/** A notice above the page (billing, trial): a rounded strip inside the frame. */
function Notice({ tone, children, role }: { tone: "danger" | "warning"; children: ReactNode; role?: "status" }) {
  return (
    <div role={role} className={`app-notice app-notice-${tone}`}>
      {children}
    </div>
  );
}

function TrialBanner() {
  const { tenant, user } = useAuth();
  const { t, lang } = useLanguage();
  if (!tenant || user?.role === "SUPERADMIN") return null;

  // Suspended for non-payment: paying lifts it at once.
  if (tenant.status === "SUSPENDED" && tenant.billing?.suspendedForNonPayment) {
    return (
      <Notice role="status" tone="danger">
        {t("billing.suspended")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("billing.payNow")}
        </Link>
      </Notice>
    );
  }

  // The paid period ran out: the center still works until the grace date.
  if (tenant.status === "PAST_DUE") {
    return (
      <Notice role="status" tone="warning">
        {t("billing.pastDue").replace("{date}", tenant.billing?.graceUntil ? formatDate(tenant.billing.graceUntil, lang) : "")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("billing.payNow")}
        </Link>
      </Notice>
    );
  }

  if (tenant.status === "SUSPENDED") {
    return (
      <Notice tone="danger">
        {t("shell.accountSuspended")}{" "}
        <Link href="/settings" style={{ textDecoration: "underline" }}>
          {t("shell.activatePlan")}
        </Link>
        .
      </Notice>
    );
  }

  // Locked: the page itself says so (TrialLocked), no banner on top.
  if (tenant.trial?.stage === "LOCKED") return null;

  // The trial ended: everything can be looked at, nothing changed, until the lock date.
  if (tenant.trial?.stage === "READ_ONLY") {
    return (
      <Notice role="status" tone="danger">
        {t("trial.readOnly").replace("{date}", tenant.trial.lockAt ? formatDate(tenant.trial.lockAt, lang) : "")}{" "}
        <Link href="/pricing" style={{ textDecoration: "underline" }}>
          {t("shell.choosePlan")}
        </Link>
      </Notice>
    );
  }

  if (tenant.status === "TRIAL" && tenant.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= 3) {
      const expired = daysLeft <= 0;
      return (
        <Notice tone={expired ? "danger" : "warning"}>
          {expired ? t("shell.trialExpired") : t("shell.trialEndsIn").replace("{n}", String(daysLeft))}{" "}
          <Link href="/settings" style={{ textDecoration: "underline" }}>
            {t("shell.choosePlan")}
          </Link>
        </Notice>
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
      <div role="alert" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 28, maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 12, textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>{t("trial.lockedTitle")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-soft)", lineHeight: 1.6, margin: 0 }}>{t("trial.lockedText")}</p>
        {purgeAt && (
          <p style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, lineHeight: 1.6, margin: 0 }}>
            {t("trial.purgeOn").replace("{date}", formatDate(purgeAt, lang))}
          </p>
        )}
        <Link href="/pricing" style={{ background: ACCENT, color: "var(--on-ink)", fontWeight: 700, fontSize: 14, padding: "12px 18px", borderRadius: "var(--radius-sm)", textDecoration: "none", marginTop: 6 }}>
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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div role="status" style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={`app-shell${platformMode ? " theme-platform" : ""}`}>
      {/* Keyboard users jump past the menu straight to the page. */}
      <a href="#main-content" className="skip-link">{t("shell.skipToContent")}</a>
      <div className="app-frame">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main id="main-content" tabIndex={-1} className="dashboard-content">
          <AppTopBar onMenu={() => setMenuOpen(true)} />
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
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>{t("shell.noAccessTitle")}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{t("shell.noAccessText")}</div>
              <Link href="/dashboard" className="btn-primary" style={{ marginTop: 6 }}>
                {t("shell.noAccessBack")}
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
