'use client';
import {useState} from 'react';
export function PageRefresh(){
 const[pending,setPending]=useState(false);
 return <button type="button" className="ui-button icon-button" aria-label="새로고침" title="새로고침" aria-busy={pending} disabled={pending} onClick={()=>{setPending(true);window.location.reload();}}><svg className={pending?'refresh-spinning':undefined} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5"/></svg></button>;
}
export function ResetSearch(){return <span className="search-actions"><button type="button" className="ui-button" onClick={()=>{const url=new URL(window.location.href);const limit=url.searchParams.get('limit');url.search='';if(limit&&['10','20','50'].includes(limit))url.searchParams.set('limit',limit);window.location.assign(url.pathname+url.search);}}>초기화</button><PageRefresh/></span>;}
