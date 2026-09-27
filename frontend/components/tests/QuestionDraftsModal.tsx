"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { hasAnswer, type TestQuestion } from "@/lib/tests";
import QuestionList from "@/components/tests/QuestionView";
import QuestionEditor from "@/components/tests/QuestionEditor";

type Draft = TestQuestion & { include: boolean };

// Review of questions read by AI (from a PDF or a material) before they are
// saved: grouped by section, every one editable, untick the ones you don't
// want, fill missing answers.
export default function QuestionDraftsModal({
  title,
  questions,
  onClose,
  onSave,
}: {
  title: string;
  questions: TestQuestion[];
  onClose: () => void;
  onSave: (chosen: TestQuestion[]) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map((q) => ({ ...q, include: true })));
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const chosen = drafts.filter((q) => q.include);
  const missing = chosen.filter((q) => !hasAnswer(q)).length;
  const sections = new Set(chosen.map((q) => q.section).filter(Boolean)).size;

  async function save() {
    if (chosen.length === 0 || missing > 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(chosen.map(({ include: _include, ...q }) => q));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {sections > 0 && `${t("pdfq.sections")}: ${sections} · `}
              {t("pdfq.found")}: {drafts.length} · {t("pdfq.selected")}: {chosen.length} · {t("pdfq.pts")}: {chosen.reduce((s, q) => s + q.points, 0)}
            </p>
          </div>
          <button type="button" onClick={() => !saving && onClose()} className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer" aria-label={t("common.close")}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-2">{error}</div>}
          {sections > 0 && <div className="rounded-lg bg-indigo-50 text-indigo-800 text-xs px-3 py-2">{t("pdfq.sectionsHint")}</div>}
          {missing > 0 && <div className="rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2">{t("pdfq.missing")} ({missing})</div>}
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
        </div>

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
      </div>
    </div>
  );
}
