"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth, isWorkspaceSelection } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { ApiError, WorkspaceItem } from "@/lib/api";

const ACCENT = "#4F46E5";

const ROLE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  OWNER: { bg: "#FEF3C7", color: "#92400E" },
  ADMIN: { bg: "#EEF2FF", color: "#3730A3" },
  MANAGER: { bg: "#E0E7FF", color: "#3730A3" },
  TEACHER: { bg: "#ECFDF5", color: "#065F46" },
  STUDENT: { bg: "#EFF6FF", color: "#1E40AF" },
  PARENT: { bg: "#FDF2F8", color: "#9D174D" },
  RECEPTIONIST: { bg: "#F3E8FF", color: "#6B21A8" },
  ACCOUNTANT: { bg: "#FFFBEB", color: "#78350F" },
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
  const { login, completeTwoFactorLogin, selectWorkspace } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      await completeTwoFactorLogin(pendingToken!, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  // 2FA screen
  if (pendingToken) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <form onSubmit={onSubmitCode} style={{ width: 380, background: "#fff", borderRadius: 16, padding: 32, display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 10px 25px rgba(0,0,0,0.05)" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t("twofa.title")}</h2>
            <p style={{ fontSize: 13, color: "#8A8D96", marginTop: 4 }}>{t("twofa.subtitle")}</p>
          </div>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <input
            className="field-input"
            required
            autoFocus
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            style={{ textAlign: "center", fontSize: 22, letterSpacing: 8, height: 48 }}
          />
          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 13, borderRadius: 10 }}
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
            style={{ background: "transparent", color: "#8A8D96", fontSize: 13, fontWeight: 600, padding: 6 }}
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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", padding: 24, position: "relative" }}>
        {/* Top right language switch */}
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            zIndex: 10,
            display: "flex",
            gap: 4,
            background: "#F2F1EC",
            borderRadius: 9,
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
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background: lang === l ? "#fff" : "transparent",
                color: lang === l ? "#181A1F" : "#8A8D96",
                boxShadow: lang === l ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
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
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "36px 32px",
            boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 8, background: "#EEF2FF", color: ACCENT, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
              CRMAPP WORKSPACE
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>
              {t("auth.chooseWorkspace")}
            </h2>
            <p style={{ fontSize: 14, color: "#6B7280", marginTop: 4 }}>
              {t("auth.chooseWorkspaceSubtitle")}
            </p>
          </div>

          {error && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FEE2E2", color: "#B91C1C", fontSize: 13.5, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {workspaces.map((ws) => {
              const badgeColor = ROLE_BADGE_COLORS[ws.role] || { bg: "#F3F4F6", color: "#374151" };
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
                    borderRadius: 14,
                    border: isSelected ? `2px solid ${ACCENT}` : "1.5px solid #E5E7EB",
                    background: isSelected ? "#F5F3FF" : "#FFFFFF",
                    cursor: selectingTenantId ? "not-allowed" : "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                  }}
                  onMouseEnter={(e) => {
                    if (!selectingTenantId) e.currentTarget.style.borderColor = ACCENT;
                  }}
                  onMouseLeave={(e) => {
                    if (!selectingTenantId && !isSelected) e.currentTarget.style.borderColor = "#E5E7EB";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
                        color: "#fff",
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
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>
                        {ws.name}
                      </div>
                      <div style={{ fontSize: 12.5, color: "#6B7280", marginTop: 2 }}>
                        {ws.subdomain}.crmapp.com
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 100,
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
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                color: "#6B7280",
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
    <div style={{ minHeight: "100vh", display: "flex", background: "#F7F7F5", position: "relative" }}>
      {/* Top right language switch */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          display: "flex",
          gap: 4,
          background: "#F2F1EC",
          borderRadius: 9,
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
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              background: lang === l ? "#fff" : "transparent",
              color: lang === l ? "#181A1F" : "#8A8D96",
              boxShadow: lang === l ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
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
          background: "linear-gradient(135deg, #090514 0%, #161033 50%, #20154D 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 48px",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
        className="hidden md:flex"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 2 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6366F1, #4F46E5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(79, 70, 229, 0.35)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 21, color: "#fff", letterSpacing: "-0.02em" }}>
            CRMAPP
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 }}>
          <h1 style={{ fontSize: 36, lineHeight: 1.25, fontWeight: 800, color: "#fff", letterSpacing: "-0.025em" }}>
            {t("auth.welcomeHero")}
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "#C4C2E0" }}>
            {t("auth.welcomeHeroSubtitle")}
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, fontSize: 13, color: "#8E8CA8" }}>
          CRMAPP &copy; {new Date().getFullYear()} — {t("auth.allRightsReserved")}
        </div>

        <div
          style={{
            position: "absolute",
            width: 460,
            height: 460,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.22), transparent 70%)",
            top: -120,
            right: -100,
            zIndex: 1,
          }}
        />
      </div>

      {/* RIGHT: login form */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", padding: "32px 24px" }}>
        <form onSubmit={onSubmit} style={{ width: "100%", maxWidth: 390, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "#111827", letterSpacing: "-0.03em" }}>
              {t("auth.login")}
            </h2>
            <p style={{ fontSize: 14.5, color: "#6B7280" }}>
              {t("auth.loginSubtitle")}
            </p>
          </div>

          {error && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FEE2E2",
                color: "#B91C1C",
                fontSize: 13.5,
                fontWeight: 600,
                padding: "12px 16px",
                borderRadius: 12,
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
                  color: "#374151",
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
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Field: Password */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
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
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
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
              background: loading ? "#9CA3AF" : ACCENT,
              color: "#FFFFFF",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 11,
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
              borderTop: "1px solid #F3F4F6",
              textAlign: "center",
              fontSize: 13.5,
              color: "#6B7280",
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
