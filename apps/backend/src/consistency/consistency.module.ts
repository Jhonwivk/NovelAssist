import { Module } from '@nestjs/common';
import { ConsistencyController } from './consistency.controller';
import { ConsistencyService } from './consistency.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ConsistencyController],
  providers: [ConsistencyService],
  exports: [ConsistencyService],
})
export class ConsistencyModule {}
