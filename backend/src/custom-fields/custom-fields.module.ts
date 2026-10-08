import { Global, Module } from '@nestjs/common';
import { PortalAuthModule } from '../portal/portal-auth.module';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

// Global: students, leads, conversion, export and import read and write values.
@Global()
@Module({
  imports: [PortalAuthModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
