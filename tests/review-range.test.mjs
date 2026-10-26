import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport,reportPeriods,validReviewDates,shiftReviewDate} from '../dist/analysis.mjs';
import {areaData,yearMonthData,comparisonData,dashboardCards} from '../dist/charts.mjs';
import {cowPerformanceData} from '../dist/site-table.mjs';
import {createDashboardExport,selectExportItems,exportChartRows} from '../dist/pdf-report.mjs';

const meta={min_date:'2023-01-01',max_date:'2026-10-24'};
const state={view:'overview',reportView:'overview',period:'2026-10',year:2026,week:43,scope:'all',region:'all',vendor:'all'};
const selection=(id,from,to)=>({...state,view:id,reportView:id,reviewRanges:{[id]:{from,to}}});
const row=(id,date,extra={})=>({id,ticket_number:id,created_date:date,site_id:'COW001',region:'Central',root_cause:'Generator',parent_tt:null,repair_details:'Fault repaired',service_impact:'Outage',duration_minutes:60,exceeded_time:'NOT EXCEED',...extra});
const bounds=periods=>periods.map(p=>[p.start,p.end]);

test('review dates validate real calendar dates and reject reversed or incomplete ranges',()=>{
 assert.equal(validReviewDates('2024-02-29','2026-10-24'),true);
 for(const dates of [['2026-02-29','2026-03-01'],['2026-04-31','2026-05-01'],['2026-10-25','2026-10-24'],['','2026-10-24'],['2026-2-01','2026-02-28']])assert.equal(validReviewDates(...dates),false);
 assert.throws(()=>reportPeriods('overview',selection('overview','2026-10-20','2026-10-01'),meta),/valid From/);
 assert.equal(shiftReviewDate('2024-02-29',-12),'2023-02-28');
});
test('monthly windows compare matching month blocks, including month ends and year boundaries',()=>{
 assert.deepEqual(bounds(reportPeriods('overview',selection('overview','2026-08-01','2026-10-31'),meta)),[['2026-08-01','2026-10-31'],['2026-05-01','2026-07-31'],['2026-02-01','2026-04-30']]);
 assert.deepEqual(bounds(reportPeriods('overview',selection('overview','2025-12-01','2026-02-28'),meta)),[['2025-12-01','2026-02-28'],['2025-09-01','2025-11-30'],['2025-06-01','2025-08-31']]);
 assert.deepEqual(bounds(reportPeriods('overview',selection('overview','2026-10-10','2026-10-24'),meta)),[['2026-10-10','2026-10-24'],['2026-09-10','2026-09-24'],['2026-08-10','2026-08-24']]);
});
test('yearly and MoM Y windows shift both boundaries by calendar year and keep explicit cutoffs',()=>{
 assert.deepEqual(bounds(reportPeriods('yoy',selection('yoy','2025-05-15','2026-02-10'),meta)),[['2025-05-15','2026-02-10'],['2024-05-15','2025-02-10'],['2023-05-15','2024-02-10']]);
 assert.deepEqual(bounds(reportPeriods('mom-y',selection('mom-y','2024-02-29','2024-03-02'),meta)),[['2024-02-29','2024-03-02'],['2023-02-28','2023-03-02'],['2022-02-28','2022-03-02']]);
 const report=buildReport([row('x','2026-10-24')],selection('mom-y','2026-10-01','2026-10-31'),{},meta,'mom-y');assert.equal(report.now.range.end,'2026-10-31');assert.equal(report.now.partial,true);assert.equal(report.prev.range.end,'2025-10-31');
});
test('every selected day is counted once across cards, trends, comparison charts and COW table',()=>{
 const records=[row('before','2026-08-31'),row('from','2026-09-01'),row('middle','2026-10-01',{exceeded_time:'0.02'}),row('to','2026-10-24'),row('after','2026-10-25'),row('child','2026-10-01',{parent_tt:'PR1'}),row('fix','2026-10-01',{repair_details:'Resolution fixation'}),row('nsa','2026-10-01',{service_impact:'No impact'}),row('prior','2026-07-01')],before=JSON.stringify(records);
 const chosen=selection('overview','2026-09-01','2026-10-24'),report=buildReport(records,chosen,{},meta,'overview');
 assert.deepEqual(report.now.rows.map(r=>r.id),['from','middle','to']);assert.equal(report.now.summary.tickets,3);assert.ok(Math.abs(report.now.summary.slaCompliance-200/3)<1e-10);
 assert.equal(dashboardCards(report,chosen,meta)[0].value,'3');assert.equal(cowPerformanceData(report).rows[0].tickets,3);assert.equal(cowPerformanceData(report).rows[0].breachOutcome,'Yes');
 assert.equal(areaData(report,chosen,meta).series[0].values.reduce((a,b)=>a+b,0),3);assert.deepEqual(areaData(report,chosen,meta).labels,['Sept 2026','Oct 2026']);
 assert.equal(comparisonData(report,'root_cause').series[0].values.reduce((a,b)=>a+b,0),3);assert.equal(JSON.stringify(records),before);
});
test('custom yearly monthly charts retain the full selected window across calendar years',()=>{
 const records=[row('a','2025-05-15'),row('b','2026-02-10'),row('before','2025-05-14'),row('after','2026-02-11'),row('p1','2024-05-15'),row('p2','2025-02-10'),row('o1','2023-05-15'),row('o2','2024-02-10')],chosen=selection('yoy','2025-05-15','2026-02-10'),report=buildReport(records,chosen,{},meta,'yoy');
 const tickets=yearMonthData(report,chosen,meta,'tickets'),hours=yearMonthData(report,chosen,meta,'hours');
 assert.equal(tickets.labels.length,10);assert.equal(tickets.labels[0],'May 2025');assert.equal(tickets.labels.at(-1),'Feb 2026');
 for(let i=0;i<3;i++){assert.equal(tickets.series[i].values.reduce((a,b)=>a+b,0),report.series[i].summary.tickets);assert.equal(hours.series[i].values.reduce((a,b)=>a+b,0),report.series[i].summary.durationMinutes/60);}
 assert.equal(areaData(report,chosen,meta).series[0].values.reduce((a,b)=>a+b,0),2);
});
test('weekly selections and All weeks retain their original periods and analysis rules',()=>{
 const records=[row('x','2026-10-24')];
 for(const id of ['weekly-sa','weekly-nsa','wow-y'])for(const week of [43,'all']){
  const original={...state,view:id,reportView:id,week},custom={...original,reviewRanges:{[id]:{from:'2025-01-01',to:'2025-12-31'},overview:{from:'2026-09-01',to:'2026-10-24'}}};
  assert.deepEqual(buildReport(records,custom,{},meta,id),buildReport(records,original,{},meta,id));
 }
});
test('PDF manifests and COW table exports use the exact selected dates and matching data',()=>{
 const records=[row('a','2026-09-01'),row('b','2026-10-24'),row('outside','2026-08-31')],chosen=selection('overview','2026-09-01','2026-10-24'),before=JSON.stringify(chosen),manifest=createDashboardExport({records,state:chosen,meta});
 assert.equal(manifest.report.now.summary.tickets,2);assert.match(manifest.period,/01 Sept – 24 Oct 2026/);assert.equal(manifest.report.now.range.start,'2026-09-01');assert.equal(manifest.report.now.range.end,'2026-10-24');
 const table=createDashboardExport({records,state:{...chosen,view:'sites'},meta}),item=table.items.find(i=>i.chart?.kind==='table'),parts=exportChartRows(selectExportItems(table,[item.id])).flatMap(r=>r.charts);
 assert.equal(parts[0].data.rows[0].tickets,2);assert.match(parts[0].svg,/1 Sept 2026/);assert.match(parts[0].svg,/24 Oct 2026/);assert.equal(JSON.stringify(chosen),before);
});
