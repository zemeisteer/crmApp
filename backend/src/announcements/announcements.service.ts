import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { announcements, groups } from '../db/schema';
import { CreateAnnouncementDto, QueryAnnouncementDto } from './dto/announcement.dto';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
  ) {}

  async findAll(tenantId: string, query: QueryAnnouncementDto) {
    const conditions = [eq(announcements.tenantId, tenantId)];

    if (query.targetAudience) {
      conditions.push(eq(announcements.targetAudience, query.targetAudience));
    }
    if (query.priority) {
      conditions.push(eq(announcements.priority, query.priority));
    }
    if (query.targetGroupId) {
      conditions.push(eq(announcements.targetGroupId, query.targetGroupId));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(announcements.title, `%${query.search}%`),
          ilike(announcements.content, `%${query.search}%`),
        )!,
      );
    }

    return this.db.query.announcements.findMany({
      where: and(...conditions),
      with: {
        author: { columns: { id: true, fullName: true, email: true } },
        targetGroup: { columns: { id: true, name: true, subject: true } },
      },
      orderBy: [desc(announcements.publishedAt)],
    });
  }

  async findOne(tenantId: string, id: string) {
    const item = await this.db.query.announcements.findFirst({
      where: and(eq(announcements.id, id), eq(announcements.tenantId, tenantId)),
      with: {
        author: true,
        targetGroup: true,
      },
    });
    if (!item) {
      throw new NotFoundException("E'lon topilmadi");
    }
    return item;
  }

  async create(tenantId: string, userId: string, dto: CreateAnnouncementDto) {
    if (dto.targetAudience === 'GROUP' && dto.targetGroupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.targetGroupId), eq(groups.tenantId, tenantId)),
      });
      if (!group) {
        throw new BadRequestException("Guruh topilmadi yoki boshqa markazga tegishli");
      }
    }

    const [created] = await this.db
      .insert(announcements)
      .values({
        tenantId,
        authorId: userId,
        title: dto.title,
        content: dto.content,
        targetAudience: dto.targetAudience || 'ALL',
        targetGroupId: dto.targetGroupId,
        priority: dto.priority || 'NORMAL',
        sendTelegram: Boolean(dto.sendTelegram),
        publishedAt: new Date(),
      })
      .returning();

    // Trigger Telegram Broadcast if requested
    if (dto.sendTelegram) {
      void this.telegram.broadcastAnnouncement(
        tenantId,
        dto.title,
        dto.content,
        dto.priority || 'NORMAL',
        dto.targetGroupId,
      );
    }

    return this.findOne(tenantId, created.id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db
      .delete(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.tenantId, tenantId)));
    return { success: true };
  }
}
