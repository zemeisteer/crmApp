"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import Modal from "@/components/Modal";
import BarChart from "@/components/BarChart";
import PdfImportPanel from "@/components/exams/PdfImportPanel";
import ExamAttemptsModal, { ExamAttemptReview } from "@/components/exams/ExamAttemptReview";
import QuestionList, { GroupHeader } from "@/components/tests/QuestionView";
import QuestionEditor, { emptyQuestion } from "@/components/tests/QuestionEditor";
import QuestionInput from "@/components/tests/QuestionInput";
import { hasAnswer, isAnswered, type PublicQuestion, type TestQuestion } from "@/lib/tests";
import MultiSelect from "@/components/MultiSelect";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import {
  examsApi,
  groupsApi,
  aiApi,
  Exam,
  ExamQuestion,
  SubmitAttemptResult,
  Group,
  ApiError,
  fileUrl,
} from "@/lib/api";
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

  const subjects = useMemo(
    () => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[],
    [groups],
  );

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

  // Manual grading modal state
  const [gradeExam, setGradeExam] = useState<Exam | null>(null);
  const [gradeStudents, setGradeStudents] = useState<{ id: string; fullName: string }[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [gradeSaving, setGradeSaving] = useState(false);
  const [gradeLoading, setGradeLoading] = useState(false);

  const [groupDetail, setGroupDetail] = useState<{ id: string; name: string } | null>(null);

  // ---- Question Bank Management State ----
  const [questionsExam, setQuestionsExam] = useState<Exam | null>(null);
  const [examQuestionsList, setExamQuestionsList] = useState<ExamQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [aiGeneratingQuestions, setAiGeneratingQuestions] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);

  // New question form (any type) and AI generation options
  const [newQ, setNewQ] = useState<TestQuestion | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [showAiForm, setShowAiForm] = useState(false);
  const [aiCount, setAiCount] = useState("10");
  const [aiRequest, setAiRequest] = useState("");
  const [attemptsExam, setAttemptsExam] = useState<Exam | null>(null);

  // ---- Interactive Test Taking Simulator State ----
  const [simulatorExam, setSimulatorExam] = useState<Exam | null>(null);
  const [simulatorStudentId, setSimulatorStudentId] = useState("");
  const [simulatorStudents, setSimulatorStudents] = useState<{ id: string; fullName: string }[]>([]);
  const [simulatorStep, setSimulatorStep] = useState<"SELECT" | "TESTING" | "RESULT">("SELECT");
  const [simulatorQuestions, setSimulatorQuestions] = useState<Array<PublicQuestion & { id: string }>>([]);
  const [simulatorAnswers, setSimulatorAnswers] = useState<Record<string, string>>({});
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [simulatorTimer, setSimulatorTimer] = useState<number>(0);
  const [simulatorResult, setSimulatorResult] = useState<SubmitAttemptResult | null>(null);
  const [submittingAttempt, setSubmittingAttempt] = useState(false);

  // A failed load is shown with a retry, not as an empty page ("" = no
  // message from the server; null = no error).
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([examsApi.list(), groupsApi.list()])
      .then(([e, g]) => {
        setExams(e);
        setGroups(g);
      })
      .then(() => setLoadError(null))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ""))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Timer effect for simulator
  // The latest submitTestAttempt (it reads the current answers).
  const submitLatest = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    submitLatest.current = submitTestAttempt;
  });

  // Countdown, one second at a time. When it reaches zero the attempt is
  // submitted once, with the answers as they are at that moment (the ref
  // always holds the latest submit) - not from inside a state updater,
  // which React may call twice.
  useEffect(() => {
    if (simulatorStep !== "TESTING" || simulatorTimer <= 0) return;
    const id = setTimeout(() => {
      setSimulatorTimer(simulatorTimer - 1);
      if (simulatorTimer === 1) void submitLatest.current();
    }, 1000);
    return () => clearTimeout(id);
  }, [simulatorStep, simulatorTimer]);

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
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
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
      const studs = (fullGroup.enrollments || []).map((e) => e.student).filter((s): s is NonNullable<typeof s> => Boolean(s));
      setGradeStudents(studs);
    } finally {
      setGradeLoading(false);
    }
  }

  async function onSaveGrades() {
    if (!gradeExam) return;
    setGradeSaving(true);
    try {
      const entries = Object.entries(scores)
        .filter(([, v]) => v !== "" && !isNaN(Number(v)))
        .map(([studentId, v]) => ({ studentId, score: Number(v) }));
      await examsApi.submitResults(gradeExam.id, entries);
      setGradeExam(null);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setGradeSaving(false);
    }
  }

  // ---- Question Bank Handlers ----

  async function openQuestionManager(exam: Exam) {
    setQuestionsExam(exam);
    setQuestionError(null);
    setNewQ(null);
    setShowAiForm(false);
    setLoadingQuestions(true);
    try {
      const qList = await examsApi.getQuestions(exam.id);
      setExamQuestionsList(qList);
    } catch (err) {
      setQuestionError(err instanceof ApiError ? err.message : t("ex.loadQError"));
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function handleAiGenerateQuestions() {
    if (!questionsExam) return;
    setAiGeneratingQuestions(true);
    setQuestionError(null);
    try {
      const newQuestions = await examsApi.generateQuestions(questionsExam.id, { count: Number(aiCount), request: aiRequest.trim() || undefined });
      setExamQuestionsList((prev) => [...prev, ...newQuestions]);
      setShowAiForm(false);
      load(); // refresh main exam list question counts
    } catch (err) {
      setQuestionError(err instanceof ApiError ? err.message : t("ex.aiError"));
    } finally {
      setAiGeneratingQuestions(false);
    }
  }

  const newQReady = newQ ? hasAnswer(newQ) && (newQ.prompt.trim() || newQ.type === "MATCHING") && (newQ.type !== "MCQ" || (newQ.options ?? []).every((o) => o.text.trim())) : false;

  async function handleAddQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!questionsExam || !newQ || !newQReady) return;
    setSavingQuestion(true);
    setQuestionError(null);
    try {
      const created = await examsApi.createQuestion(questionsExam.id, newQ);
      setExamQuestionsList((prev) => [...prev, created]);
      // Keep type and section for the next question of the same block.
      setNewQ({ ...emptyQuestion(newQ.type), section: newQ.section, instruction: newQ.instruction, passage: newQ.passage, points: newQ.points });
      load();
    } catch (err) {
      setQuestionError(err instanceof ApiError ? err.message : t("ex.saveQError"));
    } finally {
      setSavingQuestion(false);
    }
  }

  async function handleDeleteQuestion(qId: string) {
    if (!questionsExam) return;
    if (!confirm(t("ex.confirmDeleteQ"))) return;
    try {
      await examsApi.removeQuestion(questionsExam.id, qId);
      setExamQuestionsList((prev) => prev.filter((q) => q.id !== qId));
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("pay.deleteError"));
    }
  }

  // ---- Interactive Test Simulator Handlers ----

  async function openTestSimulator(exam: Exam) {
    setSimulatorExam(exam);
    setSimulatorStep("SELECT");
    setSimulatorStudentId("");
    setSimulatorAnswers({});
    setCurrentQIdx(0);
    setSimulatorResult(null);

    try {
      const fullGroup = (await groupsApi.get(exam.groupId)) as Group & {
        enrollments?: { student: { id: string; fullName: string } }[];
      };
      const studs = (fullGroup.enrollments || []).map((e) => e.student).filter((s): s is NonNullable<typeof s> => Boolean(s));
      setSimulatorStudents(studs);
      if (studs.length > 0 && studs[0]) {
        setSimulatorStudentId(studs[0].id);
      }
    } catch {
      setSimulatorStudents([]);
    }
  }

  async function startTestAttempt() {
    if (!simulatorExam || !simulatorStudentId) {
      alert("Iltimos, test topshiruvchi talabani tanlang");
      return;
    }

    try {
      const data = await examsApi.startAttempt(simulatorExam.id, simulatorStudentId);
      if (data.questions.length === 0) {
        alert(t("ex.noQuestions"));
        return;
      }
      setSimulatorQuestions(data.questions);
      setSimulatorAnswers({});
      setCurrentQIdx(0);
      const totalSeconds = (data.exam.durationMinutes || 30) * 60;
      setSimulatorTimer(totalSeconds);
      setSimulatorStep("TESTING");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("ex.startError"));
    }
  }

  function handleSelectAnswer(questionId: string, answerKey: string) {
    setSimulatorAnswers((prev) => ({ ...prev, [questionId]: answerKey }));
  }

  async function submitTestAttempt() {
    if (!simulatorExam || !simulatorStudentId) return;
    setSubmittingAttempt(true);
    try {
      const res = await examsApi.submitAttempt(simulatorExam.id, {
        studentId: simulatorStudentId,
        answers: simulatorAnswers,
      });
      setSimulatorResult(res);
      setSimulatorStep("RESULT");
      load(); // refresh results in background
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("ex.submitError"));
    } finally {
      setSubmittingAttempt(false);
    }
  }

  const filteredExams = filterGroupId ? exams.filter((e) => e.groupId === filterGroupId) : exams;
  const pagedExams = usePagedSlice(filteredExams, page, 10);

  const groupStats = useMemo(() => {
    const map = new Map<string, { name: string; examCount: number; totalScore: number; resultCount: number }>();
    for (const ex of exams) {
      const gName = ex.group?.name || t("homework.groupFallback");
      const current = map.get(ex.groupId) || { name: gName, examCount: 0, totalScore: 0, resultCount: 0 };
      current.examCount += 1;
      for (const r of ex.results || []) {
        current.totalScore += (r.score / ex.maxScore) * 100;
        current.resultCount += 1;
      }
      map.set(ex.groupId, current);
    }
    return Array.from(map.entries()).map(([id, s]) => ({
      id,
      name: s.name,
      avgPct: s.resultCount ? Math.round(s.totalScore / s.resultCount) : 0,
      examCount: s.examCount,
    }));
  }, [exams, t]);

  const groupDetailStudents = useMemo(() => {
    if (!groupDetail) return [];
    const groupExams = exams.filter((e) => e.groupId === groupDetail.id);
    const map = new Map<string, { fullName: string; totalPct: number; count: number; scores: { title: string; score: number; maxScore: number; passingScore: number | null }[] }>();
    for (const ex of groupExams) {
      for (const r of ex.results || []) {
        const current = map.get(r.studentId) || { fullName: r.student.fullName, totalPct: 0, count: 0, scores: [] };
        current.totalPct += (r.score / ex.maxScore) * 100;
        current.count += 1;
        current.scores.push({ title: ex.title, score: r.score, maxScore: ex.maxScore, passingScore: ex.passingScore });
        map.set(r.studentId, current);
      }
    }
    return Array.from(map.values()).map((s) => ({
      fullName: s.fullName,
      avgPct: Math.round(s.totalPct / s.count),
      scores: s.scores,
    }));
  }, [groupDetail, exams]);

  // Format timer seconds into mm:ss
  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t("exams.title")}</h1>
          <p style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
            {t("ex.subtitle")}
          </p>
        </div>
        <button
          className="btn"
          onClick={() => { resetForm(); setModalOpen(true); }}
          style={{ background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 10 }}
        >
          {t("exams.newExam")}
        </button>
      </div>

      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        {loadError !== null ? (
          <LoadError message={loadError || t("adm.loadError")} onRetry={load} />
        ) : loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            {/* KPI Performance Charts */}
            {groupStats.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#8A8D96", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                    {t("exams.avgScore")}
                  </div>
                  <BarChart
                    data={groupStats.map((g) => ({ label: g.name, value: g.avgPct }))}
                    color="#4F46E5"
                    formatValue={(v) => `${v}%`}
                  />
                </div>
                <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#8A8D96", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                    {t("exams.resultsByGroup")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {groupStats.map((g) => (
                      <div
                        key={g.id}
                        onClick={() => setGroupDetail({ id: g.id, name: g.name })}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 10, background: "#FAF9F6", cursor: "pointer" }}
                      >
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#8A8D96" }}>{g.examCount} {t("exams.examCountUnit")}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{g.avgPct}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Filter toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ width: 220 }}>
                <Select
                  options={[{ value: "", label: t("exams.allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                  value={filterGroupId}
                  onChange={(v) => { setFilterGroupId(v); setPage(1); }}
                />
              </div>
            </div>

            {/* Exam cards list */}
            {filteredExams.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("exams.noExamsYet")}</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {pagedExams.map((ex) => (
                    <div key={ex.id} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{ex.title}</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {ex.questions?.length || 0} {t("placement.questions")}
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 4 }}>
                            {ex.group?.name || t("homework.groupFallback")} · {t("exams.maxScoreLabel")}: {ex.maxScore}
                            {ex.passingScore != null && ` · ${t("exams.passingScoreLabel")}: ${ex.passingScore}`}
                            {ex.durationMinutes != null && ` · ⏱ ${ex.durationMinutes} ${t("exams.minutesUnit")}`}
                            {" · "}{(ex.results || []).length} {t("exams.gradedCount")}
                          </div>
                          {ex.description && <div style={{ fontSize: 13, color: "#4A4E58", marginTop: 8, maxWidth: 600 }}>{ex.description}</div>}
                          {ex.materialPath && (
                            <a href={fileUrl(ex.materialPath) || "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: ACCENT, fontWeight: 700, marginTop: 6, display: "inline-block" }}>
                              📎 {ex.materialName || t("exams.material")}
                            </a>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {/* Question Bank */}
                          <button
                            className="btn cursor-pointer"
                            onClick={() => openQuestionManager(ex)}
                            style={{ background: "#EEF2FF", color: "#4F46E5", border: "1px solid #C7D2FE", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            📝 {t("ex.bank")} ({ex.questions?.length || 0})
                          </button>

                          {/* Take Exam Simulator */}
                          <button
                            className="btn cursor-pointer"
                            onClick={() => openTestSimulator(ex)}
                            style={{ background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            {t("ex.takeTest")}
                          </button>

                          {/* Online attempts (review written answers) */}
                          {(ex.attempts ?? []).length > 0 && (
                            <button
                              className="btn cursor-pointer"
                              onClick={() => setAttemptsExam(ex)}
                              style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                            >
                              📋 {t("review.attemptsBtn")} ({(ex.attempts ?? []).length})
                              {(ex.attempts ?? []).some((a) => a.reviewStatus === "PENDING") && ` · ⏳ ${(ex.attempts ?? []).filter((a) => a.reviewStatus === "PENDING").length}`}
                            </button>
                          )}

                          {/* Manual Grading */}
                          <button
                            className="btn cursor-pointer"
                            onClick={() => openGrading(ex)}
                            style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            {t("exams.grade")}
                          </button>

                          {/* Delete */}
                          <button
                            className="btn cursor-pointer"
                            onClick={() => onDelete(ex.id)}
                            style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
                          >
                            {t("exams.delete")}
                          </button>
                        </div>
                      </div>

                      {/* Graded results preview pills */}
                      {(ex.results || []).length > 0 && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #F1F0EC", display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {ex.results!.map((r) => (
                            <span key={r.id} className="badge badge-neutral" style={{ fontSize: 12 }}>
                              {r.student.fullName}: <strong>{r.score}/{ex.maxScore}</strong>
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

      {/* Create Exam Modal */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("exams.modalTitle")}>
        <form onSubmit={onCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
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
            <input className="field-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midterm Exam: Grammar & Reading" />
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
              <input className="field-input" type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="45" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("exams.fieldMaterial")}</div>
            <input className="field-input" type="file" accept="application/pdf" onChange={(e) => setMaterial(e.target.files?.[0] ?? null)} />
          </div>
          <button
            className="btn cursor-pointer"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("exams.creating") : t("exams.create")}
          </button>
        </form>
      </Modal>

      {/* Manual Grading Modal */}
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
              className="btn cursor-pointer"
              onClick={onSaveGrades}
              disabled={gradeSaving || gradeStudents.length === 0}
              style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
            >
              {gradeSaving ? t("exams.creating") : t("exams.saveGrades")}
            </button>
          </div>
        )}
      </Modal>

      {/* Group Detail Analytics Modal */}
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

      {/* ======================================================== */}
      {/* QUESTION BANK MANAGER MODAL (Spec Section 21)             */}
      {/* ======================================================== */}
      <Modal
        open={!!questionsExam}
        onClose={() => setQuestionsExam(null)}
        title={questionsExam ? `${t("ex.bank")}: ${questionsExam.title}` : t("ex.bank")}
        width={820}
      >
        {questionsExam && (
          <div className="space-y-4">
            {questionError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs font-medium border border-rose-200">
                {questionError}
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 flex-wrap">
              <div>
                <span className="text-xs font-bold text-slate-800">
                  {t("ex.totalQ")}: {examQuestionsList.length}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  {t("ex.totalPoints")}: {examQuestionsList.reduce((sum, q) => sum + (q.points || 1), 0)}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <PdfImportPanel
                  examId={questionsExam.id}
                  onImported={(created) => {
                    setExamQuestionsList((prev) => [...prev, ...created]);
                    load();
                  }}
                />
                <button
                  onClick={() => { setShowAiForm(!showAiForm); setNewQ(null); }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                >
                  ✨ {t("ex.aiGenerate")}
                </button>
                <button
                  onClick={() => { setNewQ(newQ ? null : emptyQuestion("MCQ")); setShowAiForm(false); }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {newQ ? t("ex.cancelX") : t("ex.addQ")}
                </button>
              </div>
            </div>

            {/* AI generation options */}
            {showAiForm && (
              <div className="p-4 rounded-xl border border-violet-200 bg-violet-50/50 space-y-3">
                <div className="text-xs font-bold text-violet-950">✨ {t("ex.aiTitle")}</div>
                <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">{t("ex.aiCount")}</label>
                    <select value={aiCount} onChange={(e) => setAiCount(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs">
                      {["5", "10", "15", "20", "25", "30"].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">{t("ex.aiRequest")}</label>
                    <textarea
                      rows={2}
                      value={aiRequest}
                      onChange={(e) => setAiRequest(e.target.value)}
                      placeholder={t("ex.aiRequestPh")}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[11px] text-slate-500">{t("ex.aiHint")}</span>
                  <button
                    type="button"
                    onClick={handleAiGenerateQuestions}
                    disabled={aiGeneratingQuestions}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    {aiGeneratingQuestions ? t("ex.aiGenerating") : `✨ ${t("ex.aiCreate")} (${aiCount})`}
                  </button>
                </div>
              </div>
            )}

            {/* Add Question Inline Form */}
            {newQ && (
              <form onSubmit={handleAddQuestion} className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-3">
                <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wide">{t("ex.newQ")}</h4>
                <QuestionEditor value={newQ} onChange={setNewQ} />
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">{t("ex.explanation")}</label>
                  <input
                    type="text"
                    placeholder={t("ex.explanationPh")}
                    value={newQ.explanation ?? ""}
                    onChange={(e) => setNewQ({ ...newQ, explanation: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={savingQuestion || !newQReady}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                  >
                    {savingQuestion ? t("common.saving") : t("ex.saveQ")}
                  </button>
                </div>
              </form>
            )}

            {/* Questions List */}
            {loadingQuestions ? (
              <div className="py-12 text-center text-xs text-slate-500">{t("ex.loadingQ")}</div>
            ) : examQuestionsList.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-600">{t("ex.emptyQ")}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {t("ex.emptyQHint")}
                </p>
              </div>
            ) : (
              <div className="max-h-[460px] overflow-y-auto pr-1">
                <QuestionList
                  questions={examQuestionsList}
                  meta={(q) => (q.explanation ? <span className="block text-[11px] text-slate-500 italic font-normal mt-1">💡 {q.explanation}</span> : null)}
                  aside={(q) => (
                    <button
                      onClick={() => q.id && handleDeleteQuestion(q.id)}
                      title={t("ex.deleteQ")}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                    >
                      🗑
                    </button>
                  )}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ======================================================== */}
      {/* INTERACTIVE QUIZ TAKING SIMULATOR (Spec Section 21 & 22)   */}
      {/* ======================================================== */}
      <Modal
        open={!!simulatorExam}
        onClose={() => setSimulatorExam(null)}
        title={simulatorExam ? `${t("ex.simulator")}: ${simulatorExam.title}` : t("ex.simulator")}
        width={simulatorStep === "SELECT" ? 480 : 760}
      >
        {simulatorExam && (
          <div className="space-y-4">
            {/* STEP 1: SELECT STUDENT */}
            {simulatorStep === "SELECT" && (
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                </div>

                <div>
                  <h3 className="text-base font-bold text-slate-900">{simulatorExam.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Guruh: <strong>{simulatorExam.group?.name || "Guruh"}</strong> · Max ball: {simulatorExam.maxScore} · 
                    Vaqt: {simulatorExam.durationMinutes || 30} daqiqa
                  </p>
                </div>

                <div className="max-w-xs mx-auto text-left">
                  <label className="block text-xs font-medium text-slate-700 mb-1">{t("ex.pickStudent")}</label>
                  {simulatorStudents.length === 0 ? (
                    <p className="text-xs text-rose-500">{t("ex.noStudents")}</p>
                  ) : (
                    <select
                      value={simulatorStudentId}
                      onChange={(e) => setSimulatorStudentId(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                    >
                      {simulatorStudents.map((s) => (
                        <option key={s.id} value={s.id}>{s.fullName}</option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  onClick={startTestAttempt}
                  disabled={simulatorStudents.length === 0}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  {t("ex.startTest")}
                </button>
              </div>
            )}

            {/* STEP 2: ACTIVE QUIZ TAKING */}
            {simulatorStep === "TESTING" && simulatorQuestions.length > 0 && (
              <div className="space-y-4">
                {/* Header with timer and navigation */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white">
                  <div>
                    <span className="text-xs font-medium text-slate-300 block">Savol {currentQIdx + 1} / {simulatorQuestions.length}</span>
                    <span className="text-[11px] text-slate-400">Ball: {simulatorQuestions[currentQIdx].points}</span>
                  </div>

                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold font-mono ${
                    simulatorTimer < 300 ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" : "bg-slate-800 text-slate-200"
                  }`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 14 14" />
                    </svg>
                    {formatTimer(simulatorTimer)}
                  </div>
                </div>

                {/* Quick question pill bar */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {simulatorQuestions.map((q, idx) => {
                    const answered = isAnswered(q, simulatorAnswers[q.id]);
                    const isCurrent = idx === currentQIdx;
                    return (
                      <button
                        key={q.id}
                        onClick={() => setCurrentQIdx(idx)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center shrink-0 ${
                          isCurrent
                            ? "bg-indigo-600 text-white ring-2 ring-indigo-300"
                            : answered
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                {/* Question (with its section, instruction and passage) */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
                  <GroupHeader
                    section={simulatorQuestions[currentQIdx].section ?? null}
                    instruction={simulatorQuestions[currentQIdx].instruction ?? null}
                    passage={simulatorQuestions[currentQIdx].passage ?? null}
                    first
                  />
                  <h4 className="text-sm font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap">
                    {simulatorQuestions[currentQIdx].prompt}
                  </h4>
                  <QuestionInput
                    key={simulatorQuestions[currentQIdx].id}
                    q={simulatorQuestions[currentQIdx]}
                    value={simulatorAnswers[simulatorQuestions[currentQIdx].id] ?? ""}
                    onChange={(v) => handleSelectAnswer(simulatorQuestions[currentQIdx].id, v)}
                  />
                </div>

                {/* Footer Navigation */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    disabled={currentQIdx === 0}
                    onClick={() => setCurrentQIdx((prev) => prev - 1)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-medium cursor-pointer"
                  >
                    {t("ex.prev")}
                  </button>

                  <div className="flex items-center gap-2">
                    {currentQIdx < simulatorQuestions.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setCurrentQIdx((prev) => prev + 1)}
                        className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        {t("ex.next")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={submittingAttempt}
                        onClick={submitTestAttempt}
                        className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shadow-sm"
                      >
                        {submittingAttempt ? t("pt.submitting") : `${t("pt.finish")} ✓`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: RESULTS AND CELEBRATION */}
            {simulatorStep === "RESULT" && simulatorResult && (
              <div className="space-y-5">
                <div className={`p-6 rounded-2xl text-center border ${
                  simulatorResult.passed
                    ? "bg-gradient-to-b from-emerald-50 to-white border-emerald-200"
                    : "bg-gradient-to-b from-amber-50 to-white border-amber-200"
                }`}>
                  <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center font-extrabold text-2xl border-4 ${
                    simulatorResult.passed
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700"
                      : "bg-amber-50 border-amber-500 text-amber-700"
                  }`}>
                    {simulatorResult.percentage}%
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mt-3">
                    {simulatorResult.pending ? `⏳ ${t("pex.pending")}` : simulatorResult.passed ? t("ex.passed") : t("ex.recorded")}
                  </h3>

                  <div className="flex items-center justify-center gap-4 text-xs mt-2 text-slate-600 font-medium">
                    <span>To&apos;plangan ball: <strong className="text-slate-900 font-bold">{simulatorResult.score} / {simulatorResult.maxScore}</strong></span>
                    <span>{t("ex.correctAnswers")} <strong className="text-slate-900 font-bold">{simulatorResult.earnedPoints} / {simulatorResult.totalPoints}</strong></span>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-2">
                    {t("ex.savedNote")}
                  </p>
                </div>

                {/* Question by question, with grading of written answers */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    {t("ex.review")}
                  </h4>
                  <div className="max-h-[420px] overflow-y-auto pr-1">
                    <ExamAttemptReview examId={simulatorExam.id} attemptId={simulatorResult.attempt.id} onChanged={load} />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setSimulatorExam(null)}
                    className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {attemptsExam && (
        <ExamAttemptsModal
          exam={exams.find((e) => e.id === attemptsExam.id) ?? attemptsExam}
          onClose={() => setAttemptsExam(null)}
          onChanged={load}
        />
      )}
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
