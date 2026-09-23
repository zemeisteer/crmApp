import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [InvitationsService],
  controllers: [InvitationsController],
  exports: [InvitationsService],
})
export class InvitationsModule {}
