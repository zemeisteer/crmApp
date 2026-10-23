import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LeadsModule } from '../leads/leads.module';
import { HiringModule } from '../hiring/hiring.module';
import { PlacementService } from './placement.service';
import { PlacementController, PublicPlacementController } from './placement.controller';

@Module({
  imports: [AiModule, LeadsModule, HiringModule],
  providers: [PlacementService],
  controllers: [PlacementController, PublicPlacementController],
})
export class PlacementModule {}
