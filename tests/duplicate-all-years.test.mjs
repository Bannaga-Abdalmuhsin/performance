import test from 'node:test';import assert from 'node:assert/strict';
import {hasDuplicateRepair,analysisRecords,isAnalysisRecord,normalizeRecords,summarize} from '../dist/core.mjs';
import {REPORTS,buildReport,latestReportDate,weekNumber} from '../dist/analysis.mjs';
import {areaData,dashboardSections,yearMonthData,slaPerformanceData,renderChartBoard} from '../dist/charts.mjs';
import {createDashboardExport,selectExportItems,exportChartRows} from '../dist/pdf-report.mjs';
import {cowPerformanceData} from '../dist/site-table.mjs';

const state={view:'weekly-sa',reportView:'weekly-sa',year:2026,week:43,period:'2026-10',allYears:true,scope:'all'},meta={min_date:'2024-01-01',max_date:'2026-10-24'};
const row=(id,date='2026-10-18',extra={})=>({id,ticket_number:id,created_date:date,site_id:'COW001',region:'Central',vendor:'Nokia',root_cause:'Generator',service_impact:'Outage',duration_minutes:60,exceeded_time:'NOT EXCEED',repair_details:null,parent_tt:null,...extra});
const records=[row('2024','2024-10-20'),row('2025','2025-10-19',{exceeded_time:'0.02'}),row('2026'),row('previous','2026-10-11'),row('outside','2026-03-01'),row('dup','2026-10-18',{repair_details:'Duplicate TT PR000123'}),row('child','2026-10-18',{parent_tt:'PR1'}),row('resolution','2026-10-18',{repair_details:'Resolution fixation'})];

