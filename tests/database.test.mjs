import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceDatabase,validatePublicKey} from '../dist/database.mjs';
const key='sb_publishable_test';
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
function dbMock(handler){const db=new PerformanceDatabase('https://example.supabase.co',key);db.session={user:{id:'test'},access_token:'test',expires_at:Date.now()+3600000};db.member=async()=>({role:'analyst'});db.request=handler;return db;}
test('browser key validation rejects secret and service role credentials',()=>{
 assert.equal(validatePublicKey(key),true);assert.throws(()=>validatePublicKey('sb_secret_test'),/Secret/);
 const token='x.'+btoa(JSON.stringify({role:'service_role'}))+'.x';assert.throws(()=>validatePublicKey(token),/publishable/);
 assert.throws(()=>new PerformanceDatabase('http://example.supabase.co',key),/HTTPS/);
});
test('loading follows keyset cursors even when the server returns fewer rows than requested',async()=>{
 let page=0,imports=0;const db=dbMock(async path=>{
  if(path.includes('performance_imports')){imports++;return [{id:'batch1',status:'complete',metadata:{min_date:'2026-08-01',max_date:'2026-08-31'}}];}
  page++;if(page===1)return [{id:'a',created_date:'2026-08-01'}];if(page===2){assert.ok(path.includes('id=gt.a'));return [{id:'b',created_date:'2026-08-31'}];}return [];
 });const data=await db.load();assert.equal(data.records.length,2);assert.equal(page,3);assert.equal(imports,2);
});
test('failed and pending imports cannot silently produce partial monthly results',async()=>{
 for(const status of ['failed','pending']){const db=dbMock(async()=>[{id:'b',status}]);await assert.rejects(()=>db.load(),new RegExp(status));}
 let count=0;const db=dbMock(async path=>{if(path.includes('performance_imports'))return [{id:++count===1?'before':'after',status:'complete',metadata:{}}];return [];});await assert.rejects(()=>db.load(),/changed while loading/);
});
test('failed import is marked failed and never finalized',async()=>{
 let finalized=false,marked=false;const db=dbMock(async(path,options)=>{
  if(path.includes('performance_imports')&&options?.method==='POST')return [{id:'new-batch'}];
  if(path.includes('performance_tickets'))throw new Error('batch rejected');
  if(options?.method==='PATCH')marked=JSON.parse(options.body).status==='failed';
  if(path.includes('performance_complete_import'))finalized=true;
 });await assert.rejects(()=>db.import([{id:'a'}],{min_date:'2026-08-01',max_date:'2026-08-31'}),/did not complete/);assert.equal(marked,true);assert.equal(finalized,false);
});
