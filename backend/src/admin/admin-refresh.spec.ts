import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AdminRefreshService } from './admin-refresh.service.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('aurore-admin-refresh-')
    )
      throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true });
  }
});

async function fixture(count = 1) {
  const journal = await mkdtemp(join(tmpdir(), 'aurore-admin-refresh-'));
  directories.push(journal);
  const artifacts = join(journal, 'correction');
  await mkdir(artifacts);
  const payload = (text: string) => ({
    법령: {
      법령키: 'test-version',
      기본정보: {
        법령ID: '001248',
        법령명_한글: '검증 법령',
        시행일자: '20260102',
        공포일자: '20251201',
      },
      조문: {
        조문단위: Array.from({ length: count }, (_, index) => ({
          조문번호: String(index + 1),
          조문여부: '조문',
          조문제목: '검증',
          조문내용: `제${index + 1}조  ${text}\n 원형 보존`,
        })),
      },
    },
  });
  const before = JSON.stringify(payload('정정 전 원문'));
  const after = JSON.stringify(payload('정정 후 원문'));
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const beforeHash = hash(before),
    afterHash = hash(after);
  await writeFile(join(artifacts, beforeHash + '.json'), before);
  await writeFile(join(artifacts, afterHash + '.json'), after);
  const evidence = (await import(
    new URL('../../tools/law-evidence.mjs', import.meta.url).href
  )) as {
    loadEvidence: (path: string) => Promise<{ chunks: { hash: string }[] }>;
  };
  const comparison = (await import(
    new URL('../../tools/review-law-corrections.mjs', import.meta.url).href
  )) as {
    compareProvisions: (before: unknown[], after: unknown[]) => unknown[];
  };
  const { chunks } = await evidence.loadEvidence(artifacts);
  const report = {
    lawId: '001248',
    mst: '123456',
    effectiveDate: '2026-01-02',
    versionKey: 'test-version',
    beforeHash,
    afterHash,
    status: 'provision-changes',
    sourceSectionsChanged: ['조문'],
    changes: comparison.compareProvisions(
      chunks.filter((row) => row.hash === beforeHash),
      chunks.filter((row) => row.hash === afterHash),
    ),
  };
  const reportPath = join(artifacts, 'review.json');
  await writeFile(reportPath, JSON.stringify(report));
  await writeFile(
    join(journal, 'start.json'),
    JSON.stringify({ fromDate: '20261109' }),
  );
  await writeFile(
    join(journal, '20261109.json'),
    JSON.stringify({
      status: 'staged',
      report: {
        date: '20261109',
        candidates: [],
        prepared: { editions: [] },
        corrections: [{ ...report, reportPath }],
      },
    }),
  );
  await writeFile(
    join(journal, `20261110.failed-${randomUUID()}.json`),
    JSON.stringify({
      status: 'failed',
      date: '20261110',
      attemptedAt: '2026-11-10T01:02:03Z',
      message: 'OC=SYNTHETIC_SECRET C:/private/path',
    }),
  );
  const query = vi.fn().mockResolvedValue([
    {
      edition_id: 1,
      del_yn: false,
      law_deleted: false,
      current_hash: beforeHash,
      applied: false,
    },
  ]);
  const execute = vi.fn();
  const db = {
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({ $queryRawUnsafe: query, $executeRaw: execute }),
    ),
    legal: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ srcKey: '001248', legalNm: '검증 법령' }]),
      findFirst: vi.fn().mockResolvedValue({ legalNm: '검증 법령' }),
    },
  };
  const service = new AdminRefreshService(
    db as unknown as PrismaService,
    new ConfigService({ AURORE_LAW_REFRESH_JOURNAL: journal }),
  );
  return {
    journal,
    artifacts,
    reportPath,
    beforeHash,
    afterHash,
    query,
    execute,
    service,
  };
}

