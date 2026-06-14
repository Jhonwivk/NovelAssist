import { IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEntityDto {
  @IsString()
  @MaxLength(50)
  type: string; // character | location | organization | item | power_system | worldview

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  parentId?: number; // 地点父子层级
}

export class UpdateEntityDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  parentId?: number | null;
}
