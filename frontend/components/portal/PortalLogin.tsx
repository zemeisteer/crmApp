"use client";

import { useState } from "react";
import { ApiError, portalApi, type PortalSession } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import PhoneInput from "@/components/PhoneInput";

type Step = "phone" | "verify" | "choose";

// Portal sign-in: phone number, then either the one-time code sent to the
// student's Telegram or the PIN the center gave them. A phone number alone
// never signs anyone in.
export default function PortalLogin({ onLoggedIn, subdomain }: { onLoggedIn: (sessions: PortalSession[], activeId?: string) => void; subdomain?: string }) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [telegramSent, setTelegramSent] = useState(false);
  const [pinAvailable, setPinAvailable] = useState(false);
  const [method, setMethod] = useState<"code" | "pin">("code");
  const [secret, setSecret] = useState("");
  const [choices, setChoices] = useState<Array<{ id: string; fullName: string; centerName: string }>>([]);
  const [sessions, setSessions] = useState<PortalSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, "").length < 9) {
      setError(t("leadForm.errPhone"));
      return;
    }
    setBusy(true);
    try {
      const res = await portalApi.startPhoneLogin(phone, subdomain);
      setTelegramSent(res.telegramSent);
      setPinAvailable(res.pinAvailable);
      setMethod(res.telegramSent ? "code" : "pin");
      setSecret("");
      setStep("verify");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("ptl.loginError"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(studentId?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await portalApi.verifyPhoneLogin({ phone, [method]: secret.trim(), studentId, subdomain });
      if ("choose" in res) {
        setChoices(res.choose);
        setSessions(res.sessions ?? []);
        setStep("choose");
      } else {
        onLoggedIn([res]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("ptl.loginError"));
    } finally {
      setBusy(false);
    }
  }

  const noWay = step === "verify" && !telegramSent && !pinAvailable;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <div style={errorBox}>{error}</div>}

      {step === "phone" && (
        <form onSubmit={start} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
          <div>
            <label style={label}>{t("ptl.phone")}</label>
            <PhoneInput value={phone} onChange={setPhone} style={input} />
          </div>
          <button type="submit" disabled={busy} style={button}>
            {busy ? t("ptl.signingIn") : t("plog.next")}
          </button>
        </form>
      )}

      {step === "verify" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "#CBD5E1" }}>
            {phone} ·{" "}
            <button type="button" onClick={() => { setStep("phone"); setError(null); }} style={linkBtn}>
              {t("plog.changePhone")}
            </button>
          </div>

          {noWay ? (
            <div style={{ ...hint, color: "#FDE68A" }}>{t("plog.noMethod")}</div>
          ) : (
            <>
              {telegramSent && pinAvailable && (
                <div style={{ display: "flex", gap: 6 }}>
                  {(["code", "pin"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => { setMethod(m); setSecret(""); }} style={{ ...tab, background: method === m ? "#4F46E5" : "rgba(255,255,255,0.08)" }}>
                      {m === "code" ? t("plog.byTelegram") : t("plog.byPin")}
                    </button>
                  ))}
                </div>
              )}
              <div style={hint}>{method === "code" ? t("plog.codeSent") : t("plog.pinHint")}</div>
              <input
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={secret}
                onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                style={{ ...input, fontSize: 22, letterSpacing: 8, textAlign: "center" }}
              />
              <button type="button" disabled={busy || secret.length < 6} onClick={() => verify()} style={{ ...button, opacity: secret.length < 6 ? 0.6 : 1 }}>
                {busy ? t("ptl.signingIn") : t("ptl.signIn")}
              </button>
              {method === "code" && (
                <button type="button" onClick={(e) => start(e as unknown as React.FormEvent)} disabled={busy} style={linkBtn}>
                  {t("plog.resend")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {step === "choose" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={hint}>{t("plog.choose")}</div>
          {choices.map((c) => (
            <button key={c.id} type="button" disabled={busy} onClick={() => (sessions.length ? onLoggedIn(sessions, c.id) : verify(c.id))} style={{ ...tab, padding: "12px 14px", textAlign: "left", background: "rgba(255,255,255,0.08)" }}>
              <div style={{ fontWeight: 700 }}>{c.fullName}</div>
              <div style={{ fontSize: 12, color: "#94A3B8" }}>{c.centerName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 };
const input: React.CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255, 255, 255, 0.15)", background: "rgba(15, 23, 42, 0.6)", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box" };
const button: React.CSSProperties = { width: "100%", padding: 13, borderRadius: 12, border: "none", background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 20px rgba(79, 70, 229, 0.4)" };
const tab: React.CSSProperties = { flex: 1, padding: "8px 10px", borderRadius: 10, border: "none", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const hint: React.CSSProperties = { fontSize: 13, color: "#CBD5E1", lineHeight: 1.5 };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#A5B4FC", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 };
const errorBox: React.CSSProperties = { background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#FCA5A5", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12 };
