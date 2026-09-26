"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import { certificatesApi, studentsApi, groupsApi, Certificate, Student, Group, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";

function CertificatesContent() {
  const { t } = useLanguage();
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [studentId, setStudentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [signatoryName, setSignatoryName] = useState("O'quv bo'limi");
  const [signatoryTitle, setSignatoryTitle] = useState("Direktor");
  const [description, setDescription] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [page, setPage] = useState(1);

  async function loadData() {
    try {
      setLoading(true);
      const [c, s, g] = await Promise.all([
        certificatesApi.list(),
        studentsApi.list(),
        groupsApi.list(),
      ]);
      setCerts(c);
      setStudents(s);
      setGroups(g);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cert.loadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = useMemo(() => {
    return certs.filter((c) => {
      if (filterGroup && c.groupId !== filterGroup) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchCode = c.code.toLowerCase().includes(q);
        const matchTitle = c.title.toLowerCase().includes(q);
        const matchStudent = c.student?.fullName?.toLowerCase().includes(q);
        if (!matchCode && !matchTitle && !matchStudent) return false;
      }
      return true;
    });
  }, [certs, filterGroup, search]);

  const paged = usePagedSlice(filtered, page, 10);

  function openCreateModal() {
    setStudentId("");
    setGroupId("");
    setTitle("");
    setGrade("");
    setIssueDate(new Date().toISOString().split("T")[0]);
    setSignatoryName("O'quv bo'limi");
    setSignatoryTitle("Direktor");
    setDescription("");
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId || !title.trim()) {
      setError(t("cert.required"));
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const created = await certificatesApi.create({
        studentId,
        groupId: groupId || undefined,
        title: title.trim(),
        grade: grade.trim() || undefined,
        issueDate: issueDate || undefined,
        signatoryName: signatoryName.trim() || undefined,
        signatoryTitle: signatoryTitle.trim() || undefined,
        description: description.trim() || undefined,
      });

      setCerts((prev) => [created, ...prev]);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cert.createError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("cert.confirmRevoke"))) return;
    try {
      await certificatesApi.remove(id);
      setCerts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("pay.deleteError"));
    }
  }

  function copyVerificationLink(code: string) {
    const url = `${window.location.origin}/verify/${code}`;
    navigator.clipboard.writeText(url);
    setCopiedId(code);
    setTimeout(() => setCopiedId(null), 2500);
  }

  return (
    <div className="space-y-6">
      {/* Top action banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              {t("cert.title")}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-600">
            {t("cert.subtitle")}
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-2 shadow-sm transition-all cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("cert.new")}
        </button>
      </div>

      {/* Filters and search bar */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-8 relative">
          <input
            type="text"
            placeholder={t("cert.searchPh")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="sm:col-span-4">
          <Select
            value={filterGroup}
            onChange={(val) => {
              setFilterGroup(val);
              setPage(1);
            }}
            placeholder={t("cert.allGroups")}
            options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.subject})` }))}
          />
        </div>
      </div>

      {/* Main content list */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm font-medium">{t("cert.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
            </svg>
          </div>
          <p className="text-slate-900 font-bold text-sm">{t("cert.none")}</p>
          <p className="text-slate-500 text-xs mt-1">
            {search || filterGroup ? t("cert.tryFilters") : t("cert.issueFirst")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {paged.map((cert) => (
            <div
              key={cert.id}
              className="bg-white border border-slate-200 hover:border-indigo-400 rounded-2xl p-5 transition-all shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      {cert.code}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-1.5 line-clamp-1">
                      {cert.title}
                    </h3>
                  </div>
                  {cert.grade && (
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg shrink-0">
                      {cert.grade}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-xs text-slate-600 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-medium">{t("cert.student")}</span>
                    <span className="font-bold text-slate-900">
                      {cert.student?.fullName || "—"}
                    </span>
                  </div>
                  {cert.group && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-medium">{t("cert.group")}</span>
                      <span className="text-slate-800 font-semibold">
                        {cert.group.name} ({cert.group.subject})
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-medium">{t("cert.date")}</span>
                    <span className="text-slate-700 font-semibold">
                      {cert.issueDate ? formatDate(cert.issueDate, "UZ", "numeric") : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/verify/${cert.code}`}
                    target="_blank"
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold inline-flex items-center gap-1.5 transition-all border border-indigo-200"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    {t("cert.view")}
                  </Link>

                  <button
                    onClick={() => copyVerificationLink(cert.code)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    {copiedId === cert.code ? "Nusxalandi!" : "Havola"}
                  </button>
                </div>

                <button
                  onClick={() => handleDelete(cert.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                  title={t("common.delete")}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > 10 && (
        <Pagination
          page={page}
          total={filtered.length}
          pageSize={10}
          onChange={setPage}
        />
      )}

      {/* Issue Certificate Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("cert.new")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t("cert.studentLabel")} <span className="text-rose-500">*</span>
            </label>
            <Select
              value={studentId}
              onChange={setStudentId}
              placeholder={t("cert.pickStudent")}
              options={students.map((s) => ({ value: s.id, label: s.fullName }))}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t("cert.groupOpt")}
            </label>
            <Select
              value={groupId}
              onChange={setGroupId}
              placeholder={t("cert.pickGroup")}
              options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.subject})` }))}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t("cert.name")} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder={t("cert.namePh")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t("cert.grade")}
              </label>
              <input
                type="text"
                placeholder="A+, IELTS 7.5, 95%"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t("cert.issueDate")}
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t("cert.signer")}
              </label>
              <input
                type="text"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                placeholder={t("cert.signerPh")}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t("cert.position")}
              </label>
              <input
                type="text"
                value={signatoryTitle}
                onChange={(e) => setSignatoryTitle(e.target.value)}
                placeholder={t("cert.positionPh")}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t("cert.note")}
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("cert.notePh")}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm resize-none"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer border border-slate-200"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {saving ? t("common.saving") : t("cert.issue")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function CertificatesPage() {
  return (
    <DashboardShell>
      <div style={{ padding: "24px 32px", width: "100%", maxWidth: 1400, margin: "0 auto", boxSizing: "border-box" }}>
        <CertificatesContent />
      </div>
    </DashboardShell>
  );
}
