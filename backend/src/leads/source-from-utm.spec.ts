import { describe, expect, it } from 'vitest';
import { sourceFromUtm } from './leads.service';

describe('sourceFromUtm', () => {
  it('names the networks an ad link says, case and spaces aside', () => {
    expect(sourceFromUtm('Instagram')).toBe('INSTAGRAM');
    expect(sourceFromUtm(' ig ')).toBe('INSTAGRAM');
    expect(sourceFromUtm('tg')).toBe('TELEGRAM');
    expect(sourceFromUtm('facebook')).toBe('ADVERTISEMENT');
    expect(sourceFromUtm('google')).toBe('ADVERTISEMENT');
  });
  it('a plain visit or an unknown tag stays WEBSITE', () => {
    expect(sourceFromUtm(undefined)).toBe('WEBSITE');
    expect(sourceFromUtm('')).toBe('WEBSITE');
    expect(sourceFromUtm('newsletter')).toBe('WEBSITE');
  });
});
