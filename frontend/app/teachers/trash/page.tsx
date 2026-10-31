"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import { teachersApi, Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "var(--primary)";

function TrashContent() {
  const { t: tr, lang } = useLanguage();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageItems = usePagedSlice(teachers, page);

  function load() {
    setLoading(true);
    teachersApi
      .trash()
      .then(setTeachers)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onRestore(id: string) {
    setRestoringId(id);
    try {
      await teachersApi.restore(id);
      load();
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/teachers" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {tr("trash.backToTeachers")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{tr("trash.teachersTitle")}</h1>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{tr("common.loading")}</div>
        ) : teachers.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
            {tr("trash.empty")}
          </div>
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colTeacher")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("trash.colDeletedDate")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.fullName}</td>
                    <td>{t.deletedAt ? formatDate(t.deletedAt, lang, "numeric") : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn"
                        onClick={() => onRestore(t.id)}
                        disabled={restoringId === t.id}
                        style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: "var(--radius-xs)" }}
                      >
                        {tr("trash.restore")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={teachers.length} onChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

export default function TeachersTrashPage() {
  return (
    <DashboardShell>
      <TrashContent />
    </DashboardShell>
  );
}
