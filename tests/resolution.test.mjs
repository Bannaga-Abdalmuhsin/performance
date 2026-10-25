import test from 'node:test';
import assert from 'node:assert/strict';
import {hasResolutionRepair,isAnalysisRecord,analysisRecords,scopeFilter,summarize,groupBy,monthlyTrend,normalizeRecords,exportCSV} from '../dist/core.mjs';
import {REPORTS,buildReport,latestReportDate} from '../dist/analysis.mjs';
import {dashboardCards,dashboardSections,yearMonthData} from '../dist/charts.mjs';
import {createDashboardExport} from '../dist/pdf-report.mjs';

const row=(id,date='2026-08-31',extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',parent_tt:null,repair_details:null,root_cause:'Generator',site_id:'COW1',region:'Central',district:'Riyadh',vendor:'Nokia',severity:'High',duration_minutes:60,quality_flags:[],...extra});
const state={view:'overview',period:'2026-08',year:2026,week:36,scope:'all'},meta={min_date:'2024-01-01',max_date:'2026-08-31'};

test('RepairDetails contains matching is case-insensitive and limited to the specified column',()=>{
 const values=[null,undefined,'','   ','Replaced fuel pump','Resolved by replacing cable','Resolution','resolution fixation','RESOLUTION: completed','No Resolution recorded','Multiple resolutions'],records=values.map((repair_details,i)=>row('PR'+i,undefined,{repair_details}));
 assert.deepEqual(records.map(hasResolutionRepair),[false,false,false,false,false,false,true,true,true,true,true]);
 assert.equal(hasResolutionRepair({RepairDetails:'ReSoLuTiOn completed'}),true);
 assert.equal(isAnalysisRecord(row('real',undefined,{root_cause:'Resolution',source_data:{'Trouble Description':'Resolution'}})),true);
 for(const scope of ['all','powerbi'])assert.deepEqual(scopeFilter(records,{scope}).map(r=>r.id),records.slice(0,6).map(r=>r.id));
 assert.equal(isAnalysisRecord(row('both',undefined,{parent_tt:'PR1',repair_details:'Resolution'})),false);
});

test('resolution rows affect no totals, MTTR, recurrence, groups or trends',()=>{
 const records=[row('PR1'),row('PR2'),row('PR3',undefined,{repair_details:'Resolution completed',duration_minutes:999999}),...['PR4','PR5','PR6'].map(id=>row(id,undefined,{site_id:'COW2',duration_minutes:120})),row('PR7',undefined,{repair_details:'RESOLUTION',site_id:'Fixation only',region:'Fixation only'})],before=structuredClone(records),s=summarize(records);
 assert.equal(s.tickets,5);assert.equal(s.durationMinutes,480);assert.equal(s.mttr,96);assert.equal(s.sites,2);assert.equal(s.repeatSites,1);assert.equal(s.repeatRate,50);
 assert.deepEqual(groupBy(records,'region').map(g=>g.name),['Central']);assert.equal(groupBy(records,'region')[0].rows.length,5);assert.equal(monthlyTrend(records,'2026-08',meta,1)[0].tickets,5);assert.deepEqual(records,before);
});

test('imports retain resolution records and original text; analysis excludes them automatically',()=>{
 const input=[{'Ticket Number':'PR1','Create Date':'31/08/2026',RepairDetails:'Resolution fixation'},{'Ticket Number':'PR2','Create Date':'31/08/2026',RepairDetails:'Fuel pump replaced'},{'Ticket Number':'PR3','Create Date':'31/08/2026','Parent TT':'PR2'}],before=structuredClone(input),result=normalizeRecords(input);
 assert.equal(result.records.length,3);assert.equal(result.rejected.length,0);assert.equal(result.records[0].repair_details,'Resolution fixation');assert.equal(result.records[0].source_data.RepairDetails,'Resolution fixation');assert.deepEqual(analysisRecords(result.records).map(r=>r.ticket_number),['PR2']);assert.ok(exportCSV(result.records).includes('Resolution fixation'));assert.deepEqual(input,before);
});

test('all six reports, comparison periods, charts and PDF manifests share the resolution exclusion',()=>{
 const records=[];
 for(const date of ['2026-08-31','2026-08-24','2026-07-31','2025-08-31','2024-08-31'])for(const service_impact of ['Outage','No impact']){
  records.push(row('real-'+date+service_impact,date,{service_impact}));
  records.push(row('fix-'+date+service_impact,date,{service_impact,repair_details:'Resolution fixation',duration_minutes:600000,region:'Fixation only',site_id:'Fixation only',district:'Fixation only'}));
 }
 const eligible=records.filter(r=>!String(r.parent_tt??'').trim()&&!String(r.repair_details??'').toLowerCase().includes('resolution')),before=structuredClone(records);
 for(const id of Object.keys(REPORTS)){
  const selection={...state,view:id},actual=buildReport(records,selection,{},meta,id),baseline=buildReport(eligible,selection,{},meta,id),pdf=createDashboardExport({records,state:selection,meta});
  assert.deepEqual(actual.scope,baseline.scope,id);assert.deepEqual(actual.series,baseline.series,id);assert.deepEqual(pdf.cards,dashboardCards(baseline,selection,meta),id);assert.deepEqual(pdf.sections,dashboardSections(baseline,selection,meta),id);assert.ok(!JSON.stringify(pdf.sections).includes('Fixation only'),id);
  const fullYear=buildReport(records,{...selection,week:'all'},{},meta,id);assert.ok(fullYear.scope.every(r=>!r.id.startsWith('fix-')));
 }
 const searched=createDashboardExport({records,state:{...state,view:'tickets',reportView:'overview',query:'fix-'},meta});assert.equal(searched.report.scope.length,0);assert.equal(searched.report.now.summary.tickets,0);assert.deepEqual(records,before);
});

test('fixation-only later dates cannot move default periods or extend comparison coverage',()=>{
 const records=[row('real','2026-08-15'),row('nsa','2026-08-14',{service_impact:'No impact'}),row('prior','2025-08-15'),row('prior-late','2025-08-16'),row('fix-sa','2026-09-30',{repair_details:'Resolution'}),row('fix-nsa','2026-10-01',{repair_details:'resolution',service_impact:'No impact'})],sourceMeta={...meta,max_date:'2026-10-01'};
 assert.equal(latestReportDate(records,{},sourceMeta,'weekly-sa'),'2026-08-15');assert.equal(latestReportDate(records,{},sourceMeta,'weekly-nsa'),'2026-08-14');
 for(const id of ['mom-y','yoy']){const report=buildReport(records,state,{},sourceMeta,id);assert.equal(report.sourceCoverage.max_date,'2026-08-15');assert.equal(report.prev.range.end,'2025-08-15');assert.equal(report.prev.summary.tickets,1);assert.equal(yearMonthData(report,state,sourceMeta).series[0].values[8],null);}
});

test('a fixation-only source has no eligible metrics while its records remain intact',()=>{
 const records=[row('fix',undefined,{repair_details:'Resolution'})],before=structuredClone(records);
 for(const id of Object.keys(REPORTS)){const report=buildReport(records,{...state,view:id},{},meta,id);assert.equal(report.scope.length,0);assert.equal(report.now.summary,null);assert.equal(latestReportDate(records,{},meta,id),null);assert.equal(createDashboardExport({records,state:{...state,view:id},meta}).cards[0].value,'—');}
 assert.deepEqual(records,before);
});
