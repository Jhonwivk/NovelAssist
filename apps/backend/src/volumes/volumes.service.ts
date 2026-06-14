import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVolumeDto, UpdateVolumeDto } from './dto/create-volume.dto';

@Injectable()
export class VolumesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(novelId: number, dto: CreateVolumeDto) {
    const order = dto.order ?? (await this.nextOrder(novelId));
    return this.prisma.volume.create({
      data: { novelId, title: dto.title, summary: dto.summary, order },
    });
  }

  findAll(novelId: number) {
    return this.prisma.volume.findMany({ where: { novelId }, orderBy: { order: 'asc' } });
  }

  async update(id: number, dto: UpdateVolumeDto) {
    await this.exists(id);
    return this.prisma.volume.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.exists(id);
    await this.prisma.volume.delete({ where: { id } });
    return { id };
  }

  private async nextOrder(novelId: number) {
    const last = await this.prisma.volume.findFirst({
      where: { novelId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? -1) + 1;
  }

  private async exists(id: number) {
    const v = await this.prisma.volume.findUnique({ where: { id } });
    if (!v) throw new NotFoundException(`Volume ${id} not found`);
  }
}
