import { Global, Module } from '@nestjs/common';
import { PortalAuthModule } from '../portal/portal-auth.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

// Global: every module that stores an upload registers it here.
@Global()
@Module({
  imports: [PortalAuthModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
