import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNovelDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsString()
  synopsis?: string;

  @IsOptional()
  @IsString()
  worldviewText?: string;

  /** 结构化预设：{ theme, trope, coreSetting, audience, templateName } */
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
