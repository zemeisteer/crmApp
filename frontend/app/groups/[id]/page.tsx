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
import GroupLessonCancellations from "@/components/groups/GroupLessonCancellations";
import { groupsApi, studentsApi, paymentsApi, attendanceApi, lessonsApi, Group, Student, Gender, AttendanceRecord, AttendanceStatus, ApiError, retryKey, type DebtorItem, type LessonOccurrence, type UnboundAttendance } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { PHONE_PATTERN, PHONE_TITLE, NAME_PATTERN, NAME_TITLE, phoneOrEmpty } from "@/lib/validation";
import { useCenterClock } from "@/lib/use-center-clock";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import PhoneInput from "@/components/PhoneInput";
import CustomFieldInputs, { cfSubmitError, useCfDraft, useCustomFieldDefs } from "@/components/custom-fields/CustomFieldInputs";
import { cfPayload, cfValidate } from "@/lib/custom-fields";

const ACCENT = "var(--primary)";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const ATTENDANCE_LABEL_KEYS: Record<AttendanceStatus, TranslationKey> = {
  PRESENT: "groupDetail.present",
  LATE: "groupDetail.late",
  ABSENT: "groupDetail.absent",
};

const ATTENDANCE_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: "var(--success)",
  LATE: "var(--warning)",
  ABSENT: "var(--danger)",
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
  // The center's own student fields: a new student answers the required ones here too.
  const cfDefs = useCustomFieldDefs("STUDENT", { enabled: enrollOpen && enrollMode === "new" });
  const cf = useCfDraft();
  function resetEnrollForm() {
    createKey.current = null;
    cf.reset();
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
  const [topics, setTopics] = useState<Array<{ date: string; topic: string; scheduleId: string | null }>>([]);
  const [topic, setTopic] = useState("");
  // Attendance is per lesson: the timetable lessons of the chosen day, and
  // the one being marked. One lesson: no extra step. None: a mark for the
  // day as a whole.
  const [dayLessons, setDayLessons] = useState<LessonOccurrence[] | null>(null);
  const [dayLessonsError, setDayLessonsError] = useState(false);
  const [lessonPick, setLessonPick] = useState("");
  const [markError, setMarkError] = useState<string | null>(null);
  const [unbound, setUnbound] = useState<UnboundAttendance["days"]>([]);
  const lessonReq = useRef(0);
  const [lessonNonce, setLessonNonce] = useState(0);
  // Whose lesson it was: for a past lesson, the students in the group THEN
  // (someone who has left since is listed, someone on a break is not) - the
  // server's own rule, so what is listed is what can be saved.
  const [roster, setRoster] = useState<Array<{ studentId: string; fullName: string; current: boolean }> | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const rosterReq = useRef(0);
  const lessonsReady = dayLessons !== null;
  useEffect(() => {
    if (!lessonsReady) return;
    const n = ++rosterReq.current;
    setRoster(null);
    setRosterFailed(false);
    groupsApi.roster(id, attendanceDate, lessonPick || undefined)
      .then((list) => rosterReq.current === n && setRoster(list))
      .catch(() => rosterReq.current === n && setRosterFailed(true));
  }, [id, attendanceDate, lessonPick, lessonsReady, group]);
  // If the list cannot be loaded, the students in the group now are offered (the save still checks each).
  const markList = roster ?? (rosterFailed
    ? (group?.enrollments || []).filter((e) => !e.status || e.status === "ACTIVE").map((e) => ({ studentId: e.student.id, fullName: e.student.fullName, current: true }))
    : null);
  const isAdmin = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  useEffect(() => {
    // An answer for a date picked earlier must not replace this date's lessons.
    const n = ++lessonReq.current;
    setDayLessons(null);
    setDayLessonsError(false);
    setMarkError(null);
    lessonsApi.list(attendanceDate, attendanceDate, id)
      .then((list) => {
        if (lessonReq.current !== n) return;
        const withRow = list.filter((l) => l.scheduleId);
        setDayLessons(withRow);
        setLessonPick((withRow.find((l) => !l.cancelled) ?? withRow[0])?.scheduleId ?? "");
      })
      .catch(() => {
        if (lessonReq.current === n) setDayLessonsError(true);
      });
  }, [id, attendanceDate, lessonNonce]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    attendanceApi.unbound().then((u) => alive && setUnbound(u.days.filter((d) => d.groupId === id))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, isAdmin, attendance]);

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
    const next: Record<string, AttendanceStatus> = {};
    for (const m of markList ?? []) {
      const e = { student: { id: m.studentId } };
      const onDay = attendance.filter((a) => a.studentId === e.student.id && a.date === attendanceDate);
      // This lesson's mark; failing that, an old mark for the day as a whole (saving makes it this lesson's).
      const existing = lessonPick ? onDay.find((a) => a.scheduleId === lessonPick) ?? onDay.find((a) => !a.scheduleId) : onDay.find((a) => !a.scheduleId);
      next[e.student.id] = existing?.status || "PRESENT";
    }
    setDraft(next);
    // The picked lesson's own topic, else the one for the day as a whole.
    const onDayTopics = topics.filter((x) => x.date === attendanceDate);
    setTopic((lessonPick ? onDayTopics.find((x) => x.scheduleId === lessonPick) : undefined)?.topic ?? onDayTopics.find((x) => !x.scheduleId)?.topic ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markList is derived from roster/rosterFailed/group
  }, [group, attendance, attendanceDate, topics, lessonPick, roster, rosterFailed]);

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !group) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
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
    const enrolled = (markList ?? []).map((m) => ({ student: { id: m.studentId } }));
    if (enrolled.length === 0) return;
    setMarkSaving(true);
    setMarkError(null);
    try {
      await attendanceApi.mark({
        groupId: id,
        date: attendanceDate,
        scheduleId: lessonPick || undefined,
        entries: enrolled.map((e) => ({ studentId: e.student.id, status: draft[e.student.id] || "PRESENT" })),
        topic,
      });
      load();
    } catch (err) {
      // Nothing was saved (all marks or none): say why.
      setMarkError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
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
        const cfErrs = cfValidate(cfDefs.defs ?? [], cf.draft, "create");
        cf.setErrors(cfErrs);
        if (Object.keys(cfErrs).length) {
          setEnrollError(t("cf.formError"));
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
          customFields: cfPayload(cfDefs.defs ?? [], cf.draft, "create"),
        };
        await studentsApi.create(body, retryKey(createKey, body));
        createKey.current = null;
      }
      setEnrollOpen(false);
      resetEnrollForm();
      load();
    } catch (err) {
      const { fields, message } = cfSubmitError(err, enrollMode === "new" ? cfDefs.defs ?? [] : [], t);
      if (fields) cf.setErrors(fields);
      setEnrollError(message);
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
    const res = await groupsApi.remove(id);
    // Make-ups booked into this group's coming lessons went with it: say so.
    if (res?.makeups?.released) window.alert(t("sch.makeups.released").replace("{n}", String(res.makeups.released)));
    router.push("/groups");
  }

  return (
    <>
      <div style={{ padding: "var(--page-head-pad)" }}>
        <Link href="/groups" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("groupDetail.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {group.name}
              {(() => {
                const max = group.maxStudents || 0;
                const b =
                  group.status && group.status !== "ACTIVE"
                    ? { text: group.status === "PLANNED" ? t("grp.stPlanned") : group.status === "COMPLETED" ? t("grp.stCompleted") : t("grp.stArchived"), color: "var(--text-muted)", bg: "var(--surface-muted)" }
                    : max > 0 && enrollments.length >= max
                      ? { text: t("grp.stFull"), color: "var(--success)", bg: "var(--success-soft)" }
                      : { text: t("grp.activeGroup"), color: "var(--success)", bg: "var(--success-soft)" };
                return <span style={{ fontSize: 12, fontWeight: 700, color: b.color, background: b.bg, padding: "4px 10px", borderRadius: "var(--radius-pill)", fontFamily: "'Inter', sans-serif" }}>{b.text}</span>;
              })()}
            </h1>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
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
                style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}
              >
                {t("groupDetail.deleteGroup")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${seesPay && dues ? 5 : 3}, minmax(0,1fr))`, gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("groupDetail.statStudents")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>
              {enrollments.length} / {group.maxStudents}
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("groupDetail.statAvgAttendance")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>
              {groupAveragePercent === null ? "—" : `${groupAveragePercent}%`}
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("groupDetail.statMonthlyPrice")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>
              {group.monthlyPrice ? `${formatMoney(group.monthlyPrice)} ${t("common.sumUnit")}` : "—"}
            </div>
          </div>
          {seesPay && dues && (
            <>
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("groupDetail.statMonthRevenue")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>
                  {/* What these students paid for the month, at most this group's price each. */}
                  {formatMoney(enrollments.reduce((sum, e) => sum + Math.min(dues.get(e.student.id)?.paidAmount ?? 0, group.monthlyPrice || 0), 0))}{" "}
                  {t("common.sumUnit")}
                </div>
              </div>
              <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
                <div style={{ fontSize: 12, color: "var(--danger)" }}>{t("groupDetail.statMonthDebtors")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4, color: "var(--danger)" }}>
                  {enrollments.filter((e) => { const st = paymentStatusFor(e.student.id); return st === "UNPAID" || st === "PARTIAL"; }).length}
                </div>
              </div>
            </>
          )}
        </div>

        <GroupInfoCard group={group} students={enrollments.length} lessonsHeld={new Set(attendance.map((a) => `${a.date}|${a.scheduleId ?? ""}`)).size} />

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("groupDetail.markAttendance")}</div>
            <DatePicker value={attendanceDate} onChange={setAttendanceDate} style={{ width: 170 }} />
          </div>
          {/* Which lesson of that day: asked only when there are several. */}
          {dayLessonsError ? (
            <div role="alert" style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {t("groupDetail.attLessonsError")}
              <button type="button" className="btn" onClick={() => setLessonNonce((n) => n + 1)} style={{ background: "var(--surface)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-xs)", padding: "5px 10px", fontSize: 12.5, fontWeight: 700 }}>{t("err.retry")}</button>
            </div>
          ) : dayLessons === null ? (
            <div style={{ marginBottom: 12, fontSize: 12.5, color: "var(--text-muted)" }}>{t("common.loading")}</div>
          ) : dayLessons.length > 1 ? (
            <div role="group" aria-label={t("groupDetail.attLesson")} style={{ marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 6 }}>{t("groupDetail.attLesson")}</span>
              <Select
                ariaLabel={t("groupDetail.attLesson")}
                sheetOnPhone
                sheetTitle={t("groupDetail.attLesson")}
                options={dayLessons.map((l) => ({ value: l.scheduleId!, label: `${l.startTime}–${l.endTime}${l.cancelled ? ` · ${t("groupDetail.attCancelledShort")}` : ""}` }))}
                value={lessonPick}
                onChange={setLessonPick}
              />
            </div>
          ) : dayLessons.length === 0 ? (
            <div style={{ marginBottom: 12, fontSize: 12.5, color: "var(--text-muted)" }}>{t("groupDetail.attNoLesson")}</div>
          ) : null}
          {dayLessons?.find((l) => l.scheduleId === lessonPick)?.cancelled && (
            <div role="status" style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", color: "var(--warning)", fontSize: 13, fontWeight: 600 }}>{t("groupDetail.attLessonCancelled")}</div>
          )}
          {unbound.length > 0 && (
            <div role="note" aria-label={t("groupDetail.attUnboundTitle")} style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-muted)", color: "var(--text-soft)", fontSize: 12.5, lineHeight: 1.5 }}>
              <b>{t("groupDetail.attUnboundTitle")}</b> {t("groupDetail.attUnboundText")}
              <div style={{ marginTop: 4 }}>
                {unbound.slice(0, 8).map((d) => (
                  <button key={d.date} type="button" className="btn" onClick={() => setAttendanceDate(d.date)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: "3px 8px", fontSize: 12, fontWeight: 700, margin: "2px 6px 2px 0" }}>
                    {d.date} · {d.reason === "SEVERAL" ? t("groupDetail.attUnboundSeveral") : t("groupDetail.attUnboundNone")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {markError && <div role="alert" style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{markError}</div>}
          {markList === null ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13.5 }}>{t("common.loading")}</div>
          ) : markList.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13.5 }}>{t("groupDetail.noStudentsForAttendance")}</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {markList.map((m) => {
                  const e = { student: { id: m.studentId, fullName: m.fullName } };
                  const status = draft[e.student.id] || "PRESENT";
                  return (
                    <div
                      key={m.studentId}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.student.fullName}</span>
                        {/* Was in the group at this lesson, and is not any more. */}
                        {!m.current && <span style={{ display: "block", fontSize: 11.5, color: "var(--warning)" }}>{t("groupDetail.attLeftSince")}</span>}
                      </span>
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
                              borderRadius: "var(--radius-xs)",
                              border: `1px solid ${status === s ? ATTENDANCE_COLOR[s] : "var(--border)"}`,
                              background: status === s ? ATTENDANCE_COLOR[s] : "transparent",
                              color: status === s ? "var(--on-ink)" : "var(--text-soft)",
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
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 6 }}>📖 {t("groupDetail.lessonTopic")}</span>
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
                disabled={markSaving || dayLessons === null || markList === null || !!dayLessons.find((l) => l.scheduleId === lessonPick)?.cancelled}
                style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: "var(--radius-sm)", marginTop: 14 }}
              >
                {markSaving ? t("groupDetail.savingAttendance") : t("groupDetail.saveAttendance")}
              </button>
            </>
          )}
        </div>

        <GroupAttendanceHistory students={enrollments.map((e) => e.student)} records={attendance} />

        {can(user, "lessons.cancel") && <GroupLessonCancellations groupId={id} />}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("groupDetail.statStudents")}</div>
            {can(user, "students.edit") && (
              <button
                className="btn"
                onClick={() => {
                  setEnrollMode(availableStudents.length > 0 ? "existing" : "new");
                  setEnrollOpen(true);
                }}
                style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-xs)" }}
              >
                {t("groupDetail.addStudent")}
              </button>
            )}
          </div>
          {enrollments.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "24px 20px" }}>{t("groupDetail.noStudentsYet")}</div>
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
                          return <span style={{ color: "var(--text-muted)" }}>—</span>;
                        })()}
                      </td>
                    )}
                    <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Link
                        href={`/students/${e.student.id}`}
                        style={{ fontWeight: 600, fontSize: 12.5, color: ACCENT, border: `1px solid ${ACCENT}`, padding: "6px 12px", borderRadius: "var(--radius-xs)" }}
                      >
                        {t("common.viewProfile")}
                      </Link>
                      {can(user, "students.edit") && <button
                        className="btn"
                        onClick={() => onUnenroll(e.student.id)}
                        style={{ background: "transparent", color: "var(--danger)", fontSize: 12.5, fontWeight: 600, padding: "6px 8px", borderRadius: "var(--radius-xs)" }}
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
        <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: 4, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => setEnrollMode("existing")}
            disabled={availableStudents.length === 0}
            style={{
              flex: 1,
              fontSize: 12.5,
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: "var(--radius-pill)",
              cursor: availableStudents.length === 0 ? "not-allowed" : "pointer",
              border: "none",
              opacity: availableStudents.length === 0 ? 0.45 : 1,
              background: enrollMode === "existing" ? "var(--ink)" : "transparent",
              color: enrollMode === "existing" ? "var(--on-ink)" : "var(--text-muted)",
              boxShadow: "none",
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
              borderRadius: "var(--radius-pill)",
              cursor: "pointer",
              border: "none",
              background: enrollMode === "new" ? "var(--ink)" : "transparent",
              color: enrollMode === "new" ? "var(--on-ink)" : "var(--text-muted)",
              boxShadow: "none",
              transition: "all 0.15s ease",
            }}
          >
            {t("grp.newStudent")}
          </button>
        </div>

        <form onSubmit={onEnroll} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {enrollError && (
            <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{enrollError}</div>
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
                  <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>
                    {t("grp.allEnrolled")}
                  </div>
                )}
              </div>
              <button
                className="btn"
                type="submit"
                disabled={saving || !enrollStudentId}
                style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: "var(--radius-sm)", marginTop: 16 }}
              >
                {saving ? t("groupDetail.savingAttendance") : t("common.add")}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
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

              {cfDefs.error && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--warning)" }}>{t("cf.defsError")}</div>}
              <CustomFieldInputs defs={cfDefs.defs ?? []} values={cf.draft} errors={cf.errors} onChange={cf.change} idPrefix="group-new-student-cf" title={t("cf.section")} />

              <button
                className="btn"
                type="submit"
                disabled={saving}
                style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: "var(--radius-sm)", marginTop: 4 }}
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
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{label}</div>
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
