import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClassifierController } from './classifier.controller';
import { ClassifierService } from './classifier.service';

@Module({
  imports: [ConfigModule],
  providers: [ClassifierService],
  controllers: [ClassifierController],
  exports: [ClassifierService],
})
export class ClassifierModule {}
