import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('common-codes')
export class CommonCodeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async children(@Query('path') path = 'AURORE') {
    if (
      typeof path !== 'string' ||
      path.length > 500 ||
      !/^AURORE(?:\/[A-Z][A-Z0-9_]{0,59})*$/.test(path)
    ) {
      throw new BadRequestException('올바른 공통코드 경로가 필요합니다.');
    }
    // 루트부터 확인하여 중간 부모가 삭제·비활성화된 코드도 숨긴다.
    let parentId: bigint | null = null;
    for (const cd of path.split('/')) {
      const row: { id: bigint } | null = await this.prisma.cmmnCd.findFirst({
        where: { cd, prntCdId: parentId, delYn: false, useYn: true },
        select: { id: true },
      });
      if (!row)
        throw new NotFoundException('공통코드 경로를 찾을 수 없습니다.');
      parentId = row.id;
    }
    const rows = await this.prisma.cmmnCd.findMany({
      where: { prntCdId: parentId, delYn: false, useYn: true },
      select: { cd: true, cdNm: true, nodeTypeCd: true, sortSeq: true },
      orderBy: [{ sortSeq: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return rows.map((row) => ({ ...row, path: `${path}/${row.cd}` }));
  }
}
