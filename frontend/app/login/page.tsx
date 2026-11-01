"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth, isWorkspaceSelection } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { ApiError, WorkspaceItem } from "@/lib/api";
import { centerHost, centerRedirectBase, forgetCenter, lastCenter, mainSiteUrl, subdomainFromHost } from "@/lib/domain";
import { useCenterFromHost } from "@/lib/use-center-host";

const ACCENT = "var(--primary)";

const ROLE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  OWNER: { bg: "var(--warning-soft)", color: "var(--warning)" },
  ADMIN: { bg: "var(--primary-soft)", color: "var(--primary)" },
  MANAGER: { bg: "var(--primary-soft)", color: "var(--primary)" },
  TEACHER: { bg: "var(--success-soft)", color: "var(--success)" },
  STUDENT: { bg: "var(--info-soft)", color: "var(--info)" },
  PARENT: { bg: "var(--pink-soft)", color: "var(--pink)" },
  RECEPTIONIST: { bg: "var(--violet-soft)", color: "var(--violet)" },
  ACCOUNTANT: { bg: "var(--warning-soft)", color: "var(--warning)" },
};

const ROLE_LABELS: Record<string, Record<"UZ" | "RU" | "EN", string>> = {
  OWNER: { UZ: "Markaz rahbari", RU: "Владелец", EN: "Owner" },
  ADMIN: { UZ: "Administrator", RU: "Администратор", EN: "Administrator" },
  MANAGER: { UZ: "Menejer", RU: "Менеджер", EN: "Manager" },
  TEACHER: { UZ: "O'qituvchi", RU: "Преподаватель", EN: "Teacher" },
  STUDENT: { UZ: "O'quvchi", RU: "Студент", EN: "Student" },
  PARENT: { UZ: "Ota-ona", RU: "Родитель", EN: "Parent" },
  RECEPTIONIST: { UZ: "Qabulxona", RU: "Ресепшн", EN: "Receptionist" },
  ACCOUNTANT: { UZ: "Hisobchi", RU: "Бухгалтер", EN: "Accountant" },
};

