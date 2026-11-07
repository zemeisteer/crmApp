"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TeacherAccountCard from "@/components/teachers/TeacherAccountCard";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { teachersApi, groupsApi, paymentsApi, salaryApi, Teacher, Group, Student, Payment, SalaryPayment, TeacherPayrollItem, ApiError } from "@/lib/api";
import { useCenterClock } from "@/lib/use-center-clock";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

const ACCENT = "var(--primary)";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type FullGroup = Group & { enrollments?: { id: string; student: Student }[] };

function TeacherDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { t, lang } = useLanguage();
  const clock = useCenterClock();

  const { user } = useAuth();
  const [teacher, setTeacher] = useState<(Teacher & { groups?: Group[] }) | null>(null);
  const [fullGroups, setFullGroups] = useState<FullGroup[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  // This month's line of the payroll engine (null for roles without payroll access).
  const [payrollLine, setPayrollLine] = useState<TeacherPayrollItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [subject, setSubject] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [salaryType, setSalaryType] = useState("FIXED");
  const [salaryValue, setSalaryValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    teachersApi
      .get(id)
      .then(async (t) => {
        setTeacher(t as any);
        const groups = (t as any).groups as Group[] | undefined;
        const [full, p, sp, payroll] = await Promise.all([
          Promise.all((groups || []).map((g) => groupsApi.get(g.id))),
          paymentsApi.list().catch(() => []),
          salaryApi.list(id).catch(() => []),
          salaryApi.calculate(clock.month()).catch(() => null),
        ]);
        setFullGroups(full as FullGroup[]);
        setPayments(p);
        setSalaryPayments(sp);
        setPayrollLine(payroll?.teachers.find((x) => x.teacherId === id) ?? null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id, clock]);

  const month = clock.month();

  function groupRevenue(g: FullGroup) {
    const enrolled = g.enrollments || [];
    return enrolled.reduce((sum, e) => {
      const paid = payments.some((p) => p.studentId === e.student.id && p.forMonth === month && p.status === "PAID");
      return paid ? sum + (g.monthlyPrice || 0) : sum;
    }, 0);
  }

  const totalRevenue = fullGroups.reduce((sum, g) => sum + groupRevenue(g), 0);
  const totalStudents = fullGroups.reduce((sum, g) => sum + (g.enrollments?.length || 0), 0);

  const daysOfWeekUz = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
  const todayWeekdayIndex = clock.weekday() % 7; // 0 = Sunday, as daysOfWeekUz
  const todayWeekday = daysOfWeekUz[todayWeekdayIndex];

  const lessonsStats = useMemo(() => {
    let daily = 0;
    let weekly = 0;

    const weekdayShort = [
      ["yak", "sun"],
      ["dush", "mon"],
      ["sesh", "tue"],
      ["chor", "wed"],
      ["pay", "thu"],
      ["jum", "fri"],
      ["shan", "sat"],
    ];

    const todayTokens = weekdayShort[todayWeekdayIndex];

    for (const g of fullGroups) {
      const sch = (g.schedule || "").toLowerCase();
      let groupWeekly = 0;
      if (sch.includes("har kuni") || sch.includes("every day")) {
        groupWeekly = 6;
      } else if (sch.includes("toq") || sch.includes("juft")) {
        groupWeekly = 3;
      } else {
        for (const [uz, en] of weekdayShort) {
          if (sch.includes(uz) || sch.includes(en)) groupWeekly++;
        }
        if (groupWeekly === 0) groupWeekly = 3;
      }

      weekly += groupWeekly;

      if (sch.includes("har kuni") || todayTokens.some((t) => sch.includes(t))) {
        daily += 1;
      } else if ((sch.includes("toq") && [1, 3, 5].includes(todayWeekdayIndex)) || (sch.includes("juft") && [2, 4, 6].includes(todayWeekdayIndex))) {
        daily += 1;
      }
    }

    return {
      daily,
      weekly,
      monthly: weekly * 4,
    };
  }, [fullGroups, todayWeekdayIndex]);

  const teacherAge = useMemo(() => {
    if (!teacher?.birthDate) return null;
    const b = new Date(teacher.birthDate);
    if (isNaN(b.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) {
      age--;
    }
    const formatted = formatDate(b, lang, "long");
    return { age, formatted, year: b.getFullYear() };
  }, [teacher, lang]);

  const startedDateFormatted = useMemo(() => {
    const raw = teacher?.startDate || teacher?.createdAt;
    if (!raw) return "—";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "—";
    return formatDate(d, lang, "long");
  }, [teacher?.startDate, teacher?.createdAt, lang]);

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !teacher) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
          {t("teacherDetail.notFound")}{" "}
          <Link href="/teachers" style={{ color: ACCENT, fontWeight: 600 }}>
            {t("teacherDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  function openEdit() {
    setFullName(teacher!.fullName);
    setSubject(teacher!.subject || "");
    setPhone(teacher!.phone || "");
    setEmail(teacher!.email || "");
    setBirthDate(teacher!.birthDate ? String(teacher!.birthDate).slice(0, 10) : "");
    setStartDate(teacher!.startDate ? String(teacher!.startDate).slice(0, 10) : "");
    setSalaryType(teacher!.salaryType || "FIXED");
    setSalaryValue(teacher!.salaryValue != null ? String(teacher!.salaryValue) : "");
    setEditError(null);
    setEditOpen(true);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setSaving(true);
    try {
      await teachersApi.update(id, {
        fullName,
        subject: subject || undefined,
        phone: phone || undefined,
        email: email || undefined,
        birthDate: birthDate || undefined,
        startDate: startDate || undefined,
        salaryType: salaryValue ? salaryType : undefined,
        salaryValue: salaryValue ? Number(salaryValue) : undefined,
      });
      setEditOpen(false);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm(t("teacherDetail.confirmDelete"))) return;
    await teachersApi.remove(id);
    router.push("/teachers");
  }

  return (
    <>
      <div style={{ padding: "var(--page-head-pad)" }}>
        <Link href="/teachers" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("teacherDetail.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: "var(--radius-md)",
                background: ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--on-ink)",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {initials(teacher.fullName)}
            </div>
            <div>
              <h1 className="page-title">{teacher.fullName}</h1>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                {teacher.subject || t("teacherDetail.directionMissing")}
                {teacher.phone ? ` · ${teacher.phone}` : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn"
              onClick={openEdit}
              style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}
            >
              {t("teacherDetail.edit")}
            </button>
            <button
              className="btn"
              onClick={onDelete}
              style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}
            >
              {t("teacherDetail.delete")}
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("teacherDetail.statGroups")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>{fullGroups.length}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("teacherDetail.statTotalStudents")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>{totalStudents}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("teacherDetail.statMonthGroupRevenue")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4 }}>{formatMoney(totalRevenue)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: "var(--primary-soft)", border: "1px solid var(--primary-border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
            <div style={{ fontSize: 12, color: ACCENT }}>{t("teacherDetail.statMonthCalculatedSalary")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4, color: ACCENT }}>
              {/* Only the payroll engine's number (as in Reports -> Payroll); no
                  estimate of our own that could disagree with it. */}
              {payrollLine ? `${formatMoney(payrollLine.calculatedSalary)} ${t("common.sumUnit")}` : "—"}
            </div>
            {/* Why the amount is what it is: a fixed salary counts from the start day, and only once there are lessons. */}
            {payrollLine?.details?.noLessons ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t("teacherDetail.salaryNoLessons")}</div>
            ) : payrollLine?.details?.workedFromDay ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t("teacherDetail.salaryFromDay").replace("{day}", String(payrollLine.details.workedFromDay))}</div>
            ) : null}
            {/* Payouts are made in Reports -> Payroll (installments, one expense each). */}
            {payrollLine && payrollLine.calculatedSalary > 0 ? (
              payrollLine.isPaid ? (
                <span className="badge badge-success" style={{ marginTop: 8, display: "inline-block" }}>
                  {t("teacherDetail.paidThisMonth")}
                </span>
              ) : (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {payrollLine.paidAmount > 0 && <span className="badge badge-warning">{t("teacherDetail.partPaid")}</span>}
                  <Link
                    href="/reports?tab=payroll"
                    className="btn"
                    style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: "var(--radius-xs)" }}
                  >
                    {t("teacherDetail.payInReports")}
                  </Link>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Dars yuklamasi statistikasi */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", background: "var(--primary-soft)", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              📅
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Bugungi darslar ({todayWeekday})</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--text)" }}>{lessonsStats.daily} ta dars</div>
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              🗓️
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{t("tch.weeklyLessons")}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--text)" }}>{lessonsStats.weekly} ta dars</div>
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", background: "var(--warning-soft)", color: "var(--warning)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              ⏳
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{t("tch.monthlyLessons")}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--text)" }}>{lessonsStats.monthly} ta dars</div>
            </div>
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("teacherDetail.aboutTeacher")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "18px 16px" }}>
            <InfoField label={t("teacherDetail.email")} value={teacher.email || "—"} />
            <InfoField label={t("teacherDetail.phone")} value={teacher.phone || "—"} />
            <InfoField
              label={t("tch.birthAge")}
              value={teacherAge ? `${teacherAge.formatted} (${teacherAge.age} yosh)` : "—"}
            />
            <InfoField label={t("tch.startDate")} value={startedDateFormatted} />
            {/* Pay is sent only to finance roles; others see no pay fields. */}
            {"salaryType" in teacher && (
              <>
                <InfoField
                  label={t("teacherDetail.salaryTypeField")}
                  value={
                    teacher.salaryType === "PERCENT" ? t("teachers.salaryPercent")
                    : teacher.salaryType === "PER_STUDENT" ? t("tch.salPerStudent")
                    : teacher.salaryType === "PER_LESSON" ? t("tch.salPerLesson")
                    : t("teachers.salaryFixed")
                  }
                />
                <InfoField
                  label={
                    teacher.salaryType === "PERCENT" ? t("tch.percentAmount")
                    : teacher.salaryType === "PER_STUDENT" ? t("tch.perStudentAmount")
                    : teacher.salaryType === "PER_LESSON" ? t("tch.perLessonAmount")
                    : t("teacherDetail.monthlySalary")
                  }
                  value={teacher.salaryValue ? (teacher.salaryType === "PERCENT" ? `${teacher.salaryValue}%` : `${formatMoney(teacher.salaryValue)} ${t("common.sumUnit")}`) : "—"}
                />
              </>
            )}
          </div>
        </div>

        <TeacherAccountCard teacher={teacher} canManage={can(user, "teachers.edit")} onChanged={(nt) => setTeacher((cur) => (cur ? { ...cur, ...nt } : cur))} />

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("teacherDetail.groupsTitle")}</div>
          {fullGroups.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "24px 20px" }}>{t("teacherDetail.noGroupsAssigned")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colGroup")}</th>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colSchedule")}</th>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colStudents")}</th>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colMonthRevenue")}</th>
                  <th style={{ paddingTop: 14 }}></th>
                </tr>
              </thead>
              <tbody>
                {fullGroups.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>{g.name}</td>
                    <td>{g.schedule || "—"}</td>
                    <td>
                      {(g.enrollments?.length || 0)} / {g.maxStudents}
                    </td>
                    <td>{formatMoney(groupRevenue(g))} {t("common.sumUnit")}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/groups/${g.id}`}
                        style={{ fontWeight: 600, fontSize: 12.5, color: ACCENT, border: `1px solid ${ACCENT}`, padding: "6px 12px", borderRadius: "var(--radius-xs)" }}
                      >
                        {t("teacherDetail.viewGroup")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("teacherDetail.salaryHistory")}</div>
          {salaryPayments.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "24px 20px" }}>{t("teacherDetail.noSalaryPayments")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colMonth")}</th>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colAmount")}</th>
                  <th style={{ paddingTop: 14 }}>{t("teacherDetail.colPaidDate")}</th>
                </tr>
              </thead>
              <tbody>
                {salaryPayments.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.forMonth}</td>
                    <td style={{ textDecoration: s.reversedAt ? "line-through" : undefined, color: s.reversedAt ? "var(--text-muted)" : undefined }}>
                      {formatMoney(s.amount)} {t("common.sumUnit")}
                      {s.reversedAt && <span className="badge badge-neutral" style={{ marginLeft: 8 }} title={s.reversalReason ?? undefined}>{t("rep2.reversed")}</span>}
                    </td>
                    <td>{formatDate(s.paidAt, lang, "long")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t("teacherDetail.modalEditTitle")}>
        <form onSubmit={onSaveEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {editError && (
            <div style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{editError}</div>
          )}
          <Field label={t("teacherDetail.fieldFullName")}>
            <input className="field-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t("teacherDetail.fieldDirection")}>
            <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label={t("teacherDetail.fieldPhone")}>
            <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t("teacherDetail.fieldEmail")}>
            <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("tch.birthDate")}>
            <DatePicker value={birthDate} onChange={setBirthDate} />
          </Field>
          <Field label={t("tch.startDate")}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label={t("teachers.fieldSalaryType")}>
            <Select
              options={[
                { value: "FIXED", label: t("tch.salFixed") },
                { value: "PERCENT", label: t("tch.salPercent") },
                { value: "PER_STUDENT", label: t("tch.salPerStudent") },
                { value: "PER_LESSON", label: t("tch.salPerLesson") },
              ]}
              value={salaryType}
              onChange={setSalaryType}
            />
          </Field>
          <Field
            label={
              salaryType === "PERCENT"
                ? t("tch.percentAmount")
                : salaryType === "PER_STUDENT"
                  ? t("tch.perStudentAmount")
                  : salaryType === "PER_LESSON"
                    ? t("tch.perLessonAmount")
                    : t("tch.fixedAmount")
            }
          >
            <input
              className="field-input"
              type="number"
              min={0}
              max={salaryType === "PERCENT" ? 100 : undefined}
              value={salaryValue}
              onChange={(e) => setSalaryValue(e.target.value)}
            />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)", marginTop: 6 }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </Modal>
    </>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
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

export default function TeacherDetailPage() {
  return (
    <DashboardShell>
      <TeacherDetailContent />
    </DashboardShell>
  );
}
