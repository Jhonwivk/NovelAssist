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
import { bigramSimilarity, countWords, paragraphsToHtml } from '../common/text.utils';

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
    // 取已有章节（标题 + 摘要），让 AI「接着往后规划」而非从总纲开头重复
    const existing = await this.prisma.chapter.findMany({
      where: { novelId: dto.novelId },
      orderBy: { order: 'asc' },
      include: { summary: true },
    });
    const res: any = await this.ai.loggedJson('outline-chapters', dto.novelId, '/outline-chapters', {
      ...base,
      masterOutline: novel?.masterOutline ?? undefined,
      count: dto.count ?? 10,
      instruction: dto.instruction,
      bookSummary: novel?.bookSummary ?? undefined,
      existingChapters: existing.map((c) => ({
        order: c.order,
        title: c.title,
        summary: c.summary?.content ?? undefined,
      })),
    });

    // P0 去重（保守）：仅剔除与已写章节「标题+章纲」近重复的计划；用 Jaccard 避免通用词误伤，
    // 且绝不清空整波（全判重则回退原计划，避免无章可建）。
    const planned = res?.result?.chapters;
    if (Array.isArray(planned) && existing.length) {
      const corpus = existing.map((c) => `${c.title}。${c.outlineText ?? ''}`);
      const dropped: string[] = [];
      const kept = planned.filter((ch: any) => {
        const probe = `${ch?.title ?? ''}。${ch?.outline ?? ''}`;
        const maxSim = Math.max(0, ...corpus.map((c) => bigramSimilarity(probe, c)));
        if (maxSim >= 0.55) {
          dropped.push(String(ch?.title ?? ''));
          return false;
        }
        return true;
      });
      if (kept.length) {
        res.result.chapters = kept;
        if (dropped.length) res.result.dropped = dropped;
      }
    }
    return res;
  }

  /** 生成单章正文并落库（批量生成正文用：服务端消费流 + 保存）。 */
  @Post('chapter/:chapterId/generate')
  async generateChapterContent(@Param('chapterId', ParseIntPipe) chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    const ctx = await this.memory.assembleContext(chapter.novelId, chapterId);
    const { text, usage } = await this.ai.collectStream('/chapter', {
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
    this.prisma.aiTask
      .create({ data: { type: 'chapter', novelId: chapter.novelId, chapterId, status: 'success', tokensIn: usage?.in ?? 0, tokensOut: usage?.out ?? 0, cached: false, model: usage?.model ?? null } })
      .catch(() => undefined);
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

  // ===== 去AI味（两遍润色）=====

  @Post('humanize/:chapterId')
  async humanize(@Param('chapterId', ParseIntPipe) chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    const plain = htmlToParagraphs(chapter.content).join('\n\n');
    if (!plain.trim()) throw new NotFoundException(`Chapter ${chapterId} 正文为空`);
    const r = await this.ai.loggedJson('humanize', chapter.novelId, '/humanize', { text: plain });
    const text = r?.content ?? plain;
    const html = paragraphsToHtml(text);
    // 改写前存快照（可回滚）
    const snap = await this.prisma.chapterSnapshot.create({
      data: { chapterId, content: chapter.content, wordCount: chapter.wordCount, reason: 'pre-humanize' },
    });
    const updated = await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { content: html, wordCount: countWords(html) },
    });
    return { id: chapterId, wordCount: updated.wordCount, snapshotId: snap.id };
  }

  // ===== Beat 分解（章纲 → 4-6 拍）=====

  @Post('chapter-beats')
  async chapterBeats(@Body() dto: { novelId: number; chapterTitle?: string; outline: string; instruction?: string }) {
    const base = await this.novelBase(dto.novelId);
    return this.ai.loggedJson('chapter-beats', dto.novelId, '/chapter-beats', {
      ...base,
      chapterTitle: dto.chapterTitle,
      outline: dto.outline,
      instruction: dto.instruction,
    });
  }
}
