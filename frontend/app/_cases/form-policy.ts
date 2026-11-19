export function validCaseDate(value:string){
 if(value==='')return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||value>'9999-12-31')return false;
 const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function caseFormProblem(operation:string,value:{title:string;typeCode:string;content:string;date:string;confirmed:boolean}){
 if(operation!=='delete'&&operation!=='deleteFact'){
  if(!value.title.trim()||value.title.length>80)return '제목을 1~80자로 입력해 주세요.';
  if(operation==='createFact'||operation==='updateFact'){
   if(!value.content.trim()||value.content.length>4000)return '사실관계 내용을 1~4,000자로 입력해 주세요.';
   if(!validCaseDate(value.date))return '관련 날짜를 확인해 주세요.';
  }else if(!/^[A-Z][A-Z0-9_]{0,59}$/.test(value.typeCode))return '사건 분류를 선택해 주세요.';
 }
 return value.confirmed?null:'내용을 확인한 뒤 확인란에 체크해 주세요.';
}
