import { Controller, Get, Injectable, Module, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 时间线事件 + 矛盾检测（plan §4 P1）。 */

@Injectable()
class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async events(novelId: number, chapterId?: number) {
    return this.prisma.event.findMany({
      where: chapterId ? { novelId, chapterId } : { novelId },
      orderBy: { id: 'asc' },
    });
  }

  /** 关系图数据：实体为节点、关系为边（plan §4 P2 AntV G6）。 */
  async graph(novelId: number) {
    const [entities, relations] = await Promise.all([
      this.prisma.entity.findMany({ where: { novelId } }),
      this.prisma.relation.findMany({ where: { novelId } }),
    ]);
    const idSet = new Set(entities.map((e) => e.id));
    const nodes = entities.map((e) => ({ id: String(e.id), label: e.name, type: e.type, desc: e.description ?? '' }));

    // 聚合同方向平行边（合并 type 标签 + 时间范围，供关系图时间滑块过滤）
    const agg = new Map<string, { source: string; target: string; types: Set<string>; from: number; to: number | null }>();
    for (const r of relations) {
      if (!idSet.has(r.subjectId) || !idSet.has(r.objectId)) continue;
      const key = `${r.subjectId}-${r.objectId}`;
      const cur = agg.get(key) ?? { source: String(r.subjectId), target: String(r.objectId), types: new Set<string>(), from: Infinity, to: null as number | null };
      cur.types.add(r.type);
      cur.from = Math.min(cur.from, r.validFromChapter ?? 0);
      const rt = r.validToChapter;
      if (rt == null) cur.to = null;
      else if (cur.to !== null) cur.to = Math.max(cur.to, rt);
      agg.set(key, cur);
    }
    const edges = [...agg.values()].map((e) => ({
      source: e.source,
      target: e.target,
      label: [...e.types].join('/'),
      validFrom: e.from === Infinity ? 0 : e.from,
      validTo: e.to,
    }));
    return { nodes, edges };
  }

  /** 简单冲突：同一 storyTime 不同 location 出现同一参与者。 */
  async conflicts(novelId: number) {
    const events = await this.prisma.event.findMany({ where: { novelId } });
    const byTime = new Map<string, typeof events>();
    for (const e of events) {
      if (!e.storyTime) continue;
      if (!byTime.has(e.storyTime)) byTime.set(e.storyTime, []);
      byTime.get(e.storyTime)!.push(e);
    }
    const out: any[] = [];
    for (const [time, evs] of byTime) {
      const locs = new Map<string, Set<string>>();
      for (const e of evs) {
        if (!e.location) continue;
        let parts: string[] = [];
        try { parts = JSON.parse(e.participants); } catch { /* ignore */ }
        for (const p of parts) {
          if (!locs.has(p)) locs.set(p, new Set());
          locs.get(p)!.add(e.location);
        }
      }
      for (const [who, places] of locs) {
        if (places.size > 1) out.push({ storyTime: time, participant: who, locations: [...places] });
      }
    }
    return out;
  }
}

@Controller('novels/:novelId/timeline')
class TimelineController {
  constructor(private readonly svc: TimelineService) {}
  @Get() events(@Param('novelId', ParseIntPipe) n: number, @Query('chapterId') c?: string) {
    return this.svc.events(n, c ? Number(c) : undefined);
  }
  @Get('conflicts') conflicts(@Param('novelId', ParseIntPipe) n: number) { return this.svc.conflicts(n); }
  @Get('graph') graph(@Param('novelId', ParseIntPipe) n: number) { return this.svc.graph(n); }
}

@Module({ controllers: [TimelineController], providers: [TimelineService] })
export class TimelineModule {}
