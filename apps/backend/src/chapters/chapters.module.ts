import { Module } from '@nestjs/common';
import { ChaptersController } from './chapters.controller';
import { ChaptersService } from './chapters.service';
import { ChapterPipelineService } from './chapter-pipeline.service';
import { AiModule } from '../ai/ai.module';
import { ConsistencyModule } from '../consistency/consistency.module';

@Module({
  imports: [AiModule, ConsistencyModule],
  controllers: [ChaptersController],
  providers: [ChaptersService, ChapterPipelineService],
  exports: [ChaptersService],
})
export class ChaptersModule {}
