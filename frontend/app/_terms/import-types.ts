export type SourceItem={sourceId:string;termName:string;dictionaryCode:string;sourceUrl:string;existing:{termId:string;state:string}|null};
export type SourcePage={items:SourceItem[];total:number;page:number;limit:number;nextPage:number|null};
export type ImportOutcome={sourceId:string;termId:string|null;status:string};
export type ImportState={error?:string;uncertain:boolean;results?:ImportOutcome[]}|null;
export const importLabels:Record<string,string>={IMPORTED:'초안 등록',UPDATED:'변경 정의를 초안으로 저장',UNCHANGED:'변경 없음',REPLAYED:'이미 처리됨',LOCAL_EDIT:'직접 수정한 내용 보호',DELETED:'삭제한 용어 · 제외',CONFLICT:'동시 수정 · 다시 확인',FAILED:'수집 실패',DEFERRED:'다시 시도 필요'};
