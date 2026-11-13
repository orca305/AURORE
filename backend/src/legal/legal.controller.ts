import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CompareVersionsDto } from './dto/compare-versions.dto.js';
import { LegalService } from './legal.service.js';
import { CreateLegalDto } from './dto/create-legal.dto.js';
import { ListLegalsDto } from './dto/list-legals.dto.js';
import { ListLegalVersionsDto } from './dto/list-legal-versions.dto.js';
import { IngestGuard } from './ingest.guard.js';

function parseId(value: string): bigint {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException('유효한 법규 식별자가 필요합니다.');
  }
  return BigInt(value);
}

@Controller('legals')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  findAll(@Query() query: ListLegalsDto) {
    return this.legal.findAll(query);
  }

  @Post()
  @UseGuards(IngestGuard)
  create(@Body() input: CreateLegalDto) {
    return this.legal.create(input);
  }

  @Get('precedents')
  precedents(@Query() query: ListLegalsDto) {
    return this.legal.precedents(query);
  }

  @Get(':id/comparison')
  @Header('Cache-Control', 'no-store')
  comparison(@Param('id') id: string, @Query() query: CompareVersionsDto) {
    return this.legal.comparison(parseId(id), query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.legal.findOne(parseId(id));
  }

  @Get(':id/versions')
  versions(@Param('id') id: string, @Query() query: ListLegalVersionsDto) {
    return this.legal.versions(parseId(id), query);
  }

  @Get(':id/versions/:versionId')
  version(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.legal.version(parseId(id), parseId(versionId));
  }

  @Get(':id/versions/:versionId/revisions')
  revisions(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query() query: ListLegalsDto,
  ) {
    return this.legal.revisions(parseId(id), parseId(versionId), query);
  }

  @Get(':id/versions/:versionId/revisions/:revisionId/provisions')
  revisionProvisions(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('revisionId') revisionId: string,
    @Query() query: ListLegalsDto,
  ) {
    return this.legal.provisions(
      parseId(id),
      parseId(versionId),
      query,
      parseId(revisionId),
    );
  }

  @Get(':id/versions/:versionId/provisions')
  provisions(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query() query: ListLegalsDto,
  ) {
    return this.legal.provisions(parseId(id), parseId(versionId), query);
  }
}
