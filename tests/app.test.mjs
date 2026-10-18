// Application rendering and event checks in a minimal DOM harness. This is not
// a browser or visual-layout test; it exercises the real application module.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.options=[{}];this.innerHTML='';this.value='';this.dataset={};this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
 querySelectorAll(){return [];}addEventListener(event,fn){this.listeners[event]=fn;}setAttribute(){}focus(){}showModal(){this.open=true;}close(){this.open=false;}
}
const elements=new Map(),events={};
globalThis.document={querySelector(s){if(!elements.has(s))elements.set(s,new Element());return elements.get(s);},querySelectorAll(){return [];},addEventListener(n,fn){(events[n]||=[]).push(fn);},createElement(){return new Element();}};
globalThis.window={PERFORMANCE_CONFIG:{projectUrl:'https://example.supabase.co'},addEventListener(){}};
const cache=new Map();globalThis.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};globalThis.sessionStorage=globalThis.localStorage;
globalThis.location={hash:'#overview'};globalThis.history={replaceState(){}};
globalThis.fetch=async(path)=>({ok:true,json:async()=>JSON.parse(readFileSync(new URL('../dist/'+path,import.meta.url),'utf8'))});
const app=await import('../dist/app.mjs');await app.ready;
const record=(id,extra={})=>({id:id+'|COW001',ticket_number:id,site_id:'COW001',region:'Central',district:'Riyadh City',site_label:'VIP',vendor:'Ericsson',severity:'High',created_date:'2026-08-01',created_at:'2026-08-01T10:00:00+03:00',duration_minutes:60,sla_breached:false,sla_excluded:false,parent_tt:null,root_cause:'Generator Issue',service_impact:'Outage',quality_flags:[],...extra});
const dataset={meta:{min_date:'2026-07-01',max_date:'2026-08-31',record_count:3,raw_record_count:3,duplicates_removed:0,quality:{},profile:{excluded_root_causes:['Telecom']}},records:[record('TT1'),record('TT2',{created_date:'2026-07-01'}),record('TT3',{region:'East',site_id:'COW002',root_cause:'<img src=x onerror=alert(1)>'})]};
test('startup without credentials exposes setup and no invented operational data',()=>{assert.match(elements.get('#content').innerHTML,/Connect your performance data/);});
test('all application views render against the same real controller and escape source text',()=>{
 app.setData(dataset,'snapshot');for(const view of ['weekly-sa','weekly-nsa','overview','mom-y','wow-y','yoy','formulas','causes','sites','tickets','review','settings']){app.navigate(view);const html=elements.get('#content').innerHTML;assert.ok(html.length>500,view);assert.ok(!html.includes('NaN'),view);assert.ok(!html.includes('<img src=x'),view);assert.ok(!html.includes('undefined'),view);}
});
test('site drill-down restricts the ticket register to the selected COW',async()=>{
 app.navigate('sites');const button=new Element();button.dataset={site:'COW002'};button.id='';const event={target:{closest:selector=>selector==='button,a'?button:null}};for(const listener of events.click)await listener(event);
 assert.equal(app.state.view,'tickets');assert.equal(app.state.site_id,'COW002');const html=elements.get('#content').innerHTML;assert.ok(html.includes('TT3'));assert.ok(!html.includes('data-ticket="TT1|'));
});
test('navigation retains monthly scope but clears table query and pagination',()=>{app.state.query='something';app.state.page=3;app.navigate('overview');assert.equal(app.state.query,'');assert.equal(app.state.page,0);assert.equal(app.state.period,'2026-08');});
