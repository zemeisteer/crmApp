"use client";

import { useEffect } from "react";

const ACCENT = "#4F46E5";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
      <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32 }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginTop: 12 }}>Nimadir xato ketdi</h1>
        <p style={{ fontSize: 13.5, color: "#8A8D96", marginTop: 8, lineHeight: 1.6 }}>
          Sahifani yuklashda kutilmagan xatolik yuz berdi. Qaytadan urinib ko&apos;ring.
        </p>
        <button
          className="btn"
          onClick={reset}
          style={{ marginTop: 20, background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 20px", borderRadius: 9, border: "none" }}
        >
          Qayta urinish
        </button>
      </div>
    </div>
  );
}
