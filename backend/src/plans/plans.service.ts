import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { plans, tenants } from '../db/schema';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlansService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Public + tenant admins: only what's currently offered.
  async listActive() {
    return this.db.query.plans.findMany({
      where: eq(plans.active, true),
      orderBy: (p, { asc }) => asc(p.price),
    });
  }

  // Superadmin: everything, plus how many tenants sit on each plan.
  async listAll() {
    const all = await this.db.query.plans.findMany({ orderBy: (p, { asc }) => asc(p.price) });
    const counts = await this.db
      .select({ plan: tenants.plan, count: sql<number>`count(*)::int` })
      .from(tenants)
      .groupBy(tenants.plan);
    const countByKey = Object.fromEntries(counts.map((c) => [c.plan, c.count]));
    return all.map((p) => ({ ...p, tenantCount: countByKey[p.key] ?? 0 }));
  }

  async getByKey(key: string) {
    const plan = await this.db.query.plans.findFirst({ where: eq(plans.key, key) });
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    return plan;
  }

  async create(dto: CreatePlanDto) {
    const existing = await this.db.query.plans.findFirst({ where: eq(plans.key, dto.key) });
    if (existing) throw new ConflictException('Bu kalit (key) allaqachon band');
    const [plan] = await this.db.insert(plans).values(dto).returning();
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    const [plan] = await this.db.update(plans).set({ ...dto, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    return plan;
  }

  async remove(id: string) {
    await this.db.delete(plans).where(eq(plans.id, id));
    return { success: true };
  }

  // Seeds the 3 original tiers the first time this runs against a fresh
  // DB, so existing tenants (created with the old STARTER/STANDARD/PREMIUM
  // enum) still resolve to a real plan row.
  async ensureSeeded() {
    const count = await this.db.query.plans.findFirst();
    if (count) return;
    await this.db.insert(plans).values([
      { key: 'STARTER', name: 'Starter', price: 0, features: "1 filial\n50 tagacha o'quvchi\nAsosiy CRUD", popular: false },
      { key: 'STANDARD', name: 'Standard', price: 300_000, features: "Cheksiz filial\n500 tagacha o'quvchi\nDavomat, hisobotlar\nTelegram xabarnomalar", popular: true },
      { key: 'PREMIUM', name: 'Premium', price: 600_000, features: "Cheksiz o'quvchi\nAI tahlil va materiallar\nClick/Payme integratsiya\nUstuvor qo'llab-quvvatlash", popular: false },
    // Several app instances (or parallel test suites) can boot against the
    // same empty table at once; whoever loses the race just skips.
    ]).onConflictDoNothing({ target: plans.key });
  }
}
