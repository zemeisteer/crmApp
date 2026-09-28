"use client";

import { useEffect, useState } from "react";

// Hero slider for a center's site: the center's own photos (if any), then
// three detailed scenes drawn for TalimCRM - a lesson in class, practising
// with the AI helper at home, and a graduate with a certificate. The scenes
// are SVG files in /public/site, inlined so they take the center's accent
// colour (they use var(--accent)).

export interface Slide {
  kind: "teacher" | "ai" | "results" | "photo";
  title: string;
  text: string;
  src?: string;
}

const SCENES: Record<"teacher" | "ai" | "results", string> = {
  teacher: "/site/classroom.svg",
  ai: "/site/study.svg",
  results: "/site/graduate.svg",
};
const sceneCache = new Map<string, string>();

function Scene({ src, label }: { src: string; label: string }) {
  const [svg, setSvg] = useState(() => sceneCache.get(src) ?? "");
  useEffect(() => {
    if (sceneCache.has(src)) {
      setSvg(sceneCache.get(src)!);
      return;
    }
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        // Only our own static drawings are inlined.
        if (!text.trimStart().startsWith("<svg")) return;
        sceneCache.set(src, text);
        if (alive) setSvg(text);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [src]);
  return <div className="ps-scene" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} style={{ width: "100%", height: "100%" }} />;
}

export default function HeroSlides({ slides, accent }: { slides: Slide[]; accent: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [broken, setBroken] = useState<Record<string, true>>({});

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;
  const s = slides[Math.min(i, slides.length - 1)];
  const photo = s.kind === "photo" && s.src && !broken[s.src] ? s.src : null;
  const go = (d: number) => setI((x) => (x + d + slides.length) % slides.length);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ position: "relative", borderRadius: 22, overflow: "hidden", background: "#fff", border: "1px solid #EAE8E2", boxShadow: "0 30px 60px -28px rgba(18,19,26,0.35)" }}
    >
      <div key={i} className="ps-slide" style={{ aspectRatio: "4 / 3", background: photo ? "#111" : `linear-gradient(160deg, color-mix(in srgb, ${accent} 10%, white), #fff)` }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={s.title}
            onError={() => setBroken((b) => ({ ...b, [photo]: true }))}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <Scene src={SCENES[s.kind === "photo" ? "teacher" : s.kind]} label={s.title} />
        )}
      </div>
      <div style={{ padding: "16px 18px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 16.5 }}>{s.title}</div>
          <div style={{ fontSize: 13.5, color: "#4A4E58", marginTop: 3, lineHeight: 1.5 }}>{s.text}</div>
        </div>
        {slides.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" aria-label="prev" onClick={() => go(-1)} style={arrow}>‹</button>
            <button type="button" aria-label="next" onClick={() => go(1)} style={arrow}>›</button>
          </div>
        )}
      </div>
      {slides.length > 1 && (
        <div style={{ position: "absolute", top: 14, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
          {slides.map((_, j) => (
            <button
              key={j}
              type="button"
              aria-label={`${j + 1}`}
              onClick={() => setI(j)}
              style={{ width: j === i ? 22 : 8, height: 8, borderRadius: 100, border: "none", padding: 0, cursor: "pointer", background: j === i ? accent : "rgba(18,19,26,0.18)", transition: "all .3s" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const arrow: React.CSSProperties = { width: 36, height: 36, borderRadius: "50%", border: "1px solid #EAE8E2", background: "#fff", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "#181A1F" };
