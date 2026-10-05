import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AccessController } from './access.controller';
import { RouteAccessService } from './route-access';

@Module({
  imports: [DiscoveryModule],
  providers: [RouteAccessService],
  controllers: [AccessController],
})
export class AccessModule {}
