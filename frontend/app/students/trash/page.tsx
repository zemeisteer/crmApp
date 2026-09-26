"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import { studentsApi, Student } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";

function TrashContent() {
  const { t, lang } = useLanguage();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageItems = usePagedSlice(students, page);

  function load() {
    setLoading(true);
    studentsApi
      .trash()
      .then(setStudents)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onRestore(id: string) {
    setRestoringId(id);
    try {
      await studentsApi.restore(id);
      load();
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <Link href="/students" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8A8D96", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("trash.backToStudents")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("trash.studentsTitle")}</h1>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : students.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("trash.empty")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("students.colStudent")}</th>
                  <th style={{ paddingTop: 16 }}>{t("trash.colDeletedDate")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.fullName}</td>
                    <td>{s.deletedAt ? formatDate(s.deletedAt, lang, "numeric") : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn"
                        onClick={() => onRestore(s.id)}
                        disabled={restoringId === s.id}
                        style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 8 }}
                      >
                        {t("trash.restore")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={students.length} onChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

export default function StudentsTrashPage() {
  return (
    <DashboardShell>
      <TrashContent />
    </DashboardShell>
  );
}
