"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { teachersApi, groupsApi, studentsApi, paymentsApi, Teacher, Group, Student, Payment, ApiError } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { PHONE_PATTERN, PHONE_TITLE, NAME_PATTERN, NAME_TITLE } from "@/lib/validation";
import { matchesSubject } from "@/lib/subject";

const ACCENT = "#4F46E5";
const OTHER_SUBJECT = "__OTHER__";

const SUGGESTED_DIRECTIONS = [
  "Ingliz tili (IELTS)",
  "Ingliz tili (CEFR)",
  "General English",
  "Matematika",
  "Fizika",
  "Kimyo",
  "Biologiya",
  "Ona tili",
  "Rus tili",
  "IT / Dasturlash",
  "Arab tili",
  "Koreys tili",
];

function formatPhoneInput(val: string) {
  const digits = val.replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  let res = "+998";
  if (d.length > 0) res += ` ${d.slice(0, 2)}`;
  if (d.length > 2) res += ` ${d.slice(2, 5)}`;
  if (d.length > 5) res += ` ${d.slice(5, 7)}`;
  if (d.length > 7) res += ` ${d.slice(7, 9)}`;
  return res;
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function TeachersContent() {
  const { user } = useAuth();
  const { t: tr } = useLanguage();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [page, setPage] = useState(1);

  const [fullName, setFullName] = useState("");
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const [customDirection, setCustomDirection] = useState("");
  const [assignedGroupIds, setAssignedGroupIds] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [salaryType, setSalaryType] = useState("FIXED");
  const [salaryValue, setSalaryValue] = useState("");

  const usedSubjects = useMemo(() => Array.from(new Set(groups.map((g) => g.subject))).sort(), [groups]);

  const groupsForTeacherModal = useMemo(() => {
    if (selectedDirections.length === 0) return groups;
    return groups.filter((g) => {
      const gSubject = (g.subject || "").toLowerCase().trim();
      const gName = (g.name || "").toLowerCase().trim();
      return selectedDirections.some((dir) => {
        const d = dir.toLowerCase().trim();
        if (gSubject.includes(d) || d.includes(gSubject)) return true;
        if (d.includes("matem") && (gSubject.includes("matem") || gName.includes("matem"))) return true;
        if (
          (d.includes("ingliz") || d.includes("ielts") || d.includes("cefr") || d.includes("english")) &&
          (gSubject.includes("ingliz") || gSubject.includes("ielts") || gSubject.includes("cefr") || gSubject.includes("english") || gName.includes("ielts") || gName.includes("cefr"))
        ) {
          return true;
        }
        if (d.includes("fizik") && gSubject.includes("fizik")) return true;
        if (d.includes("kimyo") && gSubject.includes("kimyo")) return true;
        if (d.includes("bio") && gSubject.includes("bio")) return true;
        if ((d.includes("it") || d.includes("dastur")) && (gSubject.includes("it") || gSubject.includes("dastur"))) return true;
        if (d.includes("ona tili") && gSubject.includes("ona tili")) return true;
        if (d.includes("rus") && gSubject.includes("rus")) return true;
        if (d.includes("arab") && gSubject.includes("arab")) return true;
        if (d.includes("koreys") && gSubject.includes("koreys")) return true;
        return false;
      });
    });
  }, [groups, selectedDirections]);


  function load() {
    setLoading(true);
    Promise.all([teachersApi.list(), groupsApi.list(), studentsApi.list(), paymentsApi.list().catch(() => [])])
      .then(([t, g, s, p]) => {
        setTeachers(t);
        setGroups(g);
        setStudents(s);
        setPayments(p);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setFullName("");
    setSelectedDirections([]);
    setCustomDirection("");
    setAssignedGroupIds([]);
    setEmail("");
    setPhone("");
    setBirthDate("");
    setStartDate("");
    setSalaryType("FIXED");
    setSalaryValue("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const allDirs = [...selectedDirections];
      if (customDirection.trim() && !allDirs.includes(customDirection.trim())) {
        allDirs.push(customDirection.trim());
      }
      const effectiveSubject = allDirs.join(", ");
      const teacher = await teachersApi.create({
        fullName,
        email: email.trim() || undefined,
        subject: effectiveSubject || undefined,
        phone: phone || undefined,
        birthDate: birthDate || undefined,
        startDate: startDate || undefined,
        salaryType: salaryValue ? salaryType : undefined,
        salaryValue: salaryValue ? Number(salaryValue) : undefined,
      });
      if (assignedGroupIds.length > 0) {
        await Promise.all(assignedGroupIds.map((groupId) => groupsApi.update(groupId, { teacherId: teacher.id })));
      }
      setModalOpen(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const currentMonth = localMonthStr();

  const teacherStats = useMemo(() => {
    return teachers.map((t) => {
      const teacherGroups = groups.filter((g) => g.teacherId === t.id);
      const groupIds = teacherGroups.map((g) => g.id);
      const enrolledStudentIds = new Set(
        students.filter((s) => (s.enrollments || []).some((e) => groupIds.includes(e.groupId))).map((s) => s.id),
      );
      let monthSalary = 0;
      if (t.salaryType === "PERCENT" && t.salaryValue) {
        const groupRevenue = Array.from(enrolledStudentIds).reduce(
          (sum, sid) => sum + payments.filter((p) => p.studentId === sid && p.forMonth === currentMonth && p.status === "PAID").reduce((a, p) => a + p.amount, 0),
          0,
        );
        monthSalary = Math.round((groupRevenue * t.salaryValue) / 100);
      } else if (t.salaryType === "PER_STUDENT" && t.salaryValue) {
        monthSalary = enrolledStudentIds.size * t.salaryValue;
      } else if (t.salaryType === "PER_LESSON" && t.salaryValue) {
        monthSalary = teacherGroups.length * 12 * t.salaryValue;
      } else if (t.salaryType === "FIXED" && t.salaryValue) {
        monthSalary = t.salaryValue;
      }
      return { teacher: t, groupCount: teacherGroups.length, studentCount: enrolledStudentIds.size, monthSalary };
    });
  }, [teachers, groups, students, payments, currentMonth]);

  const totalMonthSalary = teacherStats.reduce((sum, t) => sum + t.monthSalary, 0);
  const activeGroupsCount = groups.filter((g) => g.teacherId).length;

  const filtered = teacherStats.filter(({ teacher: t }) => {
    if (filterDirection && !matchesSubject(t.subject, filterDirection)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return t.fullName.toLowerCase().includes(q) || (t.subject || "").toLowerCase().includes(q);
  });

  useEffect(() => setPage(1), [search, filterDirection]);
  const pageItems = usePagedSlice(filtered, page);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{tr("teachers.title")}</h1>
          <Link href="/teachers/trash" style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>
            {tr("nav.trash")}
          </Link>
        </div>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          {tr("teachers.newTeacher")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {!loading && teachers.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{tr("teachers.statTotal")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{teachers.length}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{tr("teachers.statActiveGroups")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{activeGroupsCount}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{tr("teachers.statMonthSalary")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(totalMonthSalary)} {tr("common.sumUnit")}</div>
              </div>
            </div>

            {user?.role !== "SUPERADMIN" && (
              <div style={{ background: "#ECEBFB", color: "#4A4E58", fontSize: 12.5, fontWeight: 500, padding: "14px 18px", borderRadius: 12, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", lineHeight: 1.5 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>
                  {tr("teachers.adminOnlyPrefix")} <strong style={{ color: ACCENT }}>{tr("role.admin")}</strong> {tr("teachers.adminOnlySuffix")}
                </span>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="field-input"
                placeholder={tr("teachers.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 280, maxWidth: "100%", flexShrink: 0 }}
              />
              <Select
                options={[{ value: "", label: tr("groups.allDirections") }, ...usedSubjects.map((s) => ({ value: s, label: s }))]}
                value={filterDirection}
                onChange={setFilterDirection}
                style={{ width: 200 }}
              />
            </div>
          </>
        )}
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{tr("common.loading")}</div>
        ) : teachers.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {tr("teachers.noTeachersYet")}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {tr("teachers.noSearchResults")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colTeacher")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colDirection")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colGroups")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colStudents")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colMonthSalary")}</th>
                  <th style={{ paddingTop: 16 }}>{tr("teachers.colStatus")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(({ teacher: t, groupCount, studentCount, monthSalary }) => (
                  <tr key={t.id}>
                    <td style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
                      <div
                        style={{
                          width: 30, height: 30, borderRadius: "50%", background: "#ECEBFB", display: "flex",
                          alignItems: "center", justifyContent: "center", fontWeight: 700, color: ACCENT, fontSize: 12,
                        }}
                      >
                        {t.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      {t.fullName}
                    </td>
                    <td>{t.subject || "—"}</td>
                    <td>{groupCount}</td>
                    <td>{studentCount}</td>
                    <td style={{ fontWeight: 700 }}>{monthSalary ? `${formatMoney(monthSalary)} ${tr("common.sumUnit")}` : "—"}</td>
                    <td>
                      <span className={`badge ${groupCount > 0 ? "badge-success" : "badge-neutral"}`}>{groupCount > 0 ? tr("teachers.active") : tr("teachers.noGroup")}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/teachers/${t.id}`}
                        className="btn"
                        style={{ display: "inline-block", background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}`, fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8 }}
                      >
                        {tr("common.viewProfile")}
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

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={tr("teachers.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label={tr("teachers.fieldFullName")}>
            <input
              className="field-input"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dilnoza Rahimova"
              pattern={NAME_PATTERN}
              title={NAME_TITLE}
            />
          </Field>
          <Field label={tr("teachers.fieldDirection") + " (bir nechta tanlash mumkin)"}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {Array.from(new Set([...SUGGESTED_DIRECTIONS, ...usedSubjects])).map((s) => {
                const active = selectedDirections.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSelectedDirections((prev) => (active ? prev.filter((x) => x !== s) : [...prev, s]));
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "5px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                      border: `1px solid ${active ? ACCENT : "#EAE8E2"}`,
                      background: active ? "#EEF0FF" : "#fff",
                      color: active ? ACCENT : "#4A4E58",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {active ? "✓ " : "+ "}{s}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="field-input"
                value={customDirection}
                onChange={(e) => setCustomDirection(e.target.value)}
                placeholder={tr("tch.otherSubjectPh")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (customDirection.trim() && !selectedDirections.includes(customDirection.trim())) {
                      setSelectedDirections((prev) => [...prev, customDirection.trim()]);
                      setCustomDirection("");
                    }
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (customDirection.trim() && !selectedDirections.includes(customDirection.trim())) {
                    setSelectedDirections((prev) => [...prev, customDirection.trim()]);
                    setCustomDirection("");
                  }
                }}
                style={{ background: "#F2F1EC", color: "#181A1F", fontSize: 12, fontWeight: 700, padding: "0 14px", borderRadius: 8, whiteSpace: "nowrap" }}
              >
                {tr("tch.add")}
              </button>
            </div>
          </Field>
          <Field
            label={`${tr("teachers.fieldAssignedGroups")}${selectedDirections.length > 0 ? ` (${selectedDirections.join(", ")} ${tr("tch.direction")})` : ""}`}
          >
            <MultiSelect
              options={groupsForTeacherModal.map((g) => ({
                value: g.id,
                label: g.teacher ? `${g.name} (${g.teacher.fullName})` : g.name,
              }))}
              selected={assignedGroupIds}
              onChange={setAssignedGroupIds}
              placeholder={
                groups.length === 0
                  ? tr("tch.noGroups")
                  : selectedDirections.length > 0 && groupsForTeacherModal.length === 0
                    ? tr("tch.noGroupsInDir")
                    : tr("teachers.selectGroups")
              }
            />
          </Field>

          <Field label="Email">
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="oqituvchi@example.uz"
            />
          </Field>
          <Field label={tr("teachers.fieldPhone")}>
            <input
              className="field-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="+998 90 123 45 67"
            />
          </Field>
          <Field label={tr("teachers.fieldBirthDate")}>
            <DatePicker value={birthDate} onChange={setBirthDate} />
          </Field>
          <Field label={tr("tch.startDate")}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label={tr("teachers.fieldSalaryType")}>
            <Select
              options={[
                { value: "FIXED", label: tr("tch.salFixed") },
                { value: "PERCENT", label: tr("tch.salPercent") },
                { value: "PER_STUDENT", label: tr("tch.salPerStudent") },
                { value: "PER_LESSON", label: tr("tch.salPerLesson") },
              ]}
              value={salaryType}
              onChange={setSalaryType}
            />
          </Field>
          <Field
            label={
              salaryType === "PERCENT"
                ? tr("tch.percentAmount")
                : salaryType === "PER_STUDENT"
                  ? tr("tch.perStudentAmount")
                  : salaryType === "PER_LESSON"
                    ? tr("tch.perLessonAmount")
                    : tr("tch.fixedAmount")
            }
          >
            <input
              className="field-input"
              type="number"
              min={0}
              max={salaryType === "PERCENT" ? 100 : undefined}
              value={salaryValue}
              onChange={(e) => setSalaryValue(e.target.value)}
              placeholder={salaryType === "PERCENT" ? "40" : "2000000"}
            />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? tr("teachers.adding") : tr("teachers.addTeacher")}
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

export default function TeachersPage() {
  return (
    <DashboardShell>
      <TeachersContent />
    </DashboardShell>
  );
}
