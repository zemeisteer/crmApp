"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, mockTestsApi, type MockImport } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { levelKey } from "@/components/mock-tests/MockTestEditor";

const ACCENT = "#4F46E5";
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// Materials -> mock tests: drop the book PDF(s) and the recordings; the
// server finds the tests, reads them and saves drafts. This window follows
// the job and lists what was made, with what the teacher should check.
export default function ImportPanel({ onClose, onOpenTest }: { onClose: () => void; onOpenTest: (id: string) => void }) {
  const { t } = useLanguage();
  const [files, setFiles] = useState<File[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  const [job, setJob] = useState<MockImport | null>(null);
  const [recent, setRecent] = useState<MockImport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mockTestsApi.imports().then(setRecent).catch(() => undefined);
  }, []);

  // Follow a running job.
  useEffect(() => {
    if (!job || job.status === "DONE" || job.status === "FAILED") return;
    const id = setInterval(() => { mockTestsApi.importStatus(job.id).then(setJob).catch(() => undefined); }, 2500);
    return () => clearInterval(id);
  }, [job]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => f.type === "application/pdf" || f.type.startsWith("audio/") || /\.(pdf|mp3|m4a|wav|ogg)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
  };

  async function start() {
    setError(null);
    setUpload(0);
    try {
      setJob(await mockTestsApi.startImport(files, setUpload));
      setFiles([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setUpload(null);
    }
  }

  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const audios = files.filter((f) => !pdfs.includes(f));
  const pct = job && job.progress.total > 0 ? Math.round((job.progress.done / job.progress.total) * 100) : null;

  return (
    <Modal open onClose={onClose} title={`📥 ${t("mimp.title")}`}>
      <div style={{ display: "grid", gap: 14, maxHeight: "78vh", overflowY: "auto", paddingRight: 4 }}>
        {!job && (
          <>
            <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.55 }}>{t("mimp.intro")}</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
              onClick={() => input.current?.click()}
              style={{ border: `2px dashed ${drag ? ACCENT : "#D9D6CE"}`, background: drag ? "#EEF0FF" : "#FAFAF8", borderRadius: 14, padding: "26px 16px", textAlign: "center", cursor: "pointer" }}
            >
              <div style={{ fontSize: 30 }}>📚 🎧</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{t("mimp.drop")}</div>
              <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 4 }}>{t("mimp.dropHint")}</div>
              <input ref={input} type="file" multiple hidden accept="application/pdf,audio/*,.pdf,.mp3,.m4a,.wav,.ogg" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </div>
            {files.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {[...pdfs, ...audios].map((f) => (
                  <div key={f.name + f.size} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, background: "#F7F7F5", borderRadius: 10, padding: "7px 10px" }}>
                    <span>{pdfs.includes(f) ? "📄" : "🎵"}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ color: "#8A8D96", fontSize: 12 }}>{mb(f.size)}</span>
                    <button type="button" onClick={() => setFiles((p) => p.filter((x) => x !== f))} style={{ background: "none", border: "none", color: "#B23A47", cursor: "pointer" }}>✕</button>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "#6B6E78" }}>{t("mimp.summary").replace("{p}", String(pdfs.length)).replace("{a}", String(audios.length))}</div>
              </div>
            )}
            {error && <div style={{ background: "#FDEBEC", color: "#B23A47", padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>{error}</div>}
            {upload !== null && (
              <div>
                <div style={{ fontSize: 12.5, marginBottom: 4 }}>{t("mimp.uploading")} {upload}%</div>
                <div style={{ height: 8, background: "#F2F1EC", borderRadius: 99 }}><div style={{ width: `${upload}%`, height: "100%", background: ACCENT, borderRadius: 99 }} /></div>
              </div>
            )}
            <button type="button" disabled={pdfs.length === 0 || upload !== null} onClick={start}
              style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 11, padding: "11px 16px", fontWeight: 800, cursor: "pointer", opacity: pdfs.length === 0 ? 0.5 : 1 }}>
              🔎 {t("mimp.start")}
            </button>
          </>
        )}

        {job && (
          <div style={{ display: "grid", gap: 12 }}>
            {(job.status === "QUEUED" || job.status === "RUNNING") && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>⏳ {job.progress.message || t("mimp.working")}</div>
                <div style={{ height: 10, background: "#F2F1EC", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${pct ?? 8}%`, height: "100%", background: ACCENT, borderRadius: 99, transition: "width .4s" }} />
                </div>
                <div style={{ fontSize: 12.5, color: "#6B6E78" }}>{t("mimp.wait")}</div>
              </div>
            )}
            {job.status === "FAILED" && <div style={{ background: "#FDEBEC", color: "#B23A47", padding: "10px 12px", borderRadius: 10, fontSize: 13.5 }}>❌ {job.error}</div>}
            {job.status === "DONE" && (
              <>
                <div style={{ fontWeight: 800, color: "#1FA463" }}>✅ {job.progress.message}{job.result.book ? ` · ${job.result.book}` : ""}</div>
                {(job.result.tests ?? []).map((x) => (
                  <div key={x.id} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <b>{x.title}</b>
                      <button type="button" style={{ ...ghost, background: ACCENT, color: "#fff", border: "none" }} onClick={() => onOpenTest(x.id)}>✎ {t("mimp.open")}</button>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#6B6E78" }}>
                      🎧 {x.counts.listening} · 📖 {x.counts.reading} · ✍️ {x.counts.writing} · 🎤 {x.counts.speaking} · {x.level ? t(levelKey(x.level)) : t("mock.levelAll")}
                    </div>
                    {x.warnings.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
                        {x.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
                {(job.result.unmatchedAudio ?? []).length > 0 && (
                  <div style={{ fontSize: 12.5, color: "#92400E" }}>🎵 {t("mimp.unmatched")}: {job.result.unmatchedAudio!.join(", ")}</div>
                )}
              </>
            )}
            {(job.status === "DONE" || job.status === "FAILED") && (
              <button type="button" style={ghost} onClick={() => setJob(null)}>+ {t("mimp.another")}</button>
            )}
          </div>
        )}

        {!job && recent.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase" }}>{t("mimp.recent")}</div>
            {recent.slice(0, 5).map((r) => (
              <button key={r.id} type="button" onClick={() => setJob(r)} style={{ ...ghost, textAlign: "left", fontWeight: 500, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.files.map((f) => f.name).join(", ")}</span>
                <span style={{ color: r.status === "DONE" ? "#1FA463" : r.status === "FAILED" ? "#B23A47" : ACCENT, fontWeight: 700 }}>{r.status === "DONE" ? `${r.result.tests?.length ?? 0} ✓` : r.status === "FAILED" ? "✕" : "⏳"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
