import { Global, Module } from '@nestjs/common';
import { NoticeOutboxController } from './notice-outbox.controller';
import { NoticeOutboxService } from './notice-outbox.service';

@Global()
@Module({
  providers: [NoticeOutboxService],
  controllers: [NoticeOutboxController],
  exports: [NoticeOutboxService],
})
export class NoticeOutboxModule {}
