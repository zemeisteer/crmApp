"use client";

import { useEffect, useMemo, useState } from "react";
import { subjectsApi } from "@/lib/api";

/**
 * The center's own directions: its saved subjects plus any subject a group
 * already carries (older groups were typed by hand). Forms offer these, not
 * a fixed list that has nothing to do with the center.
 */
export function useCenterDirections(groupSubjects: Array<string | null | undefined> = []) {
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    subjectsApi.list("ACTIVE")
      .then((list) => { if (alive) setSaved(list.map((x) => x.name)); })
      .catch(() => { if (alive) setSaved([]); });
    return () => { alive = false; };
  }, []);
  const key = groupSubjects.filter(Boolean).join("\u0001");
  return useMemo(() => {
    const seen = new Map<string, string>();
    for (const name of [...saved, ...key.split("\u0001")]) {
      const clean = name.trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [saved, key]);
}
