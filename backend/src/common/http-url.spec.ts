import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validate } from 'class-validator';
import { HttpUrl, normalizeHttpUrl } from './http-url';

class Dto {
  @IsOptional()
  @IsString()
  @HttpUrl()
  link?: string | null;
}

const check = async (link: unknown) => {
  const dto = plainToInstance(Dto, { link });
  return { errors: await validate(dto), value: dto.link };
};

describe('normalizeHttpUrl', () => {
  it('keeps web addresses, adds https:// to a bare one, and drops everything else', () => {
    expect(normalizeHttpUrl('https://zoom.us/j/123')).toBe(
      'https://zoom.us/j/123',
    );
    expect(normalizeHttpUrl('http://example.uz/a')).toBe('http://example.uz/a');
    expect(normalizeHttpUrl('  maps.app.goo.gl/xyz  ')).toBe(
      'https://maps.app.goo.gl/xyz',
    );
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:x',
      'ftp://example.uz',
      'file:///etc/passwd',
      '',
      '   ',
      null,
      42,
    ]) {
      expect(normalizeHttpUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('@HttpUrl()', () => {
  it('accepts a web address and a bare one (made https), and an empty value to clear it', async () => {
    expect((await check('https://zoom.us/j/1')).errors).toEqual([]);
    const bare = await check('maps.app.goo.gl/x');
    expect(bare.errors).toEqual([]);
    expect(bare.value).toBe('https://maps.app.goo.gl/x');
    expect((await check('')).errors).toEqual([]);
    expect((await check(undefined)).errors).toEqual([]);
    expect((await check(null)).errors).toEqual([]);
  });

  it('refuses javascript:, data: and other schemes', async () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://example.uz/x',
      'file:///etc/passwd',
    ]) {
      const r = await check(bad);
      expect(r.errors, bad).toHaveLength(1);
    }
  });
});
