import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { chatConversations, chatMessages, chatReads, enrollments, groups, students, teachers, users } from '../db/schema';
import { teacherGroupIds } from '../common/teacher-scope';
import {
  accessTo, activeInGroup, answersCenter, candidateConversations, type ChatActor, type Conversation, currentTeacherUserIds, groupTeacherUserId, participantKey,
} from './chat-access';

export const MAX_BODY = 2000;
const PAGE = 50;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** staff, the student, or a parent (with their own account or the child's PIN). */
function senderRole(m: { senderType: string; senderViewer: string | null }): 'staff' | 'student' | 'parent' {
  if (m.senderType === 'USER') return 'staff';
  return m.senderViewer === 'parent' ? 'parent' : 'student';
}

export interface OpenDto {
  kind: 'STUDENT_CENTER' | 'STUDENT_TEACHER' | 'GROUP';
  studentId?: string;
  teacherUserId?: string;
  groupId?: string;
}

/** Called after a message is stored: the hub tells the people who may see it. */
export type Notify = (tenantId: string, conversationId: string, seq: number) => Promise<void>;

@Injectable()
export class ChatService {
  private notify: Notify = async () => undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  onMessage(fn: Notify) {
    this.notify = fn;
  }

  private async conversation(actor: ChatActor, id: string) {
    const [c] = await this.db.select().from(chatConversations).where(and(eq(chatConversations.id, id), eq(chatConversations.tenantId, actor.tenantId)));
    // Not found and not allowed look the same: an id alone tells nothing.
    if (!c) throw new NotFoundException('Suhbat topilmadi');
    const access = await accessTo(this.db, actor, c);
    if (!access.read) throw new NotFoundException('Suhbat topilmadi');
    return { c, access };
  }

  /** Whether the actor may see this conversation now (the hub asks before passing an event on). */
  async canRead(actor: ChatActor, conversationId: string) {
    const [c] = await this.db.select().from(chatConversations).where(eq(chatConversations.id, conversationId));
    return !!c && (await accessTo(this.db, actor, c)).read;
  }

  // ---- conversations ------------------------------------------------------

  /** Opens (or finds) a conversation the actor may start. */
  async open(actor: ChatActor, dto: OpenDto) {
    const tenantId = actor.tenantId;
    let values: { kind: string; studentId?: string | null; teacherUserId?: string | null; groupId?: string | null };
    if (dto.kind === 'STUDENT_CENTER') {
      const studentId = actor.kind === 'cabinet' ? actor.studentId : dto.studentId;
      if (!studentId) throw new BadRequestException("O'quvchini tanlang");
      if (actor.kind === 'staff' && !answersCenter(actor)) throw new ForbiddenException("Markaz nomidan yozish huquqi yo'q");
      await this.assertStudent(tenantId, studentId);
      values = { kind: 'STUDENT_CENTER', studentId };
    } else if (dto.kind === 'STUDENT_TEACHER') {
      const studentId = actor.kind === 'cabinet' ? actor.studentId : dto.studentId;
      const teacherUserId = actor.kind === 'staff' ? actor.userId : dto.teacherUserId;
      if (!studentId || !teacherUserId) throw new BadRequestException("O'quvchi va o'qituvchini tanlang");
      await this.assertStudent(tenantId, studentId);
      // Only a teacher who teaches the student now.
      if (!(await currentTeacherUserIds(this.db, tenantId, studentId)).has(teacherUserId)) throw new NotFoundException("Bu o'qituvchi bu o'quvchiga dars bermaydi");
      values = { kind: 'STUDENT_TEACHER', studentId, teacherUserId };
    } else if (dto.kind === 'GROUP') {
      if (!dto.groupId) throw new BadRequestException('Guruhni tanlang');
      const teacher = await groupTeacherUserId(this.db, tenantId, dto.groupId);
      const allowed = actor.kind === 'staff' ? teacher === actor.userId : await activeInGroup(this.db, actor.studentId, dto.groupId);
      if (!allowed) throw new NotFoundException('Guruh topilmadi');
      values = { kind: 'GROUP', groupId: dto.groupId };
    } else {
      throw new BadRequestException("Turi noto'g'ri");
    }
    const [made] = await this.db.insert(chatConversations).values({ tenantId, ...values, createdByUserId: actor.kind === 'staff' ? actor.userId : null })
      .onConflictDoNothing().returning();
    const c = made ?? (await this.findExisting(tenantId, values));
    if (made) this.audit.log({ tenantId, userId: actor.kind === 'staff' ? actor.userId : null, action: 'chat.open', entityType: 'chat_conversation', entityId: made.id, meta: { kind: values.kind } });
    return this.describe(actor, [c]).then((r) => r[0]);
  }

  private async findExisting(tenantId: string, v: { kind: string; studentId?: string | null; teacherUserId?: string | null; groupId?: string | null }) {
    const where = v.kind === 'GROUP'
      ? and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.kind, 'GROUP'), eq(chatConversations.groupId, v.groupId!))
      : v.kind === 'STUDENT_CENTER'
        ? and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.kind, 'STUDENT_CENTER'), eq(chatConversations.studentId, v.studentId!))
        : and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.kind, 'STUDENT_TEACHER'), eq(chatConversations.studentId, v.studentId!), eq(chatConversations.teacherUserId, v.teacherUserId!));
    const [c] = await this.db.select().from(chatConversations).where(where);
    return c;
  }

  private async assertStudent(tenantId: string, studentId: string) {
    const [s] = await this.db.select({ id: students.id }).from(students).where(and(eq(students.id, studentId), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
    if (!s) throw new NotFoundException("O'quvchi topilmadi");
  }

  /** The actor's conversations, newest first, with unread counts. */
  async list(actor: ChatActor) {
    const all = await candidateConversations(this.db, actor);
    const visible: Conversation[] = [];
    for (const c of all) if ((await accessTo(this.db, actor, c)).read) visible.push(c);
    return this.describe(actor, visible);
  }

  private async describe(actor: ChatActor, list: Conversation[]) {
    if (list.length === 0) return [];
    const ids = list.map((c) => c.id);
    const key = participantKey(actor);
    const [reads, studentRows, groupRows, teacherRows, lastRows] = await Promise.all([
      this.db.select().from(chatReads).where(and(inArray(chatReads.conversationId, ids), eq(chatReads.participantKey, key))),
      this.db.select({ id: students.id, name: students.fullName }).from(students).where(inArray(students.id, [...list.map((c) => c.studentId).filter(Boolean) as string[], '__none__'])),
      this.db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, [...list.map((c) => c.groupId).filter(Boolean) as string[], '__none__'])),
      this.db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [...list.map((c) => c.teacherUserId).filter(Boolean) as string[], '__none__'])),
      this.db.select({ conversationId: chatMessages.conversationId, body: chatMessages.body, senderName: chatMessages.senderName, senderType: chatMessages.senderType, senderViewer: chatMessages.senderViewer, senderPerson: chatMessages.senderPerson, senderAbout: chatMessages.senderAbout, createdAt: chatMessages.createdAt, seq: chatMessages.seq })
        .from(chatMessages).where(and(inArray(chatMessages.conversationId, ids), sql`${chatMessages.seq} = (SELECT max(m2.seq) FROM chat_messages m2 WHERE m2.conversation_id = ${chatMessages.conversationId})`)),
    ]);
    const unread = await this.db.select({ conversationId: chatMessages.conversationId, n: sql<number>`count(*)::int` }).from(chatMessages)
      .leftJoin(chatReads, and(eq(chatReads.conversationId, chatMessages.conversationId), eq(chatReads.participantKey, key)))
      .where(and(inArray(chatMessages.conversationId, ids), ne(chatMessages.senderKey, key), sql`${chatMessages.seq} > coalesce(${chatReads.lastReadSeq}, 0)`))
      .groupBy(chatMessages.conversationId);
    const sName = new Map(studentRows.map((s) => [s.id, s.name]));
    const gName = new Map(groupRows.map((g) => [g.id, g.name]));
    const tName = new Map(teacherRows.map((t) => [t.id, t.name]));
    const last = new Map(lastRows.map((m) => [m.conversationId, m]));
    const un = new Map(unread.map((u) => [u.conversationId, u.n]));
    const out = [];
    for (const c of list) {
      const access = await accessTo(this.db, actor, c);
      const m = last.get(c.id);
      out.push({
        id: c.id, kind: c.kind, studentId: c.studentId, groupId: c.groupId, teacherUserId: c.teacherUserId,
        studentName: c.studentId ? sName.get(c.studentId) ?? null : null,
        groupName: c.groupId ? gName.get(c.groupId) ?? null : null,
        teacherName: c.teacherUserId ? tName.get(c.teacherUserId) ?? null : null,
        lastMessage: m ? { body: m.body.slice(0, 140), senderName: m.senderName, senderRole: senderRole(m), senderPerson: m.senderPerson, senderAbout: m.senderAbout, createdAt: m.createdAt, seq: Number(m.seq) } : null,
        lastMessageAt: c.lastMessageAt,
        unread: un.get(c.id) ?? 0,
        lastReadSeq: Number(reads.find((r) => r.conversationId === c.id)?.lastReadSeq ?? 0),
        canWrite: access.write,
        oversight: !!access.oversight,
      });
    }
    return out.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  async unreadTotal(actor: ChatActor) {
    const list = await this.list(actor);
    return { unread: list.reduce((n, c) => n + c.unread, 0) };
  }

  // ---- messages -----------------------------------------------------------

  /** A page of messages: the latest (or `before` a seq, older), or everything `after` a seq (catch-up). Oldest first. */
  async messages(actor: ChatActor, conversationId: string, q: { before?: string; after?: string; limit?: string }) {
    await this.conversation(actor, conversationId);
    const limit = Math.min(Math.max(Number(q.limit) || PAGE, 1), 100);
    const before = q.before !== undefined ? Number(q.before) : null;
    const after = q.after !== undefined ? Number(q.after) : null;
    if ((before !== null && !Number.isSafeInteger(before)) || (after !== null && !Number.isSafeInteger(after))) throw new BadRequestException("Kursor noto'g'ri");
    const cols = {
      id: chatMessages.id, seq: chatMessages.seq, senderType: chatMessages.senderType, senderUserId: chatMessages.senderUserId, senderStudentId: chatMessages.senderStudentId,
      senderViewer: chatMessages.senderViewer, senderName: chatMessages.senderName, senderPerson: chatMessages.senderPerson, senderAbout: chatMessages.senderAbout, body: chatMessages.body, clientMessageId: chatMessages.clientMessageId, createdAt: chatMessages.createdAt,
    };
    let rows;
    if (after !== null) {
      rows = await this.db.select(cols).from(chatMessages).where(and(eq(chatMessages.conversationId, conversationId), gt(chatMessages.seq, after))).orderBy(asc(chatMessages.seq)).limit(limit + 1);
      const more = rows.length > limit;
      return { messages: rows.slice(0, limit).map(this.out(actor)), hasMore: more };
    }
    rows = await this.db.select(cols).from(chatMessages)
      .where(and(eq(chatMessages.conversationId, conversationId), before !== null ? lt(chatMessages.seq, before) : undefined))
      .orderBy(desc(chatMessages.seq)).limit(limit + 1);
    const more = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(this.out(actor)), hasMore: more };
  }

  private out(actor: ChatActor) {
    const me = participantKey(actor);
    return (m: { id: string; seq: number; senderType: string; senderUserId: string | null; senderStudentId: string | null; senderViewer: string | null; senderName: string; senderPerson: string | null; senderAbout: string | null; body: string; clientMessageId: string; createdAt: Date }) => ({
      id: m.id, seq: Number(m.seq), senderType: m.senderType, senderViewer: m.senderViewer, senderName: m.senderName,
      senderRole: senderRole(m), senderPerson: m.senderPerson, senderAbout: m.senderAbout, body: m.body,
      clientMessageId: m.clientMessageId, createdAt: m.createdAt,
      mine: (m.senderType === 'USER' ? `u:${m.senderUserId}` : `c:${m.senderStudentId}`) === me,
    });
  }

  /**
   * Sends a message. The sender comes from the session, never the body. The
   * same clientMessageId from the same sender returns the message already
   * stored (a retry after a lost answer is not a second message).
   */
  async send(actor: ChatActor, conversationId: string, dto: { body: string; clientMessageId: string }) {
    const body = (dto.body ?? '').replace(/\r\n/g, '\n').trim();
    if (!body) throw new BadRequestException("Xabar bo'sh");
    if (body.length > MAX_BODY) throw new BadRequestException(`Xabar ${MAX_BODY} belgidan oshmasin`);
    if (!CLIENT_ID_RE.test(dto.clientMessageId ?? '')) throw new BadRequestException("clientMessageId noto'g'ri");
    const { c, access } = await this.conversation(actor, conversationId);
    if (!access.write) throw new ForbiddenException('Bu suhbatga yozish huquqi yo\'q');
    const key = participantKey(actor);
    const who = await this.sender(actor);
    const [made] = await this.db.insert(chatMessages).values({
      tenantId: actor.tenantId, conversationId, senderKey: key,
      senderType: actor.kind === 'staff' ? 'USER' : 'CABINET',
      senderUserId: actor.kind === 'staff' ? actor.userId : actor.parentUserId ?? null,
      senderStudentId: actor.kind === 'cabinet' ? actor.studentId : null,
      senderViewer: actor.kind === 'cabinet' ? actor.viewer : null,
      ...who, body, clientMessageId: dto.clientMessageId,
    }).onConflictDoNothing().returning();
    if (!made) {
      const [prior] = await this.db.select().from(chatMessages)
        .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.senderKey, key), eq(chatMessages.clientMessageId, dto.clientMessageId)));
      return { message: this.out(actor)(prior), duplicate: true };
    }
    await this.db.update(chatConversations).set({ lastMessageAt: made.createdAt }).where(eq(chatConversations.id, c.id));
    // The sender has read their own message.
    await this.markRead(actor, conversationId, Number(made.seq), true);
    await this.notify(actor.tenantId, conversationId, Number(made.seq));
    return { message: this.out(actor)(made), duplicate: false };
  }

  /** Who is writing: the stored label and its parts (see chatMessages). */
  private async sender(actor: ChatActor): Promise<{ senderName: string; senderPerson: string | null; senderAbout: string | null }> {
    if (actor.kind === 'staff') {
      const [u] = await this.db.select({ name: users.fullName }).from(users).where(eq(users.id, actor.userId));
      const name = u?.name ?? 'Xodim';
      return { senderName: name, senderPerson: name, senderAbout: null };
    }
    const [s] = await this.db.select({ name: students.fullName }).from(students).where(eq(students.id, actor.studentId));
    const child = s?.name ?? '';
    if (actor.parentUserId) {
      const [p] = await this.db.select({ name: users.fullName }).from(users).where(eq(users.id, actor.parentUserId));
      if (p) return { senderName: `${p.name} (${child} — ota-ona)`, senderPerson: p.name, senderAbout: child };
    }
    if (actor.viewer === 'parent') return { senderName: `${child} (ota-ona)`, senderPerson: null, senderAbout: child };
    return { senderName: child, senderPerson: child, senderAbout: null };
  }

  /** Moves the reader's position forward (never back). */
  async markRead(actor: ChatActor, conversationId: string, seq: number, skipCheck = false) {
    if (!skipCheck) await this.conversation(actor, conversationId);
    if (!Number.isSafeInteger(seq) || seq < 0) throw new BadRequestException("seq noto'g'ri");
    const key = participantKey(actor);
    const [{ max }] = await this.db.select({ max: sql<number>`coalesce(max(${chatMessages.seq}), 0)::bigint` }).from(chatMessages).where(eq(chatMessages.conversationId, conversationId));
    const to = Math.min(seq, Number(max));
    await this.db.insert(chatReads).values({ conversationId, participantKey: key, lastReadSeq: to, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [chatReads.conversationId, chatReads.participantKey], set: { lastReadSeq: sql`greatest(${chatReads.lastReadSeq}, ${to})`, updatedAt: new Date() } });
    return { lastReadSeq: to };
  }

  // ---- whom one can write to ---------------------------------------------

  /**
   * People one may start a conversation with - nobody else is listed:
   *  - a cabinet: the center, the student's current teachers, their groups;
   *  - a teacher: students of their groups, their groups;
   *  - inbox staff: students of the center, by name (search).
   */
  async contacts(actor: ChatActor, q?: string) {
    if (actor.kind === 'cabinet') {
      const rows = await this.db.select({ groupId: groups.id, groupName: groups.name, teacherUserId: teachers.userId, teacherName: teachers.fullName })
        .from(enrollments).innerJoin(groups, eq(groups.id, enrollments.groupId)).leftJoin(teachers, eq(teachers.id, groups.teacherId))
        .where(and(eq(enrollments.studentId, actor.studentId), eq(enrollments.status, 'ACTIVE'), eq(groups.tenantId, actor.tenantId), isNull(groups.deletedAt)));
      const teacherMap = new Map<string, string>();
      for (const r of rows) if (r.teacherUserId && r.teacherName) teacherMap.set(r.teacherUserId, r.teacherName);
      return {
        center: true,
        teachers: [...teacherMap].map(([userId, name]) => ({ userId, name })),
        groups: rows.filter((r) => r.teacherUserId).map((r) => ({ id: r.groupId, name: r.groupName })),
        students: [],
      };
    }
    const term = (q ?? '').trim().slice(0, 60);
    const mine = await teacherGroupIds(this.db, actor.tenantId, actor.role, actor.userId);
    const isTeacherOfGroups = mine !== null;
    let studentRows: { id: string; name: string }[] = [];
    if (isTeacherOfGroups) {
      if (mine!.length) {
        studentRows = await this.db.selectDistinct({ id: students.id, name: students.fullName }).from(enrollments)
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(and(inArray(enrollments.groupId, mine!), eq(enrollments.status, 'ACTIVE'), isNull(students.deletedAt), term ? ilike(students.fullName, `%${term}%`) : undefined))
          .orderBy(asc(students.fullName)).limit(50);
      }
    } else if (answersCenter(actor) && term.length >= 2) {
      studentRows = await this.db.select({ id: students.id, name: students.fullName }).from(students)
        .where(and(eq(students.tenantId, actor.tenantId), isNull(students.deletedAt), or(ilike(students.fullName, `%${term}%`), ilike(students.phone, `%${term}%`))))
        .orderBy(asc(students.fullName)).limit(20);
    }
    const groupRows = isTeacherOfGroups && mine!.length
      ? await this.db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, mine!))
      : [];
    return { center: answersCenter(actor), teachers: [], groups: groupRows, students: studentRows };
  }
}
