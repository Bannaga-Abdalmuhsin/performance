import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../dist/analysis.mjs';
import {cowPerformanceData,renderCowPerformanceTable,cowPerformanceChart} from '../dist/site-table.mjs';
import {exportChartParts} from '../dist/charts.mjs';
import {createDashboardExport,selectExportItems,exportChartRows,createDashboardPdf} from '../dist/pdf-report.mjs';
import {PDFDocument} from '../dist/assets/vendor/pdf-lib-1.17.1.mjs';

const state={view:'sites',reportView:'weekly-sa',year:2026,week:42,period:'2026-10',scope:'all',sort:'tickets',dir:-1};
const meta={min_date:'2024-01-01',max_date:'2026-10-24'};
const row=(id,extra={})=>({id,ticket_number:id,site_id:'COW009',region:'South',district:'Najran',site_name:'Camp',created_date:'2026-10-12',root_cause:'Generator Issue',service_impact:'Outage',parent_tt:null,repair_details:'Fault repaired',duration_minutes:60,exceeded_time:'NOT EXCEED',...extra});
const records=[row('a'),row('b',{root_cause:'PMR',exceeded_time:'0.02',sla_breached:false}),row('c'),row('d',{site_id:'COW720',region:'Central',sla_breached:true}),row('e',{site_id:'COWUNKNOWN',exceeded_time:null,sla_breached:true}),row('child',{parent_tt:'PR123'}),row('fix',{repair_details:'Resolution fixation'}),row('nsa',{service_impact:'No impact'}),row('outside',{created_date:'2026-10-18'})];
const report=(source=records,id='weekly-sa',selection=state)=>buildReport(source,selection,{},meta,id);

test('COW table uses the selected period, actual fault counts, canonical causes and Exceeded TIME',()=>{
 const data=cowPerformanceData(report());
 assert.match(data.title,/Outages Week #42/);assert.match(data.title,/11 Oct 2026/);assert.match(data.title,/17 Oct 2026/);
 assert.deepEqual(data.columns.map(c=>c[0]),['COW ID','Region','Outages Counts','Root Cause','Breaches SLA']);
 assert.equal(data.rows.reduce((sum,r)=>sum+r.tickets,0),5);assert.equal(data.rows[0].name,'COW009');assert.equal(data.rows[0].tickets,3);
 assert.equal(data.rows[0].region,'SR');assert.equal(data.rows[0].rootCause,'Generator / PMR');assert.equal(data.rows[0].breachOutcome,'Yes');
 assert.equal(data.rows.find(r=>r.name==='COW720').breachOutcome,'No');assert.equal(data.rows.find(r=>r.name==='COWUNKNOWN').breachOutcome,'Unrecorded');
});
test('NSA table labels and counts remain separate from outages and follow the selected year',()=>{
 const data=cowPerformanceData(report(records,'weekly-nsa'));
 assert.match(data.title,/NSA tickets Week #42/);assert.equal(data.columns[2][0],'Tickets Counts');assert.equal(data.rows[0].tickets,1);
 const annual=cowPerformanceData(report(records,'weekly-sa',{...state,week:'all'}));assert.match(annual.title,/2026 · All weeks/);assert.equal(annual.rows.reduce((sum,r)=>sum+r.tickets,0),6);
 const monthly=cowPerformanceData(report(records,'overview'));assert.match(monthly.title,/Oct 2026/);assert.ok(!monthly.title.includes('Week #'));
});
test('a mixture of known and missing SLA outcomes never reports a false No',()=>{
 const data=cowPerformanceData(report([row('within'),row('missing',{exceeded_time:'NA'})]));assert.equal(data.rows[0].breachOutcome,'Unrecorded');
 const exceeded=cowPerformanceData(report([row('missing',{exceeded_time:null}),row('late',{exceeded_time:'01:30:00'})]));assert.equal(exceeded.rows[0].breachOutcome,'Yes');
});
test('COW search, column sorting and source data are preserved',()=>{
 const before=JSON.stringify(records),source=report();
 assert.deepEqual(cowPerformanceData(source,{query:'central'}).labels,['COW720']);assert.deepEqual(cowPerformanceData(source,{query:'PMR'}).labels,['COW009']);assert.equal(cowPerformanceData(source,{query:'camp'}).rows.length,3);
 assert.deepEqual(cowPerformanceData(source,{sort:'name',dir:1}).labels,['COW009','COW720','COWUNKNOWN']);assert.deepEqual(cowPerformanceData(source,{sort:'breached',dir:-1}).labels,['COW009','COW720','COWUNKNOWN']);
 assert.equal(JSON.stringify(records),before);
});
test('HTML and exported SVG escape source text and display the compact five-column table',()=>{
 const chart=cowPerformanceChart(report([row('html',{site_id:'<COW>&"',region:'<Region>&'})])),html=renderCowPerformanceTable(chart.data);
 assert.match(html,/<caption>Outages Week #42/);assert.match(html,/scope="col"/);assert.match(html,/data-site="&lt;COW&gt;&amp;&quot;"/);assert.ok(!html.includes('<COW>'));assert.ok(!html.includes('Restore hrs'));assert.ok(!html.includes('Recurring'));
 assert.match(chart.svg,/&lt;Region&gt;&amp;/);assert.ok(!/NaN|undefined|Infinity/.test(chart.svg));
});
test('site PDF exports every matching COW with repeated table headers beyond screen pagination',async()=>{
 const source=Array.from({length:31},(_,i)=>row('pr'+i,{site_id:'COW'+String(i).padStart(3,'0'),root_cause:i%2?'PMR':'Generator Issue'})),manifest=createDashboardExport({records:source,state,meta});
 const chart=manifest.items.find(i=>i.chart?.kind==='table').chart,chosen=selectExportItems(manifest,[chart.id]),parts=exportChartRows(chosen).flatMap(r=>r.charts);
 assert.equal(chart.data.rows.length,31);assert.deepEqual(parts.flatMap(p=>p.data.labels),chart.data.labels);assert.equal(parts.length,3);assert.equal(exportChartParts(chart).length,3);
 for(const part of parts){assert.match(part.svg,/Breaches SLA/);assert.match(part.svg,/Outages Week #42/);assert.equal(part.partCount,3);assert.ok(Number(part.svg.match(/viewBox="0 0 1100 (\d+)"/)[1])<=600);}
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')),rendered=[];
 const result=await createDashboardPdf(chosen,{rasterize:async svg=>{rendered.push(svg);return png;},assetLoader:async()=>png});
 assert.equal(result.chartPartCount,3);assert.equal((await PDFDocument.load(result.bytes)).getPageCount(),result.pageCount);assert.ok(rendered.some(svg=>svg.includes('COW030')));
 const filtered=createDashboardExport({records:source,state:{...state,query:'COW030',page:99},meta});assert.deepEqual(filtered.items.find(i=>i.chart?.kind==='table').chart.data.labels,['COW030']);assert.deepEqual(filtered.selectedFilters,['Search: COW030']);
});
test('empty site tables render and export a clear empty state',()=>{
 const chart=cowPerformanceChart(report([]));assert.match(renderCowPerformanceTable(chart.data),/No matching COWs/);assert.match(chart.svg,/No matching COWs/);assert.equal(exportChartParts(chart).length,1);
});
