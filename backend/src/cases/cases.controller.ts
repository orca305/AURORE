import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  Equals,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { CasesService } from './cases.service.js';
class ListDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';

  @IsOptional() @IsString() @MaxLength(200) q = '';
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class DetailDto extends ListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  historyOffset = 0;
}
class ConfirmDto {
  @IsUUID('4') requestId!: string;
  @Equals(true) confirmed!: true;
}
class RevisionDto extends ConfirmDto {
  @IsInt() @Min(1) @Max(2147483646) revision!: number;
}
class CreateDto extends ConfirmDto {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MaxLength(60) @Matches(/^[A-Z][A-Z0-9_]*$/) typeCode!: string;
}
class UpdateDto extends RevisionDto {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MaxLength(60) @Matches(/^[A-Z][A-Z0-9_]*$/) typeCode!: string;
}
class FactDto extends RevisionDto {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  occurredOn?: string;
}
class CreateFactDto extends FactDto {
  @IsOptional() @IsUUID('4') srcMsgId?: string;
}
@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly auth: AuthService,
  ) {}
  private async owner(authorization?: string, activity = false) {
    const owner = await this.auth.resolveOwner(authorization, activity);
    if (owner.userId === null)
      throw new ForbiddenException('사건 관리는 회원 전용입니다.');
    return { ...owner, userId: owner.userId };
  }
  @Get('options') @Header('Cache-Control', 'no-store') async options(
    @Headers('authorization') authorization?: string,
  ) {
    await this.owner(authorization);
    return this.cases.options();
  }
  @Get() @Header('Cache-Control', 'no-store') async list(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.cases.list(await this.owner(authorization), query);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') async detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: DetailDto,
  ) {
    return this.cases.detail(id, await this.owner(authorization), query);
  }
  @Get(':id/drafts/:messageId')
  @Header('Cache-Control', 'no-store')
  async draft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.draft(id, messageId, await this.owner(authorization));
  }
  @Get(':id/export') @Header('Cache-Control', 'no-store') async exportMarkdown(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.exportMarkdown(id, await this.owner(authorization));
  }
  @Get(':id/timeline') @Header('Cache-Control', 'no-store') async timeline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.cases.timeline(id, await this.owner(authorization), query);
  }
  @Get(':id/chats') @Header('Cache-Control', 'no-store') async chats(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.cases.chats(id, await this.owner(authorization), query);
  }
  @Get(':id/facts/:factId') @Header('Cache-Control', 'no-store') async fact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('factId') factId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.fact(id, factId, await this.owner(authorization));
  }
  @Post() @HttpCode(201) @Header('Cache-Control', 'no-store') async create(
    @Body() body: CreateDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: body.requestId,
      action: 'CREATE_CASE',
    });
  }
  @Post(':id/update')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: id,
      action: 'UPDATE_CASE',
    });
  }
  @Post(':id/delete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RevisionDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: id,
      action: 'DELETE_CASE',
    });
  }
  @Post(':id/facts')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async addFact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateFactDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: id,
      action: 'CREATE_FACT',
    });
  }
  @Post(':id/facts/:factId/update')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async updateFact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('factId') factId: string,
    @Body() body: FactDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: id,
      factId,
      action: 'UPDATE_FACT',
    });
  }
  @Post(':id/facts/:factId/delete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async deleteFact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('factId') factId: string,
    @Body() body: RevisionDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.cases.change(await this.owner(authorization, true), {
      ...body,
      caseId: id,
      factId,
      action: 'DELETE_FACT',
    });
  }
}
