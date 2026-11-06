import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { isNewGroup } from '../src/groups/new-group';

// New groups are shown on the center's site ("our new groups") and on the
// staff dashboard; an individual group (one student, times agreed with the
// teacher) keeps one seat, needs no days or time, and is never advertised.
describe('New and individual groups (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const sub = `newgrp-${suffix}`;
  let token = '';
  let teacherId = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ centerName: `NewGrp ${suffix}`, subdomain: sub, email: `${sub}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    teacherId = (await http().post('/api/teachers').set(auth())
      .send({ fullName: 'New Teacher', subject: 'English', phone: '+998905550077' }).expect(201)).body.id;
  });
  afterAll(async () => { await app?.close(); });

  it('a fresh group is new on the site and the dashboard; an individual one is on neither', async () => {
    const group = (await http().post('/api/groups').set(auth())
      .send({ name: 'Fresh English', subject: 'English', teacherId, monthlyPrice: 400000, maxStudents: 12, scheduleDays: 'MON,WED', startTime: '10:00', endTime: '11:30', startDate: '2026-12-01' })
      .expect(201)).body;
    const solo = (await http().post('/api/groups').set(auth())
      .send({ name: 'Solo IELTS', subject: 'English', teacherId, monthlyPrice: 1200000, maxStudents: 15, isIndividual: true })
      .expect(201)).body;
    expect(solo).toMatchObject({ isIndividual: true, maxStudents: 1 });
    expect(group.isIndividual).toBe(false);

    const site = (await http().get(`/api/tenants/by-subdomain/${sub}/public-showcase`).expect(200)).body;
    expect(site.groups.map((g: { name: string }) => g.name)).toEqual(['Fresh English']);
    expect(site.groups[0]).toMatchObject({ isNew: true });

    const dash = (await http().get('/api/reports/dashboard').set(auth()).expect(200)).body;
    expect(dash.newGroups.map((g: { name: string }) => g.name)).toEqual(['Fresh English']);
    expect(dash.newGroups[0]).toMatchObject({ students: 0, maxStudents: 12 });
  });

  it('an individual group stays at one seat when edited', async () => {
    const solo = (await http().post('/api/groups').set(auth())
      .send({ name: 'Solo Math', subject: 'Math', teacherId, monthlyPrice: 900000, isIndividual: true }).expect(201)).body;
    const edited = (await http().patch(`/api/groups/${solo.id}`).set(auth()).send({ maxStudents: 10, isIndividual: true }).expect(200)).body;
    expect(edited.maxStudents).toBe(1);
    const back = (await http().patch(`/api/groups/${solo.id}`).set(auth()).send({ isIndividual: false, maxStudents: 10 }).expect(200)).body;
    expect(back).toMatchObject({ isIndividual: false, maxStudents: 10 });
  });

  it('new: opened in the last 30 days, or starting later', () => {
    const now = Date.parse('2026-11-06T00:00:00Z');
    const day = 86_400_000;
    expect(isNewGroup({ createdAt: new Date(now - 5 * day), startDate: null }, now)).toBe(true);
    expect(isNewGroup({ createdAt: new Date(now - 60 * day), startDate: null }, now)).toBe(false);
    expect(isNewGroup({ createdAt: new Date(now - 60 * day), startDate: new Date(now + 3 * day) }, now)).toBe(true);
  });
});
