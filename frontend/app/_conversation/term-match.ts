// 답변 텍스트에서 법률용어를 찾는 순수 함수. 가장 긴 이름을 먼저 맞추고 겹치지 않으며, 같은 용어는 첫 번째만 표시한다.
// taken: 이미 앞 문장에서 표시한 용어 번호(여러 조각에 걸쳐 같은 용어를 한 번만 표시할 때 공유). allow: 이 조각에서 표시해도 되는 용어 번호만.
// law: 정의를 인용해 온 법령 이름(없으면 어디서나 표시한다).
export type GlossaryTerm={id:string;termName:string;aliases:string[];brief:string;easy:boolean;law?:string};
export type TextPart={text:string;term?:GlossaryTerm};
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function splitByTerms(text:string,terms:GlossaryTerm[],allow?:Set<string>,taken?:Set<string>):TextPart[]{
 const names=new Map<string,GlossaryTerm>();
 // 용어 이름을 모두 넣은 뒤 동의어를 넣는다. 다른 용어의 동의어가 이름을 가로채지 않게 하기 위해서다.
 const entries=[...terms.map(term=>[term.termName,term] as const),...terms.flatMap(term=>term.aliases.map(alias=>[alias,term] as const))];
 for(const [name,term] of entries){
  const key=name.normalize('NFC').trim();
  // 한 글자 이름은 오탐이 많아 제외한다. 같은 이름이 여러 용어에 있으면 먼저 온 용어를 쓴다.
  if(key.length>=2&&!names.has(key))names.set(key,term);
 }
 if(!names.size||!text)return [{text}];
 const pattern=new RegExp([...names.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|'),'gu');
 const parts:TextPart[]=[],used=taken??new Set<string>();let last=0;
 for(const match of text.matchAll(pattern)){
  const term=names.get(match[0]);
  if(!term||used.has(term.id)||(allow&&!allow.has(term.id)))continue;
  // 앞 글자가 한글·영문·숫자면 낱말 중간이라 용어로 보지 않는다(예: 사고발생 안의 "고발").
  if(match.index>0&&/[가-힣A-Za-z0-9]/u.test(text[match.index-1]))continue;
  used.add(term.id);
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({text:match[0],term});
  last=match.index+match[0].length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});
 return parts.length?parts:[{text}];
}

// 어느 주제의 답변에서나 같은 뜻으로 쓰는 일반법. 그 밖의 법에서 가져온 용어는 답변이 그 법을 언급할 때만 표시한다.
const GENERAL_LAWS=new Set(['민법','형법','민사소송법','형사소송법','민사집행법','대한민국헌법']);

/** 답변 글(근거 법령 표시 포함)의 맥락에 맞는 용어만 남긴다. 예: 근로기준법의 용어는 근로기준법(시행령 포함)을 언급한 답변에서만 쓴다. */
export function termsForContext(terms:GlossaryTerm[],context:string):GlossaryTerm[]{
 const seen=new Map<string,boolean>();
 const mentioned=(law:string)=>{
  const base=law.replace(/\s*(시행령|시행규칙)$/u,'');
  let found=seen.get(base);
  // 앞 글자가 한글이면 다른 법 이름의 일부다(예: 군형법 안의 "형법").
  if(found===undefined){found=new RegExp('(?<![가-힣])'+escape(base),'u').test(context);seen.set(base,found);}
  return found;
 };
 return terms.filter(term=>!term.law||GENERAL_LAWS.has(term.law)||mentioned(term.law));
}

/** 답변 전체에서 같은 용어는 한 번만 표시하도록, 읽는 순서대로 조각마다 표시할 용어 번호를 정한다. */
export function planTerms(segments:string[],terms:GlossaryTerm[]):Set<string>[]{
 const taken=new Set<string>();
 return segments.map(segment=>new Set(splitByTerms(segment,terms,undefined,taken).flatMap(part=>part.term?[part.term.id]:[])));
}
