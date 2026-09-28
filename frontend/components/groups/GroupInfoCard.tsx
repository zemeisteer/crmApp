"use client";

import type { Group } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

const DAY_KEYS: Record<string, TranslationKey> = {
  dushanba: "weekday.short.monday", seshanba: "weekday.short.tuesday", chorshanba: "weekday.short.wednesday",
  payshanba: "weekday.short.thursday", juma: "weekday.short.friday", shanba: "weekday.short.saturday", yakshanba: "weekday.short.sunday",
};

// Compact "about the group" card: everything a teacher or admin needs at a
// glance, with icons, in a two-column grid.
export default function GroupInfoCard({ group, students, lessonsHeld }: { group: Group; students: number; lessonsHeld?: number }) {
  const { t, lang } = useLanguage();
  const days = (group.scheduleDays ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (DAY_KEYS[d.toLowerCase()] ? t(DAY_KEYS[d.toLowerCase()]) : d))
    .join(", ");
  const time = group.startTime ? `${group.startTime}${group.endTime ? `–${group.endTime}` : ""}` : "";
  const schedule = days || time ? [days, time].filter(Boolean).join(" · ") : group.schedule || "—";
  const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);

  const rows: Array<{ icon: string; label: string; value: string }> = [
    { icon: "📚", label: t("groupDetail.subject"), value: group.subject },
    { icon: "🎯", label: t("groupDetail.level"), value: group.level || "—" },
    { icon: "👩‍🏫", label: t("groups.fieldTeacher"), value: group.teacher?.fullName || "—" },
    { icon: "📍", label: t("groups.fieldBranch"), value: group.branch?.name || "—" },
    { icon: "🗓", label: t("groupDetail.schedule"), value: schedule },
    { icon: "👥", label: t("groups.fieldMaxSeats"), value: `${students} / ${group.maxStudents}` },
    { icon: "💰", label: t("groups.fieldMonthlyPrice"), value: group.monthlyPrice ? `${money(group.monthlyPrice)} ${t("common.sumUnit")}` : "—" },
    { icon: "🚀", label: t("groupDetail.startedDate"), value: group.startDate ? formatDate(group.startDate, lang, "long") : "—" },
  ];
  // Length of the course and its end month, when a duration is set.
  if (group.durationMonths) {
    let end = "";
    if (group.startDate) {
      const d = new Date(group.startDate);
      d.setMonth(d.getMonth() + group.durationMonths);
      end = ` (${t("grp.until")}: ${d.toLocaleDateString(lang === "EN" ? "en-GB" : lang === "RU" ? "ru-RU" : "uz-UZ", { month: "long", year: "numeric" })})`;
    }
    rows.push({ icon: "⏳", label: t("grp.duration"), value: `${t("stu.months").replace("{n}", String(group.durationMonths))}${end}` });
  }
  if (lessonsHeld !== undefined) rows.push({ icon: "✅", label: t("grp.lessonsHeld"), value: String(lessonsHeld) });

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("groupDetail.aboutGroup")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F7F6F2", borderRadius: 10, padding: "9px 11px", minWidth: 0 }}>
            <span style={{ fontSize: 16, lineHeight: "20px" }} aria-hidden>{r.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "#8A8D96", fontWeight: 600 }}>{r.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.value}>{r.value}</div>
            </div>
          </div>
        ))}
      </div>
      {group.description && <div style={{ marginTop: 12, fontSize: 13, color: "#4A4E58", lineHeight: 1.55 }}>{group.description}</div>}
    </div>
  );
}
