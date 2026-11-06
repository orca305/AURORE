import { Injectable } from '@nestjs/common';
import { LegalService } from '../legal/legal.service.js';
import { CreateLawDto } from './dto/create-law.dto.js';
import { ListLegalsDto } from '../legal/dto/list-legals.dto.js';

@Injectable()
export class LawService {
  constructor(private readonly legal: LegalService) {}

  async findAll(query: ListLegalsDto) {
    const rows = await this.legal.findAll(query);
    return rows.map((row) => this.legacy(row));
  }

  async create(input: CreateLawDto) {
    return this.legacy(
      await this.legal.create({
        srcCd: 'LEGACY',
        srcKey: input.lawId,
        legalNm: input.lawName,
      }),
    );
  }

  private legacy(row: Awaited<ReturnType<LegalService['create']>>) {
    return {
      id: row.id,
      lawId: row.srcKey,
      lawName: row.legalNm,
      createdAt: row.rgstDttm,
      updatedAt: row.uptDttm,
    };
  }
}
