"use client";

import { useEffect } from "react";

/**
 * A link to a part of the same page (href="#features") glides there instead
 * of jumping. Only those clicks: other scrolling (lists that keep their
 * chosen item in view, route changes) stays instant, which a page-wide
 * `scroll-behavior: smooth` would not allow. Off for people who ask for
 * reduced motion.
 */
export default function SmoothAnchors() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
      if (!link) return;
      const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
      // Keyboard and screen reader users land where the page now is.
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
