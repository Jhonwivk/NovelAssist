import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 运行时状态快照（plan 深化方案 §3）。
 * 写本章前，把每个出场角色的"截至上一章末"动态状态 + 信息流约束 + 关系切片 + 物品/地点/因果
 * 组装成结构化快照，渲染成 Prompt 注入块，让生成"知道角色现在拿着什么、在哪、知道什么"。
 *
 * 状态存储复用 EntityState（attr=value，按 chapterId 时序）；信息流用 Information 表。
 */
@Injectable()
export class RuntimeStateService {
  private readonly logger = new Logger(RuntimeStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async snapshot(novelId: number, chapterId?: number | null) {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    const chapter = chapterId ? await this.prisma.chapter.findUnique({ where: { id: chapterId } }) : null;

    // 章节顺序映射（chapterId -> order）
    const chapters = await this.prisma.chapter.findMany({ where: { novelId }, select: { id: true, order: true } });
    const orderMap = new Map(chapters.map((c) => [c.id, c.order]));
    const currentOrder = chapter ? chapter.order : (chapters.reduce((m, c) => Math.max(m, c.order), -1) + 1);
    const beforeOrder = currentOrder; // 取"截至上一章末"= order < currentOrder

    // 本章配置
    let config: { characterIds?: number[]; locationIds?: number[]; itemIds?: number[]; goals?: string[] } = {};
    try {
      config = JSON.parse(chapter?.sceneConfig ?? '{}');
    } catch {
      config = {};
    }

    // 出场角色：优先 sceneConfig，否则取上一章事件参与者，再退回全部角色（≤6）
    let characterIds = config.characterIds?.length ? config.characterIds : await this.autoCharacters(novelId, beforeOrder, orderMap);
    const characters = await this.prisma.entity.findMany({ where: { id: { in: characterIds } } });

    // 所有状态（一次性查，按 entity 分组）
    const allStates = await this.prisma.entityState.findMany({
      where: { entityId: { in: characters.map((c) => c.id) } },
      orderBy: { chapterId: 'asc' },
    });
    const stateByEntity = new Map<number, Map<string, { value: string; order: number }>>();
    for (const s of allStates) {
      const o = orderMap.get(s.chapterId) ?? 0;
      if (o >= beforeOrder) continue; // 只要当前章之前的
      const m = stateByEntity.get(s.entityId) ?? new Map();
      const cur = m.get(s.attrName);
      if (!cur || o >= cur.order) m.set(s.attrName, { value: s.value, order: o });
      stateByEntity.set(s.entityId, m);
    }

    // 信息流
    const infos = await this.prisma.information.findMany({ where: { novelId } });
    const knownByEntity = new Map<number, { content: string; importance: string }[]>();
    const allCoreSecrets: { content: string; knowers: number[] }[] = [];
    for (const info of infos) {
      let knowers: { entityId: number; sinceChapter: number }[] = [];
      try {
        knowers = JSON.parse(info.knowers ?? '[]');
      } catch {
        knowers = [];
      }
      const knowerIds = knowers.filter((k) => k.sinceChapter < beforeOrder).map((k) => k.entityId);
      allCoreSecrets.push({ content: info.content, knowers: knowerIds });
      for (const id of characterIds) {
        if (knowerIds.includes(id)) {
          const arr = knownByEntity.get(id) ?? [];
          arr.push({ content: info.content, importance: info.importance });
          knownByEntity.set(id, arr);
        }
      }
    }

    // 关系切片（validFromChapter < currentOrder，且未结束）
    const rels = await this.prisma.relation.findMany({ where: { novelId } });
    const charSet = new Set(characterIds);
    const relationsSlice = rels
      .filter((r) => (r.validFromChapter ?? 0) < beforeOrder && (r.validToChapter ?? Infinity) >= beforeOrder)
      .filter((r) => charSet.has(r.subjectId) || charSet.has(r.objectId))
      .map((r) => ({ subjectId: r.subjectId, objectId: r.objectId, type: r.type, strength: parseStrength(r.attributes) }));

    // 最近事件（每个角色最近 3 条，order < currentOrder）
    const events = await this.prisma.event.findMany({ where: { novelId }, orderBy: { id: 'asc' } });
    const recentByEntity = new Map<number, string[]>();
    for (const ev of events) {
      const o = orderMap.get(ev.chapterId ?? -1) ?? -1;
      if (o >= beforeOrder || o < beforeOrder - 3) continue; // 最近 3 章
      let parts: string[] = [];
      try { parts = JSON.parse(ev.participants ?? '[]'); } catch { parts = []; }
      const desc = `${ev.type}${ev.result ? '：' + ev.result : ''}`;
      for (const p of parts) {
        const ent = await this.prisma.entity.findFirst({ where: { name: String(p) } });
        if (ent && charSet.has(ent.id)) {
          const arr = recentByEntity.get(ent.id) ?? [];
          arr.push(desc);
          recentByEntity.set(ent.id, arr);
        }
      }
    }

    // 物品持有（item entity 的 持有者 状态）
    const itemIds = config.itemIds?.length ? config.itemIds : [];
    const items = itemIds.length ? await this.prisma.entity.findMany({ where: { id: { in: itemIds } } }) : [];
    const itemStates = await this.prisma.entityState.findMany({ where: { entityId: { in: items.map((i) => i.id) } }, orderBy: { chapterId: 'asc' } });
    const itemHolder = new Map<number, string>(); // itemId -> holderName
    for (const s of itemStates) {
      const o = orderMap.get(s.chapterId) ?? 0;
      if (o >= beforeOrder) continue;
      if (s.attrName === '持有者') {
        const holder = await this.prisma.entity.findUnique({ where: { id: Number(s.value) } });
        itemHolder.set(s.entityId, holder?.name ?? s.value);
      }
    }

    // 因果：上游最近关键事件 + 待埋伏笔（setup 状态、payoffChapter 在未来）
    const upstream = events
      .filter((e) => { const o = orderMap.get(e.chapterId ?? -1) ?? -1; return o >= beforeOrder - 2 && o < beforeOrder; })
      .slice(-6)
      .map((e) => `${e.type}${e.result ? '：' + e.result : ''}`);
    const foreshadows = await this.prisma.foreshadow.findMany({ where: { novelId, status: 'setup' } });
    const toSetup = foreshadows.slice(0, 5).map((f) => f.title);

    return {
      novelTitle: novel?.title,
      chapterTitle: chapter?.title,
      currentOrder,
      goals: config.goals ?? [],
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        card: parseCard(c.attributes),
        state: stateMapToValues(stateByEntity.get(c.id)),
        known: knownByEntity.get(c.id) ?? [],
        unknown: allCoreSecrets.filter((s) => s.knowers.length && !s.knowers.includes(c.id)).map((s) => s.content),
        recent: recentByEntity.get(c.id) ?? [],
      })),
      items: items.map((i) => ({ name: i.name, holder: itemHolder.get(i.id) ?? '无', desc: i.description ?? '' })),
      relations: relationsSlice,
      infoConstraints: allCoreSecrets.filter((s) => s.knowers.length < characters.length).map((s) => ({
        content: s.content,
        knowers: s.knowers,
      })),
      upstream,
      toSetup,
    };
  }

  /** 渲染成 Prompt 注入块。trim 到字符预算。 */
  render(s: Awaited<ReturnType<RuntimeStateService['snapshot']>>, budget = 3200): string {
    if (!s.characters.length && !s.items.length) return '';
    const lines: string[] = [];
    lines.push('═══ 出场角色运行时状态（截至上一章末，务必遵守）═══');
    for (const c of s.characters) {
      lines.push(`▼ ${c.name}`);
      const card = c.card;
      if (card.personality) lines.push(`  性格：${card.personality}`);
      if (card.constraints) lines.push(`  设定锁（绝不可违背）：${card.constraints}`);
      const st = c.state as Record<string, string>;
      const stParts = ['位置', '情绪', '身体', '等级', '修为', '状态'].filter((k) => st[k]).map((k) => `${k}=${st[k]}`);
      if (stParts.length) lines.push(`  状态：${stParts.join('，')}`);
      if (c.known.length) lines.push(`  已知：${c.known.map((k) => k.content).join('；')}`);
      if (c.unknown.length) lines.push(`  不知：${c.unknown.join('；')}`);
      if (c.recent.length) lines.push(`  近况：${c.recent.slice(-3).join('；')}`);
    }
    if (s.relations.length) {
      lines.push('— 本章关系切片 —');
      // 用 id→name 渲染在调用方更优；此处用 id
      lines.push(s.relations.map((r) => `${r.subjectId}→${r.objectId}：${r.type}`).join('；'));
    }
    if (s.items.length) {
      lines.push('— 物品 —');
      lines.push(s.items.map((i) => `${i.name}（持有：${i.holder}）`).join('；'));
    }
    if (s.infoConstraints.length) {
      lines.push('— 信息流硬约束（对话必须遵守：未知者不能说出）—');
      lines.push(s.infoConstraints.map((i) => `「${i.content}」仅特定角色知道`).join('；'));
    }
    if (s.upstream.length) lines.push(`— 上游须延续 — ${s.upstream.join('；')}`);
    if (s.toSetup.length) lines.push(`— 待埋伏笔 — ${s.toSetup.join('；')}`);
    if (s.goals.length) lines.push(`— 本章目标 — ${s.goals.join('；')}`);

    const text = lines.join('\n');
    return text.length > budget ? text.slice(0, budget) + '…' : text;
  }

  private async autoCharacters(novelId: number, beforeOrder: number, orderMap: Map<number, number>): Promise<number[]> {
    // 上一章参与者
    const events = await this.prisma.event.findMany({ where: { novelId } });
    const names = new Set<string>();
    for (const e of events) {
      const o = orderMap.get(e.chapterId ?? -1) ?? -1;
      if (o === beforeOrder - 1) {
        try { JSON.parse(e.participants ?? '[]').forEach((p: string) => names.add(String(p))); } catch { /* ignore */ }
      }
    }
    const byName = await this.prisma.entity.findMany({ where: { novelId, type: 'character', name: { in: [...names] } } });
    if (byName.length) return byName.map((e) => e.id);
    // 退回：全部角色 ≤6
    const all = await this.prisma.entity.findMany({ where: { novelId, type: 'character' }, take: 6 });
    return all.map((e) => e.id);
  }
}

function parseCard(attributesJson: string): { personality?: string; constraints?: string; [k: string]: unknown } {
  try {
    const a = JSON.parse(attributesJson ?? '{}');
    return a;
  } catch {
    return {};
  }
}

function stateMapToValues(m?: Map<string, { value: string; order: number }>): Record<string, string> {
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of m) out[k] = v.value;
  return out;
}

function parseStrength(attributesJson: string | null): number | undefined {
  try {
    const a = JSON.parse(attributesJson ?? '{}');
    const s = a?.strength;
    return typeof s === 'number' ? s : undefined;
  } catch {
    return undefined;
  }
}
