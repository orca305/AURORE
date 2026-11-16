import { pageSize } from './page-size.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../prisma/prisma.service.js';

type Pending = {
  kind: 'new-edition' | 'correction';
  date: string;
  lawId: string;
  versionKey: string;
  effectiveDate: string;
  beforeHash?: string;
  afterHash?: string;
  path: string;
  status: string;
};
type Execution = {
  status: 'IDLE' | 'RUNNING' | 'RECOVERY_REQUIRED' | 'OTHER_HOST' | 'INVALID';
  startedAt: string | null;
};
type State = {
  fromDate: string | null;
  lastCompletedDate: string | null;
  nextDate: string | null;
};
type Unit = {
  displayNumber: string;
  title?: string | null;
  text: string;
  effectiveDate?: string | null;
};
export type Correction = {
  mst: string;
  chunks: unknown[];
  lawId: string;
  versionKey: string;
  effectiveDate: string;
  beforeHash: string;
  afterHash: string;
  changes: {
    key: string;
    change: string;
    before: Unit | null;
    after: Unit | null;
  }[];
};
type Run = {
  id: string;
  date: string;
  status: 'STAGED' | 'FAILED';
  errorCode: string | null;
  recordedAt: string;
  candidates: number;
  editions: number;
  corrections: number;
};

function reviewId(item: Pending) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.kind,
        item.date,
        item.lawId,
        item.versionKey,
        item.effectiveDate,
        item.beforeHash,
        item.afterHash,
      ]),
    )
    .digest('hex');
}