export default function LoginPage() {
  const { login, completeTwoFactorLogin, selectWorkspace, user, loading: authLoading } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On a center's own address the login belongs to that center. The main
  // address only offers the center a returning staff member last used -
  // it does not move them there by itself (signing in here works too: the
  // session is carried to the right center afterwards).
  const hostCenter = useCenterFromHost();
  const [lastCenterLink, setLastCenterLink] = useState<{ sub: string; url: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("main")) {
      forgetCenter();
      return;
    }
    if (subdomainFromHost(window.location.host)) return;
    const last = lastCenter();
    const base = last ? centerRedirectBase(last) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage, only after mount
    if (last && base) setLastCenterLink({ sub: last, url: `${base}/login` });
  }, []);

  // Already signed in on this center's address (sent here from the main
  // site, or an old bookmark): go on to the app instead of asking again.
  // Decided once, when the stored session has been checked.
  const sessionChecked = useRef(false);
  useEffect(() => {
    if (authLoading || sessionChecked.current) return;
    sessionChecked.current = true;
    if (!user || !subdomainFromHost(window.location.host)) return;
    if (new URLSearchParams(window.location.search).has("main")) return;
    window.location.replace(user.role === "STUDENT" || user.role === "PARENT" ? "/portal" : "/dashboard");
  }, [authLoading, user]);

  // 2FA state
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // Multiple workspaces selection state
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[] | null>(null);
  const [selectingTenantId, setSelectingTenantId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(emailOrPhone, password);
      if ("pendingToken" in res) {
        setPendingToken(res.pendingToken);
      } else if (isWorkspaceSelection(res)) {
        setWorkspaces(res.workspaces);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (lang === "UZ" ? "Kirishda xatolik yuz berdi" : lang === "RU" ? "Ошибка входа" : "Login failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectWorkspace(tenantId: string) {
    setError(null);
    setSelectingTenantId(tenantId);
    try {
      await selectWorkspace(tenantId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (lang === "UZ" ? "Ish joyiga ulanishda xatolik" : lang === "RU" ? "Ошибка подключения" : "Connection error"));
      setSelectingTenantId(null);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await completeTwoFactorLogin(pendingToken!, code);
      if (isWorkspaceSelection(res)) {
        setPendingToken(null);
        setWorkspaces(res.workspaces);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  // 2FA screen
  if (pendingToken) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <form onSubmit={onSubmitCode} style={{ width: 380, background: "var(--surface)", borderRadius: "var(--radius-lg)", padding: 32, display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 10px 25px rgba(0,0,0,0.05)" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t("twofa.title")}</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{t("twofa.subtitle")}</p>
          </div>
          {error && (
            <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>
          )}
          <input
            className="field-input"
            required
            autoFocus
            maxLength={11}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            aria-describedby="twofa-recovery-hint"
            style={{ textAlign: "center", fontSize: 22, letterSpacing: 8, height: 48 }}
          />
          <div id="twofa-recovery-hint" style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>{t("twofa.recoveryLoginHint")}</div>
          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: 13, borderRadius: "var(--radius-sm)" }}
          >
            {loading ? t("twofa.verifying") : t("twofa.confirm")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPendingToken(null);
              setCode("");
            }}
            style={{ background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, padding: 6 }}
          >
            {t("twofa.back")}
          </button>
        </form>
      </div>
    );
  }

  // Workspace Selection Screen
  if (workspaces && workspaces.length > 0) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, position: "relative" }}>
        {/* Top right language switch */}
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            zIndex: 10,
            display: "flex",
            gap: 4,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 3,
          }}
        >
          {(["UZ", "RU", "EN"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "6px 10px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                cursor: "pointer",
                background: lang === l ? "var(--ink)" : "transparent",
                color: lang === l ? "var(--on-ink)" : "var(--text-muted)",
                boxShadow: "none",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div
          style={{
            width: "100%",
            maxWidth: 480,
            background: "var(--surface)",
            borderRadius: "var(--radius-lg)",
            padding: "36px 32px",
            boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: "var(--radius-xs)", background: "var(--primary-soft)", color: ACCENT, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
              TalimCRM Workspace
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {t("auth.chooseWorkspace")}
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
              {t("auth.chooseWorkspaceSubtitle")}
            </p>
          </div>

          {error && (
            <div role="alert" style={{ background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--danger)", fontSize: 13.5, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {workspaces.map((ws) => {
              const badgeColor = ROLE_BADGE_COLORS[ws.role] || { bg: "var(--surface-muted)", color: "var(--text-soft)" };
              const roleLabel = ROLE_LABELS[ws.role]?.[lang] || ws.role;
              const isSelected = selectingTenantId === ws.tenantId;

              return (
                <button
                  key={ws.tenantId}
                  type="button"
                  id={`workspace-${ws.subdomain}`}
                  disabled={!!selectingTenantId}
                  onClick={() => handleSelectWorkspace(ws.tenantId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 18px",
                    borderRadius: "var(--radius-lg)",
                    border: isSelected ? `2px solid ${ACCENT}` : "1.5px solid var(--border)",
                    background: isSelected ? "var(--violet-soft)" : "var(--surface)",
                    cursor: selectingTenantId ? "not-allowed" : "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                  }}
                  onMouseEnter={(e) => {
                    if (!selectingTenantId) e.currentTarget.style.borderColor = ACCENT;
                  }}
                  onMouseLeave={(e) => {
                    if (!selectingTenantId && !isSelected) e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "var(--radius-sm)",
                        background: "linear-gradient(135deg, var(--primary), var(--violet))",
                        color: "var(--on-ink)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {ws.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                        {ws.name}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                        {centerHost(ws.subdomain)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: "var(--radius-pill)",
                        background: badgeColor.bg,
                        color: badgeColor.color,
                      }}
                    >
                      {roleLabel}
                    </span>
                    {isSelected ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke={ACCENT} strokeWidth="4" strokeDasharray="30 60" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
            <button
              type="button"
              onClick={() => {
                setWorkspaces(null);
                setPassword("");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("auth.signInDifferentUser")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Standard Login Screen
  return (
    <div className="auth-shell" style={{ minHeight: "100vh", display: "flex", position: "relative" }}>
      {/* Top right language switch */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          display: "flex",
          gap: 4,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 3,
        }}
      >
        {(["UZ", "RU", "EN"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 10px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              cursor: "pointer",
              background: lang === l ? "var(--ink)" : "transparent",
              color: lang === l ? "var(--on-ink)" : "var(--text-muted)",
              boxShadow: "none",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* LEFT: brand panel */}
      <div
        style={{
          flex: 1.1,
          background: "var(--accent-gradient)",
          color: "var(--on-accent)",
          // display comes from the class: hidden on phones, flex from md up.
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 48px",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
        className="hidden md:flex auth-hero"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 2 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "var(--radius-sm)",
              background: "var(--ink)", color: "var(--on-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 21, color: "var(--on-accent)", letterSpacing: "-0.02em" }}>
            TalimCRM
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 }}>
          <h1 style={{ fontSize: 36, lineHeight: 1.25, fontWeight: 600, color: "var(--on-accent)", letterSpacing: "-0.035em" }}>
            {t("auth.welcomeHero")}
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "var(--on-accent)", opacity: 0.85 }}>
            {t("auth.welcomeHeroSubtitle")}
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, fontSize: 13, color: "var(--on-accent)", opacity: 0.75 }}>
          TalimCRM &copy; {new Date().getFullYear()} — {t("auth.allRightsReserved")}
        </div>

        <div
          style={{
            position: "absolute",
            width: 460,
            height: 460,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.28), transparent 70%)",
            top: -120,
            right: -100,
            zIndex: 1,
          }}
        />
      </div>

      {/* RIGHT: login form */}
      <div className="auth-panel" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", padding: "32px 24px" }}>
        <form onSubmit={onSubmit} style={{ width: "100%", maxWidth: 390, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {hostCenter && (
              <div style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8, background: "var(--primary-soft)", color: ACCENT, fontWeight: 800, fontSize: 13.5, padding: "7px 12px", borderRadius: "var(--radius-pill)" }}>
                🏫 {hostCenter.name ?? hostCenter.subdomain}
              </div>
            )}
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>
              {t("auth.login")}
            </h2>
            <p style={{ fontSize: 14.5, color: "var(--text-muted)" }}>
              {hostCenter ? t("auth.loginCenterSubtitle").replace("{name}", hostCenter.name ?? hostCenter.subdomain) : t("auth.loginSubtitle")}
            </p>
            {!hostCenter && lastCenterLink && (
              <a href={lastCenterLink.url} style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 700, color: ACCENT, background: "var(--primary-soft)", padding: "7px 12px", borderRadius: "var(--radius-pill)", textDecoration: "none" }}>
                🏫 {t("auth.lastCenter").replace("{name}", lastCenterLink.sub)} →
              </a>
            )}
            {hostCenter && (
              <a href={`${mainSiteUrl()}/login?main=1`} style={{ fontSize: 12.5, color: "var(--text-muted)", textDecoration: "underline" }}>{t("auth.otherCenter")}</a>
            )}
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

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Field: Email or Phone */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-soft)",
                  marginBottom: 6,
                }}
              >
                {t("auth.emailOrPhone")}
              </label>
              <input
                id="login-identity-input"
                className="field-input"
                required
                placeholder={lang === "UZ" ? "azizbek@bilimdon.uz yoki +998901234567" : lang === "RU" ? "email@domain.com или +998901234567" : "email@domain.com or +998901234567"}
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: "var(--radius-sm)",
                  border: "1.5px solid var(--border)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Field: Password */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-soft)" }}>
                  {t("auth.password")}
                </label>
                <Link
                  href="/forgot-password"
                  id="forgot-password-link"
                  style={{ fontSize: 12.5, fontWeight: 600, color: ACCENT, textDecoration: "none" }}
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <input
                id="login-password-input"
                className="field-input"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: "var(--radius-sm)",
                  border: "1.5px solid var(--border)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <button
            id="login-submit-btn"
            className="btn"
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              height: 48,
              background: loading ? "var(--text-faint)" : ACCENT,
              color: "var(--on-ink)",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(79, 70, 229, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            {loading ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="30 60" />
                </svg>
                <span>{t("auth.loggingIn")}</span>
              </>
            ) : (
              <span>{t("auth.login")}</span>
            )}
          </button>

          <div
            style={{
              paddingTop: 14,
              borderTop: "1px solid var(--border)",
              textAlign: "center",
              fontSize: 13.5,
              color: "var(--text-muted)",
            }}
          >
            {t("auth.noAccount")}{" "}
            <Link
              href="/register"
              id="start-free-link"
              style={{ color: ACCENT, fontWeight: 700, textDecoration: "none" }}
            >
              {t("auth.tryFree")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
