import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramPoller } from './telegram.poller';

@Global()
@Module({
  providers: [TelegramService, TelegramPoller],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
