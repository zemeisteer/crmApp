"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { invitationsApi, Role, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Markaz Rahbari (Owner)",
  ADMIN: "Administrator",
  MANAGER: "Menejer",
  TEACHER: "O'qituvchi (Teacher)",
  STUDENT: "O'quvchi (Student)",
  PARENT: "Ota-ona (Parent)",
  RECEPTIONIST: "Receptionist",
  ACCOUNTANT: "Hisobchi (Accountant)",
};

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();
  const { user: activeUser, setAuthSession } = useAuth();

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
        setError(err instanceof ApiError ? err.message : "Taklifnoma yaroqsiz yoki muddati tugagan");
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
        setError("Iltimos, to'liq ism-familiyangizni kiriting");
        return;
      }
      if (password.length < 6) {
        setError("Parol kamida 6 ta belgidan iborat bo'lishi kerak");
        return;
      }
      if (confirmPassword && password !== confirmPassword) {
        setError("Kiritilgan parollar bir-biriga mos kelmadi");
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
      setError(err instanceof ApiError ? err.message : "Taklifnomani qabul qilishda xatolik");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={ACCENT} strokeWidth="4" strokeDasharray="30 60" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#6B7280" }}>
            Taklifnoma tekshirilmoqda...
          </div>
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", padding: 24 }}>
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "36px 30px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ fontSize: 42 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>
            Taklifnoma yaroqsiz
          </h2>
          <p style={{ fontSize: 14.5, color: "#6B7280", lineHeight: 1.5 }}>
            {error}
          </p>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              background: ACCENT,
              color: "#FFFFFF",
              fontSize: 14.5,
              fontWeight: 700,
              padding: "12px 20px",
              borderRadius: 10,
              textDecoration: "none",
              marginTop: 6,
            }}
          >
            Tizimga kirish
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", padding: 24 }}>
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#FFFFFF",
          borderRadius: 22,
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
              borderRadius: 14,
              background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
              color: "#fff",
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

          <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "#EEF2FF", padding: "4px 12px", borderRadius: 100, marginTop: 4 }}>
            {ROLE_LABELS[inviteData?.role || ""] || inviteData?.role}
          </span>

          <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em", marginTop: 4 }}>
            {inviteData?.tenantName}
          </h2>

          <p style={{ fontSize: 14, color: "#6B7280" }}>
            Siz ushbu markazga <strong>{ROLE_LABELS[inviteData?.role || ""] || inviteData?.role}</strong> sifatida taklif qilindingiz.
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

        <form onSubmit={handleAccept} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {activeUser ? (
            /* Active user join flow */
            <div
              style={{
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: 14,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#1E293B" }}>
                Xush kelibsiz, {activeUser.fullName || activeUser.email}!
              </div>
              <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
                Siz tizimga {activeUser.email} sifatida kirdingiz. Yangi profil yaratilmaydi — markaz sizning mavjud profilingizga bog&apos;lanadi.
              </div>
            </div>
          ) : (
            /* New user registration flow */
            <>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  To&apos;liq ismingiz
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
                    borderRadius: 10,
                    border: "1.5px solid #E5E7EB",
                    fontSize: 14.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Yangi parol yarating
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Kamida 8 ta belgi"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1.5px solid #E5E7EB",
                    fontSize: 14.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Parolni tasdiqlang
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Parolni qayta kiriting"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1.5px solid #E5E7EB",
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
              background: submitting ? "#9CA3AF" : ACCENT,
              color: "#FFFFFF",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 11,
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
                <span>Ulanmoqda...</span>
              </>
            ) : (
              <span>Taklifnomani qabul qilish &amp; Kirish</span>
            )}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 13, color: "#9CA3AF" }}>
          CRMAPP &copy; {new Date().getFullYear()} — Xavfsiz ta&apos;lim platformasi
        </div>
      </div>
    </div>
  );
}
