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
  if(path.includes('performance_imports')){imports++;assert.ok(path.includes('status=eq.complete'));return [{id:'batch1',status:'complete',record_count:2,min_date:'2026-08-01',max_date:'2026-08-31',metadata:{}}];}
  assert.ok(path.includes('import_id=eq.batch1'));
  assert.ok(!path.includes('source_data'),'chart pages should not download every original source column');
  page++;if(page===1)return [{id:'a',created_date:'2026-08-01'}];if(page===2){assert.ok(path.includes('id=gt.a'));return [{id:'b',created_date:'2026-08-31'}];}return [];
 });const data=await db.load();assert.equal(data.records.length,2);assert.equal(page,3);assert.equal(imports,1);assert.equal(data.meta.import_id,'batch1');
});
test('no complete snapshot and count mismatches cannot produce partial results',async()=>{
 const empty=dbMock(async()=>[]);await assert.rejects(()=>empty.load(),/completed performance import/);
 const db=dbMock(async path=>path.includes('performance_imports')?[{id:'b',status:'complete',record_count:5,metadata:{}}]:[]);await assert.rejects(()=>db.load(),/count mismatch/);
});
test('invalid repeated pagination cursors stop instead of looping forever',async()=>{
 const db=dbMock(async path=>path.includes('performance_imports')?[{id:'b',status:'complete',record_count:2,metadata:{}}]:[{id:'same'}]);await assert.rejects(()=>db.load(),/pagination cursor/);
});
test('snapshot identity makes new upload publication atomic for readers',async()=>{
 let calls=0;const db=dbMock(async path=>{
   if(path.includes('performance_imports'))return [{id:++calls===1?'old-complete':'new-complete',status:'complete',record_count:1,metadata:{},min_date:'2026-08-01',max_date:'2026-08-31'}];
   if(path.includes('id=gt.'))return [];
   return [{id:path.includes('old-complete')?'old-ticket':'new-ticket'}];
 });const before=await db.load(),after=await db.load();assert.equal(before.records[0].id,'old-ticket');assert.equal(after.records[0].id,'new-ticket');assert.notEqual(before.meta.import_id,after.meta.import_id);
});
test('failed import is marked failed and never finalized',async()=>{
 let finalized=false,marked=false;const db=dbMock(async(path,options)=>{
  if(path.includes('performance_imports')&&options?.method==='POST')return [{id:'new-batch'}];
  if(path.includes('performance_tickets'))throw new Error('batch rejected');
  if(options?.method==='PATCH')marked=JSON.parse(options.body).status==='failed';
  if(path.includes('performance_complete_import'))finalized=true;
 });await assert.rejects(()=>db.import([{id:'a'}],{min_date:'2026-08-01',max_date:'2026-08-31'}),/did not complete/);assert.equal(marked,true);assert.equal(finalized,false);
});
test('uploads preserve original business fields and duplicate audit before finalization',async()=>{
 const calls=[];const db=dbMock(async(path,options)=>{calls.push({path,body:options?.body?JSON.parse(options.body):null});if(path.includes('performance_imports')&&options?.method==='POST')return [{id:'new-batch'}];return null;});
 const source={Network:'MOBILE',Quantity:0,Closed:false},audit={policy:'ticket-richest-v1',kept:{row:20},removed:[{row:10}]};
 await db.import([{id:'pbi:PR1',ticket_number:'PR1',source_data:source,deduplication:audit}],{min_date:'2026-09-01',max_date:'2026-09-30'});
 const write=calls.find(c=>c.path.includes('performance_tickets'));assert.deepEqual(write.body[0].source_data,source);assert.deepEqual(write.body[0].deduplication,audit);assert.ok(calls.at(-1).path.includes('performance_complete_import'));
});
