import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { EmailService } from '../src/email/email.service.js';

// Public application form on a center's website (POST
// /tenants/by-subdomain/:subdomain/apply). The route allows 5 requests per
// minute per IP, and every test file boots its own app (own throttle
// store), so this file stays at 5 apply calls.
describe('Public application form (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let subdomain: string;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const sentEmails: { to: string; subject: string }[] = [];

  const apply = (body: Record<string, unknown>) =>
    http().post(`/api/tenants/by-subdomain/${subdomain}/apply`).send({
      consent: true,
      formStartedAt: Date.now() - 10_000,
      ...body,
    });
  const leadsByName = async (name: string) =>
    (await http().get(`/api/leads?search=${encodeURIComponent(name)}&includeArchived=true`).set('Authorization', `Bearer ${token}`).expect(200)).body.items;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    vi.spyOn(app.get(EmailService), 'send').mockImplementation(async (to: string, subject: string) => {
      sentEmails.push({ to, subject });
    });

    subdomain = `apply-${suffix}`;
    const res = await http()
      .post('/api/auth/register')
      .send({ centerName: `Apply ${suffix}`, subdomain, email: `apply-${suffix}@test.uz`, password: 'password123', fullName: 'Apply Owner' })
      .expect(201);
    token = res.body.accessToken;
    await http().post('/api/subjects').set('Authorization', `Bearer ${token}`).send({ name: 'Ingliz tili' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a WEBSITE lead with subject match and UTM, returns no internal id, and notifies the owner', async () => {
    const res = await apply({
      fullName: 'Web Applicant', phone: '90 555 11 22', subject: 'ingliz tili', notes: 'Kechqurun',
      utmSource: 'instagram', utmCampaign: 'autumn',
    }).expect(201);
    expect(res.body).toEqual({ success: true, message: expect.any(String) });

    const [lead] = await leadsByName('Web Applicant');
    expect(lead).toMatchObject({ source: 'WEBSITE', status: 'NEW', phoneNormalized: '+998905551122' });
    expect(lead.desiredSubject?.name).toBe('Ingliz tili');

    const timeline = await http().get(`/api/leads/${lead.id}/timeline`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(timeline.body.at(-1).metadata).toMatchObject({ kind: 'CREATED', utm: { source: 'instagram', campaign: 'autumn' } });

    await new Promise((r) => setTimeout(r, 300));
    expect(sentEmails.some((m) => m.to === `apply-${suffix}@test.uz` && m.subject.includes('Web Applicant'))).toBe(true);
  });

  it('appends a repeat application to the existing lead instead of duplicating it', async () => {
    await apply({ fullName: 'Web Applicant Again', phone: '+998905551122' }).expect(201);
    const leads = await leadsByName('+998905551122');
    expect(leads).toHaveLength(1);
    const timeline = await http().get(`/api/leads/${leads[0].id}/timeline`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(timeline.body.some((a: { metadata?: { kind?: string } }) => a.metadata?.kind === 'PUBLIC_REAPPLY')).toBe(true);
  });

  it('silently drops bot submissions (honeypot or too fast) with the normal answer', async () => {
    const honeypot = await apply({ fullName: 'Bot One', phone: '+998905551133', website: 'http://spam.example' }).expect(201);
    expect(honeypot.body.success).toBe(true);
    const tooFast = await apply({ fullName: 'Bot Two', phone: '+998905551144', formStartedAt: Date.now() }).expect(201);
    expect(tooFast.body.success).toBe(true);
    expect(await leadsByName('Bot One')).toHaveLength(0);
    expect(await leadsByName('Bot Two')).toHaveLength(0);
  });

  it('requires consent', async () => {
    await apply({ fullName: 'No Consent', phone: '+998905551155', consent: false }).expect(400);
    expect(await leadsByName('No Consent')).toHaveLength(0);
  });
});
