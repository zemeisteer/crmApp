import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

@Module({
  providers: [CashService],
  controllers: [CashController],
})
export class CashModule {}
