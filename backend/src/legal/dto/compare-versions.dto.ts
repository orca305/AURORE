import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  IsIn,
  MaxLength,
} from 'class-validator';
export class CompareVersionsDto {
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @MaxLength(19) @Matches(/^[1-9]\d{0,18}$/) beforeVersionId!: string;
  @MaxLength(19) @Matches(/^[1-9]\d{0,18}$/) afterVersionId!: string;
  @IsOptional()
  @MaxLength(19)
  @Matches(/^[1-9]\d{0,18}$/)
  beforeRevisionId?: string;
  @IsOptional()
  @MaxLength(19)
  @Matches(/^[1-9]\d{0,18}$/)
  afterRevisionId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
  @IsOptional() @IsIn(['all', 'changed']) view: 'all' | 'changed' = 'changed';
}
