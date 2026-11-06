"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import { ListSkeleton } from "@/components/Skeleton";
import ImportDialog from "@/components/ImportDialog";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { groupsApi, branchesApi, teachersApi, subjectsApi, Group, Branch, Teacher, ApiError, CATEGORY_SUBJECT_SUGGESTIONS } from "@/lib/api";
import { matchesSubject } from "@/lib/subject";

const ACCENT = "var(--primary)";
// Actual values stored on groups.scheduleDays (always Uzbek) — WEEKDAY_LABEL_KEYS below is the parallel display-only translation.
const WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
const WEEKDAY_LABEL_KEYS: TranslationKey[] = [
  "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday",
  "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday",
];
const OTHER_SUBJECT = "__OTHER__";
// Older groups may store English day codes; the form toggles Uzbek names.
const DAY_CODE_TO_NAME: Record<string, string> = { MON: "Dushanba", TUE: "Seshanba", WED: "Chorshanba", THU: "Payshanba", FRI: "Juma", SAT: "Shanba", SUN: "Yakshanba" };
function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// "Du/Chor, 16:00–17:30" from the stored days and times (demo style);
// falls back to the free-text schedule of older groups.
function shortScheduleOf(g: Group, t: (k: TranslationKey) => string) {
  const days = (g.scheduleDays ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => DAY_CODE_TO_NAME[d.toUpperCase()] ?? d)
    .map((d) => WEEKDAYS.indexOf(d))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
    .map((i) => t(WEEKDAY_LABEL_KEYS[i]));
  if (days.length === 0 || !g.startTime) return g.schedule ?? "";
  return `${days.join("/")}, ${g.startTime}${g.endTime ? `–${g.endTime}` : ""}`;
}

/**
 * Teachers offered for a group of `direction`: those who teach it, plus the
 * one already chosen. When nobody teaches it (or the user asked), everyone.
 */
function pickTeachers(
  teachers: Teacher[],
  direction: string,
  chosenId: string,
  showAll: boolean,
  t: (k: TranslationKey) => string,
): { list: Teacher[]; note: string | null; filtered: boolean } {
  if (!direction.trim() || showAll) return { list: teachers, note: null, filtered: false };
  const fit = teachers.filter((tc) => tc.id === chosenId || matchesSubject(tc.subject, direction));
  if (!fit.some((tc) => tc.id !== chosenId)) return { list: teachers, note: t("groups.teachersNoneForSubject"), filtered: false };
  return { list: fit, note: t("groups.teachersForSubject"), filtered: fit.length < teachers.length };
}

