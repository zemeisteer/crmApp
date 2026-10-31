"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authApi, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

function VerifyEmailContent() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("resetPw.linkIncorrect"));
      return;
    }
    authApi
      .verifyEmail(token)
      .then((res) => {
        setStatus("ok");
        setMessage(res.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : t("verifyEmail.failed"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t("verifyEmail.title")}</h1>
      {status === "loading" && <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("verifyEmail.verifying")}</div>}
      {status === "ok" && (
        <div style={{ background: "var(--success-soft)", color: "var(--success)", fontSize: 13.5, fontWeight: 600, padding: "12px 16px", borderRadius: "var(--radius-sm)" }}>{message}</div>
      )}
      {status === "error" && (
        <div style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13.5, fontWeight: 600, padding: "12px 16px", borderRadius: "var(--radius-sm)" }}>{message}</div>
      )}
      <Link href="/login" style={{ color: ACCENT, fontWeight: 600, fontSize: 13.5 }}>
        {t("verifyEmail.goToLogin")}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)" }}>
      <div style={{ width: 380, background: "var(--surface)", borderRadius: "var(--radius-lg)", padding: 32 }}>
        <Suspense fallback={<div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
