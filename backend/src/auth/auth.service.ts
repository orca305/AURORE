import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type ChatOwner = {
  userId: bigint | null;
  guestSessId: string | null;
  authHash: Buffer<ArrayBuffer>;
  expiresAt: Date | null;
};

const hour = 60 * 60 * 1000;
const dummySalt = randomBytes(16);
const dummyHash = randomBytes(32);
const commonPasswords = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  'qwertyuiop',
  'qwerty123',
  'qwerty1234',
  'abc12345',
  'iloveyou',
  'letmein123',
  'admin123',
  'welcome1',
  '11111111',
  '00000000',
  '1q2w3e4r',
  '1q2w3e4r!',
  'asdf1234',
  'asdfghjkl',
]);
const root = { cd: 'AURORE', nodeTypeCd: 'ROOT', delYn: false, useYn: true };
const activeStatus = {
  cd: 'ACTIVE',
  delYn: false,
  useYn: true,
  parent: { cd: 'USER_STAT', delYn: false, useYn: true, parent: root },
} satisfies Prisma.CmmnCdWhereInput;
const activeUser = {
  delYn: false,
  status: activeStatus,
} satisfies Prisma.AppUserWhereInput;
const learningCategory = {
  cd: 'LEARNING',
  delYn: false,
  useYn: true,
  parent: {
    cd: 'USER_AGR',
    delYn: false,
    useYn: true,
    parent: { ...root, prntCdId: null },
  },
} satisfies Prisma.CmmnCdWhereInput;
const idPattern = /^[a-z][a-z0-9_]{3,11}$/;

function passwordHash(password: string, salt: Uint8Array) {
  return new Promise<Buffer<ArrayBuffer>>((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 ** 2 },
      (error, hash) => {
        if (error) reject(error);
        else resolve(Buffer.from(hash));
      },
    );
  });
}

