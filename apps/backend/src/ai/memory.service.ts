import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';
import { RuntimeStateService } from './runtime.service';
import { htmlToParagraphs, stripHtml } from '../common/text.utils';

/**
 * 长程记忆系统（plan §6）。
 * 分层：L0 原文（章节 content） / L1 段落摘要 / L2 章节摘要 / L3 卷摘要 / L4 全书摘要。
 * 存储：L1/L3/L4 进 Memory 表；L2 进 ChapterSummary（既有）。检索用词法（无 pgvector 时）。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly runtime: RuntimeStateService,
  ) {}

  // ============ 流水线 ============

  /** 章节保存后触发：生成 L2 章节摘要 + L1 段落摘要。 */
  async summarizeChapter(chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) return null;
    const paragraphs = htmlToParagraphs(chapter.content);
    if (paragraphs.length === 0) return null;

    // L2 章节摘要
    const l2 = await this.ai.loggedJsonSilent('summarize', chapter.novelId, '/summarize', {
      novelId: chapter.novelId,
      chapterId,
      title: chapter.title,
      content: paragraphs.join('\n\n'),
    });
    const l2Text = l2?.summary ?? l2?.content ?? '';
    await this.prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { chapterId, level: 'L2', content: l2Text },
      update: { content: l2Text },
    });

    // L1 段落摘要：按 ~500 字分块
    const chunks = chunkByChars(paragraphs.join('\n'), 500);
    // 先清旧 L1（同章节）
    await this.prisma.memory.deleteMany({ where: { novelId: chapter.novelId, level: 'L1', sourceId: chapterId } });
    for (let i = 0; i < chunks.length; i++) {
      try {
        const r: any = await this.ai.loggedJsonSilent('summarize-l1', chapter.novelId, '/summarize', {
          novelId: chapter.novelId,
          chapterId,
          title: `${chapter.title} · 段落 ${i + 1}`,
          content: chunks[i],
        });
        const summary = r?.summary ?? r?.content ?? '';
        if (summary.trim()) {
          await this.prisma.memory.create({
            data: {
              novelId: chapter.novelId,
              level: 'L1',
              sourceId: chapterId,
              content: `【${chapter.title}·P${i + 1}】${summary}`,
            },
          });
        }
      } catch (e) {
        this.logger.warn(`L1 段落 ${i + 1} 摘要失败：${msg(e)}`);
      }
    }

    // 尝试刷新 L4（每 10 章）
    const count = await this.prisma.chapter.count({ where: { novelId: chapter.novelId } });
    if (count % 10 === 0) this.refreshBook(chapter.novelId).catch(() => undefined);

    return this.prisma.chapterSummary.findUnique({ where: { chapterId } });
  }

  /** 刷新某卷 L3 摘要。 */
  async refreshVolume(novelId: number, volumeId: number | null) {
    const where = volumeId ? { novelId, volumeId } : { novelId };
    const chapters = await this.prisma.chapter.findMany({
      where,
      orderBy: { order: 'asc' },
      include: { summary: true },
    });
    const summaries = chapters.map((c) => c.summary?.content).filter(Boolean) as string[];
    if (summaries.length === 0) return null;
    const r: any = await this.ai.loggedJsonSilent('summarize-volume', novelId, '/summarize', {
      novelId,
      chapterId: 0,
      title: '卷摘要',
      content: summaries.join('\n\n'),
    });
    return r?.summary ?? r?.content ?? '';
  }

  /** 刷新全书 L4 摘要 → Novel.bookSummary + Memory L4。 */
  async refreshBook(novelId: number) {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    if (!novel) return null;
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
      include: { summary: true },
    });
    const chapterSummaries = chapters.map((c) => c.summary?.content).filter(Boolean) as string[];
    if (chapterSummaries.length === 0) return null;

    const r: any = await this.ai.loggedJsonSilent('summarize-book', novelId, '/summarize-book', {
      title: novel.title,
      genre: novel.genre ?? undefined,
      synopsis: novel.synopsis ?? undefined,
      worldviewText: novel.worldviewText ?? undefined,
      chapterSummaries: chapterSummaries.slice(-40),
    });
    const summary = r?.summary ?? r?.content ?? '';
    await this.prisma.novel.update({ where: { id: novelId }, data: { bookSummary: summary } });
    await this.prisma.memory.deleteMany({ where: { novelId, level: 'L4' } });
    await this.prisma.memory.create({ data: { novelId, level: 'L4', content: summary } });
    return summary;
  }

  // ============ 检索（词法，无向量依赖）============

  /** 检索 top-k 记忆（L1/L2/L3）：词法粗筛 → 字符 n-gram 余弦重排（语义近似，零向量依赖）。 */
  async retrieve(novelId: number, query: string, topK = 8) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const memories = await this.prisma.memory.findMany({
      where: { novelId, level: { in: ['L1', 'L2', 'L3'] } },
    });
    const qVec = ngramVector(query);
    return memories
      .map((m) => {
        const lex = score(m.content, terms);
        const sem = cosine(qVec, ngramVector(m.content));
        // 融合：词法保证召回，语义提升相关性
        return { m, score: lex > 0 ? lex * (0.5 + 0.5 * sem) : sem * 0.5 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.m);
  }

  // ============ 上下文组装（plan §6.2 token 预算）============

  /** 组装写作上下文，按字符预算（≈token×1.5）裁剪，返回结构化 + 拼接串。 */
  async assembleContext(novelId: number, chapterId?: number | null, query?: string) {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    let chapter: any = null;
    let volume: any = null;
    let prevSummary: string | undefined;
    if (chapterId) {
      chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
      if (chapter?.volumeId) volume = await this.prisma.volume.findUnique({ where: { id: chapter.volumeId } });
      if (chapter) {
        const prev = await this.prisma.chapter.findFirst({
          where: { novelId, order: chapter.order - 1 },
          include: { summary: true },
        });
        prevSummary = prev?.summary?.content ?? undefined;
      }
    }

    const recent = await this.prisma.chapter.findMany({
      where: { novelId, order: chapter ? { lt: chapter.order } : undefined },
      orderBy: { order: 'desc' },
      take: 3,
      include: { summary: true },
    });
    const recentSummaries = recent.map((c) => c.summary?.content).filter(Boolean) as string[];

    const characters = await this.prisma.entity.findMany({
      where: { novelId, type: 'character' },
      take: 12,
    });

    const retrieved = query
      ? await this.retrieve(novelId, query, 6)
      : await this.retrieve(novelId, chapter?.outlineText || chapter?.title || novel?.title || '', 6);

    // 字符预算分配
    const B = 12000;
    const fit = (s: string | undefined | null, n: number) => clamp(s, n);
    const characterLines = characters
      .map((c) => `- ${c.name}：${(c.description ?? '').slice(0, 60)}`)
      .join('\n');

    const parts = {
      meta: `《${novel?.title ?? ''}》${novel?.genre ?? ''}`,
      bookSummary: fit(novel?.bookSummary, Math.round(B * 0.12)),
      volumeOutline: fit(volume?.outline, Math.round(B * 0.08)),
      prevSummary: fit(prevSummary, Math.round(B * 0.12)),
      recentSummaries: fit(recentSummaries.join('\n---\n'), Math.round(B * 0.18)),
      characters: fit(characterLines, Math.round(B * 0.22)),
      retrieved: fit(retrieved.map((m) => m.content).join('\n---\n'), Math.round(B * 0.2)),
      chapterOutline: fit(chapter?.outlineText, Math.round(B * 0.08)),
    };

    const contextStr = [
      parts.bookSummary && `【全书摘要】\n${parts.bookSummary}`,
      parts.volumeOutline && `【本卷大纲】\n${parts.volumeOutline}`,
      parts.recentSummaries && `【近章摘要】\n${parts.recentSummaries}`,
      parts.characters && `【主要角色】\n${parts.characters}`,
      parts.retrieved && `【相关记忆】\n${parts.retrieved}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 运行时状态快照（plan 深化方案）：把出场角色的当前状态/信息流/关系切片注入
    let runtimeBlock = '';
    let runtimeSnapshot: any = null;
    try {
      runtimeSnapshot = await this.runtime.snapshot(novelId, chapterId ?? null);
      runtimeBlock = this.runtime.render(runtimeSnapshot);
    } catch (e) {
      this.logger.warn(`运行时快照失败：${e instanceof Error ? e.message : e}`);
    }

    return {
      novel: { title: novel?.title, genre: novel?.genre, synopsis: novel?.synopsis, worldviewText: novel?.worldviewText },
      chapterTitle: chapter?.title,
      outline: chapter?.outlineText ?? undefined,
      previousSummary: prevSummary,
      context: runtimeBlock ? `${contextStr}\n\n${runtimeBlock}` : contextStr,
      runtime: runtimeSnapshot,
      debug: parts,
    };
  }
}

// ---- 工具 ----

function chunkByChars(text: string, size: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const para of text.split('\n')) {
    if ((buf + para).length > size && buf) {
      out.push(buf);
      buf = '';
    }
    buf += (buf ? '\n' : '') + para;
  }
  if (buf) out.push(buf);
  return out;
}

function tokenize(text: string): string[] {
  const clean = stripHtml(text ?? '').replace(/\s+/g, '');
  const terms = new Set<string>();
  for (let i = 0; i < clean.length; i++) terms.add(clean[i]);
  for (let i = 0; i < clean.length - 1; i++) terms.add(clean.slice(i, i + 2));
  return [...terms];
}

function score(content: string, terms: string[]): number {
  if (!content) return 0;
  let s = 0;
  for (const t of terms) {
    let from = 0;
    while ((from = content.indexOf(t, from)) !== -1) {
      s += t.length === 2 ? 1 : 0.3;
      from += t.length;
    }
  }
  return s / Math.sqrt(content.length); // 长度归一
}

function clamp(s: string | undefined | null, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 字符 2-gram 稀疏向量（键→计数），用于近似语义相似度，零向量依赖。 */
function ngramVector(text: string): Map<string, number> {
  const clean = stripHtml(text ?? '').replace(/\s+/g, '');
  const v = new Map<string, number>();
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    v.set(g, (v.get(g) ?? 0) + 1);
  }
  return v;
}

/** 稀疏向量余弦相似度（0-1）。 */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb) dot += va * vb;
  }
  let na = 0;
  for (const v of a.values()) na += v * v;
  let nb = 0;
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
