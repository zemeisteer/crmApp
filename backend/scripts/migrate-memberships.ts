import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { users, tenants, organizationMemberships } from '../src/db/schema';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: { users, tenants, organizationMemberships } });

  console.log('Migrating existing users to organization_memberships...');
  const allUsers = await db.select().from(users);
  let count = 0;

  for (const u of allUsers) {
    if (!u.tenantId) continue;
    // Map role
    const role = u.role === 'SUPERADMIN' ? 'OWNER' : u.role;
    await db
      .insert(organizationMemberships)
      .values({
        userId: u.id,
        tenantId: u.tenantId,
        role: role as any,
        status: 'ACTIVE',
        permissions: u.permissions,
      })
      .onConflictDoNothing();
    count++;
  }

  // Ensure all existing tenants have onboardingStep = 'COMPLETED'
  await db.update(tenants).set({ onboardingStep: 'COMPLETED' });

  console.log(`Successfully migrated ${count} memberships for ${allUsers.length} users.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
