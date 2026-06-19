import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ConsistencyService } from './consistency.service';

@Controller('consistency')
export class ConsistencyController {
  constructor(private readonly consistency: ConsistencyService) {}

  /** 对单章跑一致性检查（L1-L4），返回问题清单（plan §5.4）。 */
  @Post('check/:chapterId')
  check(@Param('chapterId', ParseIntPipe) chapterId: number) {
    return this.consistency.checkChapter(chapterId);
  }

  /** 列出作品的问题清单。 */
  @Get('issues')
  issues(@Query('novelId', ParseIntPipe) novelId: number) {
    return this.consistency.listIssues(novelId);
  }

  /** 本章抽取产生的变化（运行时面板·生成后变化）。 */
  @Get('changes/:chapterId')
  changes(@Param('chapterId', ParseIntPipe) chapterId: number) {
    return this.consistency.chapterChanges(chapterId);
  }

  /** L5 反馈：resolve（resolved / ignored / intentional）。 */
  @Post('issues/:id/resolve')
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'resolved' | 'ignored' | 'intentional',
  ) {
    return this.consistency.resolveIssue(id, status);
  }

  /** AI 一键修复问题。 */
  @Post('issues/:id/fix')
  fix(@Param('id', ParseIntPipe) id: number) {
    return this.consistency.fixIssue(id);
  }
}
