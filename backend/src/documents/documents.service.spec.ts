import {describe,it,expect,vi} from 'vitest';
import {DocumentsService,type DocumentOwner} from './documents.service.js';
import type {PrismaService} from '../prisma/prisma.service.js';
import type {AuthService} from '../auth/auth.service.js';
import type {ChatService} from '../chat/chat.service.js';
describe('attachment selection metadata',()=>{
 function fixture(otherOwner=false){
  const row={id:'00000000-0000-4000-8000-000000000001',docNm:'합성 자료',formatCd:'TXT',byteSize:50,mdCont:'검증 😀 자료',partialYn:false,rgstDttm:new Date('2026-11-19T00:00:00Z')};
  const tx={attachDoc:{count:vi.fn().mockResolvedValue(11),findMany:vi.fn().mockResolvedValue([row])}};
  const db={chatSess:{findUnique:vi.fn().mockResolvedValue({userId:otherOwner?2n:1n,guestSessId:null,delYn:false,exprDttm:null})},$transaction:vi.fn((work:(value:typeof tx)=>unknown)=>work(tx))};
  const service=new DocumentsService(db as unknown as PrismaService,{} as AuthService,{} as ChatService);
  const owner={userId:1n,guestSessId:null} as DocumentOwner;
  return {row,tx,db,service,owner};
 }
 it('returns UTF-16 length used by send validation without returning content',async()=>{
  const {service,owner,row,tx}=fixture();const page=await service.list('chat',owner,10,0);
  expect(page.items[0].characterCount).toBe(row.mdCont.length);expect(page.items[0]).not.toHaveProperty('mdCont');expect(JSON.stringify(page)).not.toContain(row.mdCont);expect(page.nextOffset).toBe(10);
  expect(tx.attachDoc.findMany.mock.calls[0][0]).toMatchObject({where:{chatSessId:'chat',userId:1n,delYn:false,chat:{userId:1n,delYn:false}},take:10,skip:0});
 });
 it('never reads document contents of another owner',async()=>{const {service,owner,tx,db}=fixture(true);await expect(service.list('chat',owner,10,0)).rejects.toMatchObject({status:404});expect(db.$transaction).not.toHaveBeenCalled();expect(tx.attachDoc.findMany).not.toHaveBeenCalled();});
});
