import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TrialInterceptor } from './trial.interceptor';
import { TrialLifecycleService } from './trial-lifecycle.service';
import { TrialClaimsService } from './trial-claims.service';

// The free trial's rules on every request (trial.interceptor.ts) and the
// clean-up of unpaid trials that ended long ago (trial-lifecycle.service.ts).
@Global()
@Module({
  providers: [TrialLifecycleService, TrialClaimsService, { provide: APP_INTERCEPTOR, useClass: TrialInterceptor }],
  exports: [TrialLifecycleService, TrialClaimsService],
})
export class TrialModule {}
