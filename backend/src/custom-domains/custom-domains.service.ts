import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenantDomains, tenants } from '../db/schema';
import { AuditService } from '../audit/audit.service';

const MAX_PER_CENTER = 3;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** The TXT record that proves a domain: _talimcrm.<domain> = <token>. */
export const TXT_PREFIX = '_talimcrm';

/**
 * A center's own domain for its public site (academy.uz instead of
 * academy.<ROOT_DOMAIN>). Added from the center's settings, proved with a
 * DNS TXT record, and only then resolved (the site's front door,
 * frontend/proxy.ts). A domain is verified by one center only; adding one
 * that another center merely claimed takes nothing from anyone. Sign-in and
 * the cabinets stay on the center's subdomain: the domain shows the site.
 */
@Injectable()
export class CustomDomainsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** "Academy.UZ." -> "academy.uz"; refuses what cannot be a center's own domain. */
  normalize(raw: string): string {
    const d = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    const labels = d.split('.');
    if (d.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1])) {
      throw new BadRequestException({ code: 'DOMAIN_INVALID', message: "Domen noto'g'ri yozilgan (masalan: academy.uz)" });
    }
    const root = (this.config.get<string>('ROOT_DOMAIN') || '').trim().toLowerCase();
    if (d === 'localhost' || d.endsWith('.localhost') || (root && (d === root || d.endsWith(`.${root}`)))) {
      throw new BadRequestException({ code: 'DOMAIN_INVALID', message: "Bu platformaning o'z domeni: o'z domeningizni kiriting" });
    }
    return d;
  }

  list(tenantId: string) {
    return this.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId)).orderBy(tenantDomains.createdAt).then((rows) => rows.map((r) => this.view(r)));
  }

  private view(r: typeof tenantDomains.$inferSelect) {
    return { id: r.id, domain: r.domain, verified: !!r.verifiedAt, verifiedAt: r.verifiedAt, txtName: `${TXT_PREFIX}.${r.domain}`, txtValue: r.verificationToken, createdAt: r.createdAt };
  }

  async add(tenantId: string, rawDomain: string, actorId: string) {
    const domain = this.normalize(rawDomain);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`domains:${tenantId}`}))`);
      const mine = await tx.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId));
      if (mine.some((r) => r.domain === domain)) throw new ConflictException({ code: 'DOMAIN_EXISTS', message: "Bu domen allaqachon qo'shilgan" });
      if (mine.length >= MAX_PER_CENTER) throw new BadRequestException({ code: 'DOMAIN_LIMIT', message: `Bir markazga ${MAX_PER_CENTER} tagacha domen` });
      const [row] = await tx.insert(tenantDomains).values({ tenantId, domain, verificationToken: `talimcrm-${randomBytes(12).toString('hex')}` }).returning();
      this.audit.log({ tenantId, userId: actorId, action: 'create', entityType: 'custom_domain', entityId: row.id, meta: { domain } });
      return this.view(row);
    });
  }

  // Overridden in tests: the DNS answer.
  resolveTxt(name: string): Promise<string[][]> {
    return dns.resolveTxt(name);
  }

  async verify(tenantId: string, id: string, actorId: string) {
    const [row] = await this.db.select().from(tenantDomains).where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, tenantId)));
    if (!row) throw new NotFoundException('Domen topilmadi');
    if (row.verifiedAt) return this.view(row);
    const name = `${TXT_PREFIX}.${row.domain}`;
    const records = await this.resolveTxt(name).catch(() => [] as string[][]);
    if (!records.some((parts) => parts.join('').trim() === row.verificationToken)) {
      throw new BadRequestException({ code: 'DOMAIN_NOT_VERIFIED', message: `DNS'da TXT yozuvi topilmadi: ${name} = ${row.verificationToken}. Yozuv qo'shilgach bir necha daqiqa kuting.` });
    }
    try {
      const [done] = await this.db.update(tenantDomains).set({ verifiedAt: new Date() }).where(eq(tenantDomains.id, row.id)).returning();
      this.audit.log({ tenantId, userId: actorId, action: 'update', entityType: 'custom_domain', entityId: row.id, meta: { domain: row.domain, verified: true } });
      return this.view(done);
    } catch (err) {
      // Another center verified this domain first (the partial unique index).
      if ((err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new ConflictException({ code: 'DOMAIN_TAKEN', message: 'Bu domen boshqa markazga ulangan' });
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string, actorId: string) {
    const [row] = await this.db.delete(tenantDomains).where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, tenantId))).returning();
    if (!row) throw new NotFoundException('Domen topilmadi');
    this.audit.log({ tenantId, userId: actorId, action: 'delete', entityType: 'custom_domain', entityId: id, meta: { domain: row.domain } });
    return { success: true };
  }

  /** The center a verified domain belongs to (for the site's front door); null otherwise. */
  async resolve(host: string): Promise<{ subdomain: string } | null> {
    let domain: string;
    try {
      domain = this.normalize(host.replace(/:\d+$/, ''));
    } catch {
      return null;
    }
    const [row] = await this.db
      .select({ subdomain: tenants.subdomain })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.domain, domain), isNotNull(tenantDomains.verifiedAt)));
    return row ?? null;
  }
}
