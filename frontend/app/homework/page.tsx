"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import MultiSelect from "@/components/MultiSelect";
import BarChart from "@/components/BarChart";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { homeworkApi, groupsApi, Homework, Group, ApiError, fileUrl } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function RosterModal({ homeworkItem, onClose }: { homeworkItem: Homework; onClose: () => void }) {
  const { t } = useLanguage();
  const [roster, setRoster] = useState<{ student: { id: string; fullName: string }; completed: boolean }[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    homeworkApi.roster(homeworkItem.id).then(setRoster);
  }, [homeworkItem.id]);

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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roster.map((r) => (
            <label key={r.student.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px", cursor: "pointer" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.student.fullName}</span>
              <input
                type="checkbox"
                checked={r.completed}
                disabled={busyId === r.student.id}
                onChange={(e) => toggle(r.student.id, e.target.checked)}
              />
            </label>
          ))}
        </div>
      )}
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
  const [rosterHomework, setRosterHomework] = useState<Homework | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formDirection, setFormDirection] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [filterDirection, setFilterDirection] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const subjects = useMemo(() => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[], [groups]);
  const groupsInFilterDirection = filterDirection ? groups.filter((g) => g.subject === filterDirection) : groups;
  const groupsInFormDirection = formDirection ? groups.filter((g) => g.subject === formDirection) : groups;

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
    setFile(null);
    setError(null);
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
      const created = await homeworkApi.create({ groupIds, title, description: description || undefined, dueDate: dueDate || undefined });
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
      if (filterDirection && h.group?.subject !== filterDirection) return false;
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("homework.modalTitle")}>
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
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldDueDate")}</div>
            <DatePicker value={dueDate} onChange={setDueDate} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("homework.fieldAttachment")}</div>
            <input className="field-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("homework.adding") : t("homework.assign")}
          </button>
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
