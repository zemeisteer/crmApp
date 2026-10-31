/** A thin progress bar that fills in once (fill-x). `value` 0..100. */
export default function ProgressBar({ value, color = "var(--ink)", index = 0, label }: { value: number; color?: string; index?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label} style={{ height: 6, borderRadius: "var(--radius-pill)", background: "var(--surface-sunken)", overflow: "hidden" }}>
      <div className="fill-x" style={{ width: `${pct}%`, height: "100%", borderRadius: "var(--radius-pill)", background: color, ["--i" as string]: index }} />
    </div>
  );
}
