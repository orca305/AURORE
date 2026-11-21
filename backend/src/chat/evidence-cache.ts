/**
 * 법령 원문(검증용 스냅샷을 조각낸 것) 메모리 캐시: 개수가 아니라 용량으로 관리하고, 자주 쓰는 법령은 상시 유지한다.
 *
 * - 비용은 원문 글자 수 × 12 로 어림한 힙 사용량이다(실측: 소득세법 753KB → 약 10MB, 도로교통법 382KB → 약 5MB).
 * - 상시 유지(pinned) 법령은 밀어내지 않는다. 상시 유지 총량이 상한(AURORE_EVIDENCE_PIN_MB, 기본 96MB)을 넘으면 그 뒤 법령은 일반 항목으로 둔다.
 * - 일반 항목은 총량이 상한(AURORE_EVIDENCE_CACHE_MB, 기본 64MB)을 넘으면 가장 오래 안 쓴 것부터 밀어낸다.
 *   방금 넣은 항목 하나는 상한보다 커도 남긴다(그 질문에서 필요하므로).
 * - AURORE_EVIDENCE_PIN=0 이면 상시 유지를 끈다.
 */
export const HEAP_PER_CHAR = 12;
const mb = (name: string, fallback: number) => Math.max(8, Number(process.env[name] ?? fallback) || fallback) * 1048576;

/** 일상 질문에 가장 자주 해당하는 법령(상시 유지). 크기·빈도를 보고 골랐다. 이름이 DB와 다르면 유지되지 않을 뿐 동작에는 영향이 없다. */
export const PINNED_LAWS: readonly string[] = [
  '민법', '형법', '민사소송법', '형사소송법',
  '근로기준법', '근로자퇴직급여 보장법', '최저임금법', '고용보험법', '산업재해보상보험법',
  '주택임대차보호법', '상가건물 임대차보호법',
  '도로교통법', '교통사고처리 특례법',
  '개인정보 보호법', '소비자기본법', '전자상거래 등에서의 소비자보호에 관한 법률',
  '소득세법', '부가가치세법', '국민연금법', '국민건강보험법', '가족관계의 등록 등에 관한 법률',
];
const pinnedSet = new Set(PINNED_LAWS);
export const isPinnedLaw = (name: string) => process.env.AURORE_EVIDENCE_PIN !== '0' && pinnedSet.has(name);

type Entry<T> = { value: T; cost: number; pinned: boolean };

export class EvidenceCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private normalBytes = 0;
  private pinnedBytes = 0;
  constructor(
    private readonly normalLimit = mb('AURORE_EVIDENCE_CACHE_MB', 64),
    private readonly pinLimit = mb('AURORE_EVIDENCE_PIN_MB', 96),
  ) {}

  get(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }
  has(key: string) {
    return this.entries.has(key);
  }
  /** 최근에 쓴 것으로 표시한다(일반 항목만 순서가 의미 있다). */
  touch(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
  set(key: string, value: T, sourceChars: number, pinned = false) {
    this.delete(key);
    const cost = sourceChars * HEAP_PER_CHAR;
    const pin = pinned && this.pinnedBytes + cost <= this.pinLimit;
    this.entries.set(key, { value, cost, pinned: pin });
    if (pin) this.pinnedBytes += cost;
    else this.normalBytes += cost;
    this.evict(key);
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.pinned) this.pinnedBytes -= entry.cost;
    else this.normalBytes -= entry.cost;
  }
  private evict(keep: string) {
    for (const [key, entry] of this.entries) {
      if (this.normalBytes <= this.normalLimit) break;
      if (entry.pinned || key === keep) continue;
      this.delete(key);
    }
  }
  stats() {
    return { entries: this.entries.size, normalMB: this.normalBytes / 1048576, pinnedMB: this.pinnedBytes / 1048576 };
  }
}
