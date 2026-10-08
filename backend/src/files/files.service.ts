import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { enrollments, exams, fileRefs, homework, mockTests, mockAttempts } from '../db/schema';
import { effectiveAccess } from '../access/catalog';
import { teacherGroupIds } from '../common/teacher-scope';
import { setUploadHeaders, UPLOAD_DIR } from '../common/upload.util';

export type FileKind =
  | 'PUBLIC_LOGO'
  | 'PUBLIC_SITE'
  | 'HOMEWORK_ATTACHMENT'
  | 'HOMEWORK_SUBMISSION'
  | 'EXAM_MATERIAL'
  | 'MOCK_ASSET'
  | 'MOCK_IMPORT'
  | 'MOCK_SPEAKING';

export const PUBLIC_KINDS: ReadonlySet<string> = new Set(['PUBLIC_LOGO', 'PUBLIC_SITE']);

// Stored names are generated (cuid + extension); anything else is never a file of ours.
const NAME_RE = /^[A-Za-z0-9_-]{8,64}(\.[A-Za-z0-9]{2,5})?$/;
export const isStoredFileName = (name: unknown): name is string => typeof name === 'string' && NAME_RE.test(name);

/** How long a signed link works. Long enough to listen to a recording, short enough not to be a credential. */
export const SIGNED_URL_TTL_SECONDS = 30 * 60;

export interface StaffViewer {
  role?: string;
  userId?: string;
  access?: string[] | null;
}

type Ref = typeof fileRefs.$inferSelect;

