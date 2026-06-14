import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 设定模板：内置库 + 用户自建（plan §4 P3 模板市场雏形）。 */

interface TemplateSeed {
  name: string;
  genre: string;
  theme: string;
  trope: string;
  coreSetting: string;
  audience: string;
  synopsisHint: string;
  worldviewSkeleton: string;
}

const BUILTIN_TEMPLATES: TemplateSeed[] = [
  {
    name: '都市重生',
    genre: '都市',
    theme: '重生',
    trope: '重生逆袭 / 复仇打脸',
    coreSetting: '主角带着前世记忆重生回命运转折点，预知未来、规避遗憾，步步为营扳倒前世仇敌、弥补错过的人。',
    audience: '男频',
    synopsisHint: '重生回到十年前，这一世，我要把失去的都拿回来。',
    worldviewSkeleton: '现代都市背景；关键时间节点（股市/赛事/商业事件）；前世主要人物关系网（仇敌、贵人、红颜）；主角的"先知"边界。',
  },
  {
    name: '末世危机',
    genre: '科幻',
    theme: '末世生存',
    trope: '囤物资 / 异能觉醒',
    coreSetting: '末日降临（丧尸/天灾/异变），主角觉醒异能并拥有随身空间，凭先知提前囤积物资、建立庇护所、收拢幸存者。',
    audience: '男频',
    synopsisHint: '末世降临前七天，我把超市搬空了。',
    worldviewSkeleton: '末日类型与爆发机制；异能体系（等级/克制）；丧尸/异兽进化树；幸存者势力与庇护所；物资稀缺度设定。',
  },
  {
    name: '玄幻升级',
    genre: '玄幻',
    theme: '修真升级',
    trope: '废柴逆袭 / 无敌流',
    coreSetting: '灵气复苏的修炼世界，境界练气→筑基→金丹→元婴……主角身负金手指（功法/血脉/神器），一路突破碾压同辈。',
    audience: '男频',
    synopsisHint: '被退婚的废柴少年，觉醒上古血脉，从此一飞冲天。',
    worldviewSkeleton: '修炼境界体系与突破条件；大陆/宗门/世家格局；功法/法宝/丹药等级；主角金手指来源与限制。',
  },
  {
    name: '系统流',
    genre: '都市',
    theme: '系统',
    trope: '任务奖励 / 签到',
    coreSetting: '主角绑定神秘系统面板，完成日常/主线任务、签到打卡获得奖励（属性/技能/物品），在现实或副本中不断变强。',
    audience: '男频',
    synopsisHint: '叮——每日签到系统已绑定，签到第七天，奖励 SSR 级技能。',
    worldviewSkeleton: '系统功能模块（签到/任务/商城/抽卡）；奖励货币与汇率；能力成长曲线；系统任务与现实事件的映射。',
  },
  {
    name: '无限流',
    genre: '科幻',
    theme: '无限流',
    trope: '副本闯关 / 智斗',
    coreSetting: '主角被拉入神秘主神空间，穿梭影视/原创副本世界完成任务，以积分兑换能力、求生于一个又一个绝境。',
    audience: '全年龄',
    synopsisHint: '欢迎来到主神空间，活下去，才能回家。',
    worldviewSkeleton: '主神空间规则（积分/支线/团队）；副本世界来源；兑换体系（血统/技能/装备）；死亡与回归机制。',
  },
  {
    name: '修真问道',
    genre: '仙侠',
    theme: '修仙',
    trope: '问道长生 / 宗门风云',
    coreSetting: '浩瀚修真界，万族林立、宗门并起。主角踏上修仙路，访名山、入秘境、夺法宝、问长生，与天争命。',
    audience: '男频',
    synopsisHint: '我有一剑，可问长生。',
    worldviewSkeleton: '修仙境界（练气→大乘）；九州/海域地理；大宗门与上古遗迹；天材地宝与劫难体系。',
  },
  {
    name: '星际机甲',
    genre: '科幻',
    theme: '星际战争',
    trope: '机甲 / 舰队征伐',
    coreSetting: '星际大航海时代，人类跨星系殖民。主角驾驶专属机甲、统帅舰队，在虫族/异族/叛军的战火中崛起。',
    audience: '男频',
    synopsisHint: '一机当关，万舰莫开。',
    worldviewSkeleton: '星图与势力版图；机甲等级与定制系统；舰队编成；异族/虫族设定；跃迁与能源科技。',
  },
  {
    name: '言情甜宠',
    genre: '言情',
    theme: '甜宠',
    trope: '霸总 / 双向奔赴',
    coreSetting: '现代都市情感，身份反差的主角因缘际会相识，从误解、试探到相互救赎的甜宠日常。',
    audience: '女频',
    synopsisHint: '所有人都以为他冷血无情，直到他遇见了她。',
    worldviewSkeleton: '主角身份与反差；相遇契机（契约/重逢/职场）；情感阻力（家族/前任/误会）；甜宠与高光名场面。',
  },
  {
    name: '历史穿越',
    genre: '历史',
    theme: '穿越',
    trope: '种田 / 争霸',
    coreSetting: '主角穿越到古代（唐宋明清或架空王朝），凭现代知识改良农工、兴商贸、练新军，逐步改变历史走向。',
    audience: '男频',
    synopsisHint: '穿越到大乾王朝，我决定先从改良曲辕犁开始。',
    worldviewSkeleton: '朝代背景与年代事件；可颠覆的科技/制度点；朝堂与边疆势力；主角的势力积累路径。',
  },
  {
    name: '悬疑推理',
    genre: '悬疑',
    theme: '探案',
    trope: '层层反转 / 智斗凶手',
    coreSetting: '连环离奇案件，主角（侦探/法医/记者）抽丝剥茧，在每个看似无关的线索中发现真相，结局反转。',
    audience: '全年龄',
    synopsisHint: '所有证据都指向他，可我知道，真凶另有其人。',
    worldviewSkeleton: '案件类型谱系；主角能力与方法论；叙事视角与信息差设计；反转与误导规则；城市/时代氛围。',
  },
];

@Injectable()
class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const count = await this.prisma.novelTemplate.count();
    if (count === 0) {
      await this.prisma.novelTemplate.createMany({
        data: BUILTIN_TEMPLATES.map((t) => ({ ...t, isBuiltin: true })),
      });
    }
    return this.prisma.novelTemplate.findMany({
      orderBy: [{ isBuiltin: 'desc' }, { id: 'asc' }],
    });
  }

  create(dto: TemplateSeed & { name: string }) {
    return this.prisma.novelTemplate.create({
      data: { ...dto, isBuiltin: false },
    });
  }

  async remove(id: number) {
    const t = await this.prisma.novelTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException(`Template ${id} not found`);
    if (t.isBuiltin) throw new BadRequestException('内置模板不可删除');
    await this.prisma.novelTemplate.delete({ where: { id } });
    return { id };
  }
}

@Controller('templates')
class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}
  @Get() list() { return this.svc.list(); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.svc.remove(id); }
}

@Module({ controllers: [TemplatesController], providers: [TemplatesService] })
export class TemplatesModule {}
