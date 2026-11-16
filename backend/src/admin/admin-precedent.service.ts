import { pageSize } from './page-size.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LegalPrecIngestHist } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AdminGuard } from './admin.guard.js';

type Db = Prisma.TransactionClient;
type Review = {
  id: string;
  caseSourceKey: string;
  caseName: string;
  caseNumber: string;
  lawName: string;
  reference: string;
  versionKey: string;
  effectiveDate: string;
  status: string;
  caseChanged: boolean;
  lawChanged: boolean;
  beforeCaseHash: string;
  caseHash: string;
  beforeHash: string;
  afterHash: string | null;
  beforeText: string;
  currentText: string | null;
  beforeCaseUrl: string;
  caseUrl: string;
  beforeLawUrl: string;
  lawUrl: string | null;
  provisionId: string | null;
};
export type ReviewInput = {
  requestId: string;
  reviewHash: string;
  decision: 'verified' | 'unverified';
  reason: string;
  confirmed: true;
};
const idValue = (id: string) => {
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw new BadRequestException('검토 번호를 확인해 주세요.');
  return BigInt(id);
};
const offsetValue = (raw?: string) => {
  if (raw !== undefined && !/^\d{1,6}$/.test(raw))
    throw new BadRequestException('페이지를 확인해 주세요.');
  const offset = Number(raw ?? 0);
  if (offset > 100000)
    throw new BadRequestException('페이지 범위를 초과했습니다.');
  return offset;
};
function adapter(db: Db) {
  return {
    query: async (sql: string, values: unknown[] = []) => {
      if (
        (/^\s*(?:SELECT|WITH)\b/i.test(sql) &&
          !sql.includes('pg_advisory_xact_lock')) ||
        /\bRETURNING\b/i.test(sql)
      ) {
        const rows = await db.$queryRawUnsafe<unknown[]>(sql, ...values);
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: await db.$executeRawUnsafe(sql, ...values) };
    },
  };
}
const fingerprint = (row: Review) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        row.id,
        row.beforeCaseHash,
        row.caseHash,
        row.beforeHash,
        row.afterHash,
        row.provisionId,
      ]),
    )
    .digest('hex');
