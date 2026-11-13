export type CaseType = {code:string;label:string};
export type CaseSummary = {id:string;title:string;typeCode:string;typeName:string;revision:number;createdAt:string;updatedAt:string};
export type Fact = {imported?:boolean;source?:{chatId:string;messageId:string}|null;id:string;title:string;content:string;occurredOn:string|null;updatedAt?:string};
export type Snapshot = {title?:string;typeName?:string;content?:string;occurredOn?:string|null;deleted?:boolean;deletedFactCount?:number};
export type CaseHistory = {id:string;revision:number;action:string;before:Snapshot|null;after:Snapshot;createdAt:string};
export type CaseList = {total:number;offset:number;nextOffset:number|null;items:(CaseSummary&{factCount:number})[]};
export type CaseDetail = {case:CaseSummary;types:CaseType[];facts:{total:number;offset:number;nextOffset:number|null;items:Fact[]};history:{total:number;offset:number;nextOffset:number|null;items:CaseHistory[]}};
export type CaseCommand = {operation:'create'|'update'|'delete'|'createFact'|'updateFact'|'deleteFact';caseId?:string;factId?:string;srcMsgId?:string;returnTo?:'timeline';revision?:number};
export const caseIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const factIdPattern=/^[1-9]\d{0,18}$/;

export type CaseTimeline = {case:CaseSummary;total:number;undatedTotal:number;offset:number;nextOffset:number|null;items:Fact[]};
