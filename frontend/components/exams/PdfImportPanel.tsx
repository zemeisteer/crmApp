"use client";

import { useRef, useState } from "react";
import { ApiError, examsApi, type ExamQuestion, type ParsedPdfQuestion } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

type Draft = ParsedPdfQuestion & { include: boolean };

// Upload a PDF test, review the questions the AI read from it (fix or pick
// missing answers, untick ones you don't want), then add them to the
// exam's question bank in one go.
export default function PdfImportPanel({ examId, onImported }: { examId: string; onImported: (created: ExamQuestion[]) => void }) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const update = (i: number, patch: Partial<Draft>) => setDrafts((d) => d && d.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const chosen = (drafts ?? []).filter((q) => q.include);
  const missing = chosen.filter((q) => !q.correctAnswer?.trim()).length;

  async function save() {
    if (!drafts || chosen.length === 0 || missing > 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await examsApi.batchQuestions(
        examId,
        chosen.map((q, i) => ({
          prompt: q.prompt,
          questionType: q.questionType,
          options: q.options,
          correctAnswer: q.correctAnswer!.trim(),
          points: q.points,
          order: i,
        })),
      );
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && (setDrafts(null), setError(null))}>
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{t("pdfq.title")}</h3>
                {drafts && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("pdfq.found")}: {drafts.length} · {t("pdfq.selected")}: {chosen.length}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => { setDrafts(null); setError(null); }} className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer" aria-label={t("common.close")}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-2">{error}</div>}
              {drafts && missing > 0 && (
                <div className="rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2">{t("pdfq.missing")} ({missing})</div>
              )}
              {drafts?.map((q, i) => {
                const noAnswer = q.include && !q.correctAnswer?.trim();
                return (
                  <div key={i} className={`rounded-xl border p-3 ${noAnswer ? "border-amber-300 bg-amber-50/40" : q.include ? "border-slate-200" : "border-slate-100 opacity-50"}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={q.include} onChange={(e) => update(i, { include: e.target.checked })} className="mt-1 accent-indigo-600" />
                      <div className="flex-1 space-y-2">
                        <textarea
                          value={q.prompt}
                          onChange={(e) => update(i, { prompt: e.target.value })}
                          rows={Math.min(4, Math.ceil(q.prompt.length / 90))}
                          className="w-full text-xs font-semibold text-slate-900 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded-md p-1 resize-none"
                        />
                        {q.questionType === "SHORT_ANSWER" ? (
                          <input
                            value={q.correctAnswer ?? ""}
                            onChange={(e) => update(i, { correctAnswer: e.target.value })}
                            placeholder={t("pdfq.shortAnswerPh")}
                            className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5"
                          />
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {q.options.map((o) => {
                              const right = q.correctAnswer === o.id;
                              return (
                                <button
                                  key={o.id}
                                  type="button"
                                  onClick={() => update(i, { correctAnswer: o.id })}
                                  title={t("pdfq.markCorrect")}
                                  className={`text-left text-xs rounded-md border px-2 py-1.5 cursor-pointer ${right ? "border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold" : "border-slate-200 hover:bg-slate-50 text-slate-700"}`}
                                >
                                  <b className="mr-1">{q.questionType === "TRUE_FALSE" ? "" : `${o.id}.`}</b>{o.text}{right && " ✓"}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">{q.points} {t("pdfq.pts")}</span>
                    </div>
                  </div>
                );
              })}
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
