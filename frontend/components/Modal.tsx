"use client";

import { ReactNode, useEffect, useRef } from "react";

// Open dialogs, oldest first: Escape closes only the one on top.
const openDialogs: object[] = [];

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
  // Escape closes the dialog (the latest onClose, without re-subscribing).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const me = {};
    openDialogs.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openDialogs[openDialogs.length - 1] !== me) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = openDialogs.indexOf(me);
      if (i >= 0) openDialogs.splice(i, 1);
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
          ...style,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 18.5, fontWeight: 800, color: "#181A1F" }}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="btn"
            style={{
              background: "#F2F1EC",
              color: "#8A8D96",
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
