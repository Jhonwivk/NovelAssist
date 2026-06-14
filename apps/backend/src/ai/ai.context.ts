import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 从 DB 组装阶段一最小上下文（plan §6.2 token 预算的极简版）。 */
@Injectable()
export class AiContextService {
  constructor(private readonly prisma: PrismaService) {}

  async novelContext(novelId: number) {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    return {
      title: novel?.title,
      genre: novel?.genre ?? undefined,
      synopsis: novel?.synopsis ?? undefined,
      worldviewText: novel?.worldviewText ?? undefined,
    };
  }

  async chapterContext(novelId: number, chapterId?: number) {
    const base = await this.novelContext(novelId);
    if (!chapterId) return base;

    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) return base;

    // 上一章 L2 摘要（若有）
    const prev = await this.prisma.chapter.findFirst({
      where: { novelId, order: chapter.order - 1 },
      include: { summary: true },
    });
    let previousSummary: string | undefined;
    if (prev?.summary?.content) {
      const parsed = safeJson(prev.summary.content);
      previousSummary = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    }

    return {
      ...base,
      chapterTitle: chapter.title,
      outline: chapter.outlineText ?? undefined,
      previousSummary,
    };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
