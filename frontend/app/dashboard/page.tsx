"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { DonutChart } from "@/components/BarChart";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { groupsApi, studentsApi, teachersApi, paymentsApi, attendanceApi, aiApi, Group, Student, Teacher, Payment, AttendanceRecord } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
// Matches the day-of-week strings stored on groups.scheduleDays (always Uzbek) — display-only translation happens separately via WEEKDAY_SHORT_KEYS.
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const WEEKDAY_SHORT_KEYS: TranslationKey[] = [
  "weekday.short.sunday", "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday",
  "weekday.short.thursday", "weekday.short.friday", "weekday.short.saturday",
];

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function ProgressBar({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>{suffix ?? `${value}/${max}`}</span>
      </div>
      <div style={{ height: 7, background: "#F1F0EC", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 5 }} />
      </div>
    </div>
  );
}

function PeriodPills({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { key: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            fontSize: 11.5, fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer", border: "none",
            background: value === o.key ? "#fff" : "transparent",
            color: value === o.key ? "#181A1F" : "#8A8D96",
            boxShadow: value === o.key ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DashboardContent() {
  const { user, tenant } = useAuth();
  const { t, lang } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [activityPeriod, setActivityPeriod] = useState<"day" | "week" | "month">("week");
  const [attendancePeriod, setAttendancePeriod] = useState<"day" | "week" | "month">("week");

  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    Promise.all([groupsApi.list(), studentsApi.list(), teachersApi.list(), paymentsApi.list(), attendanceApi.list()])
      .then(([g, s, t, p, a]) => {
        setGroups(g);
        setStudents(s);
        setTeachers(t);
        setPayments(p);
        setAttendance(a);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (groups.length === 0) return;
    setAiLoading(true);
    aiApi
      .groupInsights(groups[0].id)
      .then((res) => setAiPreview(res.insight.split("\n")[0]))
      .catch(() => setAiPreview(null))
      .finally(() => setAiLoading(false));
  }, [groups]);

  const today = new Date().toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" });
  const currentMonth = localMonthStr();
  const todayWeekday = WEEKDAYS[new Date().getDay()];

  const todaysLessons = groups.filter((g) => (g.scheduleDays || "").split(",").includes(todayWeekday)).length;
  const monthRevenue = payments.filter((p) => p.forMonth === currentMonth && p.status === "PAID").reduce((sum, p) => sum + p.amount, 0);
  const debtorsCount = useMemo(() => {
    return students.filter((s) => {
      const enrolled = s.enrollments || [];
      if (enrolled.length === 0) return false;
      const hasPricedGroup = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
      if (!hasPricedGroup) return false;
      return !payments.some((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID");
    }).length;
  }, [students, payments, currentMonth]);

  const { chartData, defaultActiveIdx } = useMemo(() => {
    const now = new Date();
    if (activityPeriod === "week") {
      const start = new Date(now);
      const dayOffset = (now.getDay() + 6) % 7; // Monday-first
      start.setDate(now.getDate() - dayOffset);
      const items = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return {
          label: t(WEEKDAY_SHORT_KEYS[d.getDay()]),
          value: attendance.filter((a) => a.date === dayStr).length,
          isCurrent: d.toDateString() === now.toDateString(),
        };
      });
      const currIdx = items.findIndex((it) => it.isCurrent);
      return { chartData: items, defaultActiveIdx: currIdx >= 0 ? currIdx : 0 };
    }

    if (activityPeriod === "day") {
      const dayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const dayRecords = attendance.filter((a) => a.date === dayStr);
      // Realistic study hours in educational centers
      const slots = [
        { label: "08:00 - 10:00", startH: 8, endH: 10 },
        { label: "10:00 - 12:00", startH: 10, endH: 12 },
        { label: "14:00 - 16:00", startH: 14, endH: 16 },
        { label: "16:00 - 18:00", startH: 16, endH: 18 },
        { label: "18:00 - 20:00", startH: 18, endH: 20 },
      ];

      const currentHour = now.getHours();
      let currIdx = 0;
      if (currentHour < 10) currIdx = 0;
      else if (currentHour < 12) currIdx = 1;
      else if (currentHour < 16) currIdx = 2;
      else if (currentHour < 18) currIdx = 3;
      else currIdx = 4;

      const items = slots.map((s, idx) => {
        const count = dayRecords.length > 0 ? Math.round(dayRecords.length / slots.length) : 0;
        return {
          label: s.label,
          value: count,
          isCurrent: idx === currIdx,
        };
      });

      return { chartData: items, defaultActiveIdx: currIdx };
    }

    // Month
    const months = Array.from({ length: 6 }, (_, i) =>
      localMonthStr(new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)),
    );
    const currMonthStr = localMonthStr(now);
    const items = months.map((m) => ({
      label: m.slice(5),
      value: attendance.filter((a) => a.date.startsWith(m)).length,
      isCurrent: m === currMonthStr,
    }));
    const currIdx = items.findIndex((it) => it.isCurrent);
    return { chartData: items, defaultActiveIdx: currIdx >= 0 ? currIdx : items.length - 1 };
  }, [attendance, activityPeriod, t]);


  const attendanceRate = useMemo(() => {
    const scoped =
      attendancePeriod === "day"
        ? attendance.filter((a) => a.date === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`)
        : attendancePeriod === "month"
          ? attendance.filter((a) => a.date.startsWith(currentMonth))
          : attendance;
    if (scoped.length === 0) return 0;
    const present = scoped.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    return Math.round((present / scoped.length) * 100);
  }, [attendance, attendancePeriod, currentMonth]);

  const groupFillRates = groups
    .map((g) => ({ group: g, enrolled: students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id)).length }))
    .sort((a, b) => b.enrolled - a.enrolled)
    .slice(0, 4);

  const paymentStatus = useMemo(() => {
    const thisMonth = payments.filter((p) => p.forMonth === currentMonth);
    const total = thisMonth.length || 1;
    const paid = thisMonth.filter((p) => p.status === "PAID").length;
    const pending = thisMonth.filter((p) => p.status === "PENDING").length;
    const failed = thisMonth.filter((p) => p.status === "FAILED").length;
    return {
      paid: Math.round((paid / total) * 100),
      pending: Math.round((pending / total) * 100),
      failed: Math.round((failed / total) * 100),
    };
  }, [payments, currentMonth]);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("dashboard.welcome")}, {user?.fullName?.split(" ")[0] ?? "boss"}</h1>
          <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
            {today} — {tenant?.name}
          </div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1FA463", background: "#E9F8EF", padding: "6px 14px", borderRadius: 100 }}>
          ● {t("dashboard.allSystemsOk")}
        </span>
      </div>

      <div style={{ padding: "26px 32px", display: "flex", flexDirection: "column", gap: 22, overflow: "auto" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("dashboard.loading")}</div>
        ) : (
          <>
            {groups.length > 0 && (
              <div
                style={{
                  background: "linear-gradient(135deg,#0F0B29,#1B1440)", borderRadius: 16, padding: "18px 24px",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(139,124,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B7B0E8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff" }}>
                      {aiLoading ? t("dashboard.aiAnalyzing") : t("dashboard.aiInsight")}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#B7B0E8", marginTop: 2 }}>
                      {aiPreview || t("dashboard.aiInsightDefault")}
                    </div>
                  </div>
                </div>
                <Link
                  href="/ai-insights"
                  className="btn"
                  style={{ display: "inline-block", flexShrink: 0, background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  {t("dashboard.viewAll")}
                </Link>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label={t("dashboard.statTodaysLessons")} value={String(todaysLessons)} />
              <StatCard label={t("dashboard.statActiveStudents")} value={String(students.length)} />
              <StatCard label={t("dashboard.statMonthRevenue")} value={`${formatMoney(monthRevenue)} ${t("common.sumUnit")}`} />
              <StatCard label={t("dashboard.statDebtors")} value={String(debtorsCount)} danger={debtorsCount > 0} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label={t("dashboard.statTeachersCount")} value={String(teachers.length)} />
              <StatCard label={t("dashboard.statTotalStudents")} value={String(students.length)} />
              <StatCard label={t("dashboard.statGroupsCount")} value={String(groups.length)} />
              <StatCard label={t("dashboard.statTotalLessons")} value={String(attendance.length)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("dashboard.attendanceActivity")}</div>
                  <PeriodPills
                    value={activityPeriod}
                    onChange={(v) => setActivityPeriod(v as typeof activityPeriod)}
                    options={[{ key: "day", label: t("dashboard.periodDay") }, { key: "week", label: t("dashboard.periodWeek") }, { key: "month", label: t("dashboard.periodMonth") }]}
                  />
                </div>
                <BarChartInline data={chartData} defaultActiveIdx={defaultActiveIdx} />
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("dashboard.lessonAttendance")}</div>
                  <PeriodPills
                    value={attendancePeriod}
                    onChange={(v) => setAttendancePeriod(v as typeof attendancePeriod)}
                    options={[{ key: "day", label: t("dashboard.periodDayShort") }, { key: "week", label: t("dashboard.periodWeekShort") }, { key: "month", label: t("dashboard.periodMonthShort") }]}
                  />
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DonutChart value={attendanceRate} max={100} color={ACCENT} label={t("dashboard.average")} />
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>{t("dashboard.groupFillRate")}</div>
                {groupFillRates.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("dashboard.noGroupsYet")}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {groupFillRates.map(({ group, enrolled }) => (
                      <ProgressBar
                        key={group.id}
                        label={group.name}
                        value={enrolled}
                        max={group.maxStudents || 1}
                        color={enrolled >= group.maxStudents ? "#1FA463" : ACCENT}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>{t("dashboard.paymentStatusThisMonth")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <ProgressBar label={t("dashboard.paid")} value={paymentStatus.paid} max={100} color="#1FA463" suffix={`${paymentStatus.paid}%`} />
                  <ProgressBar label={t("dashboard.pending")} value={paymentStatus.pending} max={100} color="#8A8D96" suffix={`${paymentStatus.pending}%`} />
                  <ProgressBar label={t("dashboard.overdue")} value={paymentStatus.failed} max={100} color="#B23A47" suffix={`${paymentStatus.failed}%`} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function BarChartInline({
  data,
  defaultActiveIdx = 0,
}: {
  data: { label: string; value: number }[];
  defaultActiveIdx?: number;
}) {
  const { t } = useLanguage();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // If user cleared or haven't clicked, activeIdx defaults to current day/hour
  const activeIdx = selectedIdx !== null ? selectedIdx : defaultActiveIdx;
  const max = Math.max(1, ...data.map((d) => d.value));
  const activeItem = data[activeIdx] || data[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Corner badge for active bar */}
      <div style={{ minHeight: 26, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        {activeItem ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#EEF0FF",
              color: ACCENT,
              border: "1px solid rgba(79, 70, 229, 0.25)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>
              {activeItem.label}: <strong>{activeItem.value}</strong> {t("groupDetail.colAttendance").toLowerCase()}
              {selectedIdx === null && (
                <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 4 }}>
                  (hozirgi)
                </span>
              )}
            </span>
            {selectedIdx !== null && (
              <button
                type="button"
                onClick={() => setSelectedIdx(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: ACCENT,
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: 13,
                  fontWeight: 800,
                  lineHeight: 1,
                }}
                title={t("common.clear")}
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: "#A0A3AB" }}>&nbsp;</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 135, position: "relative" }}>
        {data.map((d, i) => {
          const isActive = activeIdx === i;
          const isHovered = hoveredIdx === i;
          const barHeight = Math.max(6, (d.value / max) * 95);

          return (
            <div
              key={i}
              onClick={() => setSelectedIdx(i)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                position: "relative",
                userSelect: "none",
              }}
            >
              {/* Floating tooltip on hover */}
              {isHovered && !isActive && (
                <div
                  style={{
                    position: "absolute",
                    bottom: barHeight + 32,
                    background: "#181A1F",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 8px",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                    zIndex: 20,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    pointerEvents: "none",
                  }}
                >
                  {d.label}: {d.value}
                </div>
              )}

              <div
                style={{
                  width: "100%",
                  height: barHeight,
                  background: isActive ? ACCENT : isHovered ? "#D7D5FA" : "#ECEBFB",
                  borderRadius: 6,
                  transition: "background 0.18s ease, transform 0.18s ease",
                  transform: isHovered || isActive ? "scaleY(1.03)" : "scaleY(1)",
                  transformOrigin: "bottom",
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: isActive ? ACCENT : "#8A8D96",
                  fontWeight: isActive ? 800 : 600,
                  transition: "color 0.18s",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {d.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function StatCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      style={{
        background: danger ? "#FDEBEC" : "#fff",
        border: `1px solid ${danger ? "#F6D2D6" : "#EAE8E2"}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, color: danger ? "#B23A47" : "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: danger ? "#B23A47" : "#181A1F" }}>
        {value}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardContent />
    </DashboardShell>
  );
}
