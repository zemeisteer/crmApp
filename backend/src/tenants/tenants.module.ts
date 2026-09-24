import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [LeadsModule],
  providers: [TenantsService],
  controllers: [TenantsController],
})
export class TenantsModule {}
