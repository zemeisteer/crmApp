"use client";

import { useRef, useState } from "react";
import { ApiError, examsApi, type ExamQuestion } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { hasAnswer, type TestQuestion } from "@/lib/tests";
import QuestionList from "@/components/tests/QuestionView";
import QuestionEditor from "@/components/tests/QuestionEditor";

type Draft = TestQuestion & { include: boolean };

// Upload a PDF test, review the questions the AI read from it (grouped by
// section, every question type; fix or fill missing answers, untick ones
// you don't want), then add them to the exam's question bank in one go.
export default function PdfImportPanel({ examId, onImported }: { examId: string; onImported: (created: ExamQuestion[]) => void }) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError(t("pdfq.onlyPdf"));
      return;
    }
    setError(null);
    setReading(true);
    try {
      const res = await examsApi.parsePdfQuestions(examId, file);
      if (res.questions.length === 0) setError(t("pdfq.none"));
      setDrafts(res.questions.map((q) => ({ ...q, include: true })));
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const update = (i: number, patch: Partial<Draft>) => setDrafts((d) => d && d.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const chosen = (drafts ?? []).filter((q) => q.include);
  const missing = chosen.filter((q) => !hasAnswer(q)).length;
  const sections = new Set(chosen.map((q) => q.section).filter(Boolean)).size;
  const close = () => {
    if (saving) return;
    setDrafts(null);
    setError(null);
    setEditing(null);
  };

  async function save() {
    if (!drafts || chosen.length === 0 || missing > 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await examsApi.batchQuestions(examId, chosen.map(({ include: _i, ...q }) => q));
      onImported(created);
      setDrafts(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={reading}
        className="px-3 py-1.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 text-indigo-700 text-xs font-semibold transition cursor-pointer"
      >
        {reading ? t("pdfq.reading") : t("pdfq.button")}
      </button>

      {(drafts || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={close}>
          <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{t("pdfq.title")}</h3>
                {drafts && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {sections > 0 && `${t("pdfq.sections")}: ${sections} · `}
                    {t("pdfq.found")}: {drafts.length} · {t("pdfq.selected")}: {chosen.length} · {t("pdfq.pts")}: {chosen.reduce((s, q) => s + q.points, 0)}
                  </p>
                )}
              </div>
              <button type="button" onClick={close} className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer" aria-label={t("common.close")}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
              {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-2">{error}</div>}
              {drafts && drafts.length > 0 && <div className="rounded-lg bg-indigo-50 text-indigo-800 text-xs px-3 py-2">{t("pdfq.sectionsHint")}</div>}
              {drafts && missing > 0 && (
                <div className="rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2">{t("pdfq.missing")} ({missing})</div>
              )}
              {drafts && (
                <QuestionList
                  questions={drafts}
                  itemStyle={(q, i) => {
                    const noAnswer = drafts[i].include && !hasAnswer(q);
                    return { opacity: drafts[i].include ? 1 : 0.5, borderColor: editing === i ? "#4F46E5" : noAnswer ? "#FCD34D" : "#E2E8F0", background: noAnswer && editing !== i ? "#FFFBEB" : "#fff" };
                  }}
                  renderItem={(q, i) => (editing === i ? <QuestionEditor value={q} onChange={(nq) => update(i, nq)} /> : null)}
                  aside={(_q, i) => (
                    <div className="flex flex-col items-center gap-1.5">
                      <input type="checkbox" aria-label={t("pdfq.selected")} checked={drafts[i].include} onChange={(e) => update(i, { include: e.target.checked })} className="accent-indigo-600 w-4 h-4" />
                      <button
                        type="button"
                        title={t("common.edit")}
                        onClick={() => setEditing(editing === i ? null : i)}
                        className={`w-7 h-7 rounded-md border text-xs cursor-pointer ${editing === i ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                      >
                        {editing === i ? "✓" : "✎"}
                      </button>
                    </div>
                  )}
                />
              )}
            </div>

            {drafts && drafts.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
                <span className="text-[11px] text-slate-500">{t("pdfq.hint")}</span>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || chosen.length === 0 || missing > 0}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  {saving ? t("common.saving") : `${t("pdfq.add")} (${chosen.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
