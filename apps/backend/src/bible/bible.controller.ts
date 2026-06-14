import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { BibleService } from './bible.service';
import { CreateEntityDto, UpdateEntityDto } from './dto/create-entity.dto';

@Controller()
export class BibleController {
  constructor(private readonly bible: BibleService) {}

  @Get('novels/:novelId/bible')
  getBible(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.bible.getBible(novelId);
  }

  @Get('novels/:novelId/items')
  items(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.bible.itemsWithState(novelId);
  }

  @Post('novels/:novelId/entities')
  createEntity(@Param('novelId', ParseIntPipe) novelId: number, @Body() dto: CreateEntityDto) {
    return this.bible.create(novelId, dto);
  }

  @Patch('entities/:id')
  updateEntity(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEntityDto) {
    return this.bible.update(id, dto);
  }

  @Get('entities/:id/trajectory')
  trajectory(@Param('id', ParseIntPipe) id: number) {
    return this.bible.trajectory(id);
  }

  @Delete('entities/:id')
  removeEntity(@Param('id', ParseIntPipe) id: number) {
    return this.bible.remove(id);
  }
}
