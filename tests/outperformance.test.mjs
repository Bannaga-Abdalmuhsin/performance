import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../dist/analysis.mjs';
import {dashboardCards,dashboardSections,cardSvg,outperformanceSvg} from '../dist/charts.mjs';
import {renderReport} from '../dist/report.mjs';
import {createDashboardExport,selectExportItems,createDashboardPdf} from '../dist/pdf-report.mjs';
import {PDFDocument} from '../dist/assets/vendor/pdf-lib-1.17.1.mjs';

const targets=['weekly-sa','weekly-nsa','overview'],meta={min_date:'2024-01-01',max_date:'2026-10-24'};
const state={view:'weekly-sa',reportView:'weekly-sa',period:'2026-10',year:2026,week:43,region:'all',vendor:'all'};
let sequence=0;
const row=(date,extra={})=>({id:'PR'+(++sequence),ticket_number:'PR'+sequence,site_id:'COW1',region:'Central',district:'Riyadh',vendor:'Nokia',severity:'High',site_label:'VIP',root_cause:'Self Cleared',created_date:date,duration_minutes:60,service_impact:'Outage',parent_tt:null,repair_details:'Generator repaired',sla_breached:true,quality_flags:[],...extra});
const source=[...Array.from({length:2},()=>row('2026-10-20')),...Array.from({length:4},()=>row('2026-10-13')),...Array.from({length:12},()=>row('2026-09-12')),
 ...Array.from({length:3},()=>row('2026-10-20',{service_impact:'No impact'})),...Array.from({length:2},()=>row('2026-10-13',{service_impact:'Degraded'})),
 row('2026-10-20',{parent_tt:'PR900'}),row('2026-10-20',{repair_details:'rEsOlUtIoN fixation'}),row('2026-09-12',{parent_tt:'OUTAGE'})];
const chart=report=>dashboardSections(report,state,meta).flatMap(s=>s.charts).find(c=>c.id===report.id+'-outperformance-sla');

test('outperformance uses filtered ticket change and preserves the signed source measure',()=>{
 const before=JSON.stringify(source);
 for(const [id,expected]of [['weekly-sa',-50],['weekly-nsa',50],['overview',-50]]){
  const selection={...state,view:id,reportView:id},report=buildReport(source,selection,{},meta);
  const card=dashboardCards(report,selection,meta).find(c=>c.id==='card-ticket-change'),item=chart(report);
  assert.equal(card.label,'Outperformance SLA %');assert.equal(card.metric,expected);
  assert.equal(item.title,'Outperformance SLA %');assert.equal(item.data.lines[0].name,'Outperformance SLA %');assert.equal(item.data.lines[0].values.at(-1),expected);
  assert.equal(item.data.series[0].values.at(-1),report.now.summary.tickets);
  assert.match(item.svg,/<text data-outperformance-value[^>]*>[^<]+%<\/text>/);assert.equal(item.kind,'performance');assert(!/NaN|Infinity|undefined/.test(item.svg));
  const html=renderReport(report,selection,meta);assert.match(html,/Outperformance SLA %/);assert(!html.includes('SLA compliance'));assert(!html.includes('Ticket performance KPI'));assert.equal((html.match(/data-export-card=/g)||[]).length,8);
 }
 // All source tickets are marked as breached: this measure must still be ticket change.
 const filtered=buildReport([...source,row('2026-10-20',{region:'West',vendor:'Huawei'})],{...state,region:'Central',vendor:'Nokia'},{},meta,'weekly-sa');
 assert.equal(chart(filtered).data.lines[0].values.at(-1),-50);
 assert.equal(JSON.stringify(source),before);
});

test('zero baselines, missing coverage, year boundaries, and All weeks keep platform rules',()=>{
 for(const id of ['weekly-sa','weekly-nsa']){
  const extra=id==='weekly-nsa'?{service_impact:'No impact'}:{};
  assert.equal(chart(buildReport([row('2026-10-25',extra)],state,{}, {...meta,max_date:'2026-10-25'},id)).data.lines[0].values.at(-1),0);
  assert.equal(chart(buildReport([row('2026-10-20',extra)],state,{},meta,id)).data.lines[0].values.at(-1),100);
  const missing=buildReport([row('2026-10-20',extra)],state,{}, {...meta,min_date:'2026-10-18'},id);
  assert.equal(chart(missing).data.lines[0].values.at(-1),null);
 }
 const years=[row('2026-10-20'),row('2026-01-02'),row('2025-04-02')],all=buildReport(years,{...state,week:'all'},{},meta,'weekly-sa');
 assert.equal(chart(all).data.lines[0].values.at(-1),100);
 const january=buildReport([row('2026-01-02'),row('2025-12-14'),row('2025-12-15')],{...state,period:'2026-01'},{},meta,'overview');
 assert.equal(chart(january).data.lines[0].values.at(-1),-50);
 for(const id of ['mom-y','wow-y','yoy']){
  const r=buildReport(source,state,{},meta,id);
  assert.equal(chart(r),undefined);assert.equal(dashboardCards(r,state,meta)[1].label,'Ticket change');
 }
});

test('static outperformance graphics print the percentage, ticket difference, and every period count',()=>{
 const data=(values,metric)=>({labels:values.map((_,i)=>'W'+(41+i)+' · 2026'),series:[{values}],lines:[{values:values.map((_,i)=>i===values.length-1?metric:null)}]});
 const negative=outperformanceSvg(data([114,112],-2/114*100));
 assert.match(negative,/<text data-outperformance-value[^>]*>-1\.8%<\/text>/);assert.match(negative,/>2 fewer tickets<\/text>/);
 for(const count of [114,112])assert.match(negative,new RegExp('<text data-period-tickets[^>]*>'+count+'<\\/text>'));
 const three=outperformanceSvg(data([100,120,150],25));assert.match(three,/>\+25\.0%<\/text>/);assert.match(three,/>30 more tickets<\/text>/);
 assert.equal((three.match(/data-period-tickets/g)||[]).length,3);
 const zero=outperformanceSvg(data([0,0],0));assert.match(zero,/>0\.0%<\/text>/);assert.match(zero,/>No ticket difference<\/text>/);
 const missing=outperformanceSvg(data([null,2],null));assert.match(missing,/<text data-outperformance-value[^>]*>—<\/text>/);assert.match(missing,/>Comparison unavailable<\/text>/);
 for(const svg of [negative,three,zero,missing])assert(!/NaN|Infinity|undefined/.test(svg));
});

test('PDF selection includes the KPI and full comparison chart with the dashboard values',async()=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
 for(const id of targets){
  const selection={...state,view:id,reportView:id};
  const full=createDashboardExport({records:source,state:selection,meta});
  const selected=selectExportItems(full,['card-ticket-change',id+'-outperformance-sla']);
  assert.equal(selected.items.length,2);assert(selected.items.every(i=>i.label==='Outperformance SLA %'));
  assert.match(cardSvg(selected.cards[1]),/Outperformance SLA %/);
  const rendered=[];
  const pdf=await createDashboardPdf(selected,{rasterize:async svg=>{rendered.push(svg);return png;},assetLoader:async()=>png});
  assert.deepEqual(pdf.exportedIds,['card-ticket-change',id+'-outperformance-sla']);assert.equal(pdf.chartPartCount,1);
  assert.match(rendered.join(''),/Outperformance SLA %/);assert(!(rendered.join('').includes('SLA compliance')));
  const document=await PDFDocument.load(pdf.bytes);assert(document.getPageCount()>0);
 }
});
