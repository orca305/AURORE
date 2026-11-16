import { rename, symlink } from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AdminPrecedentService } from './admin-precedent.service.js';
import type { AdminGuard } from './admin.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !directory.includes('aurore-collection-admin-')
    )
      throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aurore-collection-admin-'));
  directories.push(root);
  const tools = (await import(
    new URL('../../tools/resume-precedent-collection.mjs', import.meta.url).href
  )) as {
    resumePrecedentCollection: (
      dir: string,
      options: unknown,
    ) => Promise<unknown>;
  };
  const directory = join(root, 'batch');
  const queue = Array.from({ length: 12 }, (_, i) => ({
    ID: String(i + 1),
    caseNumber: '2026다' + (i + 1),
  }));
  await tools.resumePrecedentCollection(directory, {
    queue,
    limit: 10,
    readSource: async (item: { ID: string; caseNumber: string }) => ({
      bytes: Buffer.from(
        JSON.stringify({
          PrecService: {
            판례정보일련번호: item.ID,
            사건번호: item.caseNumber,
            사건명: '가상 판례',
            법원명: '대법원',
            선고일자: '20260101',
            판시사항: '가상 쟁점',
            판례내용: '원문<br/>둘째 줄',
            private: 'PRIVATE_COLLECTION_CANARY',
          },
        }),
      ),
    }),
  });
  let stored: unknown = null,
    current: unknown = null;
  const db = {
    legalPrec: { findFirst: vi.fn(async () => stored) },
    legalPrecRev: { findFirst: vi.fn(async () => current) },
  };
  const service = new AdminPrecedentService(
    db as unknown as PrismaService,
    {} as AdminGuard,
    new ConfigService({ AURORE_PRECEDENT_COLLECTION_ROOT: root }),
  );
  return {
    root,
    directory,
    service,
    db,
    setStored: (value: unknown) => {
      stored = value;
    },
    setCurrent: (value: unknown) => {
      current = value;
    },
  };
}
it('paginates candidate records and exposes only verified public source fields', async () => {
  const { service, root, db } = await fixture();
  const list = await service.collections('0', '10');
  expect(list.total).toBe(1);
  expect(list.items[0]).toMatchObject({
    total: 12,
    collected: 10,
    remaining: 2,
    available: true,
  });
  const id = list.items[0].id,
    first = await service.collection(id, '0', '10'),
    second = await service.collection(id, '10', '10');
  expect(first.items).toHaveLength(10);
  expect(first.nextOffset).toBe(10);
  expect(second.items).toHaveLength(2);
  expect(second.items.every((row) => !row.ready)).toBe(true);
  const detail = await service.collectedPrecedent(id, '1');
  expect(detail.status).toBe('NEW');
  expect(detail.candidate.decision).toBe('원문<br/>둘째 줄');
  expect(detail.current).toBeNull();
  const serialized = JSON.stringify({ list, first, detail });
  expect(serialized).not.toContain(root);
  expect(serialized).not.toContain('PRIVATE_COLLECTION_CANARY');
  expect(serialized).not.toContain('snapshots');
  expect(serialized).not.toContain('token');
  expect(db.legalPrec.findFirst).toHaveBeenCalledWith({
    where: { srcCd: 'MOLEG', srcKey: '1' },
    select: { id: true, delYn: true },
  });
  await expect(service.collectedPrecedent(id, '12')).rejects.toMatchObject({
    status: 409,
  });
  await expect(service.collectedPrecedent(id, '99')).rejects.toMatchObject({
    status: 404,
  });
  await expect(service.collection('../escape')).rejects.toMatchObject({
    status: 404,
  });
  await expect(service.collections('0', '100')).rejects.toMatchObject({
    status: 400,
  });
});
it('compares stored hashes without republishing deleted precedents', async () => {
  const { service, directory, db, setStored, setCurrent } = await fixture();
  const id = (await service.collections()).items[0].id;
  const saved = JSON.parse(
    await readFile(join(directory, '1.json'), 'utf8'),
  ) as { hash: string };
  setStored({ id: 1n, delYn: false });
  const current = {
    caseNm: '기존 판례',
    caseNo: '2026다1',
    courtNm: '대법원',
    decisionDt: new Date('2026-01-01'),
    issueCont: null,
    summaryCont: null,
    decisionCont: '기존 원문',
    snapshot: { contHash: saved.hash },
  };
  setCurrent(current);
  expect((await service.collectedPrecedent(id, '1')).status).toBe('SAME');
  setCurrent({ ...current, snapshot: { contHash: 'f'.repeat(64) } });
  expect((await service.collectedPrecedent(id, '1')).status).toBe('DIFFERENT');
  setStored({ id: 1n, delYn: true });
  db.legalPrecRev.findFirst.mockClear();
  expect((await service.collectedPrecedent(id, '1')).status).toBe('DELETED');
  expect(db.legalPrecRev.findFirst).not.toHaveBeenCalled();
});
it('fails closed for modified snapshots and leaves malformed batches visible without raw diagnostics', async () => {
  const { service, directory } = await fixture();
  const id = (await service.collections()).items[0].id;
  const snapshots = join(directory, 'snapshots'),
    file = (await readdir(snapshots))[0];
  await writeFile(join(snapshots, file), 'PRIVATE_CORRUPTION');
  expect((await service.collections()).items[0].available).toBe(false);
  await expect(service.collection(id)).rejects.toMatchObject({ status: 503 });
  await expect(service.collectedPrecedent(id, '1')).rejects.toMatchObject({
    status: 503,
  });
});

it('rejects a snapshot directory redirected outside its collection', async () => {
  const { root, directory, service } = await fixture();
  const id = (await service.collections()).items[0].id;
  const snapshots = join(directory, 'snapshots'),
    outside = join(root, 'outside');
  await rename(snapshots, outside);
  await symlink(outside, snapshots, 'junction');
  expect((await service.collections()).items[0].available).toBe(false);
  await expect(service.collectedPrecedent(id, '1')).rejects.toMatchObject({
    status: 503,
  });
});
