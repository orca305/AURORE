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
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp'];
const DOCUMENT_FORMATS = [
  'pdf', 'hwp', 'hwpx', 'docx', 'txt', 'md',
  'xlsx', 'pptx', 'csv', 'tsv', 'rtf', 'odt', 'ods', 'odp',
];
// 내려받을 때 알려 줄 파일 종류. 사용자가 보낸 값이 아니라 확장자에서 정한 고정 목록만 쓴다.
const MIME: Record<string, string> = {
  pdf: 'application/pdf', hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8', rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
// 업로드 라이브러리(multer)는 파일 이름을 latin1 로 읽어 한글이 깨지므로, 깨진 이름이면 UTF-8 로 다시 읽는다.
const readableName = (name: string) => {
  if (!/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('�') ? name : fixed;
};
type PendingOriginal = { buffer: Buffer; name: string; expires: number };
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
  // 미리 보기에서 올린 원본을 "확인 후 등록"까지 잠깐(15분) 메모리에만 둔다. 등록하지 않으면 사라진다.
  private readonly pendingOriginals = new Map<string, PendingOriginal>();
  private keepOriginal(id: string, buffer: Buffer, name: string) {
    const at = Date.now();
    for (const [key, item] of this.pendingOriginals)
      if (item.expires <= at) this.pendingOriginals.delete(key);
    let total = buffer.length;
    for (const item of this.pendingOriginals.values()) total += item.buffer.length;
    while (this.pendingOriginals.size >= 8 || total > 32 * 1024 * 1024) {
      const oldest = this.pendingOriginals.keys().next().value;
      if (oldest === undefined) break;
      total -= this.pendingOriginals.get(oldest)!.buffer.length;
      this.pendingOriginals.delete(oldest);
    }
    this.pendingOriginals.set(id, { buffer, name, expires: at + 15 * 60000 });
  }
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
  /**
   * 이미지 속 글자를 이 PC의 로컬 비전 모델로 읽는다(AI 서버 /documents/ocr). 이미지는 저장하지 않고 외부로 보내지 않는다.
   * 읽은 글자는 틀릴 수 있어서 항상 "일부만 변환"(partial)으로 다루고, 사용자가 원본과 대조해 고친 뒤 등록한다.
   */
  private async ocr(file: Upload): Promise<{ text: string; partial: boolean }> {
    const base = process.env.AURORE_AI_URL || 'http://127.0.0.1:8001';
    let response: Response;
    try {
      response = await fetch(new URL('/documents/ocr', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: file.buffer.toString('base64') }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new BadRequestException(
        '이미지 글자 인식 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
    if (response.status === 400)
      throw new BadRequestException('PNG·JPG·WEBP 이미지 파일인지 확인해 주세요.');
    if (response.status === 422)
      throw new BadRequestException(
        '이미지의 글자를 믿을 만하게 읽지 못했습니다. 더 밝고 선명하게 다시 찍어 올리거나, 글자를 직접 입력해 주세요.',
      );
    if (!response.ok)
      throw new BadRequestException('이미지 글자 인식을 지금은 사용할 수 없습니다.');
    const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (!data || typeof data.text !== 'string' || !data.text.trim())
      throw new BadRequestException('이미지에서 글자를 찾지 못했습니다.');
    return { text: data.text, partial: true };
  }
  async preview(
    chatId: string,
    owner: DocumentOwner,
    file: Upload | undefined,
  ) {
    if (!file?.buffer?.length || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('5MB 이하 파일 하나를 선택해 주세요.');
    const format = file.originalname.split('.').at(-1)?.toLowerCase() ?? '';
    const isImage = IMAGE_FORMATS.includes(format);
    if (!isImage && !DOCUMENT_FORMATS.includes(format))
      throw new BadRequestException(
        'PDF·HWP·HWPX·DOCX·XLSX·PPTX·CSV·TSV·RTF·ODT·ODS·ODP·TXT·MD 문서 또는 PNG·JPG·WEBP 이미지를 선택해 주세요.',
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
        parsed = isImage ? await this.ocr(file) : await this.parse(file, format),
        markdown = redactDocument(
          (isImage ? '# 이미지 글자 인식 검토본\n\n' : '# 첨부자료 검토본\n\n') + parsed.text,
        );
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
      this.keepOriginal(
        value.id,
        Buffer.from(file.buffer),
        readableName(file.originalname).replace(/[\\/\u0000-\u001f]/g, '_').slice(-180) || '첨부파일.' + format,
      );
      return {
        receipt: body + '.' + this.sign(body),
        markdown,
        partial: parsed.partial,
        ocr: isImage,
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
    const pending = this.pendingOriginals.get(receipt.id);
    const original =
      pending && pending.expires > Date.now() && sha(pending.buffer) === receipt.sha
        ? pending
        : null;
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
      if (original)
        await tx.attachDocSrc.create({
          data: {
            attachDocId: receipt.id,
            origNm: original.name,
            mimeCd: MIME[receipt.format] ?? 'application/octet-stream',
            srcCont: new Uint8Array(original.buffer),
            rgstDttm: now(),
          },
        });
      await tx.chatSess.update({
        where: { id: chatId },
        data: { revNo: { increment: 1 }, uptDttm: now() },
      });
    });
    this.pendingOriginals.delete(receipt.id);
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
            mdCont: true,
            partialYn: true,
            rgstDttm: true,
            source: { select: { attachDocId: true, origNm: true } },
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
            characterCount: row.mdCont.length,
            partial: row.partialYn,
            hasOriginal: Boolean(row.source),
            originalName: row.source?.origNm ?? null,
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
  /** 올린 원본 파일을 그대로 돌려준다(본인 첨부자료이고 삭제되지 않은 경우만). */
  async original(chatId: string, id: string, owner: DocumentOwner) {
    const row = await this.db.attachDoc.findFirst({
      where: { id, chatSessId: chatId, userId: owner.userId, delYn: false, chat: visible(owner) },
      select: { formatCd: true, source: { select: { origNm: true, mimeCd: true, srcCont: true } } },
    });
    if (!row?.source) throw new NotFoundException('저장된 원본 파일이 없습니다.');
    return {
      filename: row.source.origNm,
      mime: MIME[row.formatCd] ?? 'application/octet-stream',
      buffer: Buffer.from(row.source.srcCont),
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
      await tx.aiJob.updateMany({
        where: {
          chatSessId: chatId,
          statCd: { in: ['QUEUED', 'RUNNING', 'RETRY_WAIT'] },
          documentLinks: { some: { attachDocId: id } },
        },
        data: { statCd: 'CANCELLED', leaseToken: null, leaseDttm: null },
      });
      await tx.chatSess.update({
        where: { id: chatId },
        data: { revNo: { increment: 1 }, uptDttm: now() },
      });
    });
    return this.chat.read(chatId, owner);
  }
}
