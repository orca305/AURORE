/* eslint-disable @next/next/no-img-element */
"use client";
import { Pagination } from "../_components/pagination";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {confirmDocument,listDocuments,readDocument,removeDocument,type DocumentList} from "./document-actions";
import {documentSelectionProblem,type DocumentSelection} from './context-selection';
import type {ChatDetail} from "./types";
import styles from "./documents.module.css";
type Preview={receipt:string;markdown:string;partial:boolean;filename:string;ocr?:boolean};
const imageName=/\.(png|jpe?g|webp)$/i;
const icons={
 clip:"m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 5 5l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 8",
 x:"M6 6l12 12M18 6 6 18",
 info:"M12 8v5M12 16.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
 upload:"M12 16V4M7 9l5-5 5 5M5 20h14",
 file:"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
 lock:"M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
 check:"m5 12 5 5 9-10",
 eye:"M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
 download:"M12 4v11m-5-4 5 5 5-5M5 20h14",
 trash:"M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
};
function Ico({d,size=18}:{d:string;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>;}
const kinds:Record<string,string>={xlsx:'table',ods:'table',csv:'table',tsv:'table',txt:'text',md:'text',png:'image',jpg:'image',jpeg:'image',webp:'image'};
const kindOf=(ext:string)=>kinds[ext.toLowerCase()]??'doc';
const fileExt=(name:string)=>name.includes('.')?name.split('.').at(-1)!:'';
const sizeText=(bytes:number)=>bytes>=1048576?(bytes/1048576).toFixed(1)+'MB':Math.max(1,Math.round(bytes/1024))+'KB';
export function DocumentsPanel({open,onClose,chatId,disabled,onBusy,onSaved,selected,onSelect,onRemoved}:{open:boolean;onClose:()=>void;selected:DocumentSelection[];onSelect:(items:DocumentSelection[])=>void;onRemoved:(id:string)=>void;chatId:string|null;disabled:boolean;onBusy:(busy:boolean)=>void;onSaved:(chat:ChatDetail)=>void}){
 const [file,setFile]=useState<File|null>(null),[draft,setDraft]=useState<Preview|null>(null),[markdown,setMarkdown]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[list,setList]=useState<DocumentList|null>(null),[limit,setLimit]=useState(10),[view,setView]=useState<{id:string;name:string;text:string}|null>(null),[deleting,setDeleting]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[previewUrl,setPreviewUrl]=useState<string|null>(null),[drag,setDrag]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const newRoom=useRef<string|null>(null),lock=useRef(false),input=useRef<HTMLInputElement>(null),listEpoch=useRef(0);
 function clearPreview(){setPreviewUrl(current=>{if(current)URL.revokeObjectURL(current);return null;});}
 function pick(next:File|null){setFile(next);setError(null);clearPreview();if(next&&imageName.test(next.name))setPreviewUrl(URL.createObjectURL(next));}
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
 function id(){if(chatId)return chatId;return newRoom.current??(newRoom.current=crypto.randomUUID());}
 function start(){if(lock.current||disabled)return false;lock.current=true;setBusy(true);onBusy(true);setError(null);setNotice(null);return true;}
 function stop(){lock.current=false;setBusy(false);onBusy(false);}
 async function load(offset=0,size=limit){const epoch=++listEpoch.current;try{const result=await listDocuments(id(),size,offset);if(epoch!==listEpoch.current)return;if(result.data)setList(result.data);else setError(result.error);}catch{if(epoch===listEpoch.current)setError('첨부자료를 불러오지 못했습니다. 다시 시도해 주세요.');}}
 useEffect(()=>{if(!open||!chatId)return;const epoch=++listEpoch.current;let active=true;void listDocuments(chatId,limit,0).then(result=>{if(!active||epoch!==listEpoch.current)return;if(result.data)setList(result.data);else setError(result.error);}).catch(()=>{if(active&&epoch===listEpoch.current)setError('첨부자료를 불러오지 못했습니다. 다시 시도해 주세요.');});return()=>{active=false;};},[open,chatId,limit]);
 async function upload(event:FormEvent){event.preventDefault();if(!file||!start())return;setView(null);
  try{if(!file.size||file.size>5*1024*1024){setError('5MB 이하 파일을 선택해 주세요.');return;}const body=new FormData();body.set('file',file);const response=await fetch('/api/chat-documents/'+id()+'/preview',{method:'POST',body});const data=await response.json();if(!response.ok){setError(data.error??'문서를 변환하지 못했습니다.');return;}const preview=data as Preview;setDraft(preview);setMarkdown(preview.markdown);setConfirmed(false);setUncertain(false);setFile(null);if(input.current)input.current.value='';}
  catch{setError('변환 결과를 확인하지 못했습니다. 다시 시도해 주세요.');}finally{stop();}}
 async function save(event:FormEvent){event.preventDefault();if(!draft||!confirmed||!start())return;
  try{const result=await confirmDocument(id(),draft.receipt,markdown,true);if(result.data){onSaved(result.data);setDraft(null);setMarkdown('');setConfirmed(false);clearPreview();setUncertain(false);setNotice('첨부자료를 등록했습니다. 이번 질문에 사용할 자료는 아래 목록에서 선택해 주세요.');await load();}else{setError(result.error);setUncertain(result.status>=500);}}
  catch{setError('저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');setUncertain(true);}finally{stop();}}
 async function show(docId:string){if(!start())return;try{const result=await readDocument(id(),docId);if(result.data)setView({id:docId,name:result.data.filename,text:result.data.markdown});else setError(result.error);}catch{setError('첨부자료 내용을 불러오지 못했습니다. 다시 시도해 주세요.');}finally{stop();}}
 async function remove(docId:string){if(!start())return;try{const result=await removeDocument(id(),docId);if(result.data){onRemoved(docId);onSelect(selected.filter(row=>row.id!==docId));onSaved(result.data);setView(null);setDeleting(null);await load();setNotice('첨부자료를 목록에서 삭제했습니다.');}else setError(result.error);}catch{setError('삭제 결과를 확인하지 못했습니다. 목록을 새로 확인해 주세요.');}finally{stop();}}
 async function choose(doc:{id:string;name:string;characterCount?:number},checked:boolean){
  if(!checked){onSelect(selected.filter(row=>row.id!==doc.id));setError(null);return;}if(selected.length>=3){setError('첨부자료는 최대 3개까지 선택할 수 있습니다.');return;}if(!start())return;
  try{let characterCount=doc.characterCount;if(characterCount===undefined){const result=await readDocument(id(),doc.id);if(!result.data){setError(result.error);return;}characterCount=result.data.markdown.length;}const next=[...selected,{id:doc.id,name:doc.name,characterCount}];const problem=documentSelectionProblem(next);if(problem)setError(problem);else onSelect(next);}
  catch{setError('자료의 길이를 확인하지 못했습니다. 다시 선택해 주세요.');}finally{stop();}
 }
 if(!open)return null;
 return createPortal(<dialog ref={dialog} className={styles.modal} aria-label="대화 첨부자료" onCancel={event=>{event.preventDefault();if(!busy){clearPreview();onClose();}}} onClick={event=>{if(event.target===dialog.current&&!busy){clearPreview();onClose();}}}><section className={styles.panel} aria-label="대화 첨부자료">
  <header className={styles.head}>
   <span className={styles.headIcon}><Ico d={icons.clip} size={22}/></span>
   <div className={styles.headText}><h2>첨부파일</h2><p>문서나 사진을 글자로 바꿔 두고, 질문할 때 참고 자료로 쓸 수 있어요.</p></div>
   <button type="button" className={styles.close} disabled={busy} onClick={()=>{clearPreview();onClose();}} aria-label="닫기" title="닫기"><Ico d={icons.x}/></button>
  </header>
  {open&&<div className={styles.body}>
   <ol className={styles.steps} aria-label="진행 단계"><li data-on={!draft||undefined}><span>1</span>파일 선택</li><li data-on={Boolean(draft)||undefined}><span>2</span>내용 확인·등록</li></ol>
   <div className={styles.banner}><Ico d={icons.info}/><p>변환한 뒤 개인정보·민감정보를 확인하고 필요한 내용만 등록하세요. 원본은 AI에 전달하지 않아요. 한 질문에 첨부자료는 최대 3개, 합계 12,000자까지 쓸 수 있어요.</p></div>
   {!draft&&<form onSubmit={event=>void upload(event)} className={styles.upload} onDragOver={event=>{event.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);if(!busy&&!disabled)pick(event.dataTransfer.files?.[0]??null);}}>
    <label className={styles.drop} data-drag={drag||undefined} data-has={file?'1':undefined}>
     <input ref={input} className={styles.fileInput} type="file" aria-label="첨부파일 선택" accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.pptx,.csv,.tsv,.rtf,.odt,.ods,.odp,.txt,.md,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busy||disabled} onChange={event=>pick(event.target.files?.[0]??null)}/>
     {file
      ?<span className={styles.fileCard}>{previewUrl?<img className={styles.thumb} src={previewUrl} alt={'선택한 이미지 미리보기: '+file.name}/>:<span className={styles.fileIcon} data-kind={kindOf(fileExt(file.name))}><Ico d={icons.file} size={24}/></span>}<span className={styles.fileMeta}><strong>{file.name}</strong><small>{fileExt(file.name).toUpperCase()} · {sizeText(file.size)}</small></span></span>
      :<><span className={styles.dropIcon}><Ico d={icons.upload} size={28}/></span><strong>파일을 끌어다 놓거나 눌러서 선택하세요</strong><small>파일 1개 · 5MB 이하</small></>}
    </label>
    {busy&&file&&imageName.test(file.name)&&<p role="status" className={styles.ocrBusy}><span className={styles.spinner} aria-hidden="true"/>이미지 속 글자를 읽는 중이에요. 최대 1분 정도 걸릴 수 있어요.</p>}
    <div className={styles.uploadActions}>
     {file&&<button type="button" className={styles.ghost} disabled={busy} onClick={()=>{pick(null);if(input.current)input.current.value='';}}>다른 파일 선택</button>}
     <button data-primary disabled={busy||disabled||!file}>{busy?'처리 중…':'글자로 변환'}</button>
    </div>
    <ul className={styles.formats} aria-label="올릴 수 있는 파일 형식">
     <li><span data-kind="doc">문서</span>PDF · HWP · HWPX · DOCX · PPTX · ODT · ODP · RTF</li>
     <li><span data-kind="table">표·텍스트</span>XLSX · ODS · CSV · TSV · TXT · MD</li>
     <li><span data-kind="image">이미지</span>PNG · JPG · WEBP · 글자를 자동으로 읽어 줘요</li>
    </ul>
    <p className={styles.note}><Ico d={icons.lock} size={16}/>올린 원본은 개인정보를 가리지 않은 그대로 서버에 보관돼요(나중에 내려받기용). 질문 답변에는 가린 변환본만 쓰고, 암호가 걸린 문서는 올릴 수 없어요.</p>
   </form>}
   {draft&&<form onSubmit={event=>void save(event)} className={styles.review}>
    <div className={styles.reviewHead}><h3>변환 결과 확인</h3><span className={styles.chip}>{draft.filename}</span></div>
    {draft.ocr&&<div className={styles.ocrBox}>{previewUrl&&<a href={previewUrl} target="_blank" rel="noopener noreferrer" title="원본 이미지 크게 보기"><img className={styles.thumb} src={previewUrl} alt="올린 원본 이미지"/></a>}<p><strong>이미지에서 자동으로 읽은 글자예요.</strong> 숫자·금액·날짜·이름이 틀릴 수 있으니 원본 이미지와 꼭 대조해 고친 뒤 등록하세요.</p></div>}
    <p className={styles.help}>{draft.partial?'텍스트 위주로 변환했어요. 표·그림·각주·배치가 빠질 수 있으니 원본과 확인해 주세요.':'텍스트를 변환했어요.'} 자동 제외가 모든 개인정보를 찾지는 못해요. 이름·주소·민감한 사실을 직접 지워 주세요. 올린 원본 파일도 함께 보관돼요(가리지 않은 그대로).</p>
    <label className={styles.editor}><span>등록할 내용<em>{markdown.length.toLocaleString('ko-KR')} / 50,000자</em></span><textarea value={markdown} maxLength={50000} rows={12} disabled={busy||uncertain} onChange={event=>{setMarkdown(event.target.value);setConfirmed(false);}}/></label>
    <label className={styles.checkCard}><input type="checkbox" checked={confirmed} required disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>개인정보·민감정보와 판독 누락을 확인하고 필요한 내용만 남겼어요.</span></label>
    <div className={styles.actions}><button type="button" className={styles.ghost} disabled={busy||uncertain} onClick={()=>{setDraft(null);setMarkdown('');setConfirmed(false);clearPreview();}}>취소</button><button data-primary disabled={busy||!confirmed||!markdown.trim()}>{busy?'저장 중…':uncertain?'같은 내용으로 등록 결과 확인':'확인 후 첨부 등록'}</button></div>
   </form>}
   {selected.length>0&&<div className={styles.selection} aria-label="이번 질문에 선택한 첨부자료"><div className={styles.selectionHead}><h3>이번 질문에 사용할 자료</h3><span>{selected.length}/3개 · {selected.reduce((sum,row)=>sum+row.characterCount,0).toLocaleString('ko-KR')} / 12,000자</span></div><div className={styles.meter} aria-hidden="true"><i style={{width:Math.min(100,selected.reduce((sum,row)=>sum+row.characterCount,0)/120)+'%'}}/></div><p>질문을 보내면 선택이 해제돼요.</p><ul>{selected.map(row=><li key={row.id}><span>{row.name} · {row.characterCount.toLocaleString('ko-KR')}자</span><button type="button" className={styles.ghost} disabled={busy||disabled} onClick={()=>onSelect(selected.filter(item=>item.id!==row.id))} aria-label={row.name+' 이번 질문에서 제외'}>선택 해제</button></li>)}</ul></div>}
   {notice&&<p role="status" className={styles.notice}><Ico d={icons.check} size={16}/>{notice}</p>}{error&&<p role="alert" className={styles.error}><Ico d={icons.info} size={16}/>{error.replace(/Markdown|마크다운/gi,'변환본')}</p>}
   {list&&<><div className={styles.listHeading}><h3>등록한 첨부자료 <span className={styles.count}>{list.total}개</span></h3>{list.total>10&&<label><select aria-label="페이지당 조회 개수" value={limit} disabled={busy} onChange={event=>{const size=Number(event.target.value);setLimit(size);}}>{[10,20,50].map(size=><option value={size} key={size}>{size}개</option>)}</select></label>}</div>
    {!list.items.length&&<p className={styles.empty}>아직 등록한 첨부자료가 없어요.</p>}
    <ul className={styles.list}>{list.items.map(doc=><li key={doc.id} data-picked={selected.some(row=>row.id===doc.id)||undefined}><div className={styles.itemTop}><span className={styles.fileIcon} data-kind={kindOf(doc.format)}><Ico d={icons.file} size={20}/></span><div className={styles.itemText}><strong>{doc.originalName??doc.name}</strong><small>{doc.characterCount!==undefined?doc.characterCount.toLocaleString('ko-KR')+'자 · ':''}{doc.format.toUpperCase()}에서 변환 · {doc.partial?'텍스트 판독 · 검토 완료':'검토 완료'}{doc.hasOriginal?' · 원본 보관':''}</small></div><label className={styles.useToggle}><input type="checkbox" aria-label={doc.name+' 이번 질문에 사용'} checked={selected.some(row=>row.id===doc.id)} disabled={busy||disabled} onChange={event=>void choose(doc,event.target.checked)}/><span>이번 질문에 사용</span></label></div>
     <div className={styles.itemActions}><button type="button" className={styles.sm} disabled={busy} onClick={()=>void show(doc.id)}><Ico d={icons.eye} size={16}/>내용 보기</button><a className={styles.sm} href={'/api/chat-documents/'+chatId+'/'+doc.id+'/download'} download><Ico d={icons.download} size={16}/>변환본 받기</a>{doc.hasOriginal&&<a className={styles.sm} href={'/api/chat-documents/'+chatId+'/'+doc.id+'/original'} download><Ico d={icons.download} size={16}/>원본 받기</a>}<button type="button" className={styles.smDanger} aria-label={doc.name+' 첨부자료 삭제'} title="첨부자료 삭제" disabled={busy} onClick={()=>setDeleting(doc.id)}><Ico d={icons.trash} size={16}/>삭제</button></div>
     {deleting===doc.id&&<div className={styles.deleteConfirm}><p><strong>{doc.name}</strong> 첨부자료를 삭제할까요?{selected.some(row=>row.id===doc.id)&&' 이번 질문에 선택한 자료에서도 제외돼요.'}</p><div><button type="button" className={styles.ghost} disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button type="button" className={styles.danger} disabled={busy} onClick={()=>void remove(doc.id)}>삭제 확인</button></div></div>}</li>)}</ul>
    {(list.offset>0||list.nextOffset!==null)&&<Pagination compact label="첨부자료 페이지" offset={list.offset} limit={limit} hasNext={list.nextOffset!==null} disabled={busy} onGo={(next)=>{if(start())void load(next).finally(stop);}} />}
   </>}
   {view&&<div className={styles.viewer}><div className={styles.reviewHead}><h3>{view.name}</h3><button type="button" className={styles.close} onClick={()=>setView(null)} aria-label="닫기" title="닫기"><Ico d={icons.x}/></button></div><p className={styles.help}>{view.text.length.toLocaleString('ko-KR')}자 · {selected.some(row=>row.id===view.id)?'이번 질문에 선택됨':'등록한 내용 · 이번 질문에는 아직 선택하지 않음'}</p><pre>{view.text}</pre><div className={styles.actions}><button data-primary type="button" disabled={busy||disabled} onClick={()=>void choose({id:view.id,name:view.name,characterCount:view.text.length},!selected.some(row=>row.id===view.id))}>{selected.some(row=>row.id===view.id)?'이번 질문에서 선택 해제':'이번 질문에 사용'}</button></div></div>}
  </div>}
 </section></dialog>,document.body);
}
