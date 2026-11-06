import { describe, expect, it } from 'vitest';
import { cleanPlatformCards, MAX_PLATFORM_CARDS, platformCards } from './platform-cards';

const a = { number: '9860123456789012', holder: ' Anna ' };
const b = { number: '8600 1111 2222 3333', holder: 'Bek' };

describe('platform cards', () => {
  it('tidies a good list and keeps its order', () => {
    expect(JSON.parse(cleanPlatformCards(JSON.stringify([a, b]))!)).toEqual([
      { number: '9860 1234 5678 9012', holder: 'Anna' },
      { number: '8600 1111 2222 3333', holder: 'Bek' },
    ]);
  });

  it.each([
    ['not json', 'x'],
    ['not a list', JSON.stringify(a)],
    ['empty', '[]'],
    ['a short number', JSON.stringify([a, { number: '8600', holder: 'Bek' }])],
    ['no holder', JSON.stringify([{ number: b.number, holder: ' ' }])],
    ['the same card twice', JSON.stringify([a, { ...a, number: '9860 1234 5678 9012' }])],
    ['too many', JSON.stringify(Array.from({ length: MAX_PLATFORM_CARDS + 1 }, (_, i) => ({ number: String(1000000000000000 + i), holder: 'X' })))],
  ])('refuses %s', (_name, value) => {
    expect(cleanPlatformCards(value)).toBeNull();
  });

  it('the list wins; without one the old single card still works', () => {
    expect(platformCards(JSON.stringify([b]), a.number, a.holder).map((c) => c.holder)).toEqual(['Bek']);
    expect(platformCards(undefined, a.number, a.holder)).toEqual([{ number: '9860 1234 5678 9012', holder: 'Anna' }]);
    expect(platformCards('', undefined, undefined)).toEqual([]);
  });
});
