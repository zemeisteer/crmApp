import { Module } from '@nestjs/common';
import { PortalAuthModule } from '../portal/portal-auth.module';
import { ChatController } from './chat.controller';
import { ChatHub } from './chat-hub.service';
import { ChatService } from './chat.service';

@Module({
  imports: [PortalAuthModule],
  controllers: [ChatController],
  providers: [ChatService, ChatHub],
  exports: [ChatService],
})
export class ChatModule {}
