import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { TermData } from './terms.dto.js';
const idPattern = /^[1-9]\d{0,11}$/;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('TERM_SOURCE_INVALID');
  return value as Record<string, unknown>;
};
function string(value: unknown, max: number, required = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error('TERM_SOURCE_INVALID');
  return value;
}
function integer(value: unknown) {
  if (!(
    typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ))
    throw new Error('TERM_SOURCE_INVALID');
  const n = Number(value);
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    value === '' ||
    value === null ||
    value === undefined
  )
    throw new Error('TERM_SOURCE_INVALID');
  return n;
}
export function officialTermUrl(id: string) {
  if (!idPattern.test(id)) throw new Error('TERM_SOURCE_INVALID');
  return 'https://www.law.go.kr/LSW/lsTrmInfoR.do?trmSeqs=' + id;
}
export function sourceFingerprint(data: {
  termName: string;
  definition: string;
  sourceName: string;
  sourceReference?: string | null;
  sourceUrl?: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [
          data.termName,
          data.definition,
          data.sourceName,
          data.sourceReference ?? '',
          data.sourceUrl ?? '',
        ].map((v) => v.normalize('NFC').replace(/\s/gu, '')),
      ),
    )
    .digest('hex');
}
export function parseTermSearch(payload: unknown, page: number, limit: number) {
  const root = record(record(payload).LsTrmSearch);
  if (root.resultCode !== '00') throw new Error('TERM_SOURCE_INVALID');
  const total = integer(root.totalCnt);
  if (integer(root.page) !== page) throw new Error('TERM_SOURCE_INVALID');
  const entries =
    root.lstrm === undefined || root.lstrm === null || root.lstrm === ''
      ? []
      : Array.isArray(root.lstrm)
        ? root.lstrm
        : [root.lstrm];
  if (entries.length > limit || entries.length > total)
    throw new Error('TERM_SOURCE_INVALID');
  // The provider groups identical names into comma-separated IDs; split meanings by source ID.
  const expanded = entries.flatMap((value) => {
    const entry = record(value),
      ids = string(entry['법령용어ID'], 1300)
        .split(',')
        .map((id) => id.trim());
    if (ids.length > 100 || ids.some((id) => !idPattern.test(id)))
      throw new Error('TERM_SOURCE_INVALID');
    const termName = string(entry['법령용어명'], 1000),
      dictionaryCode = string(entry['사전구분코드'], 20);
    return ids.map((sourceId) => ({
      sourceId,
      termName,
      dictionaryCode,
      sourceUrl: officialTermUrl(sourceId),
    }));
  });
  if (expanded.length > 1000) throw new Error('TERM_SOURCE_INVALID');
  const items = [
    ...new Map(expanded.map((item) => [item.sourceId, item])).values(),
  ];
  return {
    items,
    total,
    page,
    limit,
    nextPage: page * limit < total && page < 1000 ? page + 1 : null,
  };
}
export function parseTermDetail(payload: unknown, sourceId: string): TermData {
  const root = record(record(payload).LsTrmService),
    ids = Array.isArray(root['법령용어일련번호'])
      ? root['법령용어일련번호']
      : [root['법령용어일련번호']];
  const at = ids.indexOf(sourceId);
  if (at < 0 || ids.filter((v) => v === sourceId).length !== 1)
    throw new Error('TERM_SOURCE_INVALID');
  function field(name: string, max: number, required = true) {
    const value = root[name];
    if (value === undefined && !required) return '';
    if (Array.isArray(value)) {
      if (value.length !== ids.length) throw new Error('TERM_SOURCE_INVALID');
      return string(value[at], max, required);
    }
    if (ids.length !== 1) throw new Error('TERM_SOURCE_INVALID');
    return string(value, max, required);
  }
  const termName = field('법령용어명_한글', 100),
    definition = field('법령용어정의', 10000),
    kind = field('법령용어코드명', 200),
    hanja = field('법령용어명_한자', 100, false),
    reference = field('출처', 3700, false);
  return {
    termName,
    definition,
    aliases:
      hanja && hanja !== termName && /\p{Script=Han}/u.test(hanja)
        ? [hanja]
        : [],
    explanation: '',
    sourceName: '국가법령정보센터',
    sourceUrl: officialTermUrl(sourceId),
    sourceReference: kind + (reference ? ' · ' + reference : ''),
  };
}
@Injectable()
export class MolegTermsClient {
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  private lastRequest = 0;
  constructor(private readonly config: ConfigService) {}
  private async request(
    route: 'lawSearch.do' | 'lawService.do',
    params: Record<string, string>,
  ) {
    const oc = this.config.get<string>('MOLEG_OC')?.trim();
    if (!oc || oc.length > 200)
      throw new ServiceUnavailableException(
        '법제처 API 인증 설정을 확인해 주세요.',
      );
    if (this.waiting >= 30)
      throw new ServiceUnavailableException(
        '법제처 조회가 많습니다. 잠시 후 다시 시도해 주세요.',
      );
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((done) => (release = done));
    this.waiting++;
    await previous;
    try {
      await delay(Math.max(0, 500 - (Date.now() - this.lastRequest)));
      this.lastRequest = Date.now();
      const url = new URL('https://www.law.go.kr/DRF/' + route);
      url.search = new URLSearchParams({
        OC: oc,
        target: 'lstrm',
        type: 'JSON',
        ...params,
      }).toString();
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('TERM_SOURCE_UNAVAILABLE');
      }
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024 * 1024) {
            await reader.cancel();
            throw new Error('TERM_SOURCE_LIMIT');
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const raw = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(Buffer.concat(parts));
      const payload: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
      // Raw successful evidence must never persist a request credential echoed by the provider.
      if (
        route === 'lawService.do' &&
        (raw.includes(oc) || JSON.stringify(payload).includes(oc))
      )
        throw new Error('TERM_SOURCE_CREDENTIAL');
      return {
        raw,
        payload,
        rawHash: createHash('sha256').update(raw).digest('hex'),
      };
    } catch {
      throw new ServiceUnavailableException(
        '법제처 용어 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      this.waiting--;
      release();
    }
  }
  async search(
    query: string,
    page: number,
    limit: number,
    sort: 'newest' | 'oldest' = 'newest',
  ) {
    const q = query.trim().normalize('NFC');
    if (!q)
      throw new BadRequestException('가져올 용어의 검색어를 입력해 주세요.');
    const { payload } = await this.request('lawSearch.do', {
      query: q,
      page: String(page),
      display: String(limit),
      sort: sort === 'oldest' ? 'rasc' : 'rdes',
    });
    try {
      return parseTermSearch(payload, page, limit);
    } catch {
      throw new ServiceUnavailableException(
        '법제처 용어 목록 형식을 확인하지 못했습니다.',
      );
    }
  }
  async detail(id: string) {
    if (!idPattern.test(id))
      throw new BadRequestException('법제처 용어 번호를 확인해 주세요.');
    const result = await this.request('lawService.do', { trmSeqs: id });
    try {
      return { ...result, data: parseTermDetail(result.payload, id) };
    } catch {
      throw new ServiceUnavailableException(
        '법제처 용어 원문을 확인하지 못했습니다.',
      );
    }
  }
}
