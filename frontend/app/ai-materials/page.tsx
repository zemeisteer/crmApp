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

const STANDARD_LEVELS = [
  "Beginner (A1)",
  "Elementary (A2)",
  "Pre-Intermediate",
  "Intermediate (B1)",
  "Upper-Intermediate (B2)",
  "Advanced (C1)",
  "IELTS Foundation",
  "IELTS 5.5 - 6.5",
  "IELTS 7.0+",
  "CEFR B1 / B2",
  "Boshlang'ich daraja",
  "O'rta daraja",
  "Murakkab / Olimpiada",
];

interface SavedAiMaterial {
  id: string;
  createdAt: string;
  subject: string;
  level?: string;
  topic: string;
  type: string;
  customInstructions?: string;
  content: string;
}

const STORAGE_KEY = "talimcrm_saved_ai_materials_v1";

function AiMaterialsContent() {
  const { t, lang } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [direction, setDirection] = useState("");
  const [groupId, setGroupId] = useState("ALL");
  const [level, setLevel] = useState("ALL");
  const [homeworkId, setHomeworkId] = useState("");
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [type, setType] = useState("LESSON_PLAN");

  const [activeMaterial, setActiveMaterial] = useState<SavedAiMaterial | null>(null);
  const [history, setHistory] = useState<SavedAiMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
          if (parsed.length > 0) {
            setActiveMaterial(parsed[0]);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save history to localStorage
  function persistHistory(items: SavedAiMaterial[]) {
    setHistory(items);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full or unavailable
    }
  }

  useEffect(() => {
    Promise.all([groupsApi.list(), homeworkApi.list()])
      .then(([g, h]) => {
        setGroups(g);
        setHomework(h);
      })
      .finally(() => setLoadingData(false));
  }, []);

  const subjects = useMemo(
    () => Array.from(new Set(groups.map((g) => g.subject).filter(Boolean))) as string[],
    [groups],
  );

  const levels = useMemo(() => {
    const fromGroups = groups.map((g) => g.level).filter(Boolean) as string[];
    return Array.from(new Set([...STANDARD_LEVELS, ...fromGroups]));
  }, [groups]);

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
    setLoading(true);
    try {
      const relatedHomework = homeworkId ? homework.find((h) => h.id === homeworkId) : undefined;
      const selectedGroup = groupId !== "ALL" ? groups.find((g) => g.id === groupId) : undefined;
      const effectiveSubject = selectedGroup?.subject || direction || groupsInScope[0]?.subject || "Umumiy";
      const effectiveTopic = relatedHomework ? relatedHomework.title : topic || "Mavzu";

      const res = await aiApi.generateMaterial({
        subject: effectiveSubject,
        level: level !== "ALL" ? level : undefined,
        topic: effectiveTopic,
        type,
        customInstructions: customPrompt.trim() || undefined,
      });

      const newMaterial: SavedAiMaterial = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        subject: effectiveSubject,
        level: level !== "ALL" ? level : undefined,
        topic: effectiveTopic,
        type,
        customInstructions: customPrompt.trim() || undefined,
        content: res.material,
      };

      setActiveMaterial(newMaterial);
      persistHistory([newMaterial, ...history]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  function deleteHistoryItem(id: string) {
    const next = history.filter((h) => h.id !== id);
    persistHistory(next);
    if (activeMaterial?.id === id) {
      setActiveMaterial(next[0] || null);
    }
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          {t("aiMaterials.title")}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              background: "linear-gradient(135deg,#8B7CF6,#4F46E5)",
              color: "#fff",
              padding: "3px 8px",
              borderRadius: 6,
            }}
          >
            AI Assistant
          </span>
        </h1>
        <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>{t("aiMaterials.subtitle")}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* LEFT COLUMN: Generation Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <form
              onSubmit={onGenerate}
              style={{
                background: "#fff",
                border: "1px solid #EAE8E2",
                borderRadius: 16,
                padding: 22,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#181A1F" }}>{t("aiMaterials.scope")}</div>
                <button
                  type="button"
                  onClick={selectAll}
                  style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, background: "none", border: "none", cursor: "pointer" }}
                >
                  {t("aiMaterials.selectAllAtOnce")}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                    {t("aiMaterials.direction")}
                  </div>
                  <Select
                    options={[{ value: "", label: t("aiMaterials.all") }, ...subjects.map((s) => ({ value: s, label: s }))]}
                    value={direction}
                    onChange={(v) => {
                      setDirection(v);
                      setGroupId("ALL");
                    }}
                    disabled={loadingData}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                    {t("aiMaterials.level")}
                  </div>
                  <Select
                    options={[{ value: "ALL", label: t("aiMaterials.allLevels") }, ...levels.map((l) => ({ value: l, label: l }))]}
                    value={level}
                    onChange={setLevel}
                    disabled={loadingData}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                    {t("aiMaterials.group")}
                  </div>
                  <Select
                    options={[{ value: "ALL", label: t("aiMaterials.allGroups") }, ...groupsInScope.map((g) => ({ value: g.id, label: g.name }))]}
                    value={groupId}
                    onChange={setGroupId}
                    disabled={loadingData}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                  {t("aiMaterials.linkHomework")}
                </div>
                <Select
                  options={[{ value: "", label: t("aiMaterials.notLinked") }, ...homeworkInScope.map((h) => ({ value: h.id, label: h.title }))]}
                  value={homeworkId}
                  onChange={setHomeworkId}
                  disabled={loadingData}
                />
              </div>

              {!homeworkId && (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                    {t("aiMaterials.topic")}
                  </div>
                  <input
                    className="field-input"
                    required
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Masalan: Present Perfect vs Past Simple yoki Kvadrat tenglamalar"
                  />
                </div>
              )}

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                  {t("aiMaterials.type")}
                </div>
                <Select
                  options={Object.keys(MATERIAL_TYPE_LABEL_KEYS).map((v) => ({
                    value: v,
                    label: t(MATERIAL_TYPE_LABEL_KEYS[v]),
                  }))}
                  value={type}
                  onChange={setType}
                />
              </div>

              {/* Teacher custom prompt / instructions */}
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>
                  O&apos;qituvchi talabi / Tafsif (Prompt)
                </div>
                <textarea
                  className="field-input"
                  rows={3}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Masalan: 10 ta test savoli bo'lsin, javoblar kaliti oxirida berilsin, darajasi murakkabroq bo'lsin..."
                  style={{ resize: "vertical" }}
                />
              </div>

              <button
                className="btn"
                type="submit"
                disabled={loading}
                style={{
                  background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                  color: "#fff",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  padding: 13,
                  borderRadius: 10,
                  marginTop: 6,
                  cursor: "pointer",
                }}
              >
                {loading ? "✨ AI material yaratmoqda..." : `✨ ${t("aiMaterials.generate")}`}
              </button>
            </form>

            {error && (
              <div
                style={{
                  background: "#FDEBEC",
                  color: "#B23A47",
                  fontSize: 13.5,
                  fontWeight: 600,
                  padding: "14px 18px",
                  borderRadius: 12,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Active Preview & Material History */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Active Material Preview */}
            {activeMaterial ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 16,
                  padding: 22,
                  boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 14,
                    paddingBottom: 14,
                    borderBottom: "1px solid #F1F0EC",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <span
                        style={{
                          background: "#EEF0FF",
                          color: ACCENT,
                          fontSize: 11.5,
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: 6,
                        }}
                      >
                        {t(MATERIAL_TYPE_LABEL_KEYS[activeMaterial.type] || "aiMaterials.typeLessonPlan")}
                      </span>
                      <span
                        style={{
                          background: "#F2F1EC",
                          color: "#181A1F",
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: "3px 9px",
                          borderRadius: 6,
                        }}
                      >
                        {activeMaterial.subject}
                      </span>
                      {activeMaterial.level && (
                        <span
                          style={{
                            background: "#EBF8F2",
                            color: "#1FA463",
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: "3px 9px",
                            borderRadius: 6,
                          }}
                        >
                          {activeMaterial.level}
                        </span>
                      )}
                      <span style={{ fontSize: 11.5, color: "#8A8D96" }}>{formatDate(activeMaterial.createdAt)}</span>
                    </div>
                    <h2 style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>
                      {activeMaterial.topic}
                    </h2>
                    {activeMaterial.customInstructions && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "#4A4E58",
                          background: "#F9F9F8",
                          border: "1px dashed #DCDAD5",
                          borderRadius: 8,
                          padding: "6px 10px",
                          marginTop: 8,
                        }}
                      >
                        <strong>Tafsilot/Prompt:</strong> {activeMaterial.customInstructions}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn"
                    onClick={() => copyToClipboard(activeMaterial.content, activeMaterial.id)}
                    style={{
                      background: copiedId === activeMaterial.id ? "#EBF8F2" : "#F2F1EC",
                      color: copiedId === activeMaterial.id ? "#1FA463" : "#181A1F",
                      fontSize: 12.5,
                      fontWeight: 700,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {copiedId === activeMaterial.id ? "✓ Nusxalandi!" : "📋 Nusxa olish"}
                  </button>
                </div>

                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    color: "#2C3038",
                    fontFamily: "inherit",
                    maxHeight: 500,
                    overflowY: "auto",
                    paddingRight: 6,
                  }}
                >
                  {activeMaterial.content}
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  border: "1px dashed #DCDAD5",
                  borderRadius: 16,
                  padding: 36,
                  textAlign: "center",
                  color: "#8A8D96",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>💡</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#181A1F", marginBottom: 6 }}>
                  Hozircha material tanlanmagan
                </div>
                <div style={{ fontSize: 13, maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>
                  Chap tarafdagi formani to&apos;ldirib <strong>&quot;Yaratish&quot;</strong> tugmasini bosing yoki quyidagi
                  avvalgi yaratilgan materiallar ro&apos;yxatidan birini tanlang.
                </div>
              </div>
            )}

            {/* Previously Generated AI Materials History */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #EAE8E2",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: "#181A1F" }}>
                  Avval yaratilgan AI materiallar ({history.length})
                </div>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Barcha avvalgi materiallar tarixini o'chirmoqchimisiz?")) {
                        persistHistory([]);
                        setActiveMaterial(null);
                      }
                    }}
                    style={{ background: "none", border: "none", color: "#B23A47", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Tarixni tozalash
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div style={{ fontSize: 13, color: "#8A8D96", textAlign: "center", padding: "16px 0" }}>
                  Tarix bo&apos;sh. Generatsiya qilingan materiallar avtomatik shu yerda saqlanib boriladi.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {history.map((h) => {
                    const isSelected = activeMaterial?.id === h.id;
                    return (
                      <div
                        key={h.id}
                        style={{
                          border: `1px solid ${isSelected ? ACCENT : "#EAE8E2"}`,
                          background: isSelected ? "#FBFBFF" : "#FAFAF9",
                          borderRadius: 12,
                          padding: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onClick={() => setActiveMaterial(h)}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                            <span
                              style={{
                                background: "#EEF0FF",
                                color: ACCENT,
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 5,
                              }}
                            >
                              {t(MATERIAL_TYPE_LABEL_KEYS[h.type] || "aiMaterials.typeLessonPlan")}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#4A4E58" }}>{h.subject}</span>
                            {h.level && <span style={{ fontSize: 11, color: "#8A8D96" }}>· {h.level}</span>}
                            <span style={{ fontSize: 10.5, color: "#A0A3AB", marginLeft: "auto" }}>{formatDate(h.createdAt)}</span>
                          </div>
                          <div
                            style={{
                              fontSize: 13.5,
                              fontWeight: 700,
                              color: "#181A1F",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h.topic}
                          </div>
                          {h.customInstructions && (
                            <div
                              style={{
                                fontSize: 11.5,
                                color: "#8A8D96",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginTop: 2,
                              }}
                            >
                              💬 {h.customInstructions}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(h.content, h.id)}
                            title="Nusxa olish"
                            style={{
                              background: copiedId === h.id ? "#EBF8F2" : "#fff",
                              color: copiedId === h.id ? "#1FA463" : "#4A4E58",
                              border: "1px solid #EAE8E2",
                              borderRadius: 7,
                              padding: "6px 8px",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {copiedId === h.id ? "✓" : "📋"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteHistoryItem(h.id)}
                            title="O'chirish"
                            style={{
                              background: "#fff",
                              color: "#B23A47",
                              border: "1px solid #EAE8E2",
                              borderRadius: 7,
                              padding: "6px 8px",
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
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
