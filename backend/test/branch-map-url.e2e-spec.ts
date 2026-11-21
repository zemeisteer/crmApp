import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// A branch's map link ends up as a link on the center's public site: only a
// web address is kept ("maps.app.goo.gl/x" becomes https://...); javascript:,
// data: and other schemes are refused; an empty value clears it.
describe('Branch map link (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer() as App);
  const suffix = Date.now();
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api');
    await app.init();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('keeps web addresses, makes a bare one https, refuses other schemes, clears on empty', async () => {
    const token = (
      await http()
        .post('/api/auth/register')
        .send({
          centerName: `BrMap ${suffix}`,
          subdomain: `brmap-${suffix}`,
          email: `brmap-${suffix}@test.uz`,
          password: 'password123',
          fullName: 'Owner',
        })
        .expect(201)
    ).body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    const web = (
      await http()
        .post('/api/branches')
        .set(auth)
        .send({ name: 'Web', mapUrl: 'https://maps.google.com/?q=1' })
        .expect(201)
    ).body;
    expect(web.mapUrl).toBe('https://maps.google.com/?q=1');
    const bare = (
      await http()
        .post('/api/branches')
        .set(auth)
        .send({ name: 'Bare', mapUrl: 'maps.app.goo.gl/xyz' })
        .expect(201)
    ).body;
    expect(bare.mapUrl).toBe('https://maps.app.goo.gl/xyz');

    for (const bad of [
      'javascript:alert(document.cookie)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.uz/map',
      'file:///etc/passwd',
    ]) {
      await http()
        .post('/api/branches')
        .set(auth)
        .send({ name: 'Bad', mapUrl: bad })
        .expect(400);
      await http()
        .patch(`/api/branches/${web.id}`)
        .set(auth)
        .send({ mapUrl: bad })
        .expect(400);
    }
    // Nothing was changed by the refused updates; an empty value clears the link.
    const list = (await http().get('/api/branches').set(auth).expect(200))
      .body as Array<{ id: string; mapUrl: string | null }>;
    expect(list.find((b) => b.id === web.id)?.mapUrl).toBe(
      'https://maps.google.com/?q=1',
    );
    await http()
      .patch(`/api/branches/${web.id}`)
      .set(auth)
      .send({ mapUrl: '' })
      .expect(200);
    const cleared = (await http().get('/api/branches').set(auth).expect(200))
      .body as Array<{ id: string; mapUrl: string | null }>;
    expect(cleared.find((b) => b.id === web.id)?.mapUrl ?? '').toBe('');
  });
});
