import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT_CAUSE_GROUPS,rootCauseGroup,scopeFilter,groupBy,summarize,matchesTicketQuery} from '../dist/core.mjs';
import {REPORTS,buildReport,comparisonGroups} from '../dist/analysis.mjs';
import {createDashboardExport,exportChartRows,selectExportItems} from '../dist/pdf-report.mjs';

const row=(id,cause,date='2026-08-31',extra={})=>({id,ticket_number:id,site_id:'COW1',created_date:date,service_impact:'Outage',root_cause:cause,duration_minutes:60,quality_flags:[],...extra});
test('taxonomy uses exactly the fourteen requested labels and is stable for existing categories',()=>{
 assert.deepEqual(ROOT_CAUSE_GROUPS,['Generator','Rectifier','SCECO','Others','Alarm Cable Issue','ATS Issue','Air Condition Fault','3rd Party Fault','Circuit Breaker','PMR','LINK','Telecom Cables','MDB Issue','Self Cleared']);
 assert.deepEqual(ROOT_CAUSE_GROUPS.map(rootCauseGroup),ROOT_CAUSE_GROUPS);
});
test('source variants, punctuation and equipment details consolidate into the correct families',()=>{
 const cases={
  Generator:['Generator Issue','Geneator issue','Gen #2 Engine - Fuel Pump Defective','Gen-1\u00a0 Fan belt damaged','G3 - Starter / Starting Batteries Defective','Empty Fuel Tank','Fuel Transfer Pump - Defective'],
  Rectifier:['Rectifier Issue','One ore more Rectifier is defective','Power - Rectifier'],
  SCECO:['SCECO - Commercial Power','SEC/Commercial Power Cut','SCECO Failure - Single'],
  'Alarm Cable Issue':['Fire Alarm - Alarm Cable Faulty','Fire System - Alarm Cable Fault'],
  'ATS Issue':['SCECO - ATS','Generator - ATS - Contactor Defective','ATS1 - Mechanical Problem'],
  'Air Condition Fault':['HVAC panel hanged','A/C #1 - Condenser Fan - Motor Fail','AC1- Capacitor fault','Compressor failure','Control Panel / thermostat / controller / relays'],
  '3rd Party Fault':['3rd Party Fault-Telecom','Third party fault'],
  'Circuit Breaker':['SCECO - Breaker','REC-Breaker Issue','Rectifier A.C circuit Breaker tripped','GENSET-Breaker Issue','MDB1 -Branch CB Tripped','ATS Breaker','MCB Trip / Switched Off / Defective','MW Breaker - Telecom'],
  PMR:['PMR related','Power - PMR'],
  LINK:['Link Issue - Telecom','MW-LOS issue','SFP Fault-Telecom','Link/Interface Down','Re-Alignment','Transmission congestion','Modem Fault-Telececom'],
  'Telecom Cables':['Telecom Cabes','Fiber Cable-telecom','CPRI Cables issue','RF Cable Connections-Telecom','IF Connector-Telecom','BBU Cable Connections-Telecom','Ethernet Cable'],
  'MDB Issue':['MDB1 -Problem','MDB1 - Incoming Or Outgoing Cables Over Heating Or Loose Connections'],
  'Self Cleared':['Self-Cleared','Self Cleared-Telecom','Auto-restored','Auto-restored-Telecom'],
  Others:[null,'','Unknown','Unrecognized future cause','Door Issue','Cables Issue','DC Power issue','Loose connection for A.C. or D.C. cable or connector','High Temperature','<script>alert(1)</script>']
 };
 for(const [expected,labels]of Object.entries(cases))for(const label of labels)assert.equal(rootCauseGroup(label),expected,String(label));
});
test('grouping and category filters preserve every ticket, restoration duration and original detail',()=>{
 const source=[row('a','Gen #2 Engine - Fuel Pump Defective'),row('b','Generator Issue',undefined,{duration_minutes:0}),row('c','Fuel Tank - Diesel Empty',undefined,{duration_minutes:null}),row('d','SCECO - Breaker'),row('e','unrecognized')],before=structuredClone(source),groups=groupBy(source,'root_cause');
 assert.equal(groups.length,3);assert.deepEqual(groups.map(g=>[g.name,g.tickets]),[['Generator',3],['Circuit Breaker',1],['Others',1]]);
 const total=summarize(source);assert.equal(groups.reduce((n,g)=>n+g.tickets,0),total.tickets);assert.equal(groups.reduce((n,g)=>n+g.durationMinutes,0),total.durationMinutes);assert.equal(groups.reduce((n,g)=>n+g.durationCount,0),total.durationCount);
 assert.deepEqual(scopeFilter(source,{root_cause:'Generator'}).map(r=>r.id),['a','b','c']);assert.deepEqual(scopeFilter(source,{root_cause:'Others'}).map(r=>r.id),['e']);assert.equal(scopeFilter(source,{root_cause:'not a category'}).length,0);assert.deepEqual(source,before);
 assert.ok(matchesTicketQuery(source[0],'Generator'));assert.ok(matchesTicketQuery(source[0],'Fuel Pump Defective'));assert.ok(matchesTicketQuery(source[4],'Others'));
});
test('all six analyses and PDF chart categories reconcile to the filtered period summaries',()=>{
 const sources=['Generator Issue','G1 - Engine Major Problem','Rectifier Issue','SCECO - Commercial Power','Door','Fire System - Alarm Cable Fault','ATS1 - Mechanical Problem','A/C #1 - Thermostat - Faulty','3rd Party Fault-Telecom','MDB1 -MCB Tripped','PMR related','MW-LOS issue','Fiber Cable','MDB1 -Problem','Auto-restored'];
 const records=['2026-08-31','2026-08-24','2026-07-31','2025-08-31','2024-08-31'].flatMap((date,j)=>sources.flatMap((cause,i)=>[row(`${j}-${i}-sa`,cause,date,{duration_minutes:i*30}),row(`${j}-${i}-nsa`,cause,date,{service_impact:'No impact',duration_minutes:i*30})]));
 const state={period:'2026-08',year:2026,week:36,scope:'all'},meta={min_date:'2024-01-01',max_date:'2026-08-31'};
 for(const id of Object.keys(REPORTS)){
  const report=buildReport(records,{...state,view:id},{},meta,id),groups=comparisonGroups(report,'root_cause');assert.equal(groups.length,14,id);
  assert.ok(groups.every(g=>ROOT_CAUSE_GROUPS.includes(g.name)));
  for(let p=0;p<report.series.length;p++){assert.equal(groups.reduce((n,g)=>n+(g.series[p]?.tickets||0),0),report.series[p].summary?.tickets||0,id);assert.equal(groups.reduce((n,g)=>n+(g.series[p]?.durationMinutes||0),0),report.series[p].summary?.durationMinutes||0,id);}
  const manifest=createDashboardExport({records,state:{...state,view:id},meta}),root=manifest.items.find(i=>i.id===id+'-root_cause'),parts=exportChartRows(selectExportItems(manifest,[root.id])).flatMap(r=>r.charts);
  assert.deepEqual(parts.flatMap(p=>p.data.labels),root.chart.data.labels);assert.equal(new Set(root.chart.data.labels).size,14);assert.ok(!root.chart.data.labels.includes('Generator Issue'));
  const filtered=buildReport(records,{...state,root_cause:'Generator'},{},meta,id);assert.equal(filtered.now.summary.tickets,report.now.rows.filter(r=>['Generator Issue','G1 - Engine Major Problem'].includes(r.root_cause)).length);assert.deepEqual(comparisonGroups(filtered,'root_cause').map(g=>g.name),['Generator']);
 }
});
