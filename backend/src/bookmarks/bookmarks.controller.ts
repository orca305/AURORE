import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { BookmarksService, type BookmarkKind } from './bookmarks.service.js';
class ListDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) from = '';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) to = '';

  @IsOptional() @IsString() @MaxLength(200) q = '';
  @IsOptional() @IsIn(['ALL', 'LEGAL', 'PREC']) kind: 'ALL' | BookmarkKind =
    'ALL';
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class StateDto {
  @IsIn(['LEGAL', 'PREC']) kind!: BookmarkKind;
  @IsString() @MaxLength(999) ids!: string;
}
class SetDto {
  @IsBoolean() saved!: boolean;
}
function parseId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new BadRequestException('자료 식별자를 확인해 주세요.');
  return BigInt(value);
}
@Controller('bookmarks')
export class BookmarksController {
  constructor(
    private readonly bookmarks: BookmarksService,
    private readonly auth: AuthService,
  ) {}
  private async owner(authorization?: string, activity = false) {
    const owner = await this.auth.resolveOwner(authorization, activity);
    if (owner.userId === null)
      throw new ForbiddenException('관심 항목은 회원 전용입니다.');
    return { ...owner, userId: owner.userId };
  }
  @Get() @Header('Cache-Control', 'no-store') async list(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.bookmarks.list(await this.owner(authorization), query);
  }
  @Get('state') @Header('Cache-Control', 'no-store') async states(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: StateDto,
  ) {
    const values = query.ids.split(',');
    if (!values.length || values.length > 50)
      throw new BadRequestException(
        '자료는 한 번에 50개까지 확인할 수 있습니다.',
      );
    return this.bookmarks.states(
      await this.owner(authorization),
      query.kind,
      [...new Set(values)].map(parseId),
    );
  }
  @Put(':kind/:targetId') @Header('Cache-Control', 'no-store') async set(
    @Headers('authorization') authorization: string | undefined,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
    @Body() body: SetDto,
  ) {
    if (kind !== 'LEGAL' && kind !== 'PREC')
      throw new BadRequestException('자료 종류를 확인해 주세요.');
    return this.bookmarks.set(
      await this.owner(authorization, true),
      kind,
      parseId(targetId),
      body.saved,
    );
  }
}
