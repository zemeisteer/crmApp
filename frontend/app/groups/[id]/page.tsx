"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import GroupExamResults from "@/components/groups/GroupExamResults";
import GroupInfoCard from "@/components/groups/GroupInfoCard";
import GroupAttendanceHistory from "@/components/groups/GroupAttendanceHistory";
import GroupTutorReport from "@/components/groups/GroupTutorReport";
import { groupsApi, studentsApi, paymentsApi, attendanceApi, Group, Student, Gender, AttendanceRecord, AttendanceStatus, ApiError, retryKey, type DebtorItem } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { PHONE_PATTERN, PHONE_TITLE, NAME_PATTERN, NAME_TITLE, phoneOrEmpty } from "@/lib/validation";
import { useCenterClock } from "@/lib/use-center-clock";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import PhoneInput from "@/components/PhoneInput";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const ATTENDANCE_LABEL_KEYS: Record<AttendanceStatus, TranslationKey> = {
  PRESENT: "groupDetail.present",
  LATE: "groupDetail.late",
  ABSENT: "groupDetail.absent",
};

const ATTENDANCE_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: "#1FA463",
  LATE: "#EA7A3A",
  ABSENT: "#B23A47",
};

const DAY_SHORT: Record<string, TranslationKey> = {
  dushanba: "weekday.short.monday", seshanba: "weekday.short.tuesday", chorshanba: "weekday.short.wednesday",
  payshanba: "weekday.short.thursday", juma: "weekday.short.friday", shanba: "weekday.short.saturday", yakshanba: "weekday.short.sunday",
  mon: "weekday.short.monday", tue: "weekday.short.tuesday", wed: "weekday.short.wednesday", thu: "weekday.short.thursday",
  fri: "weekday.short.friday", sat: "weekday.short.saturday", sun: "weekday.short.sunday",
};

function GroupDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { t } = useLanguage();
  const clock = useCenterClock();

  const [group, setGroup] = useState<Group & { enrollments?: { id: string; status?: string; student: Student }[] } | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const { user } = useAuth();
  // This month's dues per student, from the same ledger as the payments
  // page - only for those who may see payments (a teacher may not).
  const seesPay = can(user, "payments.view");
  const thisMonth = clock.month();
  const [dues, setDues] = useState<Map<string, DebtorItem> | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollMode, setEnrollMode] = useState<"existing" | "new">("existing");
  const [enrollStudentId, setEnrollStudentId] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newGender, setNewGender] = useState<Gender | "">("");
  const [newPhone, setNewPhone] = useState("");
  const [newParentPhone, setNewParentPhone] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // One key per submission of the "new student" form (see retryKey).
  const createKey = useRef<{ sig: string; key: string } | null>(null);
  function resetEnrollForm() {
    createKey.current = null;
    setEnrollStudentId("");
    setNewFullName("");
    setNewGender("");
    setNewPhone("");
    setNewParentPhone("");
    setNewBirthDate("");
    setEnrollError(null);
  }

  const [attendanceDate, setAttendanceDate] = useState(() => clock.today());
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [markSaving, setMarkSaving] = useState(false);
  const [topics, setTopics] = useState<Array<{ date: string; topic: string }>>([]);
  const [topic, setTopic] = useState("");

  function load() {
    setLoading(true);
    Promise.all([groupsApi.get(id), studentsApi.list(), seesPay ? paymentsApi.debtors({ forMonth: thisMonth }).catch(() => null) : Promise.resolve(null), attendanceApi.list({ groupId: id }), attendanceApi.topics(id).catch(() => [])])
      .then(([g, s, p, a, tp]) => {
        setGroup(g);
        setAllStudents(s);
        setDues(p ? new Map(p.debtors.map((d) => [d.studentId, d])) : null);
        setAttendance(a);
        setTopics(tp);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id, seesPay, thisMonth]);

  useEffect(() => {
    const enrolled = group?.enrollments || [];
    const next: Record<string, AttendanceStatus> = {};
    for (const e of enrolled) {
      const existing = attendance.find((a) => a.studentId === e.student.id && a.date === attendanceDate);
      next[e.student.id] = existing?.status || "PRESENT";
    }
    setDraft(next);
    setTopic(topics.find((x) => x.date === attendanceDate)?.topic ?? "");
  }, [group, attendance, attendanceDate, topics]);

  if (loading) {
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !group) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          {t("groupDetail.notFound")}{" "}
          <Link href="/groups" style={{ color: ACCENT, fontWeight: 600 }}>
            {t("groupDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  // Only students who are in the group now: removed students keep a
  // CANCELLED enrollment row and must not be listed or counted.
  const enrollments = (group.enrollments || []).filter((e) => !e.status || e.status === "ACTIVE" || e.status === "PAUSED");
  const enrolledIds = new Set(enrollments.map((e) => e.student.id));
  const availableStudents = allStudents.filter((s) => !enrolledIds.has(s.id));
  // PAID / PARTIAL / UNPAID for this month; null when not known (no dues
  // for the student this month, or payments not visible).
  function paymentStatusFor(studentId: string) {
    return dues?.get(studentId)?.status ?? null;
  }

  function attendancePercentFor(studentId: string) {
    const records = attendance.filter((a) => a.studentId === studentId);
    if (records.length === 0) return null;
    const attended = records.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    return Math.round((attended / records.length) * 100);
  }

  const groupAveragePercent = (() => {
    const percents = (group?.enrollments || [])
      .map((e) => attendancePercentFor(e.student.id))
      .filter((p): p is number => p !== null);
    if (percents.length === 0) return null;
    return Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length);
  })();

  async function onSaveAttendance() {
    const enrolled = group?.enrollments || [];
    if (enrolled.length === 0) return;
    setMarkSaving(true);
    try {
      await attendanceApi.mark({
        groupId: id,
        date: attendanceDate,
        entries: enrolled.map((e) => ({ studentId: e.student.id, status: draft[e.student.id] || "PRESENT" })),
        topic,
      });
      load();
    } finally {
      setMarkSaving(false);
    }
  }

  async function onEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrollError(null);
    setSaving(true);
    try {
      if (enrollMode === "existing") {
        if (!enrollStudentId) {
          setEnrollError(t("grp.pickStudent"));
          setSaving(false);
          return;
        }
        await studentsApi.enroll(enrollStudentId, id);
      } else {
        if (!newFullName.trim()) {
          setEnrollError(t("grp.enterName"));
          setSaving(false);
          return;
        }
        const body = {
          fullName: newFullName.trim(),
          gender: newGender ? (newGender as Gender) : null,
          phone: newPhone.trim() || undefined,
          parentPhone: phoneOrEmpty(newParentPhone) || undefined,
          birthDate: newBirthDate || undefined,
          groupId: id,
        };
        await studentsApi.create(body, retryKey(createKey, body));
        createKey.current = null;
      }
      setEnrollOpen(false);
      resetEnrollForm();
      load();
    } catch (err) {
      setEnrollError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function onUnenroll(studentId: string) {
    if (!confirm(t("groupDetail.confirmUnenroll"))) return;
    await studentsApi.unenroll(studentId, id);
    load();
  }

  async function onDeleteGroup() {
    if (!confirm(t("groupDetail.confirmDeleteGroup"))) return;
    await groupsApi.remove(id);
    router.push("/groups");
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <Link href="/groups" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8A8D96", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("groupDetail.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {group.name}
              {(() => {
                const max = group.maxStudents || 0;
                const b =
                  group.status && group.status !== "ACTIVE"
                    ? { text: group.status === "PLANNED" ? t("grp.stPlanned") : group.status === "COMPLETED" ? t("grp.stCompleted") : t("grp.stArchived"), color: "#8A8D96", bg: "#F2F1EC" }
                    : max > 0 && enrollments.length >= max
                      ? { text: t("grp.stFull"), color: "#1FA463", bg: "#E9F8EF" }
                      : { text: t("grp.activeGroup"), color: "#1FA463", bg: "#E9F8EF" };
                return <span style={{ fontSize: 12, fontWeight: 700, color: b.color, background: b.bg, padding: "4px 10px", borderRadius: 100, fontFamily: "'Inter', sans-serif" }}>{b.text}</span>;
              })()}
            </h1>
            <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
              {[
                group.teacher?.fullName,
                group.subject,
                (() => {
                  const days = (group.scheduleDays ?? "").split(",").map((d) => d.trim()).filter(Boolean)
                    .map((d) => DAY_SHORT[d.toLowerCase()] ? t(DAY_SHORT[d.toLowerCase()]) : d);
                  return days.length && group.startTime ? `${days.join("/")}, ${group.startTime}` : group.schedule;
                })(),
                `${enrollments.length} ${t("dash.studentsShort")}`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {can(user, "groups.delete") && (
              <button
                className="btn"
                onClick={onDeleteGroup}
                style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
              >
                {t("groupDetail.deleteGroup")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${seesPay && dues ? 5 : 3}, minmax(0,1fr))`, gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("groupDetail.statStudents")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {enrollments.length} / {group.maxStudents}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("groupDetail.statAvgAttendance")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {groupAveragePercent === null ? "—" : `${groupAveragePercent}%`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("groupDetail.statMonthlyPrice")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {group.monthlyPrice ? `${formatMoney(group.monthlyPrice)} ${t("common.sumUnit")}` : "—"}
            </div>
          </div>
          {seesPay && dues && (
            <>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("groupDetail.statMonthRevenue")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
                  {/* What these students paid for the month, at most this group's price each. */}
                  {formatMoney(enrollments.reduce((sum, e) => sum + Math.min(dues.get(e.student.id)?.paidAmount ?? 0, group.monthlyPrice || 0), 0))}{" "}
                  {t("common.sumUnit")}
                </div>
              </div>
              <div style={{ background: "#FDEBEC", border: "1px solid #F6D2D6", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#B23A47" }}>{t("groupDetail.statMonthDebtors")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#B23A47" }}>
                  {enrollments.filter((e) => { const st = paymentStatusFor(e.student.id); return st === "UNPAID" || st === "PARTIAL"; }).length}
                </div>
              </div>
            </>
          )}
        </div>

        <GroupInfoCard group={group} students={enrollments.length} lessonsHeld={new Set(attendance.map((a) => a.date)).size} />

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("groupDetail.markAttendance")}</div>
            <DatePicker value={attendanceDate} onChange={setAttendanceDate} style={{ width: 170 }} />
          </div>
          {enrollments.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("groupDetail.noStudentsForAttendance")}</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {enrollments.map((e) => {
                  const status = draft[e.student.id] || "PRESENT";
                  return (
                    <div
                      key={e.id}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 10, padding: "8px 12px" }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.student.fullName}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(["PRESENT", "LATE", "ABSENT"] as AttendanceStatus[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="btn"
                            onClick={() => setDraft((prev) => ({ ...prev, [e.student.id]: s }))}
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "6px 12px",
                              borderRadius: 7,
                              border: `1px solid ${status === s ? ATTENDANCE_COLOR[s] : "#EAE8E2"}`,
                              background: status === s ? ATTENDANCE_COLOR[s] : "transparent",
                              color: status === s ? "#fff" : "#4A4E58",
                            }}
                          >
                            {t(ATTENDANCE_LABEL_KEYS[s])}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <label style={{ display: "block", marginTop: 14 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 6 }}>📖 {t("groupDetail.lessonTopic")}</span>
                <textarea
                  className="field-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder={t("groupDetail.lessonTopicPh")}
                  style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 13.5 }}
                />
              </label>
              <button
                className="btn"
                onClick={onSaveAttendance}
                disabled={markSaving}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9, marginTop: 14 }}
              >
                {markSaving ? t("groupDetail.savingAttendance") : t("groupDetail.saveAttendance")}
              </button>
            </>
          )}
        </div>

        <GroupAttendanceHistory students={enrollments.map((e) => e.student)} records={attendance} />

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("groupDetail.statStudents")}</div>
            {can(user, "students.edit") && (
              <button
                className="btn"
                onClick={() => {
                  setEnrollMode(availableStudents.length > 0 ? "existing" : "new");
                  setEnrollOpen(true);
                }}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
              >
                {t("groupDetail.addStudent")}
              </button>
            )}
          </div>
          {enrollments.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 14, padding: "24px 20px" }}>{t("groupDetail.noStudentsYet")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 14 }}>{t("groupDetail.colStudent")}</th>
                  <th style={{ paddingTop: 14 }}>{t("groupDetail.colPhone")}</th>
                  <th style={{ paddingTop: 14 }}>{t("groupDetail.colAttendance")}</th>
                  {seesPay && <th style={{ paddingTop: 14 }}>{t("groupDetail.colMonthPayment")}</th>}
                  <th style={{ paddingTop: 14 }}></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.student.fullName}</td>
                    <td>{e.student.phone || "—"}</td>
                    <td>{attendancePercentFor(e.student.id) === null ? "—" : `${attendancePercentFor(e.student.id)}%`}</td>
                    {seesPay && (
                      <td>
                        {(() => {
                          const st = paymentStatusFor(e.student.id);
                          if (st === "PAID") return <span className="badge badge-success">{t("groupDetail.paid")}</span>;
                          if (st === "PARTIAL") return <span className="badge badge-warning">{t("groupDetail.partial")}</span>;
                          if (st === "UNPAID") return <span className="badge badge-danger">{t("groupDetail.debtor")}</span>;
                          return <span style={{ color: "#8A8D96" }}>—</span>;
                        })()}
                      </td>
                    )}
                    <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Link
                        href={`/students/${e.student.id}`}
                        style={{ fontWeight: 600, fontSize: 12.5, color: ACCENT, border: `1px solid ${ACCENT}`, padding: "6px 12px", borderRadius: 8 }}
                      >
                        {t("common.viewProfile")}
                      </Link>
                      {can(user, "students.edit") && <button
                        className="btn"
                        onClick={() => onUnenroll(e.student.id)}
                        style={{ background: "transparent", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: "6px 8px", borderRadius: 8 }}
                      >
                        {t("groupDetail.remove")}
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <GroupExamResults groupId={id} students={(group.enrollments ?? []).map((e) => e.student)} />
        <GroupTutorReport groupId={id} />
      </div>

      <Modal
        open={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          resetEnrollForm();
        }}
        title={t("groupDetail.modalTitle")}
        width={520}
      >
        <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 10, padding: 4, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => setEnrollMode("existing")}
            disabled={availableStudents.length === 0}
            style={{
              flex: 1,
              fontSize: 12.5,
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: 8,
              cursor: availableStudents.length === 0 ? "not-allowed" : "pointer",
              border: "none",
              opacity: availableStudents.length === 0 ? 0.45 : 1,
              background: enrollMode === "existing" ? "#fff" : "transparent",
              color: enrollMode === "existing" ? "#181A1F" : "#8A8D96",
              boxShadow: enrollMode === "existing" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            {t("grp.existing")} ({availableStudents.length})
          </button>
          <button
            type="button"
            onClick={() => setEnrollMode("new")}
            style={{
              flex: 1,
              fontSize: 12.5,
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              border: "none",
              background: enrollMode === "new" ? "#fff" : "transparent",
              color: enrollMode === "new" ? "#181A1F" : "#8A8D96",
              boxShadow: enrollMode === "new" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            {t("grp.newStudent")}
          </button>
        </div>

        <form onSubmit={onEnroll} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {enrollError && (
            <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{enrollError}</div>
          )}

          {enrollMode === "existing" ? (
            <div style={{ minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <Field label={t("groupDetail.studentField")}>
                  <Select
                    options={[{ value: "", label: t("groups.selectPlaceholder") }, ...availableStudents.map((s) => ({ value: s.id, label: s.fullName }))]}
                    value={enrollStudentId}
                    onChange={setEnrollStudentId}
                  />
                </Field>
                {availableStudents.length === 0 && (
                  <div style={{ marginTop: 14, fontSize: 13, color: "#8A8D96", textAlign: "center", lineHeight: 1.5 }}>
                    {t("grp.allEnrolled")}
                  </div>
                )}
              </div>
              <button
                className="btn"
                type="submit"
                disabled={saving || !enrollStudentId}
                style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: 10, marginTop: 16 }}
              >
                {saving ? t("groupDetail.savingAttendance") : t("common.add")}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "10px 14px", borderRadius: 10, fontSize: 12.5, color: "#475569", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: ACCENT }}>{t("grp.group")}</span>
                <span>{group.name} ({group.subject})</span>
              </div>

              <Field label={`${t("students.fieldFullName")} *`}>
                <input
                  className="field-input"
                  placeholder={t("grp.namePh")}
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  pattern={NAME_PATTERN}
                  title={NAME_TITLE}
                  required
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={t("students.fieldGender")}>
                  <Select
                    options={[
                      { value: "", label: t("groups.notSelected") },
                      { value: "MALE", label: t("students.male") },
                      { value: "FEMALE", label: t("students.female") }
                    ]}
                    value={newGender}
                    onChange={(v) => setNewGender(v as Gender | "")}
                  />
                </Field>
                <Field label={t("students.fieldBirthDate")}>
                  <DatePicker value={newBirthDate} onChange={setNewBirthDate} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={t("students.fieldPhone")}>
                  <PhoneInput
                    className="field-input"
                    value={newPhone}
                    onChange={setNewPhone}
                    pattern={PHONE_PATTERN}
                    title={PHONE_TITLE}
                  />
                </Field>
                <Field label={t("students.fieldParentPhone")}>
                  <PhoneInput
                    className="field-input"
                    value={newParentPhone}
                    onChange={setNewParentPhone}
                    pattern={PHONE_PATTERN}
                    title={PHONE_TITLE}
                  />
                </Field>
              </div>

              <button
                className="btn"
                type="submit"
                disabled={saving}
                style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: 10, marginTop: 4 }}
              >
                {saving ? t("students.adding") : t("grp.addNew")}
              </button>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export default function GroupDetailPage() {
  return (
    <DashboardShell>
      <GroupDetailContent />
    </DashboardShell>
  );
}
