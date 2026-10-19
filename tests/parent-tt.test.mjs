import test from 'node:test';
import assert from 'node:assert/strict';
import {hasParentTicket,analysisRecords,scopeFilter,summarize,groupBy,monthlyTrend,normalizeRecords,exportCSV} from '../dist/core.mjs';
import {REPORTS,buildReport,comparisonGroups,latestReportDate,reportTrend} from '../dist/analysis.mjs';
import {yearMonthData,areaData,funnelData,dashboardCards,dashboardSections} from '../dist/charts.mjs';
import {createDashboardExport} from '../dist/pdf-report.mjs';

const row=(id,created_date='2026-08-31',extra={})=>({id,ticket_number:id,created_date,service_impact:'Outage',parent_tt:null,root_cause:'Generator Issue',site_id:'COW1',region:'Central',district:'Riyadh',vendor:'Nokia',severity:'High',duration_minutes:60,quality_flags:[],...extra});
const state={view:'overview',period:'2026-08',year:2026,week:36,scope:'all'},meta={min_date:'2024-01-01',max_date:'2026-08-31'};

test('every populated Parent TT value is excluded, regardless of format or selected scope',()=>{
 const values=[null,undefined,'',' \t\n ','PR0001','xref','OUTAGE','Power','0',0,false];
 const records=values.map((parent_tt,i)=>row('PR'+i,undefined,{parent_tt}));
 assert.deepEqual(records.map(hasParentTicket),[false,false,false,false,true,true,true,true,true,true,true]);
 for(const scope of ['all','powerbi'])assert.deepEqual(scopeFilter(records,{scope}).map(r=>r.id),['PR0','PR1','PR2','PR3']);
 assert.equal(hasParentTicket({'Parent TT':'PR0001'}),true);
 // A referenced parent remains eligible when its own Parent TT cell is blank.
 assert.deepEqual(analysisRecords([row('PR0001'),row('PR0002',undefined,{parent_tt:'PR0001'})]).map(r=>r.id),['PR0001']);
});

test('excluded rows affect no summary, repeated-site threshold, group or trend and remain in storage input',()=>{
 const records=[row('PR1'),row('PR2'),row('PR3',undefined,{parent_tt:'PR1',duration_minutes:9000}),...['PR4','PR5','PR6'].map(id=>row(id,undefined,{site_id:'COW2',duration_minutes:120})),row('PR7',undefined,{parent_tt:'xref',site_id:'CHILD ONLY',region:'Excluded only'})],before=structuredClone(records);
 const summary=summarize(records);
 assert.equal(summary.tickets,5);assert.equal(summary.durationMinutes,480);assert.equal(summary.durationCount,5);assert.equal(summary.mttr,96);assert.equal(summary.sites,2);assert.equal(summary.repeatSites,1);assert.equal(summary.repeatRate,50);
 const groups=groupBy(records,'region');assert.deepEqual(groups.map(g=>g.name),['Central']);assert.equal(groups[0].rows.length,5);assert.equal(groups[0].durationMinutes,480);
 const trend=monthlyTrend(records,'2026-08',meta,1);assert.equal(trend[0].tickets,5);assert.equal(trend[0].durationMinutes,480);
 assert.deepEqual(records,before);
});

test('source-header imports preserve Parent TT and source rows while analysis automatically excludes them',()=>{
 const input=[{'Ticket Number':'PR1','Create Date':'31/08/2026','Parent TT':'PR0000'},{'Ticket Number':'PR2','Create Date':'31/08/2026','Parent TT':'   '},{'Ticket Number':'PR3','Create Date':'31/08/2026','Parent TT':'xref'}],before=structuredClone(input),result=normalizeRecords(input);
 assert.equal(result.records.length,3);assert.equal(result.rejected.length,0);assert.equal(result.duplicates,0);assert.equal(result.records[0].parent_tt,'PR0000');assert.equal(result.records[0].source_data['Parent TT'],'PR0000');
 assert.deepEqual(analysisRecords(result.records).map(r=>r.ticket_number),['PR2']);assert.ok(exportCSV(result.records).includes('PR0000'));assert.deepEqual(input,before);
});

