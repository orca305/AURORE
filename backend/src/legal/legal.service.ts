import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateLegalDto } from './dto/create-legal.dto.js';
import type { ListLegalsDto } from './dto/list-legals.dto.js';

const publicSelect = {
  id: true,
  srcCd: true,
  srcKey: true,
  legalNm: true,
  rgstDttm: true,
  uptDttm: true,
} satisfies Prisma.LegalSelect;

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListLegalsDto) {
    const rows = await this.prisma.legal.findMany({
      where: {
        delYn: false,
        ...(query.q
          ? { legalNm: { contains: query.q, mode: 'insensitive' as const } }
          : {}),
      },
      select: publicSelect,
      orderBy: { id: 'asc' },
      take: query.limit,
      skip: query.offset,
    });
    return rows.map((row) => ({ ...row, id: row.id.toString() }));
  }

  async precedents(query: ListLegalsDto) {
    const rows = await this.prisma.legalPrecRev.findMany({
      where: {
        currentYn: true,
        precedent: { delYn: false },
        ...(query.q?.trim() ? { caseNo: query.q.trim() } : {}),
      },
      orderBy: [{ decisionDt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        caseNo: true,
        caseNm: true,
        courtNm: true,
        decisionDt: true,
        snapshot: { select: { srcUrl: true } },
        provisionRefs: {
          where: {
            delYn: false,
            OR: [
              { statCd: 'UNVERIFIED' },
              {
                statCd: 'VERIFIED',
                provision: {
                  delYn: false,
                  proviTypeCd: 'ARTICLE',
                  prntProviId: null,
                  revision: {
                    currentYn: true,
                    srcSnapshotId: { not: null },
                    version: { delYn: false, legal: { delYn: false } },
                  },
                },
              },
            ],
          },
          orderBy: { refKey: 'asc' },
          select: {
            refKey: true,
            statCd: true,
            evidenceDesc: true,
            provision: {
              select: {
                id: true,
                revision: {
                  select: {
                    snapshot: { select: { srcUrl: true } },
                    version: { select: { verKey: true, enfcDt: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    return rows.map(({ snapshot, decisionDt, provisionRefs, ...row }) => ({
      ...row,
      decisionDate: decisionDt.toISOString().slice(0, 10),
      sourceUrl: snapshot.srcUrl,
      references: provisionRefs.map(({ provision, ...ref }) => ({
        ...ref,
        target: provision && {
          provisionId: provision.id.toString(),
          versionKey: provision.revision.version.verKey,
          effectiveDate:
            provision.revision.version.enfcDt?.toISOString().slice(0, 10) ?? null,
          sourceUrl: provision.revision.snapshot?.srcUrl ?? null,
        },
      })),
    }));
  }

  async create(input: CreateLegalDto) {
    try {
      const row = await this.prisma.legal.create({
        data: input,
        select: publicSelect,
      });
      return { ...row, id: row.id.toString() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          '동일한 출처의 법규가 이미 등록되어 있습니다.',
        );
      }
      throw error;
    }
  }

  async versions(id: bigint, query: ListLegalsDto) {
    if (
      !(await this.prisma.legal.findFirst({
        where: { id, delYn: false },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('법규를 찾을 수 없습니다.');
    }
    const rows = await this.prisma.legalVer.findMany({
      where: { legalId: id, delYn: false, legal: { delYn: false } },
      select: { id: true, verKey: true, prmlDt: true, enfcDt: true },
      orderBy: [
        { enfcDt: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map((row) => ({ ...row, id: row.id.toString() }));
  }

  private async requireVersion(id: bigint, versionId: bigint) {
    const version = await this.prisma.legalVer.findFirst({
      where: {
        id: versionId,
        legalId: id,
        delYn: false,
        legal: { delYn: false },
      },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('법규 버전을 찾을 수 없습니다.');
  }

  async revisions(id: bigint, versionId: bigint, query: ListLegalsDto) {
    await this.requireVersion(id, versionId);
    const rows = await this.prisma.legalVerRev.findMany({
      where: {
        legalVerId: versionId,
        version: { delYn: false, legal: { id, delYn: false } },
      },
      select: { id: true, revNo: true, currentYn: true, rgstDttm: true },
      orderBy: { revNo: 'desc' },
      take: query.limit,
      skip: query.offset,
    });
    return rows.map((row) => ({ ...row, id: row.id.toString() }));
  }

  async provisions(
    id: bigint,
    versionId: bigint,
    query: ListLegalsDto,
    revisionId?: bigint,
  ) {
    await this.requireVersion(id, versionId);
    if (
      revisionId !== undefined &&
      !(await this.prisma.legalVerRev.findFirst({
        where: { id: revisionId, legalVerId: versionId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('법규 판본을 찾을 수 없습니다.');
    // 삭제된 조상 아래의 조문도 직접 조회로 노출하지 않는다.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: bigint;
        prntProviId: bigint | null;
        dispNo: string;
        normNo: string | null;
        sortSeq: number;
        proviTypeCd: string;
        proviNm: string | null;
        proviCont: string;
        srcParts: Prisma.JsonValue | null;
        enfcDt: Date | null;
      }>
    >`
      WITH RECURSIVE visible AS (
        SELECT p.* FROM legal_provi p
        JOIN legal_ver_rev r ON r.id = p.legal_ver_rev_id
        JOIN legal_ver v ON v.id = r.legal_ver_id AND NOT v.del_yn
        JOIN legal l ON l.id = v.legal_id AND NOT l.del_yn
        WHERE v.id = ${versionId} AND v.legal_id = ${id}
          AND CASE WHEN ${revisionId ?? null}::bigint IS NULL THEN r.current_yn
                   ELSE r.id = ${revisionId ?? null}::bigint END
          AND p.prnt_provi_id IS NULL AND NOT p.del_yn
        UNION ALL
        SELECT p.* FROM legal_provi p JOIN visible parent ON p.prnt_provi_id = parent.id
          AND p.legal_ver_rev_id = parent.legal_ver_rev_id WHERE NOT p.del_yn
      )
      SELECT id, prnt_provi_id AS "prntProviId", disp_no AS "dispNo", norm_no AS "normNo",
        sort_seq AS "sortSeq", provi_type_cd AS "proviTypeCd", provi_nm AS "proviNm",
        provi_cont AS "proviCont", src_parts AS "srcParts", enfc_dt AS "enfcDt"
      FROM visible ORDER BY sort_seq, id LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      prntProviId: row.prntProviId?.toString() ?? null,
    }));
  }
}
