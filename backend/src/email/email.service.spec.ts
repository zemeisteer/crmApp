import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';

const config = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any;

describe('EmailService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends through Resend when RESEND_API_KEY is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new EmailService(config({ RESEND_API_KEY: 're_test_123', EMAIL_FROM: 'Markaz <info@markaz.uz>' }));
    expect(svc.provider).toBe('resend');

    await svc.send('a@b.uz', 'Salom', 'Matn');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test_123');
    expect(JSON.parse(init.body)).toEqual({ from: 'Markaz <info@markaz.uz>', to: ['a@b.uz'], subject: 'Salom', text: 'Matn' });
  });

  it('does not throw when Resend rejects or is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'domain not verified' }));
    const svc = new EmailService(config({ RESEND_API_KEY: 're_x' }));
    await expect(svc.send('a@b.uz', 's', 't')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(svc.send('a@b.uz', 's', 't')).resolves.toBeUndefined();
  });

  it('prefers Resend over SMTP and falls back to logging with neither', () => {
    expect(new EmailService(config({ RESEND_API_KEY: 're_x', SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p' })).provider).toBe('resend');
    expect(new EmailService(config({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p' })).provider).toBe('smtp');
    const none = new EmailService(config({}));
    expect(none.provider).toBe('none');
    expect(none.isConfigured).toBe(false);
  });
});
