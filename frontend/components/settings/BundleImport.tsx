"use client";

import { useRef, useState } from "react";
import { ApiError, importApi, type BundleImportResult, type ImportKind } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const KIND_KEY: Record<ImportKind, TranslationKey> = { teachers: "bimp.teachers", groups: "bimp.groups", students: "bimp.students" };

/**
 * Teachers, groups and students in one go: one workbook (a sheet each) or
 * a .zip of the single templates. Each kind is all-or-nothing; a kind with
 * an error stops the rest, and the same file again skips what was saved.
 */
export default function BundleImport() {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BundleImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await importApi.runBundle(file));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="bundle-import" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{t("bimp.title")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("bimp.hint")}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => void importApi.bundleTemplate()} style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: "var(--radius-sm)" }}>
          ⬇ {t("bimp.template")}
        </button>
        <label className="btn" style={{ background: "var(--primary)", color: "var(--on-ink)", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: "var(--radius-sm)", cursor: busy ? "wait" : "pointer" }}>
          {busy ? t("bimp.running") : `⬆ ${t("bimp.choose")}`}
          <input ref={fileRef} type="file" accept=".xlsx,.zip,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onChoose} disabled={busy} style={{ display: "none" }} aria-label={t("bimp.choose")} />
        </label>
      </div>
      {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)" }}>{error}</div>}
      {result && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          {result.steps.map((s) => (
            <div key={s.kind} style={{ color: "var(--success)", fontWeight: 600 }}>
              ✓ {t(KIND_KEY[s.kind])}: {t("bimp.stepDone").replace("{n}", String(s.created)).replace("{m}", String(s.skipped))}
            </div>
          ))}
          {result.failed && (
            <div style={{ color: "var(--danger)", fontWeight: 600 }}>
              ✕ {t(KIND_KEY[result.failed.kind])}: {result.failed.message}
              {result.failed.report && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontWeight: 500 }}>
                  {result.failed.report.rows.filter((r) => r.errors.length).slice(0, 20).map((r) => (
                    <li key={r.row}>{t("imp.row")} {r.row}: {r.errors.join("; ")}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result.notRun.length > 0 && (
            <div style={{ color: "var(--text-muted)" }}>{t("bimp.notRun").replace("{list}", result.notRun.map((k) => t(KIND_KEY[k])).join(", "))}</div>
          )}
        </div>
      )}
    </div>
  );
}
