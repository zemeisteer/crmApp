"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import BarChart from "@/components/BarChart";
import MultiSelect from "@/components/MultiSelect";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import { examsApi, groupsApi, aiApi, Exam, Group, ApiError, fileUrl } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function ExamsContent() {
  const { t } = useLanguage();
  const [exams, setExams] = useState<Exam[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const subjects = useMemo(() => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[], [groups]);

  const [direction, setDirection] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [passingScore, setPassingScore] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [material, setMaterial] = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [filterGroupId, setFilterGroupId] = useState("");
  const [page, setPage] = useState(1);

  const [gradeExam, setGradeExam] = useState<Exam | null>(null);
  const [gradeStudents, setGradeStudents] = useState<{ id: string; fullName: string }[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [gradeSaving, setGradeSaving] = useState(false);
  const [gradeLoading, setGradeLoading] = useState(false);

  const [groupDetail, setGroupDetail] = useState<{ id: string; name: string } | null>(null);

  function load() {
    setLoading(true);
    Promise.all([examsApi.list(), groupsApi.list()])
      .then(([e, g]) => {
        setExams(e);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const groupsInDirection = direction ? groups.filter((g) => g.subject === direction) : groups;

  function selectWholeDirection() {
    setGroupIds(groupsInDirection.map((g) => g.id));
  }

  async function onAiAssist() {
    if (!title) {
      setError(t("exams.aiTitleRequiredError"));
      return;
    }
    setAiLoading(true);
    try {
      const res = await aiApi.generateMaterial({
        subject: direction || "Umumiy",
        topic: title,
        type: "imtihon tavsifi",
      });
      setDescription(res.material);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("exams.aiError"));
    } finally {
      setAiLoading(false);
    }
  }

  function resetForm() {
    setDirection("");
    setGroupIds([]);
    setTitle("");
    setDescription("");
    setMaxScore("100");
    setPassingScore("");
    setDurationMinutes("");
    setMaterial(null);
    setError(null);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (groupIds.length === 0) {
      setError(t("exams.selectGroupOrDirectionError"));
      return;
    }
    setSaving(true);
    try {
      const created = await examsApi.create({
        groupIds,
        title,
        description: description || undefined,
        maxScore: Number(maxScore),
        passingScore: passingScore ? Number(passingScore) : undefined,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      });
      if (material && created[0]) {
        await examsApi.uploadMaterial(created[0].id, material);
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
    if (!confirm(t("exams.confirmDelete"))) return;
    await examsApi.remove(id);
    load();
  }

  async function openGrading(exam: Exam) {
    setGradeExam(exam);
    setGradeLoading(true);
    const initial: Record<string, string> = {};
    for (const r of exam.results || []) initial[r.studentId] = String(r.score);
    setScores(initial);
    try {
      const fullGroup = (await groupsApi.get(exam.groupId)) as Group & {
        enrollments?: { student: { id: string; fullName: string } }[];
      };
      setGradeStudents((fullGroup.enrollments || []).map((e) => e.student));
    } finally {
      setGradeLoading(false);
    }
  }

  async function onSaveGrades() {
    if (!gradeExam) return;
    setGradeSaving(true);
    try {
      const results = Object.entries(scores)
        .filter(([, v]) => v !== "")
        .map(([studentId, v]) => ({ studentId, score: Number(v) }));
      await examsApi.submitResults(gradeExam.id, results);
      setGradeExam(null);
      load();
    } finally {
      setGradeSaving(false);
    }
  }

  const filteredExams = filterGroupId ? exams.filter((e) => e.groupId === filterGroupId) : exams;
  useEffect(() => setPage(1), [filterGroupId]);
  const pageExams = usePagedSlice(filteredExams, page);

  // Groups that have at least one exam — clicking one shows every student's
  // score history across that group's exams.
  const groupsWithExams = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; examCount: number; avg: number | null }>();
    for (const e of filteredExams) {
      if (!e.group) continue;
      const entry = seen.get(e.groupId) || { id: e.groupId, name: e.group.name, examCount: 0, avg: null };
      entry.examCount += 1;
      seen.set(e.groupId, entry);
    }
    for (const entry of seen.values()) {
      const groupExams = filteredExams.filter((e) => e.groupId === entry.id && (e.results || []).length > 0);
      const allScores = groupExams.flatMap((e) => e.results!.map((r) => r.score));
      entry.avg = allScores.length ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10 : null;
    }
    return Array.from(seen.values());
  }, [filteredExams]);

  const groupDetailExams = groupDetail ? filteredExams.filter((e) => e.groupId === groupDetail.id) : [];
  const groupDetailStudents = useMemo(() => {
    const byStudent = new Map<
      string,
      { fullName: string; scores: { title: string; score: number; maxScore: number; passingScore: number | null }[] }
    >();
    for (const e of groupDetailExams) {
      for (const r of e.results || []) {
        const entry = byStudent.get(r.studentId) || { fullName: r.student.fullName, scores: [] };
        entry.scores.push({ title: e.title, score: r.score, maxScore: e.maxScore, passingScore: e.passingScore });
        byStudent.set(r.studentId, entry);
      }
    }
    return Array.from(byStudent.values())
      .map((s) => ({
        ...s,
        avgPct: Math.round((s.scores.reduce((sum, sc) => sum + sc.score / sc.maxScore, 0) / s.scores.length) * 100),
      }))
      .sort((a, b) => b.avgPct - a.avgPct);
  }, [groupDetailExams]);

  const avgScoreChart = useMemo(
    () =>
      filteredExams
        .filter((e) => (e.results || []).length > 0)
        .map((e) => ({
          label: e.title,
          value: Math.round((e.results!.reduce((s, r) => s + r.score, 0) / e.results!.length) * 10) / 10,
        })),
    [filteredExams],
  );

  const passRateChart = useMemo(
    () =>
      filteredExams
        .filter((e) => (e.results || []).length > 0 && e.passingScore != null)
        .map((e) => ({
          label: e.title,
          value: Math.round((e.results!.filter((r) => r.score >= (e.passingScore || 0)).length / e.results!.length) * 100),
        })),
    [filteredExams],
  );

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("exams.title")}</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Select
            options={[{ value: "", label: t("exams.allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            value={filterGroupId}
            onChange={setFilterGroupId}
            style={{ width: 180 }}
          />
          <button
            className="btn"
            onClick={() => setModalOpen(true)}
            disabled={groups.length === 0}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
          >
            {t("exams.newExam")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : exams.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("exams.noExamsYet")}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{t("exams.avgScore")}</div>
                <BarChart data={avgScoreChart} color={ACCENT} />
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{t("exams.passRate")}</div>
                <BarChart data={passRateChart} color="#1FA463" formatValue={(v) => `${v}%`} />
              </div>
            </div>

            {groupsWithExams.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{t("exams.resultsByGroup")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                  {groupsWithExams.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGroupDetail({ id: g.id, name: g.name })}
                      className="btn"
                      style={{ textAlign: "left", background: "#F7F6F3", border: "1px solid #EAE8E2", borderRadius: 12, padding: 14 }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{g.name}</div>
                      <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 4 }}>
                        {g.examCount} {t("exams.examCountUnit")}{g.avg != null ? ` · ${t("exams.avgLabel")} ${g.avg} ${t("exams.pointsUnit")}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredExams.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
                {t("exams.noSearchResults")}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {pageExams.map((ex) => (
                    <div key={ex.id} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Manrope', sans-serif" }}>{ex.title}</div>
                          <div style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 2 }}>
                            {ex.group?.name || t("homework.groupFallback")} · {t("exams.maxScoreLabel")}: {ex.maxScore}
                            {ex.passingScore != null && ` · ${t("exams.passingScoreLabel")}: ${ex.passingScore}`}
                            {ex.durationMinutes != null && ` · ${ex.durationMinutes} ${t("exams.minutesUnit")}`}
                            {" · "}{(ex.results || []).length} {t("exams.gradedCount")}
                          </div>
                          {ex.description && <div style={{ fontSize: 12.5, color: "#4A4E58", marginTop: 6, maxWidth: 480 }}>{ex.description}</div>}
                          {ex.materialPath && (
                            <a href={fileUrl(ex.materialPath) || "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: ACCENT, fontWeight: 700, marginTop: 6, display: "inline-block" }}>
                              📎 {ex.materialName || t("exams.material")}
                            </a>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn"
                            onClick={() => openGrading(ex)}
                            style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            {t("exams.grade")}
                          </button>
                          <button
                            className="btn"
                            onClick={() => onDelete(ex.id)}
                            style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            {t("exams.delete")}
                          </button>
                        </div>
                      </div>
                      {(ex.results || []).length > 0 && (
                        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {ex.results!.map((r) => (
                            <span key={r.id} className="badge badge-neutral">
                              {r.student.fullName}: {r.score}/{ex.maxScore}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Pagination page={page} total={filteredExams.length} onChange={setPage} />
              </>
            )}
          </>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("exams.modalTitle")}>
        <form onSubmit={onCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldDirection")}</div>
            <Select
              options={[{ value: "", label: t("homework.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
              value={direction}
              onChange={(v) => { setDirection(v); setGroupIds([]); }}
            />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58" }}>{t("exams.fieldGroups")}</div>
              <button type="button" onClick={selectWholeDirection} style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, background: "none", border: "none", cursor: "pointer" }}>
                {t("exams.selectWholeDirection")}
              </button>
            </div>
            <MultiSelect
              options={groupsInDirection.map((g) => ({ value: g.id, label: g.name }))}
              selected={groupIds}
              onChange={setGroupIds}
              placeholder={t("exams.selectGroups")}
            />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldTitle")}</div>
            <input className="field-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midterm" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58" }}>{t("exams.fieldDescription")}</div>
              <button type="button" onClick={onAiAssist} disabled={aiLoading} style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, background: "none", border: "none", cursor: "pointer" }}>
                {aiLoading ? t("exams.aiWriting") : t("exams.aiWriteBtn")}
              </button>
            </div>
            <textarea
              className="field-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("exams.descriptionPlaceholder")}
              style={{ resize: "vertical" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldMaxScore")}</div>
              <input className="field-input" type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldPassingScore")}</div>
              <input className="field-input" type="number" min={0} value={passingScore} onChange={(e) => setPassingScore(e.target.value)} placeholder="60" />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldDuration")}</div>
              <input className="field-input" type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="60" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldMaterial")}</div>
            <input className="field-input" type="file" accept="application/pdf" onChange={(e) => setMaterial(e.target.files?.[0] ?? null)} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("exams.creating") : t("exams.create")}
          </button>
        </form>
      </Modal>

      <Modal open={!!gradeExam} onClose={() => setGradeExam(null)} title={gradeExam ? `${t("exams.gradingTitlePrefix")} — ${gradeExam.title}` : t("exams.gradingTitlePrefix")}>
        {gradeExam && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {gradeLoading ? (
              <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("common.loading")}</div>
            ) : gradeStudents.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("exams.noGradeStudents")}</div>
            ) : (
              gradeStudents.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.fullName}</span>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    max={gradeExam.maxScore}
                    value={scores[s.id] ?? ""}
                    onChange={(e) => setScores((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    style={{ width: 90 }}
                    placeholder={`/${gradeExam.maxScore}`}
                  />
                </div>
              ))
            )}
            <button
              className="btn"
              onClick={onSaveGrades}
              disabled={gradeSaving || gradeStudents.length === 0}
              style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
            >
              {gradeSaving ? t("exams.creating") : t("exams.saveGrades")}
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!groupDetail} onClose={() => setGroupDetail(null)} title={groupDetail ? `${t("exams.resultsTitlePrefix")} — ${groupDetail.name}` : t("exams.resultsTitlePrefix")}>
        {groupDetailStudents.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("exams.noGradedStudentsYet")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groupDetailStudents.map((s) => {
              const barColor = s.avgPct >= 80 ? "#1FA463" : s.avgPct >= 60 ? "#EA7A3A" : "#B23A47";
              return (
                <div key={s.fullName} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{s.fullName}</div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: barColor }}>{s.avgPct}%</span>
                  </div>
                  <div style={{ height: 6, background: "#F1F0EC", borderRadius: 5, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ width: `${s.avgPct}%`, height: "100%", background: barColor, borderRadius: 5 }} />
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {s.scores.map((sc, i) => {
                      const passed = sc.passingScore != null ? sc.score >= sc.passingScore : null;
                      return (
                        <span
                          key={i}
                          style={{
                            fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 100,
                            background: passed === true ? "#E9F8EF" : passed === false ? "#FDEBEC" : "#F2F1EC",
                            color: passed === true ? "#1FA463" : passed === false ? "#B23A47" : "#4A4E58",
                          }}
                        >
                          {sc.title}: {sc.score}/{sc.maxScore}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}

export default function ExamsPage() {
  return (
    <DashboardShell>
      <ExamsContent />
    </DashboardShell>
  );
}
