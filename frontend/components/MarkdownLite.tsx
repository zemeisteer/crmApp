import { Fragment, type ReactNode } from "react";

// Renders AI-written text (light markdown: "#" headings, "-" bullets,
// **bold**) readably, without raw asterisks and hashes.
export default function MarkdownLite({ text, style }: { text: string; style?: React.CSSProperties }) {
  const lines = text.replace(/\r/g, "").split("\n");
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "#2C3038", ...style }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return <hr key={i} style={{ border: "none", borderTop: "1px solid #E5E7EB", margin: "10px 0" }} />;
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} style={{ fontSize: heading[1].length <= 2 ? 15.5 : 14, fontWeight: 800, color: "#1E1B4B", margin: "10px 0 4px" }}>
              {inline(heading[2])}
            </div>
          );
        }
        const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 6 + Math.min(3, Math.floor(bullet[1].length / 2)) * 14 }}>
              <span style={{ color: "#94A3B8" }}>•</span>
              <span>{inline(bullet[2])}</span>
            </div>
          );
        }
        return <div key={i}>{inline(line)}</div>;
      })}
    </div>
  );
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <b key={i}>{p.slice(2, -2)}</b>
    ) : p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
      <i key={i}>{p.slice(1, -1)}</i>
    ) : (
      <Fragment key={i}>{p.replace(/`/g, "")}</Fragment>
    ),
  );
}
