import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListLegalsDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) from?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}
