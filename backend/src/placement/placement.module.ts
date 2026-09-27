import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PlacementService } from './placement.service';
import { PlacementController, PublicPlacementController } from './placement.controller';

@Module({
  imports: [AiModule],
  providers: [PlacementService],
  controllers: [PlacementController, PublicPlacementController],
})
export class PlacementModule {}
