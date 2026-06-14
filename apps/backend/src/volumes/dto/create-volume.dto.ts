import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateVolumeDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  summary?: string;
}

export class UpdateVolumeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  summary?: string;
}
