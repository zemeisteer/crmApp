"use client";

import { useEffect, useState } from "react";
import {
  portalApi,
  getPortalToken,
  setPortalToken,
  clearPortalToken,
  PortalMe,
  PortalSchedule,
  PortalAttendance,
  PortalHomework,
  PortalExams,
  PortalPayments,
  PortalAnnouncement,
  ApiError,
} from "@/lib/api";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const DAY_NAMES = [
  "",
  "Dushanba",
  "Seshanba",
  "Chorshanba",
  "Payshanba",
  "Juma",
  "Shanba",
  "Yakshanba",
];

export default function StudentPortalPage() {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "home" | "schedule" | "attendance" | "homework" | "exams" | "payments"
  >("home");

  // Auth form state
  const [phone, setPhone] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Portal data states
  const [me, setMe] = useState<PortalMe | null>(null);
  const [schedule, setSchedule] = useState<PortalSchedule | null>(null);
  const [attendance, setAttendance] = useState<PortalAttendance | null>(null);
  const [homework, setHomework] = useState<PortalHomework[]>([]);
  const [exams, setExams] = useState<PortalExams | null>(null);
  const [payments, setPayments] = useState<PortalPayments | null>(null);
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  async function handlePayOnline(provider: "CLICK" | "PAYME") {
    if (!payments || payments.debtAmount <= 0) return;
    setCheckoutLoading(provider);
    try {
      const res = await portalApi.createCheckoutLink({
        provider,
        amount: payments.debtAmount,
        forMonth: payments.forMonth,
      });
      if (res.url) {
        window.open(res.url, "_blank");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "To'lov havolasini yaratishda xatolik yuz berdi");
    } finally {
      setCheckoutLoading(null);
    }
  }

  // Check token and initialize
  useEffect(() => {
    // If Telegram WebApp SDK is available, notify ready
    if (typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      tg.ready();
      tg.expand();
    }

    const searchParams = new URLSearchParams(window.location.search);
    const urlToken = searchParams.get("token");

    if (urlToken) {
      setAuthLoading(true);
      portalApi
        .loginWithToken(urlToken)
        .then((res) => {
          setPortalToken(res.accessToken);
          setTokenState(res.accessToken);
          // Clean token from url without refresh
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((err) => {
          setAuthError(err instanceof ApiError ? err.message : "Havola yaroqsiz");
        })
        .finally(() => {
          setAuthLoading(false);
          setLoading(false);
        });
      return;
    }

    const stored = getPortalToken();
    if (stored) {
      setTokenState(stored);
    }
    setLoading(false);
  }, []);

  // Load portal data once token exists
  useEffect(() => {
    if (!token) return;
    setLoading(true);

    Promise.all([
      portalApi.getMe(),
      portalApi.getSchedule(),
      portalApi.getAttendance(),
      portalApi.getHomework(),
      portalApi.getExams(),
      portalApi.getPayments(),
      portalApi.getAnnouncements(),
    ])
      .then(([m, s, a, h, e, p, ann]) => {
        setMe(m);
        setSchedule(s);
        setAttendance(a);
        setHomework(h);
        setExams(e);
        setPayments(p);
        setAnnouncements(ann);
      })
      .catch(() => {
        clearPortalToken();
        setTokenState(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePhoneLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await portalApi.loginWithPhone(phone, studentCode || undefined);
      setPortalToken(res.accessToken);
      setTokenState(res.accessToken);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "Kirishda xatolik yuz berdi");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    clearPortalToken();
    setTokenState(null);
    setMe(null);
  }

  async function handleHomeworkSubmit(id: string) {
    try {
      await portalApi.submitHomework(id);
      // update state locally
      setHomework((prev) =>
        prev.map((hw) => (hw.id === id ? { ...hw, completed: true } : hw)),
      );
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Topshirishda xatolik");
    }
  }

  // -------------------------------------------------------------
  // Render Login Screen if not authenticated
  // -------------------------------------------------------------
  if (!token) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          fontFamily: "'Inter', sans-serif",
          color: "#fff",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "rgba(30, 41, 59, 0.75)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 24,
            padding: "32px 24px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                boxShadow: "0 8px 16px rgba(79, 70, 229, 0.4)",
                marginBottom: 12,
              }}
            >
              🎓
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px 0" }}>
              Shaxsiy Kabinet
            </h1>
            <p style={{ fontSize: 13, color: "#94A3B8", margin: 0 }}>
              O'quvchi va ota-onalar portali
            </p>
          </div>

          {authError && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#FCA5A5",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 14px",
                borderRadius: 12,
                marginBottom: 16,
              }}
            >
              {authError}
            </div>
          )}

          <form onSubmit={handlePhoneLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>
                Telefon raqam
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "rgba(15, 23, 42, 0.6)",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>
                O'quvchi kodi / ID (ixtiyoriy)
              </label>
              <input
                type="text"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                placeholder="Bir nechta o'quvchi bo'lsa kiriting"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "rgba(15, 23, 42, 0.6)",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              style={{
                width: "100%",
                padding: 13,
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 8px 20px rgba(79, 70, 229, 0.4)",
                marginTop: 6,
              }}
            >
              {authLoading ? "Kirilmoqda..." : "Kabinetga kirish"}
            </button>
          </form>

          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              textAlign: "center",
              fontSize: 12,
              color: "#94A3B8",
            }}
          >
            Telegram bot orqali 1-klikda kirish uchun botdagi <b>📱 Shaxsiy Kabinet</b> tugmasini bosing.
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Loading
  // -------------------------------------------------------------
  if (loading && !me) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F8FAFC",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
          color: "#64748B",
          fontSize: 14,
        }}
      >
        Yuklanmoqda...
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Full Portal Interface
  // -------------------------------------------------------------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F8FAFC",
        color: "#0F172A",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top Navbar */}
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid #E2E8F0",
          padding: "14px 20px",
          position: "sticky",
          top: 0,
          zIndex: 30,
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            maxWidth: 1000,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "#EEF2FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              🎓
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1E293B" }}>
                {me?.tenant?.name || "O'quv Markazi"}
              </div>
              <div style={{ fontSize: 11.5, color: "#64748B" }}>
                {me?.fullName || "O'quvchi"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleLogout}
              style={{
                background: "#F1F5F9",
                color: "#64748B",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Chiqish
            </button>
          </div>
        </div>
      </header>

      {/* Nav Tabs Bar */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #E2E8F0",
          overflowX: "auto",
        }}
      >
        <div
          style={{
            maxWidth: 1000,
            margin: "0 auto",
            display: "flex",
            padding: "0 16px",
            gap: 6,
          }}
        >
          {[
            { id: "home", label: "🏠 Bosh sahifa" },
            { id: "schedule", label: "📅 Dars jadvali" },
            { id: "attendance", label: "📊 Davomat" },
            { id: "homework", label: "📝 Vazifalar" },
            { id: "exams", label: "🎯 Natijalar" },
            { id: "payments", label: "💳 To'lovlar" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: "14px 14px",
                border: "none",
                background: "transparent",
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? ACCENT : "#64748B",
                borderBottom: `2.5px solid ${activeTab === tab.id ? ACCENT : "transparent"}`,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Container */}
      <main
        style={{
          flex: 1,
          maxWidth: 1000,
          width: "100%",
          margin: "0 auto",
          padding: "20px 16px 40px 16px",
          boxSizing: "border-box",
        }}
      >
        {/* ========================================================================= */}
        {/* TAB: HOME                                                                 */}
        {/* ========================================================================= */}
        {activeTab === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Student Welcome Card */}
            <div
              style={{
                background: "linear-gradient(135deg, #4F46E5 0%, #3730A3 100%)",
                borderRadius: 20,
                padding: 24,
                color: "#fff",
                boxShadow: "0 10px 24px rgba(79, 70, 229, 0.25)",
              }}
            >
              <div style={{ fontSize: 13, color: "#C7D2FE", marginBottom: 4 }}>
                Xush kelibsiz! 👋
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 12px 0" }}>
                {me?.fullName}
              </h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {me?.enrollments.map((e) => (
                  <span
                    key={e.id}
                    style={{
                      background: "rgba(255, 255, 255, 0.18)",
                      backdropFilter: "blur(8px)",
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    📚 {e.group.name} ({e.group.subject})
                  </span>
                ))}
              </div>
            </div>

            {/* Quick Metrics */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#64748B" }}>Davomat ko'rsatkichi</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    color: (attendance?.rate || 100) >= 80 ? "#10B981" : "#EF4444",
                    marginTop: 4,
                  }}
                >
                  {attendance?.rate ?? 100}%
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#64748B" }}>Oylik to'lov holati</div>
                <div style={{ marginTop: 6 }}>
                  {payments?.status === "PAID" && (
                    <span
                      style={{
                        background: "#DCFCE7",
                        color: "#15803D",
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 8,
                      }}
                    >
                      ✓ To'langan
                    </span>
                  )}
                  {payments?.status === "PARTIAL" && (
                    <span
                      style={{
                        background: "#FEF3C7",
                        color: "#B45309",
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 8,
                      }}
                    >
                      ⚠️ Qisman ({formatMoney(payments.debtAmount)} qarz)
                    </span>
                  )}
                  {payments?.status === "UNPAID" && (
                    <span
                      style={{
                        background: "#FEE2E2",
                        color: "#DC2626",
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 8,
                      }}
                    >
                      ❌ To'lanmagan ({formatMoney(payments?.debtAmount || 0)} qarz)
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#64748B" }}>Uy vazifalari</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    color: ACCENT,
                    marginTop: 4,
                  }}
                >
                  {homework.filter((h) => !h.completed).length} ta topshirilmagan
                </div>
              </div>
            </div>

            {/* Announcements Card */}
            {announcements.length > 0 && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 20,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                  📢 So'nggi e'lonlar
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {announcements.slice(0, 3).map((a) => (
                    <div
                      key={a.id}
                      style={{
                        background: "#F8FAFC",
                        border: "1px solid #EDF2F7",
                        borderRadius: 12,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1E293B" }}>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>
                        {a.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: SCHEDULE                                                             */}
        {/* ========================================================================= */}
        {activeTab === "schedule" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
              Dars jadvali
            </h2>

            {schedule?.timetable.length === 0 && schedule?.fallbackGroups.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                  color: "#64748B",
                }}
              >
                Hozircha sizga biriktirilgan dars jadvali yo'q.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {schedule?.timetable.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E2E8F0",
                      borderRadius: 14,
                      padding: 16,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                        {item.group?.name}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                        {item.dayOfWeek ? DAY_NAMES[item.dayOfWeek] : "Haftalik"} |{" "}
                        {item.startTime} - {item.endTime}
                      </div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                        {item.room ? `🚪 ${item.room.name}` : ""}
                        {item.room && item.teacher ? " • " : ""}
                        {item.teacher ? `👨‍🏫 ${item.teacher.fullName}` : ""}
                      </div>
                    </div>

                    {item.onlineMeetingUrl && (
                      <a
                        href={item.onlineMeetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: "#EEF2FF",
                          color: ACCENT,
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "8px 14px",
                          borderRadius: 8,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        🎥 Onlayn darsga kirish
                      </a>
                    )}
                  </div>
                ))}

                {/* Fallback groups schedule if no explicit timetable */}
                {schedule?.fallbackGroups.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E2E8F0",
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                      🗓 Kunlari: {g.scheduleDays || g.schedule || "Dushanba, Chorshanba, Juma"}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                      🕒 Vaqti: {g.startTime || "16:00"} {g.teacher ? `• 👨‍🏫 ${g.teacher}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: ATTENDANCE                                                           */}
        {/* ========================================================================= */}
        {activeTab === "attendance" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Davomat tarixi</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 12,
                  padding: 14,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#166534" }}>Qatnashdi</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#15803D" }}>
                  {attendance?.present || 0} ta
                </div>
              </div>
              <div
                style={{
                  background: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  borderRadius: 12,
                  padding: 14,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#92400E" }}>Kechikdi</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#B45309" }}>
                  {attendance?.late || 0} ta
                </div>
              </div>
              <div
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: 12,
                  padding: 14,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#991B1B" }}>Kelmadi</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#DC2626" }}>
                  {attendance?.absent || 0} ta
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              {attendance?.records.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  Davomat yozuvlari hali kiritilmagan.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B" }}>Sana</th>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B", textAlign: "right" }}>Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance?.records.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>{r.date}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          {r.status === "PRESENT" && (
                            <span style={{ background: "#DCFCE7", color: "#15803D", fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>
                              ✓ Qatnashdi
                            </span>
                          )}
                          {r.status === "LATE" && (
                            <span style={{ background: "#FEF3C7", color: "#B45309", fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>
                              ⚠️ Kechikdi
                            </span>
                          )}
                          {r.status === "ABSENT" && (
                            <span style={{ background: "#FEE2E2", color: "#DC2626", fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>
                              ❌ Kelmadi
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: HOMEWORK                                                             */}
        {/* ========================================================================= */}
        {activeTab === "homework" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Uy vazifalari</h2>

            {homework.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                  color: "#64748B",
                }}
              >
                Hozircha biriktirilgan vazifalar yo'q.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {homework.map((hw) => (
                  <div
                    key={hw.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #E2E8F0",
                      borderRadius: 16,
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{hw.title}</div>
                        <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                          Guruh: {hw.groupName || "Umumiy"} {hw.dueDate ? `• Muddat: ${hw.dueDate.slice(0, 10)}` : ""}
                        </div>
                      </div>
                      <div>
                        {hw.completed ? (
                          <span
                            style={{
                              background: "#DCFCE7",
                              color: "#15803D",
                              fontSize: 11.5,
                              fontWeight: 700,
                              padding: "4px 9px",
                              borderRadius: 6,
                            }}
                          >
                            ✓ Topshirilgan
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleHomeworkSubmit(hw.id)}
                            style={{
                              background: ACCENT,
                              color: "#fff",
                              border: "none",
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "6px 12px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                          >
                            Topshirish
                          </button>
                        )}
                      </div>
                    </div>

                    {hw.description && (
                      <div
                        style={{
                          background: "#F8FAFC",
                          border: "1px solid #EDF2F7",
                          borderRadius: 10,
                          padding: 12,
                          fontSize: 13,
                          color: "#334155",
                          marginTop: 12,
                        }}
                      >
                        {hw.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: EXAMS                                                                */}
        {/* ========================================================================= */}
        {activeTab === "exams" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
              Imtihonlar & Sertifikatlar
            </h2>

            {/* Certificates */}
            {exams?.certificates && exams.certificates.length > 0 && (
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
                  🏅 Qo'lga kiritilgan sertifikatlar
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {exams.certificates.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
                        border: "1px solid #FCD34D",
                        borderRadius: 16,
                        padding: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#78350F" }}>
                          {c.title}
                        </div>
                        <div style={{ fontSize: 12, color: "#92400E", marginTop: 2 }}>
                          Kod: {c.code} {c.grade ? `• Daraja: ${c.grade}` : ""}
                        </div>
                      </div>
                      <a
                        href={c.verifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: "#B45309",
                          color: "#fff",
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "6px 12px",
                          borderRadius: 8,
                        }}
                      >
                        Tekshirish
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exam Results */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
                Imtihon natijalari
              </div>
              {exams?.results.length === 0 && exams?.attempts.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E2E8F0",
                    borderRadius: 16,
                    padding: 32,
                    textAlign: "center",
                    color: "#64748B",
                  }}
                >
                  Hozircha e'lon qilingan imtihon natijalari yo'q.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {exams?.results.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: "#fff",
                        border: "1px solid #E2E8F0",
                        borderRadius: 14,
                        padding: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                          {r.examTitle || "Imtihon"}
                        </div>
                        {r.note && (
                          <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                            {r.note}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: ACCENT }}>
                        {r.score} ball
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: PAYMENTS                                                             */}
        {/* ========================================================================= */}
        {activeTab === "payments" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
              To'lovlar va Balans
            </h2>

            {/* Balance Card */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 12, color: "#64748B" }}>
                Joriy oy uchun to'lov holati ({payments?.forMonth})
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  marginTop: 6,
                  color: (payments?.debtAmount || 0) > 0 ? "#DC2626" : "#10B981",
                }}
              >
                {(payments?.debtAmount || 0) > 0
                  ? `Qarz: ${formatMoney(payments?.debtAmount || 0)} so'm`
                  : "Barcha to'lovlar qilingan (Qarz yo'q)"}
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>
                Oylik kurs narxi: {formatMoney(payments?.expectedTuition || 0)} so'm | To'landi:{" "}
                {formatMoney(payments?.monthPaid || 0)} so'm
              </div>

              {(payments?.debtAmount || 0) > 0 && (
                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => handlePayOnline("CLICK")}
                    disabled={checkoutLoading !== null}
                    style={{
                      background: "#0073FF",
                      color: "#fff",
                      border: "none",
                      padding: "10px 18px",
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>💳</span>
                    <span>{checkoutLoading === "CLICK" ? "Yuklanmoqda..." : "Click orqali to'lash"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePayOnline("PAYME")}
                    disabled={checkoutLoading !== null}
                    style={{
                      background: "#18AC98",
                      color: "#fff",
                      border: "none",
                      padding: "10px 18px",
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>💳</span>
                    <span>{checkoutLoading === "PAYME" ? "Yuklanmoqda..." : "Payme orqali to'lash"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Payment History */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 18px", fontSize: 14, fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>
                To'lovlar tarixi
              </div>
              {payments?.history.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  To'lovlar tarixi mavjud emas.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B" }}>Sana</th>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B" }}>Oy</th>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B" }}>Summa</th>
                      <th style={{ padding: "12px 16px", fontSize: 12, color: "#64748B", textAlign: "right" }}>Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments?.history.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 16px", fontSize: 13 }}>
                          {p.paidAt ? p.paidAt.slice(0, 10) : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>
                          {p.forMonth}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 800 }}>
                          {formatMoney(p.amount)} so'm
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <span
                            style={{
                              background: p.status === "PAID" ? "#DCFCE7" : "#FEE2E2",
                              color: p.status === "PAID" ? "#15803D" : "#DC2626",
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 6,
                            }}
                          >
                            {p.status === "PAID" ? "To'langan" : p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
