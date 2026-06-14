import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /** 生成章节 L2 + L1 摘要并落库（plan §6.3）。 */
  @Post('summarize/:chapterId')
  summarize(@Param('chapterId', ParseIntPipe) chapterId: number) {
    return this.memory.summarizeChapter(chapterId);
  }

  /** 刷新全书 L4 摘要。 */
  @Post('book/:novelId')
  refreshBook(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.memory.refreshBook(novelId);
  }

  /** 调试：查看组装后的上下文（plan §6.2）。 */
  @Get('context')
  context(@Query('novelId', ParseIntPipe) novelId: number, @Query('chapterId') chapterId?: string) {
    const cid = chapterId ? Number(chapterId) : undefined;
    return this.memory.assembleContext(novelId, cid, undefined);
  }
}
