import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { NovelsService } from './novels.service';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Controller('novels')
export class NovelsController {
  constructor(private readonly novels: NovelsService) {}

  @Post()
  create(@Body() dto: CreateNovelDto) {
    return this.novels.create(dto);
  }

  @Get()
  findAll() {
    return this.novels.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.novels.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNovelDto) {
    return this.novels.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.novels.remove(id);
  }
}
