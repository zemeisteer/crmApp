// Read-only report: sign-ups that look unfinished or out of place.
//
// Sign-ups are written in one transaction since migration 0063, so a new
// half-made center cannot appear; this looks for older ones and for things
// worth a person's eye:
//  - centers with no active owner (nobody can sign in to manage them);
//  - accounts (not platform admins) with no membership anywhere;
//  - sign-up codes the provider never confirmed (stuck in SENDING);
//  - phones of centers that are not recorded as having had their trial.
//
//   npm run db:report-signups            (uses DATABASE_URL)
//
// Changes nothing, deletes nothing: what to do with each row is a person's call.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const ownerless = (await client.query(`
      SELECT t.id, t.name, t.subdomain, t.status, t.created_at
      FROM tenants t
      WHERE NOT EXISTS (
        SELECT 1 FROM organization_memberships m
        WHERE m.tenant_id = t.id AND m.role = 'OWNER' AND m.status = 'ACTIVE'
      )
      ORDER BY t.created_at DESC LIMIT 500`)).rows;
    console.log(`Centers with no active owner: ${ownerless.length}`);
    for (const r of ownerless) console.log(`  ${r.id}  ${r.subdomain}  ${r.status}  ${r.created_at.toISOString?.() ?? r.created_at}  ${r.name}`);

    const loose = (await client.query(`
      SELECT u.id, u.role, u.created_at
      FROM users u
      WHERE u.role <> 'SUPERADMIN'
        AND NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.user_id = u.id)
      ORDER BY u.created_at DESC LIMIT 500`)).rows;
    console.log(`Accounts with no membership anywhere: ${loose.length}`);
    for (const r of loose) console.log(`  ${r.id}  ${r.role}  ${r.created_at.toISOString?.() ?? r.created_at}`);

    const stuck = (await client.query(`
      SELECT count(*)::int AS n FROM signup_phone_codes
      WHERE status = 'SENDING' AND created_at < now() - interval '10 minutes'`)).rows[0].n;
    console.log(`Sign-up codes never confirmed by the SMS provider (older than 10 min): ${stuck}`);

    const phones = (await client.query(`
      SELECT count(*)::int AS centers,
             (SELECT count(*)::int FROM trial_claims) AS claims
      FROM tenants WHERE signup_phone IS NOT NULL`)).rows[0];
    console.log(`Centers signed up with a phone: ${phones.centers}; phones recorded as having had a trial: ${phones.claims}`);
    if (phones.claims < phones.centers) console.log('  Fewer claims than phones: start the backend once (it records the missing ones).');
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
