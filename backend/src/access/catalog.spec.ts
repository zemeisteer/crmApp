import { readFileSync } from 'fs';
import { join } from 'path';
import { ACCESS_AREAS, ACCESS_CATALOG, ACCESS_KEYS, accessDecides, effectiveAccess, templateFor } from './catalog';

describe('access catalog', () => {
  it('has unique keys, each route in one key, known areas', () => {
    expect(new Set(ACCESS_KEYS).size).toBe(ACCESS_KEYS.length);
    const routes = ACCESS_CATALOG.flatMap((k) => k.routes);
    expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
    for (const k of ACCESS_CATALOG) expect(ACCESS_AREAS).toContain(k.area);
  });

  it('every key has a name in all three languages on the settings screen', () => {
    const i18n = readFileSync(join(__dirname, '../../../frontend/lib/i18n.ts'), 'utf8');
    const missing = ACCESS_KEYS.filter((k) => !new RegExp(`"perm\\.${k.replace('.', '\\.')}": \\{ UZ: "[^"]+", RU: "[^"]+", EN: "[^"]+" \\}`).test(i18n));
    expect(missing).toEqual([]);
  });

  it('owner and admins have everything; configurable roles their list or default; others nothing', () => {
    expect(effectiveAccess('OWNER', ['students.view'])).toEqual(ACCESS_KEYS);
    expect(effectiveAccess('ADMIN', null)).toEqual(ACCESS_KEYS);
    expect(effectiveAccess('TEACHER', null)).toEqual(templateFor('TEACHER'));
    expect(effectiveAccess('TEACHER', ['payments.take', 'students.view', 'nope'])).toEqual(['students.view', 'payments.take']);
    expect(effectiveAccess('STUDENT', null)).toEqual([]);
  });

  it('a list decides only for configurable roles, on catalog routes', () => {
    expect(accessDecides('POST /api/payments', 'RECEPTIONIST', ['payments.take'])).toBe(true);
    expect(accessDecides('POST /api/payments', 'ACCOUNTANT', [])).toBe(false);
    expect(accessDecides('POST /api/payments', 'ACCOUNTANT', null)).toBeNull();
    expect(accessDecides('POST /api/payments', 'ADMIN', [])).toBeNull();
    expect(accessDecides('POST /api/staff', 'MANAGER', [...ACCESS_KEYS])).toBeNull();
  });
});