/**
 * Who may read an uploaded file. Public kinds are served by name at
 * /uploads/<name>; everything else only through a signed link that is handed
 * out after the caller is checked against the record the file belongs to.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Database,
    config: ConfigService,
  ) {
    const own = config.get<string>('FILE_URL_SECRET');
    const jwt = config.get<string>('JWT_SECRET') ?? '';
    // A separate key when configured; otherwise one derived from the JWT
    // secret, so signed links cannot be mistaken for anything else.
    this.key = own ? Buffer.from(own) : createHmac('sha256', jwt).update('talimcrm:file-url:v1').digest();
  }

  // ---- references ---------------------------------------------------------

  /** Records that `name` belongs to a record (idempotent). */
  async register(tenantId: string, name: string | null | undefined, kind: FileKind, ownerId: string, studentId?: string | null) {
    if (!isStoredFileName(name)) return;
    await this.db.insert(fileRefs).values({ tenantId, name, kind, ownerId, studentId: studentId ?? null }).onConflictDoNothing();
  }

  /** Drops the references of a record (its file was replaced or the record removed). */
  async unregister(kind: FileKind, ownerId: string, name?: string | null) {
    const where = name ? and(eq(fileRefs.kind, kind), eq(fileRefs.ownerId, ownerId), eq(fileRefs.name, name)) : and(eq(fileRefs.kind, kind), eq(fileRefs.ownerId, ownerId));
    await this.db.delete(fileRefs).where(where);
  }

  /**
   * A mock test's content names its recordings and pictures. Each name this
   * center already owns (an upload or an import) becomes an asset of this
   * test, so its students can play it; names the center does not own are
   * ignored - a test cannot claim another center's file.
   */
  async syncMockTestAssets(tenantId: string, mockTestId: string, content: unknown) {
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if ((k === 'audioPath' || k === 'imagePath') && isStoredFileName(x)) names.add(x);
          else walk(x);
        }
      }
    };
    walk(typeof content === 'string' ? safeJson(content) : content);
    // Owned names are read before this test's own references are dropped:
    // a file uploaded for this test just now counts as the center's.
    const owned = names.size
      ? await this.db.selectDistinct({ name: fileRefs.name }).from(fileRefs)
        .where(and(eq(fileRefs.tenantId, tenantId), inArray(fileRefs.name, [...names]), inArray(fileRefs.kind, ['MOCK_ASSET', 'MOCK_IMPORT'])))
      : [];
    const ownedNames = new Set(owned.map((r) => r.name));
    await this.db.delete(fileRefs).where(and(eq(fileRefs.kind, 'MOCK_ASSET'), eq(fileRefs.ownerId, mockTestId)));
    const values = [...names].filter((n) => ownedNames.has(n)).map((name) => ({ tenantId, name, kind: 'MOCK_ASSET', ownerId: mockTestId }));
    if (values.length) await this.db.insert(fileRefs).values(values).onConflictDoNothing();
  }

  // ---- signing ------------------------------------------------------------

  private signature(name: string, expires: number) {
    return createHmac('sha256', this.key).update(`${name}|${expires}`).digest('base64url');
  }

  signedPath(name: string, now = Date.now()) {
    const expires = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS;
    return `/api/files/${name}?e=${expires}&s=${this.signature(name, expires)}`;
  }

  verify(name: string, expires: unknown, sig: unknown, now = Date.now()): boolean {
    if (!isStoredFileName(name) || typeof sig !== 'string' || typeof expires !== 'string' || !/^\d{1,12}$/.test(expires)) return false;
    const exp = Number(expires);
    if (exp * 1000 < now) return false;
    const want = Buffer.from(this.signature(name, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private async refsOf(tenantId: string, names: string[]) {
    const valid = [...new Set(names.filter(isStoredFileName))].slice(0, 100);
    if (valid.length === 0) return new Map<string, Ref[]>();
    const rows = await this.db.select().from(fileRefs).where(and(eq(fileRefs.tenantId, tenantId), inArray(fileRefs.name, valid)));
    const byName = new Map<string, Ref[]>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    return byName;
  }

  private publicPath(name: string) {
    return `/uploads/${name}`;
  }

  /**
   * Links for the files a staff member may open, keyed by name. A name the
   * caller may not open (another center's, an unrelated group's, unknown) is
   * simply absent from the answer.
   */
  async signForStaff(tenantId: string, viewer: StaffViewer, names: string[]): Promise<Record<string, string>> {
    const byName = await this.refsOf(tenantId, names);
    const access = new Set(effectiveAccess(viewer.role ?? '', viewer.access));
    const isTeacher = viewer.role === 'TEACHER';
    const myGroups = isTeacher ? new Set((await teacherGroupIds(this.db, tenantId, viewer.role, viewer.userId)) ?? []) : null;

    const hwIds = new Set<string>();
    const examIds = new Set<string>();
    for (const refs of byName.values()) for (const r of refs) {
      if (r.kind === 'HOMEWORK_ATTACHMENT' || r.kind === 'HOMEWORK_SUBMISSION') hwIds.add(r.ownerId);
      if (r.kind === 'EXAM_MATERIAL') examIds.add(r.ownerId);
    }
    const hwGroup = new Map<string, string>();
    if (hwIds.size) for (const h of await this.db.select({ id: homework.id, groupId: homework.groupId }).from(homework).where(and(eq(homework.tenantId, tenantId), inArray(homework.id, [...hwIds])))) hwGroup.set(h.id, h.groupId);
    const examGroup = new Map<string, string>();
    if (examIds.size) for (const e of await this.db.select({ id: exams.id, groupId: exams.groupId }).from(exams).where(and(eq(exams.tenantId, tenantId), inArray(exams.id, [...examIds])))) examGroup.set(e.id, e.groupId);

    const inMyScope = (groupId: string | undefined) => !!groupId && (myGroups === null || myGroups.has(groupId));
    const allowed = (r: Ref) => {
      if (PUBLIC_KINDS.has(r.kind)) return true;
      switch (r.kind) {
        case 'HOMEWORK_ATTACHMENT':
        case 'HOMEWORK_SUBMISSION':
          return access.has('homework.view') && inMyScope(hwGroup.get(r.ownerId));
        case 'EXAM_MATERIAL':
          return access.has('exams.view') && inMyScope(examGroup.get(r.ownerId));
        case 'MOCK_ASSET':
        case 'MOCK_IMPORT':
        case 'MOCK_SPEAKING':
          return access.has('mockTests.manage');
        default:
          return false;
      }
    };
    return this.answer(byName, allowed);
  }

  /** The same for a student's cabinet (a student or a parent viewing that student). */
  async signForCabinet(tenantId: string, studentId: string, names: string[]): Promise<Record<string, string>> {
    const byName = await this.refsOf(tenantId, names);
    // The groups whose homework the cabinet lists (portal.service getHomework): every enrollment in this center.
    const myGroups = new Set(
      (await this.db.select({ groupId: enrollments.groupId }).from(enrollments)
        .where(and(eq(enrollments.studentId, studentId), or(eq(enrollments.tenantId, tenantId), isNull(enrollments.tenantId))))).map((e) => e.groupId),
    );
    const hwIds = new Set<string>();
    const testIds = new Set<string>();
    for (const refs of byName.values()) for (const r of refs) {
      if (r.kind === 'HOMEWORK_ATTACHMENT') hwIds.add(r.ownerId);
      if (r.kind === 'MOCK_ASSET') testIds.add(r.ownerId);
    }
    const hwGroup = new Map<string, string>();
    if (hwIds.size) for (const h of await this.db.select({ id: homework.id, groupId: homework.groupId }).from(homework).where(and(eq(homework.tenantId, tenantId), inArray(homework.id, [...hwIds])))) hwGroup.set(h.id, h.groupId);
    // A test the student may open: published for everyone or for them, or one they have sat.
    const openTests = new Set<string>();
    if (testIds.size) {
      for (const t of await this.db.select({ id: mockTests.id }).from(mockTests)
        .where(and(eq(mockTests.tenantId, tenantId), inArray(mockTests.id, [...testIds]), eq(mockTests.status, 'PUBLISHED'), or(isNull(mockTests.ownerStudentId), eq(mockTests.ownerStudentId, studentId))))) openTests.add(t.id);
      for (const a of await this.db.selectDistinct({ id: mockAttempts.testId }).from(mockAttempts)
        .where(and(eq(mockAttempts.tenantId, tenantId), eq(mockAttempts.studentId, studentId), inArray(mockAttempts.testId, [...testIds])))) openTests.add(a.id);
    }
    const allowed = (r: Ref) => {
      if (PUBLIC_KINDS.has(r.kind)) return true;
      switch (r.kind) {
        case 'HOMEWORK_ATTACHMENT': {
          const g = hwGroup.get(r.ownerId);
          return !!g && myGroups.has(g);
        }
        case 'HOMEWORK_SUBMISSION':
        case 'MOCK_SPEAKING':
          return r.studentId === studentId;
        case 'MOCK_ASSET':
          return openTests.has(r.ownerId);
        default:
          return false;
      }
    };
    return this.answer(byName, allowed);
  }

  private answer(byName: Map<string, Ref[]>, allowed: (r: Ref) => boolean) {
    const out: Record<string, string> = {};
    const now = Date.now();
    for (const [name, refs] of byName) {
      const ok = refs.filter(allowed);
      if (ok.length === 0) continue;
      out[name] = ok.some((r) => PUBLIC_KINDS.has(r.kind)) ? this.publicPath(name) : this.signedPath(name, now);
    }
    return out;
  }

  // ---- serving ------------------------------------------------------------

  private send(res: Response, name: string, cache: string) {
    const path = join(UPLOAD_DIR, name);
    if (!existsSync(path)) {
      res.status(404).json({ message: 'Fayl topilmadi' });
      return;
    }
    setUploadHeaders(res, name);
    res.setHeader('Cache-Control', cache);
    res.sendFile(path, { dotfiles: 'deny' });
  }

  /** GET /uploads/<name>: only public kinds (logo, site pictures). Everything else is 404, as if it did not exist. */
  servePublic = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const name = String(req.params.name ?? '');
      if (!isStoredFileName(name)) return void res.status(404).json({ message: 'Fayl topilmadi' });
      const [pub] = await this.db.select({ name: fileRefs.name }).from(fileRefs)
        .where(and(eq(fileRefs.name, name), inArray(fileRefs.kind, [...PUBLIC_KINDS]))).limit(1);
      if (!pub) return void res.status(404).json({ message: 'Fayl topilmadi' });
      this.send(res, name, 'public, max-age=3600');
    } catch (err) {
      next(err);
    }
  };

  /** GET /api/files/<name>?e=&s=: a signed link. */
  serveSigned(name: string, expires: unknown, sig: unknown, res: Response) {
    if (!this.verify(name, expires, sig)) {
      res.status(403).json({ message: "Havola eskirgan yoki noto'g'ri" });
      return;
    }
    const left = Math.max(0, Number(expires) - Math.floor(Date.now() / 1000));
    this.send(res, name, `private, max-age=${left}`);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
