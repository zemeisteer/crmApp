import { describe, it, expect } from 'vitest';
import { redactUrl, redactQuery } from './log-redact';

describe('redactUrl', () => {
  it('masks the invitation and placement token in the path', () => {
    expect(redactUrl('/api/invitations/abc123deadbeef/accept')).toBe('/api/invitations/[redacted]/accept');
    expect(redactUrl('/api/invitations/abc123deadbeef/validate')).toBe('/api/invitations/[redacted]/validate');
    expect(redactUrl('/api/public/placement/sometoken/submit')).toBe('/api/public/placement/[redacted]/submit');
  });
  it('masks token / code / password in the query', () => {
    expect(redactUrl('/api/auth/verify-email?token=secretvalue')).toBe('/api/auth/verify-email?token=[redacted]');
    expect(redactUrl('/api/x?code=abc&keep=1')).toBe('/api/x?code=[redacted]&keep=1');
  });
  it('leaves ordinary paths and non-secret queries untouched', () => {
    expect(redactUrl('/api/students?status=ACTIVE')).toBe('/api/students?status=ACTIVE');
    expect(redactUrl('/api/health')).toBe('/api/health');
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe('redactQuery', () => {
  it('masks secret keys only', () => {
    expect(redactQuery({ token: 'x', status: 'ACTIVE' })).toEqual({ token: '[redacted]', status: 'ACTIVE' });
    expect(redactQuery(undefined)).toBeUndefined();
  });
});
