import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateNovelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

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

  @IsOptional()
  @IsString()
  masterOutline?: string;

  @IsOptional()
  @IsString()
  status?: string; // draft | writing | completed | archived

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
