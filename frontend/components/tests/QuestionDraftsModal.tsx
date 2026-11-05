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
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-fg">{title}</h3>
            <p className="text-xs text-muted mt-0.5">
              {sections > 0 && `${t("pdfq.sections")}: ${sections} · `}
              {t("pdfq.found")}: {drafts.length} · {t("pdfq.selected")}: {chosen.length} · {t("pdfq.pts")}: {chosen.reduce((s, q) => s + q.points, 0)}
            </p>
          </div>
          <button type="button" onClick={() => !saving && onClose()} className="text-faint hover:text-soft text-lg cursor-pointer" aria-label={t("common.close")}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {error && <div role="alert" className="rounded-lg bg-danger-soft text-danger text-xs font-semibold px-3 py-2">{error}</div>}
          {sections > 0 && <div className="rounded-lg bg-primary-soft text-fg text-xs px-3 py-2">{t("pdfq.sectionsHint")}</div>}
          {missing > 0 && <div className="rounded-lg bg-warning-soft text-warning text-xs font-semibold px-3 py-2">{t("pdfq.missing")} ({missing})</div>}
          <QuestionList
            questions={drafts}
            itemStyle={(q, i) => {
              const noAnswer = drafts[i].include && !hasAnswer(q);
              return { opacity: drafts[i].include ? 1 : 0.5, borderColor: editing === i ? "var(--primary)" : noAnswer ? "var(--warning-border)" : "var(--border)", background: noAnswer && editing !== i ? "var(--warning-soft)" : "var(--surface)" };
            }}
            renderItem={(q, i) => (editing === i ? <QuestionEditor value={q} onChange={(nq) => update(i, nq)} /> : null)}
            aside={(_q, i) => (
              <div className="flex flex-col items-center gap-1.5">
                <input type="checkbox" aria-label={t("pdfq.selected")} checked={drafts[i].include} onChange={(e) => update(i, { include: e.target.checked })} className="accent-primary w-4 h-4" />
                <button
                  type="button"
                  title={t("common.edit")}
                  onClick={() => setEditing(editing === i ? null : i)}
                  className={`w-7 h-7 rounded-md border text-xs cursor-pointer ${editing === i ? "border-primary bg-primary-soft text-primary" : "border-line text-muted hover:bg-surface-muted"}`}
                >
                  {editing === i ? "✓" : "✎"}
                </button>
              </div>
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[11px] text-muted">{t("pdfq.hint")}</span>
          <button
            type="button"
            onClick={save}
            disabled={saving || chosen.length === 0 || missing > 0}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            {saving ? t("common.saving") : `${t("pdfq.add")} (${chosen.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
