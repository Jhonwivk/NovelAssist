import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { countWords } from '../common/text.utils';
import { CreateChapterDto, UpdateChapterDto } from './dto/create-chapter.dto';

@Injectable()
export class ChaptersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(novelId: number, dto: CreateChapterDto) {
    const order = dto.order ?? (await this.nextOrder(novelId));
    const chapter = await this.prisma.chapter.create({
      data: {
        novelId,
        volumeId: dto.volumeId,
        title: dto.title,
        order,
        outlineText: dto.outlineText,
      },
    });
    await this.recountNovel(novelId);
    return chapter;
  }

  findAll(novelId: number) {
    return this.prisma.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        order: true,
        status: true,
        wordCount: true,
        volumeId: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: number) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id },
      include: { summary: true },
    });
    if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
    return chapter;
  }

  /** 自动保存入口：写入正文并重算字数。 */
  async update(id: number, dto: UpdateChapterDto) {
    await this.exists(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.content !== undefined) {
      data.wordCount = countWords(dto.content);
      if (dto.status === undefined) data.status = 'writing';
    }
    const chapter = await this.prisma.chapter.update({ where: { id }, data });
    if (dto.content !== undefined) await this.recountNovel(chapter.novelId);
    return chapter;
  }

  async remove(id: number) {
    const chapter = await this.exists(id);
    await this.prisma.chapter.delete({ where: { id } });
    await this.recountNovel(chapter.novelId);
    return { id };
  }

  private async nextOrder(novelId: number) {
    const last = await this.prisma.chapter.findFirst({
      where: { novelId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? -1) + 1;
  }

  private async exists(id: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id } });
    if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
    return chapter;
  }

  /** 重算作品总字数。 */
  private async recountNovel(novelId: number) {
    const agg = await this.prisma.chapter.aggregate({
      where: { novelId },
      _sum: { wordCount: true },
    });
    await this.prisma.novel.update({
      where: { id: novelId },
      data: { wordCount: agg._sum.wordCount ?? 0 },
    });
  }
}
