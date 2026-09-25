"use client";

import Link from "next/link";
import type { ReportsOverview as Report } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 };
const title: React.CSSProperties = { fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 };

const METHOD_KEYS: Record<string, TranslationKey> = {
  CASH: "payment.methodCash",
  CLICK: "payment.methodClick",
  PAYME: "payment.methodPayme",
  BANK_TRANSFER: "payment.methodBankTransfer",
};

function money(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 12, color: "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: danger ? "#B91C1C" : "#181A1F" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Bar({ value, max, color = ACCENT }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 7, background: "#F1F0EC", borderRadius: 5, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 5 }} />
    </div>
  );
}

export default function ReportsOverview({
  report,
  view,
  onSms,
}: {
  report: Report;
  view: "overview" | "retention";
  onSms: (s: { id: string; fullName: string; phone: string | null }) => void;
}) {
  const { t } = useLanguage();
  const { students, groups, attendance, finance, admissions, atRisk } = report;
  const sum = t("common.sumUnit");

  if (view === "retention") {
    const byOccupancy = [...groups.items].sort((a, b) => (b.occupancy ?? 0) - (a.occupancy ?? 0));
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="adm-stats">
          <Stat label={t("rep.atRisk")} value={String(atRisk.length)} danger={atRisk.length > 0} />
          <Stat label={t("rep.attendanceRate")} value={pctText(attendance.rate)} sub={`${attendance.marks} ${t("rep.marks")}`} />
          <Stat label={t("rep.avgOccupancy")} value={pctText(groups.averageOccupancy)} />
          <Stat label={t("rep.activeStudents")} value={String(students.active)} />
        </div>

        <section style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ ...title, padding: "16px 20px 0" }}>{t("rep.atRiskTitle")}</div>
          <p style={{ fontSize: 12, color: "#8A8D96", padding: "0 20px" }}>{t("rep.atRiskHint")}</p>
          {atRisk.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "#15803D", background: "#F0FDF4" }}>{t("rep.noRisk")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t("reports.colStudents")}</th>
                    <th>{t("rep.risk")}</th>
                    <th>{t("rep.attendanceRate")}</th>
                    <th>{t("rep.overdue")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{s.fullName}</div>
                        <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{s.phone || "—"}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6, background: s.risk === "HIGH" ? "#FEE2E2" : "#FEF3C7", color: s.risk === "HIGH" ? "#B91C1C" : "#B45309" }}>
                          {s.risk === "HIGH" ? t("rep.riskHigh") : t("rep.riskMedium")}
                        </span>
                      </td>
                      <td>{pctText(s.attendanceRate)}</td>
                      <td style={{ color: s.overdueAmount > 0 ? "#B91C1C" : undefined, fontWeight: s.overdueAmount > 0 ? 700 : 400 }}>
                        {s.overdueAmount > 0 ? `${money(s.overdueAmount)} ${sum}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {s.phone && (
                          <button type="button" className="btn" onClick={() => onSms({ id: s.studentId, fullName: s.fullName, phone: s.phone })}
                            style={{ background: "#EEF0FF", color: ACCENT, border: "1px solid #C7D2FE", padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 700, marginRight: 6 }}>
                            SMS
                          </button>
                        )}
                        <Link href={`/students/${s.studentId}`} style={{ fontSize: 12, fontWeight: 700, color: "#181A1F" }}>{t("common.viewProfile")} →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section style={card}>
          <div style={title}>{t("rep.occupancyTitle")}</div>
          {byOccupancy.length === 0 ? (
            <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("reports.noGroups")}</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {byOccupancy.map((g) => (
                <div key={g.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                    <span>{g.name}</span>
                    <span>{g.students}/{g.maxStudents} · {pctText(g.occupancy)}</span>
                  </div>
                  <Bar value={g.students} max={g.maxStudents} color={(g.occupancy ?? 0) < 40 ? "#D97706" : ACCENT} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  const maxReg = Math.max(1, ...students.registrationsByMonth.map((r) => r.count));
  const methods = finance ? Object.entries(finance.revenueByMethod).sort((a, b) => b[1] - a[1]) : [];
  const methodTotal = methods.reduce((s, [, v]) => s + v, 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="adm-stats">
        <Stat label={t("rep.activeStudents")} value={String(students.active)} sub={`+${students.newThisMonth} ${t("rep.newThisMonth")}`} />
        <Stat label={t("rep.attendanceRate")} value={pctText(attendance.rate)} sub={`${attendance.marks} ${t("rep.marks")}`} />
        {finance ? (
          <>
            <Stat label={t("rep.collected")} value={`${money(finance.collected)} ${sum}`} sub={`${t("rep.collectionRate")}: ${pctText(finance.collectionRate)}`} />
            <Stat
              label={t("rep.ytd")}
              value={`${money(finance.yearToDate.thisYear)} ${sum}`}
              sub={finance.yearToDate.growth === null ? t("rep.noLastYear") : `${finance.yearToDate.growth > 0 ? "↑" : "↓"} ${Math.abs(finance.yearToDate.growth)}% ${t("rep.vsLastYear")}`}
            />
          </>
        ) : (
          <>
            <Stat label={t("rep.activeGroups")} value={String(groups.active)} />
            <Stat label={t("rep.avgOccupancy")} value={pctText(groups.averageOccupancy)} />
          </>
        )}
      </div>

      <div className="adm-profile">
        <section style={card}>
          <div style={title}>{t("rep.registrations")}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140 }}>
            {students.registrationsByMonth.map((r) => (
              <div key={r.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>{r.count}</span>
                <div style={{ width: "100%", maxWidth: 36, height: `${Math.max(4, (r.count / maxReg) * 100)}px`, background: r.month === report.month ? ACCENT : "#C7D2FE", borderRadius: 6 }} />
                <span style={{ fontSize: 11, color: "#8A8D96" }}>{r.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        {finance ? (
          <section style={card}>
            <div style={title}>{t("rep.financeTitle")}</div>
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              {[
                [t("rep.expected"), `${money(finance.expected)} ${sum}`],
                [t("rep.collected"), `${money(finance.collected)} ${sum}`],
                [t("rep.debt"), `${money(finance.outstandingDebt)} ${sum} · ${finance.debtorCount} ${t("rep.debtors")}`],
                ...(finance.netProfit !== undefined
                  ? [[t("rep.expenses"), `${money((finance.expenses ?? 0))} ${sum}`], [t("rep.netProfit"), `${money(finance.netProfit)} ${sum}`]]
                  : []),
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #F2F1EC", paddingBottom: 6 }}>
                  <span style={{ color: "#8A8D96" }}>{k}</span>
                  <span style={{ fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ ...title, marginTop: 18 }}>{t("reports.paymentMethodsTitle")}</div>
            {methods.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("reports.noData")}</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {methods.map(([k, v]) => (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                      <span>{METHOD_KEYS[k] ? t(METHOD_KEYS[k]) : k}</span>
                      <span>{Math.round((v / methodTotal) * 100)}%</span>
                    </div>
                    <Bar value={v} max={methodTotal} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section style={card}>
            <div style={title}>{t("rep.studentStatus")}</div>
            {Object.entries(students.byStatus).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" }}>
                <span style={{ color: "#8A8D96" }}>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </section>
        )}
      </div>

      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ ...title, padding: "16px 20px 0" }}>{t("rep.groupsTitle")}</div>
        {groups.items.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 13.5, padding: "8px 20px 20px" }}>{t("reports.noGroups")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{t("reports.colGroup")}</th>
                  <th>{t("reports.colStudents")}</th>
                  <th>{t("rep.occupancy")}</th>
                  <th>{t("reports.colAvgAttendance")}</th>
                  {finance && <th>{t("reports.colMonthRevenue")}</th>}
                </tr>
              </thead>
              <tbody>
                {groups.items.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}><Link href={`/groups/${g.id}`} style={{ color: "#181A1F" }}>{g.name}</Link></td>
                    <td>{g.students}/{g.maxStudents}</td>
                    <td>{pctText(g.occupancy)}</td>
                    <td>{pctText(g.attendanceRate)}</td>
                    {finance && <td style={{ fontWeight: 700 }}>{money(g.collected)} {sum}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {admissions && (
        <section style={card}>
          <div style={title}>{t("rep.admissionsTitle")}</div>
          <div className="adm-stats">
            <Stat label={t("rep.leadsThisMonth")} value={String(admissions.cohort.total)} />
            <Stat label={t("rep.leadConversion")} value={pctText(admissions.cohort.rates.conversion.rate)} sub={`${admissions.cohort.rates.conversion.numerator}/${admissions.cohort.rates.conversion.denominator}`} />
            <Stat label={t("rep.trialsBooked")} value={String(admissions.cohort.reached.TRIAL_BOOKED ?? 0)} />
            <Stat label={t("rep.lostLeads")} value={String(admissions.cohort.lost)} />
          </div>
        </section>
      )}

      <p style={{ fontSize: 11.5, color: "#8A8D96" }}>
        {t("rep.footnote")} {report.month} · {report.timezone}
      </p>
    </div>
  );
}
