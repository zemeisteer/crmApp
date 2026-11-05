"use client";

import type { PortalAnnouncement, PortalAttendance, PortalHomework, PortalMe, PortalPayments, PortalSchedule } from "@/lib/api";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate, formatDateTime } from "@/lib/format-date";
import Modal from "@/components/Modal";
import { MONTH_KEYS, type TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", padding: 18, boxShadow: "var(--shadow-card)" };
const tile = (bg: string): React.CSSProperties => ({ background: bg, border: "none", borderRadius: "var(--radius-lg)", padding: 18, textAlign: "left", cursor: "pointer", color: "var(--text)", fontFamily: "inherit", minHeight: 110 });
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
      {/* Greeting: a student is greeted; a parent sees whose cabinet this is. */}
      <div className="rise-in" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, padding: "2px 2px 4px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {parent ? t("ptp.yourChild") : t("ptl.welcome")}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 34, letterSpacing: "-0.035em", lineHeight: 1.1, marginTop: 4, overflowWrap: "anywhere" }}>
            {parent ? me?.fullName ?? "" : me?.fullName?.split(" ")[0] ?? ""}
          </div>
        </div>
        <div aria-hidden="true" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: "50%", background: parent ? "var(--pink)" : "var(--accent-strong)", color: "var(--on-color)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}>
          {(me?.fullName ?? "?").slice(0, 1).toUpperCase()}
        </div>
      </div>

      {/* The one hero: the next lesson for a student, the payment for a parent. */}
      {parent ? (
        <button type="button" onClick={() => onOpen("payments")} className="rise-in ptl-hero" style={{ ["--i" as string]: 1 }}>
          <span className="ptl-hero-label">{t("pth.payment")}</span>
          {!payments || payments.expectedTuition === 0 ? (
            <span className="ptl-hero-big">—</span>
          ) : payments.status === "PAID" ? (
            <span className="ptl-hero-big">✓ {t("pth.paidFor").replace("{month}", month)}</span>
          ) : (
            <span className="ptl-hero-big">{t("pth.debt").replace("{sum}", `${money(payments.debtAmount)} ${t("common.sumUnit")}`)}</span>
          )}
          <span className="ptl-hero-btn">{t("ptn.payments")} →</span>
        </button>
      ) : (
        <button type="button" onClick={() => onOpen("schedule")} className="rise-in ptl-hero" style={{ ["--i" as string]: 1 }}>
          <span className="ptl-hero-label">{t("pth.nextLesson")}</span>
          {next ? (
            <>
              <span className="ptl-hero-big">{next.l.group?.name ?? "—"}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{nextWhen}</span>
              <span style={{ fontSize: 13, opacity: 0.85 }}>{[next.l.teacher?.fullName, next.l.room?.name].filter(Boolean).join(" · ")}</span>
            </>
          ) : (
            <span className="ptl-hero-big" style={{ fontSize: 22 }}>{t("pth.noLessons")}</span>
          )}
          <span className="ptl-hero-btn">{t("ptn.schedule")} →</span>
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {parent && (
          <button type="button" onClick={() => onOpen("schedule")} className="rise-in" style={{ ...tile("var(--sky)"), ["--i" as string]: 2 }}>
            <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("pth.nextLesson")}</div>
            {next ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{next.l.group?.name ?? "—"} — {nextWhen}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 3 }}>{[next.l.teacher?.fullName, next.l.room?.name].filter(Boolean).join(" · ")}</div>
              </>
            ) : (
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-soft)", marginTop: 6 }}>{t("pth.noLessons")}</div>
            )}
          </button>
        )}

        <button type="button" onClick={() => onOpen("attendance")} className="rise-in" style={{ ...tile("var(--lav)"), ["--i" as string]: 3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("ptl.attendanceRate")}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{total > 0 ? t("pth.lessonsOf").replace("{n}", String(present)).replace("{total}", String(total)) : "—"}</div>
          </div>
          <svg width="58" height="58" viewBox="0 0 36 36" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface)" strokeWidth="4" />
            {rate !== null && (
              <circle cx="18" cy="18" r="15" fill="none" stroke={rate >= 80 ? "var(--ink)" : "var(--warning)"} strokeWidth="4" strokeDasharray={`${(rate / 100) * 94.2} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
            )}
            <text x="18" y="21" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--text)">{rate === null ? "—" : `${rate}%`}</text>
          </svg>
        </button>

        {!parent && (
          <button type="button" onClick={() => onOpen("payments")} className="rise-in" style={{ ...tile(payments && payments.expectedTuition > 0 && payments.status !== "PAID" ? "var(--peach)" : "var(--mint)"), ["--i" as string]: 4 }}>
            <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("pth.payment")}</div>
            {!payments || payments.expectedTuition === 0 ? (
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, color: "var(--text-muted)" }}>—</div>
            ) : payments.status === "PAID" ? (
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, color: "var(--success)" }}>{t("pth.paidFor").replace("{month}", month)}</div>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, color: "var(--danger)" }}>
                {t("pth.debt").replace("{sum}", `${money(payments.debtAmount)} ${t("common.sumUnit")}`)}
              </div>
            )}
          </button>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17 }}>{t("ptl.tabHomework")}</div>
          <button type="button" onClick={() => onOpen("homework")} className="dash-link" style={{ background: "none", cursor: "pointer", minHeight: 36 }}>
            {t("dashboard.viewAll")}
          </button>
        </div>
        {homework.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("pth.noHomework")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...openHw, ...homework.filter((h) => h.completed)].slice(0, 4).map((h) => {
              const due = h.dueDate ? new Date(h.dueDate) : null;
              const late = !h.completed && due && due.getTime() < now;
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div>
                    {!h.completed && due && <div style={{ fontSize: 12, color: late ? "var(--danger)" : "var(--text-muted)" }}>{t("pth.due")}: {formatDate(due, lang)}</div>}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: "var(--radius-pill)",
                      whiteSpace: "nowrap",
                      ...(h.completed ? { color: "var(--success)", background: "var(--success-soft)" } : late ? { color: "var(--danger)", background: "var(--danger-soft)" } : { color: "var(--text-muted)", background: "var(--surface-muted)" }),
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
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17 }}>{t("ptl.latestNews")}</div>
            <button type="button" onClick={() => onOpen("notifications")} className="dash-link" style={{ background: "none", cursor: "pointer", minHeight: 36 }}>
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
                  style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%", fontFamily: "inherit", color: "inherit", cursor: "pointer", background: urgent ? "var(--danger-soft)" : "var(--surface-muted)", border: `1px solid ${urgent ? "var(--danger-border)" : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: "10px 12px" }}
                >
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: urgent ? "var(--danger)" : ACCENT, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.content}</span>
                  </span>
                  <span aria-hidden style={{ color: "var(--text-muted)", fontSize: 16 }}>›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {openNews && (
        <Modal open onClose={() => setOpenNews(null)} title={openNews.title} width={520}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: -8, marginBottom: 12 }}>{formatDateTime(openNews.createdAt, lang)}</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>{openNews.content}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" onClick={() => setOpenNews(null)} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
              {t("ann.gotIt")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
