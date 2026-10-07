"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, placementApi, type PlacementAttemptDetail, type PlacementTestSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";
import { placementLevelName } from "@/lib/placement";
import AttemptReview from "@/components/tests/AttemptReview";

// One placement result: every answer, and grading of written answers.
export default function PlacementAttemptModal({ test, attemptId, onClose, onChanged }: { test: PlacementTestSummary; attemptId: string; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<PlacementAttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    placementApi.getAttempt(test.id, attemptId).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [test.id, attemptId, t]);

  return (
    <Modal open onClose={onClose} title={data ? `${data.fullName} — ${test.title}` : test.title} width={760}>
      {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
      {!data && !error && <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat label={t("placement.score")} value={`${data.percent}%`} sub={`${data.earned}/${data.total}`} />
            <Stat label={t("placement.suggested")} value={data.reviewStatus === "PENDING" ? "⏳" : placementLevelName(test.subject, data.suggestedLevel, t)} />
            <Stat label={t("placement.date")} value={formatDateTime(data.createdAt, lang)} sub={data.phone ?? undefined} />
          </div>
          <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <AttemptReview
              items={data.items.map((it, i) => ({ key: String(i), question: it.question, answer: it.answer, earned: it.earned, max: it.max, pending: it.pending, correct: it.correct }))}
              manualScores={data.manualScores}
              aiReview={data.aiReview}
              onAiReview={async () => setData(await placementApi.aiReviewAttempt(test.id, attemptId))}
              onSave={async (scores) => {
                setData(await placementApi.gradeAttempt(test.id, attemptId, scores));
                onChanged();
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 140, padding: "10px 12px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
      <div style={{ fontSize: 11.5, color: "#64748B", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94A3B8" }}>{sub}</div>}
    </div>
  );
}