function GroupsContent() {
  const { tenant, user } = useAuth();
  // Creating, editing and the trash are for those who run the center (the
  // server refuses anyone else), so a teacher is not offered them.
  const canManage = can(user, "groups.edit");
  const [importOpen, setImportOpen] = useState(false);
  const { t } = useLanguage();
  const shortSchedule = (g: Group) => shortScheduleOf(g, t);
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  // One branch (most small centers): the column would repeat it on every row.
  const showBranch = branches.length > 1;
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
  const [endTime, setEndTime] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [maxStudents, setMaxStudents] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleConflicts, setScheduleConflicts] = useState<{ id: string; name: string }[]>([]);
  // Busy or free for the chosen days and time, per teacher (null: not asked yet).
  const [availability, setAvailability] = useState<Map<string, string[]> | null>(null);
  // A failed check is said, not shown as "no clash".
  const [conflictCheckError, setConflictCheckError] = useState<string | null>(null);
  const [conflictRetry, setConflictRetry] = useState(0);
  // The teacher list follows the chosen direction: teachers whose subject
  // names it come first (and alone), unless the user asks for everyone.
  const [allTeachers, setAllTeachers] = useState(false);
  const teacherChoice = pickTeachers(teachers, subject === OTHER_SUBJECT ? customSubject : subject, teacherId, allTeachers, t);

  useEffect(() => {
    if (days.length === 0 || !startTime) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      groupsApi
        .teacherAvailability({ days: days.join(","), startTime, endTime: endTime || undefined, excludeId: editingId ?? undefined })
        .then((res) => !cancelled && setAvailability(new Map(res.map((r) => [r.teacherId, r.busyWith]))))
        .catch(() => !cancelled && setAvailability(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [days, startTime, endTime, editingId]);

  useEffect(() => {
    if (!teacherId || days.length === 0 || !startTime) {
      setScheduleConflicts([]);
      setConflictCheckError(null);
      return;
    }
    // Only the answer for the current inputs counts.
    let cancelled = false;
    const timer = setTimeout(() => {
      groupsApi
        .scheduleConflicts({ teacherId, days: days.join(","), startTime, endTime: endTime || undefined, excludeId: editingId ?? undefined })
        .then((res) => {
          if (cancelled) return;
          setScheduleConflicts(res);
          setConflictCheckError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setScheduleConflicts([]);
          setConflictCheckError(err instanceof ApiError ? err.message : t("sch.conflictCheckError"));
        });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [teacherId, days, startTime, endTime, editingId, conflictRetry, t]);

  // Directions saved in the subjects list (also filled from group subjects).
  const [savedSubjects, setSavedSubjects] = useState<string[]>([]);
  useEffect(() => {
    subjectsApi.list("ACTIVE").then((list) => setSavedSubjects(list.map((x) => x.name))).catch(() => setSavedSubjects([]));
  }, []);
  const usedSubjects = useMemo(() => Array.from(new Set([...groups.map((g) => g.subject), ...savedSubjects])), [groups, savedSubjects]);
  const category = tenant?.category;
  const subjectOptions = useMemo(() => {
    const suggested = category ? CATEGORY_SUBJECT_SUGGESTIONS[category] || [] : [];
    return Array.from(new Set([...usedSubjects, ...suggested])).sort();
  }, [usedSubjects, category]);

  // A failed load is shown with a retry, not as an empty page ("" = no
  // message from the server; null = no error).
  const [loadError, setLoadError] = useState<string | null>(null);
  // The teachers list is not this account's to open: the form leaves the teacher as it is.
  const [teachersHidden, setTeachersHidden] = useState(false);

  function load() {
    setLoading(true);
    // The groups are the page. Branches and teachers only fill the form's
    // lists: an account that may edit groups but not open those lists still
    // gets its groups (the group keeps its teacher and branch).
    const optional = <T,>(p: Promise<T[]>, denied: () => void) => p.catch((err) => {
      if (err instanceof ApiError && err.status === 403) {
        denied();
        return [] as T[];
      }
      throw err;
    });
    setTeachersHidden(false);
    Promise.all([groupsApi.list(), optional(branchesApi.list(), () => undefined), optional(teachersApi.list(), () => setTeachersHidden(true))])
      .then(([g, b, t]) => {
        setGroups(g);
        setBranches(b);
        setTeachers(t);
      })
      .then(() => setLoadError(null))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ""))
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
    setEndTime("");
    setEditingId(null);
    setFieldErrors({});
    setStartDate("");
    setMonthlyPrice("");
    setMaxStudents("");
    setDurationMonths("");
    setDescription("");
    setScheduleConflicts([]);
    setError(null);
  }

  function openEdit(g: Group) {
    resetForm();
    setEditingId(g.id);
    setName(g.name);
    setSubject(g.subject);
    setLevel(g.level ?? "");
    setTeacherId(g.teacherId ?? "");
    setBranchId(g.branchId ?? "");
    setDays((g.scheduleDays ?? "").split(",").map((d) => d.trim()).filter(Boolean).map((d) => DAY_CODE_TO_NAME[d.toUpperCase()] ?? d));
    setStartTime(g.startTime ?? "");
    setEndTime(g.endTime ?? "");
    setStartDate(g.startDate ? g.startDate.slice(0, 10) : "");
    setMonthlyPrice(g.monthlyPrice ? String(g.monthlyPrice) : "");
    setMaxStudents(g.maxStudents ? String(g.maxStudents) : "");
    setDurationMonths(g.durationMonths ? String(g.durationMonths) : "");
    setDescription(g.description ?? "");
    setModalOpen(true);
  }

  function toggleDay(day: string) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  // Everything but description, duration and level is required; our own
  // messages instead of the browser's.
  function validate() {
    const req = t("groups.required");
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = req;
    const subj = subject === OTHER_SUBJECT ? customSubject : subject;
    if (!subj.trim()) errs.subject = req;
    if (teachersHidden) {
      // Nothing to choose from: the group keeps the teacher it has.
    } else if (teachers.length === 0) errs.teacher = t("groups.errNoTeachers");
    else if (!teacherId) errs.teacher = t("groups.errTeacher");
    if (branches.length > 0 && !branchId) errs.branch = req;
    if (days.length === 0) errs.days = t("groups.errDays");
    if (!startTime) errs.startTime = req;
    if (!startDate) errs.startDate = req;
    if (!monthlyPrice || Number(monthlyPrice) <= 0) errs.monthlyPrice = t("groups.errPrice");
    if (!maxStudents || Number(maxStudents) <= 0) errs.maxStudents = t("groups.errSeats");
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(t("groups.fixErrors"));
      return;
    }
    setSaving(true);
    try {
      // Keep the weekdays in calendar order.
      const scheduleDays = WEEKDAYS.filter((d) => days.includes(d)).join(",");
      const effectiveSubject = subject === OTHER_SUBJECT ? customSubject : subject;
      if (endTime && startTime && endTime <= startTime) {
        setError(t("groups.endBeforeStart"));
        return;
      }
      const lessonEnd = startTime ? endTime || addMinutes(startTime, 90) : "";
      const payload = {
        name,
        subject: effectiveSubject,
        level: level || undefined,
        teacherId: teacherId || undefined,
        branchId: branchId || undefined,
        scheduleDays: scheduleDays || undefined,
        startTime: startTime || undefined,
        endTime: lessonEnd || undefined,
        schedule: scheduleDays && startTime ? `${scheduleDays}, ${startTime}-${lessonEnd}` : undefined,
        startDate: startDate || undefined,
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : undefined,
        maxStudents: maxStudents ? Number(maxStudents) : undefined,
        durationMonths: durationMonths ? Number(durationMonths) : undefined,
        description: description || undefined,
      };
      if (editingId) {
        // Empty values clear the field on edit (e.g. removing lesson days).
        const saved = await groupsApi.update(editingId, {
          ...payload,
          level: level || null,
          teacherId: teacherId || null,
          branchId: branchId || null,
          scheduleDays: scheduleDays,
          startTime: startTime,
          endTime: lessonEnd,
          schedule: payload.schedule ?? null,
          description: description || null,
        });
        // Make-ups booked into the lessons that changed: followed, or released.
        const notes = [
          saved.makeups?.moved ? t("sch.makeups.moved").replace("{n}", String(saved.makeups.moved)) : "",
          saved.makeups?.released ? t("sch.makeups.released").replace("{n}", String(saved.makeups.released)) : "",
        ].filter(Boolean);
        if (notes.length) window.alert(notes.join("\n"));
      } else {
        await groupsApi.create(payload);
      }
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
      <div style={{ padding: "var(--page-head-pad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">{t("groups.title")}</h1>
          {canManage && (
            <Link href="/groups/trash" style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              {t("nav.trash")}
            </Link>
          )}
        </div>
        {canManage && (
          <div style={{ display: "flex", alignItems: "center" }}>
            <button type="button" className="btn" onClick={() => setImportOpen(true)} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: "var(--radius-sm)", marginRight: 8 }}>
              {t("imp.button")}
            </button>
            <button
              className="btn"
              onClick={() => setModalOpen(true)}
              style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)" }}
            >
              {t("groups.newGroup")}
            </button>
            <ImportDialog kind="groups" open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "var(--page-pad)", overflow: "auto", boxSizing: "border-box" }}>
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
        {loadError !== null ? (
          <LoadError message={loadError || t("adm.loadError")} onRetry={load} />
        ) : loading ? (
          <ListSkeleton />
        ) : groups.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
            {t("groups.noGroupsYet")}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
            {t("groups.noSearchResults")}
          </div>
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("groups.colGroup")}</th>
                  <th style={{ paddingTop: 16 }}>{t("teachers.colTeacher")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colSubject")}</th>
                  {showBranch && <th style={{ paddingTop: 16 }}>{t("groups.colBranch")}</th>}
                  <th style={{ paddingTop: 16 }}>{t("groups.colSchedule")}</th>
                  <th style={{ paddingTop: 16 }}>{t("groups.colMonthlyPrice")}</th>
                  <th style={{ paddingTop: 16 }}>{t("grp.colStudents")}</th>
                  <th style={{ paddingTop: 16 }}>{t("grp.colStatus")}</th>
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
                              background: "var(--primary-soft)",
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
                        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td>{g.subject}</td>
                    {showBranch && <td>{g.branch?.name || "—"}</td>}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {(shortSchedule(g) || "—").split(", ").map((part, i) => (
                        <div key={i}>{part}</div>
                      ))}
                    </td>
                    <td>{g.monthlyPrice ? `${new Intl.NumberFormat("uz-UZ").format(g.monthlyPrice)} ${t("common.sumUnit")}` : "—"}</td>
                    <td>
                      <span style={{ fontWeight: 700 }}>{g.studentCount ?? 0}</span>
                      <span style={{ color: "var(--text-muted)" }}>/{g.maxStudents || "—"}</span>
                    </td>
                    <td>
                      {(() => {
                        const n = g.studentCount ?? 0;
                        const max = g.maxStudents || 0;
                        const b =
                          g.status && g.status !== "ACTIVE"
                            ? { text: g.status === "PLANNED" ? t("grp.stPlanned") : g.status === "COMPLETED" ? t("grp.stCompleted") : t("grp.stArchived"), color: "var(--text-muted)", bg: "var(--surface-muted)" }
                            : max > 0 && n >= max
                              ? { text: t("grp.stFull"), color: "var(--success)", bg: "var(--success-soft)" }
                              : max > 0 && n / max < 0.6
                                ? { text: t("grp.stUnderfilled"), color: "var(--warning)", bg: "var(--warning-soft)" }
                                : { text: t("grp.stActive"), color: ACCENT, bg: "var(--primary-soft)" };
                        return <span style={{ fontSize: 12, fontWeight: 700, color: b.color, background: b.bg, padding: "4px 10px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap" }}>{b.text}</span>;
                      })()}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      {canManage && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openEdit(g)}
                          style={{ display: "inline-block", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: "var(--radius-xs)", marginRight: 6, cursor: "pointer" }}
                        >
                          {t("common.edit")}
                        </button>
                      )}
                      <Link
                        href={`/groups/${g.id}`}
                        className="btn"
                        style={{ display: "inline-block", background: "var(--surface-muted)", color: "var(--text)", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: "var(--radius-xs)" }}
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

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={editingId ? t("groups.editTitle") : t("groups.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
          {error && (
            <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>
          )}
          <Field label={t("groups.fieldName")} required error={fieldErrors.name}>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="IELTS Speaking — B2" />
          </Field>
          <Field label={t("groups.fieldSubject")} required error={fieldErrors.subject}>
            <Select
              options={[
                { value: "", label: t("groups.selectPlaceholder") },
                ...subjectOptions.map((s) => ({ value: s, label: s })),
                { value: OTHER_SUBJECT, label: t("groups.otherSubject") },
              ]}
              value={subject}
              onChange={(v) => { setSubject(v); setAllTeachers(false); }}
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
          {teachersHidden ? (
            <Field label={t("groups.fieldTeacher")}>
              <div role="note" style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "9px 12px", lineHeight: 1.5 }}>{t("groups.teachersHidden")}</div>
            </Field>
          ) : (
            <Field label={t("groups.fieldTeacher")} required error={fieldErrors.teacher}>
              <Select
                options={[
                  { value: "", label: t("groups.notSelected") },
                  // Free ones first once the days and time are chosen; each says which.
                  ...[...teacherChoice.list]
                    .sort((a, b) => (availability ? Number((availability.get(a.id)?.length ?? 0) > 0) - Number((availability.get(b.id)?.length ?? 0) > 0) : 0))
                    .map((tc) => {
                      const base = tc.subject ? `${tc.fullName} · ${tc.subject}` : tc.fullName;
                      const busy = availability?.get(tc.id);
                      return { value: tc.id, label: !availability ? base : busy && busy.length ? `🔴 ${base} — ${t("groups.teacherBusy")}: ${busy.join(", ")}` : `🟢 ${base} — ${t("groups.teacherFree")}` };
                    }),
                ]}
                value={teacherId}
                onChange={setTeacherId}
              />
              {teacherChoice.note && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span>{teacherChoice.note}</span>
                  {teacherChoice.filtered && (
                    <button type="button" onClick={() => setAllTeachers(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>
                      {t("groups.teachersShowAll")}
                    </button>
                  )}
                </div>
              )}
            </Field>
          )}
          {branches.length > 0 && (
            <Field label={t("groups.fieldBranch")} required error={fieldErrors.branch}>
              <Select
                options={[{ value: "", label: t("groups.notSelected") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                value={branchId}
                onChange={setBranchId}
              />
            </Field>
          )}
          <Field label={t("groups.fieldDays")} required error={fieldErrors.days}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {WEEKDAYS.map((d, i) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "7px 11px", borderRadius: "var(--radius-xs)", cursor: "pointer",
                    border: days.includes(d) ? `1px solid ${ACCENT}` : "1px solid var(--border)",
                    background: days.includes(d) ? "var(--primary-soft)" : "var(--surface)",
                    color: days.includes(d) ? ACCENT : "var(--text-soft)",
                  }}
                >
                  {t(WEEKDAY_LABEL_KEYS[i])}
                </button>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("groups.fieldStartTime")} required error={fieldErrors.startTime}>
              <TimePicker value={startTime} onChange={setStartTime} />
            </Field>
            <Field label={t("groups.fieldEndTime")}>
              <TimePicker value={endTime} onChange={setEndTime} />
            </Field>
          </div>
          {days.length > 0 && startTime && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -6 }}>{t("groups.timetableHint")}</div>
          )}
          {conflictCheckError && (
            <LoadError compact message={conflictCheckError} onRetry={() => setConflictRetry((n) => n + 1)} />
          )}
          {scheduleConflicts.length > 0 && (
            <div style={{ background: "var(--warning-soft)", color: "var(--warning)", fontSize: 12.5, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.5 }}>
              {t("groups.scheduleConflictWarning")} {scheduleConflicts.map((c) => c.name).join(", ")}
            </div>
          )}
          <Field label={t("groups.fieldStartDate")} required error={fieldErrors.startDate}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("groups.fieldMonthlyPrice")} required error={fieldErrors.monthlyPrice}>
              <input className="field-input" type="number" min={0} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} placeholder="500000" />
            </Field>
            <Field label={t("groups.fieldMaxSeats")} required error={fieldErrors.maxStudents}>
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
            style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)", marginTop: 6 }}
          >
            {saving ? t(editingId ? "common.saving" : "groups.creating") : t(editingId ? "common.save" : "groups.createGroup")}
          </button>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, children, required, error }: { label: string; children: React.ReactNode; required?: boolean; error?: string }) {
  return (
    <div role="group" aria-label={label}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: "var(--danger)", marginLeft: 3 }}>*</span>}
      </div>
      <div style={error ? { borderRadius: "var(--radius-sm)", boxShadow: "0 0 0 2px rgba(220,38,38,0.35)" } : undefined}>{children}</div>
      {error && <div role="alert" style={{ marginTop: 5, fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>{error}</div>}
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
