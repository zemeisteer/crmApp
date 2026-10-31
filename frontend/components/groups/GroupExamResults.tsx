"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examsApi, type Exam, type Student } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "var(--primary)";
const MAX_COLUMNS = 6;

type Cell = { score: number; max: number; passed: boolean } | null;

// Exam and test results of one group: a student x exam grid (latest exams
// first), each student's average and the group's summary. Manual results
// win over online test attempts; for attempts the best one counts.
export default function GroupExamResults({ groupId, students }: { groupId: string; students: Student[] }) {
  const { t, lang } = useLanguage();
  const [exams, setExams] = useState<Exam[] | null>(null);

  useEffect(() => {
    examsApi.list(groupId).then(setExams).catch(() => setExams([]));
  }, [groupId]);

  const columns = useMemo(() => {
    const list = [...(exams ?? [])].sort((a, b) => (b.examDate ?? b.createdAt).localeCompare(a.examDate ?? a.createdAt));
    return list.slice(0, MAX_COLUMNS).reverse();
  }, [exams]);

  const grid = useMemo(() => {
    const cellOf = (exam: Exam, studentId: string): Cell => {
      const pass = (score: number, max: number) => (exam.passingScore != null ? score >= exam.passingScore : max > 0 && score / max >= 0.6);
      const r = exam.results?.find((x) => x.studentId === studentId);
      if (r) return { score: r.score, max: exam.maxScore, passed: pass(r.score, exam.maxScore) };
      const best = (exam.attempts ?? [])
        .filter((a) => a.studentId === studentId && a.completedAt)
        .sort((a, b) => b.score / (b.maxScore || 1) - a.score / (a.maxScore || 1))[0];
      if (best) return { score: best.score, max: best.maxScore, passed: best.passed };
      return null;
    };
    return students.map((s) => {
      const cells = columns.map((e) => cellOf(e, s.id));
      const done = cells.filter((c): c is NonNullable<Cell> => !!c && c.max > 0);
      const avg = done.length ? Math.round((done.reduce((sum, c) => sum + c.score / c.max, 0) / done.length) * 100) : null;
      return { student: s, cells, avg };
    });
  }, [students, columns]);

  const summary = useMemo(() => {
    const all = grid.flatMap((r) => r.cells).filter((c): c is NonNullable<Cell> => !!c && c.max > 0);
    return {
      exams: exams?.length ?? 0,
      avg: all.length ? Math.round((all.reduce((s, c) => s + c.score / c.max, 0) / all.length) * 100) : null,
      passRate: all.length ? Math.round((all.filter((c) => c.passed).length / all.length) * 100) : null,
    };
  }, [grid, exams]);

  const pctColor = (p: number | null) => (p === null ? "var(--text-muted)" : p >= 80 ? "var(--success)" : p >= 60 ? "var(--warning)" : "var(--danger)");

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("groupExams.title")}</div>
        <Link href="/exams" style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT, textDecoration: "none" }}>
          {t("groupExams.manage")} →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, padding: "0 20px 16px" }}>
        {[
          { label: t("groupExams.count"), value: String(summary.exams), color: "var(--text)" },
          { label: t("groupExams.avg"), value: summary.avg === null ? "—" : `${summary.avg}%`, color: pctColor(summary.avg) },
          { label: t("groupExams.passRate"), value: summary.passRate === null ? "—" : `${summary.passRate}%`, color: pctColor(summary.passRate) },
        ].map((c) => (
          <div key={c.label} style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {exams === null ? (
        <div style={{ padding: "0 20px 20px", fontSize: 13, color: "var(--text-muted)" }}>…</div>
      ) : columns.length === 0 ? (
        <div style={{ padding: "0 20px 20px", fontSize: 13, color: "var(--text-muted)" }}>{t("groupExams.empty")}</div>
      ) : students.length === 0 ? (
        <div style={{ padding: "0 20px 20px", fontSize: 13, color: "var(--text-muted)" }}>{t("groupExams.noStudents")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: "40%" }}>{t("groupExams.student")}</th>
                {columns.map((e) => (
                  <th key={e.id} style={{ textAlign: "center", width: 130 }} title={e.title}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130, margin: "0 auto" }}>{e.title}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 500 }}>
                      {[e.examDate ? formatDate(e.examDate, lang, "dayMonth") : null, `${t("groupExams.outOf")} ${e.maxScore}`].filter(Boolean).join(" · ")}
                    </div>
                  </th>
                ))}
                <th style={{ textAlign: "right", width: 110 }}>{t("groupExams.average")}</th>
              </tr>
            </thead>
            <tbody>
              {grid.map(({ student, cells, avg }) => (
                <tr key={student.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/students/${student.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>{student.fullName}</Link>
                  </td>
                  {cells.map((c, i) => (
                    <td key={columns[i].id} style={{ textAlign: "center" }}>
                      {c ? (
                        <span style={{ display: "inline-block", minWidth: 44, padding: "3px 8px", borderRadius: "var(--radius-xs)", fontSize: 12.5, fontWeight: 700, background: c.passed ? "var(--success-soft)" : "var(--danger-soft)", color: c.passed ? "var(--success)" : "var(--danger)" }}>
                          {c.score}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>—</span>
                      )}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 800, color: pctColor(avg) }}>{avg === null ? "—" : `${avg}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
