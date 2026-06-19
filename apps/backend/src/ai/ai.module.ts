import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { ConfigController } from './config.controller';
import { MemoryController } from './memory.controller';
import { AiService } from './ai.service';
import { MemoryService } from './memory.service';
import { RuntimeStateService } from './runtime.service';

@Module({
  controllers: [AiController, MemoryController, ConfigController],
  providers: [AiService, MemoryService, RuntimeStateService],
  exports: [AiService, MemoryService, RuntimeStateService],
})
export class AiModule {}
