import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { users, tenants, organizationMemberships } from '../src/db/schema';

// OBSOLETE - kept only as a record of the one-time move to memberships.
// It gives EVERY user that still points at a center an ACTIVE membership,
// which would hand access back to staff who were removed on purpose.
// Migration 0032 restores the one unambiguous case (a center's founder);
// everyone else is listed by `node scripts/list-unlinked-accounts.cjs` and
// re-added by an owner. It refuses to run unless told it is a brand-new
// import where nobody has ever been removed.
async function main() {
  if (!process.argv.includes('--no-one-was-ever-removed')) {
    console.error(
      'Refusing to run: this would give every account an ACTIVE membership in its old center,\n' +
        'including staff who were removed. Use `node scripts/list-unlinked-accounts.cjs` to see\n' +
        'who has no access, and add the right people back under Staff.',
    );
    process.exit(1);
  }
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
