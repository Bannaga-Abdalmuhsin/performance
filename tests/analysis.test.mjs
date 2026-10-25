import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weekNumber,weeksInYear,weekRange,shiftWeek,durationBucket,buildReport,comparisonGroups,change,latestReportDate} from '../dist/analysis.mjs';
const profiles=JSON.parse(readFileSync(new URL('../dist/report-profiles.json',import.meta.url)));
const r=(id,date,extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',parent_tt:null,root_cause:'Generator Issue',duration_minutes:60,site_id:'COW1',quality_flags:[],...extra});
const state={period:'2026-08',year:2026,week:36,scope:'all'};
const meta={min_date:'2024-01-01',max_date:'2026-08-31'};
test('NSA latest week uses eligible NSA records instead of the later SA cutoff',()=>{
 const records=[r('nsa','2026-08-31',{service_impact:'No impact'}),r('degraded','2026-08-30',{service_impact:'Degraded'}),r('child','2026-08-31',{service_impact:'No impact',parent_tt:'PR1'}),r('sa','2026-09-30')],mixedMeta={...meta,max_date:'2026-09-30'};
 const latest=latestReportDate(records,profiles,mixedMeta,'weekly-nsa');assert.equal(latest,'2026-08-31');assert.equal(weekNumber(latest),36);assert.equal(latestReportDate(records,profiles,mixedMeta,'weekly-sa'),'2026-09-30');assert.equal(buildReport(records,{...state,week:weekNumber(latest)},profiles,mixedMeta,'weekly-nsa').now.summary.tickets,2);
});
test('absence of NSA records never invents an NSA cutoff from SA dates',()=>{
 assert.equal(latestReportDate([r('sa','2026-08-31')],profiles,meta,'weekly-nsa'),null);
});
test('Sunday weeks use January 1, with explicit short first/last weeks',()=>{
 assert.equal(weekNumber('2026-01-01'),1);assert.equal(weekNumber('2026-01-03'),1);assert.equal(weekNumber('2026-01-04'),2);
 assert.deepEqual(weekRange(2026,1),{start:'2026-01-01',end:'2026-01-03',year:2026,week:1,label:'W01 · 2026'});
 assert.equal(weeksInYear(2028),54);assert.equal(weekRange(2028,54).start,'2028-12-31');
 assert.equal(shiftWeek(2026,1,-1).end,'2025-12-31');assert.equal(shiftWeek(2026,1,-2).week,52);
 assert.equal(weekRange(2026,54),null);
});
test('all duration band boundaries match the decoded DAX, including zero and missing',()=>{
 const values=[null,0,119.99,120,239.99,240,479.99,480,1439.99,1440];
 assert.deepEqual(values.map(durationBucket),['Missing','<2hrs','<2hrs','02-04hrs','02-04hrs','04-08hrs','04-08hrs','08-24hrs','08-24hrs','>24hrs']);
});
test('all root causes remain eligible while parent-linked tickets are excluded for both impacts',()=>{
 const records=[r('a','2026-08-31',{root_cause:'Self Cleared'}),r('b','2026-08-31',{service_impact:'Degraded'}),r('c','2026-08-31',{service_impact:'No impact'}),r('d','2026-08-31',{service_impact:'Unknown'}),r('e','2026-08-31',{parent_tt:'parent'})];
 assert.equal(buildReport(records,state,profiles,meta,'weekly-sa').now.summary.tickets,1);
 assert.equal(buildReport(records,state,profiles,meta,'overview').now.summary.tickets,1);
 assert.equal(buildReport(records,state,profiles,meta,'weekly-nsa').now.summary.tickets,3);
});
test('monthly review includes day 31, with adjacent months and year rollover',()=>{
 const report=buildReport([r('a','2026-08-31'),r('b','2026-07-31')],state,profiles,meta,'overview');
 assert.equal(report.now.summary.tickets,1);assert.equal(report.prev.summary.tickets,1);assert.equal(report.series[2].range.start,'2026-06-01');
 const january=buildReport([], {...state,period:'2026-01'},profiles,meta,'overview');assert.equal(january.prev.range.start,'2025-12-01');assert.equal(january.series[2].range.start,'2025-11-01');
});
test('MoM Y compares matching months across years and aligns a partial month',()=>{
 const records=[r('a','2026-08-15'),r('b','2025-08-15'),r('c','2025-08-16'),r('d','2024-08-15')];
 const report=buildReport(records,state,profiles,{...meta,max_date:'2026-08-15'},'mom-y');
 assert.deepEqual(report.series.map(x=>x.range.end),['2026-08-15','2025-08-15','2024-08-15']);
 assert.deepEqual(report.series.map(x=>x.summary.tickets),[1,1,1]);
});
test('WoW Y uses the selected week for both tickets and duration in all years',()=>{
 const records=[r('a','2026-05-24',{duration_minutes:120}),r('b','2025-05-25',{duration_minutes:60}),r('c','2026-03-15',{duration_minutes:900})];
 const report=buildReport(records,{...state,week:22},profiles,meta,'wow-y');
 assert.equal(report.now.summary.tickets,1);assert.equal(report.now.summary.durationMinutes,120);assert.equal(report.prev.summary.durationMinutes,60);assert.equal(report.durationChange,100);
});
test('YoY compares matching YTD days and handles leap-day comparators',()=>{
 const records=[r('a','2026-08-31'),r('b','2025-08-31'),r('c','2025-09-01')];
 const report=buildReport(records,state,profiles,meta,'yoy');assert.equal(report.prev.range.end,'2025-08-31');assert.equal(report.prev.summary.tickets,1);
 const leap=buildReport([],{...state,period:'2024-02',year:2024},profiles,{min_date:'2022-01-01',max_date:'2024-02-29'},'yoy');assert.equal(leap.prev.range.end,'2023-02-28');
});
test('visual count filters do not remove records from page KPIs',()=>{
 const records=[r('a','2026-08-31',{root_cause:'One ticket'}),r('b','2026-08-31'),r('c','2026-08-31'),r('d','2026-08-24',{root_cause:'Previous only'})];
 const report=buildReport(records,state,profiles,meta,'weekly-sa');assert.equal(report.now.summary.tickets,3);assert.deepEqual(comparisonGroups(report,'root_cause').map(x=>x.name),['Generator','Others']);assert.equal(comparisonGroups(report,'root_cause').reduce((n,g)=>n+g.series[0].tickets,0),3);
});
test('zero-baseline and unavailable-period comparisons are explicit',()=>{
 assert.equal(change(2,0),100);assert.equal(change(0,0),0);assert.equal(change(0,2),-100);assert.equal(change(null,2),null);
 const report=buildReport([r('a','2024-01-01')],{...state,period:'2024-01',year:2024,week:1},profiles,meta,'overview');assert.equal(report.prev.summary,null);assert.equal(report.ticketChange,null);
});
test('All weeks covers full calendar years across every weekly analysis and keeps filters',()=>{
 const source=[r('a','2026-01-01',{vendor:'NSN'}),r('b','2026-08-31',{vendor:'Nokia'}),r('c','2025-12-31',{vendor:'Cisco'}),r('d','2024-02-29',{vendor:'Specialized'}),r('nsa','2026-07-01',{vendor:'NSN',service_impact:'No impact'})];
 for(const id of ['weekly-sa','weekly-nsa','wow-y']){
  const report=buildReport(source,{...state,week:'all'},profiles,meta,id);
  assert.deepEqual(report.series.map(s=>[s.range.start,s.range.end]),[['2026-01-01','2026-12-31'],['2025-01-01','2025-12-31'],['2024-01-01','2024-12-31']]);
  assert.equal(report.definition.mode,'year');assert.equal(report.definition.fullYear,true);assert.equal(report.now.partial,true);
  assert.equal(report.now.summary.tickets,id==='weekly-nsa'?1:2);
 }
 const others=buildReport(source,{...state,week:'all',vendor:'TETRA'},profiles,meta,'weekly-sa');assert.deepEqual(others.series.map(s=>s.summary.tickets),[1,1,1]);
 const monthly=buildReport(source,{...state,week:'all'},profiles,meta,'overview');assert.equal(monthly.now.range.start,'2026-08-01');assert.equal(monthly.now.summary.tickets,1);
});
