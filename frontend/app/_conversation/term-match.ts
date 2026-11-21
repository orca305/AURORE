// 답변 텍스트에서 법률용어를 찾는 순수 함수. 가장 긴 이름을 먼저 맞추고 겹치지 않으며, 같은 용어는 첫 번째만 표시한다.
export type GlossaryTerm={id:string;termName:string;aliases:string[];brief:string;easy:boolean};
export type TextPart={text:string;term?:GlossaryTerm};
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function splitByTerms(text:string,terms:GlossaryTerm[]):TextPart[]{
 const names=new Map<string,GlossaryTerm>();
 for(const term of terms)for(const name of [term.termName,...term.aliases]){
  const key=name.normalize('NFC').trim();
  // 한 글자 이름은 오탐이 많아 제외한다. 같은 이름이 여러 용어에 있으면 먼저 온 용어를 쓴다.
  if(key.length>=2&&!names.has(key))names.set(key,term);
 }
 if(!names.size||!text)return [{text}];
 const pattern=new RegExp([...names.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|'),'gu');
 const parts:TextPart[]=[],used=new Set<string>();let last=0;
 for(const match of text.matchAll(pattern)){
  const term=names.get(match[0]);
  if(!term||used.has(term.id))continue;
  used.add(term.id);
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({text:match[0],term});
  last=match.index+match[0].length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});
 return parts.length?parts:[{text}];
}
