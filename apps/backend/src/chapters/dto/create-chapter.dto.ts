import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateChapterDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsInt()
  volumeId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  outlineText?: string;

  @IsOptional()
  @IsString()
  sceneConfig?: string; // JSON: {characterIds, locationIds, itemIds, goals}
}

export class UpdateChapterDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  volumeId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  content?: string; // 正文 HTML

  @IsOptional()
  @IsString()
  outlineText?: string;

  @IsOptional()
  @IsString()
  sceneConfig?: string; // JSON: {characterIds, locationIds, itemIds, goals}

  @IsOptional()
  @IsString()
  status?: string; // draft | writing | complete
}
