import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

// What students owe, for every screen that shows it.
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
