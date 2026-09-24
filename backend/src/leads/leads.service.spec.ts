import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LeadsService, type Actor } from './leads.service';

// Minimal drizzle query-builder stand-in: every builder method returns the
// same object, and awaiting it yields the queued result.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'returning', 'values', 'set', 'for', 'orderBy', 'groupBy', 'innerJoin', 'onConflictDoNothing']) {
    c[m] = vi.fn(() => c);
  }
  // oxlint-disable-next-line unicorn/no-thenable -- deliberately awaitable, like a drizzle builder
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

describe('LeadsService', () => {
  let service: LeadsService;
  let mockDb: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let events: { emit: ReturnType<typeof vi.fn> };
  let selectResults: unknown[];
  let insertResults: unknown[];
  let updateResults: unknown[];

  const admin: Actor = { userId: 'user-1', permissions: ['admissions.read', 'admissions.create', 'admissions.update', 'admissions.assign', 'admissions.manage'] };
  const receptionist: Actor = { userId: 'user-2', permissions: ['admissions.read', 'admissions.create', 'admissions.update'] };
  const baseLead = {
    id: 'lead-1', tenantId: 'tenant-1', fullName: 'Rustam', phone: '+998901112233', phoneNormalized: '+998901112233',
    emailNormalized: null, status: 'NEW', archivedAt: null, duplicateOfLeadId: null, assignedManagerUserId: null,
    desiredSubjectId: null, desiredCourseId: null,
  };

  beforeEach(() => {
    selectResults = [];
    insertResults = [];
    updateResults = [];
    mockDb = {
      query: {
        leads: { findMany: vi.fn(), findFirst: vi.fn() },
      },
      select: vi.fn(() => chain(selectResults.shift() ?? [])),
      insert: vi.fn(() => chain(insertResults.shift() ?? [{}])),
      update: vi.fn(() => chain(updateResults.shift() ?? [])),
      delete: vi.fn(() => chain(undefined)),
    };
    mockDb.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb));
    audit = { log: vi.fn() };
    events = { emit: vi.fn() };
    service = new LeadsService(mockDb, audit as any, events as any);
  });

  describe('findAll', () => {
    it('returns a paginated, tenant-scoped page of leads', async () => {
      const mockLeads = [{ id: 'lead-1', fullName: 'Shaxzod Aliyev', status: 'NEW', tenantId: 'tenant-1' }];
      selectResults.push([{ total: 1 }]);
      mockDb.query.leads.findMany.mockResolvedValue(mockLeads);

      const result = await service.findAll('tenant-1', 'user-1', { status: 'NEW', search: 'Shaxzod' });
      expect(result).toEqual({ items: mockLeads, total: 1, page: 1, pageSize: 25 });
      expect(mockDb.query.leads.findMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
    });
  });

  describe('findOne', () => {
    it('returns lead if found, with the legal next stages', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(baseLead);

      const result = await service.findOne('tenant-1', 'lead-1');
      expect(result.id).toBe('lead-1');
      expect(result.allowedTransitions).toEqual(['CONTACTED']);
    });

    it('throws NotFoundException when lead is not found', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'invalid-lead')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFunnelStats', () => {
    it('calculates counts, conversion rate and source distribution', async () => {
      const allLeads = [
        { id: '1', status: 'NEW', source: 'INSTAGRAM' },
        { id: '2', status: 'ENROLLED', source: 'INSTAGRAM' },
        { id: '3', status: 'LOST', source: 'TELEGRAM' },
      ];
      mockDb.query.leads.findMany.mockResolvedValue(allLeads);

      const stats = await service.getFunnelStats('tenant-1');
      expect(stats.total).toBe(3);
      expect(stats.counts.NEW).toBe(1);
      expect(stats.counts.ENROLLED).toBe(1);
      expect(stats.counts.LOST).toBe(1);
      expect(stats.conversionRate).toBe(33);
      expect(stats.bySource.INSTAGRAM.total).toBe(2);
      expect(stats.bySource.INSTAGRAM.enrolled).toBe(1);
      expect(stats.bySource.INSTAGRAM.conversionRate).toBe(50);
    });
  });

  describe('create', () => {
    it('creates a new lead with basic fields, records the timeline and emits LeadCreated', async () => {
      const createdLead = { ...baseLead, source: 'OTHER', followUpAt: null };
      selectResults.push([]); // duplicate lookup
      insertResults.push([createdLead], [{}]);

      const result = await service.create('tenant-1', receptionist, { fullName: 'Rustam', phone: '+998 90 111 22 33' });

      expect(result).toEqual(createdLead);
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // lead + STATUS_CHANGE activity
      expect(events.emit).toHaveBeenCalledWith('LeadCreated', expect.objectContaining({ tenantId: 'tenant-1', leadId: 'lead-1' }));
    });

    it('throws BadRequestException if branch does not exist', async () => {
      selectResults.push([]); // branch lookup

      await expect(
        service.create('tenant-1', admin, { fullName: 'Rustam', phone: '+998901112233', preferredBranchId: 'invalid-branch' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an unparseable phone', async () => {
      await expect(service.create('tenant-1', admin, { fullName: 'Rustam', phone: '12' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a same-tenant duplicate with 409 and does not insert', async () => {
      selectResults.push([{ id: 'lead-0', fullName: 'Rustam', status: 'NEW', phoneNormalized: '+998901112233', emailNormalized: null }]);

      await expect(service.create('tenant-1', admin, { fullName: 'Rustam', phone: '90 111 22 33' })).rejects.toThrow(ConflictException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('requires admissions.manage to override a duplicate', async () => {
      await expect(
        service.create('tenant-1', receptionist, { fullName: 'Rustam', phone: '901112233', allowDuplicate: true, duplicateReason: 'sibling' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('requires admissions.assign to set a manager on create', async () => {
      await expect(
        service.create('tenant-1', receptionist, { fullName: 'Rustam', phone: '901112233', assignedManagerUserId: 'user-9' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates profile fields successfully', async () => {
      const updated = { ...baseLead, fullName: 'Rustam Bek' };
      selectResults.push([baseLead]);
      updateResults.push([updated]);

      const result = await service.update('tenant-1', admin, 'lead-1', { fullName: 'Rustam Bek' });
      expect(result).toEqual(updated);
    });

    it('refuses status changes through PATCH (they must use the transition policy)', async () => {
      await expect(service.update('tenant-1', admin, 'lead-1', { status: 'QUALIFIED' })).rejects.toThrow(BadRequestException);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('transition', () => {
    it('moves NEW -> CONTACTED atomically and records a STATUS_CHANGE activity', async () => {
      selectResults.push([baseLead]);
      updateResults.push([{ ...baseLead, status: 'CONTACTED' }]);

      const result = await service.transition('tenant-1', admin, 'lead-1', 'CONTACTED');
      expect(result.status).toBe('CONTACTED');
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('rejects an illegal jump with 409 and leaves the lead untouched', async () => {
      selectResults.push([baseLead]);

      await expect(service.transition('tenant-1', admin, 'lead-1', 'QUALIFIED')).rejects.toThrow(ConflictException);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('returns 409 when a concurrent change wins the conditional update', async () => {
      selectResults.push([baseLead]);
      updateResults.push([]); // status no longer matched

      await expect(service.transition('tenant-1', admin, 'lead-1', 'CONTACTED')).rejects.toThrow(ConflictException);
    });

    it('sends ENROLLED through the conversion flow instead', async () => {
      await expect(service.transition('tenant-1', admin, 'lead-1', 'ENROLLED')).rejects.toThrow(BadRequestException);
    });
  });

  describe('lose', () => {
    it('cannot lose a lead that was never contacted', async () => {
      selectResults.push([baseLead]);
      await expect(service.lose('tenant-1', admin, 'lead-1', { reason: 'NO_RESPONSE' })).rejects.toThrow(ConflictException);
    });
  });

  describe('archive (replaces hard delete)', () => {
    it('archives the lead without deleting it and audits the action', async () => {
      selectResults.push([baseLead]);
      updateResults.push([], [{ ...baseLead, archivedAt: new Date() }]);

      const result = await service.archive('tenant-1', admin, 'lead-1');
      expect(result.archivedAt).toBeInstanceOf(Date);
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'archive', entityType: 'lead', entityId: 'lead-1' }));
    });
  });
});
