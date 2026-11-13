import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { ChatService } from '../chat/chat.service.js';
import { redactDocument } from './document-text.js';
export type DocumentOwner = ChatOwner & { userId: bigint };
export type Upload = { buffer: Buffer; size: number; originalname: string };
type Receipt = {
  id: string;
  chatId: string;
  owner: string;
  format: string;
  size: number;
  sha: string;
  partial: boolean;
  expires: number;
};
const now = () => new Date(Math.floor(Date.now() / 1000) * 1000);
const sha = (text: string | Buffer) =>
  createHash('sha256').update(text).digest('hex');
const visible = (owner: DocumentOwner) => ({
  userId: owner.userId,
  guestSessId: null,
  delYn: false,
  OR: [{ exprDttm: null }, { exprDttm: { gt: new Date() } }],
});
@Injectable()
export class DocumentsService {
  private readonly key = randomBytes(32);
  private parsing = 0;
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly chat: ChatService,
  ) {}
  private sign(text: string) {
    return createHmac('sha256', this.key).update(text).digest('base64url');
  }
  private receipt(token: string, chatId: string, owner: DocumentOwner) {
    try {
      const [body, signature, extra] = token.split('.');
      if (extra || !body || !signature) throw Error();
      const expected = Buffer.from(this.sign(body)),
        given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given))
        throw Error();
      const value = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as Receipt;
      if (
        value.chatId !== chatId ||
        value.owner !== this.sign(String(owner.userId)) ||
        value.expires < Date.now()
      )
        throw Error();
      return value;
    } catch {
      throw new BadRequestException(
        '변환본 확인 시간이 만료됐거나 요청이 변경되었습니다. 파일을 다시 선택해 주세요.',
      );
    }
  }
  private async existingRoom(id: string, owner: DocumentOwner) {
    const row = await this.db.chatSess.findUnique({
      where: { id },
      select: { userId: true, guestSessId: true, delYn: true, exprDttm: true },
    });
    if (
      row &&
      (row.userId !== owner.userId ||
        row.guestSessId ||
        row.delYn ||
        (row.exprDttm && row.exprDttm <= new Date()))
    )
      throw new NotFoundException('대화를 찾을 수 없습니다.');
    return row;
  }
  private async parse(
    file: Upload,
    format: string,
  ): Promise<{ text: string; partial: boolean }> {
    return new Promise((done, fail) => {
      const python =
        process.env.DOCUMENT_PYTHON ||
        resolve(
          '../ai-server/.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        );
      const child = spawn(
        python,
        [resolve('../ai-server/document_extract.py'), format],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timer = setTimeout(() => {
        child.kill();
        fail(
          new BadRequestException(
            '문서 변환 시간이 초과됐습니다. 문서를 나누어 올려 주세요.',
          ),
        );
      }, 15000);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          child.kill();
          fail(new BadRequestException('추출한 내용이 너무 큽니다.'));
        } else chunks.push(chunk);
      });
      child.stdin.on('error', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        fail(new BadRequestException('문서 변환기를 실행하지 못했습니다.'));
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            text?: string;
            partial?: boolean;
            error?: string;
          };
          if (
            result.error ||
            typeof result.text !== 'string' ||
            typeof result.partial !== 'boolean'
          )
            throw Error();
          done({ text: result.text, partial: result.partial });
        } catch {
          fail(
            new BadRequestException(
              '문서를 읽지 못했습니다. 암호·스캔 문서 또는 지원하지 않는 형식인지 확인해 주세요.',
            ),
          );
        }
      });
      child.stdin.end(file.buffer);
    });
  }
  async preview(
    chatId: string,
    owner: DocumentOwner,
    file: Upload | undefined,
  ) {
    if (!file?.buffer?.length || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('5MB 이하 파일 하나를 선택해 주세요.');
    const format = file.originalname.split('.').at(-1)?.toLowerCase() ?? '';
    if (!['pdf', 'hwp', 'hwpx', 'docx', 'txt', 'md'].includes(format))
      throw new BadRequestException(
        'PDF·HWP·HWPX·DOCX·TXT·MD 파일을 선택해 주세요.',
      );
    await this.existingRoom(chatId, owner);
    if (this.parsing >= 2)
      throw new HttpException(
        '다른 문서를 변환 중입니다. 잠시 후 다시 시도해 주세요.',
        429,
      );
    this.parsing++;
    try {
      const hash = sha(file.buffer),
        parsed = await this.parse(file, format),
        markdown = redactDocument('# 첨부자료 검토본\n\n' + parsed.text);
      if (markdown.length > 50000)
        throw new BadRequestException('변환본은 50,000자 이하여야 합니다.');
      if (!(await this.auth.ownerIsActive(owner.userId, null, owner.authHash)))
        throw new UnauthorizedException();
      const value: Receipt = {
        id: randomUUID(),
        chatId,
        owner: this.sign(String(owner.userId)),
        format,
        size: file.size,
        sha: hash,
        partial: parsed.partial,
        expires: Date.now() + 15 * 60000,
      };
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return {
        receipt: body + '.' + this.sign(body),
        markdown,
        partial: parsed.partial,
        filename: '첨부자료.md',
      };
    } finally {
      file.buffer.fill(0);
      this.parsing--;
    }
  }
  async confirm(
    chatId: string,
    owner: DocumentOwner,
    token: string,
    text: string,
    confirmed: boolean,
  ) {
    if (!confirmed)
      throw new BadRequestException(
        '개인정보·민감정보를 확인한 후 등록해 주세요.',
      );
    const receipt = this.receipt(token, chatId, owner),
      markdown = redactDocument(text);
    if (
      !markdown ||
      markdown.length > 50000 ||
      /[\p{Surrogate}]/u.test(markdown)
    )
      throw new BadRequestException(
        'Markdown 내용을 1~50,000자로 입력해 주세요.',
      );
    const requestHash = sha(JSON.stringify([chatId, receipt.sha, markdown]));
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.id},0))`;
      if (
        !(await this.auth.ownerIsActive(owner.userId, null, owner.authHash, tx))
      )
        throw new UnauthorizedException();
      const existing = await tx.attachDoc.findUnique({
        where: { id: receipt.id },
        select: {
          userId: true,
          chatSessId: true,
          requestHash: true,
          delYn: true,
        },
      });
      if (existing) {
        if (
          existing.userId !== owner.userId ||
          existing.chatSessId !== chatId ||
          existing.delYn
        )
          throw new NotFoundException('첨부자료를 찾을 수 없습니다.');
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            '같은 처리 번호로 내용을 변경할 수 없습니다.',
          );
        return;
      }
      await tx.$executeRaw`INSERT INTO chat_sess(id,user_id,sess_nm,rgst_dttm,upt_dttm) VALUES(${chatId}::uuid,${owner.userId},'첨부 자료 검토',date_trunc('second',now()),date_trunc('second',now())) ON CONFLICT(id) DO NOTHING`;
      await tx.$queryRaw`SELECT id FROM chat_sess WHERE id=${chatId}::uuid FOR UPDATE`;
      if (
        !(await tx.chatSess.findFirst({
          where: { id: chatId, ...visible(owner) },
          select: { id: true },
        }))
      )
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      if (
        (await tx.attachDoc.count({
          where: { chatSessId: chatId, delYn: false },
        })) >= 20
      )
        throw new ConflictException('대화당 첨부자료는 최대 20개입니다.');
      await tx.attachDoc.create({
        data: {
          id: receipt.id,
          userId: owner.userId,
          chatSessId: chatId,
          docNm: '검토자료-' + receipt.id.slice(0, 8) + '.md',
          formatCd: receipt.format,
          byteSize: receipt.size,
          srcSha: receipt.sha,
          requestHash,
          mdCont: markdown,
          partialYn: receipt.partial,
          rgstDttm: now(),
          uptDttm: now(),
        },
      });
      await tx.chatSess.update({
        where: { id: chatId },
        data: { revNo: { increment: 1 }, uptDttm: now() },
      });
    });
    return this.chat.read(chatId, owner);
  }
  async list(
    chatId: string,
    owner: DocumentOwner,
    limit: number,
    offset: number,
  ) {
    const room = await this.existingRoom(chatId, owner);
    if (!room) return { items: [], total: 0, offset, nextOffset: null };
    return this.db.$transaction(
      async (tx) => {
        const where = {
          chatSessId: chatId,
          userId: owner.userId,
          delYn: false,
          chat: visible(owner),
        };
        const total = await tx.attachDoc.count({ where });
        const rows = await tx.attachDoc.findMany({
          where,
          select: {
            id: true,
            docNm: true,
            formatCd: true,
            byteSize: true,
            partialYn: true,
            rgstDttm: true,
          },
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            name: row.docNm,
            format: row.formatCd,
            size: row.byteSize,
            partial: row.partialYn,
            createdAt: row.rgstDttm.toISOString(),
          })),
          total,
          offset,
          nextOffset: offset + limit < total ? offset + limit : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async read(chatId: string, id: string, owner: DocumentOwner) {
    const row = await this.db.attachDoc.findFirst({
      where: {
        id,
        chatSessId: chatId,
        userId: owner.userId,
        delYn: false,
        chat: visible(owner),
      },
      select: { docNm: true, mdCont: true, partialYn: true },
    });
    if (!row) throw new NotFoundException('첨부자료를 찾을 수 없습니다.');
    return {
      filename: row.docNm,
      markdown: row.mdCont,
      partial: row.partialYn,
    };
  }
  async remove(chatId: string, id: string, owner: DocumentOwner) {
    await this.db.$transaction(async (tx) => {
      if (
        !(await this.auth.ownerIsActive(owner.userId, null, owner.authHash, tx))
      )
        throw new UnauthorizedException();
      await tx.$queryRaw`SELECT id FROM chat_sess WHERE id=${chatId}::uuid FOR UPDATE`;
      if (
        !(await tx.chatSess.findFirst({
          where: { id: chatId, ...visible(owner) },
          select: { id: true },
        }))
      )
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      const result = await tx.attachDoc.updateMany({
        where: { id, chatSessId: chatId, userId: owner.userId, delYn: false },
        data: {
          delYn: true,
          delDttm: now(),
          delId: owner.userId,
          uptDttm: now(),
        },
      });
      if (!result.count)
        throw new NotFoundException('첨부자료를 찾을 수 없습니다.');
      await tx.chatSess.update({
        where: { id: chatId },
        data: { revNo: { increment: 1 }, uptDttm: now() },
      });
    });
    return this.chat.read(chatId, owner);
  }
}
