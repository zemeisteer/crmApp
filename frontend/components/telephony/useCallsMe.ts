"use client";

import { useEffect, useState } from "react";
import { callsApi, type CallsMe } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { TranslationKey } from "@/lib/i18n";

// What the signed-in member's screens should offer for telephony (is it on
// for the center, may they see calls, call out). Asked once per page load
// and shared by every call button; the server checks again on each request.

const OFF: CallsMe = { available: false, canView: false, canCall: false, canStats: false, extension: null };
// One answer per signed-in person and center: another sign-in or a switch
// of center asks again.
let cached: { key: string; me: Promise<CallsMe> } | null = null;

export function resetCallsMe() {
  cached = null;
}

export function useCallsMe(enabled = true): CallsMe {
  const { user, tenant } = useAuth();
  const key = user && tenant ? `${user.id}|${tenant.id}` : "";
  const [state, setState] = useState<{ key: string; me: CallsMe }>({ key: "", me: OFF });
  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    if (!cached || cached.key !== key) cached = { key, me: callsApi.me().catch(() => OFF) };
    cached.me.then((m) => live && setState({ key, me: m }));
    return () => {
      live = false;
    };
  }, [enabled, key]);
  return state.key === key ? state.me : OFF;
}

/** 95 -> "1:35". */
export function talkTime(sec: number | null | undefined): string {
  const v = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = String(v % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** +998901234567 -> +998 90 123 45 67 (other numbers as they are). */
export function prettyPhone(n: string | null | undefined): string {
  if (!n) return "—";
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(n);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : n;
}

/**
 * A call's note on a lead's timeline, in the reader's language (the server
 * stores an Uzbek sentence as the body, and the facts in metadata).
 * Null for any other entry.
 */
export function callNoteText(metadata: Record<string, unknown> | null | undefined, t: (k: TranslationKey) => string): string | null {
  if (!metadata || metadata.kind !== "PHONE_CALL") return null;
  const incoming = metadata.direction === "INBOUND";
  if (metadata.status === "ANSWERED") {
    return t(incoming ? "tel.noteInAnswered" : "tel.noteOutAnswered").replace("{d}", talkTime(metadata.durationSec as number | null));
  }
  return t(incoming ? "tel.noteInMissed" : "tel.noteOutMissed");
}