test('duplicate RepairDetails exclusion is case-insensitive and confined to that field',()=>{
 for(const value of ['Duplicate TT','duPLicate ticket PR0001','TT duplicated','Duplicates removed'])assert.equal(hasDuplicateRepair({RepairDetails:value}),true);
 for(const repair_details of [null,undefined,'','Generator repaired','Duplicating alarm pending'])assert.equal(hasDuplicateRepair({repair_details}),false);
 assert.equal(isAnalysisRecord(row('real',undefined,{root_cause:'Duplicate TT',source_data:{Note:'Duplicate TT'}})),true);
 const input=[{'Ticket Number':'PR1','Create Date':'18/10/2026',RepairDetails:'Duplicate TT'},{'Ticket Number':'PR2','Create Date':'18/10/2026',RepairDetails:'Fault repaired'}],before=structuredClone(input),normalized=normalizeRecords(input);
 assert.equal(normalized.records.length,2);assert.equal(normalized.records[0].source_data.RepairDetails,'Duplicate TT');assert.deepEqual(analysisRecords(normalized.records).map(r=>r.ticket_number),['PR2']);assert.deepEqual(input,before);
});
test('duplicate rows cannot affect any of the six reports, charts, PDF exports or latest dates',()=>{
 const source=[...records,row('late-dup','2026-12-31',{repair_details:'DUPLICATE TT',region:'Duplicate only'})],clean=source.filter(r=>!String(r.repair_details||'').toLowerCase().includes('duplicate')),before=structuredClone(source),sourceMeta={...meta,max_date:'2026-12-31'};
 for(const id of Object.keys(REPORTS)){
  const selection={...state,view:id,reportView:id,allYears:false},actual=buildReport(source,selection,{},sourceMeta,id),expected=buildReport(clean,selection,{},sourceMeta,id);
  assert.deepEqual(actual.series,expected.series,id);assert.deepEqual(actual.scope,expected.scope,id);assert.deepEqual(dashboardSections(actual,selection,sourceMeta),dashboardSections(expected,selection,sourceMeta),id);assert.deepEqual(createDashboardExport({records:source,state:selection,meta:sourceMeta}).cards,createDashboardExport({records:clean,state:selection,meta:sourceMeta}).cards,id);
 }
 assert.equal(latestReportDate(source,{},sourceMeta,'weekly-sa'),'2026-10-18');assert.deepEqual(source,before);
});
test('All years retains the selected week in each year and compares the preceding weeks',()=>{
 const report=buildReport(records,state,{},meta,'weekly-sa');assert.deepEqual(report.now.rows.map(r=>r.id),['2024','2025','2026']);assert.deepEqual(report.prev.rows.map(r=>r.id),['previous']);assert.equal(report.now.summary.tickets,3);assert.equal(report.now.summary.slaWithin,2);assert.equal(report.now.summary.breached,1);assert.match(report.now.range.label,/W43 · All years/);
 assert.equal(areaData(report,state,meta).series[0].values.reduce((a,b)=>a+(b||0),0),3);assert.equal(areaData(report,state,meta).labels.length,7);assert.equal(cowPerformanceData(report).rows[0].tickets,3);assert.match(cowPerformanceData(report).title,/All years \(2024–2026\)/);
 for(const series of report.series)for(const r of series.rows)assert.equal(weekNumber(r.created_date),series===report.now?43:series===report.prev?42:41);
});
test('All years and All weeks include the entire eligible history without inventing a baseline',()=>{
 for(const id of ['weekly-sa','weekly-nsa','wow-y']){
  const source=id==='weekly-nsa'?records.map(r=>({...r,service_impact:'No impact'})):records,chosen={...state,view:id,reportView:id,week:'all'},report=buildReport(source,chosen,{},meta,id);
  assert.equal(report.now.summary.tickets,5,id);assert.equal(report.prev.summary,null);assert.equal(report.definition.comparisonUnavailable,true);assert.equal(report.now.range.start,'2024-01-01');assert.equal(report.now.range.end,'2026-10-18');assert.equal(slaPerformanceData(report).labels.length,1);
  assert.ok(!/NaN|undefined|Infinity/.test(renderChartBoard(report,chosen,meta)),id);assert.equal(cowPerformanceData(report).rows[0].tickets,5);assert.equal(dashboardSections(report,chosen,meta).some(s=>s.id==='regions'),false);
  if(id!=='wow-y')assert.equal(areaData(report,chosen,meta).series[0].values.reduce((a,b)=>a+(b||0),0),5);
 }
});
test('WoW Y All years aggregates the selected week and leaves year-over-year change unavailable',()=>{
 const report=buildReport(records,{...state,view:'wow-y'},{},meta,'wow-y');assert.equal(report.now.summary.tickets,3);assert.equal(report.prev.summary,null);assert.equal(report.ticketChange,null);assert.equal(report.definition.comparisonUnavailable,true);
});
test('single-source-year All selection and switching back to a particular year remain valid',()=>{
 const one=buildReport([row('one')],{...state,week:'all'},{},{min_date:'2026-01-01',max_date:'2026-10-24'},'weekly-sa');assert.deepEqual(yearMonthData(one,state,meta).series.map(s=>s.name),['2026']);assert.ok(!/NaN|undefined|Infinity/.test(renderChartBoard(one,state,meta)));
 const report=buildReport(records,{...state,allYears:false},{},meta,'weekly-sa');assert.deepEqual(report.now.rows.map(r=>r.id),['2026']);
});
test('All years PDFs retain the exact week scope, SLA outcomes, full categories and COW table',()=>{
 const manifest=createDashboardExport({records,state,meta});assert.equal(manifest.report.now.summary.tickets,3);assert.match(manifest.period,/All years/);const table=createDashboardExport({records,state:{...state,view:'sites'},meta}),item=table.items.find(i=>i.chart?.kind==='table');assert.equal(item.chart.data.rows[0].tickets,3);assert.match(exportChartRows(selectExportItems(table,[item.id]))[0].charts[0].svg,/All years/);assert.equal(summarize(records).tickets,5);
});