test('all six report scopes, comparisons, chart series and PDF manifests exclude parent-linked tickets',()=>{
 const records=[];
 for(const date of ['2026-08-31','2026-08-24','2026-07-31','2025-08-31','2024-08-31'])for(const impact of ['Outage','No impact']){
  records.push(row('kept-'+date+impact,date,{service_impact:impact}));
  records.push(row('excluded-'+date+impact,date,{service_impact:impact,parent_tt:'xref',duration_minutes:600000,region:'Child only region',district:'Child only district',site_id:'Child only site',root_cause:'Rectifier'}));
 }
 const eligible=records.filter(r=>!String(r.parent_tt??'').trim()),before=structuredClone(records);
 for(const id of Object.keys(REPORTS)){
  const selection={...state,view:id},report=buildReport(records,selection,{},meta,id),baseline=buildReport(eligible,selection,{},meta,id);
  assert.deepEqual(report.scope,baseline.scope,id);assert.deepEqual(report.series,baseline.series,id);
  for(const field of ['region','district','site_id','root_cause','duration_bucket'])assert.deepEqual(comparisonGroups(report,field),comparisonGroups(baseline,field),id+' '+field);
  assert.deepEqual(yearMonthData(report,selection,meta),yearMonthData(baseline,selection,meta));assert.deepEqual(areaData(report,selection,meta),areaData(baseline,selection,meta));assert.deepEqual(funnelData(report),funnelData(baseline));
  const exported=createDashboardExport({records,state:selection,meta});assert.deepEqual(exported.cards,dashboardCards(baseline,selection,meta));assert.deepEqual(exported.sections,dashboardSections(baseline,selection,meta));
  assert.ok(!JSON.stringify(exported.sections).includes('Child only'),id);
 }
 const search=createDashboardExport({records,state:{...state,view:'tickets',reportView:'overview',query:'excluded-'},meta});assert.equal(search.report.now.summary.tickets,0);assert.equal(search.report.scope.length,0);
 assert.deepEqual(records,before);
});

test('parent-only later dates cannot move latest periods or extend matching comparison cutoffs',()=>{
 const records=[row('sa','2026-08-15'),row('nsa','2026-08-14',{service_impact:'No impact'}),row('prior','2025-08-15'),row('prior-late','2025-08-16'),row('child-sa','2026-09-30',{parent_tt:'PR1'}),row('child-nsa','2026-10-01',{parent_tt:'xref',service_impact:'No impact'})],sourceMeta={...meta,max_date:'2026-10-01'};
 assert.equal(latestReportDate(records,{},sourceMeta,'weekly-sa'),'2026-08-15');assert.equal(latestReportDate(records,{},sourceMeta,'weekly-nsa'),'2026-08-14');
 for(const id of ['mom-y','yoy']){
  const report=buildReport(records,state,{},sourceMeta,id);assert.equal(report.sourceCoverage.max_date,'2026-08-15');assert.equal(report.series[1].range.end,'2025-08-15');assert.equal(report.prev.summary.tickets,1);
  assert.equal(yearMonthData(report,state,sourceMeta).series[0].values[8],null);assert.equal(areaData(report,state,sourceMeta).series[0].values[8],null);
  assert.equal(reportTrend(report,{...state,period:'2026-09'},sourceMeta).at(-1).summary,null);
 }
});

test('a source containing only parent-linked tickets has no eligible metrics or coverage',()=>{
 const records=[row('child',undefined,{parent_tt:'PR1'})];
 for(const id of Object.keys(REPORTS)){
  const report=buildReport(records,{...state,view:id},{},meta,id);assert.equal(report.scope.length,0);assert.equal(report.now.summary,null);assert.equal(latestReportDate(records,{},meta,id),null);
  assert.ok(yearMonthData(report,state,meta).series.every(s=>s.values.every(v=>v===null)));assert.ok(areaData(report,state,meta).series[0].values.every(v=>v===null));
  assert.equal(createDashboardExport({records,state:{...state,view:id},meta}).cards[0].value,'—');
 }
});
