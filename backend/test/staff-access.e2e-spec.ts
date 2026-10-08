import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../src/app.module.js';
import { RouteAccessService } from '../src/access/route-access.js';
import { ACCESS_CATALOG, CONFIGURABLE_ROLES, accessKeyFor, templateFor } from '../src/access/catalog.js';

// A staff member's own access list: the owner turns things on or off, and
// the server does exactly what the list says - no more (a removed item is
// refused), no less (an added item works). Without a list, a role does
// exactly what it did before lists existed.
describe('Staff access lists (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const setAccess = (role: string, access: string[] | null) =>
    http().patch(`/api/staff/${userIds[role]}`).set(as('OWNER')).send({ access }).expect(200);
  const call = (role: string, route: string) => {
    const [method, path] = route.split(' ');
    const url = path.replace(/:[A-Za-z]+/g, (p) => (p === ':kind' ? 'students' : 'nonexistent-id'));
    return http()[method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'](url).set(as(role)).send({});
  };

  beforeAll(async () => {
    // Hundreds of requests from one address; the rate limit is not what is tested here.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Access ${suffix}`, subdomain: `sacc-${suffix}`, email: `sacc-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
    tokens.OWNER = reg.accessToken;
    for (const role of [...CONFIGURABLE_ROLES, 'ADMIN']) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `sacc-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      const acc = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${role} user`, password: 'password12345' }).expect(201)).body;
      tokens[role] = acc.accessToken;
      userIds[role] = acc.user.id;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the catalog is the route rules: every route exists, is guarded, and each default is what the role could already do', () => {
    const routes = app.get(RouteAccessService);
    const problems: string[] = [];
    for (const k of ACCESS_CATALOG) {
      for (const id of k.routes) {
        const [method, path] = id.split(' ');
        const route = routes.find(method, path);
        if (!route) { problems.push(`${k.key}: no route ${id}`); continue; }
        if (!route.rolesGuard && !route.permissionsGuard) problems.push(`${k.key}: ${id} has no role guard`);
        for (const role of CONFIGURABLE_ROLES) {
          if (RouteAccessService.allows(route, role) !== k.template.includes(role)) problems.push(`${k.key} ${role}: default says ${k.template.includes(role)} for ${id}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every staff route open to these roles is either in the catalog or deliberately fixed', () => {
    // Basics every staff member needs, and inviting (kept to managers).
    const FIXED = new Set([
      'GET /api/feature-flags', 'GET /api/telegram/me', 'POST /api/telegram/me/link', 'DELETE /api/telegram/me', 'GET /api/telegram/status', 'POST /api/telegram/link-token',
      'POST /api/auth/handoff', 'GET /api/branches', 'GET /api/reports/dashboard', 'GET /api/reports/students-summary', 'GET /api/announcements/banners',
      'POST /api/announcements/:id/read', 'POST /api/invitations', 'GET /api/invitations', 'GET /api/subjects', 'GET /api/subjects/courses', 'GET /api/subjects/:id',
      // Links to uploaded files: open to all staff, each file checked against
      // the record it belongs to and the caller's own list (files.service.ts).
      'POST /api/files/sign',
      // The center's custom-field definitions: every form needs them to render.
      'GET /api/custom-fields',
    ]);
    const unclassified = app.get(RouteAccessService).routes()
      .filter((r) => (r.rolesGuard || r.permissionsGuard) && CONFIGURABLE_ROLES.some((role) => RouteAccessService.allows(r, role)))
      .map((r) => `${r.method} ${r.path}`)
      .filter((id) => !accessKeyFor(id) && !FIXED.has(id));
    expect(unclassified).toEqual([]);
  });

  it('each item, added to a role that lacks it, works; removed from a role that has it, is refused', async () => {
    const wrong: string[] = [];
    // Items that are rules rather than routes are checked on their own below.
    for (const k of ACCESS_CATALOG.filter((x) => x.routes.length > 0)) {
      const route = k.routes[0];
      const lacking = CONFIGURABLE_ROLES.find((r) => !k.template.includes(r));
      if (lacking) {
        await setAccess(lacking, [...templateFor(lacking), k.key]);
        const res = await call(lacking, route);
        if (res.status === 403) wrong.push(`added ${k.key} to ${lacking}: ${route} -> 403 ${res.body?.message ?? ''}`);
        await setAccess(lacking, null);
      }
      const having = k.template[0];
      if (having) {
        await setAccess(having, templateFor(having).filter((x) => x !== k.key));
        const res = await call(having, route);
        if (res.status !== 403) wrong.push(`removed ${k.key} from ${having}: ${route} -> ${res.status}`);
        await setAccess(having, null);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("teachers' pay shows to those whose list has it, whatever their role", async () => {
    await http().post('/api/teachers').set(as('OWNER')).send({ fullName: 'Paid Teacher', subject: 'Math', salaryType: 'FIXED', salaryValue: 3_000_000 }).expect(201);
    const pay = async (role: string) => {
      const list = (await http().get('/api/teachers').set(as(role)).expect(200)).body as Array<{ fullName: string; salaryValue?: number }>;
      return list.find((x) => x.fullName === 'Paid Teacher')?.salaryValue;
    };
    expect(await pay('ACCOUNTANT')).toBe(3_000_000);
    expect(await pay('MANAGER')).toBeUndefined();
    await setAccess('MANAGER', [...templateFor('MANAGER'), 'payroll.rates']);
    expect(await pay('MANAGER')).toBe(3_000_000);
    await setAccess('ACCOUNTANT', templateFor('ACCOUNTANT').filter((k) => k !== 'payroll.rates'));
    expect(await pay('ACCOUNTANT')).toBeUndefined();
    await setAccess('MANAGER', null);
    await setAccess('ACCOUNTANT', null);
    expect(await pay('MANAGER')).toBeUndefined();
    expect(await pay('ACCOUNTANT')).toBe(3_000_000);
  });

  it('back to the default (null): the role does what it did before', async () => {
    await setAccess('ACCOUNTANT', templateFor('ACCOUNTANT').filter((k) => k !== 'payments.take'));
    expect((await call('ACCOUNTANT', 'POST /api/payments')).status).toBe(403);
    await setAccess('ACCOUNTANT', null);
    expect((await call('ACCOUNTANT', 'POST /api/payments')).status).not.toBe(403);
  });

  it('the staff list and /auth/me show what a member may do', async () => {
    await setAccess('RECEPTIONIST', [...templateFor('RECEPTIONIST'), 'payments.take']);
    const staff = (await http().get('/api/staff').set(as('OWNER')).expect(200)).body;
    const rec = staff.find((s: { id: string }) => s.id === userIds.RECEPTIONIST);
    expect(rec.access).toContain('payments.take');
    expect(rec.effectiveAccess).toEqual(rec.access);
    const teacher = staff.find((s: { id: string }) => s.id === userIds.TEACHER);
    expect(teacher.access).toBeNull();
    expect(teacher.effectiveAccess).toEqual(templateFor('TEACHER'));
    const me = (await http().get('/api/auth/me').set(as('RECEPTIONIST')).expect(200)).body;
    expect(me.user.access).toContain('payments.take');
    const ownerMe = (await http().get('/api/auth/me').set(as('OWNER')).expect(200)).body;
    expect(ownerMe.user.access).toHaveLength(ACCESS_CATALOG.length);
    await setAccess('RECEPTIONIST', null);
  });

  it('lists are checked: known items only, never for admins or the owner; a new role starts from its default', async () => {
    await http().patch(`/api/staff/${userIds.TEACHER}`).set(as('OWNER')).send({ access: ['no.such.thing'] }).expect(400);
    await http().patch(`/api/staff/${userIds.ADMIN}`).set(as('OWNER')).send({ access: ['students.view'] }).expect(400);
    const ownerId = (await http().get('/api/auth/me').set(as('OWNER')).expect(200)).body.user.id;
    await http().patch(`/api/staff/${ownerId}`).set(as('ADMIN')).send({ role: 'TEACHER' }).expect(400);
    // Only the owner and admins edit staff.
    await http().patch(`/api/staff/${userIds.TEACHER}`).set(as('MANAGER')).send({ access: [] }).expect(403);

    await setAccess('TEACHER', ['students.view']);
    const moved = (await http().patch(`/api/staff/${userIds.TEACHER}`).set(as('OWNER')).send({ role: 'RECEPTIONIST' }).expect(200)).body;
    expect(moved.access).toBeNull();
    expect(moved.effectiveAccess).toEqual(templateFor('RECEPTIONIST'));
    await http().patch(`/api/staff/${userIds.TEACHER}`).set(as('OWNER')).send({ role: 'TEACHER' }).expect(200);

    // An empty list: nothing in the catalog, the basics still work.
    await setAccess('TEACHER', []);
    expect((await call('TEACHER', 'GET /api/students')).status).toBe(403);
    await http().get('/api/auth/me').set(as('TEACHER')).expect(200);
    await setAccess('TEACHER', null);
    await http().get('/api/students').set(as('TEACHER')).expect(200);
  });

  it('admissions rules inside the service follow the list too', async () => {
    const lead = { fullName: 'Lead Person', phone: `+99890${String(suffix).slice(-7)}`, assignedManagerUserId: userIds.MANAGER };
    await http().post('/api/leads').set(as('RECEPTIONIST')).send(lead).expect(403);
    await setAccess('RECEPTIONIST', [...templateFor('RECEPTIONIST'), 'leads.assign']);
    const res = await http().post('/api/leads').set(as('RECEPTIONIST')).send(lead);
    expect(res.status).toBe(201);
    await setAccess('RECEPTIONIST', null);
  });

  it('a manager cannot invite roles with more access than their own', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'ACCOUNTANT']) {
      await http().post('/api/invitations').set(as('MANAGER')).send({ email: `sacc-up-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(403);
    }
    await http().post('/api/invitations').set(as('MANAGER')).send({ email: `sacc-t-${suffix}@test.uz`, role: 'TEACHER' }).expect(201);
    await http().post('/api/invitations').set(as('ADMIN')).send({ email: `sacc-a-${suffix}@test.uz`, role: 'ACCOUNTANT' }).expect(201);
  });
});
