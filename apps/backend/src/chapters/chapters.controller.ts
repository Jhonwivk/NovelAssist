import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { ChaptersService } from './chapters.service';
import { CreateChapterDto, UpdateChapterDto } from './dto/create-chapter.dto';

@Controller()
export class ChaptersController {
  constructor(private readonly chapters: ChaptersService) {}

  @Post('novels/:novelId/chapters')
  create(@Param('novelId', ParseIntPipe) novelId: number, @Body() dto: CreateChapterDto) {
    return this.chapters.create(novelId, dto);
  }

  @Get('novels/:novelId/chapters')
  findAll(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.chapters.findAll(novelId);
  }

  @Get('chapters/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.chapters.findOne(id);
  }

  /** 自动保存：等价于 PATCH，语义为“保存当前内容”。 */
  @Put('chapters/:id')
  save(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChapterDto) {
    return this.chapters.update(id, dto);
  }

  @Patch('chapters/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChapterDto) {
    return this.chapters.update(id, dto);
  }

  @Delete('chapters/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.chapters.remove(id);
  }
}
