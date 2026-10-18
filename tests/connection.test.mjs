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
let approved=false;const calls=[];
const record={id:'pbi:PR1',ticket_number:'PR1',site_id:'COW1',site_name:'Test',region:'Central',district:'Riyadh',vendor:'Ericsson',severity:'High',site_label:'Normal',service_impact:'Outage',parent_tt:null,root_cause:'Generator Issue',created_at:'2026-09-30T10:00:00+03:00',created_date:'2026-09-30',duration_minutes:0,quality_flags:[]};
globalThis.fetch=async(path,options={})=>{
 if(!path.startsWith('https:'))return {ok:true,json:async()=>JSON.parse(readFileSync(new URL('../dist/'+path,import.meta.url),'utf8'))};
 calls.push({path,options});let value;
 if(path.includes('/auth/v1/token'))value={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'user1',email:'owner@example.com'}};
 else if(path.includes('performance_members'))value=approved?[{role:'admin',active:true}]:[];
 else if(path.includes('performance_imports'))value=[{id:'batch1',status:'complete',record_count:1,min_date:'2026-09-30',max_date:'2026-09-30',metadata:{}}];
 else if(path.includes('performance_tickets'))value=path.includes('id=gt.')?[]:[record];
 else throw new Error('Unexpected API request '+path);
 return {ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)};
};
const app=await import('../dist/app.mjs');await app.ready;
const submit=async()=>{const form=new Element();form.id='connection-form';for(const fn of events.submit)await fn({preventDefault(){},target:form});};
test('configured GitHub page opens sign-in and overrides stale browser connection settings',()=>{
 const html=el('#content').innerHTML;assert.match(html,/Sign in to performance/);assert.match(html,/id="connection-form"/);assert.match(html,/Sign in & load dashboards/);assert.match(html,/https:\/\/example.supabase.co/);assert.ok(!html.includes('stale.supabase.co'));assert.ok(!html.includes('connection-advanced" open'));assert.equal(el('.filters').hidden,true);
});
test('an unapproved account sees a persistent access error and can sign out or retry',async()=>{
 el('#project-url').value='https://example.supabase.co';el('#project-key').value='sb_publishable_configured';el('#db-email').value='owner@example.com';el('#db-password').value='test-password';await submit();
 const html=el('#content').innerHTML;assert.match(html,/Performance access is not enabled for owner@example.com/);assert.match(html,/role="alert"/);assert.match(html,/id="logout-db"/);assert.match(html,/Check access & load data/);assert.ok(!html.includes('test-password'));assert.equal(el('#db-password').value,'');assert.ok(calls.every(c=>c.path.startsWith('https://example.supabase.co/')));
});
test('retry after account approval loads the latest completed snapshot and all six dashboards',async()=>{
 approved=true;await submit();assert.equal(el('#nav-count').textContent,'1');assert.match(el('#source-notice').innerHTML,/PostgreSQL data/);
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy']){app.navigate(view);assert.ok(!el('#content').innerHTML.includes('Performance access is not enabled'));assert.ok(el('#content').innerHTML.length>500);}
 assert.equal(calls.filter(c=>c.path.includes('/auth/v1/token')).length,1,'access retry should reuse the valid session');
});
