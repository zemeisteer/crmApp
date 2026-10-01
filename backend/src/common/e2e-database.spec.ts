import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveE2eDatabase } = require('../../test/e2e-database.cjs') as {
  resolveE2eDatabase: (env: Record<string, string | undefined>) => { url: string; name: string; disposable: boolean; adminUrl: string };
};

// The rule that keeps end-to-end runs out of real databases.
describe('e2e database selection', () => {
  const dev = 'postgresql://app:secret@localhost:5432/talimcrm';

  it('derives a database of its own next to the development one', () => {
    const db = resolveE2eDatabase({ DATABASE_URL: dev });
    expect(db).toMatchObject({ name: 'talimcrm_e2e', disposable: true, url: 'postgresql://app:secret@localhost:5432/talimcrm_e2e' });
    expect(db.adminUrl).toBe('postgresql://app:secret@localhost:5432/postgres');
  });

  it("uses CI's test database as it is, and never drops it", () => {
    const db = resolveE2eDatabase({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/talimcrm_test' });
    expect(db).toMatchObject({ name: 'talimcrm_test', disposable: false });
  });

  it('takes an explicit test database', () => {
    expect(resolveE2eDatabase({ DATABASE_URL: dev, E2E_DATABASE_URL: 'postgresql://a:b@db:5432/crm_ci_e2e' }).name).toBe('crm_ci_e2e');
  });

  it('refuses anything that is not named as a test database', () => {
    expect(() => resolveE2eDatabase({ DATABASE_URL: dev, E2E_DATABASE_URL: dev })).toThrow(/refusing to use database "talimcrm"/);
    expect(() => resolveE2eDatabase({ E2E_DATABASE_URL: 'postgresql://a:b@prod-db:5432/talimcrm_production' })).toThrow(/refusing/);
    expect(() => resolveE2eDatabase({ DATABASE_URL: 'postgresql://a:b@h:5432/e2e_talimcrm', E2E_DATABASE_URL: 'postgresql://a:b@h:5432/e2e_talimcrm' })).toThrow(/refusing/);
    expect(() => resolveE2eDatabase({})).toThrow(/set DATABASE_URL/);
    expect(() => resolveE2eDatabase({ DATABASE_URL: dev, NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });
});
