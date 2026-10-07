"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authApi, setRefreshToken, setToken } from "@/lib/api";
import { safeNextPath } from "@/lib/domain";
import { useLanguage } from "@/lib/i18n-context";

// Lands here from another address of the app with a one-time code in the
// URL fragment (#code=...), swaps it for a session on this address and goes
// on to the page that was asked for. The fragment never reaches a server.
export default function AuthHandoffPage() {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("code");
    const wanted = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
    // Only a path on this site: never an outside address.
    const next = safeNextPath(wanted);
    // Drop the code from the address bar and history at once.
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL, only after mount
      setFailed(true);
      return;
    }
    authApi
      .handoffExchange(code)
      .then((res) => {
        // A session here needs both tokens; anything less is a failed handoff.
        if (typeof res.accessToken !== "string" || typeof res.refreshToken !== "string") {
          setFailed(true);
          return;
        }
        setToken(res.accessToken);
        setRefreshToken(res.refreshToken);
        window.location.replace(next);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", padding: 20, textAlign: "center" }}>
      {failed ? (
        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("handoff.failed")}</div>
          <Link href="/login" style={{ background: "#4F46E5", color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10, textDecoration: "none" }}>{t("handoff.login")}</Link>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: "#686B75" }}>{t("handoff.moving")}</div>
      )}
    </div>
  );
}
