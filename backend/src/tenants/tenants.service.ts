import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants } from '../db/schema';

@Injectable()
export class TenantsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Superadmin: list every tenant on the platform
  findAll() {
    return this.db.query.tenants.findMany({
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  async findBySubdomain(subdomain: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    // Public-safe subset only
    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      accentColor: tenant.accentColor,
      plan: tenant.plan,
    };
  }

  async findOne(id: string) {
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, id) });
    if (!tenant) throw new NotFoundException('Mijoz topilmadi');
    return tenant;
  }
}
