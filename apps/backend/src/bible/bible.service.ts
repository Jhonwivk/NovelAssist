import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Entity } from '@prisma/client';
import { CreateEntityDto, UpdateEntityDto } from './dto/create-entity.dto';

/** SQLite 用 String 存 JSON，这里在边界做 (de)serialize。 */
type EntityDto = Omit<Entity, 'aliases' | 'attributes'> & {
  aliases: string[];
  attributes: Record<string, unknown>;
};

function toDto(e: Entity): EntityDto {
  return {
    ...e,
    aliases: safeParse(e.aliases, []) as string[],
    attributes: safeParse(e.attributes, {}) as Record<string, unknown>,
  };
}

function safeParse(s: string, fallback: unknown) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

@Injectable()
export class BibleService {
  constructor(private readonly prisma: PrismaService) {}

  async getBible(novelId: number) {
    const novel = await this.prisma.novel.findUnique({ where: { id: novelId } });
    if (!novel) throw new NotFoundException(`Novel ${novelId} not found`);
    const entities = await this.prisma.entity.findMany({
      where: { novelId },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
    });
    return {
      novelId,
      worldviewText: novel.worldviewText,
      entities: entities.map(toDto),
    };
  }

  create(novelId: number, dto: CreateEntityDto) {
    return this.prisma.entity
      .create({
        data: {
          novelId,
          type: dto.type,
          name: dto.name,
          aliases: JSON.stringify(dto.aliases ?? []),
          attributes: JSON.stringify(dto.attributes ?? {}),
          description: dto.description,
          parentId: dto.parentId ?? undefined,
        },
      })
      .then(toDto);
  }

  async update(id: number, dto: UpdateEntityDto) {
    await this.exists(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.aliases !== undefined) data.aliases = JSON.stringify(dto.aliases);
    if (dto.attributes !== undefined) data.attributes = JSON.stringify(dto.attributes);
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    return this.prisma.entity.update({ where: { id }, data }).then(toDto);
  }

  async remove(id: number) {
    await this.exists(id);
    await this.prisma.entity.delete({ where: { id } });
    return { id };
  }

  /** 角色状态轨迹（plan UI §7.1）：按属性跨章节序列 + 相关事件 + 持有变更。 */
  async trajectory(entityId: number) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) throw new NotFoundException(`Entity ${entityId} not found`);

    const [states, chapters, events, holderStates] = await Promise.all([
      this.prisma.entityState.findMany({ where: { entityId }, orderBy: { chapterId: 'asc' } }),
      this.prisma.chapter.findMany({ where: { novelId: entity.novelId }, select: { id: true, order: true, title: true } }),
      this.prisma.event.findMany({ where: { novelId: entity.novelId } }),
      this.prisma.entityState.findMany({ where: { attrName: '持有者', value: String(entityId) } }),
    ]);
    const orderMap = new Map(chapters.map((c) => [c.id, c.order]));
    const titleMap = new Map(chapters.map((c) => [c.id, c.title]));
    const maxOrder = chapters.reduce((m, c) => Math.max(m, c.order), 0);

    const series: Record<string, { chapterOrder: number; chapterTitle: string; value: string }[]> = {};
    for (const s of states) {
      const key = s.attrName;
      if (key === '持有者' || key === '状态') continue; // 物品属性，不属角色轨迹
      (series[key] ??= []).push({ chapterOrder: orderMap.get(s.chapterId) ?? 0, chapterTitle: titleMap.get(s.chapterId) ?? '', value: s.value });
    }

    const myEvents = events
      .filter((e) => {
        try { return (JSON.parse(e.participants ?? '[]') as string[]).includes(entity.name); } catch { return false; }
      })
      .map((e) => ({ chapterOrder: orderMap.get(e.chapterId ?? -1) ?? -1, type: e.type, result: e.result }));

    const itemIds = holderStates.map((s) => s.entityId);
    const items = itemIds.length ? await this.prisma.entity.findMany({ where: { id: { in: itemIds } } }) : [];
    const possessions = holderStates.map((s) => ({
      itemName: items.find((i) => i.id === s.entityId)?.name ?? `#${s.entityId}`,
      chapterOrder: orderMap.get(s.chapterId) ?? 0,
    }));

    return {
      entity: toDto(entity),
      maxOrder,
      series,
      events: myEvents.sort((a, b) => a.chapterOrder - b.chapterOrder),
      possessions: possessions.sort((a, b) => a.chapterOrder - b.chapterOrder),
    };
  }

  /** 物品栏：物品 + 当前持有者 + 流转历史（plan 深化方案 §2.2）。 */
  async itemsWithState(novelId: number) {
    const [items, chapters, states, allEntities] = await Promise.all([
      this.prisma.entity.findMany({ where: { novelId, type: 'item' } }),
      this.prisma.chapter.findMany({ where: { novelId }, select: { id: true, order: true, title: true } }),
      this.prisma.entityState.findMany({
        where: { attrName: { in: ['持有者', '状态'] } },
        orderBy: { chapterId: 'asc' },
      }),
      this.prisma.entity.findMany({ where: { novelId }, select: { id: true, name: true } }),
    ]);
    const orderMap = new Map(chapters.map((c) => [c.id, c.order]));
    const titleMap = new Map(chapters.map((c) => [c.id, c.title]));
    const nameById = new Map<number, string>(allEntities.map((e) => [e.id, e.name]));

    return items.map((item) => {
      const mine = states.filter((s) => s.entityId === item.id);
      const holders = mine.filter((s) => s.attrName === '持有者');
      const statuses = mine.filter((s) => s.attrName === '状态');
      const transfers = holders.map((s) => ({
        chapterOrder: orderMap.get(s.chapterId) ?? 0,
        chapterTitle: titleMap.get(s.chapterId) ?? '',
        holderId: Number(s.value),
        holderName: nameById.get(Number(s.value)) ?? `#${s.value}`,
      }));
      const lastStatus = statuses[statuses.length - 1]?.value;
      return {
        ...toDto(item),
        currentHolder: transfers.length ? transfers[transfers.length - 1].holderName : null,
        status: lastStatus ?? '完好',
        transfers,
      };
    });
  }

  private async exists(id: number) {
    const e = await this.prisma.entity.findUnique({ where: { id } });
    if (!e) throw new NotFoundException(`Entity ${id} not found`);
    return e;
  }
}
