import { generationErrorCode } from './job-diagnostics.js';
import { isUncertainSupplement } from './clarification.js';
import { redactDocument } from '../documents/document-text.js';
import {
  loadCaseContext,
  cleanedFact,
  validateSelection,
  type CaseSelection,
  type CaseContextMeta,
} from './case-context.js';
import {
  BadRequestException,
  ServiceUnavailableException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  ChatAnswerService,
  type PreparedAnswer,
  type PreparedCitation,
  type DocumentInput,
} from './answer.service.js';

const unfinished = ['QUEUED', 'RUNNING', 'RETRY_WAIT'];
const nowAtSecond = () => new Date(Math.floor(Date.now() / 1000) * 1000);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function visibleRoom(owner: ChatOwner): Prisma.ChatSessWhereInput {
  return {
    userId: owner.userId,
    guestSessId: owner.guestSessId,
    delYn: false,
    OR: [{ exprDttm: null }, { exprDttm: { gt: new Date() } }],
  };
}

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private stopping = false;
  private workTask?: Promise<void>;
  private nextExpirySweep = 0;

  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly answers: ChatAnswerService,
  ) {}

  onModuleInit() {
    // ponytail: one worker per local server; coordinate GPU capacity before adding server instances.
    this.timer = setInterval(() => this.kick(), 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.workTask?.catch(() => {});
  }

  private kick() {
    if (this.stopping || this.workTask) return;
    const task = this.drain();
    this.workTask = task;
    void task
      .catch(() => {})
      .finally(() => {
        if (this.workTask === task) this.workTask = undefined;
      });
  }

  async list(owner: ChatOwner, cursor?: string, limit = 20) {
    let boundary: Prisma.ChatSessWhereInput = {};
    if (cursor) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 2 ||
          typeof parsed[0] !== 'string' ||
          typeof parsed[1] !== 'string' ||
          !uuidPattern.test(parsed[1])
        )
          throw new Error();
        const date = new Date(parsed[0]);
        if (
          !Number.isFinite(date.getTime()) ||
          date.toISOString() !== parsed[0]
        )
          throw new Error();
        boundary = {
          OR: [
            { uptDttm: { lt: date } },
            { uptDttm: date, id: { lt: parsed[1] } },
          ],
        };
      } catch {
        throw new BadRequestException('목록 위치를 확인해 주세요.');
      }
    }
    const rows = await this.db.chatSess.findMany({
      where: { AND: [visibleRoom(owner), boundary] },
      select: {
        id: true,
        sessNm: true,
        uptDttm: true,
        exprDttm: true,
        revNo: true,
      },
      orderBy: [{ uptDttm: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const unread = page.length
      ? await this.db.$queryRaw<{ id: string; count: bigint }[]>(Prisma.sql`
      WITH corrected AS (
        SELECT m.chat_sess_id AS id, c.id AS citation_id, r.src_snapshot_id AS target
        FROM chat_msg m JOIN ans_cite c ON c.msg_id=m.id
        JOIN legal_ver v ON v.id=c.legal_ver_id AND NOT v.del_yn
        JOIN legal l ON l.id=v.legal_id AND NOT l.del_yn
        JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
        WHERE m.chat_sess_id IN (${Prisma.join(page.map((row) => Prisma.sql`${row.id}::uuid`))})
          AND NOT m.del_yn AND m.role_cd='ASSISTANT' AND r.src_snapshot_id<>c.src_snapshot_id
        UNION ALL
        SELECT m.chat_sess_id, c.id, r.src_snapshot_id
        FROM chat_msg m JOIN ans_cite c ON c.msg_id=m.id
        JOIN legal_prec p ON p.id=c.legal_prec_id AND NOT p.del_yn
        JOIN legal_prec_rev r ON r.legal_prec_id=p.id AND r.current_yn
        WHERE m.chat_sess_id IN (${Prisma.join(page.map((row) => Prisma.sql`${row.id}::uuid`))})
          AND NOT m.del_yn AND m.role_cd='ASSISTANT' AND c.legal_ver_id IS NULL AND r.src_snapshot_id<>c.src_snapshot_id
      ) SELECT id, count(*) AS count FROM corrected c WHERE NOT EXISTS (
        SELECT 1 FROM cite_notice_read n WHERE n.ans_cite_id=c.citation_id AND n.target_snapshot_id=c.target
      ) GROUP BY id
    `)
      : [];
    const counts = new Map(unread.map((row) => [row.id, Number(row.count)]));
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        title: row.sessNm,
        unreadCorrectionCount: counts.get(row.id) ?? 0,
        revision: row.revNo,
        updatedAt: row.uptDttm.toISOString(),
        expiresAt: row.exprDttm?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify([last.uptDttm.toISOString(), last.id]),
            ).toString('base64url')
          : null,
    };
  }

  async read(id: string, owner: ChatOwner, beforeSeq?: number) {
    const room = await this.db.chatSess.findFirst({
      where: { id, ...visibleRoom(owner) },
      select: {
        id: true,
        sessNm: true,
        linkedCase: {
          select: {
            id: true,
            caseNm: true,
            delYn: true,
            userId: true,
            revNo: true,
          },
        },
        uptDttm: true,
        phaseCd: true,
        revNo: true,
        exprDttm: true,
        messages: {
          where: {
            delYn: false,
            ...(beforeSeq ? { msgSeq: { lt: beforeSeq } } : {}),
          },
          orderBy: { msgSeq: 'desc' },
          take: 101,
          select: {
            id: true,
            msgSeq: true,
            roleCd: true,
            msgCont: true,
            clarifyCd: true,
            clarifyReplyTo: true,
            documentQuotes: {
              where: {
                document: { delYn: false, userId: owner.userId ?? -1n },
              },
              orderBy: { id: 'asc' },
              select: {
                id: true,
                attachDocId: true,
                quote: true,
                document: { select: { docNm: true } },
              },
            },
            answerJobs: {
              select: { providerCd: true, caseContext: true },
              take: 1,
            },
            citations: {
              select: {
                id: true,
                citeCont: true,
                label: true,
                srcUrl: true,
                viewHref: true,
                supportVerifyCd: true,
                srcSnapshotId: true,
                legalVerId: true,
                legalPrecId: true,
              },
            },
          },
        },
        jobs: {
          orderBy: { input: { msgSeq: 'desc' } },
          take: 1,
          select: { id: true, statCd: true, errorCd: true },
        },
      },
    });
    if (!room) throw new NotFoundException('대화를 찾을 수 없습니다.');
    const rows = room.messages.slice(0, 100).reverse();
    const sourceStates = new Map<
      string,
      ReturnType<ChatService['citationStatus']>
    >();
    const sourceKey = (citation: {
      legalVerId: bigint | null;
      legalPrecId: bigint | null;
      srcSnapshotId: bigint;
    }) =>
      [citation.legalVerId, citation.legalPrecId, citation.srcSnapshotId].join(
        ':',
      );
    for (const message of rows) {
      const citation = message.citations[0];
      if (citation && !sourceStates.has(sourceKey(citation)))
        sourceStates.set(sourceKey(citation), this.citationStatus(citation));
    }
    await Promise.all(sourceStates.values());
    const targets: { ansCiteId: bigint; targetSnapshotId: bigint }[] = [];
    for (const message of rows) {
      const citation = message.citations[0];
      if (!citation) continue;
      const state = await sourceStates.get(sourceKey(citation))!;
      if (state.correction)
        targets.push({
          ansCiteId: citation.id,
          targetSnapshotId: state.correction.targetSnapshotId,
        });
    }
    const receipts = targets.length
      ? await this.db.citeNoticeRead.findMany({
          where: { OR: targets },
          select: { ansCiteId: true, targetSnapshotId: true, readDttm: true },
        })
      : [];
    const readDates = new Map(
      receipts.map((row) => [
        row.ansCiteId + ':' + row.targetSnapshotId,
        row.readDttm.toISOString(),
      ]),
    );
    const messages = await Promise.all(
      rows.map(async (message) => {
        const citation = message.citations[0];
        const key = citation
          ? [
              citation.legalVerId,
              citation.legalPrecId,
              citation.srcSnapshotId,
            ].join(':')
          : '';
        if (citation && !sourceStates.has(key))
          sourceStates.set(key, this.citationStatus(citation));
        const status = citation ? await sourceStates.get(key)! : null;
        const current = status?.current ?? false;
        const correction =
          status?.correction && citation
            ? {
                kind: status.correction.kind,
                recordedAt: status.correction.recordedAt,
                currentHref: status.correction.currentHref,
                compareHref: status.correction.compareHref,
                key: this.noticeKey(
                  citation.id,
                  status.correction.targetSnapshotId,
                ),
                readAt:
                  readDates.get(
                    citation.id + ':' + status.correction.targetSnapshotId,
                  ) ?? null,
              }
            : null;
        return {
          id: message.id,
          sequence: message.msgSeq,
          role:
            message.roleCd === 'USER'
              ? ('user' as const)
              : ('assistant' as const),
          text: message.msgCont,
          ...(message.clarifyCd ? { clarification: message.clarifyCd } : {}),
          ...(message.clarifyReplyTo
            ? { clarifyReplyTo: message.clarifyReplyTo }
            : {}),
          ...(message.answerJobs[0]?.caseContext
            ? {
                caseContext: {
                  current: Boolean(
                    room.linkedCase &&
                    !room.linkedCase.delYn &&
                    room.linkedCase.userId === owner.userId &&
                    room.linkedCase.id ===
                      (
                        message.answerJobs[0]
                          .caseContext as unknown as CaseContextMeta
                      ).caseId &&
                    room.linkedCase.revNo ===
                      (
                        message.answerJobs[0]
                          .caseContext as unknown as CaseContextMeta
                      ).revision,
                  ),
                  asOf: (
                    message.answerJobs[0]
                      .caseContext as unknown as CaseContextMeta
                  ).asOf,
                  factCount: (
                    message.answerJobs[0]
                      .caseContext as unknown as CaseContextMeta
                  ).factIds.length,
                  revision: (
                    message.answerJobs[0]
                      .caseContext as unknown as CaseContextMeta
                  ).revision,
                },
              }
            : {}),
          documentAnswer: message.answerJobs[0]?.providerCd === 'LOCAL_DOC',
          documentQuotes: message.documentQuotes.map((quote) => ({
            id: quote.id.toString(),
            documentId: quote.attachDocId,
            name: quote.document.docNm,
            quote: quote.quote,
          })),

          ...(citation
            ? {
                source: {
                  quote: citation.citeCont,
                  verification: citation.supportVerifyCd,
                  label: citation.label,
                  url: citation.srcUrl,
                  ...(current
                    ? { href: citation.viewHref }
                    : {
                        warning: status?.correction
                          ? '이 답변에 사용한 원문이 정정되었습니다. 당시 답변과 인용문은 그대로 보관합니다.'
                          : '원문 상태가 변경되어 당시 저장한 인용을 표시합니다.',
                        ...(status?.correction ? { correction } : {}),
                      }),
                },
              }
            : {}),
        };
      }),
    );
    return {
      canLinkCase: owner.userId !== null,
      linkedCase:
        room.linkedCase &&
        !room.linkedCase.delYn &&
        room.linkedCase.userId === owner.userId
          ? { id: room.linkedCase.id, title: room.linkedCase.caseNm }
          : null,
      id: room.id,
      title: room.sessNm,
      updatedAt: room.uptDttm.toISOString(),
      phase: room.phaseCd,
      revision: room.revNo,
      expiresAt: room.exprDttm?.toISOString() ?? null,
      messages,
      nextBeforeSeq: room.messages.length > 100 ? rows[0].msgSeq : null,
      job: room.jobs[0]
        ? {
            id: room.jobs[0].id,
            status: room.jobs[0].statCd,
            ...(room.jobs[0].errorCd === 'CASE_CONTEXT_CHANGED'
              ? { reason: 'CASE_CONTEXT_CHANGED' }
              : {}),
          }
        : null,
    };
  }

  private async citationStatus(
    citation: {
      srcSnapshotId: bigint;
      legalVerId: bigint | null;
      legalPrecId: bigint | null;
    },
    database: Prisma.TransactionClient = this.db,
  ) {
    if (await this.citationIsCurrent(citation, database))
      return { current: true, correction: null };
    if (citation.legalVerId !== null) {
      const previous = await database.legalVerRev.findFirst({
        where: {
          legalVerId: citation.legalVerId,
          srcSnapshotId: citation.srcSnapshotId,
        },
        select: { id: true },
      });
      const current = await database.legalVerRev.findFirst({
        where: {
          legalVerId: citation.legalVerId,
          currentYn: true,
          srcSnapshotId: { not: null },
          version: { delYn: false, legal: { delYn: false } },
        },
        select: {
          id: true,
          srcSnapshotId: true,
          rgstDttm: true,
          version: { select: { legalId: true, id: true } },
        },
      });
      if (previous && current && previous.id !== current.id) {
        const path = '/legals/' + current.version.legalId;
        const query = new URLSearchParams({
          beforeVersionId: current.version.id.toString(),
          afterVersionId: current.version.id.toString(),
          beforeRevisionId: previous.id.toString(),
          afterRevisionId: current.id.toString(),
        });
        return {
          current: false,
          correction: {
            kind: 'LAW_CORRECTED',
            targetSnapshotId: current.srcSnapshotId!,
            recordedAt: current.rgstDttm.toISOString(),
            currentHref: path + '/versions/' + current.version.id,
            compareHref: path + '/compare?' + query,
          },
        };
      }
    } else if (citation.legalPrecId !== null) {
      const current = await database.legalPrecRev.findFirst({
        where: {
          legalPrecId: citation.legalPrecId,
          currentYn: true,
          srcSnapshotId: { not: citation.srcSnapshotId },
          precedent: { delYn: false },
        },
        select: {
          srcSnapshotId: true,
          rgstDttm: true,
          caseNo: true,
          precedent: { select: { srcKey: true } },
        },
      });
      if (current)
        return {
          current: false,
          correction: {
            kind: 'PRECEDENT_CORRECTED',
            targetSnapshotId: current.srcSnapshotId,
            recordedAt: current.rgstDttm.toISOString(),
            currentHref:
              '/precedents?' +
              new URLSearchParams({ q: current.caseNo }) +
              '#case-' +
              encodeURIComponent(current.precedent.srcKey),
            compareHref: null,
          },
        };
    }
    return { current: false, correction: null };
  }

  private async citationIsCurrent(
    citation: {
      srcSnapshotId: bigint;
      legalVerId: bigint | null;
      legalPrecId: bigint | null;
    },
    database: Prisma.TransactionClient = this.db,
  ) {
    if (citation.legalVerId !== null) {
      return Boolean(
        await database.legalVerRev.findFirst({
          where: {
            legalVerId: citation.legalVerId,
            srcSnapshotId: citation.srcSnapshotId,
            currentYn: true,
            version: { delYn: false, legal: { delYn: false } },
          },
          select: { id: true },
        }),
      );
    }
    return Boolean(
      await database.legalPrecRev.findFirst({
        where: {
          legalPrecId: citation.legalPrecId ?? -1n,
          srcSnapshotId: citation.srcSnapshotId,
          currentYn: true,
          precedent: { delYn: false },
        },
        select: { id: true },
      }),
    );
  }

  private async lockedRoom(
    tx: Prisma.TransactionClient,
    id: string,
    owner: ChatOwner,
  ) {
    await tx.$queryRaw`SELECT id FROM chat_sess WHERE id = ${id}::uuid FOR UPDATE`;
    const room = await tx.chatSess.findFirst({
      where: { id, ...visibleRoom(owner) },
    });
    if (!room) throw new NotFoundException('대화를 찾을 수 없습니다.');
    return room;
  }

  async submit(
    id: string,
    owner: ChatOwner,
    requestId: string,
    question: string,
    revision: number,
    documentIds: string[] = [],
    caseSelection?: CaseSelection,
    clarifyReplyTo?: string,
  ) {
    const text = question.trim();
    if (
      !text ||
      Array.from(text).length > 1000 ||
      /\p{Surrogate}/u.test(text)
    ) {
      throw new BadRequestException('질문을 1~1,000자로 입력해 주세요.');
    }
    if (
      !Array.isArray(documentIds) ||
      documentIds.length > 3 ||
      documentIds.some(
        (value) => typeof value !== 'string' || !uuidPattern.test(value),
      )
    )
      throw new BadRequestException('첨부자료는 최대 3개까지 선택해 주세요.');
    const ids = documentIds.map((value) => value.toLowerCase()).sort();
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('첨부자료 선택이 중복됐습니다.');
    if (ids.length && owner.userId === null)
      throw new ForbiddenException('첨부자료 질문은 회원 전용입니다.');
    if (caseSelection) validateSelection(caseSelection);
    if (caseSelection && owner.userId === null)
      throw new ForbiddenException('사건 정보 활용은 회원 전용입니다.');
    const normalizedSelection = caseSelection
      ? {
          revision: caseSelection.revision,
          factIds: [...caseSelection.factIds].sort(),
          asOf: caseSelection.asOf,
          confirmed: true as const,
        }
      : undefined;
    if (
      clarifyReplyTo !== undefined &&
      (typeof clarifyReplyTo !== 'string' || !uuidPattern.test(clarifyReplyTo))
    )
      throw new BadRequestException('보완할 질문을 확인해 주세요.');
    const clarificationId = clarifyReplyTo?.toLowerCase();
    const hash = createHash('sha256')
      .update(
        clarificationId
          ? JSON.stringify([
              text,
              ids,
              normalizedSelection ?? null,
              clarificationId,
            ])
          : normalizedSelection
            ? JSON.stringify([text, ids, normalizedSelection])
            : ids.length
              ? JSON.stringify([text, ids])
              : text,
      )
      .digest('hex');
    await this.db.$transaction(async (tx) => {
      const ownerKey =
        owner.userId !== null
          ? 'chat-user:' + owner.userId
          : 'chat-guest:' + owner.guestSessId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerKey}, 0))`;
      const contextRoom = normalizedSelection
        ? await tx.chatSess.findFirst({
            where: { id, ...visibleRoom(owner) },
            select: { userCaseId: true },
          })
        : null;
      if (contextRoom?.userCaseId)
        await tx.$queryRaw`SELECT id FROM user_case WHERE id=${contextRoom.userCaseId}::uuid AND user_id=${owner.userId} FOR SHARE`;
      const title = Array.from(text.replace(/\s+/g, ' ')).slice(0, 80).join('');
      await tx.$executeRaw`
        INSERT INTO chat_sess (id, user_id, guest_sess_id, sess_nm, rgst_dttm, upt_dttm, expr_dttm)
        VALUES (${id}::uuid, ${owner.userId}, ${owner.guestSessId}::uuid, ${title},
          date_trunc('second', now()), date_trunc('second', now()),
          CASE WHEN ${owner.guestSessId}::uuid IS NULL THEN NULL
          ELSE ((date_trunc('second', now()) AT TIME ZONE 'Asia/Seoul') + interval '1 month') AT TIME ZONE 'Asia/Seoul' END)
        ON CONFLICT (id) DO NOTHING
      `;
      const room = await this.lockedRoom(tx, id, owner);
      if (
        !(await this.auth.ownerIsActive(
          owner.userId,
          owner.guestSessId,
          owner.authHash,
          tx,
        ))
      ) {
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      }
      const existing = await tx.aiJob.findUnique({ where: { id: requestId } });
      if (existing) {
        if (
          existing.chatSessId !== id &&
          !(await tx.chatSess.findFirst({
            where: { id: existing.chatSessId, ...visibleRoom(owner) },
            select: { id: true },
          }))
        ) {
          throw new NotFoundException('작업을 찾을 수 없습니다.');
        }
        if (existing.chatSessId !== id || existing.requestHash !== hash) {
          throw new ConflictException(
            '같은 요청 식별자로 다른 질문을 보낼 수 없습니다.',
          );
        }
        return;
      }
      if (room.revNo !== revision)
        throw new ConflictException(
          '다른 화면에서 대화가 변경됐습니다. 최신 내용을 확인해 주세요.',
        );
      if (
        (await tx.aiJob.count({
          where: { statCd: { in: unfinished }, chat: visibleRoom(owner) },
        })) >= 2
      ) {
        throw new ConflictException(
          '진행 중인 답변을 기다린 뒤 다시 질문해 주세요.',
        );
      }
      if (
        await tx.aiJob.count({
          where: { chatSessId: id, statCd: { in: unfinished } },
        })
      ) {
        throw new ConflictException('이 대화의 답변을 기다려 주세요.');
      }
      const documents = ids.length
        ? await tx.attachDoc.findMany({
            where: {
              id: { in: ids },
              chatSessId: id,
              userId: owner.userId!,
              delYn: false,
            },
            select: { id: true, mdCont: true },
          })
        : [];
      if (documents.length !== ids.length)
        throw new NotFoundException('선택한 첨부자료를 찾을 수 없습니다.');
      if (documents.reduce((sum, doc) => sum + doc.mdCont.length, 0) > 12000)
        throw new BadRequestException(
          '선택한 Markdown의 합계는 12,000자 이하여야 합니다.',
        );
      if (ids.length && !(await this.answers.documentsReady()))
        throw new ServiceUnavailableException(
          '첨부자료 답변용 로컬 AI가 준비되지 않았습니다.',
        );
      if (normalizedSelection && room.userCaseId !== contextRoom?.userCaseId)
        throw new ConflictException(
          '사건 연결이 변경되었습니다. 다시 확인해 주세요.',
        );
      const context = normalizedSelection
        ? await loadCaseContext(
            tx,
            room.userCaseId ?? '00000000-0000-4000-8000-000000000000',
            owner.userId,
            normalizedSelection,
          )
        : null;
      const clarification = clarificationId
        ? await tx.chatMsg.findFirst({
            where: {
              id: clarificationId,
              chatSessId: id,
              roleCd: 'ASSISTANT',
              delYn: false,
              clarifyCd: { not: null },
              msgSeq: room.nextMsgSeq - 1,
            },
            select: {
              parent: {
                select: { msgCont: true, delYn: true, clarifyReplyTo: true },
              },
            },
          })
        : null;
      if (
        clarificationId &&
        (!clarification?.parent ||
          clarification.parent.delYn ||
          clarification.parent.clarifyReplyTo)
      )
        throw new ConflictException(
          '이 질문은 더 이상 보완할 수 없습니다. 최신 대화를 확인해 주세요.',
        );
      if (
        clarification?.parent &&
        (context?.text.length ?? 0) +
          redactDocument(clarification.parent.msgCont).length +
          40 >
          8000
      )
        throw new BadRequestException(
          '보완 질문과 사건 정보는 합계 8,000자까지 사용할 수 있습니다. 선택한 사실관계를 줄여 주세요.',
        );
      const message = await tx.chatMsg.create({
        data: {
          chatSessId: id,
          msgSeq: room.nextMsgSeq,
          roleCd: 'USER',
          ...(clarificationId ? { clarifyReplyTo: clarificationId } : {}),
          msgCont: text,
        },
      });
      await tx.aiJob.create({
        data: {
          id: requestId,
          chatSessId: id,
          inputMsgId: message.id,
          requestHash: hash,
          ...(context ? { caseContext: context.meta } : {}),
          providerCd: ids.length
            ? 'LOCAL_DOC'
            : context
              ? 'STORED_SEARCH'
              : 'DEMO',
          ownerAuthHash: owner.authHash,
          phaseCd: room.phaseCd,
          nextRunDttm: nowAtSecond(),
          rgstDttm: nowAtSecond(),
          deadlineDttm: new Date(nowAtSecond().getTime() + 300_000),
        },
      });
      if (ids.length)
        await tx.aiJobDoc.createMany({
          data: documents.map((doc) => ({
            jobId: requestId,
            attachDocId: doc.id,
            chatSessId: id,
            mdHash: createHash('sha256').update(doc.mdCont).digest('hex'),
          })),
        });
      await tx.chatSess.update({
        where: { id },
        data: { revNo: { increment: 1 }, nextMsgSeq: { increment: 1 } },
      });
    });
    this.kick();
    return {
      ...(await this.read(id, owner)),
      jobId: requestId,
      authExpiresAt: owner.expiresAt?.toISOString() ?? null,
    };
  }

  private noticeKey(citationId: bigint, targetSnapshotId: bigint) {
    return createHash('sha256')
      .update(citationId + ':' + targetSnapshotId)
      .digest('hex');
  }

  async confirmCorrection(
    id: string,
    messageId: string,
    key: string,
    owner: ChatOwner,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))`;
      await this.lockedRoom(tx, id, owner);
      if (
        !(await this.auth.ownerIsActive(
          owner.userId,
          owner.guestSessId,
          owner.authHash,
          tx,
        ))
      )
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      const citation = await tx.ansCite.findFirst({
        where: { msgId: messageId, message: { chatSessId: id, delYn: false } },
      });
      if (!citation)
        throw new NotFoundException('정정 안내를 찾을 수 없습니다.');
      const status = await this.citationStatus(citation, tx);
      const correction = status.correction;
      if (
        !correction ||
        this.noticeKey(citation.id, correction.targetSnapshotId) !== key
      )
        throw new ConflictException(
          '원문 상태가 바뀌었습니다. 최신 정정 안내를 확인해 주세요.',
        );
      const where = {
        ansCiteId_targetSnapshotId: {
          ansCiteId: citation.id,
          targetSnapshotId: correction.targetSnapshotId,
        },
      };
      const receipt =
        (await tx.citeNoticeRead.findUnique({ where })) ??
        (await tx.citeNoticeRead.create({
          data: {
            ansCiteId: citation.id,
            targetSnapshotId: correction.targetSnapshotId,
            userId: owner.userId,
            guestSessId: owner.guestSessId,
            kindCd: correction.kind,
            compareHref: correction.compareHref,
            currentHref: correction.currentHref,
            readDttm: nowAtSecond(),
          },
        }));
      return {
        key,
        readAt: receipt.readDttm.toISOString(),
        authExpiresAt: owner.expiresAt?.toISOString() ?? null,
      };
    });
  }

  async correctionHistory(
    id: string,
    owner: ChatOwner,
    offset = 0,
    limit = 20,
  ) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
      throw new BadRequestException('이력 페이지를 확인해 주세요.');
    return this.db.$transaction(
      async (tx) => {
        const visible = await tx.chatSess.findFirst({
          where: { id, ...visibleRoom(owner) },
          select: { id: true },
        });
        if (!visible) throw new NotFoundException('대화를 찾을 수 없습니다.');
        const rows = await tx.citeNoticeRead.findMany({
          where: { citation: { message: { chatSessId: id, delYn: false } } },
          orderBy: [{ readDttm: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          skip: offset,
          select: {
            id: true,
            kindCd: true,
            readDttm: true,
            compareHref: true,
            currentHref: true,
            citation: { select: { label: true, msgId: true } },
          },
        });
        return {
          items: rows.slice(0, limit).map(({ citation, ...row }) => ({
            id: row.id.toString(),
            kind: row.kindCd,
            readAt: row.readDttm.toISOString(),
            label: citation.label,
            messageId: citation.msgId,
            compareHref: row.compareHref,
            currentHref: row.currentHref,
          })),
          offset,
          nextOffset:
            rows.length > limit && offset < 100000
              ? Math.min(100000, offset + limit)
              : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async linkCase(
    id: string,
    owner: ChatOwner,
    revision: number,
    caseId: string | null,
    confirmed: boolean,
  ) {
    if (owner.userId === null)
      throw new ForbiddenException('사건 연결은 회원 전용입니다.');
    if (confirmed !== true)
      throw new BadRequestException('연결할 사건을 확인해 주세요.');
    const target = caseId?.toLowerCase() ?? null;
    await this.db.$transaction(async (tx) => {
      if (
        !(await this.auth.ownerIsActive(owner.userId, null, owner.authHash, tx))
      )
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      // Case deletion takes the same case-before-chat lock order.
      if (target) {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM user_case WHERE id=${target}::uuid AND user_id=${owner.userId} AND NOT del_yn FOR UPDATE`;
        if (!rows.length)
          throw new NotFoundException('사건을 찾을 수 없습니다.');
      }
      const room = await this.lockedRoom(tx, id, owner);
      if (room.userCaseId === target) return;
      if (room.revNo !== revision)
        throw new ConflictException(
          '다른 화면에서 대화가 변경됐습니다. 최신 내용을 확인해 주세요.',
        );
      if (
        await tx.aiJob.count({
          where: { chatSessId: id, statCd: { in: unfinished } },
        })
      )
        throw new ConflictException(
          '답변이 끝난 후 사건 연결을 변경해 주세요.',
        );
      await tx.chatSess.update({
        where: { id },
        data: {
          userCaseId: target,
          revNo: { increment: 1 },
          uptDttm: nowAtSecond(),
        },
      });
    });
    return this.read(id, owner);
  }

  async rename(id: string, owner: ChatOwner, revision: number, title: string) {
    const name = title.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (
      !name ||
      Array.from(name).length > 80 ||
      /[\p{Cc}\p{Surrogate}]/u.test(name)
    )
      throw new BadRequestException('대화 제목은 1~80자로 입력해 주세요.');
    await this.db.$transaction(async (tx) => {
      const room = await this.lockedRoom(tx, id, owner);
      if (
        !(await this.auth.ownerIsActive(
          owner.userId,
          owner.guestSessId,
          owner.authHash,
          tx,
        ))
      )
        throw new NotFoundException('대화를 찾을 수 없습니다.');
      if (room.revNo !== revision)
        throw new ConflictException(
          '다른 화면에서 대화가 변경됐습니다. 최신 내용을 확인해 주세요.',
        );
      if (room.sessNm !== name)
        await tx.chatSess.update({
          where: { id },
          data: {
            sessNm: name,
            revNo: { increment: 1 },
            uptDttm: nowAtSecond(),
          },
        });
    });
    return {
      ...(await this.read(id, owner)),
      authExpiresAt: owner.expiresAt?.toISOString() ?? null,
    };
  }

  async remove(id: string, owner: ChatOwner, revision: number) {
    await this.db.$transaction(async (tx) => {
      const room = await this.lockedRoom(tx, id, owner);
      if (room.revNo !== revision)
        throw new ConflictException(
          '대화가 변경됐습니다. 최신 내용을 확인해 주세요.',
        );
      await this.archive(tx, [id], owner.userId);
    });
  }

  private async archive(
    tx: Prisma.TransactionClient,
    ids: string[],
    actor: bigint | null,
  ) {
    const deletion = { delYn: true, delDttm: nowAtSecond(), delId: actor };
    await tx.chatSess.updateMany({
      where: { id: { in: ids }, delYn: false },
      data: { ...deletion, revNo: { increment: 1 } },
    });
    await tx.attachDoc.updateMany({
      where: { chatSessId: { in: ids }, delYn: false },
      data: deletion,
    });
    await tx.chatMsg.updateMany({
      where: { chatSessId: { in: ids }, delYn: false },
      data: deletion,
    });
    await tx.aiJob.updateMany({
      where: { chatSessId: { in: ids }, statCd: { in: unfinished } },
      data: { statCd: 'CANCELLED', leaseToken: null, leaseDttm: null },
    });
  }

  async expire() {
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM chat_sess WHERE guest_sess_id IS NOT NULL
          AND NOT del_yn AND expr_dttm <= clock_timestamp()
        ORDER BY expr_dttm, id FOR UPDATE SKIP LOCKED LIMIT 100
      `;
      if (rows.length)
        await this.archive(
          tx,
          rows.map((row) => row.id),
          null,
        );
    });
  }

  async caseContextOptions(
    id: string,
    owner: ChatOwner,
    limit = 20,
    offset = 0,
  ) {
    if (owner.userId === null)
      throw new ForbiddenException('사건 정보 활용은 회원 전용입니다.');
    if (
      ![10, 20, 50].includes(limit) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new BadRequestException();
    return this.db.$transaction(async (tx) => {
      const initial = await tx.chatSess.findFirst({
        where: { id, ...visibleRoom(owner) },
        select: { userCaseId: true },
      });
      if (initial?.userCaseId)
        await tx.$queryRaw`SELECT id FROM user_case WHERE id=${initial.userCaseId}::uuid AND user_id=${owner.userId} FOR SHARE`;
      const room = await this.lockedRoom(tx, id, owner);
      if (room.userCaseId !== initial?.userCaseId)
        throw new ConflictException('사건 연결이 변경되었습니다.');
      if (!room.userCaseId)
        throw new NotFoundException('연결된 사건이 없습니다.');
      await tx.$queryRaw`SELECT id FROM user_case WHERE id=${room.userCaseId}::uuid AND user_id=${owner.userId} FOR SHARE`;
      const parent = await tx.userCase.findFirst({
        where: { id: room.userCaseId, userId: owner.userId!, delYn: false },
        select: { id: true, revNo: true },
      });
      if (!parent) throw new NotFoundException('연결된 사건이 없습니다.');
      const where = {
        userCaseId: parent.id,
        delYn: false,
        verifyStatCd: 'USER_CONFIRMED',
      };
      const total = await tx.caseFact.count({ where });
      const rows = await tx.caseFact.findMany({
        where,
        orderBy: { id: 'asc' },
        take: limit,
        skip: offset,
        select: { id: true, factVal: true },
      });
      return {
        caseId: parent.id,
        revision: parent.revNo,
        items: rows.map((row) => ({
          id: row.id.toString(),
          ...cleanedFact(row.factVal),
        })),
        total,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
      };
    });
  }
  private async jobCaseContext(
    job: { caseContext: Prisma.JsonValue; chatSessId: string },
    userId: bigint | null,
    tx?: Prisma.TransactionClient,
  ) {
    if (!job.caseContext) return null;
    const check = async (database: Prisma.TransactionClient) => {
      try {
        const meta = job.caseContext as unknown as CaseContextMeta;
        const room = await database.chatSess.findFirst({
          where: { id: job.chatSessId, userId, delYn: false },
          select: { userCaseId: true },
        });
        if (!room || room.userCaseId !== meta.caseId) throw new Error();
        const current = await loadCaseContext(database, meta.caseId, userId, {
          revision: meta.revision,
          factIds: meta.factIds,
          asOf: meta.asOf,
          confirmed: true,
        });
        if (current.meta.hash !== meta.hash) throw new Error();
        return current;
      } catch {
        throw new Error('CaseContextChanged');
      }
    };
    return tx ? check(tx) : this.db.$transaction(check);
  }

  async job(id: string, owner: ChatOwner) {
    const job = await this.db.aiJob.findFirst({
      where: { id, chat: visibleRoom(owner) },
      select: {
        id: true,
        statCd: true,
        chatSessId: true,
        caseContext: true,
        input: { select: { msgSeq: true } },
      },
    });
    if (!job) throw new NotFoundException('작업을 찾을 수 없습니다.');
    return job;
  }

  async retry(id: string, owner: ChatOwner) {
    const job = await this.job(id, owner);
    await this.db.$transaction(async (tx) => {
      const ownerKey =
        owner.userId !== null
          ? 'chat-user:' + owner.userId
          : 'chat-guest:' + owner.guestSessId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerKey}, 0))`;
      if (job.caseContext) {
        const meta = job.caseContext as unknown as CaseContextMeta;
        await tx.$queryRaw`SELECT id FROM user_case WHERE id=${meta.caseId}::uuid AND user_id=${owner.userId} FOR SHARE`;
      }
      const room = await this.lockedRoom(tx, job.chatSessId, owner);
      if (
        (await tx.aiJob.count({
          where: { statCd: { in: unfinished }, chat: visibleRoom(owner) },
        })) >= 2
      ) {
        throw new ConflictException('진행 중인 답변을 기다려 주세요.');
      }
      if (room.nextMsgSeq !== job.input.msgSeq + 1)
        throw new ConflictException(
          '이후에 나눈 대화가 있어 이전 질문을 다시 실행할 수 없습니다.',
        );
      const retryJob = await tx.aiJob.findUniqueOrThrow({ where: { id } });
      if (retryJob.caseContext) {
        try {
          await this.jobCaseContext(retryJob, owner.userId, tx);
        } catch {
          throw new ConflictException(
            '사건이 변경되어 다시 실행할 수 없습니다. 사실관계를 다시 선택해 주세요.',
          );
        }
      }
      if (retryJob.providerCd === 'LOCAL_DOC') {
        try {
          await this.jobDocuments(id, job.chatSessId, owner.userId, tx);
        } catch {
          throw new ConflictException(
            '첨부자료가 삭제되었거나 변경되어 다시 실행할 수 없습니다.',
          );
        }
        if (!(await this.answers.documentsReady()))
          throw new ServiceUnavailableException(
            '첨부자료 답변용 로컬 AI가 준비되지 않았습니다.',
          );
      }
      const changed = await tx.aiJob.updateMany({
        where: { id, statCd: { in: ['FAILED', 'CANCELLED'] } },
        data: {
          statCd: 'QUEUED',
          resultCd: null,
          attemptNo: 0,
          deadlineDttm: new Date(nowAtSecond().getTime() + 300_000),
          errorCd: null,
          nextRunDttm: nowAtSecond(),
          ownerAuthHash: owner.authHash,
        },
      });
      if (!changed.count)
        throw new ConflictException('다시 시도할 수 없는 작업입니다.');
    });
    this.kick();
    return this.read(job.chatSessId, owner);
  }

  async cancel(id: string, owner: ChatOwner) {
    const job = await this.job(id, owner);
    await this.db.$transaction(async (tx) => {
      await this.lockedRoom(tx, job.chatSessId, owner);
      await tx.aiJob.updateMany({
        where: { id, statCd: { in: unfinished } },
        data: { statCd: 'CANCELLED', leaseToken: null, leaseDttm: null },
      });
    });
    return this.read(job.chatSessId, owner);
  }

  private async claim() {
    const now = nowAtSecond();
    const job = await this.db.aiJob.findFirst({
      where: {
        OR: [
          {
            statCd: { in: ['QUEUED', 'RETRY_WAIT'] },
            nextRunDttm: { lte: now },
          },
          { statCd: 'RUNNING', leaseDttm: { lte: now } },
        ],
      },
      orderBy: [{ rgstDttm: 'asc' }, { id: 'asc' }],
      include: {
        chat: true,
        input: { select: { msgCont: true, clarifyReplyTo: true } },
      },
    });
    if (!job) return null;
    const ownership = {
      id: job.id,
      statCd: job.statCd,
      leaseToken: job.leaseToken,
      attemptNo: job.attemptNo,
      deadlineDttm: job.deadlineDttm,
      ownerAuthHash: job.ownerAuthHash,
    };
    if (job.attemptNo >= 3 || job.deadlineDttm <= now) {
      await this.db.aiJob.updateMany({
        where: ownership,
        data: {
          statCd: 'FAILED',
          errorCd: 'ATTEMPTS_EXHAUSTED',
          leaseToken: null,
          leaseDttm: null,
        },
      });
      return null;
    }
    const leaseToken = randomUUID();
    const changed = await this.db.aiJob.updateMany({
      where: ownership,
      data: {
        statCd: 'RUNNING',
        leaseToken,
        leaseDttm: new Date(
          Math.min(now.getTime() + 90_000, job.deadlineDttm.getTime()),
        ),
        attemptNo: { increment: 1 },
      },
    });
    return changed.count
      ? { ...job, leaseToken, attemptNo: job.attemptNo + 1 }
      : null;
  }

  private currentLease(id: string, leaseToken: string): Prisma.AiJobWhereInput {
    return { id, statCd: 'RUNNING', leaseToken, leaseDttm: { gt: new Date() } };
  }

  private async jobDocuments(
    jobId: string,
    chatId: string,
    userId: bigint | null,
    tx: Prisma.TransactionClient = this.db,
  ): Promise<DocumentInput[]> {
    const links = await tx.aiJobDoc.findMany({
      where: { jobId, chatSessId: chatId },
      include: {
        document: {
          select: {
            id: true,
            docNm: true,
            mdCont: true,
            delYn: true,
            userId: true,
          },
        },
      },
    });
    if (
      !links.length ||
      links.length > 3 ||
      links.some(
        (row) =>
          row.document.delYn ||
          row.document.userId !== userId ||
          createHash('sha256').update(row.document.mdCont).digest('hex') !==
            row.mdHash,
      )
    )
      throw new Error('DocumentUnavailable');
    if (links.reduce((sum, row) => sum + row.document.mdCont.length, 0) > 12000)
      throw new Error('DocumentContextLimit');
    return links.map((row) => ({
      id: row.document.id,
      name: row.document.docNm,
      markdown: row.document.mdCont,
      mdHash: row.mdHash,
    }));
  }

  private async supplementQuestion(chatId: string, messageId: string) {
    const row = await this.db.chatMsg.findFirst({
      where: {
        id: messageId,
        chatSessId: chatId,
        roleCd: 'ASSISTANT',
        delYn: false,
        clarifyCd: { not: null },
      },
      select: {
        parent: {
          select: { msgCont: true, delYn: true, clarifyReplyTo: true },
        },
      },
    });
    if (!row?.parent || row.parent.delYn || row.parent.clarifyReplyTo)
      throw new Error('ClarificationUnavailable');
    return redactDocument(row.parent.msgCont);
  }

  async drain() {
    if (this.working) return;
    this.working = true;
    try {
      if (Date.now() >= this.nextExpirySweep) {
        this.nextExpirySweep = Date.now() + 60_000;
        await this.expire();
      }
      let job = await this.claim();
      while (job) {
        const { id, leaseToken } = job;
        const deadlineAt = job.deadlineDttm.getTime();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const heartbeat = setInterval(() => {
          void this.db.aiJob
            .updateMany({
              where: this.currentLease(id, leaseToken),
              data: {
                leaseDttm: new Date(
                  Math.min(nowAtSecond().getTime() + 90_000, deadlineAt),
                ),
              },
            })
            .catch(() => {});
        }, 20_000);
        heartbeat.unref();
        try {
          const room = job.chat;
          if (
            room.delYn ||
            (room.exprDttm && room.exprDttm <= new Date()) ||
            !(await this.auth.ownerIsActive(
              room.userId,
              room.guestSessId,
              job.ownerAuthHash,
            ))
          ) {
            await this.db.aiJob.updateMany({
              where: this.currentLease(id, leaseToken),
              data: { statCd: 'CANCELLED', leaseToken: null, leaseDttm: null },
            });
          } else {
            const context = await this.jobCaseContext(job, room.userId);
            const documentQuestion = job.input.msgCont;
            const previous = job.input.clarifyReplyTo
              ? await this.supplementQuestion(
                  job.chatSessId,
                  job.input.clarifyReplyTo,
                )
              : null;
            const supplementalContext = previous
              ? '보완 대상 질문: ' + previous + '\n' + (context?.text ?? '')
              : context?.text;
            const answer = await Promise.race([
              job.providerCd === 'LOCAL_DOC'
                ? this.jobDocuments(job.id, job.chatSessId, room.userId).then(
                    (documents) =>
                      this.answers.generateDocuments(
                        documentQuestion,
                        documents,
                        supplementalContext,
                      ),
                  )
                : previous && isUncertainSupplement(documentQuestion)
                  ? Promise.resolve({
                      phase: 'start' as const,
                      resultCd: 'FACTS_UNCONFIRMED' as const,
                      text: '확인되지 않은 사실은 추정하지 않겠습니다. 현재 저장된 근거만으로는 답변을 확정할 수 없습니다. 내용을 확인한 뒤 새 질문으로 이어가 주세요.',
                    })
                  : context || previous
                    ? this.answers.generateStored(
                        documentQuestion,
                        {
                          text: supplementalContext ?? '',
                          asOf: context?.meta.asOf,
                        },
                        Boolean(previous),
                      )
                    : this.answers.generate(documentQuestion, job.phaseCd),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(
                  () => reject(new Error('GenerationTimeout')),
                  Math.max(1, Math.min(180_000, deadlineAt - Date.now())),
                );
                deadline.unref();
              }),
            ]);
            await this.complete(
              job.chatSessId,
              id,
              leaseToken,
              answer,
              context
                ? { caseId: context.meta.caseId, userId: room.userId }
                : undefined,
            );
          }
        } catch (error) {
          const errorCd =
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : error instanceof Error
                ? error.name
                : 'UnknownError';
          this.logger.warn({ jobId: id, errorCd });
          await this.db.aiJob.updateMany({
            where: this.currentLease(id, leaseToken),
            data: {
              statCd:
                error instanceof Error && error.message === 'CaseContextChanged'
                  ? 'CANCELLED'
                  : job.attemptNo >= 3
                    ? 'FAILED'
                    : 'RETRY_WAIT',
              errorCd: generationErrorCode(error),
              leaseToken: null,
              leaseDttm: null,
              nextRunDttm: new Date(nowAtSecond().getTime() + 1000),
            },
          });
        } finally {
          clearInterval(heartbeat);
          if (deadline) clearTimeout(deadline);
        }
        job = this.stopping ? null : await this.claim();
      }
    } finally {
      this.working = false;
    }
  }

  private async complete(
    roomId: string,
    jobId: string,
    leaseToken: string,
    answer: PreparedAnswer,
    contextLock?: { caseId: string; userId: bigint | null },
  ) {
    await this.db.$transaction(async (tx) => {
      if (contextLock)
        await tx.$queryRaw`SELECT id FROM user_case WHERE id=${contextLock.caseId}::uuid AND user_id=${contextLock.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM chat_sess WHERE id = ${roomId}::uuid FOR UPDATE`;
      const job = await tx.aiJob.findFirst({
        where: this.currentLease(jobId, leaseToken),
        include: { chat: true },
      });
      if (!job) return;
      const room = job.chat;
      if (job.deadlineDttm <= new Date()) {
        await tx.aiJob.updateMany({
          where: this.currentLease(jobId, leaseToken),
          data: {
            statCd: 'FAILED',
            errorCd: 'TOTAL_TIMEOUT',
            leaseToken: null,
            leaseDttm: null,
          },
        });
        return;
      }
      if (
        room.delYn ||
        (room.exprDttm && room.exprDttm <= new Date()) ||
        !(await this.auth.ownerIsActive(
          room.userId,
          room.guestSessId,
          job.ownerAuthHash,
          tx,
        ))
      ) {
        await tx.aiJob.updateMany({
          where: this.currentLease(jobId, leaseToken),
          data: { statCd: 'CANCELLED', leaseToken: null, leaseDttm: null },
        });
        return;
      }
      await this.jobCaseContext(job, room.userId, tx);
      const documentInputs =
        job.providerCd === 'LOCAL_DOC'
          ? await this.jobDocuments(jobId, roomId, room.userId, tx)
          : [];
      if (
        job.providerCd === 'LOCAL_DOC' &&
        (!Array.isArray(answer.documentQuotes) ||
          answer.documentQuotes.length > 3 ||
          answer.documentQuotes.some(
            (quote) =>
              !documentInputs.some(
                (doc) =>
                  doc.id === quote.documentId &&
                  doc.mdHash === quote.mdHash &&
                  quote.quote.length >= 8 &&
                  quote.quote.length <= 1200 &&
                  doc.markdown.includes(quote.quote),
              ),
          ))
      )
        throw new Error('DocumentQuoteMismatch');
      if (answer.citation?.legalVerId) {
        await tx.$queryRaw`SELECT id FROM legal_ver_rev WHERE legal_ver_id = ${answer.citation.legalVerId} AND src_snapshot_id = ${answer.citation.srcSnapshotId} FOR SHARE`;
      } else if (answer.citation?.legalPrecId) {
        await tx.$queryRaw`SELECT id FROM legal_prec_rev WHERE legal_prec_id = ${answer.citation.legalPrecId} AND src_snapshot_id = ${answer.citation.srcSnapshotId} FOR SHARE`;
      }
      let citation: PreparedCitation | undefined = answer.citation;
      let text = answer.text;
      let resultCd =
        answer.resultCd ??
        (citation || answer.documentQuotes?.length
          ? 'EVIDENCE_FOUND'
          : 'GUIDANCE');
      if (citation && !(await this.citationIsCurrent(citation, tx))) {
        citation = undefined;
        resultCd = 'SOURCE_CHANGED';
        text =
          '원문 상태가 변경되어 답변을 보류했습니다. 최신 자료로 다시 질문해 주세요.';
      }
      const message = await tx.chatMsg.create({
        data: {
          chatSessId: roomId,
          prntMsgId: job.inputMsgId,
          msgSeq: room.nextMsgSeq,
          roleCd: 'ASSISTANT',
          ...(answer.clarifyCd ? { clarifyCd: answer.clarifyCd } : {}),
          msgCont: text,
          ...(citation ? { citations: { create: citation } } : {}),
        },
      });
      if (job.providerCd === 'LOCAL_DOC' && answer.documentQuotes?.length)
        await tx.docQuote.createMany({
          data: answer.documentQuotes.map((quote) => ({
            chatSessId: roomId,
            msgId: message.id,
            attachDocId: quote.documentId,
            quote: quote.quote,
            mdHash: quote.mdHash,
          })),
        });
      const finalized = await tx.aiJob.updateMany({
        where: this.currentLease(jobId, leaseToken),
        data: {
          statCd: 'SUCCEEDED',
          resultCd,
          ...(answer.providerCd ? { providerCd: answer.providerCd } : {}),
          answerMsgId: message.id,
          leaseToken: null,
          leaseDttm: null,
          errorCd: null,
        },
      });
      if (!finalized.count)
        throw new ConflictException('작업 점유가 변경됐습니다.');
      await tx.chatSess.update({
        where: { id: roomId },
        data: {
          nextMsgSeq: { increment: 1 },
          revNo: { increment: 1 },
          phaseCd: answer.phase,
        },
      });
    });
  }
}
