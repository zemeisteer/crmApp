"use client";

import { ReactNode } from "react";

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
