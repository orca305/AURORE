import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// 수집 전용 자격증명. 회원·관리자 인증을 대신하지 않는다.
@Injectable()
export class IngestGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('LEGAL_INGEST_TOKEN');
    if (!expected || Buffer.byteLength(expected) < 32) {
      throw new ServiceUnavailableException(
        '법규 등록이 활성화되지 않았습니다.',
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('수집 인증이 필요합니다.');
    }
    return true;
  }
}
