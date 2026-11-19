export function passwordLength(value:string){return Array.from(value.normalize('NFC')).length;}
export function passwordChangeProblem(current:string,next:string,confirmation:string){
 const valid=(value:string)=>! /\p{Surrogate}/u.test(value.normalize('NFC'))&&passwordLength(value)>=8&&passwordLength(value)<=16;
 if(!valid(current))return '현재 비밀번호를 8~16자로 입력해 주세요.';
 if(!valid(next))return '새 비밀번호는 8~16자로 입력해 주세요.';
 if(next.normalize('NFC')===current.normalize('NFC'))return '현재와 다른 새 비밀번호를 입력해 주세요.';
 if(next.normalize('NFC')!==confirmation.normalize('NFC'))return '새 비밀번호 확인이 일치하지 않습니다.';
 return null;
}
export function validConsentRevision(value:unknown):value is string{return typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=BigInt('9223372036854775807');}
export function consentResultMatches(value:unknown,agreed:boolean):value is {agreed:boolean;revision:string;changed:boolean}{
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;return row.agreed===agreed&&validConsentRevision(row.revision)&&typeof row.changed==='boolean'&&(!row.changed||row.revision!=='0');
}
export async function readAccountPayload(response:Response):Promise<Record<string,unknown>>{
 const value:unknown=await response.json().catch(()=>null);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
export type ConsentPage={agreed:boolean;revision:string;policyVersion:string;total:number;limit:number;offset:number;nextOffset:number|null;history:{id:string;agreed:boolean;policyVersion:string;recordedAt:string}[]};
export function isConsentPage(value:unknown,limit:number,offset:number):value is ConsentPage{
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 return typeof row.agreed==='boolean'&&validConsentRevision(row.revision)&&typeof row.policyVersion==='string'&&row.policyVersion.length>0&&row.policyVersion.length<=40&&Number.isSafeInteger(row.total)&&(row.total as number)>=0&&row.limit===limit&&row.offset===offset&&(row.nextOffset===null||(Number.isSafeInteger(row.nextOffset)&&(row.nextOffset as number)>offset&&(row.nextOffset as number)<=100000))&&Array.isArray(row.history)&&row.history.length<=limit&&row.history.length<=(row.total as number)&&row.history.every((item:unknown)=>{if(!item||typeof item!=='object')return false;const h=item as Record<string,unknown>;return validConsentRevision(h.id)&&h.id!=='0'&&typeof h.agreed==='boolean'&&typeof h.policyVersion==='string'&&h.policyVersion.length<=40&&typeof h.recordedAt==='string'&&h.recordedAt.length<=40&&Number.isFinite(Date.parse(h.recordedAt));});
}
