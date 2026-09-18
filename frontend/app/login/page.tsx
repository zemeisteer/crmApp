"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#F7F7F5" }}>
      {/* LEFT: brand panel */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(135deg,#0F0B29,#1B1440)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 48,
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
        className="hidden md:flex"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 2 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 19, color: "#fff", letterSpacing: "-0.02em" }}>
            TalimCRM
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 18, maxWidth: 420 }}>
          <h1 style={{ fontSize: 34, lineHeight: 1.2, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            O&apos;quv markazingizni bitta joydan boshqaring
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#B7B0E8" }}>
            Jadval, davomat, to&apos;lovlar, AI yordamchi va hisobotlar — hammasi bitta panelda.
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, fontSize: 12.5, color: "#71737C" }}>
          © 2026 TalimCRM. Barcha huquqlar himoyalangan.
        </div>
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: "radial-gradient(circle,rgba(139,124,246,0.25),transparent 70%)",
            top: -120,
            right: -120,
            zIndex: 1,
          }}
        />
      </div>

      {/* RIGHT: login form */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <form onSubmit={onSubmit} style={{ width: 380, display: "flex", flexDirection: "column", gap: 24, padding: "24px" }}>
          <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 11, padding: 4 }}>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 13.5,
                fontWeight: 700,
                padding: 9,
                borderRadius: 8,
                background: "#fff",
                color: "#181A1F",
                boxShadow: "0 1px 3px rgba(18,19,26,0.08)",
              }}
            >
              Kirish
            </div>
            <Link
              href="/register"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 13.5,
                fontWeight: 700,
                padding: 9,
                borderRadius: 8,
                color: "#8A8D96",
              }}
            >
              Ro&apos;yxatdan o&apos;tish
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>Xush kelibsiz, boss</h2>
            <p style={{ fontSize: 13.5, color: "#8A8D96" }}>Admin panelga kirish uchun ma&apos;lumotlaringizni kiriting.</p>
          </div>

          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Email</div>
              <input
                className="field-input"
                type="email"
                required
                placeholder="azizbek@bilimdon.uz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Parol</div>
              <input
                className="field-input"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 700, padding: 13, borderRadius: 10 }}
          >
            {loading ? "Kirilmoqda..." : "Kirish"}
          </button>

          <p style={{ textAlign: "center", fontSize: 13, color: "#8A8D96" }}>
            Hisobingiz yo&apos;qmi?{" "}
            <Link href="/register" style={{ color: ACCENT, fontWeight: 700 }}>
              7 kun bepul sinab ko&apos;ring
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
