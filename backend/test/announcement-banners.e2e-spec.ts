import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Dashboard banners: urgent/important staff announcements until each user
// reads or dismisses them; never the author's own, never student-only ones.
describe('Announcement banners on the staff dashboard (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    tokens.OWNER = (await http().post('/api/auth/register')
      .send({ centerName: `Banners ${suffix}`, subdomain: `banners-${suffix}`, email: `banners-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    for (const [who, role] of [['T1', 'TEACHER'], ['ACC', 'ACCOUNTANT']]) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `banner-${who.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      tokens[who] = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${who} user`, password: 'password12345' }).expect(201)).body.accessToken;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('shows unread urgent staff announcements until read, per user', async () => {
    const post = (title: string, priority: string, targetAudience = 'ALL') =>
      http().post('/api/announcements').set(as('OWNER')).send({ title, content: `${title} text`, priority, targetAudience }).expect(201);
    const urgent = (await post('Fire drill', 'URGENT')).body;
    await post('Meeting', 'HIGH', 'TEACHERS');
    await post('Holiday', 'NORMAL');
    await post('Exam week', 'URGENT', 'STUDENTS');

    const titles = async (who: string) => (await http().get('/api/announcements/banners').set(as(who)).expect(200)).body.map((b: { title: string }) => b.title);
    expect((await titles('T1')).sort()).toEqual(['Fire drill', 'Meeting']);
    expect(await titles('OWNER')).toEqual([]); // their own
    expect((await titles('ACC')).sort()).toEqual(['Fire drill', 'Meeting']);

    await http().post(`/api/announcements/${urgent.id}/read`).set(as('T1')).expect(201);
    await http().post(`/api/announcements/${urgent.id}/read`).set(as('T1')).expect(201); // idempotent
    expect(await titles('T1')).toEqual(['Meeting']);
    expect((await titles('ACC')).sort()).toEqual(['Fire drill', 'Meeting']);
    await http().post('/api/announcements/nope/read').set(as('T1')).expect(404);
  });
});
