"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { groupsApi, branchesApi, teachersApi, subjectsApi, Group, Branch, Teacher, ApiError, CATEGORY_SUBJECT_SUGGESTIONS } from "@/lib/api";
import { matchesSubject } from "@/lib/subject";

const ACCENT = "#4F46E5";
// Actual values stored on groups.scheduleDays (always Uzbek) — WEEKDAY_LABEL_KEYS below is the parallel display-only translation.
const WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
const WEEKDAY_LABEL_KEYS: TranslationKey[] = [
  "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday",
  "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday",
];
const OTHER_SUBJECT = "__OTHER__";

function GroupsContent() {
  const { tenant } = useAuth();
  const { t } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [page, setPage] = useState(1);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [level, setLevel] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [startDate, setStartDate] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [maxStudents, setMaxStudents] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleConflicts, setScheduleConflicts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!teacherId || days.length === 0 || !startTime) {
      setScheduleConflicts([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      groupsApi
        .scheduleConflicts({ teacherId, days: days.join(","), startTime })
        .then((res) => { if (!cancelled) setScheduleConflicts(res); })
        .catch(() => { if (!cancelled) setScheduleConflicts([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [teacherId, days, startTime]);

  // Directions saved in the subjects list (also filled from group subjects).
  const [savedSubjects, setSavedSubjects] = useState<string[]>([]);
  useEffect(() => {
    subjectsApi.list("ACTIVE").then((list) => setSavedSubjects(list.map((x) => x.name))).catch(() => setSavedSubjects([]));
  }, []);
  const usedSubjects = useMemo(() => Array.from(new Set([...groups.map((g) => g.subject), ...savedSubjects])), [groups, savedSubjects]);
  const subjectSuggestions = tenant ? CATEGORY_SUBJECT_SUGGESTIONS[tenant.category] || [] : [];
  const subjectOptions = useMemo(
    () => Array.from(new Set([...usedSubjects, ...subjectSuggestions])).sort(),
    [usedSubjects, subjectSuggestions],
  );

  function load() {
    setLoading(true);
    Promise.all([groupsApi.list(), branchesApi.list(), teachersApi.list()])
      .then(([g, b, t]) => {
        setGroups(g);
        setBranches(b);
        setTeachers(t);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setName("");
    setSubject("");
    setCustomSubject("");
    setLevel("");
    setTeacherId("");
    setBranchId("");
    setDays([]);
    setStartTime("");
    setStartDate("");
    setMonthlyPrice("");
    setMaxStudents("");
    setDurationMonths("");
    setDescription("");
    setScheduleConflicts([]);
    setError(null);
  }

  function toggleDay(day: string) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const scheduleDays = days.join(",");
      const effectiveSubject = subject === OTHER_SUBJECT ? customSubject : subject;
      await groupsApi.create({
        name,
        subject: effectiveSubject,
        level: level || undefined,
        teacherId: teacherId || undefined,
        branchId: branchId || undefined,
        scheduleDays: scheduleDays || undefined,
        startTime: startTime || undefined,
        schedule: scheduleDays && startTime ? `${scheduleDays}, ${startTime}` : undefined,
        startDate: startDate || undefined,
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : undefined,
        maxStudents: maxStudents ? Number(maxStudents) : undefined,
        durationMonths: durationMonths ? Number(durationMonths) : undefined,
        description: description || undefined,
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

  const filtered = groups.filter((g) => {
    if (filterDirection && !matchesSubject(g.subject, filterDirection)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      g.name.toLowerCase().includes(q) ||
      g.subject.toLowerCase().includes(q) ||
      (g.teacher?.fullName || "").toLowerCase().includes(q) ||
      (g.branch?.name || "").toLowerCase().includes(q)
    );
  });

  useEffect(() => setPage(1), [search, filterDirection]);
  const pageItems = usePagedSlice(filtered, page);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("groups.title")}</h1>
          <Link href="/groups/trash" style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>
            {t("nav.trash")}
          </Link>
        </div>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          {t("groups.newGroup")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {!loading && groups.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="field-input"
              placeholder={t("groups.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280, maxWidth: "100%", flexShrink: 0 }}
            />
            <Select
              options={[{ value: "", label: t("groups.allDirections") }, ...usedSubjects.map((s) => ({ value: s, label: s }))]}
              value={filterDirection}
              onChange={setFilterDirection}
              style={{ width: 200 }}
            />
          </div>
        )}
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : groups.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("groups.noGroupsYet")}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("groups.noSearchResults")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("groups.colGroup")}</th>
                  <th style={{ paddingTop: 16 }}>{t("teachers.colTeacher")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colSubject")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colBranch")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colSchedule")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colMonthlyPrice")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colMaxSeats")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>{g.name}</td>
                    <td>
                      {g.teacher ? (
                        <Link
                          href={`/teachers/${g.teacher.id}`}
                          style={{
                            color: ACCENT,
                            fontWeight: 600,
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: "#EEF0FF",
                              color: ACCENT,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10.5,
                              fontWeight: 700,
                            }}
                          >
                            {g.teacher.fullName.slice(0, 2).toUpperCase()}
                          </span>
                          <span>{g.teacher.fullName}</span>
                        </Link>
                      ) : (
                        <span style={{ color: "#A0A3AB", fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td>{g.subject}</td>
                    <td>{g.branch?.name || "—"}</td>
                    <td>{g.schedule || "—"}</td>
                    <td>{g.monthlyPrice ? `${new Intl.NumberFormat("uz-UZ").format(g.monthlyPrice)} ${t("common.sumUnit")}` : "—"}</td>
                    <td>{g.maxStudents}</td>

                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/groups/${g.id}`}
                        className="btn"
                        style={{ display: "inline-block", background: "#F2F1EC", color: "#181A1F", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8 }}
                      >
                        {t("groups.viewGroup")}
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

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("groups.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label={t("groups.fieldName")}>
            <input className="field-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="IELTS Speaking — B2" />
          </Field>
          <Field label={t("groups.fieldSubject")}>
            <Select
              options={[
                { value: "", label: t("groups.selectPlaceholder") },
                ...subjectOptions.map((s) => ({ value: s, label: s })),
                { value: OTHER_SUBJECT, label: t("groups.otherSubject") },
              ]}
              value={subject}
              onChange={setSubject}
            />
            {subject === OTHER_SUBJECT && (
              <input
                className="field-input"
                required
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder={t("groups.newDirectionPlaceholder")}
                style={{ marginTop: 8 }}
              />
            )}
          </Field>
          <Field label={t("groups.fieldLevel")}>
            <input className="field-input" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="B2, Beginner..." />
          </Field>
          {teachers.length > 0 && (
            <Field label={t("groups.fieldTeacher")}>
              <Select
                options={[{ value: "", label: t("groups.notSelected") }, ...teachers.map((tc) => ({ value: tc.id, label: tc.fullName }))]}
                value={teacherId}
                onChange={setTeacherId}
              />
            </Field>
          )}
          {branches.length > 0 && (
            <Field label={t("groups.fieldBranch")}>
              <Select
                options={[{ value: "", label: t("groups.notSelected") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                value={branchId}
                onChange={setBranchId}
              />
            </Field>
          )}
          <Field label={t("groups.fieldDays")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {WEEKDAYS.map((d, i) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "7px 11px", borderRadius: 8, cursor: "pointer",
                    border: days.includes(d) ? `1px solid ${ACCENT}` : "1px solid #EAE8E2",
                    background: days.includes(d) ? "#EEF0FF" : "#fff",
                    color: days.includes(d) ? ACCENT : "#4A4E58",
                  }}
                >
                  {t(WEEKDAY_LABEL_KEYS[i])}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("groups.fieldStartTime")}>
            <TimePicker value={startTime} onChange={setStartTime} />
          </Field>
          {scheduleConflicts.length > 0 && (
            <div style={{ background: "#FFF7E6", color: "#A15C00", fontSize: 12.5, fontWeight: 600, padding: "10px 14px", borderRadius: 10, lineHeight: 1.5 }}>
              {t("groups.scheduleConflictWarning")} {scheduleConflicts.map((c) => c.name).join(", ")}
            </div>
          )}
          <Field label={t("groups.fieldStartDate")}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("groups.fieldMonthlyPrice")}>
              <input className="field-input" type="number" min={0} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} placeholder="500000" />
            </Field>
            <Field label={t("groups.fieldMaxSeats")}>
              <input className="field-input" type="number" min={1} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="15" />
            </Field>
          </div>
          <Field label={t("groups.fieldDuration")}>
            <input className="field-input" type="number" min={1} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} placeholder="3" />
          </Field>
          <Field label={t("groups.fieldDescription")}>
            <textarea className="field-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("groups.descriptionPlaceholder")} style={{ resize: "vertical" }} />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("groups.creating") : t("groups.createGroup")}
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

export default function GroupsPage() {
  return (
    <DashboardShell>
      <GroupsContent />
    </DashboardShell>
  );
}
