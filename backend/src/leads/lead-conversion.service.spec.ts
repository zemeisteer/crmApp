import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { LeadConversionService } from './lead-conversion.service';
import { LeadsService } from './leads.service';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'returning', 'values', 'set', 'for']) c[m] = vi.fn(() => c);
  // oxlint-disable-next-line unicorn/no-thenable -- deliberately awaitable, like a drizzle builder
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

describe('LeadConversionService', () => {
  let mockDb: any;
  let selectResults: unknown[];
  let service: LeadConversionService;
  let events: { emit: ReturnType<typeof vi.fn> };
  const actor = { userId: 'user-1', permissions: ['admissions.convert'] };

  beforeEach(() => {
    selectResults = [];
    mockDb = {
      select: vi.fn(() => chain(selectResults.shift() ?? [])),
      insert: vi.fn(() => chain([{}])),
      update: vi.fn(() => chain([])),
    };
    mockDb.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb));
    events = { emit: vi.fn() };
    const audit = { log: vi.fn() };
    const leads = new LeadsService(mockDb, audit as any, events as any);
    service = new LeadConversionService(mockDb, leads, {} as any, audit as any, { dispatch: vi.fn() } as any, events as any);
  });

  it('returns the existing student if lead was already converted (idempotent, no writes)', async () => {
    const existingStudent = { id: 'student-already', fullName: 'Rustam Bek' };
    selectResults.push(
      [{ id: 'lead-1', tenantId: 'tenant-1', status: 'ENROLLED', convertedStudentId: 'student-already', archivedAt: null }],
      [existingStudent],
    );

    const result = await service.convert('tenant-1', actor, 'lead-1', {});
    expect(result.alreadyConverted).toBe(true);
    expect(result.student).toEqual(existingStudent);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('refuses to convert a lead that is not QUALIFIED', async () => {
    selectResults.push([{ id: 'lead-1', tenantId: 'tenant-1', status: 'CONTACTED', convertedStudentId: null, archivedAt: null }]);
    await expect(service.convert('tenant-1', actor, 'lead-1', {})).rejects.toThrow(ConflictException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous student match instead of guessing', async () => {
    selectResults.push(
      [{ id: 'lead-1', tenantId: 'tenant-1', fullName: 'Ali Valiyev', status: 'QUALIFIED', phoneNormalized: '+998901112233', convertedStudentId: null, archivedAt: null }],
      // A sibling registered with the same parent phone, different name.
      [{ id: 'stu-9', fullName: 'Vali Valiyev', phone: null, parentPhone: '90 111 22 33' }],
    );
    await expect(service.convert('tenant-1', actor, 'lead-1', {})).rejects.toThrow(ConflictException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
