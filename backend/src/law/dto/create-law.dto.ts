import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateLawDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/\S/)
  lawId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/\S/)
  lawName: string;
}
