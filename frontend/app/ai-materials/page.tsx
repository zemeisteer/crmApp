"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Select from "@/components/Select";
import { aiApi, groupsApi, homeworkApi, Group, Homework, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";

const MATERIAL_TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
  LESSON_PLAN: "aiMaterials.typeLessonPlan",
  HOMEWORK: "aiMaterials.typeHomework",
  QUIZ: "aiMaterials.typeQuiz",
};

function AiMaterialsContent() {
  const { t } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [direction, setDirection] = useState("");
  const [groupId, setGroupId] = useState("ALL");
  const [level, setLevel] = useState("ALL");
  const [homeworkId, setHomeworkId] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("LESSON_PLAN");
  const [material, setMaterial] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([groupsApi.list(), homeworkApi.list()])
      .then(([g, h]) => {
        setGroups(g);
        setHomework(h);
      })
      .finally(() => setLoadingData(false));
  }, []);

  const subjects = useMemo(() => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[], [groups]);
  const levels = useMemo(() => Array.from(new Set(groups.map((g) => g.level).filter(Boolean))) as string[], [groups]);
  const groupsInDirection = direction ? groups.filter((g) => g.subject === direction) : groups;
  const groupsInScope = level !== "ALL" ? groupsInDirection.filter((g) => g.level === level) : groupsInDirection;
  const homeworkInScope = direction ? homework.filter((h) => h.group?.subject === direction) : homework;

  function selectAll() {
    setDirection("");
    setGroupId("ALL");
    setLevel("ALL");
    setHomeworkId("");
  }

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMaterial(null);
    setLoading(true);
    try {
      const relatedHomework = homeworkId ? homework.find((h) => h.id === homeworkId) : undefined;
      const selectedGroup = groupId !== "ALL" ? groups.find((g) => g.id === groupId) : undefined;
      const effectiveSubject = selectedGroup?.subject || direction || groupsInScope[0]?.subject || "Umumiy";
      const effectiveTopic = relatedHomework ? relatedHomework.title : topic;
      const res = await aiApi.generateMaterial({
        subject: effectiveSubject,
        level: level !== "ALL" ? level : undefined,
        topic: effectiveTopic,
        type,
      });
      setMaterial(res.material);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          {t("aiMaterials.title")}
          <span style={{ fontSize: 10.5, fontWeight: 800, background: "linear-gradient(135deg,#8B7CF6,#4F46E5)", color: "#fff", padding: "3px 8px", borderRadius: 6 }}>
            AI
          </span>
        </h1>
        <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>{t("aiMaterials.subtitle")}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box", maxWidth: 760 }}>
        <form onSubmit={onGenerate} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#181A1F" }}>{t("aiMaterials.scope")}</div>
            <button type="button" onClick={selectAll} style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, background: "none", border: "none", cursor: "pointer" }}>
              {t("aiMaterials.selectAllAtOnce")}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.direction")}</div>
              <Select
                options={[{ value: "", label: t("aiMaterials.all") }, ...subjects.map((s) => ({ value: s, label: s }))]}
                value={direction}
                onChange={(v) => { setDirection(v); setGroupId("ALL"); }}
                disabled={loadingData}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.level")}</div>
              <Select
                options={[{ value: "ALL", label: t("aiMaterials.allLevels") }, ...levels.map((l) => ({ value: l, label: l }))]}
                value={level}
                onChange={setLevel}
                disabled={loadingData}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.group")}</div>
              <Select
                options={[{ value: "ALL", label: t("aiMaterials.allGroups") }, ...groupsInScope.map((g) => ({ value: g.id, label: g.name }))]}
                value={groupId}
                onChange={setGroupId}
                disabled={loadingData}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.linkHomework")}</div>
            <Select
              options={[{ value: "", label: t("aiMaterials.notLinked") }, ...homeworkInScope.map((h) => ({ value: h.id, label: h.title }))]}
              value={homeworkId}
              onChange={setHomeworkId}
              disabled={loadingData}
            />
          </div>
          {!homeworkId && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.topic")}</div>
              <input className="field-input" required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Present Perfect vs Past Simple" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("aiMaterials.type")}</div>
            <Select options={Object.keys(MATERIAL_TYPE_LABEL_KEYS).map((v) => ({ value: v, label: t(MATERIAL_TYPE_LABEL_KEYS[v]) }))} value={type} onChange={setType} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 4 }}
          >
            {loading ? t("aiMaterials.generating") : t("aiMaterials.generate")}
          </button>
        </form>

        {error && (
          <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13.5, fontWeight: 600, padding: "14px 18px", borderRadius: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {material && (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 24 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t(MATERIAL_TYPE_LABEL_KEYS[type])}</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{material}</div>
          </div>
        )}
      </div>
    </>
  );
}

export default function AiMaterialsPage() {
  return (
    <DashboardShell>
      <AiMaterialsContent />
    </DashboardShell>
  );
}
