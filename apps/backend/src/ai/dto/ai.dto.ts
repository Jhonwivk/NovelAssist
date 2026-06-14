import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

// ---- 既有 ----
export class OutlineDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsOptional() @IsString() instruction?: string;
}

export class OptimizeOutlineDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsString() currentOutline: string;
  @IsOptional() @IsString() instruction?: string;
}

export class OutlineChaptersDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) count?: number;
  @IsOptional() @IsString() instruction?: string;
}
export class GenerateChapterDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsOptional() @Type(() => Number) @IsInt() chapterId?: number;
  @IsOptional() @IsString() instruction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) targetWords?: number;
}
export class ContinueDto {
  @Type(() => Number) @IsInt() novelId: number;
  @Type(() => Number) @IsInt() chapterId: number;
  @IsOptional() @IsString() instruction?: string;
}
export class PolishDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsString() selection: string;
  @IsOptional() @IsString() context?: string;
  @IsOptional() @IsString() instruction?: string;
}

// ---- 阶段二：灵感 / 书名 / 简介 / 钩子 / 对话 ----
export class NovelTaskDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsOptional() @IsString() instruction?: string;
}
export class IdeaDto {
  @IsOptional() @IsString() genre?: string;
  @IsOptional() @IsString() keywords?: string;
  @IsOptional() @IsString() instruction?: string;
}
export class ChatDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsString() message: string;
}

// ---- 阶段二：局部操作（扩写/改写/视角/风格）----
export class LocalEditDto {
  @Type(() => Number) @IsInt() novelId: number;
  @IsString() text: string;
  @IsOptional() @IsString() instruction?: string;
  @IsOptional() @IsString() viewpoint?: string;
  @IsOptional() @IsString() style?: string;
}

// ---- 阶段四：审稿 / 文风 ----
export class ReviewDto {
  @Type(() => Number) @IsInt() chapterId: number;
  @IsOptional() @IsString() instruction?: string;
}
