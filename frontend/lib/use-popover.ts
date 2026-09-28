import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

// Where a dropdown should open so it stays on screen (phones, modals near
// the bottom): below or above the trigger, left- or right-aligned.
// `height`/`width` are the popover's expected size in px.
export function usePopoverPlacement(ref: RefObject<HTMLElement | null>, open: boolean, height: number, width?: number): CSSProperties {
  const [pos, setPos] = useState<{ up: boolean; right: boolean }>({ up: false, right: false });

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < height + 12 && r.top > below;
    const right = width !== undefined && r.left + width > window.innerWidth - 8 && r.right - width >= 8;
    setPos({ up, right });
  }, [open, ref, height, width]);

  return {
    ...(pos.up ? { top: "auto", bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)", bottom: "auto" }),
    ...(pos.right ? { left: "auto", right: 0 } : {}),
    maxWidth: "calc(100vw - 24px)",
  };
}
