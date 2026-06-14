import { Body, Controller, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AiService } from './ai.service';
import { MemoryService } from './memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { htmlToParagraphs } from '../common/text.utils';
import {
  ChatDto,
  ContinueDto,
  GenerateChapterDto,
  IdeaDto,
  LocalEditDto,
  NovelTaskDto,
  OptimizeOutlineDto,
  OutlineChaptersDto,
  OutlineDto,
  PolishDto,
  ReviewDto,
} from './dto/ai.dto';
import { countWords, paragraphsToHtml } from '../common/text.utils';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly prisma: PrismaService,
  ) {}

  private async novelBase(novelId: number) {
    const n = await this.prisma.novel.findUnique({ where: { id: novelId } });
    if (!n) throw new NotFoundException(`Novel ${novelId} not found`);
    let meta: any = {};
    try {
      meta = JSON.parse(n.meta ?? '{}');
    } catch {
      meta = {};
    }
    return {
      title: n.title,
      genre: n.genre ?? undefined,
      synopsis: n.synopsis ?? undefined,
      worldviewText: n.worldviewText ?? undefined,
      theme: meta.theme || undefined,
      trope: meta.trope || undefined,
      coreSetting: meta.coreSetting || undefined,
      audience: meta.audience || undefined,
    };
  }

  private logTask(type: string, novelId: number | undefined, chapterId: number | undefined, ok: boolean) {
    this.prisma.aiTask
      .create({ data: { type, novelId, chapterId, status: ok ? 'success' : 'error' } })
      .catch(() => undefined);
  }

  // ===== 大纲 / 灵感 / 书名 / 简介 / 钩子（非流式，ai-service 命中缓存）=====

  @Post('outline')
  async outline(@Body() dto: OutlineDto) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('outline', dto.novelId, '/outline', { ...base, instruction: dto.instruction });
  }

  @Post('outline/optimize')
  async outlineOptimize(@Body() dto: OptimizeOutlineDto) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('outline-optimize', dto.novelId, '/outline/optimize', {
      ...base,
      currentOutline: dto.currentOutline,
      instruction: dto.instruction,
    });
  }

  /** 批量生成章节计划（标题 + 章纲）。 */
  @Post('outline/chapters')
  async outlineChapters(@Body() dto: OutlineChaptersDto) {
    const base = await this.novelBase(dto.novelId);
    const novel = await this.prisma.novel.findUnique({ where: { id: dto.novelId } });
    return this.ai.loggedJson('outline-chapters', dto.novelId, '/outline-chapters', {
      ...base,
      masterOutline: novel?.masterOutline ?? undefined,
      count: dto.count ?? 10,
      instruction: dto.instruction,
    });
  }

  /** 生成单章正文并落库（批量生成正文用：服务端消费流 + 保存）。 */
  @Post('chapter/:chapterId/generate')
  async generateChapterContent(@Param('chapterId', ParseIntPipe) chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    const ctx = await this.memory.assembleContext(chapter.novelId, chapterId);
    const text = await this.ai.collectStream('/chapter', {
      title: ctx.novel.title,
      genre: ctx.novel.genre,
      synopsis: ctx.novel.synopsis,
      worldviewText: ctx.novel.worldviewText,
      chapterTitle: ctx.chapterTitle,
      outline: ctx.outline,
      previousSummary: ctx.previousSummary,
      context: ctx.context,
    });
    const html = paragraphsToHtml(text);
    const updated = await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { content: html, wordCount: countWords(html), status: 'writing' },
    });
    this.logTask('chapter', chapter.novelId, chapterId, true);
    return { id: chapterId, wordCount: updated.wordCount, length: text.length };
  }

  @Post('idea')
  idea(@Body() dto: IdeaDto) {
    return this.ai.loggedJson('idea', undefined, '/idea', dto);
  }

  @Post('title')
  async title(@Body() dto: NovelTaskDto) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('title', dto.novelId, '/title', { ...base, instruction: dto.instruction });
  }

  @Post('synopsis')
  async synopsis(@Body() dto: NovelTaskDto) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('synopsis', dto.novelId, '/synopsis', { ...base, instruction: dto.instruction });
  }

  @Post('hook')
  async hook(@Body() dto: NovelTaskDto) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('hook', dto.novelId, '/hook', { ...base, instruction: dto.instruction });
  }

  // ===== 创作类（流式，带组装上下文）=====

  @Post('chapter')
  async chapter(@Body() dto: GenerateChapterDto, @Res() res: Response) {
    const ctx = await this.memory.assembleContext(dto.novelId, dto.chapterId, dto.instruction);
    const ok = await this.ai.streamRequest('/chapter', {
      title: ctx.novel.title,
      genre: ctx.novel.genre,
      synopsis: ctx.novel.synopsis,
      worldviewText: ctx.novel.worldviewText,
      chapterTitle: ctx.chapterTitle,
      outline: ctx.outline,
      previousSummary: ctx.previousSummary,
      context: ctx.context,
      instruction: dto.instruction,
      targetWords: dto.targetWords,
    }, res);
    this.logTask('chapter', dto.novelId, dto.chapterId, ok);
  }

  @Post('continue')
  async continue(@Body() dto: ContinueDto, @Res() res: Response) {
    const ctx = await this.memory.assembleContext(dto.novelId, dto.chapterId, dto.instruction);
    const chapter = await this.prisma.chapter.findUnique({ where: { id: dto.chapterId } });
    const content = htmlToParagraphs(chapter?.content ?? '').join('\n\n');
    const ok = await this.ai.streamRequest('/continue', {
      title: ctx.novel.title,
      genre: ctx.novel.genre,
      synopsis: ctx.novel.synopsis,
      worldviewText: ctx.novel.worldviewText,
      content,
      context: ctx.context,
      instruction: dto.instruction,
    }, res);
    this.logTask('continue', dto.novelId, dto.chapterId, ok);
  }

  @Post('polish')
  async polish(@Body() dto: PolishDto, @Res() res: Response) {
    const base = await this.novelBase(dto.novelId);
    const ok = await this.ai.streamRequest('/polish', {
      ...base,
      selection: dto.selection,
      context: dto.context,
      instruction: dto.instruction,
    }, res);
    this.logTask('polish', dto.novelId, undefined, ok);
  }

  @Post('expand')
  async expand(@Body() dto: LocalEditDto, @Res() res: Response) {
    const base = await this.novelBase(dto.novelId);
    const ok = await this.ai.streamRequest('/expand', { ...base, text: dto.text, instruction: dto.instruction }, res);
    this.logTask('expand', dto.novelId, undefined, ok);
  }

  @Post('rewrite')
  async rewrite(@Body() dto: LocalEditDto, @Res() res: Response) {
    const base = await this.novelBase(dto.novelId);
    const ok = await this.ai.streamRequest('/rewrite', { ...base, text: dto.text, instruction: dto.instruction }, res);
    this.logTask('rewrite', dto.novelId, undefined, ok);
  }

  @Post('viewpoint')
  async viewpoint(@Body() dto: LocalEditDto, @Res() res: Response) {
    const base = await this.novelBase(dto.novelId);
    const ok = await this.ai.streamRequest('/viewpoint', { ...base, text: dto.text, viewpoint: dto.viewpoint, instruction: dto.instruction }, res);
    this.logTask('viewpoint', dto.novelId, undefined, ok);
  }

  @Post('style-switch')
  async styleSwitch(@Body() dto: LocalEditDto, @Res() res: Response) {
    const base = await this.novelBase(dto.novelId);
    const ok = await this.ai.streamRequest('/style-switch', { ...base, text: dto.text, style: dto.style, instruction: dto.instruction }, res);
    this.logTask('style-switch', dto.novelId, undefined, ok);
  }

  @Post('chat')
  async chat(@Body() dto: ChatDto, @Res() res: Response) {
    const ctx = await this.memory.assembleContext(dto.novelId, null, dto.message);
    const ok = await this.ai.streamRequest('/chat', {
      title: ctx.novel.title,
      genre: ctx.novel.genre,
      synopsis: ctx.novel.synopsis,
      worldviewText: ctx.novel.worldviewText,
      message: dto.message,
      context: ctx.context,
    }, res);
    this.logTask('chat', dto.novelId, undefined, ok);
  }

  // ===== 审稿（非流式 JSON）=====

  @Post('review')
  async review(@Body() dto: ReviewDto) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: dto.chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${dto.chapterId} not found`);
    const content = htmlToParagraphs(chapter.content).join('\n\n');
    return this.ai.loggedJson('review', chapter.novelId, '/review', { content, instruction: dto.instruction });
  }
}
