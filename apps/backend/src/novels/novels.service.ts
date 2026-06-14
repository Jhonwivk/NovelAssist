import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Injectable()
export class NovelsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateNovelDto) {
    const { meta, ...rest } = dto;
    return this.prisma.novel
      .create({ data: { ...rest, meta: meta ? JSON.stringify(meta) : undefined } })
      .then(deserialize);
  }

  findAll() {
    return this.prisma.novel.findMany({ orderBy: { updatedAt: 'desc' } }).then((rows) => rows.map(deserialize));
  }

  async findOne(id: number) {
    const novel = await this.prisma.novel.findUnique({
      where: { id },
      include: {
        volumes: { orderBy: { order: 'asc' } },
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, status: true, wordCount: true, updatedAt: true },
        },
      },
    });
    if (!novel) throw new NotFoundException(`Novel ${id} not found`);
    return deserialize(novel);
  }

  update(id: number, dto: UpdateNovelDto) {
    const { meta, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (meta !== undefined) data.meta = JSON.stringify(meta);
    return this.prisma.novel.update({ where: { id }, data }).then(deserialize);
  }

  async remove(id: number) {
    await this.prisma.novel.delete({ where: { id } });
    return { id };
  }
}

function deserialize(novel: any) {
  if (!novel) return novel;
  return { ...novel, meta: safeParse(novel.meta, {}) };
}

function safeParse(s: string | null | undefined, fallback: unknown): unknown {
  try {
    return JSON.parse(s ?? '{}');
  } catch {
    return fallback;
  }
}
