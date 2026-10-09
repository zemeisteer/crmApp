"use client";

import { useState } from "react";
import ChatView from "@/components/chat/ChatView";
import { portalChatApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { TabTitle } from "./PortalTabs";

// The cabinet fills the screen between its header and (phones) the bottom bar.
const CSS = `
.ptl-chat{height:min(760px, calc(100dvh - 170px));min-height:420px;display:flex;min-width:0}
@media (max-width:760px){.ptl-chat{height:calc(100dvh - 250px);min-height:360px}}
`;

/**
 * The student's (or a parent's) conversations with the center and their
 * teachers - the same view as the staff's Messages page, on the cabinet's
 * own API. Mounted per signed-in child (keyed by the session), so one
 * child's conversations never show under another's.
 */
export default function PortalChat({ onUnread }: { onUnread: (n: number) => void }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{CSS}</style>
      <TabTitle title={t("chat.portalNav")} hint={t("chat.portalHint")} />
      <div className="ptl-chat">
        <ChatView client={portalChatApi} selectedId={selected} onSelect={setSelected} onUnread={onUnread} />
      </div>
    </div>
  );
}
