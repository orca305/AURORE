import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { NotificationsService } from './notifications.service.js';
class ListDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';

  @IsOptional() @IsIn(['ALL', 'UNREAD']) filter: 'ALL' | 'UNREAD' = 'ALL';
  @IsOptional() @IsIn(['ALL', 'PROMULGATED', 'EFFECTIVE', 'CORRECTED']) kind:
    'ALL' | 'PROMULGATED' | 'EFFECTIVE' | 'CORRECTED' = 'ALL';
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class ReadAllDto {
  @MaxLength(19) @Matches(/^[1-9]\d{0,18}$/) throughId!: string;
}
function id(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new BadRequestException('알림 번호를 확인해 주세요.');
  return BigInt(value);
}
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
  ) {}
  private async owner(authorization?: string, activity = false) {
    const owner = await this.auth.resolveOwner(authorization, activity);
    if (owner.userId === null)
      throw new ForbiddenException('알림은 회원 전용입니다.');
    return { ...owner, userId: owner.userId };
  }
  @Get() @Header('Cache-Control', 'no-store') async list(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.notifications.list(await this.owner(authorization), query);
  }
  @Get('unread') @Header('Cache-Control', 'no-store') async unread(
    @Headers('authorization') authorization?: string,
  ) {
    return this.notifications.unread(await this.owner(authorization));
  }
  @Post('read-all')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async readAll(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ReadAllDto,
  ) {
    return this.notifications.markRead(
      await this.owner(authorization, true),
      id(body.throughId),
      true,
    );
  }
  @Post(':id/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async read(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') value: string,
  ) {
    return this.notifications.markRead(
      await this.owner(authorization, true),
      id(value),
    );
  }
}
