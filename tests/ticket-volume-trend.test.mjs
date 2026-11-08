import test from 'node:test';
import assert from 'node:assert/strict';
import {REPORTS,buildReport} from '../dist/analysis.mjs';
import {areaData,areaSvg,chartLegend,createChartExport,renderChartBoard} from '../dist/charts.mjs';
import {createDashboardExport} from '../dist/pdf-report.mjs';

const selection={period:'2026-08',year:2026,week:35,scope:'all',vendor:'Nokia'};
const coverage={min_date:'2024-01-01',max_date:'2026-08-31'};
const ticket=(id,date,extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',vendor:'Nokia',parent_tt:null,site_id:'COW1',region:'Central',district:'Riyadh City',duration_minutes:60,...extra});
const totals=data=>data.series.map(s=>s.values.reduce((total,value)=>total+(value??0),0));

test('weekly SA and NSA compare matching weekdays with true zeros and missing days',()=>{
  const state={...selection,week:36};
  for(const [id,impact] of [['weekly-sa','Outage'],['weekly-nsa','No impact']]){
    const records=[ticket('current','2026-08-30'),ticket('comparison','2026-08-24'),ticket('ignored-vendor','2026-08-31',{vendor:'Ericsson'}),ticket('parent','2026-08-24',{parent_tt:'PR0001'})].map(r=>({...r,service_impact:impact}));
    const report=buildReport(records,state,{},coverage,id),data=areaData(report,state,coverage);
    assert.deepEqual(data.labels,['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
    assert.deepEqual(data.series.map(s=>s.values),[[1,0,null,null,null,null,null],[0,1,0,0,0,0,0]]);
    const svg=areaSvg(data);
    assert.match(svg,/Current · 30 Aug 2026: 1 ticket/);
    assert.match(svg,/Comparison · 23 Aug 2026: 0 tickets/);
    assert.match(svg,/Current: Unavailable/);
  }
});

test('monthly comparison preserves all days in both periods without padding a shorter month with zeros',()=>{
  const state={...selection,period:'2026-02'},meta={...coverage,max_date:'2026-02-28'};
  const report=buildReport([ticket('feb','2026-02-03'),ticket('jan','2026-01-03'),ticket('end-jan','2026-01-31')],state,{},meta,'overview');
  const data=areaData(report,state,meta);
  assert.equal(data.axisTitle,'Day of period');
  assert.equal(data.labels.length,31);
  assert.deepEqual(data.series.map(s=>[s.values[2],s.values[30]]),[[1,null],[1,1]]);
  assert.deepEqual(totals(data),[1,2]);
});

test('long selected ranges align month slots, preserve boundaries, and identify the actual compared months',()=>{
  const state={...selection,period:'2026-08',reviewRanges:{overview:{from:'2026-07-15',to:'2026-08-20'}}};
  const records=[ticket('current-start','2026-07-15'),ticket('current-end','2026-08-20'),ticket('previous','2026-06-16'),ticket('before','2026-07-14'),ticket('after','2026-08-21'),ticket('previous-after','2026-06-21')];
  const report=buildReport(records,state,{},coverage,'overview'),data=areaData(report,state,coverage);
  assert.equal(data.axisTitle,'Month of period');
  assert.deepEqual(data.labels,['1','2']);
  assert.deepEqual(data.series.map(s=>s.values),[[1,1],[0,1]]);
  assert.deepEqual(data.series[1].buckets[1],[{start:'2026-06-01',end:'2026-06-20'}]);
});

test('all six dashboards and their exports use the selected current and comparison ticket totals',()=>{
  const base=[ticket('a','2026-08-24'),ticket('b','2026-08-25'),ticket('c','2026-08-17'),ticket('d','2026-07-01'),ticket('e','2025-08-24'),ticket('f','2024-08-25')];
  for(const id of Object.keys(REPORTS)){
    const records=id==='weekly-nsa'?base.map(r=>({...r,service_impact:'No impact'})):base,state={...selection,view:id};
    const report=buildReport(records,state,{},coverage,id);
    const manifest=createDashboardExport({records,state,meta:coverage,selectedIds:[id+'-ticket-trend']});
    const chart=manifest.items[0].chart;
    assert.equal(chart.title,'Tickets volume KPI trend');
    assert.equal(chart.data.series.length,2,id);
    assert.deepEqual(totals(chart.data),[report.now.summary.tickets,report.prev.summary.tickets],id);
    assert.deepEqual(chartLegend(chart).map(s=>[s.name,s.dashed]),[[`Current · ${report.now.range.label}`,false],[`Comparison · ${report.prev.range.label}`,true]],id);
    assert.match(chart.svg,/stroke="#ff375e"[^>]*stroke-dasharray="7 5"/);
    assert.match(renderChartBoard(report,state,coverage),new RegExp(`data-chart-id="${id}-ticket-trend"`));
    assert.match(createChartExport(chart.svg,chart.title,chartLegend(chart)),/stroke-dasharray="5 3"/);
  }
});

test('all-year week selections retain real comparisons and do not invent a comparison for the full history',()=>{
  const records=[ticket('a','2026-08-24'),ticket('b','2025-08-25'),ticket('c','2026-08-17')];
  const state={...selection,allYears:true};
  const weekly=areaData(buildReport(records,state,{},coverage,'weekly-sa'),state,coverage);
  assert.deepEqual(totals(weekly),[2,1]);
  const whole={...state,week:'all'},history=areaData(buildReport(records,whole,{},coverage,'weekly-sa'),whole,coverage);
  assert.equal(history.series.length,1);
  assert.deepEqual(totals(history),[3]);
  assert.match(history.labels[0],/Jan 24/);
});
