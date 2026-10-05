"use client";

import { useMemo, useState } from "react";
import type { AttendanceRecord, Student } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { MONTH_KEYS } from "@/lib/i18n";

const MARK: Record<string, { sym: string; bg: string; fg: string }> = {
  PRESENT: { sym: "✓", bg: "#E8F7EF", fg: "#1FA463" },
  LATE: { sym: "⏱", bg: "#FEF3E2", fg: "#D97706" },
  ABSENT: { sym: "✗", bg: "#FDEBEC", fg: "#B23A47" },
  EXCUSED: { sym: "E", bg: "#EEF0FF", fg: "#4F46E5" },
};

// Past attendance of the group by month: students down, lesson dates across,
// one mark per cell, and each student's rate for the month.
export default function GroupAttendanceHistory({ students, records }: { students: Student[]; records: AttendanceRecord[] }) {
  const { t } = useLanguage();
  const months = useMemo(() => [...new Set(records.map((r) => r.date.slice(0, 7)))].sort(), [records]);
  const [month, setMonth] = useState<string | null>(null);
  const clock = useCenterClock();
  const current = month ?? months.at(-1) ?? clock.month();
  const idx = months.indexOf(current);

  const inMonth = records.filter((r) => r.date.startsWith(current));
  const dates = [...new Set(inMonth.map((r) => r.date))].sort();
  const byKey = new Map(inMonth.map((r) => [`${r.studentId}|${r.date}`, r.status as string]));
  const monthLabel = `${t(MONTH_KEYS[Number(current.slice(5)) - 1])} ${current.slice(0, 4)}`;

  const rate = (studentId: string) => {
    const marks = dates.map((d) => byKey.get(`${studentId}|${d}`)).filter(Boolean) as string[];
    if (marks.length === 0) return null;
    return Math.round((marks.filter((m) => m === "PRESENT" || m === "LATE").length / marks.length) * 100);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("att.history")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" disabled={idx <= 0} onClick={() => setMonth(months[idx - 1])} style={navBtn(idx <= 0)}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 120, textAlign: "center" }}>{monthLabel}</span>
          <button type="button" disabled={idx < 0 || idx >= months.length - 1} onClick={() => setMonth(months[idx + 1])} style={navBtn(idx < 0 || idx >= months.length - 1)}>›</button>
        </div>
      </div>

      {dates.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("att.noHistory")}</div>
      ) : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #F2F1EC", borderRadius: 12 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#FAFAF8" }}>
                  <th style={{ ...cell, textAlign: "left", position: "sticky", left: 0, background: "#FAFAF8", minWidth: 150 }}>{t("groupExams.student")}</th>
                  {dates.map((d) => (
                    <th key={d} style={{ ...cell, color: "#8A8D96", fontWeight: 700 }}>{Number(d.slice(8))}</th>
                  ))}
                  <th style={{ ...cell, textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const r = rate(s.id);
                  return (
                    <tr key={s.id} style={{ borderTop: "1px solid #F2F1EC" }}>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 600, position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap" }}>{s.fullName}</td>
                      {dates.map((d) => {
                        const m = byKey.get(`${s.id}|${d}`);
                        const style = m ? MARK[m] : null;
                        return (
                          <td key={d} style={cell}>
                            {style ? (
                              <span style={{ display: "inline-flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 7, background: style.bg, color: style.fg, fontWeight: 800 }}>{style.sym}</span>
                            ) : (
                              <span style={{ color: "#D4D4D8" }}>·</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ ...cell, textAlign: "right", fontWeight: 800, color: r === null ? "#8A8D96" : r >= 80 ? "#1FA463" : r >= 60 ? "#D97706" : "#B23A47" }}>{r === null ? "—" : `${r}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "#8A8D96" }}>
            {(["PRESENT", "LATE", "ABSENT"] as const).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ display: "inline-flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 5, background: MARK[k].bg, color: MARK[k].fg, fontWeight: 800, fontSize: 11 }}>{MARK[k].sym}</span>
                {t(k === "PRESENT" ? "ptl.present" : k === "LATE" ? "ptl.late" : "ptl.absent")}
              </span>
            ))}
            <span>· {dates.length} {t("att.lessons")}</span>
          </div>
        </>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "7px 6px", textAlign: "center" };
const navBtn = (disabled: boolean): React.CSSProperties => ({ width: 30, height: 30, borderRadius: 8, border: "1px solid #EAE8E2", background: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, fontSize: 16, fontWeight: 800 });
