import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  ValidateNested,
  Matches,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Equals,
} from 'class-validator';
export class TermsQuery {
  @IsOptional() @IsString() @MaxLength(200) q = '';
  @IsOptional() @IsIn(['newest', 'oldest']) sort: 'newest' | 'oldest' =
    'newest';
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
export class AdminTermsQuery extends TermsQuery {
  @IsOptional() @IsIn(['ALL', 'DRAFT', 'PUBLISHED', 'DELETED']) state = 'ALL';
}
export class TermHistoryQuery {
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  historyRevision?: number;
}
export class TermData {
  @IsString() @MaxLength(100) termName!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases!: string[];
  @IsString() @MaxLength(10000) definition!: string;
  @IsOptional() @IsString() @MaxLength(8000) explanation?: string;
  @IsString() @MaxLength(200) sourceName!: string;
  @IsString() @MaxLength(2000) sourceUrl!: string;
  @IsOptional() @IsString() @MaxLength(4000) sourceReference?: string;
}
export class CreateTerm extends TermData {
  @IsUUID('4') requestId!: string;
}
export class UpdateTerm extends CreateTerm {
  @IsInt() @Min(1) @Max(2147483646) revision!: number;
}
export class TermCommand {
  @IsUUID('4') requestId!: string;
  @IsInt() @Min(1) @Max(2147483646) revision!: number;
  @Equals(true) confirmed!: true;
}
export function termId(value: string) {
  if (
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > BigInt('9223372036854775807')
  )
    throw new Error('INVALID_TERM_ID');
  return BigInt(value);
}

export class TermSourceQuery {
  @IsOptional() @IsIn(['newest', 'oldest']) sort: 'newest' | 'oldest' =
    'newest';
  @IsString() @MaxLength(100) q!: string;
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 10;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
}
export class TermImportItem {
  @Matches(/^[1-9]\d{0,11}$/) sourceId!: string;
  @IsUUID('4') requestId!: string;
}
export class ImportTerms {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: TermImportItem) => item?.sourceId)
  @ArrayUnique((item: TermImportItem) => item?.requestId)
  @ValidateNested({ each: true })
  @Type(() => TermImportItem)
  items!: TermImportItem[];
  @Equals(true) confirmed!: true;
}
