import {
  Body,
  Controller,
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
  ValidateNested,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  Equals,
  IsBoolean,
  ValidateIf,
  IsInt,
  IsIn,
  Length,
  Matches,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { ChatService } from './chat.service.js';
import { FeedbackService, FEEDBACK_RATINGS, FEEDBACK_REASONS } from './feedback.service.js';

class RevisionDto {
  @IsInt()
  @Min(0)
  revision!: number;
}
class CaseLinkDto extends RevisionDto {
  @ValidateIf((_object, value) => value !== null) @IsUUID('4') caseId!:
    string | null;
  @Equals(true) confirmed!: true;
}
class CorrectionReadDto {
  @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) key!: string;
}
class PageSizeDto {
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
}
class CorrectionHistoryDto extends PageSizeDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class RenameDto extends RevisionDto {
  @IsString() @MaxLength(320) title!: string;
}
class CaseContextDto {
  @IsInt() @Min(1) revision!: number;
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(/^[1-9]\d{0,17}$/, { each: true })
  factIds!: string[];
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf!: string;
  @Equals(true) confirmed!: true;
}
class SubmitDto extends RevisionDto {
  @IsOptional() @IsUUID('4') clarifyReplyTo?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CaseContextDto)
  caseContext?: CaseContextDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds?: string[];
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @MaxLength(1000)
  question!: string;
}
class PinDto {
  @IsBoolean() pinned!: boolean;
}
class FeedbackDto {
  @IsIn([...FEEDBACK_RATINGS]) rating!: 'HELPFUL' | 'IMPROVE';
  @IsOptional() @IsIn([...FEEDBACK_REASONS]) reason?: (typeof FEEDBACK_REASONS)[number];
  @IsOptional() @IsString() @MaxLength(1200) text?: string;
}
class ListDto extends PageSizeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(['newest', 'oldest']) sort?: 'newest' | 'oldest';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) from?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) to?: string;
}
class MessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  beforeSeq?: number;
}

@Controller('chat-sessions')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly auth: AuthService,
    private readonly feedback: FeedbackService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListDto,
  ) {
    return this.chat.list(
      await this.auth.resolveOwner(authorization),
      query.cursor,
      query.limit,
      { q: query.q, from: query.from, to: query.to, sort: query.sort },
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async read(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: MessagesDto,
  ) {
    return this.chat.read(
      id,
      await this.auth.resolveOwner(authorization),
      query.beforeSeq,
    );
  }

  @Post(':id/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async open(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: MessagesDto,
  ) {
    const owner = await this.auth.resolveOwner(authorization, true);
    return {
      ...(await this.chat.read(id, owner, query.beforeSeq)),
      authExpiresAt: owner.expiresAt?.toISOString() ?? null,
    };
  }

  @Get(':id/case-context')
  @Header('Cache-Control', 'no-store')
  async caseContext(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: CorrectionHistoryDto,
  ) {
    return this.chat.caseContextOptions(
      id,
      await this.auth.resolveOwner(authorization),
      query.limit,
      query.offset,
    );
  }

  @Post(':id/messages')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: SubmitDto,
  ) {
    return this.chat.submit(
      id,
      await this.auth.resolveOwner(authorization, true),
      body.requestId,
      body.question,
      body.revision,
      body.documentIds,
      body.caseContext,
      body.clarifyReplyTo,
    );
  }

  @Get(':id/corrections/history')
  @Header('Cache-Control', 'no-store')
  async correctionHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: CorrectionHistoryDto,
  ) {
    return this.chat.correctionHistory(
      id,
      await this.auth.resolveOwner(authorization),
      query.offset,
      query.limit,
    );
  }
  @Post(':id/corrections/:messageId/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirmCorrection(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CorrectionReadDto,
  ) {
    return this.chat.confirmCorrection(
      id,
      messageId,
      body.key,
      await this.auth.resolveOwner(authorization, true),
    );
  }

  @Post(':id/case')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async linkCase(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CaseLinkDto,
  ) {
    return this.chat.linkCase(
      id,
      await this.auth.resolveOwner(authorization, true),
      body.revision,
      body.caseId,
      body.confirmed,
    );
  }

  @Post(':id/messages/:messageId/feedback')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async leaveFeedback(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: FeedbackDto,
  ) {
    return this.feedback.submit(id, messageId, await this.auth.resolveOwner(authorization, true), body);
  }

  @Post(':id/messages/:messageId/feedback/clear')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async clearFeedback(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.feedback.clear(id, messageId, await this.auth.resolveOwner(authorization, true));
  }

  @Post(':id/pin')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async pin(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PinDto,
  ) {
    return this.chat.pin(id, await this.auth.resolveOwner(authorization, true), body.pinned);
  }

  @Post(':id/title')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  rename(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RenameDto,
  ) {
    return this.auth
      .resolveOwner(authorization, true)
      .then((owner) => this.chat.rename(id, owner, body.revision, body.title));
  }

  @Post(':id/delete')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RevisionDto,
  ) {
    await this.chat.remove(
      id,
      await this.auth.resolveOwner(authorization, true),
      body.revision,
    );
  }
}

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly chat: ChatService,
    private readonly auth: AuthService,
  ) {}

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async read(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const job = await this.chat.job(
      id,
      await this.auth.resolveOwner(authorization),
    );
    return { id: job.id, status: job.statCd, chatId: job.chatSessId };
  }

  @Post(':id/retry')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async retry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.chat.retry(
      id,
      await this.auth.resolveOwner(authorization, true),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.chat.cancel(
      id,
      await this.auth.resolveOwner(authorization, true),
    );
  }
}
