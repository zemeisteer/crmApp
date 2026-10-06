"use client";

import type { PortalAnnouncement, PortalAttendance, PortalHomework, PortalMe, PortalPayments, PortalSchedule } from "@/lib/api";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate, formatDateTime } from "@/lib/format-date";
import Modal from "@/components/Modal";
import { MONTH_KEYS, type TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 16 };
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const NEWS_FRESH_MS = 3 * 86_400_000;
const DAY_KEYS: TranslationKey[] = [
  "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday",
  "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday",
];

// Student home, as in the demo's phone preview: next lesson, attendance
// ring, payment state, homework and news.
export default function PortalHome({
  me,
  schedule,
  attendance,
  homework,
  payments,
  announcements,
  onOpen,
  onReadAnnouncement,
  parent = false,
}: {
  me: PortalMe | null;
  schedule: PortalSchedule | null;
  attendance: PortalAttendance | null;
  homework: PortalHomework[];
  payments: PortalPayments | null;
  announcements: PortalAnnouncement[];
  onOpen: (tab: "schedule" | "attendance" | "homework" | "payments" | "notifications") => void;
  // Opening an announcement here marks it read, which takes it off home.
  onReadAnnouncement: (id: string) => void;
  // Seen by a parent: about "your child", not a greeting to the student.
  parent?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [openNews, setOpenNews] = useState<PortalAnnouncement | null>(null);
  // Home shows news only while it is fresh and unread; the rest stays in
  // the Messages tab.
  const [now] = useState(() => Date.now());
  const fresh = announcements.filter((a) => !a.read && now - new Date(a.createdAt).getTime() < NEWS_FRESH_MS);

  // Next lesson from the weekly timetable (days 1 = Mon ... 7 = Sun).
  const next = (() => {
    const now = new Date();
    const today = now.getDay() === 0 ? 7 : now.getDay();
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    let best: { diff: number; day: number; l: PortalSchedule["timetable"][number] } | null = null;
    for (const l of schedule?.timetable ?? []) {
      if (!l.dayOfWeek) continue;
      const day = l.dayOfWeek === 0 ? 7 : l.dayOfWeek;
      let diff = (day - today + 7) % 7;
      if (diff === 0 && l.endTime <= hm) diff = 7;
      const key = diff * 1440 + Number(l.startTime.slice(0, 2)) * 60 + Number(l.startTime.slice(3, 5));
      if (!best || key < best.diff) best = { diff: key, day, l };
    }
    return best;
  })();
  const nextWhen = next
    ? `${Math.floor(next.diff / 1440) === 0 ? t("pth.today") : Math.floor(next.diff / 1440) === 1 ? t("pth.tomorrow") : t(DAY_KEYS[next.day - 1])}, ${next.l.startTime}`
    : null;

  const present = (attendance?.present ?? 0) + (attendance?.late ?? 0);
  const total = attendance?.total ?? 0;
  const rate = total > 0 ? Math.round((present / total) * 100) : null;
  const month = payments?.forMonth && /^\d{4}-\d{2}$/.test(payments.forMonth) ? t(MONTH_KEYS[Number(payments.forMonth.slice(5)) - 1]) : "";
  const openHw = homework.filter((h) => !h.completed);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 2px" }}>
        <div>
          <div style={{ fontSize: 13, color: "#64748B" }}>{parent ? t("ptp.yourChild") : t("ptl.welcome")}</div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20 }}>{parent ? me?.fullName ?? "" : me?.fullName?.split(" ")[0] ?? ""}</div>
        </div>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: ACCENT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
          {(me?.fullName ?? "?").slice(0, 1).toUpperCase()}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <button type="button" onClick={() => onOpen("schedule")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontSize: 13, color: "#64748B" }}>{t("pth.nextLesson")}</div>
          {next ? (
            <>
              <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3 }}>{next.l.group?.name ?? "—"} — {nextWhen}</div>
              <div style={{ fontSize: 12.5, color: "#94A3B8", marginTop: 2 }}>
                {[next.l.teacher?.fullName, next.l.room?.name].filter(Boolean).join(" · ")}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, fontWeight: 600, color: "#94A3B8", marginTop: 3 }}>{t("pth.noLessons")}</div>
          )}
        </button>

        <button type="button" onClick={() => onOpen("attendance")} style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, color: "#64748B" }}>{t("ptl.attendanceRate")}</div>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3 }}>{total > 0 ? t("pth.lessonsOf").replace("{n}", String(present)).replace("{total}", String(total)) : "—"}</div>
          </div>
          <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="#E2E8F0" strokeWidth="4" />
            {rate !== null && (
              <circle cx="18" cy="18" r="15" fill="none" stroke={rate >= 80 ? ACCENT : "#EA7A3A"} strokeWidth="4" strokeDasharray={`${(rate / 100) * 94.2} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
            )}
            <text x="18" y="21" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#1E293B">{rate === null ? "—" : `${rate}%`}</text>
          </svg>
        </button>

        <button type="button" onClick={() => onOpen("payments")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontSize: 13, color: "#64748B" }}>{t("pth.payment")}</div>
          {!payments || payments.expectedTuition === 0 ? (
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3, color: "#94A3B8" }}>—</div>
          ) : payments.status === "PAID" ? (
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3, color: "#1FA463" }}>{t("pth.paidFor").replace("{month}", month)}</div>
          ) : (
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3, color: "#DC2626" }}>
              {t("pth.debt").replace("{sum}", `${money(payments.debtAmount)} ${t("common.sumUnit")}`)}
            </div>
          )}
        </button>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16 }}>{t("ptl.tabHomework")}</div>
          <button type="button" onClick={() => onOpen("homework")} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            {t("dashboard.viewAll")}
          </button>
        </div>
        {homework.length === 0 ? (
          <div style={{ fontSize: 13, color: "#94A3B8" }}>{t("pth.noHomework")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...openHw, ...homework.filter((h) => h.completed)].slice(0, 4).map((h) => {
              const due = h.dueDate ? new Date(h.dueDate) : null;
              const late = !h.completed && due && due.getTime() < now;
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 12, border: "1px solid #EDF2F7" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div>
                    {!h.completed && due && <div style={{ fontSize: 12, color: late ? "#DC2626" : "#94A3B8" }}>{t("pth.due")}: {formatDate(due, lang)}</div>}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 100,
                      whiteSpace: "nowrap",
                      ...(h.completed ? { color: "#1FA463", background: "#E9F8EF" } : late ? { color: "#DC2626", background: "#FEE2E2" } : { color: "#8A8D96", background: "#F2F1EC" }),
                    }}
                  >
                    {h.completed ? t("hws.stDone") : late ? t("hws.stOverdue") : t("pth.todo")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {fresh.length > 0 && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16 }}>{t("ptl.latestNews")}</div>
            <button type="button" onClick={() => onOpen("notifications")} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              {t("dashboard.viewAll")}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fresh.slice(0, 3).map((a) => {
              const urgent = a.priority === "URGENT" || a.priority === "HIGH";
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setOpenNews(a);
                    onReadAnnouncement(a.id);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%", fontFamily: "inherit", color: "inherit", cursor: "pointer", background: urgent ? "#FFF1F2" : "#F8FAFC", border: `1px solid ${urgent ? "#FECDD3" : "#EDF2F7"}`, borderRadius: 12, padding: "10px 12px" }}
                >
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: urgent ? "#E11D48" : ACCENT, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "#64748B", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.content}</span>
                  </span>
                  <span aria-hidden style={{ color: "#94A3B8", fontSize: 16 }}>›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {openNews && (
        <Modal open onClose={() => setOpenNews(null)} title={openNews.title} width={520}>
          <div style={{ fontSize: 12.5, color: "#94A3B8", marginTop: -8, marginBottom: 12 }}>{formatDateTime(openNews.createdAt, lang)}</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "#2A2D35", whiteSpace: "pre-wrap" }}>{openNews.content}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" onClick={() => setOpenNews(null)} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9, cursor: "pointer" }}>
              {t("ann.gotIt")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
