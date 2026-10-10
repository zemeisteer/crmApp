"use client";

import { useEffect } from "react";

/**
 * Keeps `--vvh` on <html> equal to the height of what is actually visible.
 * On a phone the on-screen keyboard covers the bottom of the page without
 * changing 100vh/100dvh (iOS Safari), so a screen-filling layout with a text
 * field at the bottom - the chat - ends up typing behind the keyboard. A
 * layout sized with `var(--vvh, 100dvh)` shrinks with the visible area
 * instead, and the field stays above the keyboard. Removed again when the
 * component that asked for it goes away.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    apply();
    vv.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      root.style.removeProperty("--vvh");
    };
  }, []);
}
