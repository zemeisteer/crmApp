"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { studentsApi, groupsApi, exportApi, Student, Group, Gender, ApiError } from "@/lib/api";
import { PHONE_PATTERN, PHONE_TITLE, NAME_PATTERN, NAME_TITLE } from "@/lib/validation";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function StudentsContent() {
  const { t } = useLanguage();
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [page, setPage] = useState(1);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [direction, setDirection] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const subjects = useMemo(() => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[], [groups]);
  const groupsInDirection = direction ? groups.filter((g) => g.subject === direction) : groups;
  const filterGroupsInDirection = filterDirection ? groups.filter((g) => g.subject === filterDirection) : groups;

  function load() {
    setLoading(true);
    Promise.all([studentsApi.list(), groupsApi.list()])
      .then(([s, g]) => {
        setStudents(s);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setFullName("");
    setGender("");
    setPhone("");
    setParentPhone("");
    setBirthDate("");
    setDirection("");
    setGroupIds([]);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await studentsApi.create({
        fullName,
        gender: gender || undefined,
        phone: phone || undefined,
        parentPhone: parentPhone || undefined,
        birthDate: birthDate || undefined,
        groupIds: groupIds.length > 0 ? groupIds : undefined,
      });
      setModalOpen(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg(t("common.loading"));
    try {
      const res = await exportApi.importStudents(file);
      setImportMsg(`${res.imported} ta o'quvchi import qilindi${res.errors.length ? `, ${res.errors.length} ta xato` : ""}.`);
      load();
    } catch (err) {
      setImportMsg(err instanceof ApiError ? err.message : "Import xato");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const filtered = useMemo(() => {
    return students.filter((s) => {
      if (filterGender && s.gender !== filterGender) return false;
      if (filterGroupId && !(s.enrollments || []).some((e) => e.groupId === filterGroupId)) return false;
      if (filterDirection && !(s.enrollments || []).some((e) => e.group.subject === filterDirection)) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        (s.phone || "").includes(q) ||
        (s.parentPhone || "").includes(q) ||
        (s.enrollments || []).some((e) => e.group.name.toLowerCase().includes(q) || e.group.subject.toLowerCase().includes(q))
      );
    });
  }, [students, search, filterGroupId, filterDirection, filterGender]);

  useEffect(() => setPage(1), [search, filterGroupId, filterDirection, filterGender]);
  const pageItems = usePagedSlice(filtered, page);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("students.title")}</h1>
          <Link href="/students/trash" style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>
            {t("nav.trash")}
          </Link>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => exportApi.studentsXlsx()}
            style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9 }}
          >
            {t("students.exportExcel")}
          </button>
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9 }}
          >
            {t("students.importExcel")}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={onImportFile} style={{ display: "none" }} />
          <button
            className="btn"
            onClick={() => setModalOpen(true)}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
          >
            {t("students.newStudent")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {importMsg && (
          <div style={{ background: "#ECEBFB", color: ACCENT, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 16 }}>
            {importMsg}
          </div>
        )}
        {!loading && students.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <input
              className="field-input"
              placeholder={t("students.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <Select
              options={[{ value: "", label: t("students.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
              value={filterDirection}
              onChange={(v) => { setFilterDirection(v); setFilterGroupId(""); }}
              style={{ width: 180 }}
            />
            <Select
              options={[{ value: "", label: t("students.allGroups") }, ...filterGroupsInDirection.map((g) => ({ value: g.id, label: g.name }))]}
              value={filterGroupId}
              onChange={setFilterGroupId}
              style={{ width: 180 }}
            />
            <Select
              options={[{ value: "", label: t("students.genderFilter") }, { value: "MALE", label: t("students.male") }, { value: "FEMALE", label: t("students.female") }]}
              value={filterGender}
              onChange={setFilterGender}
              style={{ width: 150 }}
            />
          </div>
        )}
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : students.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("students.noStudentsYet")}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("students.noSearchResults")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("students.colStudent")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colGroups")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colPhone")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colParentPhone")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.fullName}</td>
                    <td>{s.enrollments?.map((e) => e.group.name).join(", ") || "—"}</td>
                    <td>{s.phone || "—"}</td>
                    <td>{s.parentPhone || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/students/${s.id}`}
                        className="btn"
                        style={{ display: "inline-block", background: "#F2F1EC", color: "#181A1F", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8 }}
                      >
                        {t("common.viewProfile")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("students.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label={t("students.fieldFullName")}>
            <input
              className="field-input"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Madina Yusupova"
              pattern={NAME_PATTERN}
              title={NAME_TITLE}
            />
          </Field>
          <Field label={t("students.fieldGender")}>
            <Select
              options={[{ value: "", label: t("groups.notSelected") }, { value: "MALE", label: t("students.male") }, { value: "FEMALE", label: t("students.female") }]}
              value={gender}
              onChange={(v) => setGender(v as Gender | "")}
            />
          </Field>
          <Field label={t("students.fieldPhone")}>
            <input
              className="field-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              pattern={PHONE_PATTERN}
              title={PHONE_TITLE}
            />
          </Field>
          <Field label={t("students.fieldParentPhone")}>
            <input
              className="field-input"
              type="tel"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              pattern={PHONE_PATTERN}
              title={PHONE_TITLE}
            />
          </Field>
          <Field label={t("students.fieldBirthDate")}>
            <DatePicker value={birthDate} onChange={setBirthDate} />
          </Field>
          <Field label={t("students.fieldDirection")}>
            <Select
              options={[{ value: "", label: t("students.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
              value={direction}
              onChange={(v) => { setDirection(v); setGroupIds([]); }}
            />
          </Field>
          <Field label={t("students.fieldGroups")}>
            <MultiSelect
              options={groupsInDirection.map((g) => ({ value: g.id, label: g.name }))}
              selected={groupIds}
              onChange={setGroupIds}
              placeholder={t("students.selectGroups")}
            />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("students.adding") : t("students.addStudent")}
          </button>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export default function StudentsPage() {
  return (
    <DashboardShell>
      <StudentsContent />
    </DashboardShell>
  );
}
