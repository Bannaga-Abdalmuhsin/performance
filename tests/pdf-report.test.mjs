import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewReport,printAnalysisReport} from '../dist/pdf-report.mjs';
import {REPORTS,buildReport,comparisonGroups,latestReportDate} from '../dist/analysis.mjs';
const row=(id,date,extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',root_cause:'Self Cleared',parent_tt:'PR-parent',duration_minutes:60,region:'Central',district:'Riyadh',site_id:'COW1',site_label:'VIP',severity:'High',sla_breached:false,quality_flags:[],...extra});
const records=[row('PR1','2026-08-31'),row('PR2','2026-08-30',{region:'East',duration_minutes:120}),row('PR3','2026-07-31'),row('PR4','2025-08-31'),row('PR5','2024-08-31'),row('NSA','2026-08-31',{service_impact:'No impact'}),row('SA','2026-09-30')];
const state={view:'overview',reportView:'overview',period:'2026-08',year:2026,week:36,scope:'all',region:'all',district:'all'},meta={min_date:'2024-01-01',max_date:'2026-09-30'};
const profiles=Object.fromEntries(Object.keys(REPORTS).map(id=>[id,{impact_mode:'NSA',excluded_root_causes:['Self Cleared'],visuals:{root_cause:{top_n:1,row_rules:[{field:'Root Cause Details',values:['Self Cleared'],exclude:true}],group_rules:[{period:0,value:50,kind:1}]}}}]));
const options={records,state,profiles,meta,generatedAt:'2026-10-18T12:00:00Z',assetBase:'https://example.com/performance/dist/'};
test('all records and all chart categories survive retired page and visual criteria',()=>{
 const report=buildReport(records,{...state,scope:'powerbi'},profiles,meta,'overview');
 assert.equal(report.now.summary.tickets,2);assert.equal(report.now.summary.durationMinutes,180);assert.deepEqual(comparisonGroups(report,'root_cause').map(x=>x.name),['Self Cleared']);
 assert.equal(latestReportDate(records,profiles,meta,'weekly-nsa'),'2026-08-31');
});
test('each report exports its selected period, impact group and truthful comparison totals',()=>{
 for(const id of Object.keys(REPORTS)){
  const result=createReviewReport({...options,state:{...state,view:id,reportView:id}}),expected=buildReport(records,state,{},meta,id);
  assert.equal(result.report.now.summary?.tickets,expected.now.summary?.tickets,id);assert.equal(result.report.now.summary?.durationMinutes,expected.now.summary?.durationMinutes,id);assert.equal(result.report.definition.title,REPORTS[id].title);
  assert.equal(result.pageCount,5);assert.match(result.html,/Executive assessment/);assert.match(result.html,/Recommended follow-up/);assert.match(result.html,/stc-logo\.png/);assert.match(result.html,/aces-managed-services-logo\.png/);assert.ok(result.html.includes(REPORTS[id].title));assert.ok(!/Power\s?BI|NaN|undefined|Infinity/.test(result.html),id);
 }
});
test('PDF scope captures operational filters and ticket search without changing the dashboard state',()=>{
 const selected={...state,view:'tickets',query:'PR1',region:'Central',root_cause:'Self Cleared'},before={...selected};
 const result=createReviewReport({...options,state:selected});assert.equal(result.report.now.summary.tickets,1);assert.equal(result.report.now.summary.durationMinutes,60);assert.deepEqual(selected,before);assert.deepEqual(result.selectedFilters,['Region: Central','Root cause: Self Cleared','Search: PR1']);
 const east=createReviewReport({...options,state:{...state,region:'East'}});assert.equal(east.report.now.summary.tickets,1);assert.equal(east.report.now.summary.durationMinutes,120);assert.match(east.html,/Region: East/);
 const absent=createReviewReport({...options,state:{...state,view:'tickets',reportView:'weekly-nsa',query:'no match'}});assert.equal(absent.report.now.covered,true);assert.equal(absent.report.now.summary.tickets,0);assert.equal(absent.report.sourceCoverage.max_date,'2026-08-31');
});
test('unavailable periods, partial NSA coverage and a zero comparison baseline are described accurately',()=>{
 const unavailable=createReviewReport({...options,state:{...state,period:'2023-01',year:2023}});assert.equal(unavailable.report.now.summary,null);assert.match(unavailable.html,/outside the available source date range/);
 const nsa=createReviewReport({...options,state:{...state,view:'weekly-nsa'}});assert.equal(nsa.report.now.partial,true);assert.equal(nsa.report.now.summary.tickets,1);assert.match(nsa.html,/zero comparison baseline/);assert.ok(!nsa.html.includes('increased by 100.0%'));
});
test('full-year PDF captures All weeks, grouped vendor scope and prior calendar years',()=>{
 const source=[row('a','2026-01-01',{vendor:'NSN'}),row('b','2026-08-31',{vendor:'Cisco'}),row('c','2026-08-31',{vendor:'Huawei'}),row('d','2025-12-31',{vendor:'Uncategorized'})],selected={...state,view:'weekly-sa',week:'all',vendor:'Others'};
 const result=createReviewReport({...options,records:source,state:selected});assert.equal(result.report.now.summary.tickets,2);assert.equal(result.report.prev.summary.tickets,1);assert.equal(result.report.now.range.end,'2026-12-31');assert.match(result.html,/2026 · All weeks/);assert.match(result.html,/Vendor: Others/);assert.ok(!result.html.includes('Day 1 is the first date'));assert.ok(!/NaN|undefined/.test(result.html));
});
test('source labels and saved notes are escaped; long notes paginate without truncation',()=>{
 const note='<script>alert(1)</script>\n'+'A long review line repeated for pagination.\n'.repeat(95),result=createReviewReport({...options,records:[row('unsafe','2026-08-31',{root_cause:'<img src=x onerror=alert(1)>'})],notes:{commentary:note,actions:'Final action <&>'}});
 assert.ok(result.pageCount>7);assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('<img src=x'));assert.match(result.html,/&lt;script&gt;/);assert.match(result.html,/Final action &lt;&amp;&gt;/);assert.ok(result.html.includes('Management commentary (continued)'));
});
test('export prepares a separate report document and invokes its native PDF dialog',async()=>{
 let frame,printed=false,removed=false;const saved={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
 try{
  globalThis.requestAnimationFrame=fn=>fn();globalThis.document={baseURI:'https://example.com/performance/dist/',createElement(tag){assert.equal(tag,'iframe');frame={style:{},setAttribute(){},remove(){removed=true;},contentDocument:{images:[],fonts:{ready:Promise.resolve()}},contentWindow:{addEventListener(){},focus(){},print(){printed=true;}}};return frame;},body:{append(el){queueMicrotask(()=>el.onload());}}};
  const filename=await printAnalysisReport(options);assert.ok(printed);assert.match(filename,/stc-COW-overview/);assert.match(frame.srcdoc,/Executive assessment/);assert.equal(removed,false);
 }finally{globalThis.document=saved.document;globalThis.requestAnimationFrame=saved.requestAnimationFrame;}
});
