"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { authApi, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function ResetPasswordForm() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("resetPw.mismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPassword(token, password);
      setMessage(res.message);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={{ color: "#B23A47", fontSize: 13.5 }}>
        {t("resetPw.linkIncorrect")}{" "}
        <Link href="/forgot-password" style={{ color: ACCENT, fontWeight: 600 }}>
          {t("resetPw.requestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t("resetPw.newPasswordTitle")}</h1>
        <p style={{ fontSize: 13, color: "#8A8D96", marginTop: 4 }}>{t("resetPw.newPasswordHint")}</p>
      </div>
      {error && (
        <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
      )}
      {message ? (
        <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
          {message} {t("resetPw.redirecting")}
        </div>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("resetPw.newPassword")}</div>
            <input className="field-input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("admin.minChars")} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("resetPw.repeatPassword")}</div>
            <input className="field-input" type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}
          >
            {loading ? t("resetPw.saving") : t("resetPw.updatePassword")}
          </button>
        </>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
      <div style={{ width: 380, background: "#fff", borderRadius: 16, padding: 32 }}>
        <Suspense fallback={<div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
