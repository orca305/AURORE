import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateLegalDto } from './dto/create-legal.dto.js';
import type { ListLegalsDto } from './dto/list-legals.dto.js';
import type { ListLegalVersionsDto } from './dto/list-legal-versions.dto.js';

const publicSelect = {
  id: true,
  srcCd: true,
  srcKey: true,
  legalNm: true,
  rgstDttm: true,
  uptDttm: true,
} satisfies Prisma.LegalSelect;

const versionSelect = {
  id: true, verKey: true, prmlDt: true, enfcDt: true,
  revisions: {
    where: { currentYn: true },
    select: { snapshot: { select: { srcUrl: true, contHash: true } } },
    take: 1,
  },
} satisfies Prisma.LegalVerSelect;

function publicVersion({ revisions, ...row }: Prisma.LegalVerGetPayload<{ select: typeof versionSelect }>) {
  const snapshot = revisions[0]?.snapshot;
  return { ...row, id: row.id.toString(), sourceUrl: snapshot?.srcUrl ?? null, sourceHash: snapshot?.contHash ?? null };
}

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
    const keyword = query.q?.trim() ?? '';
    const contains = keyword.replace(/[\\%_]/g, '\\$&');
    const visibleArticle = {
      delYn: false,
      proviTypeCd: 'ARTICLE',
      prntProviId: null,
      revision: {
        srcSnapshotId: { not: null },
        version: { delYn: false, legal: { delYn: false } },
      },
    } satisfies Prisma.LegalProviWhereInput;
    const rows = await this.prisma.legalPrecRev.findMany({
      where: {
        currentYn: true,
        precedent: { delYn: false },
        ...(keyword ? {
          OR: [
            { caseNo: keyword },
            { caseNm: { contains, mode: 'insensitive' as const } },
            { issueCont: { contains, mode: 'insensitive' as const } },
            { summaryCont: { contains, mode: 'insensitive' as const } },
            { decisionCont: { contains, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      orderBy: [{ decisionDt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        caseNo: true,
        caseNm: true,
        issueCont: true,
        summaryCont: true,
        decisionCont: true,
        courtNm: true,
        decisionDt: true,
        snapshot: { select: { srcUrl: true, contHash: true } },
        precedent: {
          select: {
            srcKey: true,
            revisions: {
              where: { currentYn: false },
              select: {
                provisionRefs: {
                  where: { delYn: false, statCd: 'VERIFIED', provision: visibleArticle },
                  select: { refKey: true },
                },
              },
            },
          },
        },
        provisionRefs: {
          where: {
            delYn: false,
            OR: [
              { statCd: 'UNVERIFIED' },
              { statCd: 'VERIFIED', provision: visibleArticle },
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
                    currentYn: true,
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
    return rows.map(({
      snapshot, decisionDt, provisionRefs, precedent,
      issueCont, summaryCont, decisionCont, ...row
    }) => {
      const content = [issueCont, summaryCont, decisionCont];
      const matched = keyword && content.find(text =>
        text?.toLowerCase().includes(keyword.toLowerCase()));
      const text = (matched || summaryCont || issueCont || decisionCont || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const matchIndex = keyword ? text.toLowerCase().indexOf(keyword.toLowerCase()) : 0;
      const excerptStart = Math.max(0, matchIndex - 40);
      const excerptEnd = excerptStart + 200;
      const excerpt = (excerptStart ? '…' : '') +
        text.slice(excerptStart, excerptEnd) + (text.length > excerptEnd ? '…' : '');

      const references = provisionRefs.map(({ provision, ...ref }) => {
        if (provision && !provision.revision.currentYn) {
          return {
            refKey: ref.refKey,
            statCd: 'REVIEW_REQUIRED',
            evidenceDesc: '법령 원문이 정정되어 이 조문의 적용 근거를 다시 확인하고 있습니다.',
            target: null,
          };
        }
        return {
          ...ref,
          target: provision && {
            provisionId: provision.id.toString(),
            versionKey: provision.revision.version.verKey,
            effectiveDate:
              provision.revision.version.enfcDt?.toISOString().slice(0, 10) ?? null,
            sourceUrl: provision.revision.snapshot?.srcUrl ?? null,
          },
        };
      });
      const currentKeys = new Set(references.map(ref => ref.refKey));
      for (const revision of precedent.revisions) {
        for (const { refKey } of revision.provisionRefs) {
          if (currentKeys.has(refKey)) continue;
          currentKeys.add(refKey);
          references.push({
            refKey,
            statCd: 'REVIEW_REQUIRED',
            evidenceDesc: '판결문이 정정되어 이 조문의 적용 근거를 다시 확인하고 있습니다.',
            target: null,
          });
        }
      }
      return {
        ...row,
        decisionDate: decisionDt.toISOString().slice(0, 10),
        sourceUrl: snapshot.srcUrl,
        sourceHash: snapshot.contHash,
        sourceKey: precedent.srcKey,
        excerpt,
        references,
      };
    });
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

  async findOne(id: bigint) {
    const row = await this.prisma.legal.findFirst({
      where: { id, delYn: false },
      select: publicSelect,
    });
    if (!row) throw new NotFoundException('법규를 찾을 수 없습니다.');
    return { ...row, id: row.id.toString() };
  }

  async versions(id: bigint, query: ListLegalVersionsDto) {
    const asOf = query.asOf === undefined ? null : new Date(query.asOf);
    if (asOf && (Number.isNaN(asOf.valueOf()) || asOf.toISOString().slice(0, 10) !== query.asOf ||
      query.asOf?.startsWith('0000-'))) {
      throw new BadRequestException('유효한 기준일을 YYYY-MM-DD 형식으로 입력해 주세요.');
    }
    if (
      !(await this.prisma.legal.findFirst({
        where: { id, delYn: false },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('법규를 찾을 수 없습니다.');
    }
    const rows = await this.prisma.legalVer.findMany({
      where: {
        legalId: id, delYn: false, legal: { delYn: false },
        ...(asOf && {
          enfcDt: { lte: asOf },
          revisions: { some: { currentYn: true, srcSnapshotId: { not: null } } },
        }),
      },
      select: versionSelect,
      orderBy: [
        { enfcDt: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(publicVersion);
  }

  async version(id: bigint, versionId: bigint) {
    const row = await this.prisma.legalVer.findFirst({
      where: { id: versionId, legalId: id, delYn: false, legal: { delYn: false } },
      select: { ...versionSelect, legal: { select: { legalNm: true } } },
    });
    if (!row) throw new NotFoundException('법규 버전을 찾을 수 없습니다.');
    const { legal, ...version } = row;
    return { ...publicVersion(version), legalName: legal.legalNm };
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
    const term = query.q?.trim() || null;
    const article = term?.normalize('NFKC').replace(/\s+/gu, '').match(/^(?:제)?(\d+)조(?:의(\d+))?$/u);
    const number = article ? article[1].replace(/^0+(?=\d)/u, '') : null;
    const branch = article?.[2] ? article[2].replace(/^0+(?=\d)/u, '') : null;
    const normNo = number ? (branch ? `${number}의${branch}` : number) : null;
    const dispNo = number ? `제${number}조${branch ? `의${branch}` : ''}` : null;
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
        SELECT p.*, p.id AS root_id FROM legal_provi p
        JOIN legal_ver_rev r ON r.id = p.legal_ver_rev_id
        JOIN legal_ver v ON v.id = r.legal_ver_id AND NOT v.del_yn
        JOIN legal l ON l.id = v.legal_id AND NOT l.del_yn
        WHERE v.id = ${versionId} AND v.legal_id = ${id}
          AND CASE WHEN ${revisionId ?? null}::bigint IS NULL THEN r.current_yn
                   ELSE r.id = ${revisionId ?? null}::bigint END
          AND p.prnt_provi_id IS NULL AND NOT p.del_yn
        UNION ALL
        SELECT p.*, parent.root_id FROM legal_provi p JOIN visible parent ON p.prnt_provi_id = parent.id
          AND p.legal_ver_rev_id = parent.legal_ver_rev_id WHERE NOT p.del_yn
      ), search AS (
        SELECT ${term}::text AS term, ${normNo}::text AS norm_no, ${dispNo}::text AS disp_no
      )
      SELECT p.id, p.prnt_provi_id AS "prntProviId", p.disp_no AS "dispNo", p.norm_no AS "normNo",
        sort_seq AS "sortSeq", provi_type_cd AS "proviTypeCd", provi_nm AS "proviNm",
        provi_cont AS "proviCont", src_parts AS "srcParts", enfc_dt AS "enfcDt"
      FROM visible p CROSS JOIN search s
      WHERE s.term IS NULL OR p.root_id IN (
        SELECT hit.root_id FROM visible hit
        WHERE CASE WHEN s.norm_no IS NOT NULL THEN
          hit.id = hit.root_id AND hit.provi_type_cd = 'ARTICLE' AND (
            hit.norm_no = s.norm_no OR (hit.norm_no IS NULL AND
              regexp_replace(hit.disp_no, '[[:space:]]', '', 'g') = s.disp_no)
          )
        ELSE strpos(lower(concat_ws(' ', hit.disp_no, hit.provi_nm, hit.provi_cont)), lower(s.term)) > 0
        END
      )
      ORDER BY sort_seq, p.id LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      prntProviId: row.prntProviId?.toString() ?? null,
    }));
  }
}
