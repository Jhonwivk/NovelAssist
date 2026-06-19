import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { ChaptersService } from './chapters.service';
import { ChapterPipelineService } from './chapter-pipeline.service';
import { CreateChapterDto, UpdateChapterDto } from './dto/create-chapter.dto';
import { ConsistencyService } from '../consistency/consistency.service';
import { MemoryService } from '../ai/memory.service';

@Controller()
export class ChaptersController {
  constructor(
    private readonly chapters: ChaptersService,
    private readonly consistency: ConsistencyService,
    private readonly memory: MemoryService,
    private readonly pipeline: ChapterPipelineService,
  ) {}

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

  /** 自动保存：等价于 PATCH，语义为"保存当前内容"。 */
  @Put('chapters/:id')
  save(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChapterDto) {
    return this.chapters.update(id, dto);
  }

  @Patch('chapters/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChapterDto) {
    return this.chapters.update(id, dto);
  }

  /**
   * 后台分析本章（plan §5.4/§6.3 承诺的"保存后自动异步触发"）。
   * fire-and-forget：L1 抽取 → L2/L3/L4 一致性检查 → L2/L1 摘要。
   * 前端 30s 空闲后调用，不阻塞保存。
   */
  @Post('chapters/:id/analyze')
  async analyze(@Param('id', ParseIntPipe) id: number) {
    // 不 await——后台跑，立即返回
    this.consistency.checkChapter(id).catch(() => undefined);
    this.memory.summarizeChapter(id).catch(() => undefined);
    return { id, status: 'analyzing' };
  }

  /**
   * 统一章节流水线（refactor-plan P0）：生成正文 → 落库 → **同步**一致性+记忆分析 → 门禁。
   * 批量/整书生成与"生成并落库"统一走此入口，确保每章在下一章开写前已建好记忆，修复章间连续性。
   */
  @Post('chapters/:id/write')
  write(@Param('id', ParseIntPipe) id: number) {
    return this.pipeline.generateAndAnalyze(id);
  }

  /** 单独计算某章门禁（已生成章节可用）。 */
  @Get('chapters/:id/gate')
  gate(@Param('id', ParseIntPipe) id: number) {
    return this.pipeline.computeGate(id);
  }

  /**
   * 整书自动编排（mode c）：总纲 → 分波规划 → 逐章生成+分析+门禁，可续跑。
   * 注意：长任务（数十章）会运行较久；客户端断开后服务端仍继续，按章节状态轮询进度。
   */
  @Post('novels/:novelId/autopilot')
  autopilot(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() body: { target?: number; wave?: number; targetWords?: number },
  ) {
    return this.pipeline.autopilotBook(novelId, body ?? {});
  }

  /**
   * 批量分析全书：对已有正文的章节串行跑 一致性抽取 + 摘要，填充设定库/洞察/记忆。
   * 用于「分析全书」按钮（导入的书或未自动分析的书）。长任务，逐章落库。
   */
  @Post('novels/:novelId/analyze-all')
  analyzeAll(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.pipeline.analyzeBook(novelId);
  }

  @Delete('chapters/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.chapters.remove(id);
  }
}
