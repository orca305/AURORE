import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 법령별 조문 임베딩의 평균(중심 벡터, bge-m3 int8)으로 질문과 뜻이 가까운 법령을 찾는다.
 * 질문 분석 AI가 법령을 짚지 못한 질문(예: 학원 폐업 환불 → 학원법)에서도 후보 법령을 얻기 위한 보조 수단이며,
 * 결과는 후보 순위용일 뿐 근거로 쓰이지 않는다(인용은 항상 공식 원문 검증을 거친다).
 * 파일은 backend/tools/embed-law-titles.mjs 로 만든다. 없으면 빈 목록. AURORE_LAW_TITLES=0 으로 끈다.
 */
type TitleIndex = { names: string[]; vectors: Int8Array; dims: number };
let loading: Promise<TitleIndex | null> | null = null;

const directory = () => process.env.AURORE_LAW_TITLE_DIR ?? 'D:/DATA/embeddings/law-titles';
export const lawTitlesEnabled = () => process.env.AURORE_LAW_TITLES !== '0';

async function load(): Promise<TitleIndex | null> {
  const dir = directory();
  try {
    if (!existsSync(join(dir, 'manifest.json'))) return null;
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { model: string; dims: number; count: number };
    if (manifest.model !== 'bge-m3' || manifest.dims !== 1024) return null;
    const names = (JSON.parse(await readFile(join(dir, 'names.json'), 'utf8')) as string[]).slice(0, manifest.count);
    const bytes = await readFile(join(dir, 'vectors.bin'));
    if (bytes.length !== names.length * manifest.dims) return null;
    return { names, vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), dims: manifest.dims };
  } catch {
    return null;
  }
}
const index = () => (loading ??= load().then((value) => { if (!value) loading = null; return value; }));

/** 법령 인덱스를 미리 읽어 둔다. */
export const warmLawTitles = () => (lawTitlesEnabled() ? index().then(() => undefined) : Promise.resolve());

/** 질문 벡터와 코사인 유사도가 큰 법령 이름 상위 n개. */
export async function searchLawTitles(query: Int8Array, n = 3): Promise<{ name: string; score: number }[]> {
  if (!lawTitlesEnabled()) return [];
  const data = await index();
  if (!data) return [];
  const best: { i: number; s: number }[] = [];
  for (let i = 0, base = 0; i < data.names.length; i++, base += data.dims) {
    let s = 0;
    for (let k = 0; k < data.dims; k++) s += data.vectors[base + k] * query[k];
    best.push({ i, s });
  }
  best.sort((a, b) => b.s - a.s);
  return best.slice(0, n).map(({ i, s }) => ({ name: data.names[i], score: s / (127 * 127) }));
}
