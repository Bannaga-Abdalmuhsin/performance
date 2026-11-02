import test from 'node:test';
import assert from 'node:assert/strict';
import {renderUserSettings} from '../dist/account.mjs';
import {renderSessionRows,sessionTimestamp,sessionDuration,createSessionTracker} from '../dist/session-history.mjs';
import {PerformanceDatabase} from '../dist/database.mjs';
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const user={id:'user1',email:'test@example.invalid',user_metadata:{role:'admin'}};
test('only active database administrators see login history',()=>{
  for(const member of [{role:'viewer',active:true},{role:'analyst',active:true},{role:'admin',active:false},null])assert.ok(!renderUserSettings(user,member).includes('id="login-history"'));
  assert.match(renderUserSettings(user,{role:'admin',active:true}),/id="login-history"/);
});
test('session history escapes identities and addresses and preserves unavailable past details',()=>{
  const html=renderSessionRows([{email:'<img src=x>',session_id:'<script>x</script>',ip_address:'<svg onload=x>',signed_in_at:'2026-11-02T10:00:00Z',last_seen_at:null,signed_out_at:null,duration_seconds:null,status:'untracked'}]);
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<svg'));assert.match(html,/&lt;img/);assert.match(html,/13:00:00/);assert.match(html,/Not yet tracked/);assert.ok(!html.includes('NaN'));assert.equal(sessionDuration(null),'—');assert.equal(sessionDuration(3661),'1h 1m 1s');assert.equal(sessionTimestamp('invalid'),'—');assert.match(renderSessionRows([]),/No sessions match/);
});
test('activity RPC supplies no caller-controlled identity, timestamps, duration or IP',async()=>{
  const db=new PerformanceDatabase('https://example.supabase.co','sb_publishable_test'),calls=[];
  db.request=async(path,options)=>calls.push({path,...options});
  await db.trackSession('active');assert.deepEqual(JSON.parse(calls[0].body),{p_event:'active'});assert.match(calls[0].path,/performance_record_session_activity$/);
  await db.loginSessions({from:'2026-11-01',to:'2026-11-02',search:'user@',status:'online',offset:25});
  assert.deepEqual(JSON.parse(calls[1].body),{p_from:'2026-11-01',p_to:'2026-11-02',p_search:'user@',p_status:'online',p_offset:25,p_limit:25});
  await assert.rejects(()=>db.trackSession('admin'),/Invalid session event/);
});
test('sign-out remains available if recording is temporarily unavailable',async()=>{
  const db=new PerformanceDatabase('https://example.supabase.co','sb_publishable_test');db.session={user};let revoked=false;
  db.trackSession=async event=>{assert.equal(event,'sign_out');throw new Error('Offline');};db.request=async path=>{assert.equal(path,'/auth/v1/logout');revoked=true;};
  await db.logout();assert.equal(revoked,true);assert.equal(db.session,null);
});
test('activity pauses for hidden pages, resumes when visible and stops on sign-out',async()=>{
  const listeners={},calls=[],doc={visibilityState:'visible',addEventListener:(name,fn)=>listeners[name]=fn};let tick,cancelled=false;
  const db={session:{user},trackSession:async(event,options)=>calls.push({event,...options})};
  const tracker=createSessionTracker({getDatabase:()=>db,canTrack:()=>true,document:doc,window:{addEventListener:(name,fn)=>listeners[name]=fn},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>cancelled=true});
  tracker.start();await Promise.resolve();assert.equal(calls[0].event,'active');doc.visibilityState='hidden';await tick();assert.equal(calls.length,1);await listeners.visibilitychange();assert.equal(calls.at(-1).event,'pause');doc.visibilityState='visible';await listeners.visibilitychange();assert.equal(calls.at(-1).event,'active');await listeners.pagehide();assert.equal(calls.at(-1).keepalive,true);tracker.stop();await tick();assert.equal(cancelled,true);assert.equal(calls.length,4);
});
