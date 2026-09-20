import Link from "next/link";

const ACCENT = "#4F46E5";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
      <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32 }}>
        <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "'Manrope', sans-serif", color: ACCENT }}>404</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>Sahifa topilmadi</h1>
        <p style={{ fontSize: 13.5, color: "#8A8D96", marginTop: 8 }}>Siz izlayotgan sahifa mavjud emas yoki ko&apos;chirilgan.</p>
        <Link
          href="/dashboard"
          style={{ display: "inline-block", marginTop: 20, background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 20px", borderRadius: 9 }}
        >
          Bosh sahifaga qaytish
        </Link>
      </div>
    </div>
  );
}
