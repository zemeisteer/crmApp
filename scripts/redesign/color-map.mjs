// Raw hex colors used across the frontend -> design tokens (frontend/app/globals.css).
// Each entry: the token for any use, and optionally a different one by where the
// color is used: "text" (color), "bg" (background), "border" (borders, outlines).
// Colors not listed here are left untouched and listed in the codemod's report.

const T = (token, by = {}) => ({ token, ...by });
const group = (hexes, entry) => Object.fromEntries(hexes.map((h) => [h, entry]));

export const COLOR_MAP = {
  // White: a surface, except as text/icon color on a dark or colored fill.
  ...group(['#FFF', '#FFFFFF'], T('--surface', { text: '--on-ink' })),

  // Ink and near-black: text, or the dark fill of primary/active elements.
  ...group(['#181A1F', '#111827', '#0F172A', '#1E293B', '#1F2937', '#12131A', '#2A2D35', '#1F2128', '#111', '#333'], T('--text', { bg: '--ink', border: '--ink' })),

  // The old indigo brand: now the primary action color (ink by default).
  ...group(['#4F46E5', '#6366F1', '#4338CA', '#3730A3', '#312E81', '#33357A'], T('--primary')),
  ...group(['#EEF0FF', '#EEF2FF', '#E0E7FF', '#F8F8FF', '#ECEBFB', '#F7F6FF', '#FAFAFF', '#F6F5FF', '#F5F6FF', '#FBFBFF', '#E4E2FB', '#E4E0FB', '#D9DBFA', '#E4E7F5'], T('--primary-soft', { border: '--primary-border' })),
  ...group(['#C7D2FE', '#DDD6FE', '#D7D3F8', '#A5B4FC', '#C4B5FD', '#D6D3FA', '#C9C6F5', '#B7B0E8', '#A9A6FF', '#C4C2E0', '#8B84E8'], T('--primary-border')),

  // Violet: AI features.
  ...group(['#7C3AED', '#6D28D9', '#5B21B6', '#8B5CF6', '#8B7CF6', '#A855F7', '#7E22CE', '#6B21A8', '#4C1D95'], T('--violet')),
  ...group(['#F5F3FF', '#F1EBFF', '#F3E8FF', '#EDE9FE', '#FAF5FF', '#FAF8FF'], T('--violet-soft')),

  // Text grays.
  ...group(['#686B75', '#6B6E78', '#6B7280', '#64748B', '#5B6577', '#5B5F6A', '#475569', '#5F626B', '#8A8D96'], T('--text-muted')),
  ...group(['#4A4E58', '#374151', '#4B5563', '#3A3D45', '#334155', '#33363D', '#2C3038'], T('--text-soft')),
  ...group(['#94A3B8', '#9CA3AF', '#A9ABB3', '#A3A6AE', '#A0A3AB', '#9A9CA6', '#9A9DA8', '#9A9CA5', '#999', '#777', '#8E8CA8', '#A5A8B5', '#B0ADA5'], T('--text-faint')),

  // Hairlines and neutral fills.
  ...group(['#EAE8E2', '#E2E8F0', '#E5E7EB', '#F0EEE8', '#EFEEE9', '#E2E0DA', '#EDF2F7', '#E5E3DC', '#EEECE6', '#EEE'], T('--border')),
  ...group(['#CBD5E1', '#D1D5DB', '#C7C9D1', '#D9D6CE', '#C9C7C0', '#C9C6BD', '#DCDAD5', '#D9D7D0', '#C9C7C1', '#C4C6CC', '#C7CAD6', '#D4D4D8'], T('--border-strong', { text: '--text-faint' })),
  ...group(['#F2F1EC', '#F7F7F5', '#F7F6F2', '#F8FAFC', '#F1F5F9', '#F3F4F6', '#F9FAFB', '#FAFAF8', '#FAF9F6', '#F7F6F3', '#F1F0EC', '#F4F3EF', '#F8F8F6', '#FAFAF9', '#FAFAF7', '#F9F8F5', '#F9F9F8'], T('--surface-muted', { border: '--border' })),

  // Status: danger.
  ...group(['#B23A47', '#B91C1C', '#DC2626', '#EF4444', '#7F1D1D', '#991B1B', '#E11D48', '#B42318', '#9B1C1C', '#E15361', '#F87171'], T('--danger')),
  ...group(['#FDEBEC', '#FEE2E2', '#FEF2F2', '#FDECEC', '#FDE8E8', '#FFF1F2', '#FFF5F6'], T('--danger-soft', { border: '--danger-border' })),
  ...group(['#FECACA', '#FCA5A5', '#F6D2D6', '#F6CDD1', '#F3C6CB', '#F5C2C2', '#F5B5B5', '#F5C2C7', '#F3C4C9', '#FECDD3'], T('--danger-border')),

  // Status: success.
  ...group(['#16794A', '#167A48', '#15803D', '#10B981', '#16A34A', '#14532D', '#166534', '#059669', '#047857', '#065F46', '#03543F', '#22C55E'], T('--success')),
  ...group(['#E9F8EF', '#ECFDF5', '#EBF8F2', '#F0FDF4', '#DCFCE7', '#E8F7EF', '#F0FBF4', '#F3FBF6', '#DEF7EC'], T('--success-soft', { border: '--success-border' })),
  ...group(['#BBF7D0', '#A7F3D0', '#BFE6CF', '#BDE8CF'], T('--success-border')),

  // Status: warning (amber).
  ...group(['#B45309', '#92400E', '#8A5A00', '#A15C00', '#D97706', '#B4531A', '#78350F', '#6B4700', '#F59E0B'], T('--warning')),
  ...group(['#FEF3C7', '#FFF7E6', '#FFFBEB', '#FEF9C3', '#FFF6E5', '#FFF7ED', '#FEF3E2', '#FFF9F2'], T('--warning-soft', { border: '--warning-border' })),
  ...group(['#FDE68A', '#FCD34D', '#F5DDA8', '#FAD7B5', '#FED7AA'], T('--warning-border')),

  // Brand accent (orange).
  ...group(['#EB6834'], T('--accent')),
  ...group(['#FFEDD5', '#FFF1E8'], T('--accent-soft')),

  // Info (blue).
  ...group(['#1E40AF', '#1D4ED8', '#2563EB', '#3B82F6', '#0284C7', '#0369A1', '#0B5CAD', '#0EA5E9'], T('--info')),
  ...group(['#EFF6FF', '#DBEAFE', '#E0F2FE', '#E8F0FE', '#E6F4FF'], T('--info-soft', { border: '--info-border' })),
  ...group(['#BFDBFE', '#BAE6FD', '#7DD3FC'], T('--info-border')),

  // Teal and pink (category colors).
  ...group(['#0F766E', '#0D9488'], T('--teal')),
  ...group(['#CCFBF1', '#E6F7F5', '#E6F7F4', '#99F6E4'], T('--teal-soft')),
  ...group(['#9D174D', '#BE185D', '#EC4899'], T('--pink')),
  ...group(['#FDF2F8', '#FCE7F3', '#FFF7FB', '#FBCFE8', '#F9A8D4'], T('--pink-soft')),
};

/** Where a raw hex may stay: genuine one-offs (brand marks of other companies, print, chart palettes). */
export const ALLOWED_RAW = [
  'frontend/components/landing/',
  'frontend/app/site/',
  'frontend/components/site/',
  'frontend/lib/print-test.ts',
  'frontend/app/icon',
  'frontend/app/apple-icon',
  'frontend/app/opengraph-image',
];
