"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import BarChart from "@/components/BarChart";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { homeworkApi, groupsApi, aiApi, Homework, Group, ApiError, fileUrl, type LeaderboardEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { matchesSubject, extractUniqueSubjects } from "@/lib/subject";

const ACCENT = "#4F46E5";

function RosterModal({ homeworkItem, onClose }: { homeworkItem: Homework; onClose: () => void }) {
  const { t } = useLanguage();
  const [roster, setRoster] = useState<
    | {
        student: { id: string; fullName: string };
        completed: boolean;
        score?: number | null;
        feedback?: string | null;
        status: string;
        submissionText?: string | null;
        submissionAttachmentUrl?: string | null;
        submittedAt?: string | null;
      }[]
    | null
  >(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    homeworkApi.roster(homeworkItem.id).then((data) => {
      setRoster(data);
      const initScores: Record<string, string> = {};
      const initFeedbacks: Record<string, string> = {};
      for (const item of data) {
        if (item.score !== null && item.score !== undefined) {
          initScores[item.student.id] = String(item.score);
        }
        if (item.feedback) {
          initFeedbacks[item.student.id] = item.feedback;
        }
      }
      setScores(initScores);
      setFeedbacks(initFeedbacks);
    });
  }, [homeworkItem.id]);

  async function handleGrade(studentId: string) {
    const rawScore = scores[studentId];
    if (rawScore === undefined || rawScore === "") return;
    setBusyId(studentId);
    try {
      await homeworkApi.grade(homeworkItem.id, {
        studentId,
        score: Number(rawScore),
        feedback: feedbacks[studentId]?.trim() || undefined,
      });
      setRoster((prev) =>
        prev
          ? prev.map((r) =>
              r.student.id === studentId
                ? {
                    ...r,
                    completed: true,
                    status: "GRADED",
                    score: Number(rawScore),
                    feedback: feedbacks[studentId],
                  }
                : r,
            )
          : null,
      );
      alert("Baho va izoh saqlandi hamda o'quvchiga yuborildi!");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Saqlashda xatolik");
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(studentId: string, completed: boolean) {
    setBusyId(studentId);
    try {
      await homeworkApi.setCompletion(homeworkItem.id, studentId, completed);
      setRoster((prev) => prev && prev.map((r) => (r.student.id === studentId ? { ...r, completed } : r)));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t("homework.rosterTitlePrefix")} — ${homeworkItem.title}`}>
      {!roster ? (
        <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("common.loading")}</div>
      ) : roster.length === 0 ? (
        <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("homework.noStudentsInGroup")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "#64748B" }}>
            Maksimal ball: <b>{homeworkItem.maxScore || 100} ball</b>. Har bir o'quvchi uchun ball va izoh kiritib saqlashingiz mumkin.
          </div>
          {roster.map((r) => (
            <div
              key={r.student.id}
              style={{
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{r.student.fullName}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B", cursor: "pointer" }}>
                  <span>Bajarildi</span>
                  <input
                    type="checkbox"
                    checked={r.completed}
                    disabled={busyId === r.student.id}
                    onChange={(e) => toggle(r.student.id, e.target.checked)}
                  />
                </label>
              </div>

              {r.submissionText && (
                <div
                  style={{
                    background: "#EFF6FF",
                    border: "1px solid #DBEAFE",
                    borderRadius: 8,
                    padding: 8,
                    fontSize: 12,
                    color: "#1E40AF",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>O'quvchi javobi:</span> {r.submissionText}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                <input
                  type="number"
                  min={0}
                  max={homeworkItem.maxScore || 100}
                  placeholder={`Ball (0-${homeworkItem.maxScore || 100})`}
                  value={scores[r.student.id] ?? ""}
                  onChange={(e) =>
                    setScores((prev) => ({ ...prev, [r.student.id]: e.target.value }))
                  }
                  style={{
                    width: 90,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    fontSize: 12.5,
                  }}
                />
                <input
                  type="text"
                  placeholder="Izoh (masalan: Barakalla!)"
                  value={feedbacks[r.student.id] ?? ""}
                  onChange={(e) =>
                    setFeedbacks((prev) => ({ ...prev, [r.student.id]: e.target.value }))
                  }
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    fontSize: 12.5,
                  }}
                />
                <button
                  type="button"
                  disabled={busyId === r.student.id || !scores[r.student.id]}
                  onClick={() => handleGrade(r.student.id)}
                  style={{
                    background: ACCENT,
                    color: "#fff",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Saqlash
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

type LeaderSort = "total" | "homework" | "exam";

// Ranking of students by homework + exam points, with filters so a big
// center can find a student quickly: group, name search, what to rank by
// and how many to show.
function LeaderboardModal({
  groups,
  initialGroupId,
  onClose,
}: {
  groups: Group[];
  initialGroupId?: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [groupId, setGroupId] = useState(initialGroupId ?? "");
  const [list, setList] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<LeaderSort>("total");
  const [limit, setLimit] = useState("20");

  useEffect(() => {
    let cancelled = false;
    homeworkApi
      .leaderboard(groupId || undefined)
      .then((rows) => { if (!cancelled) setList(rows); })
      .catch(() => { if (!cancelled) setList([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);

  const rows = useMemo(() => {
    const key = (e: LeaderboardEntry) => (sortBy === "homework" ? e.homeworkScore : sortBy === "exam" ? e.examScore : e.totalScore);
    // Rank by the chosen measure first, then filter by name so a searched
    // student keeps their real place.
    const ranked = [...list].sort((x, y) => key(y) - key(x)).map((e, i) => ({ ...e, place: i + 1, value: key(e) }));
    const needle = q.trim().toLowerCase();
    const found = needle ? ranked.filter((e) => e.studentName.toLowerCase().includes(needle)) : ranked;
    return limit === "all" ? found : found.slice(0, Number(limit));
  }, [list, q, sortBy, limit]);

  const medal = (place: number) => (place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : String(place));
  const tint = (place: number) => (place === 1 ? "#FEF9C3" : place === 2 ? "#F1F5F9" : place === 3 ? "#FFEDD5" : "#fff");

  return (
    <Modal open onClose={onClose} title={`🏆 ${t("leader.title")}`} width={720}>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 0.8fr", gap: 8, marginBottom: 14 }}>
        <input className="field-input" placeholder={t("leader.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          value={groupId}
          onChange={(v) => { setLoading(true); setGroupId(v); }}
          options={[{ value: "", label: t("leader.allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
        />
        <Select
          value={sortBy}
          onChange={(v) => setSortBy(v as LeaderSort)}
          options={[
            { value: "total", label: t("leader.byTotal") },
            { value: "homework", label: t("leader.byHomework") },
            { value: "exam", label: t("leader.byExam") },
          ]}
        />
        <Select
          value={limit}
          onChange={setLimit}
          options={[
            { value: "10", label: "Top 10" },
            { value: "20", label: "Top 20" },
            { value: "50", label: "Top 50" },
            { value: "all", label: t("leader.all") },
          ]}
        />
      </div>

      {loading ? (
        <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{q ? t("leader.notFound") : t("leader.empty")}</div>
      ) : (
        <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid #EAE8E2", borderRadius: 12 }}>
          <table className="table" style={{ margin: 0 }}>
            <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>{t("leader.student")}</th>
                <th style={{ textAlign: "right" }}>{t("leader.homework")}</th>
                <th style={{ textAlign: "right" }}>{t("leader.exams")}</th>
                <th style={{ textAlign: "right" }}>{t("leader.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.studentId} style={{ background: tint(e.place) }}>
                  <td style={{ fontWeight: 800, fontSize: e.place <= 3 ? 16 : 13 }}>{medal(e.place)}</td>
                  <td style={{ fontWeight: 600 }}>{e.studentName}</td>
                  <td style={{ textAlign: "right" }}>
                    {e.homeworkScore}
                    <span style={{ color: "#A0A3AB", fontSize: 11 }}> · {e.completedHomeworkCount} {t("leader.tasks")}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{e.examScore}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: sortBy === "total" ? ACCENT : "#181A1F" }}>{e.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 12, color: "#8A8D96" }}>
        {t("leader.shown")}: {rows.length} / {list.length}
      </div>
    </Modal>
  );
}

function HomeworkContent() {
  const { t, lang } = useLanguage();

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" });
  }

  const [items, setItems] = useState<Homework[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [rosterHomework, setRosterHomework] = useState<Homework | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formDirection, setFormDirection] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxScore, setMaxScore] = useState<number>(100);
  const [file, setFile] = useState<File | null>(null);

  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ title: string; description: string; dueDate?: string } | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState("");

  const [filterDirection, setFilterDirection] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const subjects = useMemo(() => extractUniqueSubjects(groups), [groups]);
  const groupsInFilterDirection = filterDirection ? groups.filter((g) => matchesSubject(g.subject, filterDirection)) : groups;
  const groupsInFormDirection = formDirection ? groups.filter((g) => matchesSubject(g.subject, formDirection)) : groups;

  function load() {
    setLoading(true);
    Promise.all([homeworkApi.list(), groupsApi.list()])
      .then(([h, g]) => {
        setItems(h);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setFormDirection("");
    setGroupIds([]);
    setTitle("");
    setDescription("");
    setDueDate("");
    setMaxScore(100);
    setFile(null);
    setAiSuggestion(null);
    setAiSuggesting(false);
    setAiPromptOpen(false);
    setAiRequest("");
    setError(null);
  }

  async function onGetAiSuggestion() {
    if (!aiRequest.trim()) {
      setError(t("hwAi.describeFirst"));
      return;
    }
    setAiSuggesting(true);
    setError(null);
    try {
      const selectedGroup = groupIds.length > 0 ? groups.find((g) => g.id === groupIds[0]) : undefined;
      const effectiveSubject = selectedGroup?.subject || formDirection || "Ingliz tili";
      const res = await aiApi.suggestHomework({
        subject: effectiveSubject,
        groupName: selectedGroup?.name,
        topic: title || undefined,
        request: aiRequest.trim(),
      });

      let calculatedDue = dueDate;
      if (!calculatedDue && res.dueDays) {
        const d = new Date();
        d.setDate(d.getDate() + res.dueDays);
        calculatedDue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }

      setAiSuggestion({
        title: res.title,
        description: res.description,
        dueDate: calculatedDue,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("hwAi.error"));
    } finally {
      setAiSuggesting(false);
    }
  }

  function applyAiSuggestion() {
    if (!aiSuggestion) return;
    setTitle(aiSuggestion.title);
    setDescription(aiSuggestion.description);
    if (aiSuggestion.dueDate) setDueDate(aiSuggestion.dueDate);
    setAiSuggestion(null);
  }


  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (groupIds.length === 0) {
      setError(t("homework.selectAtLeastOneGroup"));
      return;
    }
    setSaving(true);
    try {
      const created = await homeworkApi.create({
        groupIds,
        title,
        description: description || undefined,
        dueDate: dueDate || undefined,
        maxScore: Number(maxScore) || 100,
      });
      if (file && created[0]) {
        await homeworkApi.uploadAttachment(created[0].id, file);
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

  async function onDelete(id: string) {
    if (!confirm(t("homework.confirmDelete"))) return;
    await homeworkApi.remove(id);
    load();
  }

  const filtered = useMemo(() => {
    return items.filter((h) => {
      if (filterDirection && !matchesSubject(h.group?.subject, filterDirection)) return false;
      if (filterGroupId && h.groupId !== filterGroupId) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${h.title} ${h.description ?? ""} ${h.group?.name ?? ""} ${h.group?.subject ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filterDirection, filterGroupId, search]);

  useEffect(() => setPage(1), [filterDirection, filterGroupId, search]);
  const pageItems = usePagedSlice(filtered, page);

  // Completion rate per group: completed marks / total (homework × enrolled students).
  const groupCompletionChart = useMemo(() => {
    const byGroup: Record<string, { name: string; completed: number; total: number }> = {};
    for (const h of items) {
      if (!h.group) continue;
      const key = h.groupId;
      byGroup[key] = byGroup[key] || { name: h.group.name, completed: 0, total: 0 };
      const completions = h.completions || [];
      byGroup[key].completed += completions.filter((c) => c.completed).length;
      byGroup[key].total += completions.length;
    }
    return Object.values(byGroup)
      .filter((g) => g.total > 0)
      .map((g) => ({ label: g.name, value: Math.round((g.completed / g.total) * 100) }));
  }, [items]);

  const homeworkCountChart = useMemo(() => {
    const byGroup: Record<string, number> = {};
    for (const h of items) {
      if (!h.group) continue;
      byGroup[h.group.name] = (byGroup[h.group.name] || 0) + 1;
    }
    return Object.entries(byGroup).map(([label, value]) => ({ label, value }));
  }, [items]);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("homework.title")}</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="field-input"
            placeholder={t("homework.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 160 }}
          />
          <Select
            options={[{ value: "", label: t("homework.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
            value={filterDirection}
            onChange={(v) => { setFilterDirection(v); setFilterGroupId(""); }}
            style={{ width: 170 }}
          />
          <Select
            options={[{ value: "", label: t("homework.allGroups") }, ...groupsInFilterDirection.map((g) => ({ value: g.id, label: g.name }))]}
            value={filterGroupId}
            onChange={setFilterGroupId}
            style={{ width: 170 }}
          />
          <button
            className="btn"
            type="button"
            onClick={() => setLeaderboardOpen(true)}
            style={{
              background: "#FEF3C7",
              color: "#B45309",
              border: "1px solid #FCD34D",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <span>🏆</span>
            <span>Reyting</span>
          </button>
          <button
            className="btn"
            onClick={() => setModalOpen(true)}
            disabled={groups.length === 0}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
          >
            {t("homework.newAssignment")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : groups.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("homework.createGroupFirst")}
          </div>
        ) : (
          <>
            {items.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{t("homework.completionRateTitle")}</div>
                  <BarChart data={groupCompletionChart} color="#1FA463" formatValue={(v) => `${v}%`} />
                  {groupCompletionChart.length === 0 && (
                    <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 8 }}>{t("homework.noCompletionsYet")}</div>
                  )}
                </div>
                <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{t("homework.countByGroupTitle")}</div>
                  <BarChart data={homeworkCountChart} color={ACCENT} />
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
                {items.length === 0 ? t("homework.noHomeworkYet") : t("homework.noSearchResults")}
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                  {pageItems.map((h) => {
                    const completions = h.completions || [];
                    const completedCount = completions.filter((c) => c.completed).length;
                    return (
                      <div key={h.id} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 15.5, fontWeight: 700, fontFamily: "'Manrope', sans-serif" }}>{h.title}</div>
                            <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600, marginTop: 4, background: "#EEF0FF", display: "inline-block", padding: "3px 9px", borderRadius: 7 }}>
                              {h.group?.name || t("homework.groupFallback")}
                            </div>
                          </div>
                          <button
                            className="btn"
                            onClick={() => onDelete(h.id)}
                            style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none", flexShrink: 0 }}
                          >
                            {t("homework.delete")}
                          </button>
                        </div>
                        {h.description && <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#4A4E58" }}>{h.description}</div>}
                        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #F1F0EC", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("homework.due")}: {formatDate(h.dueDate)}</div>
                          {h.attachmentPath && (
                            <a
                              href={fileUrl(h.attachmentPath) || "#"}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 12, color: ACCENT, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                            >
                              📎 {h.attachmentName || t("homework.file")}
                            </a>
                          )}
                        </div>
                        <button
                          className="btn"
                          onClick={() => setRosterHomework(h)}
                          style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8 }}
                        >
                          {t("homework.completedCount")} ({completedCount})
                        </button>
                      </div>
                    );
                  })}
                </div>
                <Pagination page={page} total={filtered.length} onChange={setPage} />
              </>
            )}
          </>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("homework.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldDirection")}</div>
            <Select
              options={[{ value: "", label: t("homework.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
              value={formDirection}
              onChange={(v) => { setFormDirection(v); setGroupIds([]); }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldGroups")}</div>
            <MultiSelect
              options={groupsInFormDirection.map((g) => ({ value: g.id, label: g.name }))}
              selected={groupIds}
              onChange={setGroupIds}
              placeholder={t("homework.selectGroups")}
            />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldTitle")}</div>
            <input className="field-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Unit 5 grammar" />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldDescription")}</div>
            <textarea
              className="field-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex 1-5 complete qiling"
              style={{ resize: "vertical" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldDueDate")}</div>
              <DatePicker value={dueDate} onChange={setDueDate} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Maksimal ball</div>
              <input
                className="field-input"
                type="number"
                min={1}
                max={1000}
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value) || 100)}
                placeholder="100"
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldAttachment")}</div>
            <input className="field-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {aiPromptOpen && (
            <div style={{ border: "1px solid #DDD6FE", background: "#F5F3FF", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#5B21B6" }}>✨ {t("hwAi.title")}</div>
                <button type="button" onClick={() => setAiPromptOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7C3AED", fontSize: 14, fontWeight: 800 }} aria-label={t("common.cancel")}>✕</button>
              </div>
              <textarea
                className="field-input"
                rows={3}
                autoFocus
                maxLength={1000}
                value={aiRequest}
                onChange={(e) => setAiRequest(e.target.value)}
                placeholder={t("hwAi.placeholder")}
                style={{ resize: "vertical", background: "#fff" }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["hwAi.example1", "hwAi.example2", "hwAi.example3"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setAiRequest(t(k))} style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, border: "1px solid #DDD6FE", background: "#fff", color: "#6D28D9", cursor: "pointer" }}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn"
                onClick={onGetAiSuggestion}
                disabled={aiSuggesting || !aiRequest.trim()}
                style={{ alignSelf: "flex-end", background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9, opacity: aiRequest.trim() ? 1 : 0.6 }}
              >
                {aiSuggesting ? t("hwAi.loading") : t("hwAi.get")}
              </button>
            </div>
          )}

          {aiSuggestion && (
            <div
              style={{
                background: "#F7F6FF",
                border: "1px solid #D7D3F8",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: ACCENT }}>
                  <span>✨ AI Tavsiya:</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAiSuggestion(null)}
                  style={{ background: "none", border: "none", color: "#8A8D96", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#181A1F" }}>{aiSuggestion.title}</div>
              <div style={{ fontSize: 12.5, color: "#4A4E58", whiteSpace: "pre-line", lineHeight: 1.5 }}>
                {aiSuggestion.description}
              </div>
              {aiSuggestion.dueDate && (
                <div style={{ fontSize: 11.5, color: "#8A8D96" }}>Tavsiya muddati: {aiSuggestion.dueDate}</div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={applyAiSuggestion}
                  style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
                >
                  ✅ {t("hwAi.apply")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={onGetAiSuggestion}
                  disabled={aiSuggesting}
                  style={{ background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}`, fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
                >
                  🔄 {t("hwAi.another")}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button
              className="btn"
              type="button"
              onClick={() => setAiPromptOpen((v) => !v)}
              disabled={aiSuggesting || saving}
              style={{
                background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 700,
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>✨</span>
              <span>{t("hwAi.button")}</span>
            </button>
            <button
              className="btn"
              type="submit"
              disabled={saving}
              style={{ flex: 1, background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}
            >
              {saving ? t("homework.adding") : t("homework.assign")}
            </button>
          </div>

        </form>
      </Modal>

      {rosterHomework && (
        <RosterModal
          homeworkItem={rosterHomework}
          onClose={() => {
            setRosterHomework(null);
            load();
          }}
        />
      )}

      {leaderboardOpen && (
        <LeaderboardModal
          groups={groups}
          initialGroupId={filterGroupId || undefined}
          onClose={() => setLeaderboardOpen(false)}
        />
      )}
    </>
  );
}

export default function HomeworkPage() {
  return (
    <DashboardShell>
      <HomeworkContent />
    </DashboardShell>
  );
}
