import { describe, expect, it, vi } from 'vitest';
import { TrialSmsSubscriber, trialSmsText } from './trial-sms.subscriber';

const row = {
  status: 'BOOKED',
  scheduledAt: new Date('2026-11-23T13:00:00.000Z'),
  leadName: 'Aziza',
  phone: '+998901112233',
  group: 'IELTS 6.5 Kechki',
  address: 'Ses street 1',
  center: "Bilimdon o'quv markazi",
  centerPhone: '+998712000000',
  tz: 'Asia/Tashkent',
};

// A select chain that resolves to the given rows.
function db(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin'])
    chain[m] = () => chain;
  chain.where = async () => rows;
  return chain;
}

function subscriber(rows: unknown[], routeOk = true) {
  const notifications = {
    smsRoute: vi.fn(async () =>
      routeOk
        ? { ok: true }
        : { ok: false, reason: 'NOT_IN_PLAN', message: 'no' },
    ),
    send: vi.fn(async () => ({ status: 'SENT' })),
  };
  const sub = new TrialSmsSubscriber(
    db(rows) as never,
    {} as never,
    notifications as never,
  );
  return { sub, notifications };
}

const event = (
  name: 'TrialBooked' | 'TrialRescheduled',
  data: Record<string, unknown> = { trialId: 'tr1' },
) =>
  ({
    name,
    tenantId: 't1',
    leadId: 'l1',
    actorUserId: 'u1',
    data,
    at: new Date().toISOString(),
  }) as never;

describe('TrialSmsSubscriber', () => {
  it('a booked trial: one SMS to the lead, in the center time, keyed by the trial', async () => {
    const { sub, notifications } = subscriber([row]);
    expect(await sub.notify(event('TrialBooked'))).toBe(true);
    expect(notifications.send).toHaveBeenCalledOnce();
    const [tenantId, dto] = notifications.send.mock.calls[0] as unknown as [
      string,
      Record<string, string>,
    ];
    expect(tenantId).toBe('t1');
    expect(dto).toMatchObject({
      channel: 'SMS',
      recipient: '+998901112233',
      idempotencyKey: 'trial-sms:tr1',
    });
    expect(dto.content).toBe(
      "Bilimdon o'quv markazi: sinov darsingiz belgilandi - 2026-11-23 18:00. Guruh: IELTS 6.5 Kechki. Manzil: Ses street 1. Tel: +998712000000",
    );
  });

  it('a center that cannot send SMS sends and logs nothing', async () => {
    const { sub, notifications } = subscriber([row], false);
    expect(await sub.notify(event('TrialBooked'))).toBe(false);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('no phone, a trial no longer booked, or no trial id: nothing', async () => {
    for (const rows of [
      [{ ...row, phone: '  ' }],
      [{ ...row, status: 'CANCELLED' }],
      [],
    ]) {
      const { sub, notifications } = subscriber(rows);
      expect(await sub.notify(event('TrialBooked'))).toBe(false);
      expect(notifications.send).not.toHaveBeenCalled();
    }
    const { sub, notifications } = subscriber([row]);
    expect(await sub.notify(event('TrialBooked', {}))).toBe(false);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('a moved trial says so', () => {
    expect(
      trialSmsText({
        ...row,
        moved: true,
        group: null,
        address: null,
        centerPhone: null,
      }),
    ).toBe(
      "Bilimdon o'quv markazi: sinov darsingiz ko'chirildi - 2026-11-23 18:00",
    );
  });
});
