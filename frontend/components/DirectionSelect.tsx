"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/Select";
import { groupsApi } from "@/lib/api";
import { useCenterDirections } from "@/lib/use-center-directions";

/** The center's directions, loaded once per mount (saved subjects and group subjects). */
export function useDirectionOptions() {
  const [groupSubjects, setGroupSubjects] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    groupsApi.list()
      .then((gs) => { if (alive) setGroupSubjects(gs.map((g) => g.subject).filter(Boolean)); })
      .catch(() => { if (alive) setGroupSubjects([]); });
    return () => { alive = false; };
  }, []);
  return useCenterDirections(groupSubjects);
}

/**
 * A direction is picked from the center's own list, never typed: a typed
 * name that differs by a letter from the groups' direction would hide the
 * test from every student. A value saved earlier that is no longer in the
 * list stays selectable, so opening an old record does not change it.
 */
export default function DirectionSelect({
  value,
  onChange,
  directions,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Pass the list when the caller already has it; otherwise it is loaded here. */
  directions?: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const loaded = useDirectionOptions();
  const list = directions ?? loaded;
  const options = useMemo(() => {
    const names = value && !list.some((d) => d.toLowerCase() === value.toLowerCase()) ? [value, ...list] : list;
    return names.map((d) => ({ value: d, label: d }));
  }, [list, value]);
  return <Select options={options} value={value} onChange={onChange} placeholder={placeholder} ariaLabel={ariaLabel} />;
}
