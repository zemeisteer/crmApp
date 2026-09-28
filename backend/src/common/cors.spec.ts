import { describe, it, expect } from 'vitest';
import { corsOriginChecker } from './cors';

describe('corsOriginChecker', () => {
  const prod = corsOriginChecker({ ROOT_DOMAIN: 'talimcrm.uz', FRONTEND_URL: 'https://app.example.com', NODE_ENV: 'production' });

  it('allows the main domain, center subdomains and FRONTEND_URL over https', () => {
    expect(prod('https://talimcrm.uz')).toBe(true);
    expect(prod('https://ilmmarkazi.talimcrm.uz')).toBe(true);
    expect(prod('https://app.example.com')).toBe(true);
    expect(prod(undefined)).toBe(true);
  });

  it('rejects other sites, look-alikes, nested labels and plain http', () => {
    expect(prod('https://evil.com')).toBe(false);
    expect(prod('https://talimcrm.uz.evil.com')).toBe(false);
    expect(prod('https://eviltalimcrm.uz')).toBe(false);
    expect(prod('https://a.b.talimcrm.uz')).toBe(false);
    expect(prod('http://ilmmarkazi.talimcrm.uz')).toBe(false);
    expect(prod('http://localhost:3000')).toBe(false);
    expect(prod('null')).toBe(false);
  });

  it('allows localhost and *.localhost in development', () => {
    const dev = corsOriginChecker({ NODE_ENV: 'development' });
    expect(dev('http://localhost:3000')).toBe(true);
    expect(dev('http://ilmmarkazi2.localhost:3000')).toBe(true);
    expect(dev('https://evil.com')).toBe(false);
  });
});
