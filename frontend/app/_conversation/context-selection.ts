export type DocumentSelection={id:string;name:string;characterCount:number};
export function documentSelectionProblem(rows:DocumentSelection[]):string|null{
 if(rows.length>3)return '첨부자료는 최대 3개까지 선택할 수 있습니다.';
 if(new Set(rows.map(row=>row.id)).size!==rows.length)return '이미 선택한 첨부자료입니다.';
 if(rows.some(row=>!Number.isSafeInteger(row.characterCount)||row.characterCount<0))return '자료의 길이를 확인하지 못했습니다. 다시 선택해 주세요.';
 const count=rows.reduce((sum,row)=>sum+row.characterCount,0);
 return count>12000?'선택한 첨부자료가 '+count.toLocaleString('ko-KR')+'자입니다. 합계 12,000자 이내로 자료를 줄여 주세요.':null;
}
export function factContextLength(rows:{title:string;content:string;occurredOn:string|null}[]){
 return rows.map(row=>[row.title,row.occurredOn?'발생일: '+row.occurredOn:'발생일 미상',row.content].join('\n')).join('\n\n').length;
}
