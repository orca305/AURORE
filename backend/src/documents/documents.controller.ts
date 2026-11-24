import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import {
  DocumentsService,
  type DocumentOwner,
  type Upload,
} from './documents.service.js';
type MemberRequest = Request & { documentOwner: DocumentOwner };
@Injectable()
export class DocumentMemberGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const owner = await this.auth.resolveOwner(
      request.headers.authorization,
      true,
    );
    if (owner.userId === null)
      throw new ForbiddenException('첨부자료는 회원 전용입니다.');
    request.documentOwner = { ...owner, userId: owner.userId };
    return true;
  }
}
class ConfirmDto {
  @IsString() @MaxLength(4096) receipt!: string;
  @IsString() @MinLength(1) @MaxLength(50000) markdown!: string;
  @Equals(true) confirmed!: true;
}
class PageDto {
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
@Controller('chat-sessions/:chatId/documents')
@UseGuards(DocumentMemberGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}
  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  preview(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.docs.preview(id, req.documentOwner, file);
  }
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  confirm(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
    @Body() body: ConfirmDto,
  ) {
    return this.docs.confirm(
      id,
      req.documentOwner,
      body.receipt,
      body.markdown,
      body.confirmed,
    );
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
    @Query() query: PageDto,
  ) {
    return this.docs.list(id, req.documentOwner, query.limit, query.offset);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  read(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
  ) {
    return this.docs.read(chatId, id, req.documentOwner);
  }
  @Get(':id/original')
  @Header('Cache-Control', 'no-store')
  async original(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.docs.original(chatId, id, req.documentOwner);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename),
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.buffer);
  }
  @Post(':id/delete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: MemberRequest,
  ) {
    return this.docs.remove(chatId, id, req.documentOwner);
  }
}
