"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { salaryApi, type DashboardData, type TeacherPayrollItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { Card, CardHeader, CountUp, Stat } from "@/components/ui";

const PASTELS = ["var(--lav)", "var(--sky)", "var(--mint)", "var(--peach)"];
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

// Home page for a signed-in teacher: today's lessons with a shortcut to
// marking attendance, their groups, hand-ins to grade and this month's pay.
export default function TeacherHome({ data }: { data: DashboardData }) {
  const { t } = useLanguage();
  const [pay, setPay] = useState<TeacherPayrollItem | null | undefined>(undefined);

  useEffect(() => {
    // No month: the server uses the center's current month.
    salaryApi.mine().then(setPay).catch(() => setPay(null));
  }, []);

  const studentsTotal = data.groupFill.reduce((s, g) => s + g.students, 0);
  const toReview = data.homeworkToReview ?? 0;
  const next = data.todaysLessons.find((l) => l.status !== "DONE");

  return (
    <div className="dash-grid">
      {/* KPIs */}
      <Card index={0} className="c12" padding="18px 22px">
        <div className="teacher-kpis">
          <Stat label={t("th.todayLessons")} value={data.counts.todaysLessons} />
          <Stat label={t("th.myStudents")} value={data.counts.activeStudents || studentsTotal} />
          <Link href="/homework" style={{ color: "inherit", textDecoration: "none" }}>
            <Stat label={t("th.toReview")} value={toReview} tone={toReview > 0 ? "danger" : undefined} chip={toReview > 0 ? <span className="badge badge-warning">→</span> : undefined} />
          </Link>
          <Stat label={t("th.myPay")} value={pay === undefined ? "…" : pay ? `${money(pay.calculatedSalary)} ${t("common.sumUnit")}` : "—"} />
        </div>
      </Card>

      {/* Today's lessons, with the shortcut to marking attendance. */}
      <Card index={1} lift className="c8">
        <CardHeader title={t("th.todaysLessons")} action={<Link href="/schedule" className="dash-link">{t("dashboard.openTimetable")} →</Link>} />
        {data.todaysLessons.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noLessonsToday")}</div>
        ) : (
          <div className="dash-list">
            {data.todaysLessons.map((l, i) => {
              const done = l.status === "DONE";
              return (
                <div key={l.id} className="dash-row" style={{ flexWrap: "wrap" }}>
                  <span className="dash-ico" style={{ background: PASTELS[i % PASTELS.length], color: "var(--text)", width: 54, flexBasis: 54, fontSize: 13 }}>{l.startTime ?? "—"}</span>
                  <span style={{ flex: 1, minWidth: 120 }}>
                    <span className="dash-row-title">{l.name}</span>
                    <span className="dash-row-sub">
                      {l.students} {t("dash.studentsShort")}
                      {done && l.marked ? ` · ${t("dash.lessonDone")} ${l.present}/${l.marked}` : ""}
                    </span>
                  </span>
                  <Link href={`/groups/${l.id}`} className={done ? "btn badge badge-success" : "btn-primary btn-sm"} style={done ? { padding: "7px 12px" } : undefined}>
                    {done ? `✓ ${t("th.marked")}` : t("th.markAttendance")}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* The hero: what is next today. */}
      <Card tone="accent" index={2} lift className="c4 dash-hero">
        <h3 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{t("th.todayLessons")}</h3>
        <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>{next ? `${next.startTime ?? ""} · ${next.name}` : t("dashboard.noLessonsToday")}</div>
        {next && (
          <Link href={`/groups/${next.id}`} className="dash-hero-btn">
            {t("th.markAttendance")} →
          </Link>
        )}
        <div className="dash-hero-big">
          <span><CountUp value={data.counts.todaysLessons} /></span>
          <small>{t("dash.heroLessonsHint")}</small>
        </div>
      </Card>

      {/* My groups, as pastel cards. */}
      <Card index={3} lift className={pay ? "c5" : "c12"}>
        <CardHeader title={t("th.myGroups")} />
        {data.groupFill.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("th.noGroups")}</div>
        ) : (
          <div className="dash-groups">
            {data.groupFill.map((g, i) => (
              <Link key={g.id} href={`/groups/${g.id}`} className="dash-group" style={{ background: PASTELS[i % PASTELS.length], display: "flex", alignItems: "center", gap: 12 }}>
                <span className="dash-ico" aria-hidden="true">{initials(g.name)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-soft)", whiteSpace: "nowrap" }}>{g.students}/{g.maxStudents}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {pay && (
        <Card index={4} lift className="c7">
          <CardHeader title={t("th.payTitle")} />
          <div className="dash-list">
            <div className="dash-row">
              <span className="dash-row-title" style={{ flex: 1 }}>{t("th.payCalculated")}</span>
              <b style={{ fontSize: 18, fontWeight: 600 }}>{money(pay.calculatedSalary)} {t("common.sumUnit")}</b>
            </div>
            {pay.details.plannedLessons !== undefined && (
              <div className="dash-row">
                <span className="dash-row-title" style={{ flex: 1 }}>{t("th.lessons")}</span>
                <b style={{ fontSize: 16, fontWeight: 600 }}>{pay.details.plannedLessons - (pay.details.absentLessons ?? 0)}/{pay.details.plannedLessons}</b>
              </div>
            )}
            {(pay.details.absentLessons ?? 0) > 0 && (
              <div className="dash-row" style={{ color: "var(--danger)" }}>
                <span className="dash-row-title" style={{ flex: 1 }}>{t("th.missed")}</span>
                <b>
                  {pay.details.absentLessons}
                  {pay.details.deduction ? ` (−${money(pay.details.deduction)} ${t("common.sumUnit")})` : ""}
                </b>
              </div>
            )}
            <div className="dash-row">
              <span className="dash-row-title" style={{ flex: 1 }}>{t("th.paidOut")}</span>
              <b style={{ fontSize: 16, fontWeight: 600, color: pay.isPaid ? "var(--success)" : "var(--text)" }}>{money(pay.paidAmount)} {t("common.sumUnit")}</b>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
