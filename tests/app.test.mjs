// Application rendering and event checks in a minimal DOM harness. This is not
// a browser or visual-layout test; it exercises the real application module.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {ROOT_CAUSE_GROUPS} from '../dist/core.mjs';
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
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy','causes','sites','tickets','settings']){app.navigate(view);const html=elements.get('#content').innerHTML;assert.ok(html.length>500,view);assert.ok(!html.includes('NaN'),view);assert.ok(!html.includes('<img src=x'),view);assert.ok(!html.includes('undefined'),view);assert.ok(!/power\s?bi/i.test(html),view);}
});
test('site drill-down restricts the ticket register to the selected COW',async()=>{
 app.navigate('sites');const button=new Element();button.dataset={site:'COW002'};button.id='';const event={target:{closest:selector=>selector==='button,a'?button:null}};for(const listener of events.click)await listener(event);
 assert.equal(app.state.view,'tickets');assert.equal(app.state.site_id,'COW002');const html=elements.get('#content').innerHTML;assert.ok(html.includes('TT3'));assert.ok(!html.includes('data-ticket="TT1|'));
});
test('navigation retains monthly scope but clears table query and pagination',()=>{app.state.query='something';app.state.page=3;app.navigate('overview');assert.equal(app.state.query,'');assert.equal(app.state.page,0);assert.equal(app.state.period,'2026-08');});
test('NSA opens its latest available week, respects a manual week and follows new NSA uploads',async()=>{
 const mixed={meta:{min_date:'2026-01-01',max_date:'2026-09-30',record_count:4,raw_record_count:4,duplicates_removed:0,quality:{}},records:[record('NSA1',{created_date:'2026-08-30',service_impact:'No impact'}),record('NSA2',{created_date:'2026-08-31',service_impact:'Degraded'}),record('CHILD',{created_date:'2026-08-31',service_impact:'No impact',parent_tt:'PR1'}),record('SA1',{created_date:'2026-09-30'})]};
 Object.assign(app.state,{followLatest:true,site_id:'all',root_cause:'all',region:'all',district:'all',scope:'all'});app.setData(mixed,'database');app.navigate('weekly-nsa');assert.equal(app.state.week,36);assert.equal(app.state.period,'2026-08');assert.match(elements.get('#content').innerHTML,/2<small>tickets/);assert.match(elements.get('#page-subtitle').textContent,/Latest NSA records: 31 Aug 2026/);
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

test('root-cause categories drive filters, ticket drill-down and subsequent uploads',async()=>{
 const source={meta:{...dataset.meta,record_count:3},records:[record('TTROOT1',{root_cause:'Gen #2 Engine - Fuel Pump Defective'}),record('TTROOT2',{root_cause:'Fuel Tank - Diesel Empty'}),record('TTROOT3',{root_cause:'Door Issue'})]};
 Object.assign(app.state,{followLatest:false,period:'2026-08',year:2026,root_cause:'all',region:'all',district:'all',vendor:'all',site_id:'all',duration_bucket:'all',severity:'all',site_label:'all'});app.setData(source,'database');app.navigate('overview');
 const choices=elements.get('#cause-filter').innerHTML;for(const name of ROOT_CAUSE_GROUPS)assert.ok(choices.includes(`value="${name}"`));assert.equal((choices.match(/<option /g)||[]).length,15);assert.ok(!choices.includes('Fuel Pump Defective'));
 const button=new Element();button.dataset={cause:'Generator'};for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?button:null}});
 assert.equal(app.state.view,'tickets');assert.equal(app.state.root_cause,'Generator');let html=elements.get('#content').innerHTML;assert.ok(html.includes('TTROOT1'));assert.ok(html.includes('TTROOT2'));assert.ok(!html.includes('TTROOT3'));
 const detail=new Element();detail.dataset={ticket:'TTROOT1|COW001'};for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?detail:null}});
 assert.ok(elements.get('#detail-content').innerHTML.includes('Gen #2 Engine - Fuel Pump Defective'));assert.ok(elements.get('#detail-content').innerHTML.includes('Root cause category'));
 app.setData({...source,meta:{...source.meta,record_count:4},records:[...source.records,record('TTROOT4',{root_cause:'G3 - Engine Minor Problem'})]},'database');html=elements.get('#content').innerHTML;assert.ok(html.includes('TTROOT4'));assert.ok(!html.includes('TTROOT3'));assert.equal(source.records[0].root_cause,'Gen #2 Engine - Fuel Pump Defective');
});


