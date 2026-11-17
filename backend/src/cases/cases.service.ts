import { redactDocument, markdownLiteral } from '../documents/document-text.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
type Owner = ChatOwner & { userId: bigint };
type Command = {
  confirmed: true;
  requestId: string;
  caseId: string;
  action:
    | 'CREATE_CASE'
    | 'UPDATE_CASE'
    | 'DELETE_CASE'
    | 'CREATE_FACT'
    | 'UPDATE_FACT'
    | 'DELETE_FACT';
  revision?: number;
  title?: string;
  typeCode?: string;
  content?: string;
  occurredOn?: string;
  factId?: string;
  srcMsgId?: string;
};
type FactValue = { title: string; content: string; occurredOn: string | null };
const second = () => new Date(Math.floor(Date.now() / 1000) * 1000);
const missing = () =>
  new NotFoundException('사건 또는 사실관계를 찾을 수 없습니다.');
function clean(value: unknown, max: number, title = false) {
  if (typeof value !== 'string')
    throw new BadRequestException('입력 내용을 확인해 주세요.');
  const result = (title ? value.replace(/\s+/gu, ' ') : value)
    .normalize('NFC')
    .trim();
  if (
    !result ||
    result.length > max ||
    /[\p{Cc}\p{Surrogate}]/u.test(result.replace(/[\r\n\t]/g, ''))
  )
    throw new BadRequestException(
      '제목과 내용의 길이 및 문자를 확인해 주세요.',
    );
  return result;
}
function factId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new BadRequestException('사실관계 번호를 확인해 주세요.');
  return BigInt(value);
}
const root = {
  cd: 'AURORE',
  nodeTypeCd: 'ROOT',
  prntCdId: null,
  useYn: true,
  delYn: false,
};
const codes = (group: string) =>
  ({
    nodeTypeCd: 'VALUE',
    useYn: true,
    delYn: false,
    parent: {
      cd: group,
      nodeTypeCd: 'GROUP',
      useYn: true,
      delYn: false,
      parent: root,
    },
  }) satisfies Prisma.CmmnCdWhereInput;
