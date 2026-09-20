"use client";

const ACCENT = "#4F46E5";

export default function TagListInput({
  values,
  onChange,
  placeholder,
  type = "text",
  pattern,
  title,
  addLabel = "+ Qo'shish",
  prefix,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  type?: string;
  pattern?: string;
  title?: string;
  addLabel?: string;
  prefix?: string;
}) {
  const rows = values.length === 0 ? [""] : values;

  function setAt(i: number, val: string) {
    const next = [...rows];
    next[i] = val;
    onChange(next);
  }

  function removeAt(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? [""] : next);
  }

  function add() {
    onChange([...rows, ""]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {prefix && (
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #EAE8E2", borderRadius: 10, overflow: "hidden", flex: 1 }}>
              <span style={{ padding: "12px 10px 12px 14px", background: "#F7F7F5", color: "#8A8D96", fontSize: 13.5, borderRight: "1px solid #EAE8E2" }}>{prefix}</span>
              <input
                className="field-input"
                style={{ border: "none", borderRadius: 0 }}
                type={type}
                value={v}
                onChange={(e) => setAt(i, e.target.value.replace(new RegExp(`^\\${prefix}`), ""))}
                placeholder={placeholder}
                pattern={pattern}
                title={title}
              />
            </div>
          )}
          {!prefix && (
            <input
              className="field-input"
              style={{ flex: 1 }}
              type={type}
              value={v}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder={placeholder}
              pattern={pattern}
              title={title}
            />
          )}
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              style={{ background: "#FDEBEC", color: "#B23A47", border: "none", borderRadius: 8, width: 36, height: 40, flexShrink: 0, cursor: "pointer", fontSize: 16, fontWeight: 700 }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{ alignSelf: "flex-start", background: "none", border: "none", color: ACCENT, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 0" }}
      >
        {addLabel}
      </button>
    </div>
  );
}
