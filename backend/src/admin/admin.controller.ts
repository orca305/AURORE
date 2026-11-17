import { JOB_ERROR_CODES, JOB_RESULT_CODES } from '../chat/job-diagnostics.js';
import {
  Controller,
  Body,
  Post,
  Headers,
  HttpCode,
  Get,
  Header,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { AdminPrecedentService } from './admin-precedent.service.js';
import {
  IsIn,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsString,
  MinLength,
  MaxLength,
  Equals,
  IsUUID,
  Matches,
  Length,
  ValidateIf,
} from 'class-validator';
import { AdminCorrectionService } from './admin-correction.service.js';
import { AdminRefreshService } from './admin-refresh.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

class MembersDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';

  @IsOptional() @IsString() @MaxLength(200) q = '';
  @IsOptional() @IsIn(['all', 'ACTIVE', 'BLOCKED']) status = 'all';
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}

class MemberHistoryDto {
  @IsOptional() @IsIn(['newest','oldest']) sort: 'newest' | 'oldest' = 'newest';

  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class ActivityDto extends MemberHistoryDto {
  @IsOptional() @IsString() @MaxLength(200) q = '';
  @IsOptional()
  @IsIn(['all', 'LAW_CORRECTION', 'PRECEDENT_REVIEW', 'MEMBER_STATUS'])
  kind = 'all';
  @IsOptional() @IsIn(['all', 'SUCCEEDED', 'FAILED']) result = 'all';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) from = '';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) to = '';
}
class JobsDto extends MemberHistoryDto {
  @IsOptional() @Matches(/^[0-9a-f-]{0,36}$/i) q = '';
  @IsOptional()
  @IsIn([
    'all',
    'FAILED',
    'RETRY_WAIT',
    'RUNNING',
    'QUEUED',
    'SUCCEEDED',
    'CANCELLED',
  ])
  status = 'FAILED';
  @IsOptional()
  @IsIn(['all', ...JOB_ERROR_CODES, 'OTHER', 'NONE'])
  error = 'all';
  @IsOptional() @IsIn(['all', ...JOB_RESULT_CODES, 'NONE', 'OTHER']) result =
    'all';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) from = '';
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) to = '';
}
class MemberStatusDto {
  @IsUUID('4') requestId!: string;
  @MaxLength(19) @Matches(/^(0|[1-9]\d{0,18})$/) revision!: string;
  @IsIn(['ACTIVE', 'BLOCKED']) previousStatus!: string;
  @IsIn(['ACTIVE', 'BLOCKED']) status!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
  @Equals(true) confirmed!: true;
}

class ApprovalDto {
  @Length(36, 36)
  @IsUUID('4')
  requestId!: string;
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  beforeHash!: string;
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  afterHash!: string;
  @Equals(true) confirmed!: true;
}

class PrecedentReviewDto {
  @Length(36, 36) @IsUUID('4') requestId!: string;
  @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) reviewHash!: string;
  @IsIn(['verified', 'unverified']) decision!: 'verified' | 'unverified';
  @IsString() @MaxLength(2000) reason!: string;
  @Equals(true) confirmed!: true;
}

class PrecedentIngestDto {
  @IsUUID('4') requestId!: string;
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^[a-f0-9]{64}$/)
  beforeHash!: string | null;
  @Matches(/^[a-f0-9]{64}$/) afterHash!: string;
  @Equals(true) confirmed!: true;
}
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly precedent: AdminPrecedentService,
    private readonly refresh: AdminRefreshService,
    private readonly correction: AdminCorrectionService,
  ) {}

  @Get('ai-jobs')
  @Header('Cache-Control', 'no-store')
  jobs(@Query() query: JobsDto) {
    return this.admin.jobs(query);
  }
  @Get('ai-jobs/:id')
  @Header('Cache-Control', 'no-store')
  job(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.admin.job(id);
  }

  @Get('activity')
  @Header('Cache-Control', 'no-store')
  activity(@Query() query: ActivityDto) {
    return this.admin.activity(query);
  }

  @Get('members')
  @Header('Cache-Control', 'no-store')
  members(@Query() query: MembersDto) {
    return this.admin.members(query);
  }

  @Get('members/:id')
  @Header('Cache-Control', 'no-store')
  member(
    @Param('id') id: string,
    @Query() query: MemberHistoryDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admin.member(id, query, authorization);
  }
  @Post('members/:id/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  memberStatus(
    @Param('id') id: string,
    @Body() input: MemberStatusDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admin.changeMemberStatus(id, input, authorization);
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session() {
    return { admin: true };
  }

  @Get('privacy-retention')
  @Header('Cache-Control', 'no-store')
  privacyRetention() {
    return this.refresh.privacyOverview();
  }

  @Get('collection-schedule')
  @Header('Cache-Control', 'no-store')
  collectionSchedule() {
    return this.refresh.schedule();
  }

  @Get('legal-refresh')
  @Header('Cache-Control', 'no-store')
  refreshOverview() {
    return this.refresh.overview();
  }

  @Get('legal-refresh/reviews/:id')
  @Header('Cache-Control', 'no-store')
  review(
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.refresh.review(id, offset, limit);
  }

  @Post('legal-refresh/reviews/:id/approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approve(
    @Param('id') id: string,
    @Body() input: ApprovalDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.correction.approve(id, input, authorization);
  }

  @Get('legal-refresh/processing-history')
  @Header('Cache-Control', 'no-store')
  processingHistory() {
    return this.correction.history();
  }

  @Get('precedent-collections')
  @Header('Cache-Control', 'no-store')
  collections(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.precedent.collections(offset, limit);
  }
  @Get('precedent-collections/history')
  @Header('Cache-Control', 'no-store')
  collectionHistory(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.precedent.collectionHistory(offset, limit);
  }
  @Post('precedent-collections/:id/items/:sourceId/approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approveCollectedPrecedent(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() input: PrecedentIngestDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.precedent.approveCollectedPrecedent(
      id,
      sourceId,
      input,
      authorization,
    );
  }
  @Get('precedent-collections/:id')
  @Header('Cache-Control', 'no-store')
  collection(
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.precedent.collection(id, offset, limit);
  }
  @Get('precedent-collections/:id/items/:sourceId')
  @Header('Cache-Control', 'no-store')
  collectedPrecedent(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.precedent.collectedPrecedent(id, sourceId);
  }

  @Get('precedent-reviews')
  @Header('Cache-Control', 'no-store')
  precedentReviews(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.precedent.overview(offset, limit);
  }
  @Get('precedent-reviews/history')
  @Header('Cache-Control', 'no-store')
  precedentHistory(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.precedent.history(offset, limit);
  }
  @Get('precedent-reviews/:id')
  @Header('Cache-Control', 'no-store')
  precedentDetail(@Param('id') id: string) {
    return this.precedent.detail(id);
  }
  @Post('precedent-reviews/:id/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resolvePrecedent(
    @Param('id') id: string,
    @Body() input: PrecedentReviewDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.precedent.resolve(id, input, authorization);
  }

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview() {
    return this.admin.overview();
  }
}
