// Exercise the public deployment's real sign-in and database-loading controller.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
class Element {
 constructor(){this.options=[{}];this.innerHTML='';this.value='';this.dataset={};this.hidden=false;this.disabled=false;this.textContent='';this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
 querySelectorAll(){return [];}querySelector(){return new Element();}addEventListener(){}setAttribute(){}focus(){}showModal(){}close(){}
}
const elements=new Map(),events={};
const el=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
globalThis.document={querySelector:el,querySelectorAll:()=>[],addEventListener(n,fn){(events[n]||=[]).push(fn);},createElement:()=>new Element()};
globalThis.window={PERFORMANCE_CONFIG:{projectUrl:'https://example.supabase.co',publishableKey:'sb_publishable_configured',privateSnapshot:null},addEventListener(){}};
const cache=new Map([['performance-project-url','https://stale.supabase.co'],['performance-project-key','sb_publishable_stale']]);
globalThis.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};globalThis.sessionStorage=globalThis.localStorage;
globalThis.location={hash:'#overview'};globalThis.history={replaceState(){}};
let approved=false,rejectPassword=false,rejectLogout=false,pauseTickets=false,releaseTickets,ticketsStarted;const calls=[];
const record={id:'pbi:PR1',ticket_number:'PR1',site_id:'COW1',site_name:'Test',region:'Central',district:'Riyadh',vendor:'Ericsson',severity:'High',site_label:'Normal',service_impact:'Outage',parent_tt:null,root_cause:'Generator Issue',created_at:'2026-09-30T10:00:00+03:00',created_date:'2026-09-30',duration_minutes:0,quality_flags:[]};
globalThis.fetch=async(path,options={})=>{
 if(!path.startsWith('https:'))return {ok:true,json:async()=>JSON.parse(readFileSync(new URL('../dist/'+path,import.meta.url),'utf8'))};
 calls.push({path,options});let value;
 if(path.includes('/auth/v1/token')){if(rejectPassword)return {ok:false,json:async()=>({msg:'Invalid login credentials'})};value={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'user1',email:'owner@example.com'}};}
 else if(path.includes('/auth/v1/user'))value={id:'user1',email:'owner@example.com',user_metadata:{display_name:'Test user'}};
 else if(path.includes('performance_members'))value=approved?[{role:'admin',active:true}]:[];
 else if(path.includes('performance_imports'))value=[{id:'batch1',status:'complete',record_count:1,min_date:'2026-09-30',max_date:'2026-09-30',metadata:{}}];
 else if(path.includes('performance_tickets')){if(pauseTickets&&!path.includes('id=gt.')){ticketsStarted();await new Promise(resolve=>releaseTickets=resolve);}value=path.includes('id=gt.')?[]:[record];}
 else if(path.includes('/auth/v1/logout')){if(rejectLogout)throw new Error('Network unavailable');value=null;}
 else throw new Error('Unexpected API request '+path);
 return {ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)};
};
const app=await import('../dist/app.mjs');await app.ready;
const submit=async()=>{const form=new Element();form.id='connection-form';for(const fn of events.submit)await fn({preventDefault(){},target:form});};
function enterCredentials(){el('#project-url').value='https://example.supabase.co';el('#project-key').value='sb_publishable_configured';el('#db-email').value='owner@example.com';el('#db-password').value='test-password';}
test('configured GitHub page opens sign-in and overrides stale browser connection settings',()=>{
 const html=el('#login-content').innerHTML;assert.match(html,/Sign in to performance/);assert.match(html,/id="connection-form"/);assert.match(html,/Sign in & open dashboard/);assert.match(html,/https:\/\/example.supabase.co/);assert.ok(!html.includes('stale.supabase.co'));assert.ok(!html.includes('Connection settings'));assert.equal(el('#dashboard-shell').hidden,true);assert.equal(el('#dashboard-shell').inert,true);assert.equal(el('#login-screen').hidden,false);assert.equal(el('#content').innerHTML,'');
 const documentSource=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');assert.match(documentSource,/<div id="dashboard-shell" hidden inert>/,'dashboard must also be hidden before JavaScript runs');
});
test('direct report links and local data cannot open the public dashboard before approval',()=>{
 const view=app.state.view;for(const destination of ['settings','formulas','weekly-sa','tickets'])app.navigate(destination);assert.equal(app.state.view,view);assert.equal(el('#content').innerHTML,'');assert.equal(calls.length,0);assert.throws(()=>app.setData({meta:{min_date:'2026-09-30',max_date:'2026-09-30'},records:[record]},'snapshot'),/approved performance account/);
});
test('a wrong password keeps the full dashboard hidden and clears the password field',async()=>{
 rejectPassword=true;enterCredentials();await submit();rejectPassword=false;assert.match(el('#login-content').innerHTML,/Invalid login credentials/);assert.equal(el('#dashboard-shell').hidden,true);assert.equal(el('#db-password').value,'');assert.ok(!el('#login-content').innerHTML.includes('test-password'));
});
test('an unapproved account sees a persistent access error and can sign out or retry',async()=>{
 enterCredentials();await submit();
 const html=el('#login-content').innerHTML;assert.match(html,/Performance access is not enabled for owner@example.com/);assert.match(html,/role="alert"/);assert.match(html,/id="logout-db"/);assert.match(html,/Check access & open dashboard/);assert.ok(!html.includes('test-password'));assert.equal(el('#db-password').value,'');assert.equal(el('#dashboard-shell').hidden,true);assert.equal(el('#content').innerHTML,'');assert.ok(!calls.some(c=>c.path.includes('performance_tickets')));assert.ok(calls.every(c=>c.path.startsWith('https://example.supabase.co/')));
});
test('retry after account approval loads the latest completed snapshot and all six dashboards',async()=>{
 app.navigate('settings');assert.equal(el('#dashboard-shell').hidden,true);assert.equal(el('#content').innerHTML,'');assert.match(el('#login-content').innerHTML,/id="profile-form"/);assert.match(el('#login-content').innerHTML,/Not assigned/);
 const back=new Element();back.id='return-to-sign-in';for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?back:null}});assert.match(el('#login-content').innerHTML,/Check access & open dashboard/);
 approved=true;pauseTickets=true;const started=new Promise(resolve=>ticketsStarted=resolve),pending=submit();await started;assert.equal(el('#dashboard-shell').hidden,true,'approval alone must not open an incomplete snapshot');assert.equal(el('#dashboard-shell').inert,true);assert.equal(el('#login-status').hidden,false);releaseTickets();pauseTickets=false;await pending;assert.equal(el('#nav-count').textContent,'1');assert.equal(el('#source-notice').hidden,true);assert.equal(el('#dashboard-shell').hidden,false);assert.equal(el('#dashboard-shell').inert,false);assert.equal(el('#login-screen').hidden,true);assert.equal(el('#login-content').innerHTML,'','only the settings page may contain an account form after sign-in');
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy']){app.navigate(view);assert.ok(!el('#content').innerHTML.includes('Performance access is not enabled'));assert.ok(el('#content').innerHTML.length>500);}
 assert.equal(calls.filter(c=>c.path.includes('/auth/v1/token')).length,2,'access retry should reuse the valid session after the two password attempts');
});
test('sign-out returns to login and clears ticket access even if the network is unavailable',async()=>{
 app.navigate('tickets');assert.match(el('#content').innerHTML,/PR1/);el('#detail-content').innerHTML='PR1';rejectLogout=true;const button=new Element();button.id='logout-db';for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?button:null}});rejectLogout=false;
 assert.equal(el('#dashboard-shell').hidden,true);assert.equal(el('#dashboard-shell').inert,true);assert.equal(el('#login-screen').hidden,false);assert.equal(el('#content').innerHTML,'');assert.equal(el('#detail-content').innerHTML,'');assert.equal(el('#nav-count').textContent,'—');assert.equal(el('#print-review').disabled,true);assert.equal(cache.has('cow-performance-session'),false);assert.match(el('#login-content').innerHTML,/id="db-password"/);app.navigate('overview');assert.equal(el('#content').innerHTML,'');
});
test('a restored session must pass membership validation before showing the dashboard',async()=>{
 approved=false;cache.set('cow-performance-session',JSON.stringify({url:'https://example.supabase.co',access_token:'restored',refresh_token:'test-refresh',expires_at:Date.now()+3600000,user:{id:'user1',email:'owner@example.com'}}));const count=calls.filter(c=>c.path.includes('performance_tickets')).length;const restored=await import('../dist/app.mjs?restored-session');await restored.ready;
 assert.equal(el('#dashboard-shell').hidden,true);assert.match(el('#login-content').innerHTML,/Performance access is not enabled for owner@example.com/);assert.equal(calls.filter(c=>c.path.includes('performance_tickets')).length,count);
});
test('an approved restored session opens its requested page with working account controls',async()=>{
 approved=true;location.hash='#settings';const restored=await import('../dist/app.mjs?restored-approved-session');await restored.ready;
 assert.equal(el('#dashboard-shell').hidden,false);assert.equal(el('#login-screen').hidden,true);assert.equal(el('#login-content').innerHTML,'');assert.equal(el('#login-status').innerHTML,'');assert.match(el('#content').innerHTML,/id="profile-form"/);assert.match(el('#content').innerHTML,/Change password/);assert.ok(!el('#content').innerHTML.includes('import-file'));assert.equal(restored.state.view,'settings');
});
