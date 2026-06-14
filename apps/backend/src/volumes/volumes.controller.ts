import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { VolumesService } from './volumes.service';
import { CreateVolumeDto, UpdateVolumeDto } from './dto/create-volume.dto';

@Controller('novels/:novelId/volumes')
export class VolumesController {
  constructor(private readonly volumes: VolumesService) {}

  @Post()
  create(@Param('novelId', ParseIntPipe) novelId: number, @Body() dto: CreateVolumeDto) {
    return this.volumes.create(novelId, dto);
  }

  @Get()
  findAll(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.volumes.findAll(novelId);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVolumeDto) {
    return this.volumes.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.volumes.remove(id);
  }
}