const summarySelect = {
  id: true,
  caseNm: true,
  revNo: true,
  rgstDttm: true,
  uptDttm: true,
  type: { select: { cd: true, cdNm: true } },
} satisfies Prisma.UserCaseSelect;
const summary = (row: {
  id: string;
  caseNm: string;
  revNo: number;
  rgstDttm: Date;
  uptDttm: Date;
  type: { cd: string; cdNm: string };
}) => ({
  id: row.id,
  title: row.caseNm,
  typeCode: row.type.cd,
  typeName: row.type.cdNm,
  revision: row.revNo,
  createdAt: row.rgstDttm.toISOString(),
  updatedAt: row.uptDttm.toISOString(),
});
@Injectable()
export class CasesService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  async options(database: Prisma.TransactionClient = this.db) {
    return {
      types: (
        await database.cmmnCd.findMany({
          where: codes('CASE_TYPE'),
          orderBy: [{ sortSeq: 'asc' }, { id: 'asc' }],
          select: { cd: true, cdNm: true },
        })
      ).map((row) => ({ code: row.cd, label: row.cdNm })),
    };
  }
  async list(
    owner: Owner,
    query: { q: string; limit: number; offset: number; sort?: 'newest' | 'oldest' },
  ) {
    const term = query.q.trim().replace(/[\\%_]/g, '\\$&'),
      where = {
        userId: owner.userId,
        delYn: false,
        ...(term
          ? { caseNm: { contains: term, mode: 'insensitive' as const } }
          : {}),
      };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.userCase.count({ where });
        const rows = await tx.userCase.findMany({
          where,
          select: {
            ...summarySelect,
            _count: { select: { facts: { where: { delYn: false } } } },
          },
          orderBy: [{ uptDttm: query.sort==='oldest'?'asc':'desc' }, { id: query.sort==='oldest'?'asc':'desc' }],
          take: query.limit,
          skip: query.offset,
        });
        return {
          total,
          offset: query.offset,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
          items: rows.map((row) => ({
            ...summary(row),
            factCount: row._count.facts,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private sourceLink(
    source: {
      id: string;
      chatSessId: string;
      delYn: boolean;
      chat: { userId: bigint | null; delYn: boolean; exprDttm: Date | null };
    } | null,
    owner: Owner,
  ) {
    return source &&
      !source.delYn &&
      !source.chat.delYn &&
      source.chat.userId === owner.userId &&
      (!source.chat.exprDttm || source.chat.exprDttm > new Date())
      ? { chatId: source.chatSessId, messageId: source.id }
      : null;
  }
  private async draftSource(
    tx: Prisma.TransactionClient,
    id: string,
    messageId: string,
    owner: Owner,
  ) {
    const source = await tx.chatMsg.findFirst({
      where: {
        id: messageId,
        roleCd: 'USER',
        delYn: false,
        chat: {
          userCaseId: id,
          userId: owner.userId,
          guestSessId: null,
          delYn: false,
          OR: [{ exprDttm: null }, { exprDttm: { gt: new Date() } }],
        },
      },
      select: { id: true, msgCont: true, chatSessId: true },
    });
    if (!source) throw missing();
    return source;
  }
  async draft(id: string, messageId: string, owner: Owner) {
    return this.db.$transaction(
      async (tx) => {
        const parent = await tx.userCase.findFirst({
          where: { id, userId: owner.userId, delYn: false },
          select: summarySelect,
        });
        if (!parent) throw missing();
        const source = await this.draftSource(tx, id, messageId, owner);
        if (
          await tx.caseFact.findFirst({
            where: { userCaseId: id, srcMsgId: source.id, delYn: false },
            select: { id: true },
          })
        )
          throw new ConflictException(
            '이미 이 사건에 저장한 메시지입니다. 기존 사실관계를 수정해 주세요.',
          );
        return {
          case: summary(parent),
          source: { chatId: source.chatSessId, messageId: source.id },
          title: Array.from(source.msgCont.replace(/\s+/gu, ' ').trim())
            .slice(0, 40)
            .join(''),
          content: source.msgCont,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async exportMarkdown(id: string, owner: Owner) {
    return this.db.$transaction(
      async (tx) => {
        const parent = await tx.userCase.findFirst({
          where: { id, userId: owner.userId, delYn: false },
          select: summarySelect,
        });
        if (!parent) throw missing();
        const facts = await tx.$queryRaw<
          { id: bigint; value: FactValue }[]
        >`SELECT id,fact_val AS value FROM case_fact WHERE user_case_id=${id}::uuid AND NOT del_yn ORDER BY fact_val->>'occurredOn' ASC NULLS LAST,id ASC LIMIT 5001`;
        if (facts.length > 5000)
          throw new BadRequestException(
            '내보낼 사실관계가 너무 많습니다. 사건을 나누어 정리해 주세요.',
          );
        const literal = (value: string) =>
          markdownLiteral(redactDocument(value));
        const lines = [
          '# ' + literal(parent.caseNm),
          '',
          '- 분류: ' + literal(parent.type.cdNm),
          '- 사건 번호: ' + id,
          '- 기준: 현재 확인한 사실관계 · 관련 날짜순',
          '',
          '> 개인정보 패턴을 제외한 정리본입니다. 공유 전 내용과 민감정보를 직접 확인해 주세요.',
          '',
          '## 사실관계',
          '',
        ];
        for (const fact of facts) {
          lines.push(
            '### ' +
              (fact.value.occurredOn ?? '날짜 미입력') +
              ' · ' +
              literal(fact.value.title),
            '',
            ...literal(fact.value.content)
              .split('\n')
              .map((line) => '> ' + line),
            '',
          );
        }
        if (!facts.length) lines.push('등록된 사실관계가 없습니다.', '');
        const markdown = lines.join('\n');
        if (Buffer.byteLength(markdown, 'utf8') > 5 * 1024 * 1024)
          throw new BadRequestException('정리본 크기가 너무 큽니다.');
        return { filename: 'aurore-case-' + id + '.md', markdown };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async timeline(
    id: string,
    owner: Owner,
    query: { limit: number; offset: number },
  ) {
    return this.db.$transaction(
      async (tx) => {
        const parent = await tx.userCase.findFirst({
          where: { id, userId: owner.userId, delYn: false },
          select: summarySelect,
        });
        if (!parent) throw missing();
        const [counts] = await tx.$queryRaw<
          { total: bigint; undated: bigint }[]
        >`
        SELECT count(*) AS total,count(*) FILTER(WHERE fact_val->>'occurredOn' IS NULL) AS undated
        FROM case_fact WHERE user_case_id=${id}::uuid AND NOT del_yn`;
        const rows = await tx.$queryRaw<
          {
            id: bigint;
            value: FactValue;
            updatedAt: Date;
            srcMsgId: string | null;
            sourceChatId: string | null;
            sourceMessageId: string | null;
          }[]
        >`
        SELECT f.id,f.fact_val AS value,f.upt_dttm AS "updatedAt",f.src_msg_id AS "srcMsgId",
          c.id AS "sourceChatId",CASE WHEN c.id IS NOT NULL THEN m.id END AS "sourceMessageId"
        FROM case_fact f
        LEFT JOIN chat_msg m ON m.id=f.src_msg_id AND NOT m.del_yn AND m.role_cd='USER'
        LEFT JOIN chat_sess c ON c.id=m.chat_sess_id AND c.user_id=${owner.userId} AND NOT c.del_yn
          AND (c.expr_dttm IS NULL OR c.expr_dttm>clock_timestamp())
        WHERE f.user_case_id=${id}::uuid AND NOT f.del_yn
        ORDER BY f.fact_val->>'occurredOn' ASC NULLS LAST,f.id ASC
        LIMIT ${query.limit} OFFSET ${query.offset}`;
        const total = Number(counts.total);
        return {
          case: summary(parent),
          total,
          undatedTotal: Number(counts.undated),
          offset: query.offset,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
          items: rows.map((row) => ({
            id: row.id.toString(),
            ...row.value,
            updatedAt: row.updatedAt.toISOString(),
            imported: row.srcMsgId !== null,
            source: row.sourceChatId
              ? { chatId: row.sourceChatId, messageId: row.sourceMessageId }
              : null,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async chats(
    id: string,
    owner: Owner,
    query: { limit: number; offset: number },
  ) {
    return this.db.$transaction(
      async (tx) => {
        if (
          !(await tx.userCase.findFirst({
            where: { id, userId: owner.userId, delYn: false },
            select: { id: true },
          }))
        )
          throw missing();
        const where = {
          userCaseId: id,
          userId: owner.userId,
          delYn: false,
          OR: [{ exprDttm: null }, { exprDttm: { gt: new Date() } }],
        };
        const total = await tx.chatSess.count({ where });
        const rows = await tx.chatSess.findMany({
          where,
          select: { id: true, sessNm: true, uptDttm: true },
          orderBy: [{ uptDttm: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: query.offset,
        });
        return {
          total,
          offset: query.offset,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
          items: rows.map((row) => ({
            id: row.id,
            title: row.sessNm,
            updatedAt: row.uptDttm.toISOString(),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(
    id: string,
    owner: Owner,
    query: { limit: number; offset: number; historyOffset: number },
  ) {
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.userCase.findFirst({
          where: { id, userId: owner.userId, delYn: false },
          select: summarySelect,
        });
        if (!row) throw missing();
        const factWhere = { userCaseId: id, delYn: false },
          total = await tx.caseFact.count({ where: factWhere });
        const facts = await tx.caseFact.findMany({
          where: factWhere,
          orderBy: { id: 'asc' },
          take: query.limit,
          skip: query.offset,
          select: {
            id: true,
            factVal: true,
            uptDttm: true,
            srcMsgId: true,
            source: {
              select: {
                id: true,
                chatSessId: true,
                delYn: true,
                chat: { select: { userId: true, delYn: true, exprDttm: true } },
              },
            },
          },
        });
        const historyTotal = await tx.caseHist.count({
            where: { userCaseId: id, userId: owner.userId },
          }),
          history = await tx.caseHist.findMany({
            where: { userCaseId: id, userId: owner.userId },
            orderBy: { revNo: 'desc' },
            take: query.limit,
            skip: query.historyOffset,
            select: {
              id: true,
              revNo: true,
              actTypeCd: true,
              bfData: true,
              afData: true,
              rgstDttm: true,
            },
          });
        return {
          case: summary(row),
          ...(await this.options(tx)),
          facts: {
            total,
            offset: query.offset,
            nextOffset:
              query.offset + query.limit < total && query.offset < 100000
                ? Math.min(100000, query.offset + query.limit)
                : null,
            items: facts.map((fact) => ({
              id: fact.id.toString(),
              ...(fact.factVal as FactValue),
              updatedAt: fact.uptDttm.toISOString(),
              imported: fact.srcMsgId !== null,
              source: this.sourceLink(fact.source, owner),
            })),
          },
          history: {
            total: historyTotal,
            offset: query.historyOffset,
            nextOffset:
              query.historyOffset + query.limit < historyTotal &&
              query.historyOffset < 100000
                ? Math.min(100000, query.historyOffset + query.limit)
                : null,
            items: history.map((item) => ({
              id: item.id,
              revision: item.revNo,
              action: item.actTypeCd,
              before: item.bfData,
              after: item.afData,
              createdAt: item.rgstDttm.toISOString(),
            })),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async fact(id: string, value: string, owner: Owner) {
    const targetId = factId(value);
    return this.db.$transaction(
      async (tx) => {
        const parent = await tx.userCase.findFirst({
          where: { id, userId: owner.userId, delYn: false },
          select: summarySelect,
        });
        if (!parent) throw missing();
        const fact = await tx.caseFact.findFirst({
          where: { id: targetId, userCaseId: id, delYn: false },
          select: { id: true, factVal: true },
        });
        if (!fact) throw missing();
        return {
          case: summary(parent),
          fact: { id: fact.id.toString(), ...(fact.factVal as FactValue) },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async code(
    tx: Prisma.TransactionClient,
    group: string,
    code: string,
  ) {
    const row = await tx.cmmnCd.findFirst({
      where: { ...codes(group), cd: code },
      select: {
        id: true,
        cd: true,
        cdNm: true,
        parent: { select: { id: true, parent: { select: { id: true } } } },
      },
    });
    if (!row)
      throw new ConflictException(
        '사용할 수 있는 사건 분류 또는 사실관계 유형을 확인해 주세요.',
      );
    await tx.$queryRaw`SELECT id FROM cmmn_cd WHERE id IN (${row.id},${row.parent!.id},${row.parent!.parent!.id}) ORDER BY id FOR SHARE`;
    if (
      !(await tx.cmmnCd.findFirst({
        where: { id: row.id, ...codes(group), cd: code },
        select: { id: true },
      }))
    )
      throw new ConflictException(
        '사건 분류 설정이 변경되었습니다. 다시 확인해 주세요.',
      );
    return row;
  }
  async change(owner: Owner, input: Command) {
    if (input.confirmed !== true)
      throw new BadRequestException('입력한 내용을 확인한 후 저장해 주세요.');
    const command = {
      ...input,
      caseId: input.caseId.toLowerCase(),
      requestId: input.requestId.toLowerCase(),
      srcMsgId: input.srcMsgId?.toLowerCase(),
    };
    if (command.title !== undefined)
      command.title = clean(command.title, 80, true);
    if (command.content !== undefined)
      command.content = clean(command.content, 4000);
    if (command.occurredOn?.startsWith('0000'))
      throw new BadRequestException('날짜를 확인해 주세요.');
    const targetId = command.factId ? factId(command.factId) : undefined;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          command.action,
          command.caseId,
          command.revision ?? null,
          command.factId ?? null,
          command.title ?? null,
          command.typeCode ?? null,
          command.content ?? null,
          command.occurredOn ?? null,
          ...(command.srcMsgId ? [command.srcMsgId] : []),
        ]),
      )
      .digest('hex');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.requestId},0))`;
        if (
          !(await this.auth.ownerIsActive(
            owner.userId,
            null,
            owner.authHash,
            tx,
          ))
        )
          throw new UnauthorizedException('로그인이 필요합니다.');
        const known = await tx.caseHist.findUnique({
          where: { id: command.requestId },
          select: {
            userId: true,
            userCaseId: true,
            requestHash: true,
            revNo: true,
            case: { select: { delYn: true } },
          },
        });
        if (known) {
          if (known.userId !== owner.userId) throw missing();
          if (
            known.userCaseId !== command.caseId ||
            known.requestHash !== requestHash
          )
            throw new ConflictException('다른 내용에 사용된 처리 번호입니다.');
          return {
            id: known.userCaseId,
            revision: known.revNo,
            deleted: known.case.delYn,
          };
        }
        const now = second();
        if (command.action === 'CREATE_CASE') {
          const existing = await tx.userCase.findUnique({
            where: { id: command.caseId },
            select: { userId: true },
          });
          if (existing) {
            if (existing.userId !== owner.userId) throw missing();
            throw new ConflictException(
              '이미 사용된 사건 번호입니다. 새로고침 후 다시 확인해 주세요.',
            );
          }

          const type = await this.code(tx, 'CASE_TYPE', command.typeCode!);
          await tx.userCase.create({
            data: {
              id: command.caseId,
              userId: owner.userId,
              caseNm: command.title!,
              caseTypeCdId: type.id,
              rgstDttm: now,
              uptDttm: now,
            },
          });
          await tx.caseHist.create({
            data: {
              id: command.requestId,
              userCaseId: command.caseId,
              userId: owner.userId,
              revNo: 1,
              actTypeCd: command.action,
              requestHash,
              afData: {
                title: command.title!,
                typeCode: type.cd,
                typeName: type.cdNm,
              },
              rgstDttm: now,
            },
          });
          return { id: command.caseId, revision: 1, deleted: false };
        }
        await tx.$queryRaw`SELECT id FROM user_case WHERE id=${command.caseId}::uuid AND user_id=${owner.userId} FOR UPDATE`;
        const parent = await tx.userCase.findFirst({
          where: { id: command.caseId, userId: owner.userId, delYn: false },
          include: { type: { select: { cd: true, cdNm: true } } },
        });
        if (!parent) throw missing();
        if (parent.revNo !== command.revision)
          throw new ConflictException(
            '다른 화면에서 사건이 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
          );
        const revision = parent.revNo + 1,
          caseBefore = {
            title: parent.caseNm,
            typeCode: parent.type.cd,
            typeName: parent.type.cdNm,
          };
        let before: Prisma.InputJsonValue = caseBefore,
          after: Prisma.InputJsonValue = caseBefore,
          historyFactId: bigint | undefined;
        const parentData: Prisma.UserCaseUpdateInput = {
          revNo: revision,
          uptDttm: now,
        };
        if (command.action === 'UPDATE_CASE') {
          const type =
            command.typeCode === parent.type.cd
              ? {
                  id: parent.caseTypeCdId,
                  cd: parent.type.cd,
                  cdNm: parent.type.cdNm,
                }
              : await this.code(tx, 'CASE_TYPE', command.typeCode!);
          if (
            command.title === parent.caseNm &&
            type.id === parent.caseTypeCdId
          )
            throw new ConflictException('변경된 내용이 없습니다.');
          parentData.caseNm = command.title;
          parentData.type = { connect: { id: type.id } };
          after = {
            title: command.title!,
            typeCode: type.cd,
            typeName: type.cdNm,
          };
        } else if (command.action === 'DELETE_CASE') {
          await tx.chatSess.updateMany({
            where: { userCaseId: parent.id, userId: owner.userId },
            data: { userCaseId: null, revNo: { increment: 1 }, uptDttm: now },
          });

          const deleted = await tx.caseFact.updateMany({
            where: { userCaseId: parent.id, delYn: false },
            data: {
              delYn: true,
              delDttm: now,
              delId: owner.userId,
              uptDttm: now,
            },
          });
          parentData.delYn = true;
          parentData.delDttm = now;
          parentData.delId = owner.userId;
          after = {
            ...caseBefore,
            deleted: true,
            deletedFactCount: deleted.count,
          };
        } else {
          const value: FactValue = {
            title: command.title ?? '',
            content: command.content ?? '',
            occurredOn: command.occurredOn ?? null,
          };
          if (command.action === 'CREATE_FACT') {
            let source: { id: string; chatSessId: string } | undefined;
            if (command.srcMsgId) {
              await tx.$queryRaw`SELECT c.id FROM chat_sess c JOIN chat_msg m ON m.chat_sess_id=c.id WHERE m.id=${command.srcMsgId}::uuid AND c.user_id=${owner.userId} AND c.user_case_id=${parent.id}::uuid FOR UPDATE OF c`;
              source = await this.draftSource(
                tx,
                parent.id,
                command.srcMsgId,
                owner,
              );
              if (
                await tx.caseFact.findFirst({
                  where: {
                    userCaseId: parent.id,
                    srcMsgId: source.id,
                    delYn: false,
                  },
                  select: { id: true },
                })
              )
                throw new ConflictException(
                  '이미 이 사건에 저장한 메시지입니다. 기존 사실관계를 수정해 주세요.',
                );
            }

            const type = await this.code(tx, 'CASE_FACT_TYPE', 'STATEMENT');
            const fact = await tx.caseFact.create({
              data: {
                userCaseId: parent.id,
                srcMsgId: source?.id,
                factTypeCdId: type.id,
                factVal: value,
                rgstDttm: now,
                uptDttm: now,
              },
            });
            historyFactId = fact.id;
            after = {
              id: fact.id.toString(),
              ...value,
              ...(source
                ? {
                    sourceMessageId: source.id,
                    sourceChatId: source.chatSessId,
                  }
                : {}),
            };
          } else {
            const fact = await tx.caseFact.findFirst({
              where: { id: targetId, userCaseId: parent.id, delYn: false },
              select: { id: true, factVal: true },
            });
            if (!fact) throw missing();
            historyFactId = fact.id;
            const previous = fact.factVal as FactValue;
            before = { id: fact.id.toString(), ...previous };
            if (command.action === 'UPDATE_FACT') {
              if (
                previous.title === value.title &&
                previous.content === value.content &&
                previous.occurredOn === value.occurredOn
              )
                throw new ConflictException('변경된 내용이 없습니다.');
              await tx.caseFact.update({
                where: { id: fact.id },
                data: { factVal: value, uptDttm: now },
              });
              after = { id: fact.id.toString(), ...value };
            } else {
              await tx.caseFact.update({
                where: { id: fact.id },
                data: {
                  delYn: true,
                  delDttm: now,
                  delId: owner.userId,
                  uptDttm: now,
                },
              });
              after = {
                id: fact.id.toString(),
                title: previous.title,
                deleted: true,
              };
            }
          }
        }
        await tx.userCase.update({
          where: { id: parent.id },
          data: parentData,
        });
        await tx.caseHist.create({
          data: {
            id: command.requestId,
            userCaseId: parent.id,
            userId: owner.userId,
            factId: historyFactId,
            revNo: revision,
            actTypeCd: command.action,
            requestHash,
            bfData: command.action === 'CREATE_FACT' ? Prisma.DbNull : before,
            afData: after,
            rgstDttm: now,
          },
        });
        return {
          id: parent.id,
          revision,
          deleted: command.action === 'DELETE_CASE',
        };
      },
      { timeout: 15000 },
    );
  }
}
