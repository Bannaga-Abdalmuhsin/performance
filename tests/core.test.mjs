import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeFilter,summarize,percentageChange,previousMonth,monthlyTrend,normalizeRecords,parseCSV,exportCSV,groupBy} from '../dist/core.mjs';
const r=(n,extra={})=>({id:'TT'+n+'|COW001',ticket_number:'TT'+n,site_id:'COW001',created_date:'2026-08-15',created_at:'2026-08-15T12:00:00+03:00',region:'Central',root_cause:'Generator Issue',service_impact:'Outage',duration_minutes:60,sla_breached:false,sla_excluded:false,parent_tt:null,quality_flags:[],...extra});
test('monthly profile applies parent and root-cause exclusions with explicit impact selection',()=>{
 const rows=[r(1),r(2,{parent_tt:'TT1'}),r(3,{root_cause:'  TELECOM '}),r(4,{service_impact:'No impact'})];
 assert.deepEqual(scopeFilter(rows,{scope:'powerbi',service_impact:'Outage'},{excluded_root_causes:['Telecom']}).map(x=>x.id),[rows[0].id]);
 assert.equal(scopeFilter(rows,{scope:'all',service_impact:'all'}).length,4);
 assert.equal(scopeFilter(rows,{scope:'all',site_id:'COW999'}).length,0);
});
test('distinct ticket volume, recorded-duration denominator, exemptions, missing values and zero are preserved',()=>{
 const rows=[r(1,{duration_minutes:0}),r(2,{duration_minutes:120,sla_breached:true}),r(3,{duration_minutes:null,sla_breached:null}),r(4,{duration_minutes:60,sla_excluded:true,sla_breached:true})];
 const s=summarize(rows);assert.equal(s.tickets,4);assert.equal(s.durationMinutes,180);assert.equal(s.durationCount,3);assert.equal(s.mttr,60);assert.equal(s.slaEligible,2);assert.equal(s.breached,1);assert.equal(s.slaCompliance,50);assert.equal(s.slaExcluded,1);assert.equal(s.repeatSites,1);
 const no=summarize([r(5,{duration_minutes:null,sla_breached:null})]);assert.equal(no.durationMinutes,null);assert.equal(no.mttr,null);assert.equal(no.slaCompliance,null);
 assert.equal(summarize([r(1),r(1,{site_id:'COW002'})]).tickets,1);
});
test('service-impact intervals reject missing and reversed dates and preserve real zero',()=>{
 const a=r(1,{impact_start:'2026-08-01T12:00:00+03:00',impact_finish:'2026-08-01T13:00:00+03:00'});
 assert.equal(summarize([a,r(2,{impact_start:a.impact_finish,impact_finish:a.impact_start}),r(3)]).impactMinutes,60);
 assert.equal(summarize([r(1,{impact_start:a.impact_start,impact_finish:a.impact_start})]).impactMinutes,0);
});
test('calendar boundaries, previous year, no denominator and uncovered months are explicit',()=>{
 assert.equal(previousMonth('2026-01'),'2025-12');assert.equal(previousMonth('2026-08',-12),'2025-08');assert.equal(percentageChange(5,0),null);assert.equal(percentageChange(0,5),-100);
 const trend=monthlyTrend([r(1)],'2026-08',{min_date:'2026-07-01',max_date:'2026-08-31'},3);
 assert.equal(trend[0].tickets,null);assert.equal(trend[1].tickets,0);assert.equal(trend[2].tickets,1);
});
test('CSV parses multiline fields and escaped quotes, while export neutralizes spreadsheet formulas',()=>{
 const csv='Ticket Number,Create Date,RepairDetails\r\nTT1,31/08/2026 23:30:00,"replaced, tested\nthen ""closed"""\r\n';
 const rows=parseCSV(csv);assert.equal(rows[0].RepairDetails,'replaced, tested\nthen "closed"');assert.equal(normalizeRecords(rows).records[0].created_date,'2026-08-31');
 assert.ok(exportCSV([{repair_details:'=HYPERLINK("example")'}],['repair_details']).includes("'=HYPERLINK"));
 assert.throws(()=>parseCSV('a,a\n1,2'),/duplicate/);assert.throws(()=>parseCSV('a,b\n"x,y'),/unclosed/);
});
test('imports normalize region and source columns, deduplicate complete snapshots, and reject undated rows',()=>{
 const rows=[{'Ticket Number':'PR1',SiteID:'COW001','Create Date':'01/08/2026',Region:'CENTRAL','RestorationTime HHMMSS':0,'Exceed SLA':'No'},
 {'Ticket Number':'PR1',SiteID:'COW001','Create Date':'01/08/2026',Region:'Central','RestorationTime HHMMSS':0,'Exceed SLA':'No',RepairDetails:'Complete record'},
 {'Ticket Number':'PR2',SiteID:'COW002','Create Date':'bad'},
 {'ticket_number':'PR3','site_id':'COW003','created_date':'2026-08-31','duration_minutes':-1}];
 const result=normalizeRecords(rows);assert.equal(result.records.length,2);assert.equal(result.duplicates,1);assert.equal(result.rejected.length,1);assert.equal(result.records[0].region,'Central');assert.equal(result.records[0].id,'PR1|COW001');assert.equal(result.records[0].duration_minutes,0);assert.equal(result.records[0].repair_details,'Complete record');assert.equal(result.records[1].duration_minutes,null);assert.ok(result.records[1].quality_flags.length);
});
test('site and regional groups reconcile additive record-based measures',()=>{
 const rows=[r(1),r(2,{region:'East',site_id:'COW002',duration_minutes:90})],groups=groupBy(rows,'region');assert.equal(groups.reduce((s,g)=>s+g.durationMinutes,0),summarize(rows).durationMinutes);assert.equal(groups.reduce((s,g)=>s+g.tickets,0),2);
});
