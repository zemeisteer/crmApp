"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { salaryApi, type DashboardData, type TeacherPayrollItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";
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
  const tiles = [
    { label: t("th.todayLessons"), value: String(data.counts.todaysLessons) },
    { label: t("th.myStudents"), value: String(data.counts.activeStudents || studentsTotal) },
    { label: t("th.toReview"), value: String(data.homeworkToReview ?? 0), warn: (data.homeworkToReview ?? 0) > 0, href: "/homework" },
    { label: t("th.myPay"), value: pay === undefined ? "…" : pay ? `${money(pay.calculatedSalary)} ${t("common.sumUnit")}` : "—" },
  ];

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
        {tiles.map((c) => {
          const body = (
            <div style={{ background: c.warn ? "var(--warning-soft)" : "var(--surface)", border: `1px solid ${c.warn ? "var(--warning-border)" : "var(--border)"}`, borderRadius: "var(--radius-lg)", padding: 18, height: "100%", boxSizing: "border-box" }}>
              <div style={{ fontSize: 12, color: c.warn ? "var(--warning)" : "var(--text-muted)" }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4, color: c.warn ? "var(--warning)" : "var(--text)" }}>{c.value}</div>
            </div>
          );
          return c.href ? <Link key={c.label} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : <div key={c.label}>{body}</div>;
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("th.todaysLessons")}</div>
            <Link href="/schedule" style={{ fontSize: 12, color: ACCENT, fontWeight: 600, textDecoration: "none" }}>{t("dashboard.openTimetable")} →</Link>
          </div>
          {data.todaysLessons.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noLessonsToday")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.todaysLessons.map((l) => {
                const done = l.status === "DONE";
                return (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14, color: ACCENT, minWidth: 48 }}>{l.startTime ?? "—"}</div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {l.students} {t("dash.studentsShort")}
                        {done && l.marked ? ` · ${t("dash.lessonDone")} ${l.present}/${l.marked}` : ""}
                      </div>
                    </div>
                    <Link
                      href={`/groups/${l.id}`}
                      className="btn"
                      style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-sm)", textDecoration: "none", ...(done ? { background: "var(--success-soft)", color: "var(--success)" } : { background: ACCENT, color: "var(--on-ink)" }) }}
                    >
                      {done ? `✓ ${t("th.marked")}` : t("th.markAttendance")}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("th.myGroups")}</div>
          {data.groupFill.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("th.noGroups")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.groupFill.map((g) => (
                <Link key={g.id} href={`/groups/${g.id}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "var(--text)" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: "var(--primary-soft)", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>{initials(g.name)}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{g.students}/{g.maxStudents}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {pay && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t("th.payTitle")}</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "var(--text-soft)" }}>
            <div>
              {t("th.payCalculated")}: <b style={{ color: "var(--text)" }}>{money(pay.calculatedSalary)} {t("common.sumUnit")}</b>
            </div>
            {pay.details.plannedLessons !== undefined && (
              <div>
                {t("th.lessons")}: <b style={{ color: "var(--text)" }}>{pay.details.plannedLessons - (pay.details.absentLessons ?? 0)}/{pay.details.plannedLessons}</b>
              </div>
            )}
            {(pay.details.absentLessons ?? 0) > 0 && (
              <div style={{ color: "var(--danger)" }}>
                {t("th.missed")}: <b>{pay.details.absentLessons}</b>
                {pay.details.deduction ? ` (−${money(pay.details.deduction)} ${t("common.sumUnit")})` : ""}
              </div>
            )}
            <div>
              {t("th.paidOut")}: <b style={{ color: pay.isPaid ? "var(--success)" : "var(--text)" }}>{money(pay.paidAmount)} {t("common.sumUnit")}</b>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
