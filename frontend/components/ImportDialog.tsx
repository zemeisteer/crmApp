"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, importApi, type ImportColumns, type ImportKind, type ImportReport } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
// The column that names a row in the preview.
const MAIN_FIELD: Record<ImportKind, string> = { teachers: "fullName", groups: "name", students: "fullName" };
const STATUS_STYLE = {
  create: { bg: "var(--success-soft)", fg: "var(--success)" },
  exists: { bg: "var(--surface-muted)", fg: "var(--text-soft)" },
  error: { bg: "var(--danger-soft)", fg: "var(--danger)" },
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
  // Which column of the file is which field (suggested, remembered per kind).
  const [cols, setCols] = useState<ImportColumns | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  function reset() {
    setFile(null);
    setReport(null);
    setError(null);
    setDone(null);
    setCols(null);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  }

  const memoryKey = `talimcrm-import-map-${kind}`;
  function remembered(c: ImportColumns): Record<string, string> {
    try {
      const saved = JSON.parse(localStorage.getItem(memoryKey) ?? "{}") as Record<string, string>;
      // Only choices whose column this file has too.
      const usable = Object.fromEntries(Object.entries(saved).filter(([k, h]) => c.headers.includes(h) && c.fields.some((f) => f.key === k)));
      return Object.keys(usable).length ? { ...c.suggested, ...usable } : c.suggested;
    } catch {
      return c.suggested;
    }
  }

  async function onCheck() {
    if (!file) return;
    setBusy("check");
    setError(null);
    try {
      setReport(await importApi.preview(kind, file, mapping));
      try {
        localStorage.setItem(memoryKey, JSON.stringify(mapping));
      } catch {
        // Not kept: next time the suggestion is used.
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    setFile(f);
    setBusy("check");
    try {
      const c = await importApi.columns(kind, f);
      setCols(c);
      setMapping(remembered(c));
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
      const res = await importApi.run(kind, file, mapping);
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
        <div style={{ fontSize: 13, color: "var(--text-soft)" }}>
          {t("imp.step1")}{" "}
          <button type="button" onClick={() => void importApi.template(kind)} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            ⬇️ {t("imp.template")}
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("imp.step2")}</div>
        <div>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()} style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: "var(--radius-sm)" }}>
            {busy === "check" ? t("imp.checking") : t("imp.choose")}
          </button>
          {file && <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--text-muted)" }}>{file.name}</span>}
          <input ref={fileRef} type="file" accept=".xlsx" aria-label={t("imp.choose")} onChange={onChoose} style={{ display: "none" }} />
        </div>

        {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>}
        {done && <div role="status" style={{ background: "var(--success-soft)", color: "var(--success)", fontSize: 13, fontWeight: 700, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{done}</div>}

        {cols && !done && (
          <div data-testid="import-mapping" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t("imp.mapTitle")}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("imp.mapHint")}</div>
            {cols.fields.map((f) => {
              const missing = f.required && !mapping[f.key];
              return (
                <label key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1fr) minmax(130px, 1.3fr) minmax(0, 1.2fr)", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: missing ? "var(--danger)" : undefined }}>{f.title}{f.required ? " *" : ""}</span>
                  <select
                    className="field-input"
                    aria-label={f.title}
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setReport(null);
                      setMapping((m) => {
                        const n = { ...m };
                        if (v) n[f.key] = v;
                        else delete n[f.key];
                        return n;
                      });
                    }}
                    style={{ padding: "6px 8px", fontSize: 13 }}
                  >
                    <option value="">{t("imp.mapNone")}</option>
                    {cols.headers.map((h) => (
                      <option key={h} value={h} disabled={Object.entries(mapping).some(([k, v]) => v === h && k !== f.key)}>{h}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {mapping[f.key] ? cols.sample.map((r) => r[mapping[f.key]]).filter(Boolean).slice(0, 2).join(", ") : f.hint ?? ""}
                  </span>
                </label>
              );
            })}
            {cols.headers.some((h) => !Object.values(mapping).includes(h)) && (
              <div style={{ fontSize: 12, color: "var(--warning)" }}>{t("imp.unknownCols").replace("{c}", cols.headers.filter((h) => !Object.values(mapping).includes(h)).join(", "))}</div>
            )}
            <button type="button" className="btn" disabled={busy !== null || cols.fields.some((f) => f.required && !mapping[f.key])} onClick={() => void onCheck()} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13.5, fontWeight: 700, padding: 10, borderRadius: "var(--radius-sm)" }}>
              {busy === "check" ? t("imp.checking") : t("imp.mapCheck")}
            </button>
          </div>
        )}

        {report && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["create", "exists", "error"] as const).map((s) => (
                <span key={s} style={{ background: STATUS_STYLE[s].bg, color: STATUS_STYLE[s].fg, borderRadius: "var(--radius-xs)", padding: "4px 10px", fontSize: 12.5, fontWeight: 700 }}>
                  {report.counts[s]} {t(s === "create" ? "imp.new" : s === "exists" ? "imp.exists" : "imp.errors")}
                </span>
              ))}
            </div>
            {report.unknownColumns.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--warning)" }}>{t("imp.unknownCols").replace("{c}", report.unknownColumns.join(", "))}</div>
            )}
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
              <table>
                <thead>
                  <tr><th>{t("imp.row")}</th><th /><th /><th /></tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row}>
                      <td style={{ color: "var(--text-muted)" }}>{r.row}</td>
                      <td style={{ fontWeight: 600 }}>{r.values[main] || "—"}</td>
                      <td>
                        <span style={{ background: STATUS_STYLE[r.status].bg, color: STATUS_STYLE[r.status].fg, borderRadius: "var(--radius-xs)", padding: "2px 8px", fontSize: 11.5, fontWeight: 700 }}>
                          {t(`imp.status.${r.status}` as TranslationKey)}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: r.errors.length ? "var(--danger)" : "var(--text-muted)" }}>{r.errors.length ? r.errors.join("; ") : r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!done && (report.counts.error > 0 ? (
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{t("imp.fixAndRetry")}</div>
            ) : report.counts.create === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{t("imp.nothingNew")}</div>
            ) : (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void onRun()} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)" }}>
                {busy === "run" ? t("common.saving") : t("imp.run").replace("{n}", String(report.counts.create))}
              </button>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
