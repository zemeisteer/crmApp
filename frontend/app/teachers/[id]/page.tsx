"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { teachersApi, groupsApi, paymentsApi, salaryApi, Teacher, Group, Student, Payment, SalaryPayment, ApiError } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function currentMonth() {
  return localMonthStr();
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

  const [teacher, setTeacher] = useState<(Teacher & { groups?: Group[] }) | null>(null);
  const [fullGroups, setFullGroups] = useState<FullGroup[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  const [markingSalary, setMarkingSalary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [subject, setSubject] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
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
        const [full, p, sp] = await Promise.all([
          Promise.all((groups || []).map((g) => groupsApi.get(g.id))),
          paymentsApi.list(),
          salaryApi.list(id),
        ]);
        setFullGroups(full as FullGroup[]);
        setPayments(p);
        setSalaryPayments(sp);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  if (loading) {
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !teacher) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          {t("teacherDetail.notFound")}{" "}
          <Link href="/teachers" style={{ color: ACCENT, fontWeight: 600 }}>
            {t("teacherDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const month = currentMonth();

  function groupRevenue(g: FullGroup) {
    const enrolled = g.enrollments || [];
    return enrolled.reduce((sum, e) => {
      const paid = payments.some((p) => p.studentId === e.student.id && p.forMonth === month && p.status === "PAID");
      return paid ? sum + (g.monthlyPrice || 0) : sum;
    }, 0);
  }

  const totalRevenue = fullGroups.reduce((sum, g) => sum + groupRevenue(g), 0);
  const totalStudents = fullGroups.reduce((sum, g) => sum + (g.enrollments?.length || 0), 0);

  const calculatedSalary =
    teacher.salaryType === "PERCENT"
      ? Math.round((totalRevenue * (teacher.salaryValue || 0)) / 100)
      : teacher.salaryValue || 0;

  function openEdit() {
    setFullName(teacher!.fullName);
    setSubject(teacher!.subject || "");
    setPhone(teacher!.phone || "");
    setEmail(teacher!.email || "");
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
        salaryType: salaryValue ? salaryType : undefined,
        salaryValue: salaryValue ? Number(salaryValue) : undefined,
      });
      setEditOpen(false);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm(t("teacherDetail.confirmDelete"))) return;
    await teachersApi.remove(id);
    router.push("/teachers");
  }

  const salaryPaidThisMonth = salaryPayments.find((s) => s.forMonth === month);

  async function onMarkSalaryPaid() {
    if (!calculatedSalary) return;
    setMarkingSalary(true);
    try {
      await salaryApi.create({ teacherId: id, amount: calculatedSalary, forMonth: month });
      load();
    } finally {
      setMarkingSalary(false);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <Link href="/teachers" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8A8D96", marginBottom: 10 }}>
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
                borderRadius: 12,
                background: ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {initials(teacher.fullName)}
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800 }}>{teacher.fullName}</h1>
              <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
                {teacher.subject || t("teacherDetail.directionMissing")}
                {teacher.phone ? ` · ${teacher.phone}` : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn"
              onClick={openEdit}
              style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
            >
              {t("teacherDetail.edit")}
            </button>
            <button
              className="btn"
              onClick={onDelete}
              style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
            >
              {t("teacherDetail.delete")}
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("teacherDetail.statGroups")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{fullGroups.length}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("teacherDetail.statTotalStudents")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{totalStudents}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("teacherDetail.statMonthGroupRevenue")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(totalRevenue)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: "#ECEBFB", border: "1px solid #D7D3F8", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: ACCENT }}>{t("teacherDetail.statMonthCalculatedSalary")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: ACCENT }}>
              {teacher.salaryValue ? `${formatMoney(calculatedSalary)} ${t("common.sumUnit")}` : "—"}
            </div>
            {teacher.salaryValue ? (
              salaryPaidThisMonth ? (
                <span className="badge badge-success" style={{ marginTop: 8, display: "inline-block" }}>
                  {t("teacherDetail.paidThisMonth")}
                </span>
              ) : (
                <button
                  className="btn"
                  onClick={onMarkSalaryPaid}
                  disabled={markingSalary}
                  style={{ marginTop: 8, background: ACCENT, color: "#fff", border: "none", fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 7 }}
                >
                  {markingSalary ? "..." : t("teacherDetail.markPaid")}
                </button>
              )
            ) : null}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("teacherDetail.aboutTeacher")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "18px 16px" }}>
            <InfoField label={t("teacherDetail.email")} value={teacher.email || "—"} />
            <InfoField label={t("teacherDetail.phone")} value={teacher.phone || "—"} />
            <InfoField
              label={t("teacherDetail.salaryTypeField")}
              value={teacher.salaryType === "PERCENT" ? t("teachers.salaryPercent") : t("teachers.salaryFixed")}
            />
            <InfoField
              label={teacher.salaryType === "PERCENT" ? t("teacherDetail.percent") : t("teacherDetail.monthlySalary")}
              value={teacher.salaryValue ? (teacher.salaryType === "PERCENT" ? `${teacher.salaryValue}%` : `${formatMoney(teacher.salaryValue)} ${t("common.sumUnit")}`) : "—"}
            />
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("teacherDetail.groupsTitle")}</div>
          {fullGroups.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 14, padding: "24px 20px" }}>{t("teacherDetail.noGroupsAssigned")}</div>
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
                        style={{ fontWeight: 600, fontSize: 12.5, color: ACCENT, border: `1px solid ${ACCENT}`, padding: "6px 12px", borderRadius: 8 }}
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

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("teacherDetail.salaryHistory")}</div>
          {salaryPayments.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 14, padding: "24px 20px" }}>{t("teacherDetail.noSalaryPayments")}</div>
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
                    <td>{formatMoney(s.amount)} {t("common.sumUnit")}</td>
                    <td>{new Date(s.paidAt).toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" })}</td>
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
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{editError}</div>
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
          <Field label={t("teachers.fieldSalaryType")}>
            <Select
              options={[{ value: "FIXED", label: t("teachers.salaryFixed") }, { value: "PERCENT", label: t("teachers.salaryPercent") }]}
              value={salaryType}
              onChange={setSalaryType}
            />
          </Field>
          <Field label={salaryType === "PERCENT" ? t("teacherDetail.fieldPercent") : t("teacherDetail.fieldMonthlySalary")}>
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
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
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
      <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
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

export default function TeacherDetailPage() {
  return (
    <DashboardShell>
      <TeacherDetailContent />
    </DashboardShell>
  );
}
