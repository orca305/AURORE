import { TermImportService } from './term-import.service.js';
import { TermSourceQuery, ImportTerms } from './terms.dto.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TermsService } from './terms.service.js';
import {
  TermsQuery,
  AdminTermsQuery,
  TermHistoryQuery,
  CreateTerm,
  UpdateTerm,
  TermCommand,
  termId,
} from './terms.dto.js';
import { AdminGuard } from '../admin/admin.guard.js';
function parse(value: string) {
  try {
    return termId(value);
  } catch {
    throw new BadRequestException('용어 식별자를 확인해 주세요.');
  }
}
@Controller('terms')
export class TermsController {
  constructor(private readonly terms: TermsService) {}
  @Get() @Header('Cache-Control', 'no-store') list(@Query() query: TermsQuery) {
    return this.terms.list(query);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') read(
    @Param('id') id: string,
  ) {
    return this.terms.read(parse(id));
  }
}
@Controller('admin/terms')
@UseGuards(AdminGuard)
export class AdminTermsController {
  constructor(
    private readonly terms: TermsService,
    private readonly importer: TermImportService,
  ) {}
  @Get() @Header('Cache-Control', 'no-store') list(
    @Query() query: AdminTermsQuery,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.list(query, authorization);
  }
  @Get('sources') @Header('Cache-Control', 'no-store') sources(
    @Query() query: TermSourceQuery,
    @Headers('authorization') authorization?: string,
  ) {
    return this.importer.search(query, authorization);
  }
  @Post('import') @Header('Cache-Control', 'no-store') importTerms(
    @Body() body: ImportTerms,
    @Headers('authorization') authorization?: string,
  ) {
    return this.importer.run(body.items, authorization);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') read(
    @Param('id') id: string,
    @Query() query: TermHistoryQuery,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.read(parse(id), query, authorization);
  }
  @Post() @Header('Cache-Control', 'no-store') create(
    @Body() input: CreateTerm,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.save('CREATE', null, input, authorization);
  }
  @Post(':id') @Header('Cache-Control', 'no-store') update(
    @Param('id') id: string,
    @Body() input: UpdateTerm,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.save('UPDATE', parse(id), input, authorization);
  }
  @Post(':id/publish') @Header('Cache-Control', 'no-store') publish(
    @Param('id') id: string,
    @Body() input: TermCommand,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.save('PUBLISH', parse(id), input, authorization);
  }
  @Post(':id/delete') @Header('Cache-Control', 'no-store') remove(
    @Param('id') id: string,
    @Body() input: TermCommand,
    @Headers('authorization') authorization?: string,
  ) {
    return this.terms.save('DELETE', parse(id), input, authorization);
  }
}
