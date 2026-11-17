import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LegalService } from './legal.service.js';
import { LegalController } from './legal.controller.js';
import { IngestGuard } from './ingest.guard.js';
import { ListLegalsDto } from './dto/list-legals.dto.js';
import { CreateLegalDto } from './dto/create-legal.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LawService } from '../law/law.service.js';
import { CommonCodeController } from '../common-code/common-code.controller.js';

const record = {
  id: 9007199254740993n,
  srcCd: 'LEGACY',
  srcKey: '001',
  legalNm: '테스트법',
  rgstDttm: new Date(),
  uptDttm: new Date(),
};
function setup() {
  const db = {
    legal: {
      findMany: vi.fn().mockResolvedValue([record]),
      create: vi.fn().mockResolvedValue(record),
      findFirst: vi.fn().mockResolvedValue({ id: 1n }),
    },
    legalPrecRev: { findMany: vi.fn().mockResolvedValue([]) },
    legalVer: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 2n }),
    },
    cmmnCd: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = db as unknown as PrismaService;
  const service = new LegalService(prisma);
  return { db, prisma, service };
}

describe('법규 API 계약', () => {
  it('삭제 제외·검색·페이지 제한을 적용하고 BIGINT를 손실 없이 직렬화한다', async () => {
    const { db, service } = setup();
    const result = await service.findAll({
      q: '테스트',
      limit: 10,
      offset: 20,
    });
    expect(db.legal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          delYn: false,
          legalNm: { contains: '테스트', mode: 'insensitive' },
        },
        take: 10,
        skip: 20,
      }),
    );
    expect(JSON.parse(JSON.stringify(result))[0].id).toBe('9007199254740993');
  });

  it('정정으로 보류된 조문은 별도 상태로 표시하고 이전 원문 링크를 숨긴다', async () => {
    const { db, service } = setup();
    const makeRef = (currentYn: boolean) => ({
      refKey: currentYn ? '제1조' : '제2조',
      statCd: 'VERIFIED',
      evidenceDesc: '검토 기록',
      provision: {
        id: 1n,
        revision: {
          currentYn,
          snapshot: { srcUrl: 'https://www.law.go.kr/' },
          version: { verKey: 'v1', enfcDt: new Date('2026-01-02') },
        },
      },
    });
    db.legalPrecRev.findMany.mockResolvedValue([{
      caseNo: '2026다100',
      decisionDt: new Date('2026-01-03'),
      snapshot: { srcUrl: 'https://www.law.go.kr/' },
      provisionRefs: [makeRef(true), makeRef(false)],
      precedent: { revisions: [
        { provisionRefs: [{ refKey: '제1조' }, { refKey: '제3조' }] },
        { provisionRefs: [{ refKey: '제3조' }] },
      ] },
    }]);

    const [result] = await service.precedents(new ListLegalsDto());
    expect(result.references[0]).toMatchObject({
      statCd: 'VERIFIED', target: { provisionId: '1', effectiveDate: '2026-01-02' },
    });
    expect(result.references[1]).toMatchObject({ statCd: 'REVIEW_REQUIRED', target: null });
    expect(result.references[1].evidenceDesc).not.toBe('검토 기록');
    expect(result.references).toHaveLength(3);
    expect(result.references[2]).toMatchObject({
      refKey: '제3조', statCd: 'REVIEW_REQUIRED', target: null,
      evidenceDesc: expect.stringContaining('판결문이 정정'),
    });
  });

  it('본문에만 있는 검색어의 주변 내용을 보여주고 판결문 전체를 응답에 싣지 않는다', async () => {
    const { db, service } = setup();
    db.legalPrecRev.findMany.mockResolvedValue([
      {
        caseNo: '2026다100',
        caseNm: '구상금',
        courtNm: '대법원',
        decisionDt: new Date('2026-01-03'),
        issueCont: null,
        summaryCont: '판결 요약',
        decisionCont:
          '앞부분'.repeat(300) +
          '동시이행관계<br/>관련 내용' +
          '뒷부분'.repeat(300),
        snapshot: {
          srcUrl: 'https://www.law.go.kr/',
          contHash: 'fixture-hash',
        },
        provisionRefs: [],
        precedent: { srcKey: 'fixture-key', revisions: [] },
      },
    ]);
    const [result] = await service.precedents({
      q: '동시이행관계',
      limit: 20,
      offset: 0,
    });
    expect(result.excerpt).toContain('동시이행관계');
    expect(result.excerpt).not.toContain('<br/>');
    expect(result.excerpt.length).toBeLessThanOrEqual(202);
    expect(result).not.toHaveProperty('decisionCont');
    expect(result.sourceKey).toBe('fixture-key');
    expect(result.sourceHash).toBe('fixture-hash');
  });

  it('출처별 중복 등록은 409로 응답한다', async () => {
    const { db, service } = setup();
    db.legal.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );
    await expect(
      service.create({ srcCd: 'MOLEG', srcKey: '1', legalNm: '법' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('시행일 최신순으로 정렬하고 시행일 미상은 뒤에 둔다', async () => {
    const { db, service } = setup();
    await service.versions(1n, new ListLegalsDto());
    expect(db.legalVer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ enfcDt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      }),
    );
  });

  it('기준일과 같거나 먼저 시행된 원문 있는 판본을 조회한다', async () => {
    const { db, service } = setup();
    db.legalVer.findMany.mockResolvedValue([{
      id: 2n,
      revisions: [{ snapshot: { srcUrl: 'https://www.law.go.kr/', contHash: 'fixture-hash' } }],
    }]);
    const rows = await service.versions(1n, { ...new ListLegalsDto(), asOf: '2023-07-11' });
    expect(db.legalVer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        enfcDt: { lte: new Date('2023-07-11') },
        revisions: { some: { currentYn: true, srcSnapshotId: { not: null } } },
      }),
    }));
    expect(rows).toEqual([{ id: '2', sourceUrl: 'https://www.law.go.kr/', sourceHash: 'fixture-hash' }]);
    await expect(service.versions(1n, { ...new ListLegalsDto(), asOf: '2023-02-30' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('삭제되거나 없는 법규·버전은 하위 목록도 숨긴다', async () => {
    const { db, service } = setup();
    db.legal.findFirst.mockResolvedValue(null);
    await expect(
      service.versions(1n, new ListLegalsDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.legalVer.findMany).not.toHaveBeenCalled();
    db.legalVer.findFirst.mockResolvedValue(null);
    await expect(
      service.provisions(1n, 2n, new ListLegalsDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('잘못된 식별자는 DB 조회 전에 거부한다', () => {
    const { service } = setup();
    const controller = new LegalController(service);
    for (const id of ['0', '-1', '1.2', '9223372036854775808', 'abc']) {
      expect(() => controller.versions(id, new ListLegalsDto())).toThrow(
        BadRequestException,
      );
    }
  });

  it('이전 laws 입력과 출력은 같은 legal 서비스로 연결한다', async () => {
    const { db, service } = setup();
    const legacy = new LawService(service);
    expect(await legacy.create({ lawId: '001', lawName: '테스트법' })).toEqual({
      id: '9007199254740993',
      lawId: '001',
      lawName: '테스트법',
      createdAt: record.rgstDttm,
      updatedAt: record.uptDttm,
    });
    expect(db.legal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { srcCd: 'LEGACY', srcKey: '001', legalNm: '테스트법' },
      }),
    );
  });
});

describe('등록 인증과 입력 검증', () => {
  const context = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;
  it('비밀값 미설정·짧은 설정은 등록 기능을 닫는다', () => {
    for (const token of ['', 'short']) {
      const guard = new IngestGuard(
        new ConfigService({ LEGAL_INGEST_TOKEN: token }),
      );
      expect(() => guard.canActivate(context())).toThrow(
        ServiceUnavailableException,
      );
    }
  });
  it('올바른 Bearer 인증만 등록을 허용한다', () => {
    const token = 'a'.repeat(32);
    const guard = new IngestGuard(
      new ConfigService({ LEGAL_INGEST_TOKEN: token }),
    );
    for (const header of [
      undefined,
      'Basic x',
      `Bearer ${'b'.repeat(32)}`,
      'Bearer short',
    ]) {
      expect(() => guard.canActivate(context(header))).toThrow(
        UnauthorizedException,
      );
    }
    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
  });
  it('초과 조회·공백 이름·알 수 없는 필드를 거부한다', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { limit: '101' },
        { type: 'query', metatype: ListLegalsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { srcCd: 'LEGACY', srcKey: '1', legalNm: '   ' },
        { type: 'body', metatype: CreateLegalDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { srcCd: 'LEGACY', srcKey: '1', legalNm: '법', delYn: true },
        { type: 'body', metatype: CreateLegalDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await pipe.transform({}, { type: 'query', metatype: ListLegalsDto }),
    ).toEqual({ limit: 20, offset: 0,sort:'newest' });
  });
});

describe('공통코드 경로 조회', () => {
  it('모든 조상의 활성 상태를 검사하고 의미형 경로를 반환한다', async () => {
    const { db, prisma } = setup();
    db.cmmnCd.findFirst
      .mockResolvedValueOnce({ id: 1n })
      .mockResolvedValueOnce({ id: 2n });
    db.cmmnCd.findMany.mockResolvedValue([
      { cd: 'ACTIVE', cdNm: '정상', nodeTypeCd: 'VALUE', sortSeq: 1 },
    ]);
    const rows = await new CommonCodeController(prisma).children(
      'AURORE/USER_STAT',
    );
    expect(db.cmmnCd.findFirst).toHaveBeenNthCalledWith(2, {
      where: { cd: 'USER_STAT', prntCdId: 1n, delYn: false, useYn: true },
      select: { id: true },
    });
    expect(rows[0].path).toBe('AURORE/USER_STAT/ACTIVE');
  });
  it('삭제·비활성 부모의 하위 코드와 잘못된 경로를 숨긴다', async () => {
    const { db, prisma } = setup();
    db.cmmnCd.findFirst.mockResolvedValue(null);
    const controller = new CommonCodeController(prisma);
    await expect(
      controller.children('AURORE/USER_STAT'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.cmmnCd.findMany).not.toHaveBeenCalled();
    await expect(controller.children('../USER_STAT')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
