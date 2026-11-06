import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { LawService } from './law.service.js';
import { CreateLawDto } from './dto/create-law.dto.js';
import { IngestGuard } from '../legal/ingest.guard.js';
import { ListLegalsDto } from '../legal/dto/list-legals.dto.js';

@Controller('laws')
export class LawController {
  constructor(private readonly lawService: LawService) {}

  @Get()
  findAll(@Query() query: ListLegalsDto) {
    return this.lawService.findAll(query);
  }

  @Post()
  @UseGuards(IngestGuard)
  create(@Body() createLawDto: CreateLawDto) {
    return this.lawService.create(createLawDto);
  }
}
