"use client";

import { useEffect, useState } from "react";

// Hero slider for a center's site: the center's own photos first, then
// real stock photos of lessons (a class with a teacher, studying together,
// graduation). If a photo cannot load, the slide falls back to a drawn
// illustration in the center's accent colour.

export interface Slide {
  kind: "teacher" | "ai" | "results" | "photo";
  title: string;
  text: string;
  src?: string;
}

// Unsplash photos (free to use under the Unsplash License), served from
// Unsplash's CDN at the size the slider needs.
const unsplash = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&h=900&q=80`;
export const STOCK_PHOTOS: Record<"teacher" | "ai" | "results", string> = {
  teacher: unsplash("photo-1524178232363-1fb2b075b655"),
  ai: unsplash("photo-1522202176988-66273c2fd55f"),
  results: unsplash("photo-1523050854058-8df90110c9f1"),
};

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
  const photo = s.src && !broken[s.src] ? s.src : null;
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
        ) : s.kind === "teacher" ? (
          <TeacherArt accent={accent} />
        ) : s.kind === "ai" || s.kind === "photo" ? (
          <AiArt accent={accent} />
        ) : (
          <ResultsArt accent={accent} />
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

// ---- illustrations (flat SVG) ----

function Person({ x, y, skin, shirt, hair, scale = 1 }: { x: number; y: number; skin: string; shirt: string; hair: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-26 70 Q-26 30 0 30 Q26 30 26 70 Z" fill={shirt} />
      <circle cx="0" cy="12" r="16" fill={skin} />
      <path d="M-16 8 Q-14 -8 0 -6 Q16 -8 16 8 Q10 0 0 1 Q-10 0 -16 8Z" fill={hair} />
    </g>
  );
}

function TeacherArt({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 400 300" width="100%" height="100%" role="img" aria-label="teacher">
      <rect x="40" y="36" width="230" height="140" rx="10" fill="#1F2A37" />
      <rect x="40" y="176" width="230" height="8" rx="3" fill="#C9B79C" />
      <text x="62" y="80" fill="#fff" fontSize="22" fontFamily="Manrope, sans-serif" fontWeight="700">a² + b² = c²</text>
      <text x="62" y="112" fill="#9CA3AF" fontSize="15" fontFamily="Inter, sans-serif">Present Perfect ✓</text>
      <path d="M62 140 l40 -18 l30 12 l40 -26 l40 10" stroke={accent} strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* teacher with pointer */}
      <g transform="translate(318 104)">
        <path d="M-30 96 Q-30 44 0 44 Q30 44 30 96 Z" fill={accent} />
        <rect x="-20" y="96" width="14" height="46" rx="6" fill="#374151" />
        <rect x="6" y="96" width="14" height="46" rx="6" fill="#374151" />
        <circle cx="0" cy="22" r="20" fill="#F2C9A5" />
        <path d="M-20 18 Q-18 -4 0 -2 Q22 -4 20 20 Q12 6 0 8 Q-10 8 -20 18Z" fill="#3B2A20" />
        <path d="M-26 58 L-70 20" stroke={accent} strokeWidth="11" strokeLinecap="round" />
        <path d="M-70 20 L-96 -2" stroke="#8B5E3C" strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* students */}
      <rect x="20" y="248" width="360" height="12" rx="4" fill="#E5E1D8" />
      <Person x={80} y={196} skin="#E8B894" shirt="#60A5FA" hair="#1F2937" scale={0.9} />
      <Person x={160} y={196} skin="#F1CBA8" shirt="#F59E0B" hair="#5B3A29" scale={0.9} />
      <Person x={240} y={196} skin="#D6A27C" shirt="#34D399" hair="#111827" scale={0.9} />
      <circle cx="330" cy="60" r="18" fill="#FDE68A" />
      <text x="322" y="67" fontSize="18">💡</text>
    </svg>
  );
}

function AiArt({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 400 300" width="100%" height="100%" role="img" aria-label="ai">
      {/* phone with chat */}
      <rect x="150" y="18" width="130" height="250" rx="22" fill="#12131A" />
      <rect x="158" y="30" width="114" height="226" rx="16" fill="#F7F7F5" />
      <rect x="166" y="46" width="78" height="30" rx="10" fill="#fff" stroke="#E5E7EB" />
      <text x="174" y="65" fontSize="10" fontFamily="Inter, sans-serif" fill="#374151">Nima uchun…?</text>
      <rect x="174" y="84" width="92" height="44" rx="10" fill={accent} />
      <text x="182" y="102" fontSize="10" fontFamily="Inter, sans-serif" fill="#fff">Misol bilan</text>
      <text x="182" y="116" fontSize="10" fontFamily="Inter, sans-serif" fill="#fff">tushuntiraman ✨</text>
      <rect x="166" y="136" width="70" height="26" rx="10" fill="#fff" stroke="#E5E7EB" />
      <text x="174" y="153" fontSize="10" fontFamily="Inter, sans-serif" fill="#374151">Rahmat! 👍</text>
      <rect x="186" y="170" width="80" height="54" rx="10" fill={accent} opacity="0.9" />
      <rect x="194" y="182" width="60" height="6" rx="3" fill="#fff" opacity="0.8" />
      <rect x="194" y="194" width="48" height="6" rx="3" fill="#fff" opacity="0.8" />
      <rect x="194" y="206" width="54" height="6" rx="3" fill="#fff" opacity="0.8" />
      {/* robot helper */}
      <g transform="translate(330 150)">
        <rect x="-34" y="-30" width="68" height="56" rx="16" fill={accent} />
        <rect x="-22" y="-16" width="44" height="26" rx="9" fill="#fff" />
        <circle cx="-9" cy="-3" r="5" fill="#12131A" />
        <circle cx="9" cy="-3" r="5" fill="#12131A" />
        <line x1="0" y1="-30" x2="0" y2="-44" stroke={accent} strokeWidth="4" />
        <circle cx="0" cy="-48" r="6" fill="#FBBF24" />
        <rect x="-24" y="28" width="48" height="40" rx="12" fill={accent} opacity="0.85" />
        <text x="-9" y="55" fontSize="16">✨</text>
      </g>
      {/* student */}
      <g transform="translate(78 140)">
        <path d="M-34 110 Q-34 50 0 50 Q34 50 34 110 Z" fill="#F59E0B" />
        <circle cx="0" cy="26" r="22" fill="#F1CBA8" />
        <path d="M-22 22 Q-20 -2 0 0 Q22 -2 22 22 Q14 8 0 10 Q-12 10 -22 22Z" fill="#3B2A20" />
        <path d="M26 72 L64 58" stroke="#F59E0B" strokeWidth="11" strokeLinecap="round" />
        <text x="-30" y="-8" fontSize="20">🤔</text>
      </g>
    </svg>
  );
}

function ResultsArt({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 400 300" width="100%" height="100%" role="img" aria-label="results">
      <rect x="36" y="40" width="210" height="190" rx="16" fill="#fff" stroke="#E5E7EB" />
      {[60, 95, 80, 130, 150].map((h, i) => (
        <rect key={i} x={62 + i * 36} y={210 - h} width="24" height={h} rx="6" fill={i === 4 ? accent : `color-mix(in srgb, ${accent} 35%, white)`} />
      ))}
      <path d="M74 150 L110 118 L146 128 L182 86 L218 62" stroke="#1FA463" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="218" cy="62" r="7" fill="#1FA463" />
      {/* certificate */}
      <g transform="translate(262 70)">
        <rect x="0" y="0" width="110" height="80" rx="10" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="2" />
        <rect x="16" y="18" width="78" height="7" rx="3" fill="#F59E0B" />
        <rect x="16" y="34" width="60" height="5" rx="2" fill="#D6D3D1" />
        <rect x="16" y="46" width="68" height="5" rx="2" fill="#D6D3D1" />
        <circle cx="86" cy="62" r="11" fill={accent} />
      </g>
      {/* trophy */}
      <g transform="translate(316 196)">
        <path d="M-26 -40 h52 v16 a26 26 0 0 1 -52 0 z" fill="#FBBF24" />
        <rect x="-6" y="0" width="12" height="18" fill="#F59E0B" />
        <rect x="-20" y="18" width="40" height="10" rx="3" fill="#92400E" />
        <text x="-9" y="-16" fontSize="16">⭐</text>
      </g>
    </svg>
  );
}
