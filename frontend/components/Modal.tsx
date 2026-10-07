"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useLanguage } from "@/lib/i18n-context";

// Open dialogs, oldest first: Escape closes only the one on top.
const openDialogs: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

export default function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  style,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number | string;
  style?: React.CSSProperties;
}) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape closes the dialog (the latest onClose, without re-subscribing).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const me = {};
    openDialogs.push(me);
    // Keyboard and screen-reader users land in the dialog, stay in it, and go
    // back to the control that opened it (WCAG 2.4.3).
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const fields = focusables(panel);
      const first = fields.find((el) => el.matches("input, select, textarea")) ?? fields.find((el) => el.getAttribute("data-modal-close") !== "true") ?? panel;
      first.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const fields = focusables(panel);
      if (fields.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = fields[0];
      const last = fields[fields.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const i = openDialogs.indexOf(me);
      if (i >= 0) openDialogs.splice(i, 1);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(18,19,26,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 18,
          padding: "24px 26px",
          width,
          maxWidth: "92vw",
          maxHeight: "88vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxShadow: "0 24px 64px rgba(18,19,26,0.22)",
          outline: "none",
          ...style,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 18.5, fontWeight: 800, color: "#181A1F" }}>{title}</h2>
          <button
            type="button"
            data-modal-close="true"
            aria-label={t("common.close")}
            onClick={onClose}
            className="btn"
            style={{
              background: "#F2F1EC",
              color: "#686B75",
              fontSize: 18,
              width: 30,
              height: 30,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
