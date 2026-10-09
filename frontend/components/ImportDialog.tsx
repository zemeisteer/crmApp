"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, importApi, type ImportKind, type ImportReport } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
// The column that names a row in the preview.
const MAIN_FIELD: Record<ImportKind, string> = { teachers: "fullName", groups: "name", students: "fullName" };
const STATUS_STYLE = {
  create: { bg: "#EBF8F2", fg: "#16794A" },
  exists: { bg: "#F3F4F6", fg: "#4B5563" },
  error: { bg: "#FDEBEC", fg: "#B23A47" },
} as const;

// Excel import in two steps: the file is checked first (nothing saved) and
// every row shown with what will happen to it; then, only if no row has an
// error, it is imported. The same file again adds nothing new.
export default function ImportDialog({ kind, open, onClose, onDone }: { kind: ImportKind; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setReport(null);
    setError(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    setFile(f);
    setBusy("check");
    try {
      setReport(await importApi.preview(kind, f));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRun() {
    if (!file) return;
    setBusy("run");
    setError(null);
    try {
      const res = await importApi.run(kind, file);
      setReport(res.report);
      setDone(t("imp.done").replace("{n}", String(res.created)).replace("{m}", String(res.skipped)));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "report" in err.body) {
        setReport((err.body as { report: ImportReport }).report);
      }
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  const main = MAIN_FIELD[kind];
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={t(`imp.title.${kind}` as TranslationKey)} width={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "#4A4E58" }}>
          {t("imp.step1")}{" "}
          <button type="button" onClick={() => void importApi.template(kind)} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            ⬇️ {t("imp.template")}
          </button>
        </div>
        <div style={{ fontSize: 13, color: "#4A4E58" }}>{t("imp.step2")}</div>
        <div>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9 }}>
            {busy === "check" ? t("imp.checking") : t("imp.choose")}
          </button>
          {file && <span style={{ marginLeft: 10, fontSize: 12.5, color: "#686B75" }}>{file.name}</span>}
          <input ref={fileRef} type="file" accept=".xlsx" aria-label={t("imp.choose")} onChange={onChoose} style={{ display: "none" }} />
        </div>

        {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
        {done && <div role="status" style={{ background: "#EBF8F2", color: "#167A48", fontSize: 13, fontWeight: 700, padding: "10px 14px", borderRadius: 10 }}>{done}</div>}

        {report && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["create", "exists", "error"] as const).map((s) => (
                <span key={s} style={{ background: STATUS_STYLE[s].bg, color: STATUS_STYLE[s].fg, borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontWeight: 700 }}>
                  {report.counts[s]} {t(s === "create" ? "imp.new" : s === "exists" ? "imp.exists" : "imp.errors")}
                </span>
              ))}
            </div>
            {report.unknownColumns.length > 0 && (
              <div style={{ fontSize: 12, color: "#B45309" }}>{t("imp.unknownCols").replace("{c}", report.unknownColumns.join(", "))}</div>
            )}
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #EAE8E2", borderRadius: 10 }}>
              <table>
                <thead>
                  <tr><th>{t("imp.row")}</th><th /><th /><th /></tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row}>
                      <td style={{ color: "#686B75" }}>{r.row}</td>
                      <td style={{ fontWeight: 600 }}>{r.values[main] || "—"}</td>
                      <td>
                        <span style={{ background: STATUS_STYLE[r.status].bg, color: STATUS_STYLE[r.status].fg, borderRadius: 6, padding: "2px 8px", fontSize: 11.5, fontWeight: 700 }}>
                          {t(`imp.status.${r.status}` as TranslationKey)}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: r.errors.length ? "#B23A47" : "#686B75" }}>{r.errors.length ? r.errors.join("; ") : r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!done && (report.counts.error > 0 ? (
              <div style={{ fontSize: 13, color: "#B23A47", fontWeight: 600 }}>{t("imp.fixAndRetry")}</div>
            ) : report.counts.create === 0 ? (
              <div style={{ fontSize: 13, color: "#4A4E58" }}>{t("imp.nothingNew")}</div>
            ) : (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void onRun()} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}>
                {busy === "run" ? t("common.saving") : t("imp.run").replace("{n}", String(report.counts.create))}
              </button>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
