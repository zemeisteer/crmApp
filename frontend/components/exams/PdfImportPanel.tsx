"use client";

import { useRef, useState } from "react";
import { ApiError, examsApi, type ExamQuestion } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TestQuestion } from "@/lib/tests";
import QuestionDraftsModal from "@/components/tests/QuestionDraftsModal";

// Upload a PDF test, review the questions the AI read from it, then add
// them to the exam's question bank in one go.
export default function PdfImportPanel({ examId, onImported }: { examId: string; onImported: (created: ExamQuestion[]) => void }) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<TestQuestion[] | null>(null);

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
      else setDrafts(res.questions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={reading}
        title={error ?? undefined}
        className="px-3 py-1.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 text-indigo-700 text-xs font-semibold transition cursor-pointer"
      >
        {reading ? t("pdfq.reading") : t("pdfq.button")}
      </button>
      {error && !drafts && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-rose-600 text-white text-xs font-semibold px-4 py-2 shadow-lg cursor-pointer" onClick={() => setError(null)}>
          {error} ✕
        </div>
      )}
      {drafts && (
        <QuestionDraftsModal
          title={t("pdfq.title")}
          questions={drafts}
          onClose={() => setDrafts(null)}
          onSave={async (chosen) => {
            const created = await examsApi.batchQuestions(examId, chosen);
            onImported(created);
            setDrafts(null);
          }}
        />
      )}
    </>
  );
}