@Injectable()
export class AdminRefreshService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async privacyOverview() {
    try {
      const tools = (await import(
        new URL('../../tools/privacy-retention.mjs', import.meta.url).href
      )) as {
        auditPrivacyRetention: (
          db: {
            query: (
              sql: string,
              values: unknown[],
            ) => Promise<{ rows: unknown[] }>;
          },
          now: Date,
        ) => Promise<{
          asOf: string;
          readOnly: true;
          contentAccess: false;
          purgeImplemented: false;
          counts: Record<string, number>;
        }>;
        auditTemporaryBackups: (now: Date) => Promise<unknown>;
      };
      const now = new Date();
      const report = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return tools.auditPrivacyRetention(
            {
              query: async (sql, values) => {
                if (!/^WITH\b/.test(sql))
                  throw new Error('Only audit reads allowed');
                return {
                  rows: await tx.$queryRawUnsafe<unknown[]>(sql, ...values),
                };
              },
            },
            now,
          );
        },
        { isolationLevel: 'RepeatableRead', timeout: 15000 },
      );
      const temporaryBackups = await tools.auditTemporaryBackups(now);
      let backup: {
        enabled: boolean;
        status: string;
        lastSuccessAt: string | null;
        worker: string;
      } | null = null;
      try {
        const schedule = (await this.schedule()) as {
          worker: string;
          jobs: {
            kind: string;
            enabled: boolean;
            status: string;
            lastSuccessAt: string | null;
          }[];
        };
        const item = schedule.jobs.find((row) => row.kind === 'backup');
        if (item)
          backup = {
            enabled: item.enabled,
            status: item.status,
            lastSuccessAt: item.lastSuccessAt,
            worker: schedule.worker,
          };
      } catch {}
      return {
        ...report,
        temporaryBackups,
        backup,
        unassessed: [
          'DIAGNOSTIC_FILES',
          'TRAINING_COPIES',
          'BROWSER_MEMORY',
          'OTHER_BACKUP_COPIES',
        ],
      };
    } catch {
      throw new ServiceUnavailableException(
        '개인정보 보관 현황을 집계하지 못했습니다. 잠시 후 다시 확인해 주세요.',
      );
    }
  }
  async schedule() {
    const configured = this.config.get<string>(
      'AURORE_COLLECTION_SCHEDULER_DIR',
    );
    if (configured && !isAbsolute(configured))
      throw new ServiceUnavailableException(
        '예약 수집 저장소 설정을 확인해 주세요.',
      );
    const directory =
      configured ||
      fileURLToPath(
        new URL('../../../local-dev/collection-scheduler/', import.meta.url),
      );
    try {
      const tool = (await import(
        new URL('../../tools/collection-scheduler.mjs', import.meta.url).href
      )) as { schedulerStatus: (directory: string) => Promise<unknown> };
      return await tool.schedulerStatus(directory);
    } catch {
      throw new ServiceUnavailableException(
        '예약 설정 또는 실행 기록을 확인해 주세요.',
      );
    }
  }
  private directory() {
    const configured = this.config.get<string>('AURORE_LAW_REFRESH_JOURNAL');
    if (configured && !isAbsolute(configured))
      throw new ServiceUnavailableException(
        '수집 기록 저장소 설정을 확인해 주세요.',
      );
    return (
      configured ||
      fileURLToPath(
        new URL('../../../local-dev/refresh-runs/', import.meta.url),
      )
    );
  }

  private async inbox() {
    const journal = this.directory();
    const tools = (await import(
      new URL('../../tools/list-law-refresh-reviews.mjs', import.meta.url).href
    )) as {
      listLawRefreshReviews: (
        database: {
          query: (
            sql: string,
            values: unknown[],
          ) => Promise<{ rows: unknown[] }>;
        },
        directory: string,
      ) => Promise<{ pending: Pending[] }>;
    };
    const resume = (await import(
      new URL('../../tools/resume-law-refresh.mjs', import.meta.url).href
    )) as {
      refreshJournalStatus: (directory: string) => Promise<State>;
    };
    const state = await resume.refreshJournalStatus(journal);
    const lock = (await import(
      new URL('../../tools/refresh-run-lock.mjs', import.meta.url).href
    )) as { refreshExecutionState: (directory: string) => Promise<Execution> };
    const execution = await lock.refreshExecutionState(journal);
    const pending = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const adapter = {
          query: async (sql: string, values: unknown[]) => {
            if (!/^\s*SELECT\b/i.test(sql))
              throw new Error('Only read queries are allowed.');
            return {
              rows: await tx.$queryRawUnsafe<unknown[]>(sql, ...values),
            };
          },
        };
        return (await tools.listLawRefreshReviews(adapter, journal)).pending;
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
    return { journal, state, pending, execution };
  }

  private async runs(journal: string, state: State) {
    if (!state.fromDate) return { items: [] as Run[], total: 0 };
    const names = (await readdir(journal))
      .filter((name) => /^\d{8}(?:\.failed-[0-9a-f-]{36})?\.json$/.test(name))
      .sort()
      .reverse();
    const failures = (await import(
      new URL('../../tools/refresh-failures.mjs', import.meta.url).href
    )) as {
      safeRefreshFailure: (value: unknown) => { code: string; message: string };
    };
    const completed: Run[] = [];
    // ponytail: the latest 100 journal records cover the single-machine beta; persist a paginated ledger when it outgrows this.
    for (const name of names.slice(0, 100)) {
      const target = join(journal, name);
      const record = JSON.parse(await readFile(target, 'utf8')) as {
        status?: string;
        code?: string;
        date?: string;
        attemptedAt?: string;
        report?: {
          date?: string;
          candidates?: unknown[];
          corrections?: unknown[];
          prepared?: { editions?: unknown[] };
        };
      };
      const failed = record.status === 'failed';
      if (!failed && record.status !== 'staged')
        throw new Error('Invalid journal record');
      const date = name.slice(0, 8);
      if (
        (failed ? record.date : record.report?.date) !== date ||
        date < state.fromDate
      )
        throw new Error('Invalid journal date');
      const recordedAt =
        failed &&
        record.attemptedAt &&
        Number.isFinite(Date.parse(record.attemptedAt))
          ? new Date(record.attemptedAt).toISOString()
          : (await stat(target)).mtime.toISOString();
      completed.push({
        id: createHash('sha256').update(name).digest('hex'),
        date,
        status: failed ? 'FAILED' : 'STAGED',
        errorCode: failed ? failures.safeRefreshFailure(record).code : null,
        recordedAt,
        candidates: record.report?.candidates?.length ?? 0,
        editions: record.report?.prepared?.editions?.length ?? 0,
        corrections: record.report?.corrections?.length ?? 0,
      });
    }
    completed.sort(
      (a, b) =>
        b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id),
    );
    return { items: completed, total: names.length };
  }

  async overview() {
    try {
      const { journal, state, pending, execution } = await this.inbox();
      const history = await this.runs(journal, state);
      const names = await this.db.legal.findMany({
        where: {
          srcCd: 'MOLEG',
          srcKey: { in: [...new Set(pending.map((item) => item.lawId))] },
          delYn: false,
        },
        select: { srcKey: true, legalNm: true },
      });
      const labels = new Map(names.map((row) => [row.srcKey, row.legalNm]));
      return {
        asOf: new Date().toISOString(),
        initialized: Boolean(state.fromDate),
        execution,
        ...state,
        summary: {
          runs: history.total,
          failures: history.items.filter((row) => row.status === 'FAILED')
            .length,
          pending: pending.length,
          corrections: pending.filter((row) => row.kind === 'correction')
            .length,
        },
        history: history.items,
        historyLimit: 100,
        pending: pending.map((item) => ({
          id: reviewId(item),
          kind: item.kind,
          date: item.date,
          lawId: item.lawId,
          lawName: labels.get(item.lawId) ?? null,
          versionKey: item.versionKey,
          effectiveDate: item.effectiveDate,
          status: item.status,
          canCompare:
            item.kind === 'correction' &&
            !['artifacts-missing', 'watch-inactive'].includes(item.status),
        })),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        '수집 기록을 확인하지 못했습니다. 저장소와 기록 상태를 확인해 주세요.',
      );
    }
  }

  async verifiedCorrection(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new NotFoundException('검토 대상을 찾을 수 없습니다.');
    let inbox: Awaited<ReturnType<AdminRefreshService['inbox']>>;
    try {
      inbox = await this.inbox();
    } catch {
      throw new ServiceUnavailableException('검토 목록을 확인하지 못했습니다.');
    }
    const item = inbox.pending.find(
      (row) => reviewId(row) === id && row.kind === 'correction',
    );
    if (!item)
      throw new NotFoundException('검토 대상이 없거나 이미 반영되었습니다.');
    if (['artifacts-missing', 'watch-inactive'].includes(item.status))
      throw new ConflictException(
        '원문 자료 또는 수집 대상 상태를 다시 확인해 주세요.',
      );
    try {
      const base = await realpath(inbox.journal);
      const target = await realpath(item.path);
      const local = relative(base, target);
      if (
        !local ||
        isAbsolute(local) ||
        local === '..' ||
        local.startsWith('..' + sep)
      )
        throw new Error('Outside journal');
      const entries = await readdir(dirname(target), { withFileTypes: true });
      if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()))
        throw new Error('Unexpected source entry');
      const tools = (await import(
        new URL('../../tools/check-law-correction.mjs', import.meta.url).href
      )) as { readCorrection: (path: string) => Promise<Correction> };
      const correction = await tools.readCorrection(target);
      if (
        correction.lawId !== item.lawId ||
        correction.versionKey !== item.versionKey ||
        correction.effectiveDate !== item.effectiveDate ||
        correction.beforeHash !== item.beforeHash ||
        correction.afterHash !== item.afterHash
      )
        throw new Error('Review changed');
      return { item, correction };
    } catch {
      throw new ConflictException(
        '원문 자료를 검증하지 못했습니다. 수집 자료와 비교 결과를 다시 준비해 주세요.',
      );
    }
  }

  async review(id: string, rawOffset = '0', rawLimit?: string) {
    if (!/^\d{1,6}$/.test(rawOffset))
      throw new BadRequestException('변경 목록 위치를 확인해 주세요.');
    const offset = Number(rawOffset);
    const limit = pageSize(rawLimit, 50);
    const { item, correction } = await this.verifiedCorrection(id);
    const law = await this.db.legal.findFirst({
      where: { srcCd: 'MOLEG', srcKey: item.lawId, delYn: false },
      select: { legalNm: true },
    });
    return {
      id,
      status: item.status,
      lawId: correction.lawId,
      lawName: law?.legalNm ?? null,
      versionKey: correction.versionKey,
      effectiveDate: correction.effectiveDate,
      beforeHash: correction.beforeHash,
      afterHash: correction.afterHash,
      totalChanges: correction.changes.length,
      offset,
      nextOffset:
        offset + limit < correction.changes.length ? offset + limit : null,
      changes: correction.changes
        .slice(offset, offset + limit)
        .map((change) => ({
          key: change.key,
          change: change.change,
          before: change.before
            ? {
                number: change.before.displayNumber,
                title: change.before.title ?? null,
                text: change.before.text,
              }
            : null,
          after: change.after
            ? {
                number: change.after.displayNumber,
                title: change.after.title ?? null,
                text: change.after.text,
              }
            : null,
        })),
    };
  }
}
