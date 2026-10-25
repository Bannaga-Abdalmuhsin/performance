import test from 'node:test';import assert from 'node:assert/strict';
import {slaOutcome,summarize,normalizeRecords} from '../dist/core.mjs';
import {REPORTS,buildReport} from '../dist/analysis.mjs';
import {dashboardCards,dashboardSections,slaPerformanceData,outperformanceSvg} from '../dist/charts.mjs';
import {createDashboardExport,selectExportItems,createDashboardPdf} from '../dist/pdf-report.mjs';
import {PDFDocument} from '../dist/assets/vendor/pdf-lib-1.17.1.mjs';
const meta={min_date:'2024-01-01',max_date:'2026-10-24'},state={view:'weekly-sa',reportView:'weekly-sa',period:'2026-10',year:2026,week:43,region:'all',vendor:'all',site_label:'all'};
let seq=0;const row=(date,value,extra={})=>({id:'PR'+(++seq),ticket_number:'PR'+seq,created_date:date,exceeded_time:value,site_id:'COW1',region:'Central',district:'Riyadh',site_label:'VIP',vendor:'Nokia',root_cause:'Generator',duration_minutes:60,service_impact:'Outage',parent_tt:null,quality_flags:[],...extra});
const rows=(date,within,exceeded,extra={})=>[...Array.from({length:within},()=>row(date,'NOT EXCEED',extra)),...Array.from({length:exceeded},()=>row(date,'0.01',extra))];
const records=[...rows('2026-10-20',3,1),row('2026-10-20','NA'),...rows('2026-10-13',1,3),...rows('2026-09-12',2,0),...rows('2025-10-20',1,1),...rows('2024-10-20',2,1),...rows('2026-10-20',2,2,{service_impact:'No impact'}),...rows('2026-10-13',1,0,{service_impact:'Degraded'}),row('2026-10-20','0.5',{parent_tt:'PR111'}),row('2026-10-20','0.5',{repair_details:'Resolution fixation'})];

test('Exceeded TIME is authoritative, including contradictions, placeholders and formatted durations',()=>{
 for(const value of ['NOT EXCEED',' not exceed ','NOTEXCEED',0,'0','-0.01','00:00:00','-00:00:01'])assert.equal(slaOutcome({exceeded_time:value,sla_breached:true}),'within',String(value));
 for(const value of [0.01,'0.000000001','1e-7','00:00:01','25:00:00','01:02:00:00'])assert.equal(slaOutcome({exceeded_time:value,sla_breached:false}),'exceeded',String(value));
 for(const value of [null,undefined,'','NA','N/A','#VALUE!','invalid','00:99:00',false])assert.equal(slaOutcome({exceeded_time:value,sla_breached:false}),'unrecorded',String(value));
 assert.equal(slaOutcome({'Exceeded TIME':'NOT EXCEED'}),'within');
 assert.equal(slaOutcome({exceeded_time:'0.1',source_data:{'Exceeded TIME':'NOT EXCEED'}}),'within');
 assert.equal(slaOutcome({sla_breached:false}),'unrecorded');
 const summary=summarize([row('2026-10-20','NOT EXCEED',{sla_breached:true,sla_excluded:true}),row('2026-10-20','0.01',{sla_breached:false}),row('2026-10-20','NA')]);
 assert.equal(summary.slaWithin,1);assert.equal(summary.breached,1);assert.equal(summary.slaUnrecorded,1);assert.equal(summary.slaEligible,2);assert.equal(summary.slaCompliance,50);assert.equal(summary.slaExceedanceRate,50);
});

