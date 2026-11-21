import test from 'node:test';
import assert from 'node:assert/strict';
import {splitByTerms} from '../app/_conversation/term-match.ts';
const term=(id,termName,aliases=[])=>({id,termName,aliases,brief:'합성 설명',easy:true});
const glossary=[term('1','임금'),term('2','평균임금'),term('3','임차권등기명령',['임차권 등기명령']),term('4','해지'),term('5','a.b')];
const join=parts=>parts.map(p=>p.text).join('');
test('longest name wins and overlapping shorter names are not highlighted inside it',()=>{
 const parts=splitByTerms('평균임금과 임금은 다릅니다',glossary);
 assert.deepEqual(parts.filter(p=>p.term).map(p=>p.term.id),['2','1']);
 assert.equal(join(parts),'평균임금과 임금은 다릅니다');
});
test('aliases match and only the first occurrence of each term is marked',()=>{
 const parts=splitByTerms('임차권 등기명령을 신청하세요. 임차권등기명령은 해지와 무관하고 해지는 별개입니다.',glossary);
 assert.deepEqual(parts.filter(p=>p.term).map(p=>p.term.id),['3','4']);
 assert.equal(parts.filter(p=>p.term?.id==='3').length,1);
});
test('text is preserved, regex characters are literal, and empty input is safe',()=>{
 const text='a.b 와 axb 그리고 (임금)';
 const parts=splitByTerms(text,glossary);
 assert.equal(join(parts),text);
 assert.deepEqual(parts.filter(p=>p.term).map(p=>p.term.id),['5','1']);
 assert.deepEqual(splitByTerms('',glossary),[{text:''}]);
 assert.deepEqual(splitByTerms('임금',[]),[{text:'임금'}]);
});
test('one-character names are ignored to avoid false matches',()=>{
 assert.deepEqual(splitByTerms('법을 지키세요',[term('9','법')]),[{text:'법을 지키세요'}]);
});
