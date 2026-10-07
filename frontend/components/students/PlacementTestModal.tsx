"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import {
  ApiError,
  placementApi,
  type Group,
  type PlacementAttempt,
  type PlacementQuestion,
  type PlacementTestSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { extractUniqueSubjects, matchesSubject } from "@/lib/subject";
import { formatDateTime } from "@/lib/format-date";
import { placementLevelName, placementLink, placementShareText, telegramShareUrl } from "@/lib/placement";
import { useAuth } from "@/lib/auth-context";
import { hasAnswer, type TestQuestion } from "@/lib/tests";
import { printTest } from "@/lib/print-test";
import QuestionList from "@/components/tests/QuestionView";
import QuestionEditor, { emptyQuestion } from "@/components/tests/QuestionEditor";
import PlacementAttemptModal from "@/components/students/PlacementAttemptModal";

const ACCENT = "#4F46E5";
type Level = "" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
type Created = PlacementTestSummary & { questions: PlacementQuestion[] };
type Draft = TestQuestion & { include: boolean };

// Level test for new students. The center creates it (AI, from a PDF or by
// hand), shares the link, and the student solves it on their own phone or
// computer; results show up in the "Tests & results" tab.
export default function PlacementTestModal({ groups, onClose }: { groups: Group[]; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const { tenant } = useAuth();
  const linkOf = (token: string) => placementLink(token, tenant?.subdomain);
  const telegramOf = (x: { token: string; title: string; subject: string }, questionCount?: number) =>
    telegramShareUrl(linkOf(x.token), placementShareText({ centerName: tenant?.name, title: x.title, subject: x.subject, questionCount }, t));
  const subjects = useMemo(() => extractUniqueSubjects(groups), [groups]);
  const [tab, setTab] = useState<"new" | "list">("new");

  // ---- new test ----
  const [source, setSource] = useState<"ai" | "pdf" | "manual">("ai");
  const [subject, setSubject] = useState(subjects[0] ?? "");
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState("");
  const [level, setLevel] = useState<Level>("");
  const [count, setCount] = useState("15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const groupsOfSubject = groups.filter((g) => !subject || matchesSubject(g.subject, subject));
  const levelName = (l: number, subj = subject) => placementLevelName(subj, l, t);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const res = await placementApi.create({
        subject,
        title: title.trim() || undefined,
        groupId: groupId || undefined,
        level: level || undefined,
        count: Number(count),
        language: lang,
      });
      setCreated(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function onPdf(file?: File) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const res = await placementApi.parsePdf(file);
      if (res.questions.length === 0) setError(t("pdfq.none"));
      else {
        setDrafts(res.questions.map((q) => ({ ...q, include: true })));
        setEditing(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function startManual() {
    setError(null);
    setDrafts([{ ...emptyQuestion("MCQ"), level: 1, include: true }]);
    setEditing(0);
  }

  function addDraft() {
    const list = drafts ?? [];
    const last = list[list.length - 1];
    // A new question continues the current section.
    const next: Draft = {
      ...emptyQuestion(last?.type ?? "MCQ"),
      section: last?.section,
      instruction: last?.instruction,
      passage: last?.passage,
      level: last?.level ?? 1,
      include: true,
    };
    setDrafts([...list, next]);
    setEditing(list.length);
  }

  const chosen = (drafts ?? []).filter((q) => q.include);
  const missing = chosen.filter((q) => !hasAnswer(q) || !(q.prompt.trim() || q.type === "MATCHING")).length;
  const updateDraft = (i: number, patch: Partial<Draft>) => setDrafts((d) => d && d.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function saveDrafts() {
    if (chosen.length === 0 || missing > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await placementApi.create({
        subject,
        title: title.trim() || undefined,
        language: lang,
        questions: chosen.map(({ include: _i, ...q }) => ({ ...q, level: q.level ?? 1 })),
      });
      setCreated(res);
      setDrafts(null);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function resetNew() {
    setCreated(null);
    setDrafts(null);
    setEditing(null);
    setError(null);
    setCopied(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t("placement.copyManual"), text);
    }
  }

  function print(test: Created) {
    printTest(test.title, test.questions, {
      name: t("placement.studentName"),
      date: t("placement.date"),
      key: t("placement.answerKey"),
      tf: { true: t("pt.true"), false: t("pt.false"), ng: t("qt.notGiven") },
    });
  }

  // ---- tests & results ----
  const [tests, setTests] = useState<PlacementTestSummary[] | null>(null);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, PlacementAttempt[]>>({});
  const [review, setReview] = useState<{ test: PlacementTestSummary; attemptId: string } | null>(null);

  useEffect(() => {
    if (tab !== "list") return;
    placementApi.list().then(setTests).catch(() => setTests([]));
  }, [tab, created]);

  async function toggleOpen(id: string) {
    setOpenTest((cur) => (cur === id ? null : id));
    if (!attempts[id]) {
      const rows = await placementApi.attempts(id).catch(() => []);
      setAttempts((a) => ({ ...a, [id]: rows }));
    }
  }

  async function reloadAttempts(id: string) {
    const rows = await placementApi.attempts(id).catch(() => null);
    if (rows) setAttempts((a) => ({ ...a, [id]: rows }));
    placementApi.list().then(setTests).catch(() => undefined);
  }

  async function rename(test: PlacementTestSummary) {
    const next = window.prompt(t("placement.renamePrompt"), test.title)?.trim();
    if (!next || next === test.title) return;
    const updated = await placementApi.rename(test.id, next).catch(() => null);
    if (updated) setTests((list) => list && list.map((x) => (x.id === test.id ? { ...x, title: updated.title } : x)));
  }

  async function toggleActive(test: PlacementTestSummary) {
    const updated = await placementApi.setActive(test.id, !test.active).catch(() => null);
    if (updated) setTests((list) => list && list.map((x) => (x.id === test.id ? { ...x, active: updated.active } : x)));
  }

  const tabBtn = (key: "new" | "list", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: tab === key ? "#fff" : "transparent", color: tab === key ? "#181A1F" : "#686B75", boxShadow: tab === key ? "0 1px 3px rgba(18,19,26,0.08)" : "none" }}
    >
      {label}
    </button>
  );

  const sourceLabel = { ai: t("placement.sourceAiBtn"), pdf: t("placement.sourcePdfBtn"), manual: t("placement.sourceManualBtn") };

  return (
    <Modal open onClose={onClose} title={`🧭 ${t("placement.title")}`} width={820}>
      <div style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 10, marginBottom: 16 }}>
        {tabBtn("new", t("placement.tabNew"))}
        {tabBtn("list", t("placement.tabList"))}
      </div>

      {tab === "new" && !created && !drafts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.5 }}>{t("placement.introLink")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["ai", "pdf", "manual"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                style={{ flex: 1, minWidth: 140, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: `1.5px solid ${source === s ? ACCENT : "#EAE8E2"}`, background: source === s ? "#EEF0FF" : "#fff", color: source === s ? ACCENT : "#4A4E58" }}
              >
                {sourceLabel[s]}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div>
              <div style={lbl}>{t("placement.direction")}</div>
              <Select value={subject} onChange={(v) => { setSubject(v); setGroupId(""); }} options={subjects.map((s) => ({ value: s, label: s }))} placeholder={t("placement.direction")} />
            </div>
            <div>
              <div style={lbl}>{t("placement.testTitle")}</div>
              <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={subject ? `${subject} — ${t("placement.title")}` : ""} />
            </div>
            {source === "ai" && (
              <>
                <div>
                  <div style={lbl}>{t("placement.group")}</div>
                  <Select value={groupId} onChange={setGroupId} options={[{ value: "", label: t("placement.anyGroup") }, ...groupsOfSubject.map((g) => ({ value: g.id, label: `${g.name}${g.level ? ` · ${g.level}` : ""}` }))]} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px", gap: 10 }}>
                  <div>
                    <div style={lbl}>{t("placement.expectedLevel")}</div>
                    <Select
                      value={level}
                      onChange={(v) => setLevel(v as Level)}
                      options={[
                        { value: "", label: t("placement.unknownLevel") },
                        { value: "BEGINNER", label: levelName(1) },
                        { value: "INTERMEDIATE", label: levelName(2) },
                        { value: "ADVANCED", label: levelName(3) },
                      ]}
                    />
                  </div>
                  <div>
                    <div style={lbl}>{t("placement.count")}</div>
                    <Select value={count} onChange={setCount} options={["10", "15", "20", "25", "30"].map((n) => ({ value: n, label: n }))} />
                  </div>
                </div>
              </>
            )}
          </div>
          {source === "ai" && <div style={{ fontSize: 12, color: "#686B75" }}>{t("placement.mixedHint")}</div>}
          {source === "pdf" && <div style={{ fontSize: 12, color: "#686B75" }}>{t("placement.pdfHint")}</div>}
          {source === "manual" && <div style={{ fontSize: 12, color: "#686B75" }}>{t("placement.manualHint")}</div>}
          {error && <div role="alert" style={alertStyle}>{error}</div>}
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onPdf(e.target.files?.[0])} />
          <button
            type="button"
            className="btn"
            disabled={busy || !subject}
            onClick={() => (source === "ai" ? generate() : source === "pdf" ? fileRef.current?.click() : startManual())}
            style={{ background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, opacity: !subject ? 0.6 : 1 }}
          >
            {busy
              ? source === "pdf"
                ? t("pdfq.reading")
                : t("placement.generating")
              : source === "ai"
                ? `✨ ${t("placement.generate")}`
                : source === "pdf"
                  ? `📄 ${t("placement.pickPdf")}`
                  : `✍️ ${t("placement.startManual")}`}
          </button>
        </div>
      )}

      {tab === "new" && drafts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={lbl}>{t("placement.testTitle")}</div>
              <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={subject ? `${subject} — ${t("placement.title")}` : ""} />
            </div>
            <div style={{ fontSize: 12.5, color: "#4A4E58", alignSelf: "flex-end", paddingBottom: 8 }}>
              {t("pdfq.found")}: <b>{drafts.length}</b> · {t("pdfq.selected")}: <b>{chosen.length}</b> · {t("pdfq.pts")}: <b>{chosen.reduce((s, q) => s + q.points, 0)}</b>
            </div>
          </div>
          {missing > 0 && <div style={{ ...alertStyle, background: "#FFFBEB", color: "#92400E" }}>{t("pdfq.missing")} ({missing})</div>}
          {error && <div role="alert" style={alertStyle}>{error}</div>}
          <div style={{ maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
            <QuestionList
              questions={drafts}
              itemStyle={(q, i) => {
                const noAnswer = drafts[i].include && !hasAnswer(q);
                return { opacity: drafts[i].include ? 1 : 0.5, borderColor: editing === i ? ACCENT : noAnswer ? "#FCD34D" : "#E2E8F0", background: noAnswer && editing !== i ? "#FFFBEB" : "#fff" };
              }}
              meta={(q) => <span style={{ fontSize: 11, color: "#94A3B8" }}> · {levelName(q.level ?? 1)}</span>}
              renderItem={(q, i) => (editing === i ? <QuestionEditor value={q} showLevel onChange={(nq) => updateDraft(i, nq)} /> : null)}
              aside={(_q, i) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" aria-label={t("pdfq.selected")} checked={drafts[i].include} onChange={(e) => updateDraft(i, { include: e.target.checked })} style={{ accentColor: ACCENT, width: 16, height: 16 }} />
                  <button type="button" title={t("common.edit")} onClick={() => setEditing(editing === i ? null : i)} style={iconBtn(editing === i)}>
                    {editing === i ? "✓" : "✎"}
                  </button>
                  <button
                    type="button"
                    title={t("common.delete")}
                    onClick={() => {
                      setDrafts((d) => d && d.filter((_, j) => j !== i));
                      setEditing(null);
                    }}
                    style={iconBtn(false)}
                  >
                    🗑
                  </button>
                </div>
              )}
            />
            <button type="button" onClick={addDraft} style={{ ...ghost, width: "100%", marginTop: 10, borderStyle: "dashed", color: ACCENT }}>
              + {t("placement.addQuestion")}
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button type="button" className="btn" onClick={resetNew} style={ghost}>← {t("placement.back")}</button>
            <button type="button" className="btn" disabled={busy || chosen.length === 0 || missing > 0} onClick={saveDrafts} style={{ ...primary, opacity: busy || missing > 0 ? 0.6 : 1 }}>
              {busy ? t("common.saving") : `${t("placement.saveTest")} (${chosen.length})`}
            </button>
          </div>
        </div>
      )}

      {tab === "new" && created && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderRadius: 14, padding: 16, background: "linear-gradient(135deg, #EEF0FF, #F5F3FF)", border: "1px solid #DDD6FE" }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>✅ {t("placement.readyTitle")}</div>
            <div style={{ fontSize: 12.5, color: "#4A4E58", marginBottom: 10 }}>{t("placement.readyHint")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input readOnly value={linkOf(created.token)} className="field-input" style={{ flex: 1, minWidth: 220, height: 38, fontSize: 13, background: "#fff" }} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => copy(linkOf(created.token))} style={primary}>{copied ? `✓ ${t("placement.copied")}` : t("placement.copyLink")}</button>
              <a className="btn" href={telegramOf(created, created.questions.length)} target="_blank" rel="noreferrer" style={{ ...ghost, textDecoration: "none" }}>
                ✈️ Telegram
              </a>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "#4A4E58" }}>
              <b>{created.title}</b> · {created.questions.length} {t("placement.questions")} · {created.questions.reduce((s, q) => s + q.points, 0)} {t("pdfq.pts")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => print(created)} style={ghost}>🖨 {t("placement.print")}</button>
              <button type="button" className="btn" onClick={resetNew} style={ghost}>+ {t("placement.newTest")}</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#686B75" }}>{t("placement.teacherView")}</div>
          <div style={{ maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
            <QuestionList questions={created.questions} meta={(q) => <span style={{ fontSize: 11, color: "#94A3B8" }}> · {levelName(q.level ?? 1, created.subject)}</span>} />
          </div>
        </div>
      )}

      {tab === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 540, overflowY: "auto" }}>
          {tests === null ? (
            <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
          ) : tests.length === 0 ? (
            <div style={{ fontSize: 13, color: "#686B75" }}>{t("placement.noTests")}</div>
          ) : (
            tests.map((x) => (
              <div key={x.id} style={{ border: "1px solid #EAE8E2", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => toggleOpen(x.id)} style={{ flex: 1, minWidth: 200, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#181A1F" }}>
                      {openTest === x.id ? "▾" : "▸"} {x.title}
                      {(x.pending ?? 0) > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "2px 8px", borderRadius: 999 }}>
                          ⏳ {x.pending} {t("placement.toReview")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#686B75" }}>
                      {x.subject} · {x.questionCount} {t("placement.questions")} · {formatDateTime(x.createdAt, lang)}
                    </div>
                  </button>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "#EEF0FF", padding: "3px 10px", borderRadius: 999 }}>
                    {x.attempts ?? 0} {t("placement.results")}
                  </span>
                  <button type="button" className="btn" onClick={() => rename(x)} style={{ ...ghost, padding: "6px 10px" }} title={t("placement.rename")}>
                    ✎
                  </button>
                  <button type="button" className="btn" onClick={() => copy(linkOf(x.token))} style={{ ...ghost, padding: "6px 10px" }} disabled={!x.active}>
                    🔗 {t("placement.copyLink")}
                  </button>
                  {x.active && (
                    <a className="btn" href={telegramOf(x, x.questionCount)} target="_blank" rel="noreferrer" style={{ ...ghost, padding: "6px 10px", textDecoration: "none" }}>
                      ✈️ Telegram
                    </a>
                  )}
                  <button type="button" className="btn" onClick={() => toggleActive(x)} style={{ ...ghost, padding: "6px 10px", color: x.active ? "#B23A47" : "#1FA463" }}>
                    {x.active ? t("placement.close") : t("placement.reopen")}
                  </button>
                </div>
                {openTest === x.id && (
                  <div style={{ borderTop: "1px solid #F2F1EC", padding: "8px 12px 12px", overflowX: "auto" }}>
                    {!attempts[x.id] ? (
                      <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("common.loading")}</div>
                    ) : attempts[x.id].length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("placement.noResults")}</div>
                    ) : (
                      <table className="table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>{t("placement.studentName")}</th>
                            <th>{t("placement.phone")}</th>
                            <th style={{ textAlign: "right" }}>{t("placement.score")}</th>
                            <th>{t("placement.suggested")}</th>
                            <th>{t("placement.date")}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {attempts[x.id].map((a) => (
                            <tr key={a.id}>
                              <td style={{ fontWeight: 600 }}>{a.fullName}</td>
                              <td>{a.phone || "—"}</td>
                              <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: a.percent >= 80 ? "#1FA463" : a.percent >= 50 ? "#D97706" : "#B23A47" }}>
                                {a.percent}% <span style={{ fontWeight: 500, color: "#686B75" }}>({a.correct}/{a.total})</span>
                              </td>
                              <td>{a.reviewStatus === "PENDING" ? "—" : levelName(a.suggestedLevel, x.subject)}</td>
                              <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(a.createdAt, lang)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => setReview({ test: x, attemptId: a.id })}
                                  style={{ ...ghost, padding: "4px 10px", whiteSpace: "nowrap", ...(a.reviewStatus === "PENDING" ? { background: "#FEF3C7", borderColor: "#FCD34D", color: "#92400E" } : {}) }}
                                >
                                  {a.reviewStatus === "PENDING" ? `⏳ ${t("review.check")}` : t("placement.details")}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {copied && <div style={{ fontSize: 12, color: "#167A48", fontWeight: 700 }}>✓ {t("placement.copied")}</div>}
        </div>
      )}
      {review && (
        <PlacementAttemptModal test={review.test} attemptId={review.attemptId} onClose={() => setReview(null)} onChanged={() => reloadAttempts(review.test.id)} />
      )}
    </Modal>
  );
}

const iconBtn = (on: boolean): React.CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: 7,
  border: `1px solid ${on ? ACCENT : "#E2E8F0"}`,
  background: on ? "#EEF0FF" : "#fff",
  color: on ? ACCENT : "#64748B",
  cursor: "pointer",
  fontSize: 13,
});
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, cursor: "pointer" };
const primary: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer" };
const alertStyle: React.CSSProperties = { background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 };
