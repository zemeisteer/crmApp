"use client";

import { useState } from "react";
import { ApiError, callsApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCallsMe } from "./useCallsMe";

/**
 * Click-to-call next to a phone number: the provider rings the member's own
 * extension first, then connects the client. Shown only to members who can
 * call out (telephony on, calls.make, an extension of their own).
 */
export default function CallButton({ phone, label }: { phone: string | null | undefined; label?: string }) {
  const { t } = useLanguage();
  const me = useCallsMe(Boolean(phone));
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!phone || !me.canCall) return null;

  const call = async () => {
    setState("busy");
    setMessage("");
    try {
      const r = await callsApi.clickToCall(phone);
      setState("done");
      setMessage(t("tel.callingYou").replace("{ext}", r.extension));
      window.setTimeout(() => setState("idle"), 6000);
    } catch (e) {
      setState("error");
      setMessage(e instanceof ApiError ? e.message : t("tel.callFailed"));
      window.setTimeout(() => setState("idle"), 6000);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
      <button
        type="button"
        className="btn btn-sm"
        data-testid="call-button"
        onClick={call}
        disabled={state === "busy"}
        aria-label={`${t("tel.call")}: ${phone}`}
        title={`${t("tel.call")}: ${phone}`}
        style={{
          background: "var(--success-soft)",
          color: "var(--success)",
          border: "1px solid var(--success-border)",
          borderRadius: "var(--radius-pill)",
          padding: label ? "5px 12px" : "4px 9px",
          fontSize: 12.5,
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        <span aria-hidden>📞</span>
        {label ? ` ${label}` : null}
      </button>
      {message && (
        <span role="status" style={{ fontSize: 12, color: state === "error" ? "var(--danger)" : "var(--text-muted)" }}>
          {message}
        </span>
      )}
    </span>
  );
}
