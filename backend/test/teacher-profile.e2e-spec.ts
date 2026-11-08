import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// What the center's site shows about a teacher: their own score, years of
// teaching and a photo; set on create and edit, cleared with "".
describe('Teacher profile on the site (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer() as App);
  const suffix = Date.now();
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('saved, shown on the site, edited and cleared; a bad photo name is refused', async () => {
    const sub = `tprof-${suffix}`;
    const token = (await http().post('/api/auth/register')
      .send({ centerName: `TP ${suffix}`, subdomain: sub, email: `${sub}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };
    const t = (await http().post('/api/teachers').set(auth).send({ fullName: 'Profile T', subject: 'Ingliz tili', score: 'IELTS 8.0', experienceYears: 6, photoPath: 'abcdefgh12345678.jpg' }).expect(201)).body;
    expect(t).toMatchObject({ score: 'IELTS 8.0', experienceYears: 6, photoPath: 'abcdefgh12345678.jpg' });
    const site = (await http().get(`/api/tenants/by-subdomain/${sub}/public-showcase`).expect(200)).body;
    expect(site.teachers[0]).toMatchObject({ fullName: 'Profile T', score: 'IELTS 8.0', experienceYears: 6, photoPath: 'abcdefgh12345678.jpg' });
    expect(site.teachers[0].salaryValue).toBeUndefined();

    const edited = (await http().patch(`/api/teachers/${t.id}`).set(auth).send({ score: '', photoPath: '', experienceYears: 7 }).expect(200)).body;
    expect(edited).toMatchObject({ score: null, photoPath: null, experienceYears: 7 });
    await http().patch(`/api/teachers/${t.id}`).set(auth).send({ photoPath: '../../etc/passwd' }).expect(400);
    await http().post('/api/teachers').set(auth).send({ fullName: 'X', experienceYears: 99 }).expect(400);
  });
});
