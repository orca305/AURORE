import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';

const [action, loginId, ...extra] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !/^[a-z][a-z0-9_]{3,11}$/.test(loginId ?? '') || extra.length) {
  throw new Error('Usage: node --env-file=../local-dev/.env tools/set-admin-role.mjs grant|revoke LOGIN_ID');
}
const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
try {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM app_user WHERE login_id = ${loginId} FOR UPDATE`;
    const user = await tx.appUser.findFirst({
      where: { loginId, delYn: false, ...(action === 'grant' ? { status: { cd: 'ACTIVE', delYn: false, useYn: true, parent: { cd: 'USER_STAT', delYn: false, useYn: true, parent: { cd: 'AURORE', delYn: false, useYn: true } } } } : {}) },
      select: { id: true },
    });
    if (!user) throw new Error('사용 가능한 회원이 없습니다. 먼저 가입 여부와 회원 상태를 확인하세요.');
    const role = await tx.cmmnCd.findFirst({
      where: { cd: 'ADMIN', nodeTypeCd: 'VALUE', delYn: false, useYn: true, parent: { cd: 'USER_ROLE', nodeTypeCd: 'GROUP', delYn: false, useYn: true, parent: { cd: 'AURORE', nodeTypeCd: 'ROOT', prntCdId: null, delYn: false, useYn: true } } }, select: { id: true },
    });
    if (!role) throw new Error('관리자 공통코드가 없거나 비활성화되어 있습니다.');
    const where = { userId: user.id, roleCdId: role.id, delYn: false };
    if (action === 'revoke') {
      await tx.userRole.updateMany({ where, data: { delYn: true, delDttm: new Date(Math.floor(Date.now() / 1000) * 1000) } });
    } else if (!await tx.userRole.findFirst({ where })) {
      await tx.userRole.create({ data: { userId: user.id, roleCdId: role.id, rgstDttm: new Date(Math.floor(Date.now() / 1000) * 1000) } });
    }
  });
  console.log(action === 'grant' ? '관리자 권한 부여 완료' : '관리자 권한 회수 완료');
} finally { await db.$disconnect(); }
