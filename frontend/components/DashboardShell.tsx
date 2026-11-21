"use client";

import { useEffect, useRef, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import Sidebar, { canOpenPath, isPlatformMode, pathNotInPlan, PLATFORM_HOME } from "./Sidebar";
import TwoFactorGate from "./TwoFactorGate";
import AppTopBar from "./AppTopBar";
import CallPopup from "./telephony/CallPopup";
import { formatDate } from "@/lib/format-date";
import type { TranslationKey } from "@/lib/i18n";

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
  const { user, tenant, loading, refreshMe } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Coming back to the tab reads the account again (at most once a minute),
  // so a plan the platform admin changed meanwhile shows without a reload.
  const lastRefresh = useRef(Date.now());
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRefresh.current < 60_000) return;
      lastRefresh.current = Date.now();
      void refreshMe().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshMe]);

  useEffect(() => {
    if (!loading && !user) {
      // The platform panel comes back to the page asked for after sign-in
      // (and stays on the main site: lib/auth-context.tsx platformTarget).
      const admin = pathname === "/admin" || pathname.startsWith("/admin/");
      router.replace(admin ? `/login?next=${encodeURIComponent(pathname + window.location.search)}` : "/login");
    }
  }, [loading, user, router, pathname]);

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
          ) : misplaced ? null : tenant && pathNotInPlan(pathname, tenant.entitlements) ? (
            <div role="alert" data-testid="not-in-plan" style={{ flex: 1, display: "grid", placeContent: "center", justifyItems: "center", gap: 10, padding: 24, textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>
                {t("shell.notInPlanTitle").replace("{feature}", t(`pricing.ent.${pathNotInPlan(pathname, tenant.entitlements)}` as TranslationKey))}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 420 }}>{t("shell.notInPlanText")}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
                <Link href="/pricing" className="btn-primary">{t("shell.notInPlanCta")}</Link>
                <Link href="/dashboard" className="btn-ghost">{t("shell.noAccessBack")}</Link>
              </div>
            </div>
          ) : canOpenPath(pathname, user.role, !!tenant, user.access) ? (
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
      {/* The incoming-call popup (telephony), for a center's staff. */}
      {tenant && !platformMode && <CallPopup />}
    </div>
  );
}
