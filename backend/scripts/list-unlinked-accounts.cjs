// Accounts that point at a center (users.tenant_id) but have no ACTIVE
// membership in it. They cannot sign in to that center. Some are members
// who were removed on purpose; some may be accounts from before memberships
// existed. Read-only: nothing is changed.
//
//   node scripts/list-unlinked-accounts.cjs
//
// To give one of them access again, an owner (or a platform admin working
// in that center) adds them under Staff with the same e-mail.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query(`
      SELECT t.subdomain, t.name AS center, u.email, u.full_name, u.role AS old_role,
             m.status AS membership, m.removed_at
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN organization_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       WHERE u.role NOT IN ('SUPERADMIN', 'STUDENT', 'PARENT')
         AND (m.id IS NULL OR m.status <> 'ACTIVE')
       ORDER BY t.subdomain, u.email`);
    if (rows.length === 0) {
      console.log('Every staff account has an active membership in its center.');
      return;
    }
    for (const r of rows) {
      const why = r.membership ? `membership ${r.membership}${r.removed_at ? `, removed ${r.removed_at.toISOString().slice(0, 10)}` : ''}` : 'no membership row';
      console.log(`${r.subdomain}\t${r.email}\t${r.full_name}\t(was ${r.old_role})\t${why}`);
    }
    console.log(`\n${rows.length} account(s) without access to their center.`);
  } finally {
    await c.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
