import { describe, it, expect } from 'vitest';
import { trustProxySetting } from './app.setup';

describe('trustProxySetting', () => {
  it('is off by default (direct access ignores X-Forwarded-For)', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('0')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
  });
  it('counts a fixed number of proxies when set', () => {
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('2')).toBe(2);
  });
  it('passes a non-numeric value through to Express', () => {
    expect(trustProxySetting('loopback')).toBe('loopback');
  });
});
