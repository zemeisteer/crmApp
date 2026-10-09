"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import ImportDialog from "@/components/ImportDialog";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import PlacementTestModal from "@/components/students/PlacementTestModal";
import ListPager from "@/components/ListPager";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { studentsApi, groupsApi, exportApi, reportsApi, retryKey, Student, Group, Gender, ApiError, type PageOf } from "@/lib/api";
import { clampPage, pageQuery, parsePageParam, rememberListQuery, slicePage } from "@/lib/list-paging";
import { NAME_PATTERN, NAME_TITLE } from "@/lib/validation";
import { useLanguage } from "@/lib/i18n-context";
import { matchesSubject, extractUniqueSubjects } from "@/lib/subject";
import PhoneInput from "@/components/PhoneInput";
import CustomFieldInputs, { cfSubmitError, useCfDraft, useCustomFieldDefs } from "@/components/custom-fields/CustomFieldInputs";
import { cfPayload, cfValidate } from "@/lib/custom-fields";

const ACCENT = "#4F46E5";
// Rows per page; the server pages (GET /students?page&pageSize).
const PAGE_SIZE = 20;

function StudentsContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // Import creates students: the admins' (and owner's) job, as the form.
  const canImport = can(user, "import.run");
  const [importOpen, setImportOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The search and the page live in the address (?q=…&page=…), so going back
  // from a profile, or reloading, returns to the same page of the list.
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const [search, setSearch] = useState(() => (searchParams.get("q") ?? "").trim());
  const [filterDirection, setFilterDirection] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [page, setPage] = useState(() => parsePageParam(searchParams.get("page")));
  // Bumped after a change (new student, import) to load the current page again.
  const [reloadKey, setReloadKey] = useState(0);
  // One key per submission of the "new student" form (see retryKey).
  const createKey = useRef<{ sig: string; key: string } | null>(null);

  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [placementOpen, setPlacementOpen] = useState(false);
  // The center's own student fields (loaded with the form; required ones must be answered).
  const cfDefs = useCustomFieldDefs("STUDENT", { enabled: modalOpen });
  const cf = useCfDraft();

  const subjects = useMemo(() => extractUniqueSubjects(groups), [groups]);
  const selectedGroups = groups.filter((g) => groupIds.includes(g.id));
  const timeClashes = useMemo(() => {
    const out: string[] = [];
    const slot = (g: Group) => {
      if (!g.startTime || !g.scheduleDays) return null;
      const [h, m] = g.startTime.split(":").map(Number);
      const endDefault = `${String(Math.floor((h * 60 + m + 90) / 60) % 24).padStart(2, "0")}:${String((m + 90) % 60).padStart(2, "0")}`;
      return { days: g.scheduleDays.split(",").map((d) => d.trim().toLowerCase()), start: g.startTime, end: g.endTime || endDefault };
    };
    for (let i = 0; i < selectedGroups.length; i++) {
      for (let j = i + 1; j < selectedGroups.length; j++) {
        const a = slot(selectedGroups[i]);
        const b = slot(selectedGroups[j]);
        if (!a || !b) continue;
        const sameDay = a.days.some((d) => b.days.includes(d));
        if (sameDay && a.start < b.end && b.start < a.end) {
          out.push(`${selectedGroups[i].name} (${a.start}-${a.end}) × ${selectedGroups[j].name} (${b.start}-${b.end})`);
        }
      }
    }
    return out;
  }, [selectedGroups]);
  const filterGroupsInDirection = filterDirection ? groups.filter((g) => matchesSubject(g.subject, filterDirection)) : groups;

  // Attendance % and payment state per student (demo columns).
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof reportsApi.studentsSummary>> | null>(null);
  const summaryById = useMemo(() => new Map((summary?.items ?? []).map((i) => [i.studentId, i])), [summary]);

  // A failed load is shown with a retry, not as an empty page ("" = no
  // message from the server; null = no error).
  const [loadError, setLoadError] = useState<string | null>(null);
  // How many students the center has at all (the teacher: in their groups),
  // to tell "no students yet" from "nothing matches".
  const [allCount, setAllCount] = useState<number | null>(null);

  // Groups (filters, form), the overall count and the summary columns.
  useEffect(() => {
    let live = true;
    Promise.all([groupsApi.list(), studentsApi.page({ page: 1, pageSize: 1 })])
      .then(([g, c]) => {
        if (!live) return;
        setGroups(g);
        setAllCount(c.total);
        setLoadError(null);
      })
      .catch((err) => live && setLoadError(err instanceof ApiError ? err.message : ""));
    reportsApi.studentsSummary().then((s) => live && setSummary(s)).catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // Typing is sent to the server once it pauses, and starts again on page 1.
  useEffect(() => {
    const q = searchInput.trim();
    if (q === search) return;
    const id = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, search]);

  // The current page. Name and phone search run on the server. Direction,
  // group and gender are not server filters: while one of them is on, the
  // (searched) list is fetched whole and filtered and paged here, so the
  // totals stay those of the whole list, never of one page.
  const listKey = JSON.stringify([search, page, filterDirection, filterGroupId, filterGender, reloadKey]);
  const [list, setList] = useState<{ key: string; data: PageOf<Student> | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    const key = JSON.stringify([search, page, filterDirection, filterGroupId, filterGender, reloadKey]);
    const term = search || undefined;
    const keep = (s: Student) => {
      if (filterGender && s.gender !== filterGender) return false;
      if (filterGroupId && !(s.enrollments || []).some((e) => e.groupId === filterGroupId)) return false;
      if (filterDirection && !(s.enrollments || []).some((e) => matchesSubject(e.group.subject, filterDirection))) return false;
      return true;
    };
    const request: Promise<PageOf<Student>> =
      filterDirection || filterGroupId || filterGender
        ? studentsApi.list({ search: term }).then((all) => slicePage(all.filter(keep), page, PAGE_SIZE))
        : studentsApi.page({ search: term, page, pageSize: PAGE_SIZE });
    request
      .then((data) => {
        if (!live) return;
        // Past the end (the last student of the last page was deleted, or an
        // old link): go to the last page that has rows.
        const fit = clampPage(page, data.total, PAGE_SIZE);
        if (fit !== page) setPage(fit);
        else setList({ key, data, error: null });
      })
      .catch((err) => live && setList({ key, data: null, error: err instanceof ApiError ? err.message : "" }));
    return () => {
      live = false;
    };
  }, [search, page, filterDirection, filterGroupId, filterGender, reloadKey]);
  const listLoading = !list || list.key !== listKey;
  const pageData = list?.data ?? null;

  // Keep the address in step with the list (no new history entry per page).
  useEffect(() => {
    const qs = pageQuery({ q: search, page: page > 1 ? page : undefined });
    if (window.location.search !== qs) window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
    rememberListQuery("students", qs);
  }, [search, page]);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  function resetForm() {
    setFullName("");
    setGender("");
    setPhone("");
    setParentPhone("");
    setBirthDate("");
    setGroupIds([]);
    setError(null);
    cf.reset();
    createKey.current = null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const defs = cfDefs.defs ?? [];
    const cfErrs = cfValidate(defs, cf.draft, "create");
    cf.setErrors(cfErrs);
    if (Object.keys(cfErrs).length) {
      setError(t("cf.formError"));
      return;
    }
    setSaving(true);
    try {
      const cleanPhone = phone.replace(/\D/g, "").length >= 9 ? phone : undefined;
      const cleanParentPhone = parentPhone.replace(/\D/g, "").length >= 9 ? parentPhone : undefined;
      const body = {
        fullName: fullName.trim(),
        gender: gender || undefined,
        phone: cleanPhone,
        parentPhone: cleanParentPhone,
        birthDate: birthDate || undefined,
        groupIds: groupIds.length > 0 ? groupIds : undefined,
        customFields: cfPayload(defs, cf.draft, "create"),
      };
      await studentsApi.create(body, retryKey(createKey, body));
      createKey.current = null;
      setModalOpen(false);
      resetForm();
      reload();
    } catch (err) {
      const { fields, message } = cfSubmitError(err, cfDefs.defs ?? [], t);
      if (fields) cf.setErrors(fields);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const pageItems = pageData?.items ?? [];

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("students.title")}</h1>
          <Link href="/students/trash" style={{ fontSize: 12, color: "#686B75", fontWeight: 600 }}>
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
          {canImport && (
            <button
              className="btn"
              onClick={() => setImportOpen(true)}
              style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9 }}
            >
              {t("students.importExcel")}
            </button>
          )}
          <ImportDialog kind="students" open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
          <button
            className="btn"
            type="button"
            onClick={() => setPlacementOpen(true)}
            style={{ background: "#F5F3FF", color: "#6D28D9", border: "1px solid #DDD6FE", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}
          >
            🧭 {t("placement.button")}
          </button>
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
        {!!allCount && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="field-input"
              type="search"
              aria-label={t("students.searchLabel")}
              placeholder={t("students.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 260, maxWidth: "100%", flexShrink: 0 }}
            />
            <Select
              options={[{ value: "", label: t("students.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
              value={filterDirection}
              onChange={(v) => { setFilterDirection(v); setFilterGroupId(""); setPage(1); }}
              style={{ width: 180 }}
            />
            <Select
              options={[{ value: "", label: t("students.allGroups") }, ...filterGroupsInDirection.map((g) => ({ value: g.id, label: g.name }))]}
              value={filterGroupId}
              onChange={(v) => { setFilterGroupId(v); setPage(1); }}
              style={{ width: 180 }}
            />
            <Select
              options={[{ value: "", label: t("students.genderFilter") }, { value: "MALE", label: t("students.male") }, { value: "FEMALE", label: t("students.female") }]}
              value={filterGender}
              onChange={(v) => { setFilterGender(v); setPage(1); }}
              style={{ width: 150 }}
            />
          </div>
        )}
        {loadError !== null ? (
          <LoadError message={loadError || t("adm.loadError")} onRetry={reload} />
        ) : list?.error != null && !listLoading ? (
          <LoadError message={list.error || t("adm.loadError")} onRetry={reload} />
        ) : allCount === null || !pageData ? (
          <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
        ) : allCount === 0 ? (
          <div style={{ color: "#686B75", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("students.noStudentsYet")}
          </div>
        ) : pageData.total === 0 ? (
          <div style={{ color: "#686B75", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("students.noSearchResults")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden", opacity: listLoading ? 0.6 : 1 }} aria-busy={listLoading}>
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("students.colStudent")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colGroups")}</th>
                  <th style={{ paddingTop: 16 }} title={t("stu.attendanceHint")}>{t("stu.colAttendance")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colPhone")}</th>
                  <th style={{ paddingTop: 16 }}>{t("students.colParentPhone")}</th>
                  {summary?.withPayments && <th style={{ paddingTop: 16 }}>{t("stu.colPayment")}</th>}
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.fullName}</td>
                    <td>{s.enrollments?.map((e) => e.group.name).join(", ") || "—"}</td>
                    <td>
                      {(() => {
                        const r = summaryById.get(s.id)?.attendanceRate ?? null;
                        return r === null ? <span style={{ color: "#686B75" }}>—</span> : <span style={{ fontWeight: 700, color: r >= 85 ? "#16794A" : r >= 70 ? "#D97706" : "#B23A47" }}>{r}%</span>;
                      })()}
                    </td>
                    <td>{s.phone || "—"}</td>
                    <td>{s.parentPhone || "—"}</td>
                    {summary?.withPayments && (
                      <td>
                        {(() => {
                          const st = summaryById.get(s.id)?.payment ?? null;
                          if (!st || st === "NONE") return <span style={{ color: "#686B75" }}>—</span>;
                          const map = {
                            PAID: { text: t("stu.payPaid"), color: "#167A48", bg: "#E9F8EF" },
                            DEBT: { text: t("stu.payDebt"), color: "#B23A47", bg: "#FDEBEC" },
                            PENDING: { text: t("stu.payPending"), color: "#B45309", bg: "#FEF3C7" },
                          } as const;
                          const b = map[st];
                          return <span style={{ fontSize: 12, fontWeight: 700, color: b.color, background: b.bg, padding: "4px 10px", borderRadius: 100 }}>{b.text}</span>;
                        })()}
                      </td>
                    )}
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
            </div>
            <ListPager
              label={t("students.pagerLabel")}
              page={pageData.page}
              pageSize={PAGE_SIZE}
              total={pageData.total}
              shown={pageItems.length}
              busy={listLoading}
              onChange={setPage}
            />
          </div>
        )}
      </div>

      {placementOpen && <PlacementTestModal groups={groups} onClose={() => setPlacementOpen(false)} />}

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("students.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label={t("students.fieldFullName")}>
            <input
              className="field-input"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("std.namePh")}
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
            <PhoneInput className="field-input" value={phone} onChange={setPhone} />
          </Field>
          <Field label={t("students.fieldParentPhone")}>
            <PhoneInput className="field-input" value={parentPhone} onChange={setParentPhone} />
          </Field>
          <Field label={t("students.fieldBirthDate")}>
            <DatePicker value={birthDate} onChange={setBirthDate} />
          </Field>
          <Field label={t("students.fieldGroups")}>
            {/* One list for all directions, sorted by direction; each option
                names its direction so picks from two directions stay clear. */}
            <MultiSelect
              options={[...groups]
                .sort((x, y) => x.subject.localeCompare(y.subject) || x.name.localeCompare(y.name))
                .map((g) => ({ value: g.id, group: g.subject, label: `${g.name}${g.startTime ? ` · ${g.startTime}` : ""}${g.level ? ` · ${g.level}` : ""}` }))}
              selected={groupIds}
              onChange={setGroupIds}
              placeholder={t("students.selectGroups")}
              summary={(n) => `${n} ${t("students.groupsSelected")}`}
            />
            <div style={{ fontSize: 12, color: "#686B75", marginTop: 6 }}>{t("students.multiDirectionHint")}</div>
            {selectedGroups.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid #EAE8E2", borderRadius: 10, overflow: "hidden" }}>
                {Array.from(new Set(selectedGroups.map((g) => g.subject))).map((subj) => (
                  <div key={subj} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", borderBottom: "1px solid #F2F1EC" }}>
                    <div style={{ minWidth: 96, fontSize: 12, fontWeight: 700, color: "#4A4E58", paddingTop: 3 }}>{subj}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedGroups.filter((g) => g.subject === subj).map((g) => (
                        <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEF0FF", color: ACCENT, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>
                          {g.name}{g.startTime ? <span style={{ fontWeight: 500, opacity: 0.8 }}>{g.startTime}</span> : null}
                          <button type="button" onClick={() => setGroupIds((ids) => ids.filter((id) => id !== g.id))} style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontWeight: 800, padding: 0 }} aria-label={t("common.clear")}>✕</button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {timeClashes.length > 0 && (
              <div role="alert" style={{ marginTop: 8, background: "#FDEBEC", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 10, lineHeight: 1.5 }}>
                {t("students.timeClash")}
                {timeClashes.map((c) => <div key={c}>• {c}</div>)}
              </div>
            )}
          </Field>
          {cfDefs.error && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#B45309" }}>{t("cf.defsError")}</div>}
          <CustomFieldInputs defs={cfDefs.defs ?? []} values={cf.draft} errors={cf.errors} onChange={cf.change} idPrefix="new-student-cf" title={t("cf.section")} />
          <button
            className="btn"
            type="submit"
            disabled={saving || timeClashes.length > 0}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6, opacity: timeClashes.length > 0 ? 0.6 : 1 }}
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
    <div role="group" aria-label={label}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export default function StudentsPage() {
  return (
    <DashboardShell>
      {/* The list reads its page and search from the address. */}
      <Suspense fallback={null}>
        <StudentsContent />
      </Suspense>
    </DashboardShell>
  );
}
