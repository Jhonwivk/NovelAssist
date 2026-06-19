import { Module } from '@nestjs/common';
import { VolumesController, VolumesItemController } from './volumes.controller';
import { VolumesService } from './volumes.service';

@Module({
  controllers: [VolumesController, VolumesItemController],
  providers: [VolumesService],
})
export class VolumesModule {}
