import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramPoller } from './telegram.poller';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
  imports: [AiModule],
  providers: [TelegramService, TelegramPoller],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
