import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { NovelsModule } from './novels/novels.module';
import { VolumesModule } from './volumes/volumes.module';
import { ChaptersModule } from './chapters/chapters.module';
import { BibleModule } from './bible/bible.module';
import { AiModule } from './ai/ai.module';
import { ExportModule } from './export/export.module';
import { ConsistencyModule } from './consistency/consistency.module';
import { ForeshadowModule } from './foreshadow/foreshadow.module';
import { TimelineModule } from './timeline/timeline.module';
import { VersionModule } from './version/version.module';
import { StyleModule } from './style/style.module';
import { StatsModule } from './stats/stats.module';
import { TemplatesModule } from './templates/templates.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    NovelsModule,
    VolumesModule,
    ChaptersModule,
    BibleModule,
    AiModule,
    ConsistencyModule,
    ForeshadowModule,
    TimelineModule,
    VersionModule,
    StyleModule,
    StatsModule,
    TemplatesModule,
    ExportModule,
  ],
})
export class AppModule {}
