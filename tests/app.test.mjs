// Application rendering and event checks in a minimal DOM harness. This is not
// a browser or visual-layout test; it exercises the real application module.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.options=[{}];this.innerHTML='';this.value='';this.dataset={};this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
 querySelectorAll(){return [];}querySelector(){return new Element();}addEventListener(event,fn){this.listeners[event]=fn;}setAttribute(){}focus(){}showModal(){this.open=true;}close(){this.open=false;}
}
const elements=new Map(),events={};
globalThis.document={querySelector(s){if(!elements.has(s))elements.set(s,new Element());return elements.get(s);},querySelectorAll(){return [];},addEventListener(n,fn){(events[n]||=[]).push(fn);},createElement(){return new Element();}};
globalThis.window={PERFORMANCE_CONFIG:{projectUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test',privateSnapshot:null},addEventListener(){}};
const cache=new Map();globalThis.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};globalThis.sessionStorage=globalThis.localStorage;
globalThis.location={hash:'#overview'};globalThis.history={replaceState(){}};
globalThis.fetch=async(path)=>{
 if(!path.startsWith('https:'))return {ok:true,json:async()=>JSON.parse(readFileSync(new URL('../dist/'+path,import.meta.url),'utf8'))};
 const value=path.includes('/auth/v1/token')?{access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'user1',email:'test@example.com'}}:path.includes('/auth/v1/user')?{id:'user1',email:'test@example.com',user_metadata:{display_name:'Test user'}}:path.includes('performance_members')?[{role:'analyst',active:true}]:path.includes('performance_imports')?[{id:'batch1',status:'complete',record_count:dataset.records.length,min_date:dataset.meta.min_date,max_date:dataset.meta.max_date,metadata:dataset.meta}]:path.includes('performance_tickets')?(path.includes('id=gt.')?[]:dataset.records):[];
 return {ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)};
};
const app=await import('../dist/app.mjs');await app.ready;
const record=(id,extra={})=>({id:id+'|COW001',ticket_number:id,site_id:'COW001',region:'Central',district:'Riyadh City',site_label:'VIP',vendor:'Ericsson',severity:'High',created_date:'2026-08-01',created_at:'2026-08-01T10:00:00+03:00',duration_minutes:60,sla_breached:false,sla_excluded:false,parent_tt:null,root_cause:'Generator Issue',service_impact:'Outage',quality_flags:[],...extra});
const dataset={meta:{min_date:'2026-07-01',max_date:'2026-08-31',record_count:3,raw_record_count:3,duplicates_removed:0,quality:{},profile:{excluded_root_causes:['Telecom']}},records:[record('TT1'),record('TT2',{created_date:'2026-07-01'}),record('TT3',{region:'East',site_id:'COW002',root_cause:'<img src=x onerror=alert(1)>'})]};
test('startup without credentials shows only sign-in and no invented operational data',()=>{assert.match(elements.get('#login-content').innerHTML,/Sign in to performance/);assert.equal(elements.get('#dashboard-shell').hidden,true);assert.equal(elements.get('#content').innerHTML,'');});
test('all application views render after approved sign-in and escape source text',async()=>{
 for(const [selector,value]of [['#project-url','https://example.supabase.co'],['#project-key','sb_publishable_test'],['#db-email','test@example.com'],['#db-password','test-password']])document.querySelector(selector).value=value;
 const form=new Element();form.id='connection-form';for(const listener of events.submit)await listener({preventDefault(){},target:form});assert.equal(elements.get('#dashboard-shell').hidden,false);
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy','causes','sites','tickets','review','settings']){app.navigate(view);const html=elements.get('#content').innerHTML;assert.ok(html.length>500,view);assert.ok(!html.includes('NaN'),view);assert.ok(!html.includes('<img src=x'),view);assert.ok(!html.includes('undefined'),view);assert.ok(!/power\s?bi/i.test(html),view);}
});
test('site drill-down restricts the ticket register to the selected COW',async()=>{
 app.navigate('sites');const button=new Element();button.dataset={site:'COW002'};button.id='';const event={target:{closest:selector=>selector==='button,a'?button:null}};for(const listener of events.click)await listener(event);
 assert.equal(app.state.view,'tickets');assert.equal(app.state.site_id,'COW002');const html=elements.get('#content').innerHTML;assert.ok(html.includes('TT3'));assert.ok(!html.includes('data-ticket="TT1|'));
});
test('navigation retains monthly scope but clears table query and pagination',()=>{app.state.query='something';app.state.page=3;app.navigate('overview');assert.equal(app.state.query,'');assert.equal(app.state.page,0);assert.equal(app.state.period,'2026-08');});
test('NSA opens its latest available week, respects a manual week and follows new NSA uploads',async()=>{
 const mixed={meta:{min_date:'2026-01-01',max_date:'2026-09-30',record_count:4,raw_record_count:4,duplicates_removed:0,quality:{}},records:[record('NSA1',{created_date:'2026-08-30',service_impact:'No impact'}),record('NSA2',{created_date:'2026-08-31',service_impact:'Degraded'}),record('CHILD',{created_date:'2026-08-31',service_impact:'No impact',parent_tt:'PR1'}),record('SA1',{created_date:'2026-09-30'})]};
 Object.assign(app.state,{followLatest:true,site_id:'all',root_cause:'all',region:'all',district:'all',scope:'all'});app.setData(mixed,'database');app.navigate('weekly-nsa');assert.equal(app.state.week,36);assert.equal(app.state.period,'2026-08');assert.match(elements.get('#content').innerHTML,/3<small>tickets/);assert.match(elements.get('#page-subtitle').textContent,/Latest NSA records: 31 Aug 2026/);
 elements.get('#week-filter').listeners.change({target:{value:'40'}});assert.equal(app.state.followLatest,false);app.navigate('weekly-sa');app.navigate('weekly-nsa');assert.equal(app.state.week,40,'explicit selections must not be silently replaced');
 const latestButton=new Element();latestButton.id='latest-period';for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?latestButton:null}});assert.equal(app.state.week,36);assert.equal(app.state.followLatest,true);
 const newer={...mixed,meta:{...mixed.meta,record_count:5},records:[...mixed.records,record('NSA3',{created_date:'2026-09-12',service_impact:'No impact'})]};app.setData(newer,'database');assert.equal(app.state.week,37);assert.match(elements.get('#content').innerHTML,/1<small>tickets/);app.navigate('weekly-sa');assert.equal(app.state.week,40,'SA must keep its September cutoff');
});
test('All weeks survives year and page changes; vendor choices group Others and source status stays hidden',()=>{
 const mixed={meta:{min_date:'2024-01-01',max_date:'2026-08-31',record_count:5},records:[record('OTHER',{created_date:'2026-01-01',vendor:'NSN'}),record('NOKIA',{vendor:'Nokia'}),record('HUAWEI',{vendor:'Huawei'}),record('PRIOR',{created_date:'2025-12-31',vendor:'Cisco'}),record('EARLIER',{created_date:'2024-01-01',vendor:'Specialized'})]};
 Object.assign(app.state,{followLatest:false,period:'2026-08',year:2026,vendor:'all',region:'all',district:'all',site_id:'all',root_cause:'all'});app.setData(mixed,'database');app.navigate('weekly-sa');
 assert.match(elements.get('#week-filter').innerHTML,/<option value="all">All weeks \(full year\)<\/option>/);
 elements.get('#week-filter').listeners.change({target:{value:'all'}});assert.equal(app.state.week,'all');assert.match(elements.get('#content').innerHTML,/3<small>tickets/);assert.match(elements.get('#content').innerHTML,/2026 · All weeks/);
 elements.get('#year-filter').listeners.change({target:{value:'2025'}});assert.equal(app.state.week,'all');assert.match(elements.get('#content').innerHTML,/1<small>tickets/);app.navigate('wow-y');assert.equal(app.state.week,'all');assert.match(elements.get('#content').innerHTML,/2025 · All weeks/);
 const vendors=elements.get('#vendor-filter').innerHTML;for(const vendor of ['Nokia','Ericsson','Huawei','Others'])assert.ok(vendors.includes(`value="${vendor}"`));assert.ok(!vendors.includes('NSN'));
 elements.get('#year-filter').listeners.change({target:{value:'2026'}});elements.get('#vendor-filter').listeners.change({target:{value:'Others'}});assert.match(elements.get('#content').innerHTML,/1<small>tickets/);assert.equal(mixed.records[0].vendor,'NSN');
 assert.equal(elements.get('#sidebar-source').textContent,'');assert.match(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),/class="sidebar-source" hidden/);
});
