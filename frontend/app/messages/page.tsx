"use client";

import { Suspense, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import ChatView from "@/components/chat/ChatView";
import { chatApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { claimLiveUnread, setChatUnread } from "@/lib/chat-unread";
import { useLanguage } from "@/lib/i18n-context";

// The page fills the screen; the list and the conversation scroll inside it.
// (Phones: 56 px of the shell's top bar.)
const CSS = `
.chat-page{height:100dvh;display:flex;flex-direction:column;min-height:0;box-sizing:border-box}
@media (max-width:768px){.chat-page{height:calc(100dvh - 56px)}}
`;

function MessagesContent() {
  const { user, tenant } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  // The open conversation is in the address (?c=<id>): a link opens it, and
  // on a phone the back button returns to the list.
  const selectedId = useSearchParams().get("c");
  // One person in one center: a switch to another center starts over (no
  // list, thread or count of the previous center is ever shown).
  const sessionKey = user && tenant ? `${user.id}:${tenant.id}` : null;

  useEffect(() => claimLiveUnread(), []);

  const onUnread = useCallback((n: number) => {
    if (sessionKey) setChatUnread(sessionKey, n);
  }, [sessionKey]);

  const onSelect = useCallback((id: string | null) => {
    router.push(id ? `/messages?c=${encodeURIComponent(id)}` : "/messages", { scroll: false });
  }, [router]);

  return (
    <div className="chat-page">
      <style>{CSS}</style>
      <div style={{ padding: "18px 32px 12px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("chat.title")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2, lineHeight: 1.5 }}>{t("chat.subtitle")}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: "0px 32px 20px", boxSizing: "border-box" }}>
        {sessionKey && (
          <ChatView key={sessionKey} client={chatApi} selectedId={selectedId} onSelect={onSelect} onUnread={onUnread} teacher={user?.role === "TEACHER"} />
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <MessagesContent />
      </Suspense>
    </DashboardShell>
  );
}
