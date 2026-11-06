import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { LegalService } from './legal.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ListLegalsDto } from './dto/list-legals.dto.js';

it('이전 데이터·시퀀스를 보존하고 코드·조문 제약과 삭제 비노출을 적용한다', async () => {
  // 기존 DATABASE_URL을 읽지 않는 메모리 DB다. 실제 PostgreSQL 17 배포 검증은 별도다.
  const db = new PGlite();
  try {
    const oldMigration = await readFile(
      new URL(
        '../../prisma/migrations/20260921044321_init_law/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261105000000_aurore_foundation/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.exec(oldMigration);
    await db.exec(
      "INSERT INTO laws (law_id, law_name, created_at, updated_at) VALUES ('0001', '기존법', '2026-01-02 03:04:05', '2026-02-03 04:05:06')",
    );
    await db.exec(migration);
    const kept = await db.query<{
      id: number;
      src_key: string;
      legal_nm: string;
      src_cd: string;
      rgst_dttm: Date;
    }>('SELECT * FROM legal');
    expect(kept.rows[0]).toMatchObject({
      id: 1,
      src_key: '0001',
      legal_nm: '기존법',
      src_cd: 'LEGACY',
    });
    expect(new Date(kept.rows[0].rgst_dttm).toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    const next = await db.query<{ id: number }>(
      "INSERT INTO legal (src_key, legal_nm) VALUES ('0002', '다음법') RETURNING id",
    );
    expect(next.rows[0].id).toBe(2);
    expect((await db.query('SELECT * FROM cmmn_cd')).rows).toHaveLength(9);
    expect((await db.query('SELECT * FROM cmmn_cd_hist')).rows).toHaveLength(9);
    await expect(
      db.exec(
        "INSERT INTO cmmn_cd (cd, cd_nm, node_type_cd) VALUES ('AURORE', '중복', 'ROOT')",
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.exec("INSERT INTO legal (src_key, legal_nm) VALUES ('0001', '중복')"),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.exec('UPDATE legal SET del_yn = true WHERE id = 1'),
    ).rejects.toMatchObject({ code: '23514' });

    await db.exec(
      "INSERT INTO legal_ver (legal_id, ver_key) VALUES (1, 'v1'), (1, 'v2')",
    );
    await db.exec(
      "INSERT INTO legal_provi (legal_ver_id, provi_type_cd, disp_no, sort_seq, provi_cont) VALUES (1, 'ARTICLE', '제10조의2', 1, '원문')",
    );
    await db.exec(
      "INSERT INTO legal_provi (legal_ver_id, prnt_provi_id, provi_type_cd, disp_no, sort_seq, provi_cont) VALUES (1, 1, 'PARAGRAPH', '①', 2, '항 원문')",
    );
    await expect(
      db.exec(
        "INSERT INTO legal_provi (legal_ver_id, prnt_provi_id, provi_type_cd, disp_no, sort_seq, provi_cont) VALUES (2, 1, 'PARAGRAPH', '①', 1, '다른 버전')",
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const prisma = {
      legalVer: { findFirst: async () => ({ id: 1n }) },
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const sql = strings.reduce(
          (text, part, index) => text + (index ? `$${index}` : '') + part,
          '',
        );
        const result = await db.query<Record<string, unknown>>(sql, values);
        return result.rows.map((row) => ({
          ...row,
          id: BigInt(row.id as number),
          prntProviId:
            row.prntProviId == null ? null : BigInt(row.prntProviId as number),
        }));
      },
    } as unknown as PrismaService;
    const service = new LegalService(prisma);
    const before = await service.provisions(1n, 1n, new ListLegalsDto());
    expect(before.map((row) => row.dispNo)).toEqual(['제10조의2', '①']);
    await db.exec(
      'UPDATE legal_provi SET del_yn = true, del_dttm = now() WHERE id = 1',
    );
    expect(await service.provisions(1n, 1n, new ListLegalsDto())).toEqual([]);
    // 부모 법규가 삭제되면 남아 있는 조문도 조회할 수 없다.
    await db.exec(
      'UPDATE legal SET del_yn = true, del_dttm = now() WHERE id = 1',
    );
    expect(await service.provisions(1n, 1n, new ListLegalsDto())).toEqual([]);
  } finally {
    await db.close();
  }
}, 30000);
