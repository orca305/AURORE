import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateLegalDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  @MaxLength(60)
  srcCd: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/\S/)
  srcKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/\S/)
  legalNm: string;
}
