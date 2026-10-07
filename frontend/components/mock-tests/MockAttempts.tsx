"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import FeedbackView, { bandColor } from "@/components/mock-tests/FeedbackView";
import { SECTION_ICON, sectionKey } from "@/components/mock-tests/sections";
import { ApiError, fileUrl, MOCK_SECTIONS, mockTestsApi, type MockAttemptDetail, type MockAttemptRow, type MockTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

// Sittings of one test: bands per section, and a review window where the
// teacher reads Writing, listens to Speaking and sets or corrects the band.
export default function MockAttempts({ test }: { test: MockTest }) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<MockAttemptRow[] | null>(null);
  const [open, setOpen] = useState<MockAttemptDetail | null>(null);

  const load = useCallback(() => {
    mockTestsApi.attempts(test.id).then(setRows).catch(() => setRows([]));
  }, [test.id]);
  useEffect(load, [load]);

  // One table cell per score (never a <td> inside a <td>).
  const cell = (key: string, b: number | null | undefined, status?: string, done = true) => (
    <td key={key} style={{ textAlign: "center", fontWeight: 800, fontSize: 15, color: done ? bandColor(b) : "#C9C7C0", padding: "14px 12px", whiteSpace: "nowrap" }}>
      {!done ? "·" : b != null ? b : status === "PENDING" ? "⏳" : status === "REVIEW" ? <span style={{ fontSize: 11, color: "#B45309" }}>{t("mock.needsReview")}</span> : "—"}
    </td>
  );

  return (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      {rows === null ? (
        <div style={{ padding: 16, color: "#686B75" }}>{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#686B75" }}>{t("mock.noAttempts")}</div>
      ) : (
        <table className="table" style={{ margin: 0, minWidth: 860, width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "24%" }} />
            {MOCK_SECTIONS.map((s) => <col key={s} style={{ width: "9%" }} />)}
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: "12px 16px" }}>{t("mock.student")}</th>
              <th style={{ padding: "12px 12px" }}>{t("mock.date")}</th>
              {MOCK_SECTIONS.map((s) => (
                <th key={s} style={{ textAlign: "center", padding: "12px 8px" }} title={t(sectionKey(s))}>
                  <div style={{ fontSize: 16, lineHeight: 1 }}>{SECTION_ICON[s]}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "#686B75", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(sectionKey(s))}</div>
                </th>
              ))}
              <th style={{ textAlign: "center", padding: "12px 8px" }}>{t("mock.overall")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 700, padding: "14px 16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.studentName}>{r.studentName}</td>
                <td style={{ fontSize: 12.5, color: "#6B6E78", padding: "14px 12px" }}>
                  {formatDateTime(r.completedAt ?? r.createdAt, lang)}
                  {r.status === "IN_PROGRESS" && <div style={{ display: "inline-block", marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FEF3C7", borderRadius: 100, padding: "2px 8px" }}>{t("mock.inProgress")}</div>}
                </td>
                {MOCK_SECTIONS.map((s) => cell(s, r.results[s]?.band, r.results[s]?.status, Boolean(r.sectionDone[s])))}
                {cell("overall", r.results.overall)}
                <td style={{ textAlign: "right", padding: "10px 16px" }}><button type="button" style={ghost} onClick={async () => setOpen(await mockTestsApi.attempt(r.id))}>{t("mock.review")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <ReviewModal detail={open} onClose={() => setOpen(null)} onChanged={(d) => { setOpen(d); load(); }} />}
    </div>
  );
}

function ReviewModal({ detail, onClose, onChanged }: { detail: MockAttemptDetail; onClose: () => void; onChanged: (d: MockAttemptDetail) => void }) {
  const { t } = useLanguage();
  const c = detail.test.content;
  const w = detail.results.writing;
  const sp = detail.results.speaking;
  const [wBand, setWBand] = useState(w?.band != null ? String(w.band) : "");
  const [t1, setT1] = useState(w?.tasks?.[0]?.band != null ? String(w.tasks[0].band) : "");
  const [t2, setT2] = useState(w?.tasks?.[1]?.band != null ? String(w.tasks[1].band) : "");
  const [wComment, setWComment] = useState(w?.teacherComment ?? "");
  const [sBand, setSBand] = useState(sp?.band != null ? String(sp.band) : "");
  const [sComment, setSComment] = useState(sp?.teacherComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<MockAttemptDetail>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  return (
    <Modal open onClose={onClose} title={`${detail.student.fullName} — ${detail.test.title}`}>
      <div style={{ display: "grid", gap: 16, maxHeight: "75vh", overflowY: "auto", paddingRight: 4 }}>
        {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", padding: "8px 12px", borderRadius: 10, fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {MOCK_SECTIONS.map((s) => (
            <span key={s} style={{ background: "#F7F7F5", borderRadius: 10, padding: "6px 10px", fontSize: 13 }}>
              {SECTION_ICON[s]} {t(sectionKey(s))}: <b style={{ color: bandColor(detail.results[s]?.band) }}>{detail.results[s]?.band ?? "—"}</b>
              {detail.results[s]?.raw !== undefined && <span style={{ color: "#686B75" }}> ({detail.results[s]?.raw}/{detail.results[s]?.max})</span>}
            </span>
          ))}
          <span style={{ background: "#EEF0FF", borderRadius: 10, padding: "6px 10px", fontSize: 13, fontWeight: 800, color: ACCENT }}>{t("mock.overall")}: {detail.results.overall ?? "—"}</span>
        </div>

        {detail.sectionDone.writing && (
          <section style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>✍️ Writing {w?.gradedBy === "AI" && <span style={{ fontSize: 11, color: ACCENT }}>· AI</span>}</h3>
            {c.writing.tasks.map((task, i) => (
              <div key={i} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{task.title} · {w?.tasks?.[i]?.words ?? 0} {t("mock.words")} {w?.tasks?.[i]?.band != null && <b style={{ color: bandColor(w.tasks[i].band) }}>· {w.tasks[i].band}</b>}</div>
                <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.6, background: "#FAFAF8", borderRadius: 10, padding: 10, maxHeight: 260, overflowY: "auto" }}>{detail.answers.writing?.[String(i)] || "—"}</div>
                {w?.tasks?.[i]?.feedback && <FeedbackView fb={w.tasks[i].feedback!} />}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
              <span>Task 1</span><input className="field-input" style={{ width: 70 }} value={t1} onChange={(e) => setT1(e.target.value)} inputMode="decimal" />
              <span>Task 2</span><input className="field-input" style={{ width: 70 }} value={t2} onChange={(e) => setT2(e.target.value)} inputMode="decimal" />
              <b>{t("mock.band")}</b><input className="field-input" style={{ width: 70 }} value={wBand} onChange={(e) => setWBand(e.target.value)} inputMode="decimal" />
            </div>
            <textarea className="field-input" rows={2} placeholder={t("mock.commentPh")} value={wComment} onChange={(e) => setWComment(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={busy || num(wBand) === undefined} style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }}
                onClick={() => run(() => mockTestsApi.review(detail.id, { section: "writing", band: num(wBand)!, task1: num(t1), task2: num(t2), comment: wComment }))}>
                💾 {t("mock.saveBand")}
              </button>
              <button type="button" disabled={busy} style={ghost} onClick={() => run(() => mockTestsApi.regrade(detail.id, "writing"))}>🤖 {t("mock.aiRegrade")}</button>
            </div>
          </section>
        )}

        {detail.sectionDone.speaking && (
          <section style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>🎤 Speaking {sp?.gradedBy === "AI" && <span style={{ fontSize: 11, color: ACCENT }}>· AI</span>}</h3>
            {c.speaking.parts.map((p, pi) => (
              <div key={pi} style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{p.title}</div>
                {p.questions.map((q, qi) => {
                  const a = detail.answers.speaking?.[`${pi}.${qi}`];
                  return (
                    <div key={qi} style={{ border: "1px solid #EAE8E2", borderRadius: 10, padding: 10, fontSize: 13, display: "grid", gap: 6 }}>
                      <div style={{ color: "#4A4E58" }}>❓ {q}</div>
                      {a?.audio ? <audio controls src={fileUrl(a.audio) ?? undefined} style={{ width: "100%", height: 36 }} /> : <span style={{ color: "#686B75" }}>{t("mock.noRecording")}</span>}
                      {a?.transcript && <div style={{ fontStyle: "italic", color: "#33363D" }}>“{a.transcript}”</div>}
                    </div>
                  );
                })}
              </div>
            ))}
            {sp?.gradedBy === "AI" && <div style={{ fontSize: 12.5, color: "#6B6E78", background: "#F7F7F5", border: "1px solid #EAE8E2", borderRadius: 10, padding: "9px 12px" }}>ℹ️ {t("mock.speakingTranscriptOnly")}</div>}
            {sp?.feedback && <FeedbackView fb={sp.feedback} />}
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <b>{t("mock.band")}</b><input className="field-input" style={{ width: 70 }} value={sBand} onChange={(e) => setSBand(e.target.value)} inputMode="decimal" />
            </div>
            <textarea className="field-input" rows={2} placeholder={t("mock.commentPh")} value={sComment} onChange={(e) => setSComment(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={busy || num(sBand) === undefined} style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }}
                onClick={() => run(() => mockTestsApi.review(detail.id, { section: "speaking", band: num(sBand)!, comment: sComment }))}>
                💾 {t("mock.saveBand")}
              </button>
              <button type="button" disabled={busy} style={ghost} onClick={() => run(() => mockTestsApi.regrade(detail.id, "speaking"))}>🤖 {t("mock.aiRegrade")}</button>
            </div>
          </section>
        )}
        {!detail.sectionDone.writing && !detail.sectionDone.speaking && <div style={{ color: "#686B75", fontSize: 13 }}>{t("mock.nothingToReview")}</div>}
      </div>
    </Modal>
  );
}
