// What a center writes about itself for its public site (Settings → Site).
// Stored as JSON on tenants.site_content; everything is cleaned and capped
// here so the public page never shows unbounded or unexpected data.

export interface SiteContent {
  heroTitle: string | null;
  heroSubtitle: string | null;
  about: string | null;
  advantages: Array<{ icon: string; title: string; text: string }>;
  results: Array<{ name: string; result: string; detail: string }>;
  testimonials: Array<{ name: string; role: string; text: string }>;
  faq: Array<{ q: string; a: string }>;
  gallery: string[];
  workingHours: string | null;
  socials: { instagram: string | null; telegram: string | null; youtube: string | null; facebook: string | null; tiktok: string | null };
  videoUrl: string | null;
  trialLesson: boolean;
  trialText: string | null;
  placementTestId: string | null;
}

export const EMPTY_SITE: SiteContent = {
  heroTitle: null,
  heroSubtitle: null,
  about: null,
  advantages: [],
  results: [],
  testimonials: [],
  faq: [],
  gallery: [],
  workingHours: null,
  socials: { instagram: null, telegram: null, youtube: null, facebook: null, tiktok: null },
  videoUrl: null,
  trialLesson: false,
  trialText: null,
  placementTestId: null,
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const opt = (v: unknown, max: number) => str(v, max) || null;
// One emoji (joined sequences like 👩‍🏫 are several code points): cut by
// code points, never in the middle of a surrogate pair.
const emoji = (v: unknown) => Array.from(str(v, 32)).slice(0, 8).join('');
const list = <T>(v: unknown, max: number, map: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x === 'object')
    .map((x) => map(x as Record<string, unknown>))
    .filter((x): x is T => x !== null)
    .slice(0, max);
// Only http(s) links end up as hrefs on the public page.
const url = (v: unknown) => {
  const s = str(v, 300);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export function normalizeSiteContent(raw: unknown): SiteContent {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const socials = r.socials && typeof r.socials === 'object' ? (r.socials as Record<string, unknown>) : {};
  return {
    heroTitle: opt(r.heroTitle, 120),
    heroSubtitle: opt(r.heroSubtitle, 300),
    about: opt(r.about, 2000),
    advantages: list(r.advantages, 8, (x) => (str(x.title, 80) ? { icon: emoji(x.icon) || '✅', title: str(x.title, 80), text: str(x.text, 300) } : null)),
    results: list(r.results, 12, (x) => (str(x.name, 80) && str(x.result, 60) ? { name: str(x.name, 80), result: str(x.result, 60), detail: str(x.detail, 120) } : null)),
    testimonials: list(r.testimonials, 20, (x) => (str(x.name, 80) && str(x.text, 600) ? { name: str(x.name, 80), role: str(x.role, 80), text: str(x.text, 600) } : null)),
    faq: list(r.faq, 12, (x) => (str(x.q, 200) && str(x.a, 800) ? { q: str(x.q, 200), a: str(x.a, 800) } : null)),
    gallery: (Array.isArray(r.gallery) ? r.gallery : [])
      .map((g) => str(g, 120))
      // Upload file names only (no paths or URLs).
      .filter((g) => /^[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/i.test(g))
      .slice(0, 12),
    workingHours: opt(r.workingHours, 120),
    socials: {
      instagram: url(socials.instagram),
      telegram: url(socials.telegram),
      youtube: url(socials.youtube),
      facebook: url(socials.facebook),
      tiktok: url(socials.tiktok),
    },
    videoUrl: url(r.videoUrl),
    trialLesson: r.trialLesson === true,
    trialText: opt(r.trialText, 200),
    placementTestId: opt(r.placementTestId, 40),
  };
}

export function parseSiteContent(stored: string | null): SiteContent {
  if (!stored) return EMPTY_SITE;
  try {
    return normalizeSiteContent(JSON.parse(stored));
  } catch {
    return EMPTY_SITE;
  }
}
