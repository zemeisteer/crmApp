import { BadRequestException } from '@nestjs/common';
import { idempotencyKey, normalizeForHash, requestHash } from './create-idempotency';

describe('create idempotency: the normalization rules', () => {
  it('treats an empty string, null, whitespace and an omitted field the same', () => {
    const h = (p: object) => requestHash('student.create', p);
    expect(h({ fullName: 'A', phone: '' })).toBe(h({ fullName: 'A' }));
    expect(h({ fullName: 'A', phone: null })).toBe(h({ fullName: 'A', phone: '   ' }));
    expect(h({ fullName: ' A ' })).toBe(h({ fullName: 'A' }));
  });

  it('compares group selections as sets', () => {
    const h = (groupIds: string[]) => requestHash('student.create', { fullName: 'A', groupIds });
    expect(h(['g2', 'g1', 'g1'])).toBe(h(['g1', 'g2']));
    expect(h(['g1'])).not.toBe(h(['g2']));
    expect(h([])).toBe(requestHash('student.create', { fullName: 'A' }));
  });

  it('distinguishes material fields, field order does not matter', () => {
    expect(requestHash('t', { a: 1, b: 'x' })).toBe(requestHash('t', { b: 'x', a: 1 }));
    expect(requestHash('t', { a: 1 })).not.toBe(requestHash('t', { a: 2 }));
    expect(requestHash('t', { email: 'a@x' })).not.toBe(requestHash('t', { email: 'b@x' }));
  });

  it('keeps operations apart', () => {
    expect(requestHash('student.create', { fullName: 'A' })).not.toBe(requestHash('teacher.create', { fullName: 'A' }));
  });

  it('accepts a missing key and refuses a malformed one', () => {
    expect(idempotencyKey(undefined)).toBeNull();
    expect(idempotencyKey('  ')).toBeNull();
    expect(idempotencyKey(' abcdefgh ')).toBe('abcdefgh');
    expect(() => idempotencyKey('short')).toThrow(BadRequestException);
    expect(() => idempotencyKey('x'.repeat(121))).toThrow(BadRequestException);
  });

  it('normalizes nested values', () => {
    expect(normalizeForHash({ a: { b: '', c: ' d ' } })).toEqual({ a: { c: 'd' } });
  });
});
