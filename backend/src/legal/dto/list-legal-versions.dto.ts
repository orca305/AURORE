import { IsOptional, Matches } from 'class-validator';
import { ListLegalsDto } from './list-legals.dto.js';

export class ListLegalVersionsDto extends ListLegalsDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOf?: string;
}
