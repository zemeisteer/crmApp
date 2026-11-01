export interface PlatformCard {
  number: string;
  holder: string;
}

export const MAX_PLATFORM_CARDS = 10;

/** "8600123412341234" -> "8600 1234 1234 1234". */
const groupCard = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');
export const cardDigits = (number: string) => number.replace(/\D/g, '');

function normalize(raw: unknown): PlatformCard | null {
  const { number, holder } = (raw ?? {}) as { number?: unknown; holder?: unknown };
  const digits = typeof number === 'string' ? cardDigits(number) : '';
  const name = typeof holder === 'string' ? holder.trim() : '';
  return digits.length === 16 && name && name.length <= 100 ? { number: groupCard(digits), holder: name } : null;
}

/**
 * The value the panel saves as PLATFORM_CARDS, checked and tidied. null when
 * anything in it is wrong: where centers send money is not saved half right.
 */
export function cleanPlatformCards(value: string): string | null {
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PLATFORM_CARDS) return null;
  const cards = list.map(normalize);
  if (cards.some((c) => !c)) return null;
  if (new Set(cards.map((c) => c!.number)).size !== cards.length) return null;
  return JSON.stringify(cards);
}

/**
 * The cards centers can pay to, in the panel's order: PLATFORM_CARDS, or the
 * single PLATFORM_CARD_NUMBER / PLATFORM_CARD_HOLDER pair of a server set up
 * before there could be several.
 */
export function platformCards(list: string | undefined, number: string | undefined, holder: string | undefined): PlatformCard[] {
  const clean = list?.trim() ? cleanPlatformCards(list) : null;
  if (clean) return JSON.parse(clean) as PlatformCard[];
  const single = normalize({ number, holder });
  return single ? [single] : [];
}
