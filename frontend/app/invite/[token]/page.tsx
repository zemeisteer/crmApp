"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { invitationsApi, Role, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";

const ROLE_LABELS: Record<string, TranslationKey> = {
  OWNER: "role.owner",
  ADMIN: "role.admin",
  MANAGER: "role.manager",
  TEACHER: "role.teacher",
  STUDENT: "role.student",
  PARENT: "role.parent",
  RECEPTIONIST: "role.receptionist",
  ACCOUNTANT: "role.accountant",
};

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const { user: activeUser, setAuthSession } = useAuth();
  const { t } = useLanguage();
  const roleLabel = (r?: string) => (r && ROLE_LABELS[r] ? t(ROLE_LABELS[r]) : r);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite details
  const [inviteData, setInviteData] = useState<{
    valid: boolean;
    role: Role;
    email: string | null;
    phone: string | null;
    tenantName: string;
    tenantSubdomain: string;
    expiresAt: string;
  } | null>(null);

  // Form for users
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    async function validate() {
      try {
        const res = await invitationsApi.validate(token);
        setInviteData(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("inv.invalidOrExpired"));
      } finally {
        setLoading(false);
      }
    }
    validate();
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!activeUser) {
      if (!fullName.trim()) {
        setError(t("inv.nameRequired"));
        return;
      }
      if (password.length < 6) {
        setError(t("inv.pwShort"));
        return;
      }
      if (confirmPassword && password !== confirmPassword) {
        setError(t("inv.pwMismatch"));
        return;
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await invitationsApi.accept(token, {
        fullName: fullName.trim() || undefined,
        password: password || undefined,
      });

      // Session established with correct tenant context and role!
      setAuthSession(
        {
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          user: res.user,
          tenant: res.tenant as any,
        },
        res.redirectUrl,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("inv.acceptError"));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={ACCENT} strokeWidth="4" strokeDasharray="30 60" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("inv.checking")}
          </div>
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)", padding: 24 }}>
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "var(--surface)",
            borderRadius: "var(--radius-lg)",
            padding: "36px 30px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ fontSize: 42 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
            {t("inv.invalid")}
          </h2>
          <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {error}
          </p>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              background: ACCENT,
              color: "var(--on-ink)",
              fontSize: 14.5,
              fontWeight: 700,
              padding: "12px 20px",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              marginTop: 6,
            }}
          >
            {t("inv.login")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)", padding: 24 }}>
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          padding: "38px 32px",
          boxShadow: "0 14px 34px rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Organization & Role Header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "var(--radius-lg)",
              background: "linear-gradient(135deg, var(--primary), var(--violet))",
              color: "var(--on-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 800,
              boxShadow: "0 6px 16px rgba(79, 70, 229, 0.25)",
            }}
          >
            {inviteData?.tenantName?.slice(0, 2).toUpperCase() || "CR"}
          </div>

          <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "var(--primary-soft)", padding: "4px 12px", borderRadius: "var(--radius-pill)", marginTop: 4 }}>
            {roleLabel(inviteData?.role)}
          </span>

          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", marginTop: 4 }}>
            {inviteData?.tenantName}
          </h2>

          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
            {t("inv.invitedAs1")} <strong>{roleLabel(inviteData?.role)}</strong> {t("inv.invitedAs2")}
          </p>
        </div>

        {error && (
          <div role="alert"
            style={{
              background: "var(--danger-soft)",
              border: "1px solid var(--danger-border)",
              color: "var(--danger)",
              fontSize: 13.5,
              fontWeight: 600,
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleAccept} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {activeUser ? (
            /* Active user join flow */
            <div
              style={{
                background: "var(--surface-muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>
                {t("inv.welcome")}, {activeUser.fullName || activeUser.email}!
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {t("inv.loggedInAs")} ({activeUser.email})
              </div>
            </div>
          ) : (
            /* New user registration flow */
            <>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>
                  {t("inv.fullName")}
                </label>
                <input
                  required
                  placeholder="Azizbek Sattorov"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1.5px solid var(--border)",
                    fontSize: 14.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>
                  {t("inv.newPw")}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder={t("inv.pwPh")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1.5px solid var(--border)",
                    fontSize: 14.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>
                  {t("inv.confirmPw")}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder={t("inv.confirmPwPh")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1.5px solid var(--border)",
                    fontSize: 14.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              height: 48,
              background: submitting ? "var(--text-faint)" : ACCENT,
              color: "var(--on-ink)",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: submitting ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(79, 70, 229, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 6,
            }}
          >
            {submitting ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="30 60" />
                </svg>
                <span>{t("inv.connecting")}</span>
              </>
            ) : (
              <span>{t("inv.accept")}</span>
            )}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-faint)" }}>
          TalimCRM &copy; {new Date().getFullYear()} — {t("inv.footer")}
        </div>
      </div>
    </div>
  );
}
