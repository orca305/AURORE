// 답변 텍스트에서 법률용어를 찾는 순수 함수. 가장 긴 이름을 먼저 맞추고 겹치지 않으며, 같은 용어는 첫 번째만 표시한다.
// taken: 이미 앞 문장에서 표시한 용어 번호(여러 조각에 걸쳐 같은 용어를 한 번만 표시할 때 공유). allow: 이 조각에서 표시해도 되는 용어 번호만.
export type GlossaryTerm={id:string;termName:string;aliases:string[];brief:string;easy:boolean};
export type TextPart={text:string;term?:GlossaryTerm};
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function splitByTerms(text:string,terms:GlossaryTerm[],allow?:Set<string>,taken?:Set<string>):TextPart[]{
 const names=new Map<string,GlossaryTerm>();
 for(const term of terms)for(const name of [term.termName,...term.aliases]){
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

/** 답변 전체에서 같은 용어는 한 번만 표시하도록, 읽는 순서대로 조각마다 표시할 용어 번호를 정한다. */
export function planTerms(segments:string[],terms:GlossaryTerm[]):Set<string>[]{
 const taken=new Set<string>();
 return segments.map(segment=>new Set(splitByTerms(segment,terms,undefined,taken).flatMap(part=>part.term?[part.term.id]:[])));
}
