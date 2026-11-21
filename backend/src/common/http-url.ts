import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches, ValidateIf } from 'class-validator';

/**
 * A link a person typed, as an http(s) address or null: "maps.app.goo.gl/x"
 * becomes "https://maps.app.goo.gl/x"; "javascript:...", "data:..." and
 * anything that is not a web address give null. Links end up as hrefs on the
 * public site and in the cabinets, so only web addresses are kept.
 */
export function normalizeHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const isWeb = /^https?:\/\//i.test(s);
  // Another scheme (javascript:, data:, ftp://...) is not a web address. A
  // bare "host:8080/path" is, and is told apart by its port.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  const hostWithPort = /^[^\s/:]+:\d{1,5}(?:[/?#]|$)/.test(s);
  if (!isWeb && hasScheme && !hostWithPort) return null;
  const withScheme = isWeb ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * DTO field: empty (to clear it) or a web address. A scheme-less address
 * gets "https://"; anything else that is not http(s) is refused with 400.
 * Put it with the field's @IsOptional() / @IsString() / @MaxLength().
 */
export function HttpUrl() {
  return applyDecorators(
    Transform(({ value }) =>
      typeof value === 'string' && value.trim()
        ? (normalizeHttpUrl(value) ?? value)
        : value,
    ),
    ValidateIf(
      (_o, value) => value !== undefined && value !== null && value !== '',
    ),
    Matches(/^https?:\/\//i, {
      message:
        "Havola http:// yoki https:// bilan boshlanadigan veb-manzil bo'lsin",
    }),
  );
}
