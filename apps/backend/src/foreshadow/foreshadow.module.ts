import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 伏笔状态机 + 自动提醒（plan §4 P1）。 */

@Injectable()
class ForeshadowService {
  constructor(private readonly prisma: PrismaService) {}
  list(novelId: number) {
    return this.prisma.foreshadow.findMany({ where: { novelId }, orderBy: { id: 'asc' } });
  }
  create(novelId: number, data: { title: string; description?: string; setupChapter?: number; payoffChapter?: number; status?: string }) {
    return this.prisma.foreshadow.create({ data: { novelId, ...data, status: data.status ?? 'setup' } });
  }
  async update(id: number, data: Partial<{ title: string; description: string; setupChapter: number; payoffChapter: number; status: string }>) {
    await this.exists(id);
    return this.prisma.foreshadow.update({ where: { id }, data });
  }
  async remove(id: number) {
    await this.exists(id);
    await this.prisma.foreshadow.delete({ where: { id } });
    return { id };
  }
  /** 提醒：已 setup 但当前章数已超过 setupChapter+阈值 仍未 payoff。 */
  async reminders(novelId: number, threshold = 20) {
    const latest = await this.prisma.chapter.findFirst({ where: { novelId }, orderBy: { order: 'desc' }, select: { order: true } });
    const current = latest?.order ?? 0;
    const all = await this.prisma.foreshadow.findMany({ where: { novelId, status: 'setup' } });
    return all
      .filter((f) => f.setupChapter != null && current - (f.setupChapter as number) >= threshold)
      .map((f) => ({ ...f, currentChapter: current, gap: current - (f.setupChapter as number) }));
  }
  private async exists(id: number) {
    const f = await this.prisma.foreshadow.findUnique({ where: { id } });
    if (!f) throw new NotFoundException(`Foreshadow ${id} not found`);
    return f;
  }
}

@Controller('novels/:novelId/foreshadows')
class ForeshadowController {
  constructor(private readonly svc: ForeshadowService) {}
  @Get() list(@Param('novelId', ParseIntPipe) n: number) { return this.svc.list(n); }
  @Get('reminders') reminders(@Param('novelId', ParseIntPipe) n: number, @Query('threshold') t?: string) { return this.svc.reminders(n, t ? Number(t) : 20); }
  @Post() create(@Param('novelId', ParseIntPipe) n: number, @Body() b: any) { return this.svc.create(n, b); }
}

@Controller('foreshadows')
class ForeshadowItemController {
  constructor(private readonly svc: ForeshadowService) {}
  @Post(':id') update(@Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.svc.update(id, b); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.svc.remove(id); }
}

@Module({
  controllers: [ForeshadowController, ForeshadowItemController],
  providers: [ForeshadowService],
})
export class ForeshadowModule {}
