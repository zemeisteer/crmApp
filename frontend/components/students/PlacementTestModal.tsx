"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { aiApi, ApiError, type Group, type PlacementQuestion } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { extractUniqueSubjects, matchesSubject } from "@/lib/subject";

const ACCENT = "#4F46E5";
type Level = "" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Level test for a new student: pick a direction (or a group), level and
// size, generate the questions (AI when configured), let the student answer
// on screen or print it, then get a suggested level and matching groups.
export default function PlacementTestModal({ groups, onClose }: { groups: Group[]; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const subjects = useMemo(() => extractUniqueSubjects(groups), [groups]);
  const [subject, setSubject] = useState(subjects[0] ?? "");
  const [groupId, setGroupId] = useState("");
  const [level, setLevel] = useState<Level>("");
  const [count, setCount] = useState("15");
  const [studentName, setStudentName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PlacementQuestion[] | null>(null);
  const [source, setSource] = useState<"ai" | "bank">("bank");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);

  const groupsOfSubject = groups.filter((g) => !subject || matchesSubject(g.subject, subject));

  async function generate() {
    setError(null);
    setLoading(true);
    try {
      const res = await aiApi.placementTest({ subject, groupId: groupId || undefined, level: level || undefined, count: Number(count), language: lang });
      setQuestions(res.questions);
      setSource(res.source);
      setAnswers({});
      setChecked(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  const result = useMemo(() => {
    if (!questions || !checked) return null;
    const byLevel = [1, 2, 3].map((l) => {
      const qs = questions.map((q, i) => ({ q, i })).filter(({ q }) => q.level === l);
      const right = qs.filter(({ q, i }) => answers[i] === q.correctIndex).length;
      return { total: qs.length, right, pct: qs.length ? Math.round((right / qs.length) * 100) : null };
    });
    const right = questions.filter((q, i) => answers[i] === q.correctIndex).length;
    const ok = (x: { pct: number | null }, min: number) => x.pct === null || x.pct >= min;
    const suggested = ok(byLevel[2], 60) && ok(byLevel[1], 70) && byLevel[2].total > 0 ? 3 : ok(byLevel[1], 60) && ok(byLevel[0], 70) && byLevel[1].total > 0 ? 2 : 1;
    return { right, total: questions.length, pct: Math.round((right / questions.length) * 100), byLevel, suggested };
  }, [questions, answers, checked]);

  const isEnglish = /ingliz|english|ielts/i.test(subject);
  const levelName = (l: number) =>
    isEnglish
      ? [t("placement.lvlEn1"), t("placement.lvlEn2"), t("placement.lvlEn3")][l - 1]
      : [t("placement.lvl1"), t("placement.lvl2"), t("placement.lvl3")][l - 1];

  function print() {
    if (!questions) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const items = questions
      .map((q, i) => `<li><p>${esc(q.prompt)}</p><ol type="A">${q.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol></li>`)
      .join("");
    const key = questions.map((q, i) => `${i + 1}-${"ABCD"[q.correctIndex]}`).join(", ");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t("placement.title"))}</title>
      <style>body{font-family:system-ui,sans-serif;padding:28px;color:#181A1F}h1{font-size:20px}li{margin-bottom:10px}ol[type=A]{margin-top:4px}.key{margin-top:40px;page-break-before:always;font-size:12px;color:#555}</style>
      </head><body><h1>${esc(t("placement.title"))}: ${esc(subject)}</h1>
      <p>${esc(t("placement.studentName"))}: ${esc(studentName) || "______________________"} &nbsp; ${esc(t("placement.date"))}: ____________</p>
      <ol>${items}</ol><div class="key"><b>${esc(t("placement.answerKey"))}:</b> ${key}</div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Modal open onClose={onClose} title={`🧭 ${t("placement.title")}`} width={760}>
      {!questions ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.5 }}>{t("placement.intro")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={lbl}>{t("placement.direction")}</div>
              <Select value={subject} onChange={(v) => { setSubject(v); setGroupId(""); }} options={subjects.map((s) => ({ value: s, label: s }))} placeholder={t("placement.direction")} />
            </div>
            <div>
              <div style={lbl}>{t("placement.group")}</div>
              <Select value={groupId} onChange={setGroupId} options={[{ value: "", label: t("placement.anyGroup") }, ...groupsOfSubject.map((g) => ({ value: g.id, label: `${g.name}${g.level ? ` · ${g.level}` : ""}` }))]} />
            </div>
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
              <Select value={count} onChange={setCount} options={["10", "15", "20", "25"].map((n) => ({ value: n, label: n }))} />
            </div>
          </div>
          <div>
            <div style={lbl}>{t("placement.studentName")}</div>
            <input className="field-input" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder={t("placement.studentNameHint")} />
          </div>
          {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
          <button type="button" className="btn" disabled={loading || !subject} onClick={generate} style={{ background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, opacity: !subject ? 0.6 : 1 }}>
            {loading ? t("placement.generating") : `✨ ${t("placement.generate")}`}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "#4A4E58" }}>
              <b>{subject}</b> · {questions.length} {t("placement.questions")} · {source === "ai" ? t("placement.sourceAi") : t("placement.sourceBank")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setQuestions(null)} style={ghost}>← {t("placement.back")}</button>
              <button type="button" className="btn" onClick={print} style={ghost}>🖨 {t("placement.print")}</button>
            </div>
          </div>

          {result && (
            <div style={{ borderRadius: 14, padding: 16, background: "linear-gradient(135deg, #EEF0FF, #F5F3FF)", border: "1px solid #DDD6FE" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 26, color: ACCENT }}>{result.pct}%</div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{result.right} / {result.total} {t("placement.correct")}</div>
                <div style={{ marginLeft: "auto", fontSize: 13.5 }}>
                  {t("placement.suggested")}: <b style={{ color: ACCENT }}>{levelName(result.suggested)}</b>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {result.byLevel.map((b, i) => b.total > 0 && (
                  <span key={i} style={{ fontSize: 12, fontWeight: 600, background: "#fff", padding: "4px 10px", borderRadius: 999 }}>
                    {levelName(i + 1)}: {b.right}/{b.total}
                  </span>
                ))}
              </div>
              {groupsOfSubject.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{t("placement.groupsFor")} {subject}:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {groupsOfSubject.map((g) => (
                      <Link key={g.id} href={`/groups/${g.id}`} style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "#fff", border: "1px solid #DDD6FE", padding: "5px 10px", borderRadius: 8, textDecoration: "none" }}>
                        {g.name}{g.level ? ` · ${g.level}` : ""}{g.startTime ? ` · ${g.startTime}` : ""}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, maxHeight: 420, overflowY: "auto" }}>
            {questions.map((q, i) => (
              <li key={i} style={{ fontSize: 13.5 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{q.prompt}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {q.options.map((o, oi) => {
                    const picked = answers[i] === oi;
                    const right = checked && oi === q.correctIndex;
                    const wrong = checked && picked && oi !== q.correctIndex;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={checked}
                        onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                        style={{
                          textAlign: "left", fontSize: 13, padding: "8px 10px", borderRadius: 8, cursor: checked ? "default" : "pointer",
                          border: `1px solid ${right ? "#1FA463" : wrong ? "#B23A47" : picked ? ACCENT : "#EAE8E2"}`,
                          background: right ? "#E8F7EF" : wrong ? "#FDEBEC" : picked ? "#EEF0FF" : "#fff",
                          color: "#181A1F",
                        }}
                      >
                        <b style={{ marginRight: 6 }}>{"ABCD"[oi]}.</b>{o}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>

          {!checked ? (
            <button type="button" className="btn" onClick={() => setChecked(true)} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}>
              {t("placement.check")} ({Object.keys(answers).length}/{questions.length})
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => { setAnswers({}); setChecked(false); }} style={ghost}>
              {t("placement.retry")}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8 };
