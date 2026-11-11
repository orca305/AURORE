import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (!token) throw new UnauthorizedException('로그인이 필요합니다.');
    const member = await this.auth.session(token, false);
    const role = await this.db.userRole.findFirst({
      where: {
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
      },
      select: { id: true },
    });
    if (!role) throw new ForbiddenException('관리자 권한이 필요합니다.');
    return true;
  }
}