it('수집 기록이 없으면 정상 빈 상태로 응답하고 잘못된 저장소 설정을 거부한다', async () => {
  const { journal, service } = await fixture();
  await rm(join(journal, 'start.json'));
  const result = await service.overview();
  expect(result.initialized).toBe(false);
  expect(result.history).toEqual([]);
  expect(result.pending).toEqual([]);
  const broken = new AdminRefreshService(
    {} as PrismaService,
    new ConfigService({ AURORE_LAW_REFRESH_JOURNAL: 'relative/path' }),
  );
  await expect(broken.overview()).rejects.toHaveProperty('status', 503);
});

it('기록과 검토 상태를 연결하고 서버 경로·실패 원문을 숨기며 검증된 원문만 비교한다', async () => {
  const { service, execute, reportPath, artifacts, afterHash } =
    await fixture();
  const result = await service.overview();
  expect(result.summary).toEqual({
    runs: 2,
    failures: 1,
    pending: 1,
    corrections: 1,
  });
  expect(result.pending[0]).toMatchObject({
    lawName: '검증 법령',
    status: 'ready-to-review',
    canCompare: true,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /SYNTHETIC_SECRET|private|reportPath|[A-Z]:\\/,
  );
  expect(result).not.toHaveProperty('journal');
  expect(result.pending[0]).not.toHaveProperty('path');
  expect(execute).toHaveBeenCalled();
  const id = result.pending[0].id;
  const review = await service.review(id);
  expect(review.changes[0].before?.text).toContain(
    '  정정 전 원문\n 원형 보존',
  );
  expect(review.changes[0].after?.text).toContain('  정정 후 원문\n 원형 보존');
  await expect(service.review('../outside')).rejects.toHaveProperty(
    'status',
    404,
  );
  await expect(service.review(id, '-1')).rejects.toHaveProperty('status', 400);
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    changes: unknown[];
  };
  const original = await readFile(reportPath, 'utf8');
  report.changes = [];
  await writeFile(reportPath, JSON.stringify(report));
  await expect(service.review(id)).rejects.toHaveProperty('status', 409);
  await writeFile(reportPath, original);
  await writeFile(join(artifacts, afterHash + '.json'), 'tampered source');
  await expect(service.review(id)).rejects.toHaveProperty('status', 409);
});

it('변경 조문을 50개씩 제공하고 이미 반영된 정정이나 낡은 검토 기준을 구분한다', async () => {
  const { service, query } = await fixture(51);
  const id = (await service.overview()).pending[0].id;
  const first = await service.review(id);
  expect(first.totalChanges).toBe(51);
  expect(first.changes).toHaveLength(50);
  expect(first.nextOffset).toBe(50);
  const next = await service.review(id, '50');
  expect(next.changes).toHaveLength(1);
  expect(next.nextOffset).toBeNull();
  query.mockResolvedValue([
    {
      edition_id: 1,
      del_yn: false,
      law_deleted: false,
      current_hash: 'c'.repeat(64),
      applied: false,
    },
  ]);
  expect((await service.review(id)).status).toBe('stale-review');
  query.mockResolvedValue([{ applied: true }]);
  await expect(service.review(id)).rejects.toHaveProperty('status', 404);
});

it('수집 점유 상태와 안전한 실패 코드만 노출한다', async () => {
  const { journal, service } = await fixture();
  await writeFile(
    join(journal, 'run.lock.json'),
    JSON.stringify({
      pid: process.pid,
      host: hostname(),
      token: randomUUID(),
      startedAt: new Date().toISOString(),
    }),
  );
  const result = await service.overview();
  expect(result.execution.status).toBe('RUNNING');
  expect(result.history.find((row) => row.status === 'FAILED')?.errorCode).toBe(
    'STAGING_FAILED',
  );
  expect(JSON.stringify(result)).not.toMatch(
    /SYNTHETIC_SECRET|"pid"|"host"|"token"|reportPath/,
  );
});
