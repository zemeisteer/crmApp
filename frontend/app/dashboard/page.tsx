"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import BarChart, { DonutChart } from "@/components/BarChart";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { reportsApi, announcementsApi, aiApi, Announcement, type DashboardData } from "@/lib/api";
import { MONTH_KEYS, MONTH_SHORT_KEYS, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";
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
  // Aggregated on the server (GET /reports/dashboard) instead of loading
  // every group, student, payment and attendance row into the browser.
  const [data, setData] = useState<DashboardData | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const [activityPeriod, setActivityPeriod] = useState<"day" | "week" | "month">("week");
  const [attendancePeriod, setAttendancePeriod] = useState<"day" | "week" | "month">("week");

  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    Promise.all([reportsApi.dashboard().catch(() => null), announcementsApi.list().catch(() => [])])
      .then(([d, ann]) => {
        setData(d);
        setAnnouncements(ann);
      })
      .finally(() => setLoading(false));
  }, []);

  const firstGroupId = data?.groupFill[0]?.id;
  useEffect(() => {
    if (!firstGroupId) return;
    setAiLoading(true);
    aiApi
      .groupInsights(firstGroupId)
      .then((res) => setAiPreview(res.insight.split("\n")[0]))
      .catch(() => setAiPreview(null))
      .finally(() => setAiLoading(false));
  }, [firstGroupId]);

  const today = formatDate(new Date(), lang, "long");
  const counts = data?.counts;
  const finance = data?.finance ?? null;

  const { chartData, defaultActiveIdx } = useMemo(() => {
    const att = data?.attendance;
    if (!att) return { chartData: [], defaultActiveIdx: 0 };
    if (activityPeriod === "week") {
      const items = att.week.map((d) => ({
        label: t(WEEKDAY_SHORT_KEYS[d.weekday % 7]),
        value: d.marks,
        isCurrent: d.date === data.today,
      }));
      const idx = items.findIndex((i) => i.isCurrent);
      return { chartData: items, defaultActiveIdx: idx >= 0 ? idx : 0 };
    }
    if (activityPeriod === "day") {
      // The last 14 days, one bar per day.
      const items = att.days.map((d) => {
        const [, m, day] = d.date.split("-").map(Number);
        return { label: String(day), title: `${day} ${t(MONTH_KEYS[m - 1])}`, value: d.marks, isCurrent: d.date === data.today };
      });
      return { chartData: items, defaultActiveIdx: items.length - 1 };
    }
    // January to December of this year.
    const items = att.months.map((m) => {
      const idx = Number(m.month.slice(5)) - 1;
      return { label: t(MONTH_SHORT_KEYS[idx]), title: t(MONTH_KEYS[idx]), value: m.marks, isCurrent: m.month === data.today.slice(0, 7) };
    });
    return { chartData: items, defaultActiveIdx: items.findIndex((i) => i.isCurrent) };
  }, [data, activityPeriod, t]);

  const revenueData = useMemo(
    () =>
      (finance?.revenueByMonth ?? []).map((m) => {
        const idx = Number(m.month.slice(5)) - 1;
        return { label: t(MONTH_SHORT_KEYS[idx]), title: t(MONTH_KEYS[idx]), value: m.amount, isCurrent: m.month === data?.today.slice(0, 7) };
      }),
    [finance, data, t],
  );

  const attendanceRate = data?.attendance.rates[attendancePeriod] ?? null;

  const paymentStatus = useMemo(() => {
    const ps = finance?.paymentStatus;
    const total = ps?.total || 1;
    return {
      paid: ps ? Math.round((ps.paid / total) * 100) : 0,
      pending: ps ? Math.round((ps.pending / total) * 100) : 0,
      failed: ps ? Math.round((ps.failed / total) * 100) : 0,
    };
  }, [finance]);

  const activeBroadcasts = useMemo(() => {
    return announcements.filter((a) => a.priority === "URGENT" || a.priority === "HIGH").slice(0, 2);
  }, [announcements]);

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
            {activeBroadcasts.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {activeBroadcasts.map((b) => (
                  <div
                    key={b.id}
                    className={`rounded-2xl p-4 flex items-center justify-between gap-4 border transition ${
                      b.priority === "URGENT"
                        ? "bg-rose-50 border-rose-200 text-rose-950"
                        : "bg-amber-50 border-amber-200 text-amber-950"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          b.priority === "URGENT"
                            ? "bg-rose-100 text-rose-600"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m3 11 18-5v12L3 14v-3z" />
                          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              b.priority === "URGENT" ? "bg-rose-600 text-white" : "bg-amber-500 text-slate-900"
                            }`}
                          >
                            {b.priority === "URGENT" ? "Shoshilinch" : "Muhim"}
                          </span>
                          <span className={`text-sm font-bold truncate ${b.priority === "URGENT" ? "text-rose-950" : "text-amber-950"}`}>
                            {b.title}
                          </span>
                        </div>
                        <p className={`text-xs truncate mt-0.5 max-w-xl font-medium ${b.priority === "URGENT" ? "text-rose-800" : "text-amber-900"}`}>
                          {b.content}
                        </p>
                      </div>
                    </div>

                    <Link
                      href="/announcements"
                      className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl border transition ${
                        b.priority === "URGENT"
                          ? "bg-white border-rose-300 text-rose-700 hover:bg-rose-100"
                          : "bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
                      }`}
                    >
                      Batafsil →
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {(counts?.activeGroups ?? 0) > 0 && (
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
              <StatCard label={t("dashboard.statTodaysLessons")} value={String(counts?.todaysLessons ?? 0)} />
              <StatCard label={t("dashboard.statActiveStudents")} value={String(counts?.activeStudents ?? 0)} />
              {finance ? (
                <>
                  <StatCard label={t("dashboard.statMonthRevenue")} value={`${formatMoney(finance.monthRevenue)} ${t("common.sumUnit")}`} />
                  <StatCard label={t("dashboard.statDebtors")} value={String(finance.debtorCount)} danger={finance.debtorCount > 0} />
                </>
              ) : (
                <>
                  <StatCard label={t("dashboard.statGroupsCount")} value={String(counts?.activeGroups ?? 0)} />
                  <StatCard label={t("dashboard.statTotalLessons")} value={String(counts?.attendanceMarks ?? 0)} />
                </>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label={t("dashboard.statTeachersCount")} value={String(counts?.teachers ?? 0)} />
              <StatCard label={t("dashboard.statTotalStudents")} value={String(counts?.activeStudents ?? 0)} />
              <StatCard label={t("dashboard.statGroupsCount")} value={String(counts?.activeGroups ?? 0)} />
              <StatCard label={t("dashboard.statTotalLessons")} value={String(counts?.attendanceMarks ?? 0)} />
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
                <BarChart data={chartData} defaultActiveIdx={defaultActiveIdx} unit={t("dashboard.marksUnit")} emptyText={t("dashboard.noMarksYet")} />
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
                  <DonutChart value={attendanceRate ?? 0} max={100} color={ACCENT} label={attendanceRate === null ? "—" : t("dashboard.average")} />
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>{t("dashboard.groupFillRate")}</div>
                {(data?.groupFill.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("dashboard.noGroupsYet")}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {data!.groupFill.map((g) => (
                      <ProgressBar
                        key={g.id}
                        label={g.name}
                        value={g.students}
                        max={g.maxStudents || 1}
                        color={g.students >= g.maxStudents ? "#1FA463" : ACCENT}
                      />
                    ))}
                  </div>
                )}
              </div>
              {finance && <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>{t("dashboard.paymentStatusThisMonth")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <ProgressBar label={t("dashboard.paid")} value={paymentStatus.paid} max={100} color="#1FA463" suffix={`${paymentStatus.paid}%`} />
                  <ProgressBar label={t("dashboard.pending")} value={paymentStatus.pending} max={100} color="#8A8D96" suffix={`${paymentStatus.pending}%`} />
                  <ProgressBar label={t("dashboard.overdue")} value={paymentStatus.failed} max={100} color="#B23A47" suffix={`${paymentStatus.failed}%`} />
                </div>
              </div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: finance ? "1.4fr 1fr" : "1fr", gap: 16 }}>
              {finance && (
                <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("dashboard.revenueByMonth")}</div>
                    <div style={{ fontSize: 12, color: "#8A8D96" }}>
                      {t("dashboard.yearTotal")}: <strong style={{ color: "#1FA463" }}>{formatMoney(finance.revenueByMonth.reduce((s, m) => s + m.amount, 0))} {t("common.sumUnit")}</strong>
                    </div>
                  </div>
                  <BarChart data={revenueData} color="#1FA463" formatValue={(v) => formatMoney(v)} unit={t("common.sumUnit")} emptyText={t("dashboard.noPaymentsYet")} />
                </div>
              )}
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("dashboard.todaysLessonsList")}</div>
                  <Link href="/schedule" style={{ fontSize: 12, color: ACCENT, fontWeight: 600, textDecoration: "none" }}>{t("dashboard.openTimetable")} →</Link>
                </div>
                {(data?.todaysLessons.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("dashboard.noLessonsToday")}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data!.todaysLessons.map((l) => (
                      <Link key={l.id} href={`/groups/${l.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "#F7F6F2", textDecoration: "none", color: "#181A1F" }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: ACCENT, minWidth: 44 }}>{l.startTime ?? "—"}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
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
