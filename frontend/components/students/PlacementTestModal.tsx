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
import type { TranslationKey } from "@/lib/i18n";
import { extractUniqueSubjects, matchesSubject } from "@/lib/subject";
import { formatDateTime } from "@/lib/format-date";
import { placementLevelName, placementLink } from "@/lib/placement";

const ACCENT = "#4F46E5";
type Level = "" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
type Created = PlacementTestSummary & { questions: PlacementQuestion[] };
type Draft = PlacementQuestion & { include: boolean };

const TYPE_KEYS: Record<PlacementQuestion["type"], TranslationKey> = {
  MCQ: "placement.typeMcq",
  TRUE_FALSE: "placement.typeTf",
  SHORT_ANSWER: "placement.typeShort",
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const hasAnswer = (q: PlacementQuestion) =>
  q.type === "SHORT_ANSWER" ? Boolean(q.answer?.trim()) : q.correctIndex !== null && q.correctIndex !== undefined;

// Level test for new students. The center creates it (AI or from a PDF),
// shares the link, and the student solves it on their own phone or
// computer; results show up in the "Tests & results" tab.
export default function PlacementTestModal({ groups, onClose }: { groups: Group[]; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const subjects = useMemo(() => extractUniqueSubjects(groups), [groups]);
  const [tab, setTab] = useState<"new" | "list">("new");

  // ---- new test ----
  const [source, setSource] = useState<"ai" | "pdf">("ai");
  const [subject, setSubject] = useState(subjects[0] ?? "");
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState("");
  const [level, setLevel] = useState<Level>("");
  const [count, setCount] = useState("15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
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
      else setDrafts(res.questions.map((q) => ({ ...q, include: true })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const chosen = (drafts ?? []).filter((q) => q.include);
  const missing = chosen.filter((q) => !hasAnswer(q)).length;
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
        questions: chosen.map(({ include: _i, ...q }) => q),
      });
      setCreated(res);
      setDrafts(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function resetNew() {
    setCreated(null);
    setDrafts(null);
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
    const w = window.open("", "_blank");
    if (!w) return;
    const items = test.questions
      .map((q, i) => {
        const body =
          q.type === "SHORT_ANSWER"
            ? `<p class="line">______________________________</p>`
            : `<ol type="A">${q.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>`;
        return `<li><p><b>${i + 1}.</b> ${esc(q.prompt)}</p>${body}</li>`;
      })
      .join("");
    const key = test.questions
      .map((q, i) => `${i + 1}) ${q.type === "SHORT_ANSWER" ? esc((q.answer ?? "").split("|")[0]) : q.type === "TRUE_FALSE" ? esc(q.options[q.correctIndex ?? 0]) : "ABCD"[q.correctIndex ?? 0]}`)
      .join(" &nbsp; ");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(test.title)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:28px;color:#181A1F}h1{font-size:20px}ul{list-style:none;padding:0}li{margin-bottom:12px}ol[type=A]{margin-top:4px}.line{color:#999}.key{margin-top:40px;page-break-before:always;font-size:12px;color:#555}</style>
      </head><body><h1>${esc(test.title)}</h1>
      <p>${esc(t("placement.studentName"))}: ______________________ &nbsp; ${esc(t("placement.date"))}: ____________</p>
      <ul>${items}</ul><div class="key"><b>${esc(t("placement.answerKey"))}:</b> ${key}</div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  // ---- tests & results ----
  const [tests, setTests] = useState<PlacementTestSummary[] | null>(null);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, PlacementAttempt[]>>({});

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

  async function toggleActive(test: PlacementTestSummary) {
    const updated = await placementApi.setActive(test.id, !test.active).catch(() => null);
    if (updated) setTests((list) => list && list.map((x) => (x.id === test.id ? { ...x, active: updated.active } : x)));
  }

  const tabBtn = (key: "new" | "list", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: tab === key ? "#fff" : "transparent", color: tab === key ? "#181A1F" : "#8A8D96", boxShadow: tab === key ? "0 1px 3px rgba(18,19,26,0.08)" : "none" }}
    >
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={`🧭 ${t("placement.title")}`} width={780}>
      <div style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 10, marginBottom: 16 }}>
        {tabBtn("new", t("placement.tabNew"))}
        {tabBtn("list", t("placement.tabList"))}
      </div>

      {tab === "new" && !created && !drafts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.5 }}>{t("placement.introLink")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["ai", "pdf"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: `1.5px solid ${source === s ? ACCENT : "#EAE8E2"}`, background: source === s ? "#EEF0FF" : "#fff", color: source === s ? ACCENT : "#4A4E58" }}
              >
                {s === "ai" ? t("placement.sourceAiBtn") : t("placement.sourcePdfBtn")}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
          {source === "ai" && <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("placement.mixedHint")}</div>}
          {source === "pdf" && <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("placement.pdfHint")}</div>}
          {error && <div role="alert" style={alertStyle}>{error}</div>}
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onPdf(e.target.files?.[0])} />
          <button
            type="button"
            className="btn"
            disabled={busy || !subject}
            onClick={() => (source === "ai" ? generate() : fileRef.current?.click())}
            style={{ background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, opacity: !subject ? 0.6 : 1 }}
          >
            {busy ? t("placement.generating") : source === "ai" ? `✨ ${t("placement.generate")}` : `📄 ${t("placement.pickPdf")}`}
          </button>
        </div>
      )}

      {tab === "new" && drafts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "#4A4E58" }}>
            {t("pdfq.found")}: {drafts.length} · {t("pdfq.selected")}: {chosen.length}
          </div>
          {missing > 0 && <div style={{ ...alertStyle, background: "#FFFBEB", color: "#92400E" }}>{t("pdfq.missing")} ({missing})</div>}
          {error && <div role="alert" style={alertStyle}>{error}</div>}
          <div style={{ maxHeight: 440, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {drafts.map((q, i) => {
              const noAnswer = q.include && !hasAnswer(q);
              return (
                <div key={i} style={{ border: `1px solid ${noAnswer ? "#FCD34D" : "#EAE8E2"}`, background: noAnswer ? "#FFFBEB" : "#fff", borderRadius: 10, padding: 10, opacity: q.include ? 1 : 0.5 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={q.include} onChange={(e) => updateDraft(i, { include: e.target.checked })} style={{ marginTop: 3, accentColor: ACCENT }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                        {i + 1}. {q.prompt} <TypeBadge label={t(TYPE_KEYS[q.type])} />
                      </div>
                      {q.type === "SHORT_ANSWER" ? (
                        <input className="field-input" value={q.answer ?? ""} onChange={(e) => updateDraft(i, { answer: e.target.value })} placeholder={t("pdfq.shortAnswerPh")} style={{ height: 36, fontSize: 13 }} />
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {q.options.map((o, oi) => (
                            <button key={oi} type="button" onClick={() => updateDraft(i, { correctIndex: oi })} style={optionStyle(q.correctIndex === oi)}>
                              {q.type === "MCQ" && <b style={{ marginRight: 6 }}>{"ABCDEFGH"[oi]}.</b>}
                              {o}
                              {q.correctIndex === oi && " ✓"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
              <input readOnly value={placementLink(created.token)} className="field-input" style={{ flex: 1, minWidth: 220, height: 38, fontSize: 13, background: "#fff" }} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => copy(placementLink(created.token))} style={primary}>{copied ? `✓ ${t("placement.copied")}` : t("placement.copyLink")}</button>
              <a className="btn" href={`https://t.me/share/url?url=${encodeURIComponent(placementLink(created.token))}&text=${encodeURIComponent(created.title)}`} target="_blank" rel="noreferrer" style={{ ...ghost, textDecoration: "none" }}>
                ✈️ Telegram
              </a>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, color: "#4A4E58" }}>
              <b>{created.title}</b> · {created.questions.length} {t("placement.questions")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => print(created)} style={ghost}>🖨 {t("placement.print")}</button>
              <button type="button" className="btn" onClick={resetNew} style={ghost}>+ {t("placement.newTest")}</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("placement.teacherView")}</div>
          <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {created.questions.map((q, i) => (
              <div key={i} style={{ fontSize: 13.5 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {i + 1}. {q.prompt} <TypeBadge label={t(TYPE_KEYS[q.type])} /> <span style={{ fontSize: 11, color: "#8A8D96" }}>· {levelName(q.level, created.subject)}</span>
                </div>
                {q.type === "SHORT_ANSWER" ? (
                  <div style={{ ...optionStyle(true), display: "inline-block" }}>{t("placement.answer")}: {(q.answer ?? "").split("|").join(" / ")}</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {q.options.map((o, oi) => (
                      <div key={oi} style={optionStyle(q.correctIndex === oi)}>
                        {q.type === "MCQ" && <b style={{ marginRight: 6 }}>{"ABCDEFGH"[oi]}.</b>}
                        {o}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto" }}>
          {tests === null ? (
            <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
          ) : tests.length === 0 ? (
            <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("placement.noTests")}</div>
          ) : (
            tests.map((x) => (
              <div key={x.id} style={{ border: "1px solid #EAE8E2", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => toggleOpen(x.id)} style={{ flex: 1, minWidth: 200, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#181A1F" }}>{openTest === x.id ? "▾" : "▸"} {x.title}</div>
                    <div style={{ fontSize: 12, color: "#8A8D96" }}>
                      {x.subject} · {x.questionCount} {t("placement.questions")} · {formatDateTime(x.createdAt, lang)}
                    </div>
                  </button>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "#EEF0FF", padding: "3px 10px", borderRadius: 999 }}>
                    {x.attempts ?? 0} {t("placement.results")}
                  </span>
                  <button type="button" className="btn" onClick={() => copy(placementLink(x.token))} style={{ ...ghost, padding: "6px 10px" }} disabled={!x.active}>
                    🔗 {t("placement.copyLink")}
                  </button>
                  <button type="button" className="btn" onClick={() => toggleActive(x)} style={{ ...ghost, padding: "6px 10px", color: x.active ? "#B23A47" : "#1FA463" }}>
                    {x.active ? t("placement.close") : t("placement.reopen")}
                  </button>
                </div>
                {openTest === x.id && (
                  <div style={{ borderTop: "1px solid #F2F1EC", padding: "8px 12px 12px" }}>
                    {!attempts[x.id] ? (
                      <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("common.loading")}</div>
                    ) : attempts[x.id].length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("placement.noResults")}</div>
                    ) : (
                      <table className="table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>{t("placement.studentName")}</th>
                            <th>{t("placement.phone")}</th>
                            <th style={{ textAlign: "right" }}>{t("placement.score")}</th>
                            <th>{t("placement.suggested")}</th>
                            <th>{t("placement.date")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attempts[x.id].map((a) => (
                            <tr key={a.id}>
                              <td style={{ fontWeight: 600 }}>{a.fullName}</td>
                              <td>{a.phone || "—"}</td>
                              <td style={{ textAlign: "right", fontWeight: 800, color: a.percent >= 80 ? "#1FA463" : a.percent >= 50 ? "#D97706" : "#B23A47" }}>
                                {a.percent}% <span style={{ fontWeight: 500, color: "#8A8D96" }}>({a.correct}/{a.total})</span>
                              </td>
                              <td>{levelName(a.suggestedLevel, x.subject)}</td>
                              <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(a.createdAt, lang)}</td>
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
          {copied && <div style={{ fontSize: 12, color: "#1FA463", fontWeight: 700 }}>✓ {t("placement.copied")}</div>}
        </div>
      )}
    </Modal>
  );
}

function TypeBadge({ label }: { label: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: "#6D28D9", background: "#F5F3FF", padding: "2px 7px", borderRadius: 999, marginLeft: 4, verticalAlign: "middle" }}>{label}</span>;
}

const optionStyle = (right: boolean): React.CSSProperties => ({
  textAlign: "left",
  fontSize: 13,
  padding: "7px 10px",
  borderRadius: 8,
  cursor: "pointer",
  border: `1px solid ${right ? "#1FA463" : "#EAE8E2"}`,
  background: right ? "#E8F7EF" : "#fff",
  color: "#181A1F",
  fontWeight: right ? 700 : 500,
});
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, cursor: "pointer" };
const primary: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer" };
const alertStyle: React.CSSProperties = { background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 };