test('all six reports and exports compare within/exceeded counts and within-SLA rates, not ticket-volume change',()=>{
 const before=JSON.stringify(records);
 for(const id of Object.keys(REPORTS)){
  const selected={...state,view:id,reportView:id},report=buildReport(records,selected,{},meta),data=slaPerformanceData(report),cards=dashboardCards(report,selected,meta);
  const card=cards.find(c=>c.id==='card-sla-performance');assert(card,id);assert.equal(card.metric,report.now.summary.slaCompliance,id);assert.equal(card.kind,'sla');
  assert.notEqual(card.metric,report.ticketChange,id);
  for(let i=0;i<report.series.length;i++){
   const period=report.series[i],manual=records.filter(r=>!r.parent_tt&&!String(r.repair_details??'').toLowerCase().includes('resolution')&&(REPORTS[id].impact==='NSA'?r.service_impact!=='Outage':r.service_impact==='Outage')&&r.created_date>=period.range.start&&r.created_date<=period.range.end);
   const within=manual.filter(r=>r.exceeded_time==='NOT EXCEED').length,exceeded=manual.filter(r=>r.exceeded_time==='0.01').length,index=report.series.length-1-i;
   assert.equal(data.series[0].values[index],within,id);assert.equal(data.series[1].values[index],exceeded,id);
   assert.equal(data.lines[0].values[index],within+exceeded?within/(within+exceeded)*100:null,id);
   assert.equal(data.unrecorded[index],manual.length-within-exceeded,id);
  }
  const item=dashboardSections(report,selected,meta).flatMap(s=>s.charts).find(c=>c.id===id+'-outperformance-sla');assert(item,id);assert.deepEqual(item.data,data);assert.match(item.svg,/Within SLA/);assert.match(item.svg,/Exceeded SLA/);assert(!/fewer tickets|more tickets|NaN|Infinity|undefined/.test(item.svg));
  const manifest=createDashboardExport({records,state:selected,meta});assert.equal(manifest.cards[1].id,'card-sla-performance');assert.equal(manifest.cards[1].metric,card.metric);
 }
 const sa=buildReport(records,state,{},meta),nsa=buildReport(records,{...state,view:'weekly-nsa'}, {},meta);
 assert.equal(sa.now.summary.slaCompliance,75);assert.equal(sa.prev.summary.slaCompliance,25);assert.equal(dashboardCards(sa,state,meta)[1].delta,50);assert.equal(nsa.now.summary.slaCompliance,50);
 assert.equal(JSON.stringify(records),before);
});

test('no recorded SLA data stays unavailable; zero percent and percentage-point changes are real values',()=>{
 const missing=buildReport([row('2026-10-20','NA')],state,{},meta);assert.equal(missing.now.summary.slaCompliance,null);assert.equal(missing.now.summary.slaUnrecorded,1);assert.match(outperformanceSvg(slaPerformanceData(missing)),/Comparison unavailable/);
 const zero=buildReport([...rows('2026-10-20',0,2),...rows('2026-10-13',1,0)],state,{},meta),card=dashboardCards(zero,state,meta)[1];assert.equal(card.metric,0);assert.equal(card.delta,-100);assert.match(outperformanceSvg(slaPerformanceData(zero)),/>0\.0%</);assert.match(outperformanceSvg(slaPerformanceData(zero)),/-100\.0 pp/);
 const all=buildReport([...rows('2026-01-02',1,1),...rows('2025-12-02',3,1)],{...state,week:'all'}, {},meta);assert.equal(all.now.summary.slaCompliance,50);assert.equal(all.prev.summary.slaCompliance,75);
});

test('raw uploads preserve Exceeded TIME and derive outcomes without relying on Exceed SLA flags',()=>{
 const raw=[{'Ticket Number':'PR120','Create Date':'20/10/2026','Exceeded TIME':'NOT EXCEED','Exceed SLA':'Yes'},{'Ticket Number':'PR121','Create Date':'20/10/2026','Exceeded TIME':0.01,'Exceed SLA':'No'}],result=normalizeRecords(raw);
 assert.equal(result.records[0].exceeded_time,'NOT EXCEED');assert.equal(result.records[1].exceeded_time,'0.01');assert.deepEqual(result.records.map(slaOutcome),['within','exceeded']);assert.equal(result.records[1].source_data['Exceeded TIME'],0.01);
});

test('PDF exports contain the authoritative SLA card and the full within/exceeded comparison graphic',async()=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
 const full=createDashboardExport({records,state,meta}),manifest=selectExportItems(full,['card-sla-performance','weekly-sa-outperformance-sla']),rendered=[];
 const pdf=await createDashboardPdf(manifest,{rasterize:async svg=>{rendered.push(svg);return png;},assetLoader:async()=>png});
 assert.deepEqual(pdf.exportedIds,['card-sla-performance','weekly-sa-outperformance-sla']);assert.equal(pdf.chartPartCount,1);assert.match(rendered.join(''),/75\.0%/);assert.match(rendered.join(''),/Within 3 \(75\.0%\) \| Exceeded 1 \(25\.0%\) \| Unrecorded 1/);assert.match(rendered.join(''),/50\.0 pp/);assert(!(rendered.join('').includes('fewer tickets')));assert((await PDFDocument.load(pdf.bytes)).getPageCount()>0);
});
