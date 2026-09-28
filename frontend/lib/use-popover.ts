import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

// Where a dropdown should open so it stays on screen. The panel is placed
// with `position: fixed` at the trigger's screen position, so a modal's or
// card's scroll area (overflow: auto/hidden) can no longer cut it off. It
// opens below or above the trigger (whichever has room), right-aligns when
// it would run off the right edge, and follows the trigger on scroll and
// resize. `height`/`width` are the popover's expected size in px.
export function usePopoverPlacement(ref: RefObject<HTMLElement | null>, open: boolean, height: number, width?: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < height && above > below;
      // Without a given width the panel matches the trigger (lists);
      // calendars and clocks keep their own width.
      const panelWidth = Math.min(width ?? r.width, vw - 16);
      let left = r.left;
      if (left + panelWidth > vw - 8) left = Math.max(8, r.right - panelWidth);
      setStyle({
        position: "fixed",
        left,
        right: "auto",
        ...(width === undefined ? { width: panelWidth } : {}),
        maxWidth: vw - 16,
        maxHeight: Math.max(160, Math.min(height, up ? above : below)),
        overflowY: "auto",
        zIndex: 1000,
        ...(up ? { top: "auto", bottom: vh - r.top + 6 } : { top: r.bottom + 6, bottom: "auto" }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, ref, height, width]);

  return style;
}