test('parent-linked tickets stay out of all views, filters, latest selection and subsequent uploads',async()=>{
 const source={meta:{...dataset.meta,min_date:'2024-01-01',max_date:'2026-10-01',record_count:4},records:[record('PARENT',{created_date:'2026-08-31'}),record('NSA',{created_date:'2026-08-30',service_impact:'No impact'}),record('CHILD-SA',{created_date:'2026-09-30',parent_tt:'PARENT',region:'Child only region',duration_minutes:999999}),record('CHILD-NSA',{created_date:'2026-10-01',parent_tt:'xref',service_impact:'No impact',region:'Child only region'})]},before=structuredClone(source);
 Object.assign(app.state,{followLatest:true,root_cause:'all',region:'all',district:'all',vendor:'all',site_id:'all',duration_bucket:'all',severity:'all',site_label:'all',query:''});app.navigate('overview');app.setData(source,'database');
 assert.equal(app.state.period,'2026-08');assert.equal(app.state.week,36);assert.equal(elements.get('#nav-count').textContent,'2');assert.ok(!elements.get('#region-filter').innerHTML.includes('Child only region'));
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy','causes','sites','tickets']){
  app.navigate(view);const html=elements.get('#content').innerHTML;assert.ok(!html.includes('CHILD-SA'),view);assert.ok(!html.includes('CHILD-NSA'),view);assert.ok(!html.includes('Child only region'),view);
 }
 app.navigate('overview');app.navigate('tickets');assert.ok(elements.get('#content').innerHTML.includes('PARENT'));
 const dialog=elements.get('#detail-dialog');if(dialog)dialog.open=false;const detail=new Element();detail.dataset={ticket:'CHILD-SA|COW001'};
 for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?detail:null}});assert.ok(!elements.get('#detail-dialog')?.open);
 const childUpload={...source,meta:{...source.meta,max_date:'2026-11-01',record_count:5},records:[...source.records,record('CHILD-NEW',{created_date:'2026-11-01',parent_tt:'OUTAGE'})]};app.setData(childUpload,'database');assert.equal(app.state.period,'2026-08');assert.equal(elements.get('#nav-count').textContent,'2');
 const newUpload={...childUpload,meta:{...childUpload.meta,record_count:6},records:[...childUpload.records,record('NEW-SA',{created_date:'2026-09-20'})]};app.setData(newUpload,'database');assert.equal(app.state.period,'2026-09');assert.equal(elements.get('#nav-count').textContent,'3');assert.deepEqual(source,before);
});


test('resolution fixation stays out of views, filters, searches and subsequent uploads',async()=>{
 const source={meta:{...dataset.meta,min_date:'2024-01-01',max_date:'2026-10-01',record_count:4},records:[record('REAL-SA',{created_date:'2026-08-31'}),record('REAL-NSA',{created_date:'2026-08-30',service_impact:'No impact'}),record('FIX-SA',{created_date:'2026-09-30',repair_details:'Resolution fixation',region:'Fixation only'}),record('FIX-NSA',{created_date:'2026-10-01',repair_details:'RESOLUTION completed',service_impact:'No impact',region:'Fixation only'})]},before=structuredClone(source);
 Object.assign(app.state,{followLatest:true,root_cause:'all',region:'all',district:'all',vendor:'all',site_id:'all',duration_bucket:'all',severity:'all',site_label:'all',query:''});app.navigate('overview');app.setData(source,'database');
 assert.equal(app.state.period,'2026-08');assert.equal(elements.get('#nav-count').textContent,'2');assert.ok(!elements.get('#region-filter').innerHTML.includes('Fixation only'));
 for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy','causes','sites','tickets']){app.navigate(view);const html=elements.get('#content').innerHTML;assert.ok(!html.includes('FIX-SA'),view);assert.ok(!html.includes('FIX-NSA'),view);assert.ok(!html.includes('Fixation only'),view);}
 app.navigate('overview');app.navigate('tickets');app.state.query='FIX-SA';app.render();assert.ok(!elements.get('#content').innerHTML.includes('data-ticket="FIX-SA|'));
 const dialog=elements.get('#detail-dialog');dialog.open=false;const detail=new Element();detail.dataset={ticket:'FIX-SA|COW001'};for(const listener of events.click)await listener({target:{closest:selector=>selector==='button,a'?detail:null}});assert.equal(dialog.open,false);
 app.navigate('overview');const fixUpload={...source,meta:{...source.meta,max_date:'2026-11-01',record_count:5},records:[...source.records,record('FIX-NEW',{created_date:'2026-11-01',repair_details:'resolution'})]};app.setData(fixUpload,'database');assert.equal(app.state.period,'2026-08');assert.equal(elements.get('#nav-count').textContent,'2');
 app.setData({...fixUpload,meta:{...fixUpload.meta,record_count:6},records:[...fixUpload.records,record('REAL-NEW',{created_date:'2026-09-20'})]},'database');assert.equal(app.state.period,'2026-09');assert.equal(elements.get('#nav-count').textContent,'3');assert.deepEqual(source,before);
});
