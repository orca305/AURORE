import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
type Owner = ChatOwner & { userId: bigint };
const visible = {
  delYn: false,
  event: {
    delYn: false,
    OR: [
      {
        legalId: { not: null },
        legal: { delYn: false },
        version: { delYn: false, legal: { delYn: false } },
      },
      {
        legalPrecId: { not: null },
        precedent: { delYn: false, revisions: { some: { currentYn: true } } },
      },
    ],
  },
} satisfies Prisma.UserNtfWhereInput;
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private task?: Promise<unknown>;
  private stopping = false;
  private lastSuccessAt: string | null = null;
  private failed = false;
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => this.kick(), 60000);
    this.timer.unref();
    this.kick();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.task?.catch(() => {});
  }
  private kick() {
    if (this.stopping || this.task) return;
    const task = this.sync();
    this.task = task;
    void task
      .catch(() => {
        this.failed = true;
        this.logger.warn('NOTIFICATION_SYNC_FAILED');
      })
      .finally(() => {
        if (this.task === task) this.task = undefined;
      });
  }
  async sync(now = new Date(Math.floor(Date.now() / 1000) * 1000)) {
    if (!Number.isFinite(now.valueOf()))
      throw new Error('Invalid notification time');
    const result = await this.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext('aurore-legal-notifications')) AS locked`;
        if (!lock.locked) return { skipped: true, events: 0, delivered: 0 };
        // ponytail: lock interested members first in this small beta; batch this scan before scaling to many members.
        const members = await tx.$queryRaw<
          { id: bigint }[]
        >`SELECT u.id FROM app_user u WHERE EXISTS(SELECT 1 FROM user_bmark b WHERE b.user_id=u.id AND NOT b.del_yn AND (b.legal_id IS NOT NULL OR b.legal_prec_id IS NOT NULL)) ORDER BY u.id FOR SHARE`;
        const events = await tx.$executeRaw`
