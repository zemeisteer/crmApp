"use client";

import { useEffect, useSyncExternalStore } from "react";
import { chatApi } from "./api";

// The menu's unread-messages badge. Every page mounts its own menu, so the
// count lives here, outside React, and survives a page change. It belongs
// to one person in one center (`key` = user id + center id): after a switch
// to another center the old number is never shown.
//
// While the Messages page is open its live stream keeps the number exact
// (it registers as the live source); elsewhere the menu asks the server when
// it appears, when the window gets focus again, and once a minute while the
// page is visible - a short request, never a held-open connection.

interface State {
  key: string | null;
  count: number | null;
}
let state: State = { key: null, count: null };
let liveSources = 0;
const listeners = new Set<() => void>();
const EMPTY: State = { key: null, count: null };

function emit() {
  for (const l of listeners) l();
}

export function setChatUnread(key: string, count: number) {
  if (state.key === key && state.count === count) return;
  state = { key, count };
  emit();
}

/** The Messages page while mounted: its numbers win over the menu's own checks. */
export function claimLiveUnread(): () => void {
  liveSources++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    liveSources--;
  };
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The count for this person and center (null until known). */
export function useChatUnread(key: string | null): number | null {
  const s = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  return key && s.key === key ? s.count : null;
}

const POLL_MS = 60_000;

/** Keeps the badge's number fresh while the menu is shown (see above). */
export function useChatUnreadRefresh(key: string | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    const check = () => {
      if (liveSources > 0 || document.visibilityState !== "visible") return;
      chatApi
        .unread()
        .then((r) => {
          if (alive && liveSources === 0) setChatUnread(key, r.unread);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, enabled]);
}
