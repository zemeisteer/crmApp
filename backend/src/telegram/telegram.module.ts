import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramPoller } from './telegram.poller';
import { AiModule } from '../ai/ai.module';
import { ClassifierModule } from '../classifier/classifier.module';

@Global()
@Module({
  imports: [AiModule, ClassifierModule],
  providers: [TelegramService, TelegramPoller],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
