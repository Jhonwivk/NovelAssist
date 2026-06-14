import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiModule } from '../ai/ai.module';

/** 文风系统：StyleProfile（特征/禁用词/样本）+ 文风守卫（plan §4 P2）。 */

@Injectable()
class StyleService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService) {}

  async get(novelId: number) {
    let p = await this.prisma.styleProfile.findUnique({ where: { novelId } });
    if (!p) p = await this.prisma.styleProfile.create({ data: { novelId } });
    return deserialize(p);
  }

  async upsert(novelId: number, data: { traits?: Record<string, unknown>; bannedWords?: string[]; samples?: string[] }) {
    const p = await this.prisma.styleProfile.upsert({
      where: { novelId },
      create: {
        novelId,
        traits: JSON.stringify(data.traits ?? {}),
        bannedWords: JSON.stringify(data.bannedWords ?? []),
        samples: JSON.stringify(data.samples ?? []),
      },
      update: {
        traits: data.traits ? JSON.stringify(data.traits) : undefined,
        bannedWords: data.bannedWords ? JSON.stringify(data.bannedWords) : undefined,
        samples: data.samples ? JSON.stringify(data.samples) : undefined,
      },
    });
    return deserialize(p);
  }

  async guard(novelId: number, text: string) {
    const style = await this.get(novelId);
    const traits = typeof style.traits === 'string' ? style.traits : JSON.stringify(style.traits ?? {});
    return this.ai.jsonRequest('/style-guard', {
      text,
      traits,
      bannedWords: style.bannedWords,
      samples: style.samples,
    });
  }
}

function deserialize(p: any) {
  return {
    ...p,
    traits: safe(p.traits, {}),
    bannedWords: safe(p.bannedWords, []),
    samples: safe(p.samples, []),
  };
}
function safe(s: string, fb: unknown) {
  try { return JSON.parse(s); } catch { return fb; }
}

@Controller('novels/:novelId/style')
class StyleController {
  constructor(private readonly svc: StyleService) {}
  @Get() get(@Param('novelId', ParseIntPipe) n: number) { return this.svc.get(n); }
  @Put() put(@Param('novelId', ParseIntPipe) n: number, @Body() b: any) { return this.svc.upsert(n, b); }
  @Post('guard') guard(@Param('novelId', ParseIntPipe) n: number, @Body('text') t: string) { return this.svc.guard(n, t); }
}

@Module({ imports: [AiModule], controllers: [StyleController], providers: [StyleService] })
export class StyleModule {}