WITH interested AS (
 SELECT b.legal_id,min(b.rgst_dttm) AS since FROM user_bmark b
 JOIN app_user u ON u.id=b.user_id
 JOIN cmmn_cd s ON s.id=u.stat_cd_id JOIN cmmn_cd g ON g.id=s.prnt_cd_id JOIN cmmn_cd root ON root.id=g.prnt_cd_id
 WHERE NOT b.del_yn AND b.legal_id IS NOT NULL AND NOT u.del_yn AND s.cd='ACTIVE' AND g.cd='USER_STAT' AND root.cd='AURORE' AND root.node_type_cd='ROOT' AND root.prnt_cd_id IS NULL
 AND s.use_yn AND NOT s.del_yn AND g.use_yn AND NOT g.del_yn AND root.use_yn AND NOT root.del_yn GROUP BY b.legal_id
), revisions AS MATERIALIZED (
 SELECT r.*,v.legal_id,v.prml_dt,v.enfc_dt,l.legal_nm,i.since FROM legal_ver_rev r
 JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id JOIN interested i ON i.legal_id=l.id
 WHERE NOT l.del_yn AND NOT v.del_yn AND r.src_snapshot_id IS NOT NULL AND r.rgst_dttm<=${now}
), texts AS (
 SELECT p.legal_ver_rev_id,md5(jsonb_agg(jsonb_build_array(p.provi_type_cd,regexp_replace(p.disp_no,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(coalesce(p.provi_nm,''),'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(p.provi_cont,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),p.enfc_dt::text) ORDER BY p.sort_seq,p.id)::text) AS semantic_hash
 FROM legal_provi p JOIN revisions r ON r.id=p.legal_ver_rev_id WHERE NOT p.del_yn GROUP BY p.legal_ver_rev_id
), candidates AS (
 SELECT 'PROMULGATED:'||r.legal_ver_id||':'||r.prml_dt::text AS key,r.legal_id,r.legal_ver_id,r.id AS src_rev_id,NULL::bigint AS bf_rev_id,'PROMULGATED'::text AS kind,'VERSION'::text AS scope,r.prml_dt AS base_dt,r.prml_dt::timestamp AT TIME ZONE 'Asia/Seoul' AS occurred,r.legal_nm,r.since FROM revisions r WHERE r.current_yn AND r.prml_dt IS NOT NULL
 UNION ALL
 SELECT 'EFFECTIVE:'||r.legal_ver_id||':'||r.enfc_dt::text,r.legal_id,r.legal_ver_id,r.id,NULL::bigint,'EFFECTIVE','VERSION',r.enfc_dt,r.enfc_dt::timestamp AT TIME ZONE 'Asia/Seoul',r.legal_nm,r.since FROM revisions r WHERE r.current_yn AND r.enfc_dt IS NOT NULL
 UNION ALL
 SELECT DISTINCT 'EFFECTIVE:'||r.legal_ver_id||':'||p.enfc_dt::text,r.legal_id,r.legal_ver_id,r.id,NULL::bigint,'EFFECTIVE','PROVISIONS',p.enfc_dt,p.enfc_dt::timestamp AT TIME ZONE 'Asia/Seoul',r.legal_nm,r.since FROM revisions r JOIN legal_provi p ON p.legal_ver_rev_id=r.id WHERE r.current_yn AND NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND p.enfc_dt IS NOT NULL AND p.enfc_dt IS DISTINCT FROM r.enfc_dt
 UNION ALL
 SELECT 'CORRECTED:'||r.id,r.legal_id,r.legal_ver_id,r.id,prior.id,'CORRECTED','VERSION',(r.rgst_dttm AT TIME ZONE 'Asia/Seoul')::date,r.rgst_dttm,r.legal_nm,r.since FROM revisions r
 JOIN LATERAL(SELECT old.id FROM revisions old WHERE old.legal_ver_id=r.legal_ver_id AND old.rev_no<r.rev_no ORDER BY old.rev_no DESC LIMIT 1) prior ON true
 JOIN texts a ON a.legal_ver_rev_id=r.id JOIN texts b ON b.legal_ver_rev_id=prior.id WHERE a.semantic_hash<>b.semantic_hash
)
INSERT INTO legal_chg_evt(evt_key,legal_id,legal_ver_id,src_rev_id,bf_rev_id,evt_type_cd,scope_cd,base_dt,evt_dttm,evt_title,evt_cont,rgst_dttm)
SELECT c.key,c.legal_id,c.legal_ver_id,c.src_rev_id,c.bf_rev_id,c.kind,c.scope,c.base_dt,c.occurred,
 left(c.legal_nm||CASE c.kind WHEN 'PROMULGATED' THEN ' · 공포' WHEN 'CORRECTED' THEN ' · 원문 정정' ELSE CASE WHEN c.scope='PROVISIONS' THEN ' · 일부 조문 시행' ELSE ' · 시행' END END,300),
 CASE c.kind WHEN 'PROMULGATED' THEN c.base_dt::text||' 공포일의 법령 자료가 등록되었습니다. 시행일과 적용 조건은 별도로 확인해 주세요.' WHEN 'CORRECTED' THEN '같은 법적 버전의 저장 원문에 내용 정정이 반영되었습니다. 법률 개정과 구분해 정정 전후 원문을 확인해 주세요.' ELSE c.base_dt::text||CASE WHEN c.scope='PROVISIONS' THEN ' 별도 시행일이 지정된 조문이 있습니다. 구체적인 조문과 적용 조건을 확인해 주세요.' ELSE ' 시행일에 도달한 법령 자료입니다. 개별 사건의 적용 여부는 별도로 확인해 주세요.' END END,${now}
FROM candidates c WHERE c.occurred>=c.since AND c.occurred<=${now} AND NOT EXISTS(SELECT 1 FROM legal_chg_evt e WHERE e.evt_key=c.key)
ORDER BY c.occurred,c.key LIMIT 100 ON CONFLICT(evt_key) DO NOTHING`;
        const precedentEvents = await tx.$executeRaw`
WITH interested AS (
 SELECT b.legal_prec_id,min(b.rgst_dttm) AS since FROM user_bmark b JOIN app_user u ON u.id=b.user_id
 JOIN cmmn_cd c ON c.id=u.stat_cd_id JOIN cmmn_cd g ON g.id=c.prnt_cd_id JOIN cmmn_cd root ON root.id=g.prnt_cd_id
 WHERE NOT b.del_yn AND b.legal_prec_id IS NOT NULL AND NOT u.del_yn AND c.cd='ACTIVE' AND g.cd='USER_STAT' AND root.cd='AURORE' AND root.prnt_cd_id IS NULL AND root.node_type_cd='ROOT'
 AND c.use_yn AND NOT c.del_yn AND g.use_yn AND NOT g.del_yn AND root.use_yn AND NOT root.del_yn GROUP BY b.legal_prec_id
), revisions AS MATERIALIZED (
 SELECT r.*,i.since,md5(jsonb_build_array(regexp_replace(r.case_no,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(r.case_nm,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(r.court_nm,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),r.decision_dt::text,regexp_replace(coalesce(r.issue_cont,''),'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(coalesce(r.summary_cont,''),'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'),regexp_replace(r.decision_cont,'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','','g'))::text) AS semantic_hash
 FROM legal_prec_rev r JOIN legal_prec p ON p.id=r.legal_prec_id JOIN interested i ON i.legal_prec_id=p.id WHERE NOT p.del_yn AND r.rgst_dttm<=${now}
 AND EXISTS(SELECT 1 FROM legal_prec_rev current WHERE current.legal_prec_id=p.id AND current.current_yn)
)
INSERT INTO legal_chg_evt(evt_key,legal_prec_id,src_prec_rev_id,bf_prec_rev_id,evt_type_cd,scope_cd,base_dt,evt_dttm,evt_title,evt_cont,rgst_dttm)
SELECT 'PREC_CORRECTED:'||r.id,r.legal_prec_id,r.id,prior.id,'CORRECTED','VERSION',(r.rgst_dttm AT TIME ZONE 'Asia/Seoul')::date,r.rgst_dttm,left(r.case_nm||' · 판례 원문 정정',300),'같은 판례의 저장 원문에 내용 정정이 반영되었습니다. 새 판결 선고와 구분해 정정 전후 원문을 확인해 주세요.',${now}
FROM revisions r JOIN LATERAL(SELECT old.id,old.semantic_hash FROM revisions old WHERE old.legal_prec_id=r.legal_prec_id AND old.rev_no<r.rev_no ORDER BY old.rev_no DESC LIMIT 1) prior ON true
WHERE r.rgst_dttm>=r.since AND r.semantic_hash<>prior.semantic_hash AND NOT EXISTS(SELECT 1 FROM legal_chg_evt e WHERE e.evt_key='PREC_CORRECTED:'||r.id)
ORDER BY r.rgst_dttm,r.id LIMIT 100 ON CONFLICT(evt_key) DO NOTHING`;
        const delivered = members.length
          ? await tx.$executeRaw`
INSERT INTO user_ntf(user_id,evt_id,rgst_dttm)
SELECT b.user_id,e.id,${now} FROM user_bmark b JOIN app_user u ON u.id=b.user_id
JOIN cmmn_cd s ON s.id=u.stat_cd_id JOIN cmmn_cd g ON g.id=s.prnt_cd_id JOIN cmmn_cd root ON root.id=g.prnt_cd_id
JOIN legal_chg_evt e ON (e.legal_id=b.legal_id OR e.legal_prec_id=b.legal_prec_id) LEFT JOIN legal l ON l.id=e.legal_id LEFT JOIN legal_ver v ON v.id=e.legal_ver_id LEFT JOIN legal_prec prec ON prec.id=e.legal_prec_id
WHERE b.user_id IN (${Prisma.join(members.map((member) => member.id))}) AND NOT b.del_yn AND NOT u.del_yn AND s.cd='ACTIVE' AND g.cd='USER_STAT' AND root.cd='AURORE' AND root.node_type_cd='ROOT' AND root.prnt_cd_id IS NULL
AND s.use_yn AND NOT s.del_yn AND g.use_yn AND NOT g.del_yn AND root.use_yn AND NOT root.del_yn
AND NOT e.del_yn AND ((e.legal_id IS NOT NULL AND NOT l.del_yn AND NOT v.del_yn) OR (e.legal_prec_id IS NOT NULL AND NOT prec.del_yn AND EXISTS(SELECT 1 FROM legal_prec_rev current WHERE current.legal_prec_id=prec.id AND current.current_yn))) AND b.rgst_dttm<=e.evt_dttm AND e.evt_dttm<=${now}
AND NOT EXISTS(SELECT 1 FROM user_ntf n WHERE n.user_id=b.user_id AND n.evt_id=e.id)
ORDER BY b.user_id,b.id,e.id LIMIT 500 FOR SHARE OF b ON CONFLICT(user_id,evt_id) DO NOTHING`
          : 0;
        return { skipped: false, events: events + precedentEvents, delivered };
      },
      { timeout: 30000 },
    );
    if (!result.skipped) {
      this.lastSuccessAt = now.toISOString();
      this.failed = false;
    }
    return result;
  }
  private async active(tx: Prisma.TransactionClient, owner: Owner) {
    if (
      !(await this.auth.ownerIsActive(owner.userId, null, owner.authHash, tx))
    )
      throw new UnauthorizedException('다시 로그인해 주세요.');
  }
  async unread(owner: Owner) {
    return this.db.$transaction(async (tx) => {
      await this.active(tx, owner);
      return {
        count: await tx.userNtf.count({
          where: { userId: owner.userId, readDttm: null, AND: [visible] },
        }),
      };
    });
  }
  async list(
    owner: Owner,
    query: {
      sort?: 'newest' | 'oldest';
      filter: 'ALL' | 'UNREAD';
      kind: 'ALL' | 'PROMULGATED' | 'EFFECTIVE' | 'CORRECTED';
      limit: number;
      offset: number;
    },
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.active(tx, owner);
        const base: Prisma.UserNtfWhereInput = {
          userId: owner.userId,
          AND: [visible],
        };
        const where: Prisma.UserNtfWhereInput = {
          ...base,
          ...(query.filter === 'UNREAD' ? { readDttm: null } : {}),
          ...(query.kind === 'ALL'
            ? {}
            : { event: { ...visible.event, evtTypeCd: query.kind } }),
        };
        const total = await tx.userNtf.count({ where }),
          unreadCount = await tx.userNtf.count({
            where: { ...base, readDttm: null },
          });
        const through = await tx.userNtf.aggregate({
          where: base,
          _max: { id: true },
        });
        const rows = await tx.userNtf.findMany({
          where,
          orderBy: [{ id: query.sort==='oldest'?'asc':'desc' }],
          skip: query.offset,
          take: query.limit,
          include: { event: true },
        });
        return {
          total,
          unreadCount,
          readThroughId: through._max.id ? String(through._max.id) : null,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
          sync: { lastSuccessAt: this.lastSuccessAt, failed: this.failed },
          items: rows.map((row) => {
            const e = row.event;
            return {
              id: String(row.id),
              kind: e.evtTypeCd,
              targetKind: e.legalPrecId ? 'PREC' : 'LEGAL',
              scope: e.scopeCd,
              title: e.evtTitle,
              content: e.evtCont,
              baseDate: e.baseDt.toISOString().slice(0, 10),
              occurredAt: e.evtDttm.toISOString(),
              deliveredAt: row.rgstDttm.toISOString(),
              readAt: row.readDttm?.toISOString() ?? null,
              href: e.legalPrecId
                ? '/precedents/' +
                  e.legalPrecId +
                  '/compare?' +
                  new URLSearchParams({
                    beforeRevisionId: String(e.bfPrecRevId),
                    afterRevisionId: String(e.srcPrecRevId),
                  })
                : e.evtTypeCd === 'CORRECTED'
                  ? '/legals/' +
                    e.legalId +
                    '/compare?' +
                    new URLSearchParams({
                      beforeVersionId: String(e.legalVerId),
                      afterVersionId: String(e.legalVerId),
                      beforeRevisionId: String(e.bfRevId),
                      afterRevisionId: String(e.srcRevId),
                    })
                  : '/legals/' + e.legalId + '/versions/' + e.legalVerId,
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async markRead(owner: Owner, id: bigint, all = false) {
    return this.db.$transaction(async (tx) => {
      await this.active(tx, owner);
      const where = {
        userId: owner.userId,
        AND: [visible],
        ...(all ? { id: { lte: id } } : { id }),
      };
      if (
        !all &&
        !(await tx.userNtf.findFirst({ where, select: { id: true } }))
      )
        throw new NotFoundException('알림을 찾을 수 없습니다.');
      await tx.userNtf.updateMany({
        where: { ...where, readDttm: null },
        data: { readDttm: new Date(Math.floor(Date.now() / 1000) * 1000) },
      });
      return { read: true };
    });
  }
}
