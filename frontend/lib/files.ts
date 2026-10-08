"use client";

import { useEffect, useMemo, useState } from "react";
import { apiHref, filesApi } from "./api";

/**
 * Private uploads (homework, submissions, exam materials, mock-test
 * recordings) are opened through short-lived signed links: the server checks
 * the caller against the record each file belongs to and hands back a link
 * that works without a token (an <img> or <audio> cannot send one).
 *
 * Links are fetched in batches per screen and kept until shortly before they
 * expire (30 minutes on the server). A link already given to a component is
 * not swapped while it is shown, so a playing recording is never restarted.
 */
export type FileScope = "staff" | "portal";

const KEEP_MS = 25 * 60_000;
const cache = new Map<string, { url: string | null; until: number }>();
const queued: Record<FileScope, Map<string, Array<(url: string | null) => void>>> = { staff: new Map(), portal: new Map() };
const timers: Partial<Record<FileScope, ReturnType<typeof setTimeout>>> = {};

function flush(scope: FileScope) {
  delete timers[scope];
  const waiting = queued[scope];
  queued[scope] = new Map();
  const names = [...waiting.keys()];
  if (names.length === 0) return;
  const call = scope === "portal" ? filesApi.signPortal : filesApi.sign;
  call(names).then(
    (links) => {
      const until = Date.now() + KEEP_MS;
      for (const name of names) {
        const url = links[name] ? apiHref(links[name]) : null;
        cache.set(`${scope}|${name}`, { url, until });
        waiting.get(name)?.forEach((done) => done(url));
      }
    },
    () => {
      // Not cached: the next screen asks again.
      for (const name of names) waiting.get(name)?.forEach((done) => done(null));
    },
  );
}

/** A signed link for one stored file name, or null when it may not be opened. */
export function signedFileUrl(name: string, scope: FileScope = "staff"): Promise<string | null> {
  const hit = cache.get(`${scope}|${name}`);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = queued[scope].get(name) ?? [];
    list.push(resolve);
    queued[scope].set(name, list);
    if (!timers[scope]) timers[scope] = setTimeout(() => flush(scope), 0);
  });
}

/** Signed links for several names: name -> link (absent until known; null when not allowed). */
export function useFileUrls(names: Array<string | null | undefined>, scope: FileScope = "staff"): Record<string, string | null> {
  const key = names.filter(Boolean).join("|");
  const wanted = useMemo(() => [...new Set(key ? key.split("|") : [])], [key]);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    const missing = wanted.filter((n) => !(n in links));
    for (const name of missing) {
      signedFileUrl(name, scope).then((url) => {
        if (live) setLinks((prev) => (name in prev ? prev : { ...prev, [name]: url }));
      });
    }
    return () => {
      live = false;
    };
    // links are only added to, never replaced, while the component lives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, scope]);
  return links;
}

/** The signed link for one name (undefined while loading, null when not allowed). */
export function useFileUrl(name: string | null | undefined, scope: FileScope = "staff"): string | null | undefined {
  const links = useFileUrls([name], scope);
  return name ? links[name] : null;
}
