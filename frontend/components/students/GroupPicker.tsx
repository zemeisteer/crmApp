"use client";

import { useMemo, useState } from "react";
import type { Group } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

// Every open group of the center, grouped by direction: one student can study
// several directions at once (English and maths, say). Rendered inline, not as
// a dropdown, so a long list is never clipped by the modal.
export default function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: Group[];
  value: string;
  onChange: (groupId: string) => void;
}) {
  const { t } = useLanguage();
  const [q, setQ] = useState("");

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const open = groups
      .filter((g) => g.status !== "ARCHIVED" && g.status !== "COMPLETED")
      .filter((g) => !needle || [g.name, g.subject, g.teacher?.fullName ?? "", g.level ?? ""].some((s) => s.toLowerCase().includes(needle)));
    const bySubject = new Map<string, Group[]>();
    for (const g of open) {
      const key = g.subject?.trim() || t("groupPicker.noSubject");
      bySubject.set(key, [...(bySubject.get(key) ?? []), g]);
    }
    return [...bySubject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subject, items]) => ({ subject, items: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [groups, q, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("groupPicker.search")} />
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 2 }}>
        {sections.length === 0 && <div style={{ fontSize: 13, color: "#686B75", padding: 8 }}>{t("groupPicker.none")}</div>}
        {sections.map((s) => (
          <div key={s.subject}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#686B75", textTransform: "uppercase", letterSpacing: 0.4, margin: "0 2px 6px" }}>
              {s.subject} · {s.items.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.items.map((g) => {
                const selected = g.id === value;
                const full = g.studentCount !== undefined && g.maxStudents > 0 && g.studentCount >= g.maxStudents;
                const time = [g.scheduleDays ?? g.schedule, g.startTime ? `${g.startTime}${g.endTime ? `–${g.endTime}` : ""}` : ""].filter(Boolean).join(" · ");
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={full}
                    onClick={() => onChange(g.id)}
                    style={{
                      textAlign: "left",
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: `1.5px solid ${selected ? ACCENT : "#EAE8E2"}`,
                      background: selected ? "#EEF0FF" : full ? "#F7F6F2" : "#fff",
                      cursor: full ? "not-allowed" : "pointer",
                      opacity: full ? 0.6 : 1,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: selected ? ACCENT : "#181A1F" }}>
                        {g.name}
                        {g.level ? <span style={{ fontWeight: 500, color: "#686B75" }}> · {g.level}</span> : null}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "#686B75", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[g.teacher?.fullName, time].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: full ? "#B23A47" : "#5B5F6A", whiteSpace: "nowrap" }}>
                      {full ? t("groupPicker.full") : g.studentCount !== undefined ? `${g.studentCount}/${g.maxStudents}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
