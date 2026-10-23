import { Module } from '@nestjs/common';
import { CustomDomainsController } from './custom-domains.controller';
import { CustomDomainsService } from './custom-domains.service';

@Module({
  providers: [CustomDomainsService],
  controllers: [CustomDomainsController],
})
export class CustomDomainsModule {}
