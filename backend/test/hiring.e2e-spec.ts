import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Teacher hiring: a candidate goes through test, interview and demo lesson,
// and a hired one becomes a teacher once. A candidate test filed by phone
// lands on the candidate's card, not among admissions leads.
describe('Teacher hiring (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer());
  let owner: Record<string, string>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Hire ${suffix}`, subdomain: `hire-${suffix}`, email: `hire-${suffix}@test.uz`, password: 'password123', fullName: 'Hire Owner' })
      .expect(201)).body;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('moves a candidate through the stages and makes them a teacher, once', async () => {
    const c = (await http().post('/api/hiring/candidates').set(owner).send({ fullName: 'Dilnoza Karimova', phone: `+99890${tail}`, subject: 'Ingliz tili', source: 'Telegram' }).expect(201)).body;
    expect(c.stage).toBe('NEW');

    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ stage: 'INTERVIEW', interviewAt: '2026-11-03T10:00:00.000Z', interviewScore: 4, interviewNotes: 'Yaxshi gapiradi' }).expect(200);
    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ stage: 'DEMO', demoScore: 5 }).expect(200);
    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ stage: 'HIRED' }).expect(400); // only through "make a teacher"
    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ interviewScore: 9 }).expect(400);

    const list = (await http().get('/api/hiring/candidates').set(owner).expect(200)).body;
    expect(list.counts.DEMO).toBe(1);
    expect(list.items[0]).not.toHaveProperty('phoneNormalized');

    const hired = (await http().post(`/api/hiring/candidates/${c.id}/hire`).set(owner).expect(201)).body;
    expect(hired.candidate.stage).toBe('HIRED');
    expect(hired.candidate.history.map((h: { stage: string }) => h.stage)).toEqual(['NEW', 'INTERVIEW', 'DEMO', 'HIRED']);
    const teacher = (await http().get(`/api/teachers/${hired.teacherId}`).set(owner).expect(200)).body;
    expect(teacher).toMatchObject({ fullName: 'Dilnoza Karimova', subject: 'Ingliz tili' });
    // Pressed again: the same teacher, not a second one.
    expect((await http().post(`/api/hiring/candidates/${c.id}/hire`).set(owner).expect(201)).body.teacherId).toBe(hired.teacherId);
    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ stage: 'REJECTED' }).expect(409);
  });

  it('a rejected candidate cannot be hired; archived ones leave the list', async () => {
    const c = (await http().post('/api/hiring/candidates').set(owner).send({ fullName: 'Rad Etilgan' }).expect(201)).body;
    await http().patch(`/api/hiring/candidates/${c.id}`).set(owner).send({ stage: 'REJECTED', decisionNote: 'Tajriba yetmaydi' }).expect(200);
    await http().post(`/api/hiring/candidates/${c.id}/hire`).set(owner).expect(400);
    await http().delete(`/api/hiring/candidates/${c.id}`).set(owner).expect(200);
    const list = (await http().get('/api/hiring/candidates?stage=REJECTED').set(owner).expect(200)).body;
    expect(list.items.find((x: { id: string }) => x.id === c.id)).toBeUndefined();
    await http().get(`/api/hiring/candidates/${c.id}`).set(owner).expect(404);
  });

  it('a candidate test is filed on the candidate with that phone, and is not an admissions lead', async () => {
    const phone = `+99891${tail}`;
    const c = (await http().post('/api/hiring/candidates').set(owner).send({ fullName: 'Test Topshiruvchi', phone }).expect(201)).body;
    const test = (await http().post('/api/placement-tests').set(owner).send({
      subject: 'Matematika', audience: 'CANDIDATE',
      questions: [
        { type: 'MCQ', prompt: '2+2?', options: ['3', '4'], correctAnswer: 'B', level: 1 },
        { type: 'MCQ', prompt: '3*3?', options: ['9', '6'], correctAnswer: 'A', level: 1 },
      ],
    }).expect(201)).body;
    expect(test.audience).toBe('CANDIDATE');
    // The candidates' tests are listed apart from the applicants' ones.
    expect((await http().get('/api/placement-tests').set(owner).expect(200)).body.some((x: { id: string }) => x.id === test.id)).toBe(false);
    expect((await http().get('/api/placement-tests?audience=CANDIDATE').set(owner).expect(200)).body.some((x: { id: string }) => x.id === test.id)).toBe(true);

    await http().post(`/api/public/placement/${test.token}/submit`).send({ fullName: 'Test Topshiruvchi', phone: phone.replace('+998', ''), answers: ['B', 'B'] }).expect(201);
    const card = (await http().get(`/api/hiring/candidates/${c.id}`).set(owner).expect(200)).body;
    expect({ stage: card.stage, testPercent: card.testPercent, n: card.attempts.length }).toEqual({ stage: 'TEST', testPercent: 50, n: 1 });
    expect(card.attempts).toHaveLength(1);
    const leads = (await http().get('/api/leads?search=Topshiruvchi').set(owner).expect(200)).body;
    expect(JSON.stringify(leads)).not.toContain('Test Topshiruvchi');

    // An unknown phone makes a new candidate.
    await http().post(`/api/public/placement/${test.token}/submit`).send({ fullName: 'Yangi Nomzod', phone: `+99893${tail}`, answers: ['B', 'A'] }).expect(201);
    const fresh = (await http().get('/api/hiring/candidates?q=Yangi').set(owner).expect(200)).body.items[0];
    expect(fresh).toMatchObject({ fullName: 'Yangi Nomzod', stage: 'TEST', testPercent: 100, source: 'TEST' });
  });

  it('teachers and receptionists do not see hiring', async () => {
    await http().post('/api/staff').set(owner).send({ email: `hire-r-${suffix}@test.uz`, fullName: 'Reception', role: 'RECEPTIONIST', password: 'password12345' }).expect(201);
    const r = (await http().post('/api/auth/login').send({ email: `hire-r-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/hiring/candidates').set({ Authorization: `Bearer ${r}` }).expect(403);
  });
});
