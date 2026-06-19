import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MemoryService } from '../ai/memory.service';
import { ConsistencyService } from '../consistency/consistency.service';
import { bigramSimilarity, countWords, paragraphsToHtml } from '../common/text.utils';

export interface ChapterGate {
  passed: boolean;
  highIssues: number;
  totalIssues: number;
  /** 与上一章摘要的情节重叠度（0-1），过高 ⇒ 疑似重写上一章。 */
  overlapPrev: number;
  warnings: string[];
}

/**
 * 统一章节流水线（refactor-plan P0）。
 * 把"生成正文 → 落库 → 一致性+记忆分析 → 门禁"做成**同步、必经**的一条链，
 * 取代此前"批量只存正文、analyze 异步 fire-and-forget"的分裂路径。
 * 关键收益：批量/整书生成时，每章在下一章开写前就已产出 L2 摘要与抽取数据，
 * 于是 assembleContext 的 prevSummary/recentSummaries/runtime 不再为空，章间连续性恢复。
 */
@Injectable()
export class ChapterPipelineService {
  private readonly logger = new Logger(ChapterPipelineService.name);
  /** 与上一章摘要重叠超过此阈值即判定 gate 不过（疑似重复成文）。 */
  static OVERLAP_THRESHOLD = 0.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly consistency: ConsistencyService,
  ) {}

  /** 反向刹车 + 接续约束：注入章节 Prompt，遏制重复成文与过早收束冲突。 */
  static BRAKE_INSTRUCTION =
    '严格承接上文继续推进，严禁重复已写过的情节、场景与开场；本章须制造新进展、至少留下一个新的未决冲突或悬念，并以钩子收尾。';

  /** 生成本章正文 → 落库 → 同步分析 → 计算门禁 → 据门禁置状态。 */
  async generateAndAnalyze(
    chapterId: number,
    opts: { targetWords?: number; instruction?: string } = {},
  ): Promise<{ id: number; wordCount: number; gate: ChapterGate }> {
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
      instruction: opts.instruction,
      targetWords: opts.targetWords,
    });
    this.recordUsage('chapter', chapter.novelId, chapterId, usage);
    const html = paragraphsToHtml(text);
    const saved = await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { content: html, wordCount: countWords(html), status: 'writing' },
    });

    // 同步分析（必经）：先一致性抽取/检查，再生成摘要——让下一章能立即用上本章记忆。
    try {
      await this.consistency.checkChapter(chapterId);
    } catch (e) {
      this.logger.warn(`checkChapter(${chapterId}) 失败：${msg(e)}`);
    }
    try {
      await this.memory.summarizeChapter(chapterId);
    } catch (e) {
      this.logger.warn(`summarizeChapter(${chapterId}) 失败：${msg(e)}`);
    }

    const gate = await this.computeGate(chapterId);
    await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { status: gate.passed ? 'complete' : 'needs_fix' },
    });
    await this.recountNovel(chapter.novelId);
    return { id: chapterId, wordCount: saved.wordCount, gate };
  }

  /** 回算作品总字数（pipeline 直接写章节绕过了 ChaptersService.update 的回算）。 */
  private async recountNovel(novelId: number) {
    const agg = await this.prisma.chapter.aggregate({ where: { novelId }, _sum: { wordCount: true } });
    await this.prisma.novel.update({ where: { id: novelId }, data: { wordCount: agg._sum.wordCount ?? 0 } });
  }

  /** 记录流式生成的 token 用量到 AiTask（best-effort）。 */
  private recordUsage(type: string, novelId: number, chapterId: number, usage: any) {
    if (!usage) return;
    this.prisma.aiTask
      .create({ data: { type, novelId, chapterId, status: 'success', tokensIn: usage.in ?? 0, tokensOut: usage.out ?? 0, cached: false, model: usage.model ?? null } })
      .catch(() => undefined);
  }

  /** 门禁：高危一致性问题 + 与上一章情节重叠度。可独立用于已生成章节。 */
  async computeGate(chapterId: number): Promise<ChapterGate> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    const warnings: string[] = [];

    const issues = await this.prisma.consistencyIssue.findMany({
      where: { novelId: chapter.novelId, status: 'open', location: { contains: `"chapterId":${chapterId}` } },
    });
    // 门禁仅对确定性层(L2/L3)的高危问题硬拦截；L4(语义)高危易误报，降级为提示不阻断。
    const hardHigh = issues.filter((i) => i.severity === 'high' && (i.layer === 'L2' || i.layer === 'L3')).length;
    const softHigh = issues.filter((i) => i.severity === 'high' && i.layer === 'L4').length;
    const highIssues = hardHigh;
    if (hardHigh > 0) warnings.push(`${hardHigh} 个高危规则冲突(L2/L3)待处理`);
    if (softHigh > 0) warnings.push(`${softHigh} 个语义存疑(L4)建议复核`);

    let overlapPrev = 0;
    const [thisSum, prevChapter] = await Promise.all([
      this.prisma.chapterSummary.findUnique({ where: { chapterId } }),
      this.prisma.chapter.findFirst({
        where: { novelId: chapter.novelId, order: chapter.order - 1 },
        include: { summary: true },
      }),
    ]);
    if (thisSum?.content && prevChapter?.summary?.content) {
      overlapPrev = bigramSimilarity(thisSum.content, prevChapter.summary.content);
      if (overlapPrev >= ChapterPipelineService.OVERLAP_THRESHOLD) {
        warnings.push(`与上一章「${prevChapter.title}」情节重叠度过高（${Math.round(overlapPrev * 100)}%），疑似重写`);
      }
    }

    const passed = highIssues === 0 && overlapPrev < ChapterPipelineService.OVERLAP_THRESHOLD;
    return { passed, highIssues, totalIssues: issues.length, overlapPrev: Number(overlapPrev.toFixed(3)), warnings };
  }

  // ================= 整书编排（mode c / autopilot）=================

  /** 规划接下来的 count 章（带服务端去重），返回 [{title, outline}]。 */
  private async planChapters(novelId: number, count: number): Promise<{ title: string; outline: string }[]> {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    if (!novel || count <= 0) return [];
    let meta: any = {};
    try { meta = JSON.parse(novel.meta ?? '{}'); } catch { meta = {}; }
    const existing = await this.prisma.chapter.findMany({
      where: { novelId }, orderBy: { order: 'asc' }, include: { summary: true },
    });
    const res: any = await this.ai.jsonRequest('/outline-chapters', {
      title: novel.title,
      genre: novel.genre ?? undefined,
      synopsis: novel.synopsis ?? undefined,
      worldviewText: novel.worldviewText ?? undefined,
      theme: meta.theme || undefined,
      trope: meta.trope || undefined,
      coreSetting: meta.coreSetting || undefined,
      audience: meta.audience || undefined,
      masterOutline: novel.masterOutline ?? undefined,
      count,
      bookSummary: novel.bookSummary ?? undefined,
      existingChapters: existing.map((c) => ({ order: c.order, title: c.title, summary: c.summary?.content ?? undefined })),
    });
    const planned = res?.result?.chapters;
    if (!Array.isArray(planned)) return [];
    const norm = (c: any) => ({ title: String(c?.title ?? ''), outline: String(c?.outline ?? '') });
    if (!existing.length) return planned.map(norm);
    // 去重（保守）：仅与已写章节的「标题+章纲」近重复时剔除；用 Jaccard 避免长摘要里的通用词汇误伤。
    // 关键：去重绝不能清空整波——否则整书提前中断。若全被判重则回退原计划。
    const corpus = existing.map((c) => `${c.title}。${c.outlineText ?? ''}`);
    const kept = planned.filter((c: any) => {
      const probe = `${c?.title ?? ''}。${c?.outline ?? ''}`;
      return Math.max(0, ...corpus.map((x) => bigramSimilarity(probe, x))) < 0.55;
    });
    return (kept.length ? kept : planned).map(norm);
  }

  /**
   * 整书自动编排：确保总纲 → 分波规划（去重）→ 逐章 generateAndAnalyze（带 targetWords + 反向刹车）。
   * 可续跑：跳过已写(wordCount>200)与失败(status=gen_failed)章节；失败计数不阻塞整体推进。
   */
  async autopilotBook(
    novelId: number,
    opts: { target?: number; wave?: number; targetWords?: number } = {},
  ): Promise<{ written: number; gateFailed: number; failed: number; total: number }> {
    const target = opts.target ?? 30;
    const targetWords = opts.targetWords ?? 3200;
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    if (!novel) throw new NotFoundException(`Novel ${novelId} not found`);

    if (!novel.masterOutline) {
      try {
        let meta: any = {};
        try { meta = JSON.parse(novel.meta ?? '{}'); } catch { meta = {}; }
        const r: any = await this.ai.jsonRequest('/outline', {
          title: novel.title, genre: novel.genre ?? undefined, synopsis: novel.synopsis ?? undefined,
          worldviewText: novel.worldviewText ?? undefined, theme: meta.theme, trope: meta.trope,
          coreSetting: meta.coreSetting, audience: meta.audience,
        });
        if (r?.content) await this.prisma.novel.update({ where: { id: novelId }, data: { masterOutline: r.content } });
      } catch (e) {
        this.logger.warn(`autopilot 生成总纲失败：${msg(e)}`);
      }
    }

    // 一次性规划全书章纲：避免分波 re-plan 导致重复开头（模型常无视"接着往后"重排开篇）。
    const existingCount = await this.prisma.chapter.count({ where: { novelId } });
    if (existingCount < target) {
      const plan = await this.planChapters(novelId, target - existingCount);
      let order = await this.nextOrder(novelId);
      for (const p of plan) {
        await this.prisma.chapter.create({
          data: { novelId, title: p.title || `第${order + 1}章`, outlineText: p.outline || null, order: order++, status: 'draft' },
        });
      }
      this.logger.log(`autopilot 已规划 ${plan.length} 章（目标 ${target}）`);
    }

    let written = await this.prisma.chapter.count({ where: { novelId, wordCount: { gt: 200 } } });
    let gateFailed = 0;
    let failed = 0;

    // 顺序写所有待写章节（不在循环里再规划）。
    for (let guard = 0; guard < target * 3 + 30; guard++) {
      const next = await this.prisma.chapter.findFirst({
        where: { novelId, status: { not: 'gen_failed' }, wordCount: { lte: 200 } },
        orderBy: { order: 'asc' },
      });
      if (!next) break;
      try {
        const r = await this.generateAndAnalyze(next.id, { targetWords, instruction: ChapterPipelineService.BRAKE_INSTRUCTION });
        written++;
        if (!r.gate.passed) gateFailed++;
        this.logger.log(`autopilot 已写 ${written}：「${next.title}」(${r.wordCount}字, gate ${r.gate.passed ? 'pass' : 'fail'})`);
      } catch (e) {
        failed++;
        this.logger.warn(`autopilot 写「${next.title}」失败：${msg(e)}`);
        await this.prisma.chapter.update({ where: { id: next.id }, data: { status: 'gen_failed' } });
      }
    }
    return { written, gateFailed, failed, total: await this.prisma.chapter.count({ where: { novelId } }) };
  }

  private async nextOrder(novelId: number): Promise<number> {
    const agg = await this.prisma.chapter.aggregate({ where: { novelId }, _max: { order: true } });
    return (agg._max.order ?? -1) + 1;
  }

  /**
   * 批量分析全书：对已有正文(wordCount>200)的章节**串行**跑 一致性抽取(L1-L4) + 摘要(L1/L2)。
   * 串行避免并发撞 GLM 限流；逐章落库，失败不阻塞后续。用于「分析全书」按钮（填充设定库/洞察/记忆）。
   */
  async analyzeBook(novelId: number): Promise<{ analyzed: number; failed: number; total: number }> {
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId, wordCount: { gt: 200 } },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true },
    });
    let analyzed = 0;
    let failed = 0;
    for (const c of chapters) {
      try {
        await this.consistency.checkChapter(c.id);
        await this.memory.summarizeChapter(c.id);
        analyzed++;
        this.logger.log(`analyzeBook ${analyzed}/${chapters.length}：「${c.title}」`);
      } catch (e) {
        failed++;
        this.logger.warn(`analyzeBook「${c.title}」失败：${msg(e)}`);
      }
    }
    return { analyzed, failed, total: chapters.length };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
