import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { stripHtml } from '../common/text.utils';

/** 章节版本快照 + diff + 回滚（plan §4 P2）。 */

@Injectable()
class VersionService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(chapterId: number, reason = 'manual') {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    return this.prisma.chapterSnapshot.create({
      data: { chapterId, content: chapter.content, wordCount: chapter.wordCount, reason },
    });
  }

  list(chapterId: number) {
    return this.prisma.chapterSnapshot.findMany({ where: { chapterId }, orderBy: { createdAt: 'desc' } });
  }

  async rollback(chapterId: number, snapshotId: number) {
    const snap = await this.prisma.chapterSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snap || snap.chapterId !== chapterId) throw new NotFoundException('snapshot not found');
    // 回滚前先存一份当前为快照
    await this.snapshot(chapterId, 'pre-rollback');
    return this.prisma.chapter.update({ where: { id: chapterId }, data: { content: snap.content, wordCount: snap.wordCount } });
  }

  /** 简单 diff：按段落（空行分隔）做 LCS，输出 add/remove/keep 行。 */
  async diff(chapterId: number, snapshotId?: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException('chapter not found');
    const current = stripHtml(chapter.content).split(/\n+/).filter(Boolean);
    let other: string[];
    if (snapshotId) {
      const snap = await this.prisma.chapterSnapshot.findUnique({ where: { id: snapshotId } });
      if (!snap) throw new NotFoundException('snapshot not found');
      other = stripHtml(snap.content).split(/\n+/).filter(Boolean);
    } else {
      const latest = await this.prisma.chapterSnapshot.findFirst({ where: { chapterId }, orderBy: { createdAt: 'desc' } });
      other = latest ? stripHtml(latest.content).split(/\n+/).filter(Boolean) : [];
    }
    return lineDiff(other, current);
  }
}

function lineDiff(a: string[], b: string[]) {
  // LCS
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: 'add' | 'del' | 'eq'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ op: 'eq', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: 'del', text: a[i] }); i++; }
    else { out.push({ op: 'add', text: b[j] }); j++; }
  }
  while (i < m) out.push({ op: 'del', text: a[i++] });
  while (j < n) out.push({ op: 'add', text: b[j++] });
  return out;
}

@Controller('chapters/:id')
class VersionController {
  constructor(private readonly svc: VersionService) {}
  @Post('snapshot') snap(@Param('id', ParseIntPipe) id: number, @Body('reason') r?: string) { return this.svc.snapshot(id, r); }
  @Get('snapshots') list(@Param('id', ParseIntPipe) id: number) { return this.svc.list(id); }
  @Get('diff') diff(@Param('id', ParseIntPipe) id: number, @Query('snapshotId') s?: string) { return this.svc.diff(id, s ? Number(s) : undefined); }
  @Post('rollback/:snapshotId') rollback(@Param('id', ParseIntPipe) id: number, @Param('snapshotId', ParseIntPipe) sid: number) { return this.svc.rollback(id, sid); }
}

@Module({ controllers: [VersionController], providers: [VersionService] })
export class VersionModule {}
