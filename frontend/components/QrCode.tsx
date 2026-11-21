"use client";

import { useMemo } from "react";
import { qrPath } from "@/lib/qr";

/**
 * A QR code as inline SVG, drawn from the text on this page. Dark squares on
 * a light ground whatever the theme (a scanner needs that), with the quiet
 * zone the standard asks for.
 */
export default function QrCode({ value, size = 110, label }: { value: string; size?: number; label: string }) {
  const code = useMemo(() => qrPath(value), [value]);
  const quiet = 2;
  const side = code.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${side} ${side}`}
      shapeRendering="crispEdges"
      style={{ display: "block", borderRadius: "var(--radius-xs)" }}
    >
      <rect x={-quiet} y={-quiet} width={side} height={side} fill="white" />
      <path d={code.d} fill="black" />
    </svg>
  );
}