async function list(
  db: Db,
  caseKey: string | null,
  offset: number,
  linkId: string | null = null,
  limit = 20,
) {
  const tool = (await import(
    new URL('../../tools/list-precedent-reviews.mjs', import.meta.url).href
  )) as {
    listPrecedentReviews: (
      db: ReturnType<typeof adapter>,
      key: string | null,
      offset: number,
      options: { limit: number; linkId: string | null },
    ) => Promise<{ pending: Review[]; nextOffset: number | null }>;
  };
  return tool.listPrecedentReviews(adapter(db), caseKey, offset, {
    limit,
    linkId,
  });
}
async function pending(db: Db, id: string) {
  const prior = await db.legalPrecProvi.findUnique({
    where: { id: idValue(id) },
    select: {
      precedentRev: { select: { precedent: { select: { srcKey: true } } } },
    },
  });
  if (!prior) throw new NotFoundException('검토 대상을 찾을 수 없습니다.');
  const result = await list(db, prior.precedentRev.precedent.srcKey, 0, id);
  const row = result.pending[0];
  if (!row)
    throw new ConflictException(
      '이미 처리되었거나 원문이 변경된 검토입니다. 목록을 새로고침해 주세요.',
    );
  return row;
}
@Injectable()
export class AdminPrecedentService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
    private readonly config: ConfigService,
  ) {}
  private async collectionTools() {
    return (await import(
      new URL('../../tools/resume-precedent-collection.mjs', import.meta.url)
        .href
    )) as {
      validatePrecedentQueue: (
        value: unknown,
      ) => { ID: string; caseNumber: string }[];
      readCollectedPrecedents: (directory: string) => Promise<{
        items: { ID: string; caseNumber: string }[];
        completed: {
          ID: string;
          caseNumber: string;
          hash: string;
          bytes: number;
          collectedAt: string;
        }[];
        pending: { ID: string; caseNumber: string }[];
      }>;
    };
  }
  private async collectionFolders() {
    const configured = this.config.get<string>(
      'AURORE_PRECEDENT_COLLECTION_ROOT',
    );
    if (configured && !isAbsolute(configured))
      throw new ServiceUnavailableException(
        '판례 수집 저장소 설정을 확인해 주세요.',
      );
    const root =
      configured ||
      fileURLToPath(
        new URL('../../../local-dev/precedent-runs/', import.meta.url),
      );
    let base: string;
    try {
      base = await realpath(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ServiceUnavailableException(
        '판례 수집 저장소를 확인해 주세요.',
      );
    }
    // ponytail: a root and its first-level folders cover the single-PC beta; use a persistent catalog beyond 100 batches.
    const entries = (await readdir(base, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          entry.name !== 'snapshots',
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 100)
      throw new ServiceUnavailableException(
        '수집 묶음이 많습니다. 저장소 구성을 확인해 주세요.',
      );
    const folders = [];
    for (const name of ['.', ...entries.map((entry) => entry.name)]) {
      const directory = await realpath(join(base, name));
      const rel = relative(base, directory);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
        continue;
      const names = await readdir(directory);
      if (!names.includes('queue.json') && !names.includes('input.json'))
        continue;
      folders.push({
        id: createHash('sha256').update(name).digest('hex'),
        directory,
      });
    }
    return folders.map((folder, index) => ({
      ...folder,
      label: '수집 묶음 ' + (index + 1),
    }));
  }
  private async collectionFile(directory: string, path: string) {
    const target = await realpath(path),
      rel = relative(directory, target);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
      throw new Error('Unsafe collection artifact');
    return target;
  }
  private async collectionData(folder: { directory: string }) {
    const { directory } = folder,
      tools = await this.collectionTools();
    const names = await readdir(directory);
    if (!names.includes('queue.json')) {
      const input = await this.collectionFile(
        directory,
        join(directory, 'input.json'),
      );
      return {
        items: tools.validatePrecedentQueue(
          JSON.parse(await readFile(input, 'utf8')),
        ),
        completed: [],
        pending: [],
      };
    }
    await this.collectionFile(directory, join(directory, 'queue.json'));
    for (const name of names.filter((name) =>
      /^[1-9][0-9]{0,11}[.]json$/.test(name),
    ))
      await this.collectionFile(directory, join(directory, name));
    if (names.includes('snapshots')) {
      const snapshots = await this.collectionFile(
        directory,
        join(directory, 'snapshots'),
      );
      for (const name of await readdir(snapshots))
        if (name.endsWith('.json'))
          await this.collectionFile(directory, join(snapshots, name));
    }
    return tools.readCollectedPrecedents(directory);
  }
  async collections(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw),
      limit = pageSize(rawLimit),
      folders = await this.collectionFolders();
    const items = [];
    for (const folder of folders.slice(offset, offset + limit)) {
      try {
        const data = await this.collectionData(folder);
        items.push({
          id: folder.id,
          label: folder.label,
          total: data.items.length,
          collected: data.completed.length,
          remaining: data.items.length - data.completed.length,
          available: true,
        });
      } catch {
        items.push({
          id: folder.id,
          label: folder.label,
          total: 0,
          collected: 0,
          remaining: 0,
          available: false,
        });
      }
    }
    return {
      items,
      total: folders.length,
      offset,
      limit,
      nextOffset: offset + limit < folders.length ? offset + limit : null,
    };
  }
  private async collectionFolder(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new NotFoundException('수집 묶음을 찾을 수 없습니다.');
    const folder = (await this.collectionFolders()).find(
      (folder) => folder.id === id,
    );
    if (!folder) throw new NotFoundException('수집 묶음을 찾을 수 없습니다.');
    return folder;
  }
  async collection(id: string, raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw),
      limit = pageSize(rawLimit),
      folder = await this.collectionFolder(id);
    try {
      const data = await this.collectionData(folder),
        ready = new Map(data.completed.map((item) => [item.ID, item]));
      return {
        id,
        label: folder.label,
        total: data.items.length,
        collected: data.completed.length,
        offset,
        limit,
        nextOffset: offset + limit < data.items.length ? offset + limit : null,
        items: data.items.slice(offset, offset + limit).map((item) => ({
          sourceId: item.ID,
          caseNumber: item.caseNumber,
          ready: ready.has(item.ID),
          collectedAt: ready.get(item.ID)?.collectedAt ?? null,
        })),
      };
    } catch {
      throw new ServiceUnavailableException(
        '수집 기록 또는 원문 무결성을 확인해 주세요.',
      );
    }
  }
  async verifiedCollectedPrecedent(id: string, sourceId: string) {
    if (!/^[1-9][0-9]{0,11}$/.test(sourceId))
      throw new NotFoundException('판례를 찾을 수 없습니다.');
    const folder = await this.collectionFolder(id);
    let record: {
      sourceKey: string;
      raw: string;
      json: string;
      title: string;
      caseNumber: string;
      court: string;
      date: string;
      issue: string | null;
      summary: string | null;
      decision: string;
      hash: string;
    };
    try {
      const data = await this.collectionData(folder),
        item = data.items.find((item) => item.ID === sourceId);
      if (!item) throw new NotFoundException('판례를 찾을 수 없습니다.');
      const saved = data.completed.find((item) => item.ID === sourceId);
      if (!saved)
        throw new ConflictException('아직 원문이 수집되지 않은 판례입니다.');
      const path = await this.collectionFile(
        folder.directory,
        join(folder.directory, 'snapshots', saved.hash + '.json'),
      );
      const parse = (await import(
        new URL('../../tools/import-precedent-samples.mjs', import.meta.url)
          .href
      )) as {
        parsePrecedent: (sample: unknown, bytes: Buffer) => typeof record;
      };
      record = parse.parsePrecedent(
        { target: 'prec', ID: sourceId, caseNumber: item.caseNumber },
        await readFile(path),
      );
      if (record.hash !== saved.hash) throw new Error('Snapshot changed');
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      throw new ServiceUnavailableException(
        '수집 기록 또는 원문 무결성을 확인해 주세요.',
      );
    }
    return { record, label: folder.label };
  }
  async collectedPrecedent(id: string, sourceId: string) {
    const { record, label } = await this.verifiedCollectedPrecedent(
      id,
      sourceId,
    );
    const stored = await this.db.legalPrec.findFirst({
      where: { srcCd: 'MOLEG', srcKey: sourceId },
      select: { id: true, delYn: true },
    });
    const current =
      stored && !stored.delYn
        ? await this.db.legalPrecRev.findFirst({
            where: { legalPrecId: stored.id, currentYn: true },
            select: {
              caseNm: true,
              caseNo: true,
              courtNm: true,
              decisionDt: true,
              issueCont: true,
              summaryCont: true,
              decisionCont: true,
              snapshot: { select: { contHash: true } },
            },
          })
        : null;
    return {
      batchId: id,
      label,
      beforeHash: current?.snapshot.contHash ?? null,
      afterHash: record.hash,
      sourceId,
      officialUrl: 'https://www.law.go.kr/LSW/precInfoP.do?precSeq=' + sourceId,
      status: stored?.delYn
        ? 'DELETED'
        : !stored
          ? 'NEW'
          : !current
            ? 'UNAVAILABLE'
            : current.snapshot.contHash === record.hash
              ? 'SAME'
              : 'DIFFERENT',
      candidate: {
        title: record.title,
        caseNumber: record.caseNumber,
        court: record.court,
        date: record.date,
        issue: record.issue,
        summary: record.summary,
        decision: record.decision,
      },
      current: current
        ? {
            title: current.caseNm,
            caseNumber: current.caseNo,
            court: current.courtNm,
            date: current.decisionDt.toISOString().slice(0, 10),
            issue: current.issueCont,
            summary: current.summaryCont,
            decision: current.decisionCont,
          }
        : null,
    };
  }
  async approveCollectedPrecedent(
    id: string,
    sourceId: string,
    input: {
      requestId: string;
      beforeHash: string | null;
      afterHash: string;
      confirmed: true;
    },
    authorization?: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[1-9][0-9]{0,11}$/.test(sourceId))
      throw new NotFoundException('검토 대상을 찾을 수 없습니다.');
    const actor = await this.access.require(authorization),
      userId = BigInt(actor.id);
    const result = (row: LegalPrecIngestHist) => ({
      id: row.id,
      status: row.statCd,
      resultCode: row.resultCd,
      revision: row.revNo,
      finishedAt: row.endDttm.toISOString(),
    });
    const replay = (row: LegalPrecIngestHist) => {
      if (
        row.userId !== userId ||
        row.batchKey !== id ||
        row.sourceKey !== sourceId ||
        row.beforeHash !== input.beforeHash ||
        row.afterHash !== input.afterHash
      )
        throw new ConflictException('다른 요청에 사용된 처리 번호입니다.');
      return result(row);
    };
    const known = await this.db.legalPrecIngestHist.findUnique({
      where: { id: input.requestId },
    });
    if (known) return replay(known);
    const second = () => new Date(Math.floor(Date.now() / 1000) * 1000),
      started = second();
    let failure = 'REVIEW_UNAVAILABLE';
    try {
      const { record } = await this.verifiedCollectedPrecedent(id, sourceId);
      failure = 'REVIEW_CHANGED';
      if (record.hash !== input.afterHash)
        throw new Error('Staged source changed');
      failure = 'SOURCE_NOT_CONFIGURED';
      const oc = this.config.get<string>('MOLEG_OC')?.trim();
      if (!oc) throw new Error('Source unavailable');
      failure = 'SOURCE_VERIFY_FAILED';
      const capture = (await import(
        new URL('../../tools/capture-law-samples.mjs', import.meta.url).href
      )) as {
        readOfficialSample: (
          sample: unknown,
          oc: string,
        ) => Promise<{ bytes: Buffer }>;
      };
      const fresh = await capture.readOfficialSample(
        { target: 'prec', ID: sourceId, caseNumber: record.caseNumber },
        oc,
      );
      if (
        createHash('sha256').update(fresh.bytes).digest('hex') !== record.hash
      )
        throw new Error('Official source changed');
      const importer = (await import(
        new URL('../../tools/import-precedent-samples.mjs', import.meta.url)
          .href
      )) as {
        importPrecedent: (
          db: ReturnType<typeof adapter>,
          record: unknown,
        ) => Promise<{ status: string; revision: number }>;
      };
      failure = 'APPLY_FAILED';
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))`;
          const existing = await tx.legalPrecIngestHist.findUnique({
            where: { id: input.requestId },
          });
          if (existing) return replay(existing);
          failure = 'PERMISSION_CHANGED';
          await this.access.require(authorization, tx);
          failure = 'REVIEW_CHANGED';
          const stored = await tx.legalPrec.findFirst({
            where: { srcCd: 'MOLEG', srcKey: sourceId },
            select: { id: true, delYn: true },
          });
          const current = stored
            ? await tx.legalPrecRev.findFirst({
                where: { legalPrecId: stored.id, currentYn: true },
                select: { snapshot: { select: { contHash: true } } },
              })
            : null;
          if (
            stored?.delYn ||
            (stored && !current) ||
            (current?.snapshot.contHash ?? null) !== input.beforeHash
          )
            throw new Error('Current source changed');
          failure = 'APPLY_FAILED';
          const published = await importer.importPrecedent(adapter(tx), record);
          const codes: Record<string, string> = {
            saved: 'APPLIED',
            corrected: 'APPLIED',
            duplicate: 'UNCHANGED',
            'format-only': 'FORMAT_ONLY',
            'previously-seen': 'PREVIOUSLY_SEEN',
          };
          if (!codes[published.status] || !published.revision)
            throw new Error('Unsupported publication');
          return result(
            await tx.legalPrecIngestHist.create({
              data: {
                id: input.requestId,
                batchKey: id,
                sourceKey: sourceId,
                userId,
                beforeHash: input.beforeHash,
                afterHash: input.afterHash,
                statCd: 'SUCCEEDED',
                resultCd: codes[published.status],
                revNo: published.revision,
                rgstDttm: started,
                endDttm: second(),
              },
            }),
          );
        },
        { timeout: 30000 },
      );
    } catch {
      const durable = await this.db.legalPrecIngestHist
        .findUnique({ where: { id: input.requestId } })
        .catch(() => null);
      if (durable) return replay(durable);
      try {
        return result(
          await this.db.legalPrecIngestHist.create({
            data: {
              id: input.requestId,
              batchKey: id,
              sourceKey: sourceId,
              userId,
              beforeHash: input.beforeHash,
              afterHash: input.afterHash,
              statCd: 'FAILED',
              resultCd: failure,
              rgstDttm: started,
              endDttm: second(),
            },
          }),
        );
      } catch {
        const receipt = await this.db.legalPrecIngestHist
          .findUnique({ where: { id: input.requestId } })
          .catch(() => null);
        if (receipt) return replay(receipt);
        throw new ServiceUnavailableException(
          '처리 결과를 확인하지 못했습니다. 같은 처리 번호로 다시 확인해 주세요.',
        );
      }
    }
  }
  async collectionHistory(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw),
      limit = pageSize(rawLimit);
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.legalPrecIngestHist.count();
        const rows = await tx.legalPrecIngestHist.findMany({
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: limit,
          select: {
            id: true,
            batchKey: true,
            sourceKey: true,
            statCd: true,
            resultCd: true,
            revNo: true,
            endDttm: true,
            user: { select: { loginId: true } },
          },
        });
        return {
          total,
          offset,
          limit,
          nextOffset: offset + limit < total ? offset + limit : null,
          items: rows.map((row) => ({
            id: row.id,
            batchId: row.batchKey,
            sourceId: row.sourceKey,
            status: row.statCd,
            resultCode: row.resultCd,
            revision: row.revNo,
            finishedAt: row.endDttm.toISOString(),
            operator: row.user.loginId.slice(0, 2) + '***',
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async overview(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw);
    const limit = pageSize(rawLimit);
    return this.db.$transaction(
      async (tx) => ({
        ...(await list(tx, null, offset, null, limit)),
        offset,
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(id: string) {
    idValue(id);
    return this.db.$transaction(
      async (tx) => {
        const row = await pending(tx, id);
        const before = await tx.legalPrecProvi.findUniqueOrThrow({
          where: { id: BigInt(id) },
          select: { precedentRev: { select: { decisionCont: true } } },
        });
        const current = await tx.legalPrecRev.findFirstOrThrow({
          where: {
            currentYn: true,
            precedent: {
              srcCd: 'MOLEG',
              srcKey: row.caseSourceKey,
              delYn: false,
            },
          },
          select: { decisionCont: true },
        });
        return {
          ...row,
          reviewHash: fingerprint(row),
          beforeDecision: before.precedentRev.decisionCont,
          currentDecision: current.decisionCont,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async resolve(id: string, input: ReviewInput, authorization?: string) {
    idValue(id);
    const actor = await this.access.require(authorization);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('검토 사유를 입력해 주세요.');
    const requestHash = createHash('sha256')
      .update(JSON.stringify([id, input.reviewHash, input.decision, reason]))
      .digest('hex');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))`;
        await this.access.require(authorization, tx);
        const receipt = await tx.legalPrecReviewHist.findUnique({
          where: { id: input.requestId },
        });
        if (receipt) {
          if (
            receipt.userId !== BigInt(actor.id) ||
            receipt.requestHash !== requestHash
          )
            throw new ConflictException('다른 요청에 사용된 처리 번호입니다.');
          return { id: receipt.id, status: receipt.decision };
        }
        const row = await pending(tx, id);
        if (fingerprint(row) !== input.reviewHash)
          throw new ConflictException(
            '검토 중 원문이 바뀌었습니다. 전후 원문을 다시 확인해 주세요.',
          );
        if (input.decision === 'verified' && row.status !== 'READY_TO_REVIEW')
          throw new ConflictException(
            '대상 조문을 하나로 확인할 수 없어 연결을 확정할 수 없습니다.',
          );
        const tool = (await import(
          new URL(
            '../../tools/restore-reviewed-precedent-link.mjs',
            import.meta.url,
          ).href
        )) as {
          restoreReviewedLink: (
            db: ReturnType<typeof adapter>,
            review: object,
          ) => Promise<{ status: string }>;
        };
        try {
          await tool.restoreReviewedLink(adapter(tx), {
            ...row,
            linkId: id,
            reason,
            decision: input.decision,
          });
        } catch {
          throw new ConflictException(
            '원문 검증에 실패했거나 연결이 변경되었습니다. 새로고침 후 다시 확인해 주세요.',
          );
        }
        await tx.legalPrecProvi.update({
          where: { id: BigInt(id) },
          data: { delId: BigInt(actor.id) },
        });
        const next = await tx.legalPrecProvi.findFirstOrThrow({
          where: {
            delYn: false,
            refKey: row.reference,
            precedentRev: {
              currentYn: true,
              precedent: { srcCd: 'MOLEG', srcKey: row.caseSourceKey },
            },
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        const saved = await tx.legalPrecReviewHist.create({
          data: {
            id: input.requestId,
            requestHash,
            userId: BigInt(actor.id),
            priorRefId: BigInt(id),
            nextRefId: next.id,
            decision: input.decision === 'verified' ? 'VERIFIED' : 'UNVERIFIED',
            reason,
            rgstDttm: new Date(Math.floor(Date.now() / 1000) * 1000),
          },
        });
        return { id: saved.id, status: saved.decision };
      },
      { timeout: 30000 },
    );
  }
  async history(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw);
    const limit = pageSize(rawLimit);
    const rows = await this.db.legalPrecReviewHist.findMany({
      orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        decision: true,
        reason: true,
        rgstDttm: true,
        user: { select: { loginId: true } },
        nextRef: {
          select: {
            refKey: true,
            precedentRev: { select: { caseNm: true, caseNo: true } },
          },
        },
      },
    });
    return {
      items: rows.slice(0, limit).map(({ user, nextRef, ...row }) => ({
        ...row,
        operator: user.loginId,
        reference: nextRef.refKey,
        caseName: nextRef.precedentRev.caseNm,
        caseNumber: nextRef.precedentRev.caseNo,
      })),
      offset,
      nextOffset:
        rows.length > limit && offset < 100000
          ? Math.min(100000, offset + limit)
          : null,
    };
  }
}
