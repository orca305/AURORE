import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client.js';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    await this.require(
      context.switchToHttp().getRequest<Request>().headers.authorization,
    );
    return true;
  }

  async require(
    authorization: string | undefined,
    tx?: Prisma.TransactionClient,
  ) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('로그인이 필요합니다.');
    let member: { id: string; loginId: string; nickname: string };
    if (tx) {
      const digest = createHash('sha256').update(token).digest();
      const session = await tx.userSess.findUnique({
        where: { tokenHash: digest },
        select: { user: { select: { id: true, loginId: true, nickNm: true } } },
      });
      if (
        !session ||
        !(await this.auth.ownerIsActive(session.user.id, null, digest, tx))
      )
        throw new UnauthorizedException('로그인이 필요합니다.');
      member = {
        id: session.user.id.toString(),
        loginId: session.user.loginId,
        nickname: session.user.nickNm,
      };
    } else member = await this.auth.session(token, false);
    const database = tx ?? this.db;
    const where = {
      userId: BigInt(member.id),
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
          parent: {
            cd: 'AURORE',
            nodeTypeCd: 'ROOT',
            prntCdId: null,
            delYn: false,
            useYn: true,
          },
        },
      },
    } satisfies Prisma.UserRoleWhereInput;
    const role = await database.userRole.findFirst({
      where,
      select: {
        id: true,
        role: {
          select: {
            id: true,
            parent: { select: { id: true, parent: { select: { id: true } } } },
          },
        },
      },
    });
    if (!role) throw new ForbiddenException('관리자 권한이 필요합니다.');
    if (tx) {
      // User/session -> role -> code locks keep revocation and publication ordered.
      const locked = await tx.$queryRaw<
        { id: bigint }[]
      >`SELECT id FROM user_role WHERE id=${role.id} AND NOT del_yn FOR SHARE`;
      if (!locked.length)
        throw new ForbiddenException('관리자 권한이 필요합니다.');
      await tx.$queryRaw`SELECT id FROM cmmn_cd WHERE id IN (${role.role.id},${role.role.parent!.id},${role.role.parent!.parent!.id}) ORDER BY id FOR SHARE`;
      if (
        !(await tx.userRole.findFirst({
          where: { ...where, id: role.id },
          select: { id: true },
        }))
      )
        throw new ForbiddenException('관리자 권한이 필요합니다.');
    }
    return member;
  }
}
