import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeEmail, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('treats the common Uzbek formats as the same number', () => {
    const forms = ['+998901234567', '998901234567', '90 123 45 67', '+998 (90) 123-45-67', '901234567', '00998901234567'];
    for (const f of forms) expect(normalizePhone(f), f).toBe('+998901234567');
  });

  it('keeps international numbers intact', () => {
    expect(normalizePhone('+7 912 345 67 89')).toBe('+79123456789');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('does not reinterpret a +-prefixed 9-digit number as Uzbek', () => {
    expect(normalizePhone('+901234567')).toBe('+901234567');
  });

  it('rejects empty and implausible values', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
  });
});

describe('normalizeEmail / maskPhone', () => {
  it('lowercases and trims email', () => {
    expect(normalizeEmail('  Ali@Example.UZ ')).toBe('ali@example.uz');
    expect(normalizeEmail('   ')).toBeNull();
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('+998901234567')).toBe('***4567');
    expect(maskPhone(null)).toBe('-');
  });
});
