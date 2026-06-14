import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Token 成本看板数据（plan §16）：聚合 AiTask。 */

@Injectable()
class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async cost(novelId?: number) {
    const where = novelId ? { novelId } : undefined;
    const tasks = await this.prisma.aiTask.findMany({ where, orderBy: { createdAt: 'desc' } });

    const byType = groupSum(tasks, (t) => t.type);
    const byModel = groupSum(tasks, (t) => t.model ?? 'unknown');
    const totalIn = tasks.reduce((s, t) => s + t.tokensIn, 0);
    const totalOut = tasks.reduce((s, t) => s + t.tokensOut, 0);
    const cached = tasks.filter((t) => t.cached).length;
    const errors = tasks.filter((t) => t.status === 'error').length;

    // 粗略成本估算（¥/1K tokens，可调）：输入 0.002，输出 0.006
    const estCost = (totalIn * 0.002 + totalOut * 0.006) / 1000;

    return {
      total: { calls: tasks.length, tokensIn: totalIn, tokensOut: totalOut, cached, errors, estCostYuan: Number(estCost.toFixed(4)) },
      byType,
      byModel,
      recent: tasks.slice(0, 30),
    };
  }
}

function groupSum(tasks: any[], key: (t: any) => string) {
  const m = new Map<string, { calls: number; tokensIn: number; tokensOut: number; cached: number }>();
  for (const t of tasks) {
    const k = key(t);
    const cur = m.get(k) ?? { calls: 0, tokensIn: 0, tokensOut: 0, cached: 0 };
    cur.calls += 1;
    cur.tokensIn += t.tokensIn;
    cur.tokensOut += t.tokensOut;
    cur.cached += t.cached ? 1 : 0;
    m.set(k, cur);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, ...v }));
}

@Controller('stats')
class StatsController {
  constructor(private readonly svc: StatsService) {}
  @Get('cost')
  cost(@Query('novelId') n?: string) {
    return this.svc.cost(n ? Number(n) : undefined);
  }
}

@Module({ controllers: [StatsController], providers: [StatsService] })
export class StatsModule {}
