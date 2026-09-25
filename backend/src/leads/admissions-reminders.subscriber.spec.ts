import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdmissionsRemindersSubscriber } from './admissions-reminders.subscriber';
import type { AdmissionsEvent } from './admissions-events.service';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin']) c[m] = vi.fn(() => c);
  // oxlint-disable-next-line unicorn/no-thenable -- deliberately awaitable, like a drizzle builder
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

describe('AdmissionsRemindersSubscriber', () => {
  let selectResults: unknown[];
  let email: { send: ReturnType<typeof vi.fn> };
  let leadsService: { activeAssignableMembership: ReturnType<typeof vi.fn>; tenantTimezone: ReturnType<typeof vi.fn> };
  let sub: AdmissionsRemindersSubscriber;
  const event = (name: AdmissionsEvent['name'], data = {}): AdmissionsEvent => ({
    name, tenantId: 't1', leadId: 'l1', actorUserId: null, data, occurredAt: new Date().toISOString(),
  });

  beforeEach(() => {
    selectResults = [];
    const db = { select: vi.fn(() => chain(selectResults.shift() ?? [])) };
    email = { send: vi.fn() };
    leadsService = {
      activeAssignableMembership: vi.fn().mockResolvedValue({ id: 'm1' }),
      tenantTimezone: vi.fn().mockResolvedValue('Asia/Tashkent'),
    };
    const config = { get: vi.fn(() => undefined) };
    sub = new AdmissionsRemindersSubscriber(db as any, {} as any, email as any, leadsService as any, config as any);
  });

  it('emails the active assigned manager, without the prospect\'s contact details', async () => {
    selectResults.push([{ id: 'l1', fullName: 'Aziza', managerUserId: 'u1' }], [{ email: 'm@x.uz', fullName: 'Manager' }]);
    expect(await sub.remind(event('LeadFollowUpDue'))).toBe(true);
    expect(email.send).toHaveBeenCalledWith('m@x.uz', expect.stringContaining('Aziza'), expect.stringContaining('/leads/l1'));
    expect(email.send.mock.calls[0][2]).not.toMatch(/\+998/);
  });

  it("shows the trial time in the center's own timezone", async () => {
    selectResults.push([{ id: 'l1', fullName: 'Aziza', managerUserId: 'u1' }], [{ email: 'm@x.uz', fullName: 'Manager' }]);
    await sub.remind(event('TrialBooked', { scheduledAt: '2026-10-01T05:00:00.000Z' }));
    expect(email.send.mock.calls[0][2]).toContain('2026-10-01 10:00 (Asia/Tashkent)');

    leadsService.tenantTimezone.mockResolvedValue('Europe/Moscow');
    selectResults.push([{ id: 'l1', fullName: 'Aziza', managerUserId: 'u1' }], [{ email: 'm@x.uz', fullName: 'Manager' }]);
    await sub.remind(event('TrialBooked', { scheduledAt: '2026-10-01T05:00:00.000Z' }));
    expect(email.send.mock.calls[1][2]).toContain('2026-10-01 08:00 (Europe/Moscow)');
  });

  it('skips unassigned leads', async () => {
    selectResults.push([{ id: 'l1', fullName: 'Aziza', managerUserId: null }]);
    expect(await sub.remind(event('LeadFollowUpDue'))).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('skips managers who are no longer active members', async () => {
    selectResults.push([{ id: 'l1', fullName: 'Aziza', managerUserId: 'u1' }]);
    leadsService.activeAssignableMembership.mockResolvedValue(null);
    expect(await sub.remind(event('LeadFollowUpDue'))).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('tells every active owner/admin/manager about a new website application', async () => {
    selectResults.push(
      [{ id: 'l1', fullName: 'Aziza' }],
      [{ email: 'owner@x.uz', fullName: 'Owner' }, { email: 'mgr@x.uz', fullName: 'Manager' }],
    );
    expect(await sub.notifyNewWebsiteLead(event('LeadCreated', { source: 'WEBSITE', channel: 'public_form' }))).toBe(2);
    expect(email.send.mock.calls.map((c) => c[0])).toEqual(['owner@x.uz', 'mgr@x.uz']);
    expect(email.send.mock.calls[0][1]).toContain('Saytdan yangi ariza: Aziza');
    expect(email.send.mock.calls[0][2]).toContain('/leads/l1');
  });
});