function normalizeLoginId(value: string) {
  return value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function validPasswordLength(password: string) {
  const length = Array.from(password).length;
  return !/\p{Surrogate}/u.test(password) && length >= 8 && length <= 16;
}

function validateNewPassword(
  password: string,
  loginId: string,
  nickNm: string,
) {
  if (!validPasswordLength(password)) {
    throw new BadRequestException('비밀번호는 8~16자여야 합니다.');
  }
  const comparison = password.trim().toLowerCase();
  if (
    commonPasswords.has(comparison) ||
    comparison === loginId ||
    comparison === nickNm.toLowerCase()
  ) {
    throw new BadRequestException(
      '쉽게 추측할 수 있는 비밀번호입니다. 다른 비밀번호를 입력해 주세요.',
    );
  }
}

function sessionHash(token: string) {
  return createHash('sha256').update(token).digest();
}

function nowAtSecond() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

@Injectable()
export class AuthService {
  // ponytail: one-process dev throttle; use a shared limiter before multi-instance deployment.
  private readonly attempts = new Map<string, number>();
  private windowEnd = 0;
  private inFlight = 0;

  constructor(private readonly db: PrismaService) {}

  private async limit<T>(
    key: string,
    work: () => Promise<T>,
    maximum = 8,
  ): Promise<T> {
    if (Date.now() >= this.windowEnd) {
      this.attempts.clear();
      this.windowEnd = Date.now() + 60_000;
    }
    const count = this.attempts.get(key) ?? 0;
    if (
      count >= maximum ||
      this.inFlight >= 2 ||
      (!count && this.attempts.size >= 120)
    ) {
      throw new HttpException(
        '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.attempts.set(key, count + 1);
    this.inFlight += 1;
    try {
      return await work();
    } finally {
      this.inFlight -= 1;
    }
  }

  async signup(rawId: string, rawNickname: string, rawPassword: string) {
    const loginId = normalizeLoginId(rawId);
    const nickNm = rawNickname.trim().normalize('NFC');
    const password = rawPassword.normalize('NFC');
    if (!idPattern.test(loginId)) {
      throw new BadRequestException(
        '아이디는 영문으로 시작하고 영문·숫자·밑줄로 4~12자여야 합니다.',
      );
    }
    if (!/^[\p{Script=Hangul}A-Za-z0-9_ ]{2,12}$/u.test(nickNm)) {
      throw new BadRequestException(
        '닉네임은 한글·영문·숫자·밑줄·내부 공백으로 2~12자여야 합니다.',
      );
    }
    validateNewPassword(password, loginId, nickNm);

    await this.limit('signup:' + loginId, async () => {
      const pwSalt = randomBytes(16);
      const pwHash = await passwordHash(password, pwSalt);
      try {
        await this.db.$transaction(async (tx) => {
          const [status, learning] = await Promise.all([
            tx.cmmnCd.findFirst({ where: activeStatus, select: { id: true } }),
            tx.cmmnCd.findFirst({
              where: {
                cd: 'LEARNING',
                delYn: false,
                useYn: true,
                parent: {
                  cd: 'USER_AGR',
                  delYn: false,
                  useYn: true,
                  parent: root,
                },
              },
              select: { id: true },
            }),
          ]);
          if (!status || !learning) throw new ServiceUnavailableException();
          const registeredAt = nowAtSecond();
          await tx.appUser.create({
            data: {
              rgstDttm: registeredAt,
              uptDttm: registeredAt,
              loginId,
              nickNm,
              statCdId: status.id,
              auth: { create: { pwSalt, pwHash } },
              statuses: {
                create: { statCdId: status.id, rgstDttm: registeredAt },
              },
              agreements: {
                create: {
                  agrCdId: learning.id,
                  agrYn: false,
                  polVer: '3.3',
                  rgstDttm: registeredAt,
                },
              },
            },
          });
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('이미 사용 중인 아이디입니다.');
        }
        throw error;
      }
    });
  }

  async login(rawId: string, rawPassword: string) {
    const loginId = normalizeLoginId(rawId);
    const password = rawPassword.normalize('NFC');
    const invalid = () =>
      new UnauthorizedException('아이디 또는 비밀번호를 확인해 주세요.');
    if (!idPattern.test(loginId) || !validPasswordLength(password))
      throw invalid();

    return this.limit('login:' + loginId, async () => {
      const user = await this.db.appUser.findFirst({
        where: { loginId, ...activeUser },
        select: {
          id: true,
          statCdId: true,
          auth: { select: { pwSalt: true, pwHash: true } },
        },
      });
      const digest = await passwordHash(
        password,
        user?.auth?.pwSalt ?? dummySalt,
      );
      if (
        !timingSafeEqual(digest, user?.auth?.pwHash ?? dummyHash) ||
        !user?.auth
      )
        throw invalid();
      const { id, statCdId, auth } = user;

      const token = randomBytes(32).toString('base64url');
      await this.db.$transaction(async (tx) => {
        const current = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT u.id
          FROM app_user u JOIN user_auth a ON a.user_id = u.id
          WHERE u.id = ${id} AND u.login_id = ${loginId} AND NOT u.del_yn
            AND u.stat_cd_id = ${statCdId} AND a.pw_hash = ${auth.pwHash}
            AND a.pw_salt = ${auth.pwSalt}
          FOR UPDATE OF u, a
        `;
        if (!current.length) throw invalid();
        const now = nowAtSecond();
        await tx.userSess.create({
          data: {
            tokenHash: sessionHash(token),
            userId: id,
            rgstDttm: now,
            lastActDttm: now,
          },
        });
      });
      return { token };
    });
  }

  async session(token: string, activity: boolean) {
    const now = nowAtSecond();
    const where = {
      tokenHash: sessionHash(token),
      revokeDttm: null,
      rgstDttm: { gt: new Date(now.getTime() - 168 * hour) },
      lastActDttm: { gt: new Date(now.getTime() - 24 * hour) },
      user: activeUser,
    } satisfies Prisma.UserSessWhereInput;
    if (activity) {
      await this.db.userSess.updateMany({
        where: { ...where, lastActDttm: { ...where.lastActDttm, lt: now } },
        data: { lastActDttm: now },
      });
    }
    const session = await this.db.userSess.findFirst({
      where,
      select: { user: { select: { id: true, loginId: true, nickNm: true } } },
    });
    if (!session) throw new UnauthorizedException('로그인이 필요합니다.');
    return {
      id: session.user.id.toString(),
      loginId: session.user.loginId,
      nickname: session.user.nickNm,
    };
  }

  async createGuest() {
    return this.limit(
      'guest-create',
      async () => {
        const token = randomBytes(32).toString('base64url');
        const rows = await this.db.$queryRaw<{ expiresAt: Date }[]>`
        INSERT INTO guest_sess (id, token_hash, rgst_dttm, last_act_dttm, expr_dttm)
        VALUES (${randomUUID()}::uuid, ${sessionHash(token)},
          date_trunc('second', now()), date_trunc('second', now()),
          ((date_trunc('second', now()) AT TIME ZONE 'Asia/Seoul') + interval '1 month') AT TIME ZONE 'Asia/Seoul')
        RETURNING expr_dttm AS "expiresAt"
      `;
        return { token, expiresAt: rows[0].expiresAt.toISOString() };
      },
      60,
    );
  }

  async resolveOwner(
    authorization: string | undefined,
    activity = false,
  ): Promise<ChatOwner> {
    const match = /^(Bearer|Guest) ([A-Za-z0-9_-]{43})$/.exec(
      authorization ?? '',
    );
    if (!match) throw new UnauthorizedException('인증이 필요합니다.');
    const [, kind, token] = match;
    const authHash = sessionHash(token);
    if (kind === 'Bearer') {
      const user = await this.session(token, activity);
      return {
        userId: BigInt(user.id),
        guestSessId: null,
        authHash,
        expiresAt: null,
      };
    }
    if (activity) {
      await this.db.$executeRaw`
        UPDATE guest_sess SET last_act_dttm = GREATEST(last_act_dttm, date_trunc('second', now())),
          expr_dttm = GREATEST(expr_dttm, ((date_trunc('second', now()) AT TIME ZONE 'Asia/Seoul') + interval '1 month') AT TIME ZONE 'Asia/Seoul')
        WHERE token_hash = ${authHash} AND expr_dttm > now()
      `;
    }
    const guest = await this.db.guestSess.findFirst({
      where: { tokenHash: authHash, exprDttm: { gt: new Date() } },
      select: { id: true, exprDttm: true },
    });
    if (!guest) throw new UnauthorizedException('인증이 만료되었습니다.');
    return {
      userId: null,
      guestSessId: guest.id,
      authHash,
      expiresAt: guest.exprDttm,
    };
  }

  async ownerIsActive(
    userId: bigint | null,
    guestSessId: string | null,
    authHash: Uint8Array<ArrayBuffer>,
    database: Prisma.TransactionClient = this.db,
  ) {
    const now = nowAtSecond();
    if (userId !== null) {
      // Keep the same user-before-session lock order as credential changes.
      await database.$queryRaw`SELECT id FROM app_user WHERE id = ${userId} FOR SHARE`;
      await database.$queryRaw`SELECT token_hash FROM user_sess WHERE token_hash = ${authHash} AND user_id = ${userId} FOR SHARE`;
      return Boolean(
        await database.userSess.findFirst({
          where: {
            tokenHash: authHash,
            userId,
            revokeDttm: null,
            rgstDttm: { gt: new Date(now.getTime() - 168 * hour) },
            lastActDttm: { gt: new Date(now.getTime() - 24 * hour) },
            user: activeUser,
          },
          select: { userId: true },
        }),
      );
    }
    await database.$queryRaw`SELECT id FROM guest_sess WHERE id = ${guestSessId}::uuid FOR SHARE`;
    return Boolean(
      await database.guestSess.findFirst({
        where: {
          id: guestSessId ?? '',
          tokenHash: authHash,
          exprDttm: { gt: now },
        },
        select: { id: true },
      }),
    );
  }

  async changePassword(token: string, rawCurrent: string, rawNew: string) {
    const member = await this.session(token, false);
    const userId = BigInt(member.id);
    const currentPassword = rawCurrent.normalize('NFC');
    const newPassword = rawNew.normalize('NFC');
    validateNewPassword(newPassword, member.loginId, member.nickname);
    if (!validPasswordLength(currentPassword))
      throw new BadRequestException('현재 비밀번호를 확인해 주세요.');
    if (currentPassword === newPassword)
      throw new BadRequestException(
        '현재 비밀번호와 다른 비밀번호를 입력해 주세요.',
      );

    await this.limit('password:' + member.id, async () => {
      const auth = await this.db.userAuth.findUnique({ where: { userId } });
      const digest = await passwordHash(
        currentPassword,
        auth?.pwSalt ?? dummySalt,
      );
      if (!auth || !timingSafeEqual(digest, auth.pwHash))
        throw new BadRequestException('현재 비밀번호를 확인해 주세요.');
      const pwSalt = randomBytes(16);
      const pwHash = await passwordHash(newPassword, pwSalt);
      await this.db.$transaction(async (tx) => {
        // Serialize against login and other credential changes before revoking sessions.
        const current = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT u.id FROM app_user u JOIN user_auth a ON a.user_id = u.id
          WHERE u.id = ${userId} AND a.pw_hash = ${auth.pwHash} AND a.pw_salt = ${auth.pwSalt}
          FOR UPDATE OF u, a
        `;
        if (
          !current.length ||
          !(await this.ownerIsActive(userId, null, sessionHash(token), tx))
        )
          throw new UnauthorizedException('로그인이 필요합니다.');
        await tx.userAuth.update({
          where: { userId },
          data: { pwSalt, pwHash },
        });
        await tx.userSess.updateMany({
          where: { userId, revokeDttm: null },
          data: { revokeDttm: nowAtSecond() },
        });
      });
    });
  }

  async learningConsent(token: string, limit = 20, offset = 0) {
    const member = await this.session(token, false),
      userId = BigInt(member.id);
    return this.db.$transaction(
      async (tx) => {
        if (!(await this.ownerIsActive(userId, null, sessionHash(token), tx)))
          throw new UnauthorizedException('다시 로그인해 주세요.');
        if(!(await tx.cmmnCd.count({where:learningCategory})))throw new ServiceUnavailableException('학습 활용 동의 설정을 확인해 주세요.');
      const now = nowAtSecond(),
          where = {
            userId,
            category: learningCategory,
            rgstDttm: { lte: now },
          };
        const latest = await tx.userAgrYnHist.findFirst({
          where,
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
        });
        const total = await tx.userAgrYnHist.count({ where });
        const rows = await tx.userAgrYnHist.findMany({
          where,
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
          select: { id: true, agrYn: true, polVer: true, rgstDttm: true },
        });
        return {
          agreed: latest?.agrYn ?? false,
          revision: latest ? String(latest.id) : '0',
          policyVersion: '3.3',
          total,
          limit,
          offset,
          nextOffset:
            offset + limit < total && offset < 100000
              ? Math.min(offset + limit, 100000)
              : null,
          history: rows.map((h) => ({
            id: String(h.id),
            agreed: h.agrYn,
            policyVersion: h.polVer,
            recordedAt: h.rgstDttm.toISOString(),
          })),
          learningPipelineAvailable: false,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async setLearningConsent(token: string, agreed: boolean, revision: string) {
    const member = await this.session(token, false),
      userId = BigInt(member.id);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM app_user WHERE id=${userId} FOR UPDATE`;
        if (!(await this.ownerIsActive(userId, null, sessionHash(token), tx)))
          throw new UnauthorizedException('다시 로그인해 주세요.');
        const code = await tx.cmmnCd.findFirst({
          where: learningCategory,
          select: {
            id: true,
            prntCdId: true,
            parent: { select: { prntCdId: true } },
          },
        });
        if (!code)
          throw new ServiceUnavailableException(
            '학습 활용 동의 설정을 확인해 주세요.',
          );
        await tx.$queryRaw`SELECT id FROM cmmn_cd WHERE id IN (${code.id},${code.prntCdId},${code.parent!.prntCdId}) ORDER BY id FOR SHARE`;
        if (
          !(await tx.cmmnCd.count({
            where: { ...learningCategory, id: code.id },
          }))
        )
          throw new ServiceUnavailableException(
            '학습 활용 동의 설정을 확인해 주세요.',
          );
        const now = nowAtSecond();
        if (
          await tx.userAgrYnHist.count({
            where: { userId, agrCdId: code.id, rgstDttm: { gt: now } },
          })
        )
          throw new ConflictException(
            '동의 기록 시각을 확인하지 못했습니다. 잠시 후 새로고침해 주세요.',
          );
        const latest = await tx.userAgrYnHist.findFirst({
          where: { userId, agrCdId: code.id },
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
        });
        if ((latest ? String(latest.id) : '0') !== revision)
          throw new ConflictException(
            '다른 화면에서 동의 선택이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
          );
        if (latest?.agrYn === agreed && latest.polVer === '3.3')
          return { agreed, revision: String(latest.id), changed: false };
        const row = await tx.userAgrYnHist.create({
          data: {
            userId,
            agrCdId: code.id,
            agrYn: agreed,
            polVer: '3.3',
            rgstDttm: now,
          },
          select: { id: true },
        });
        return { agreed, revision: String(row.id), changed: true };
      },
      { timeout: 15000 },
    );
  }

  async withdrawalPreview(token: string) {
    const member = await this.session(token, false),
      userId = BigInt(member.id);
    return this.db.$transaction(
      async (tx) => {
        if (!(await this.ownerIsActive(userId, null, sessionHash(token), tx)))
          throw new UnauthorizedException('다시 로그인해 주세요.');
        const [chats, cases, documents, bookmarks, notifications] =
          await Promise.all([
            tx.chatSess.count({ where: { userId, delYn: false } }),
            tx.userCase.count({ where: { userId, delYn: false } }),
            tx.attachDoc.count({ where: { userId, delYn: false } }),
            tx.userBmark.count({ where: { userId, delYn: false } }),
            tx.userNtf.count({ where: { userId, delYn: false } }),
          ]);
        return {
          counts: { chats, cases, documents, bookmarks, notifications },
          purgeCompleted: false,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async withdraw(token: string, rawPassword: string) {
    const member = await this.session(token, false),
      userId = BigInt(member.id);
    const password = rawPassword.normalize('NFC');
    if (!validPasswordLength(password))
      throw new BadRequestException('현재 비밀번호를 확인해 주세요.');
    await this.limit('withdrawal:' + member.id, async () => {
      const auth = await this.db.userAuth.findUnique({ where: { userId } });
      const digest = await passwordHash(password, auth?.pwSalt ?? dummySalt);
      if (!auth || !timingSafeEqual(digest, auth.pwHash))
        throw new BadRequestException('현재 비밀번호를 확인해 주세요.');
      await this.db.$transaction(
        async (tx) => {
          // Same serialization as administrator status changes; never leave the service without an active administrator.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-member-status'))`;
          const locked = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT u.id FROM app_user u JOIN user_auth a ON a.user_id=u.id
          WHERE u.id=${userId} AND a.pw_hash=${auth.pwHash} AND a.pw_salt=${auth.pwSalt} FOR UPDATE OF u,a`;
          if (
            !locked.length ||
            !(await this.ownerIsActive(userId, null, sessionHash(token), tx))
          )
            throw new UnauthorizedException('다시 로그인해 주세요.');
          const role = {
            delYn: false,
            role: {
              cd: 'ADMIN',
              nodeTypeCd: 'VALUE',
              delYn: false,
              useYn: true,
              parent: {
                cd: 'USER_ROLE',
                nodeTypeCd: 'GROUP',
                delYn: false,
                useYn: true,
                parent: { ...root, prntCdId: null },
              },
            },
          } satisfies Prisma.UserRoleWhereInput;
          if (await tx.userRole.count({ where: { ...role, userId } })) {
            const others = await tx.appUser.count({
              where: {
                ...activeUser,
                id: { not: userId },
                roles: { some: role },
              },
            });
            if (!others)
              throw new ConflictException(
                '마지막 관리자는 탈퇴할 수 없습니다. 다른 활성 회원에게 관리자 권한을 지정한 뒤 다시 시도해 주세요.',
              );
          }
          const withdrawnWhere = { ...activeStatus, cd: 'WITHDRAWN' };
          const learningWhere = {
            cd: 'LEARNING',
            delYn: false,
            useYn: true,
            parent: { cd: 'USER_AGR', delYn: false, useYn: true, parent: root },
          };
          const codes = await tx.cmmnCd.findMany({
            where: { OR: [withdrawnWhere, learningWhere] },
            select: {
              id: true,
              cd: true,
              prntCdId: true,
              parent: { select: { prntCdId: true } },
            },
          });
          const withdrawn = codes.find((c) => c.cd === 'WITHDRAWN'),
            learning = codes.find((c) => c.cd === 'LEARNING');
          if (!withdrawn || !learning)
            throw new ServiceUnavailableException(
              '회원 상태 설정을 확인해 주세요.',
            );
          const ids = [
            ...new Set(
              codes.flatMap((c) => [c.id, c.prntCdId!, c.parent!.prntCdId!]),
            ),
          ];
          await tx.$queryRaw`SELECT id FROM cmmn_cd WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
          if (
            (await tx.cmmnCd.count({
              where: { OR: [withdrawnWhere, learningWhere] },
            })) !== 2
          )
            throw new ServiceUnavailableException(
              '회원 상태 설정을 확인해 주세요.',
            );
          const now = nowAtSecond(),
            requestId = randomUUID();
          const previous = await tx.appUser.findUniqueOrThrow({
            where: { id: userId },
            select: { statCdId: true },
          });
          await tx.appUser.update({
            where: { id: userId },
            data: {
              statCdId: withdrawn.id,
              delYn: true,
              delDttm: now,
              delId: userId,
              uptDttm: now,
            },
          });
          await tx.userSess.updateMany({
            where: { userId, revokeDttm: null },
            data: { revokeDttm: now },
          });
          await tx.userAgrYnHist.create({
            data: {
              userId,
              agrCdId: learning.id,
              agrYn: false,
              polVer: '3.3',
              rgstDttm: now,
            },
          });
          // Old answer completions lock case/chat rows before checking the owner. Defer child row cleanup to avoid reversing that lock order.
          await tx.aiJob.updateMany({
            where: {
              chat: { userId },
              statCd: { in: ['QUEUED', 'RUNNING', 'RETRY_WAIT'] },
            },
            data: {
              statCd: 'CANCELLED',
              leaseToken: null,
              leaseDttm: null,
              errorCd: 'ACCOUNT_WITHDRAWN',
              uptDttm: now,
            },
          });
          await tx.userStatHist.create({
            data: {
              userId,
              statCdId: withdrawn.id,
              prevStatCdId: previous.statCdId,
              actorUserId: userId,
              reason: 'SELF_WITHDRAWAL',
              requestId,
              requestHash: createHash('sha256')
                .update('SELF_WITHDRAWAL:' + userId + ':' + requestId)
                .digest('hex'),
              rgstDttm: now,
            },
          });
        },
        { timeout: 15000 },
      );
    });
    return { withdrawn: true, archivePending: true, purgeCompleted: false };
  }

  async logoutAll(token: string) {
    const member = await this.session(token, false);
    const userId = BigInt(member.id);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${userId} FOR UPDATE`;
      if (!(await this.ownerIsActive(userId, null, sessionHash(token), tx)))
        throw new UnauthorizedException('로그인이 필요합니다.');
      await tx.userSess.updateMany({
        where: { userId, revokeDttm: null },
        data: { revokeDttm: nowAtSecond() },
      });
    });
  }

  async logout(token: string) {
    const now = nowAtSecond();
    await this.db.userSess.updateMany({
      where: {
        tokenHash: sessionHash(token),
        revokeDttm: null,
        rgstDttm: { lte: now },
      },
      data: { revokeDttm: now },
    });
  }
}
