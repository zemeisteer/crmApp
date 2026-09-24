// Contact normalization used for duplicate detection. Keep normalizePhone in
// sync with the SQL backfill in drizzle/0003_admissions_crm.sql.
//
// Uzbek numbers written as +998 90 123 45 67, 998901234567 or 90 123 45 67
// all become +998901234567. Anything else with 8–15 digits is treated as an
// international number and kept as +<digits>, so foreign numbers still work.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length === 9 && !trimmed.startsWith('+')) return `+998${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

// For logs: enough to correlate, never the full contact detail.
export function maskPhone(normalized: string | null | undefined): string {
  if (!normalized) return '-';
  return `***${normalized.slice(-4)}`;
}
