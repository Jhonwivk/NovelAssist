import { Module } from '@nestjs/common';
import { VolumesController } from './volumes.controller';
import { VolumesService } from './volumes.service';

@Module({
  controllers: [VolumesController],
  providers: [VolumesService],
})
export class VolumesModule {}
