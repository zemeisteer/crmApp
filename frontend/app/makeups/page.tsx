"use client";

import { useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import MissedTab from "@/components/makeups/MissedTab";
import CreditsTab from "@/components/makeups/CreditsTab";
import RosterTab from "@/components/makeups/RosterTab";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
type Tab = "missed" | "credits" | "roster";
const TAB_LABELS: Record<Tab, TranslationKey> = { missed: "mk.tabMissed", credits: "mk.tabCredits", roster: "mk.tabRoster" };

function MakeupsContent() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Front desk and managers: everything; teachers: the roster of what they teach.
  const seesCredits = can(user, "makeups.view");
  const canManage = can(user, "makeups.manage");
  const canMark = can(user, "makeups.attend");
  const tabs: Tab[] = [...(seesCredits ? (["missed", "credits"] as Tab[]) : []), ...(canMark ? (["roster"] as Tab[]) : [])];
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];
  // A credit issued on the first tab shows on the second without a reload.
  const [issuedCount, setIssuedCount] = useState(0);

  function onTabKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setChosen(next);
    document.getElementById(`mk-tab-${next}`)?.focus();
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("mk.title")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2, lineHeight: 1.5 }}>{t(seesCredits ? "mk.subtitle" : "mk.subtitleTeacher")}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "20px 32px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto", boxSizing: "border-box" }}>
        {tabs.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 24, color: "#686B75", fontSize: 13.5 }}>{t("mk.noAccess")}</div>
        ) : (
          <>
            {tabs.length > 1 && (
              <div role="tablist" aria-label={t("mk.title")} style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 12, alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto" }}>
                {tabs.map((k, i) => (
                  <button
                    key={k}
                    id={`mk-tab-${k}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    aria-controls="mk-panel"
                    tabIndex={tab === k ? 0 : -1}
                    onClick={() => setChosen(k)}
                    onKeyDown={(e) => onTabKey(e, i)}
                    style={{
                      border: "none", cursor: "pointer", padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
                      background: tab === k ? "#fff" : "transparent", color: tab === k ? ACCENT : "#5F626B",
                      boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    {t(TAB_LABELS[k])}
                  </button>
                ))}
              </div>
            )}
            <div id="mk-panel" role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `mk-tab-${tab}` : undefined} style={{ maxWidth: 900, width: "100%", minWidth: 0 }}>
              {tab === "missed" && <MissedTab canManage={canManage} onIssued={() => setIssuedCount((n) => n + 1)} />}
              {tab === "credits" && <CreditsTab canManage={canManage} refreshKey={issuedCount} />}
              {tab === "roster" && <RosterTab canMark={canMark} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function MakeupsPage() {
  return (
    <DashboardShell>
      <MakeupsContent />
    </DashboardShell>
  );
}
