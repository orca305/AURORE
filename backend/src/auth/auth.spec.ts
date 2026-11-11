import { createHash, randomBytes } from 'node:crypto';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function database() {
  const db = {
    cmmnCd: { findFirst: vi.fn().mockResolvedValue({ id: 1n }) },
    appUser: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    userSess: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(
    (work: (tx: typeof db) => Promise<unknown>) => work(db),
  );
  return db;
}

it('ID·닉네임·비밀번호 규칙 위반과 흔한 비밀번호를 저장 전에 거부한다', async () => {
  const db = database();
  const auth = new AuthService(db as unknown as PrismaService);
  for (const values of [
    ['1test', '닉네임', '검증비밀번호12!'],
    ['test', '', '검증비밀번호12!'],
    ['test', '닉네임', '1234567'],
    ['test', '닉네임', 'password123'],
    ['K_user', '닉네임', '검증비밀번호12!'],
    [
      'test',
      '닉네임',
      'abcdefgh\\ud800'.replace('\\ud800', String.fromCharCode(0xd800)),
    ],
  ]) {
    await expect(
      auth.signup(values[0], values[1], values[2]),
    ).rejects.toHaveProperty('status', 400);
  }
  expect(db.$transaction).not.toHaveBeenCalled();
});

it('정규화와 Unicode 길이를 적용하고 초기 상태·학습 미동의를 같은 트랜잭션으로 저장한다', async () => {
  const db = database();
  const auth = new AuthService(db as unknown as PrismaService);
  await auth.signup('  TEST_USER ', '  한글회원 ', '🔑'.repeat(8));
  expect(db.$transaction).toHaveBeenCalledOnce();
  const data = db.appUser.create.mock.calls[0][0].data;
  expect(data).toMatchObject({
    loginId: 'test_user',
    nickNm: '한글회원',
    statuses: { create: { statCdId: 1n } },
    agreements: { create: { agrYn: false, polVer: '3.3' } },
  });
  expect(data.auth.create.pwSalt).toHaveLength(16);
  expect(data.auth.create.pwHash).toHaveLength(32);
  expect(data.auth.create).not.toHaveProperty('password');
});

it('존재하지 않는 계정의 로그인도 일반 인증 실패로 처리한다', async () => {
  const db = database();
  const auth = new AuthService(db as unknown as PrismaService);
  await expect(auth.login('missing', '검증비밀번호12!')).rejects.toHaveProperty(
    'status',
    401,
  );
});

it('조회는 세션 활동을 갱신하지 않고 만료 경계와 활성 회원 조건을 검사한다', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-11T00:00:00Z'));
  try {
    const db = database();
    const auth = new AuthService(db as unknown as PrismaService);
    const token = randomBytes(32).toString('base64url');
    await expect(auth.session(token, false)).rejects.toHaveProperty(
      'status',
      401,
    );
    expect(db.userSess.updateMany).not.toHaveBeenCalled();
    expect(db.userSess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: createHash('sha256').update(token).digest(),
          revokeDttm: null,
          rgstDttm: { gt: new Date('2026-11-04T00:00:00Z') },
          lastActDttm: { gt: new Date('2026-11-10T00:00:00Z') },
          user: expect.objectContaining({ delYn: false }),
        }),
      }),
    );
    await expect(auth.session(token, true)).rejects.toHaveProperty(
      'status',
      401,
    );
    expect(db.userSess.updateMany).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
  }
});

it('로그아웃은 현재 토큰 해시를 가진 세션만 취소한다', async () => {
  const db = database();
  const auth = new AuthService(db as unknown as PrismaService);
  const token = randomBytes(32).toString('base64url');
  await auth.logout(token);
  expect(db.userSess.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        tokenHash: createHash('sha256').update(token).digest(),
        revokeDttm: null,
      }),
    }),
  );
});
