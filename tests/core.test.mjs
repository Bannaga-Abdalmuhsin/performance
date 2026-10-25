import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeFilter,summarize,percentageChange,previousMonth,monthlyTrend,normalizeRecords,parseCSV,exportCSV,groupBy,vendorGroup} from '../dist/core.mjs';
const r=(n,extra={})=>({id:'TT'+n+'|COW001',ticket_number:'TT'+n,site_id:'COW001',created_date:'2026-08-15',created_at:'2026-08-15T12:00:00+03:00',region:'Central',root_cause:'Generator Issue',service_impact:'Outage',duration_minutes:60,sla_breached:false,sla_excluded:false,parent_tt:null,quality_flags:[],...extra});
test('vendor groups cover every record and TETRA combines all remaining labels',()=>{
 const labels=['Nokia',' ERICSSON ','huawei','NSN','Specialized','Cisco','Uncategorized',null,'WORK MICROWAVE'],rows=labels.map((vendor,i)=>r(i,{vendor}));
 assert.deepEqual(labels.map(vendorGroup),['Nokia','Ericsson','Huawei','TETRA','TETRA','TETRA','TETRA','TETRA','TETRA']);
 assert.equal(scopeFilter(rows,{vendor:'TETRA'}).length,6);assert.equal(scopeFilter(rows,{vendor:'Ericsson'}).length,1);
 const groups=groupBy(rows,'vendor');assert.equal(groups.length,4);assert.equal(groups.reduce((sum,g)=>sum+g.tickets,0),rows.length);assert.equal(groups.find(g=>g.name==='TETRA').tickets,6);assert.equal(rows[3].vendor,'NSN');
});
test('analysis excludes parent-linked tickets and retains all root causes with explicit impact selection',()=>{
 const rows=[r(1),r(2,{parent_tt:'TT1'}),r(3,{root_cause:'  TELECOM '}),r(4,{service_impact:'No impact'})];
 assert.deepEqual(scopeFilter(rows,{scope:'powerbi',service_impact:'Outage'},{excluded_root_causes:['Telecom']}).map(x=>x.id),[rows[0],rows[2]].map(x=>x.id));
 assert.equal(scopeFilter(rows,{scope:'all',service_impact:'all'}).length,3);
 assert.equal(scopeFilter(rows,{scope:'all',site_id:'COW999'}).length,0);
});
test('Power BI row count, recorded-duration denominator, exemptions, missing values and zero are preserved',()=>{
 const rows=[r(1,{duration_minutes:0}),r(2,{duration_minutes:120,sla_breached:true}),r(3,{duration_minutes:null,sla_breached:null}),r(4,{duration_minutes:60,sla_excluded:true,sla_breached:true})];
 const s=summarize(rows);assert.equal(s.tickets,4);assert.equal(s.durationMinutes,180);assert.equal(s.durationCount,3);assert.equal(s.mttr,60);assert.equal(s.slaEligible,2);assert.equal(s.breached,1);assert.equal(s.slaCompliance,50);assert.equal(s.slaExcluded,1);assert.equal(s.repeatSites,1);
 const no=summarize([r(5,{duration_minutes:null,sla_breached:null})]);assert.equal(no.durationMinutes,0);assert.equal(no.mttr,null);assert.equal(no.slaCompliance,null);
 assert.equal(summarize([r(1),r(1,{site_id:'COW002'})]).tickets,2);assert.equal(summarize([r(1),r(1,{site_id:'COW002'})]).distinctTickets,1);
});
test('recurrence requires at least three tickets per COW within the selected scope',()=>{
 const rows=[...Array.from({length:2},(_,i)=>r('a'+i,{site_id:'TWICE'})),...Array.from({length:3},(_,i)=>r('b'+i,{site_id:'THREE'})),...Array.from({length:4},(_,i)=>r('c'+i,{site_id:'FOUR'})),r('single',{site_id:'ONCE'}),r('missing',{site_id:null})];
 const summary=summarize(rows);assert.equal(summary.sites,4);assert.equal(summary.repeatSites,2);assert.equal(summary.repeatRate,50);
 const scoped=summarize(rows.filter(row=>!['TTb2','TTc2','TTc3'].includes(row.ticket_number)));assert.equal(scoped.repeatSites,0);assert.equal(scoped.repeatRate,0);
 assert.equal(summarize([]).repeatRate,null);assert.equal(summarize([r('missing',{site_id:null})]).repeatRate,null);
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
test('imports normalize source columns, keep the richest row per ticket, and quarantine undated rows',()=>{
 const rows=[{'Ticket Number':'PR1',SiteID:'COW001','Create Date':'01/08/2026',Region:'CENTRAL','RestorationTime HHMMSS':0,'Exceed SLA':'No'},
 {'Ticket Number':'PR1',SiteID:'COW001','Create Date':'01/08/2026',Region:'Central','RestorationTime HHMMSS':0,'Exceed SLA':'No',RepairDetails:'Complete record'},
 {'Ticket Number':'PR2',SiteID:'COW002','Create Date':'bad'},
 {'ticket_number':'PR3','site_id':'COW003','created_date':'2026-08-31','duration_minutes':-1}];
 const result=normalizeRecords(rows);assert.equal(result.records.length,2);assert.equal(result.duplicates,1);assert.equal(result.rejected.length,1);assert.equal(result.records[0].region,'Central');assert.equal(result.records[0].id,'pbi:PR1');assert.equal(result.records[0].duration_minutes,0);assert.equal(result.records[0].repair_details,'Complete record');assert.equal(result.records[1].duration_minutes,null);assert.ok(result.records[1].quality_flags.length);assert.equal(result.rejected[0].source_data['Ticket Number'],'PR2');
});
test('site and regional groups reconcile additive record-based measures',()=>{
 const rows=[r(1),r(2,{region:'East',site_id:'COW002',duration_minutes:90})],groups=groupBy(rows,'region');assert.equal(groups.reduce((s,g)=>s+g.durationMinutes,0),summarize(rows).durationMinutes);assert.equal(groups.reduce((s,g)=>s+g.tickets,0),2);
});
test('ticket-only deduplication handles site/severity/district changes and ignores legacy variant keys',()=>{
 const base={'Ticket Number':'PR9',SiteID:'COW9','Create Date':'31/08/2026',Severity:'High',District:'Riyadh'};
 const result=normalizeRecords([base,{...base,Severity:'Critical'},{...base,District:'Dammam'},{...base,source_key:'retained-model-variant'}]);
 assert.equal(result.records.length,1);assert.equal(result.duplicates,3);assert.equal(result.records[0].id,'pbi:PR9');assert.equal(result.records[0].severity,'Critical');assert.equal(result.records[0].deduplication.removed.length,3);
});
test('source dates have explicit two-digit US and four-digit day-first interpretation',()=>{
 const result=normalizeRecords([{'Ticket Number':'PR1','Create Date':'8/3/26 4:20'},{'Ticket Number':'PR2','Create Date':'03/08/2026 04:20:00'},{'Ticket Number':'PR3','Create Date':'31/02/2026'}]);
 assert.deepEqual(result.records.map(r=>r.created_date),['2026-08-03','2026-08-03']);assert.equal(result.rejected.length,1);
});
test('richness counts zero and false, excludes errors/placeholders/technical keys, and retains a whole original row',()=>{
 const base={'Ticket Number':' pr0001 ','Create Date':'2026-09-30',SiteID:'COW1',RepairDetails:'short'};
 const poorer={...base,SiteID:'COW2',RepairDetails:'Much longer description',Notes:'#REF!',Other:'N/A',source_key:'ignored',id:'ignored'};
 const richer={...base,Count:0,Closed:false,Notes:'filled',RepairDetails:'Rich original'};
 const out=normalizeRecords([poorer,richer]);assert.equal(out.records.length,1);assert.equal(out.records[0].ticket_number,'PR0001');assert.equal(out.records[0].site_id,'COW1');assert.equal(out.records[0].repair_details,'Rich original');assert.equal(out.records[0].source_data.Count,0);assert.equal(out.records[0].source_data.Closed,false);assert.equal(out.records[0].source_data.Other,undefined);assert.ok(out.records[0].deduplication.kept.populated_fields>out.records[0].deduplication.removed[0].populated_fields);
});
test('equal field counts prefer more text and exact ties keep the first source occurrence',()=>{
 const base={'Ticket Number':'PR2','Create Date':'2026-09-30'};
 const result=normalizeRecords([{...base,RepairDetails:'old'},{...base,RepairDetails:'Full repair details',source_row:20},{...base,RepairDetails:'Full repair details',source_row:30}]);
 assert.equal(result.records[0].source_row,20);assert.equal(result.duplicates,2);
 const invalid=normalizeRecords([{...base,'Ticket Number':'not-a-ticket'}]);assert.equal(invalid.records.length,0);assert.equal(invalid.rejected[0].source_data['Ticket Number'],'not-a-ticket');
});
test('UTC source timestamps use the same Riyadh reporting date as PostgreSQL',()=>{
 const result=normalizeRecords([{ticket_number:'PR3',created_at:'2026-09-30T23:30:00Z',restoration_days:0}]);
 assert.equal(result.records[0].created_date,'2026-10-01');assert.equal(result.records[0].duration_minutes,0);
});
