"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import BarChart, { DonutChart } from "@/components/BarChart";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { useLanguage } from "@/lib/i18n-context";
import { DashboardSkeleton } from "@/components/Skeleton";
import { reportsApi, type DashboardData, type ReportsOverview } from "@/lib/api";
import { buildInsights } from "@/lib/insights";
import TeacherHome from "@/components/dashboard/TeacherHome";
import AnnouncementBanners from "@/components/dashboard/AnnouncementBanners";
import { MONTH_KEYS, MONTH_SHORT_KEYS, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import FirstSteps from "@/components/FirstSteps";
import { canOpenPath } from "@/components/Sidebar";
import { Card, CardHeader, CountUp, LineChart, PageHeader, PillTabs, ProgressBar, Stat } from "@/components/ui";

// Group cards cycle through the pastels.
const PASTELS = ["var(--lav)", "var(--sky)", "var(--mint)", "var(--peach)"];
const WEEKDAY_SHORT_KEYS: TranslationKey[] = [
  "weekday.short.sunday", "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday",
  "weekday.short.thursday", "weekday.short.friday", "weekday.short.saturday",
];

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

// 24 500 000 -> "24.5M", 850 000 -> "850K" (stat tiles).
function compactMoney(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return formatMoney(n);
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** A labelled progress row (payment status, group fill). */
function ProgressRow({ label, value, max, color, suffix, index }: { label: string; value: number; max: number; color: string; suffix?: string; index: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{suffix ?? `${value}/${max}`}</span>
      </div>
      <ProgressBar value={pct} color={color} index={index} label={label} />
    </div>
  );
}

function DashboardContent() {
  const { user, tenant } = useAuth();
  const seesReport = can(user, "reports.finance");
  const { t, lang } = useLanguage();
  // Aggregated on the server (GET /reports/dashboard) instead of loading
  // every group, student, payment and attendance row into the browser.
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const [activityPeriod, setActivityPeriod] = useState<"day" | "week" | "month">("week");
  const [attendancePeriod, setAttendancePeriod] = useState<"day" | "week" | "month">("week");

  // Same recommendations as the AI insights page (teachers may not read
  // the full report; the banner then keeps its generic text).
  const [report, setReport] = useState<ReportsOverview | null>(null);

  useEffect(() => {
    reportsApi.dashboard()
      .catch(() => null)
      .then(setData)
      .finally(() => setLoading(false));
    // The full report is finance data; others get only their own dashboard.
    if (seesReport) reportsApi.overview().then(setReport).catch(() => setReport(null));
  }, [seesReport]);

  const insights = useMemo(() => (report ? buildInsights(report, t) : null), [report, t]);
  const urgent = insights ? insights.filter((i) => i.severity === "high" || i.severity === "medium") : [];

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
      // Today's lessons by their start time.
      const items = att.todayBySlot.map((slot) => ({ label: slot.startTime, value: slot.marks }));
      return { chartData: items, defaultActiveIdx: 0 };
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

  const firstName = user?.fullName?.split(" ")[0] ?? "boss";
  const seesGroups = canOpenPath("/groups", user?.role, !!tenant, user?.access);
  const seesSchedule = canOpenPath("/schedule", user?.role, !!tenant, user?.access);
  const isTeacher = user?.role === "TEACHER";
  const periodTabs = (short: boolean) => [
    { id: "day" as const, label: t(short ? "dashboard.periodDayShort" : "dashboard.periodDay") },
    { id: "week" as const, label: t(short ? "dashboard.periodWeekShort" : "dashboard.periodWeek") },
    { id: "month" as const, label: t(short ? "dashboard.periodMonthShort" : "dashboard.periodMonth") },
  ];

  return (
    <div className="page-pad">
      <PageHeader eyebrow={`${today} · ${tenant?.name ?? ""}`} title={`${t("dashboard.welcome")}, ${firstName}`}>
        {!loading && data && !isTeacher && (
          <>
            <Stat index={1} label={t("dashboard.statActiveStudents")} value={counts?.activeStudents ?? 0} />
            {finance ? (
              <Stat index={2} label={t("dashboard.statDebtors")} value={finance.debtorCount} tone={finance.debtorCount > 0 ? "danger" : undefined} />
            ) : (
              <Stat index={2} label={t("dashboard.statGroupsCount")} value={counts?.activeGroups ?? 0} />
            )}
            <Stat index={3} label={t("dashboard.lessonAttendance")} value={data.attendance.rates.week === null ? "—" : data.attendance.rates.week} format={(n) => `${Math.round(n)}%`} />
            <Stat index={4} label={t("dashboard.statTodaysLessons")} value={counts?.todaysLessons ?? 0} />
          </>
        )}
      </PageHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <FirstSteps />
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <AnnouncementBanners />

            {isTeacher && data ? (
              <TeacherHome data={data} />
            ) : (
            <>
            {(counts?.activeGroups ?? 0) > 0 && (
              <Card tone="ink" index={0} padding="16px 20px" className="dash-ai">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                    <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: "var(--radius-pill)", background: "var(--accent-strong)", display: "grid", placeItems: "center", flexShrink: 0, color: "var(--on-color)" }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
                      </svg>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {insights === null
                          ? t("dashboard.aiInsight")
                          : urgent.length > 0
                            ? t("dash.aiCount").replace("{n}", String(urgent.length))
                            : t("dash.aiAllGood")}
                      </div>
                      <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {insights === null
                          ? t("dashboard.aiInsightDefault")
                          : urgent.length > 0
                            ? `${urgent.slice(0, 2).map((i) => i.title).join(", ")}${urgent.length > 2 ? ` ${t("dash.aiAndMore")}` : ""}`
                            : t("dash.aiAllGoodHint")}
                      </div>
                    </div>
                  </div>
                  <Link href="/ai-insights" className="btn" style={{ flexShrink: 0, background: "var(--on-ink)", color: "var(--ink)", fontSize: 12.5, fontWeight: 600, padding: "9px 16px", borderRadius: "var(--radius-pill)" }}>
                    {t("dashboard.viewAll")}
                  </Link>
                </div>
              </Card>
            )}

            <div className="dash-grid">
              {/* Groups, as pastel cards with how full each is. */}
              <Card index={1} lift className="c3 r2">
                <CardHeader
                  title={t("nav.groups")}
                  subtitle={t("dash.groupsHint")}
                  action={seesGroups ? <Link href="/groups" className="dash-round" aria-label={t("nav.groups")}>↗</Link> : undefined}
                />
                {(data?.groupFill.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noGroupsYet")}</div>
                ) : (
                  <div className="dash-groups">
                    {data!.groupFill.map((g, i) => {
                      const full = g.students >= g.maxStudents;
                      return (
                        <div key={g.id} className="dash-group" style={{ background: PASTELS[i % PASTELS.length] }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "8px 0 8px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-soft)" }}>
                              <em className="dash-count">{g.students}</em>/ {g.maxStudents || "—"}
                            </span>
                            {full && <span className="badge badge-success">✓</span>}
                          </div>
                          <ProgressBar value={g.maxStudents ? (g.students / g.maxStudents) * 100 : 0} color={full ? "var(--success)" : "var(--ink)"} index={i} label={g.name} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Attendance activity (day / week / month). */}
              <Card index={2} lift className="c6">
                <CardHeader
                  title={t("dashboard.attendanceActivity")}
                  action={<PillTabs size="sm" label={t("dashboard.attendanceActivity")} tabs={periodTabs(false)} value={activityPeriod} onChange={setActivityPeriod} />}
                />
                <BarChart color="var(--ink)" data={chartData} defaultActiveIdx={defaultActiveIdx} unit={t("dashboard.marksUnit")} emptyText={activityPeriod === "day" ? (chartData.length === 0 ? t("dashboard.noLessonsToday") : undefined) : t("dashboard.noMarksYet")} />
              </Card>

              {/* The page's one hero: this month's money, or today's lessons. */}
              <Card tone="accent" index={3} lift className="c3 dash-hero">
                {finance ? (
                  <>
                    <h3 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{t("dashboard.statMonthRevenue")}</h3>
                    <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>{t("dashboard.paymentStatusThisMonth")}</div>
                    <Link href="/payments" className="dash-hero-btn">⊕ {t("nav.payments")}</Link>
                    <div className="dash-hero-big" title={`${formatMoney(finance.monthRevenue)} ${t("common.sumUnit")}`}>
                      <span><CountUp value={finance.monthRevenue} format={(n) => compactMoney(Math.round(n))} /></span>
                      <small>{t("dash.heroRevenueHint")}</small>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{t("dashboard.todaysLessonsList")}</h3>
                    <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>{today}</div>
                    {seesSchedule && <Link href="/schedule" className="dash-hero-btn">{t("dashboard.openTimetable")} →</Link>}
                    <div className="dash-hero-big">
                      <span><CountUp value={counts?.todaysLessons ?? 0} /></span>
                      <small>{t("dash.heroLessonsHint")}</small>
                    </div>
                  </>
                )}
              </Card>

              {/* Average attendance (day / week / month). */}
              <Card index={4} lift className="c4">
                <CardHeader
                  title={t("dashboard.lessonAttendance")}
                  action={<PillTabs size="sm" label={t("dashboard.lessonAttendance")} tabs={periodTabs(true)} value={attendancePeriod} onChange={setAttendancePeriod} />}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0" }}>
                  <DonutChart value={attendanceRate ?? 0} max={100} size={150} color="var(--accent)" label={attendanceRate === null ? "—" : t("dashboard.average")} />
                </div>
              </Card>

              {finance ? (
                <Card index={5} lift className="c5">
                  <CardHeader title={t("dashboard.paymentStatusThisMonth")} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <ProgressRow index={0} label={t("dashboard.paid")} value={paymentStatus.paid} max={100} color="var(--success)" suffix={`${paymentStatus.paid}%`} />
                    <ProgressRow index={1} label={t("dashboard.pending")} value={paymentStatus.pending} max={100} color="var(--text-faint)" suffix={`${paymentStatus.pending}%`} />
                    <ProgressRow index={2} label={t("dashboard.overdue")} value={paymentStatus.failed} max={100} color="var(--danger)" suffix={`${paymentStatus.failed}%`} />
                  </div>
                </Card>
              ) : (
                <GlanceCard counts={counts} className="c5" index={5} />
              )}

              {/* Today's lessons. */}
              <Card index={6} className={finance ? "c7" : "c12"}>
                <CardHeader
                  title={t("dashboard.todaysLessonsList")}
                  action={seesSchedule ? <Link href="/schedule" className="dash-link">{t("dashboard.openTimetable")} →</Link> : undefined}
                />
                {(data?.todaysLessons.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noLessonsToday")}</div>
                ) : (
                  <div className="dash-list">
                    {data!.todaysLessons.map((l, i) => {
                      const badge =
                        l.status === "DONE"
                          ? { text: `${t("dash.lessonDone")}${l.marked ? ` · ${l.present}/${l.marked}` : ""}`, cls: "badge-success" }
                          : l.status === "UNMARKED"
                            ? { text: t("dash.lessonUnmarked"), cls: "badge-warning" }
                            : { text: t("dash.lessonPlanned"), cls: "badge-neutral" };
                      return (
                        <Link key={l.id} href={`/groups/${l.id}`} className="dash-row">
                          <span className="dash-ico" style={{ background: PASTELS[i % PASTELS.length], color: "var(--text)" }}>{initials(l.name)}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="dash-row-title">{l.name}</span>
                            <span className="dash-row-sub">{[l.startTime ?? "—", l.teacherName, `${l.students} ${t("dash.studentsShort")}`].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className={`badge ${badge.cls}`} style={{ flexShrink: 0 }}>{badge.text}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Card>

              {finance && (
                <Card index={7} className="c5">
                  <CardHeader title={t("dash.debtorsList")} action={<Link href="/payments" className="dash-link">{t("dashboard.viewAll")}</Link>} />
                  {finance.topDebtors.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 600 }}>✓ {t("dash.noDebtors")}</div>
                  ) : (
                    <div className="dash-list">
                      {finance.topDebtors.map((d) => (
                        <Link key={d.studentId} href={`/students/${d.studentId}`} className="dash-row">
                          <span className="dash-ico" style={{ background: "var(--danger-soft)", color: "var(--danger)", borderRadius: "var(--radius-pill)" }}>{initials(d.fullName)}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="dash-row-title">{d.fullName}</span>
                            <span className="dash-row-sub">{d.groups.join(", ") || "—"}</span>
                          </span>
                          <span style={{ textAlign: "right", flexShrink: 0 }}>
                            <span style={{ display: "block", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatMoney(d.debt)} {t("common.sumUnit")}</span>
                            <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--danger)" }}>
                              {d.overdueDays !== null ? t("dash.daysLate").replace("{n}", String(d.overdueDays)) : t("dash.unpaidThisMonth")}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {finance && (
                <Card index={8} className="c8">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                    <CardHeader title={t("dashboard.revenueByMonth")} />
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      {t("dashboard.yearTotal")}: <strong style={{ color: "var(--text)", fontSize: 15 }}>{formatMoney(finance.revenueByMonth.reduce((s, m) => s + m.amount, 0))} {t("common.sumUnit")}</strong>
                    </div>
                  </div>
                  <LineChart
                    label={t("dashboard.revenueByMonth")}
                    data={revenueData}
                    color="var(--accent)"
                    format={(v) => formatMoney(v)}
                    unit={t("common.sumUnit")}
                    emptyText={t("dashboard.noPaymentsYet")}
                  />
                </Card>
              )}
              {finance && <GlanceCard counts={counts} className="c4" index={9} />}
            </div>
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Teachers, students, groups and lessons marked: the counts that frame the rest. */
function GlanceCard({ counts, className, index }: { counts: DashboardData["counts"] | undefined; className: string; index: number }) {
  const { t } = useLanguage();
  const items = [
    { label: t("dashboard.statTeachersCount"), value: counts?.teachers ?? 0, icon: "◆" },
    { label: t("dashboard.statTotalStudents"), value: counts?.activeStudents ?? 0, icon: "●" },
    { label: t("dashboard.statGroupsCount"), value: counts?.activeGroups ?? 0, icon: "▲" },
    { label: t("dashboard.statTotalLessons"), value: counts?.attendanceMarks ?? 0, icon: "■" },
  ];
  return (
    <Card index={index} lift className={className}>
      <CardHeader title={t("dash.atGlance")} />
      <div className="dash-list">
        {items.map((it) => (
          <div key={it.label} className="dash-row" style={{ cursor: "default" }}>
            <span className="dash-ico" aria-hidden="true">{it.icon}</span>
            <span className="dash-row-title" style={{ flex: 1 }}>{it.label}</span>
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}><CountUp value={it.value} /></span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardContent />
    </DashboardShell>
  );
}
