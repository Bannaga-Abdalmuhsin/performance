import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeCategory,prepareAvailability} from '../dist/availability.mjs';
import {buildReport,dashboardDataset,REPORTS} from '../dist/analysis.mjs';
import {dashboardSections,areaData,yearMonthData} from '../dist/charts.mjs';
import {createDashboardExport,exportChartRows} from '../dist/pdf-report.mjs';

const dates=(start,end=start)=>({start,end});
const midnight=(day,time)=>day+'T'+time+':00+03:00';
const coverage={min_date:'2025-01-01',max_date:'2026-11-07'};
const inputs={schedule:{basis:'fixed-monthly-roster',counts:{city:318,'non-city':254},total:572,from:'2025-01-01'},
  approvals:{records:[{ticket_number:'PR2',approved_minutes:120},{ticket_number:'PR3',approved_minutes:30},{ticket_number:'PR4',approved_minutes:360}]}};
const row=(id,site_id,node,day,start,finish,other={})=>({
  id,ticket_number:id,site_id,region:'Central',district:'Riyadh',vendor:'Nokia',site_label:'Normal',
  service_impact:'Outage',source_data:{'Node Classification':node},created_date:day,
  impact_start:midnight(day,start),impact_finish:midnight(day,finish),duration_minutes:(Date.parse(midnight(day,finish))-Date.parse(midnight(day,start)))/60000,...other});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('fixed category rosters and capped approval credits reconcile to dashboard outage duration',()=>{
  const day='2026-10-07',rows=[
    row('PR1','COW001','SC_P3 Metro',day,'01:00','03:00'),
    row('PR2','COW-001','Metro',day,'02:00','04:00'),
    row('PR3','COW001','Metro',day,'03:00','05:00'),
    row('PR4','COW002','VIP Remote',day,'10:00','11:00'),
    row('PR5','COW002','Remote',day,'10:30','11:30'),
    row('PR6','COW003','Metro',day,'05:00','10:00',{parent_tt:'PR1'}),
    row('PR7','COW003','Metro',day,'05:00','10:00',{repair_details:'Resolution completed'}),
    row('PR8','COW003','Metro',day,'05:00','10:00',{repair_details:'duplicate TT'}),
    row('PR9','COW003','Metro',day,'05:00','10:00',{service_impact:'No impact'})
  ];
  const result=prepareAvailability(rows,inputs,coverage).measure(dates(day));
  assert.deepEqual(nodeCategory('SC_P3  Remote'),'non-city');
  assert.deepEqual(nodeCategory('City / VIP'),'city');
  assert.equal(nodeCategory('Metro / Remote'),null);
  assert.equal(result.city.scheduledHours,318*24);
  assert.equal(result['non-city'].scheduledHours,254*24);
  close(result.city.downtimeHours,3.5);
  close(result.city.recordedHours,6);
  close(result.city.approvedHours,2.5);
  close(result['non-city'].downtimeHours,1);
  close(result['non-city'].recordedHours,2);
  close(result['non-city'].approvedHours,1);
  close(result.city.percent,100*(1-3.5/(318*24)));
  assert.equal(result.city.meetsTarget,false);
  assert.equal(result['non-city'].meetsTarget,true);
});

test('recorded duration is assigned to ticket date, including date-only impact timestamps',()=>{
  const day='2026-11-06',rows=[row('PR3','COW002','Remote',day,'00:00','00:00',{duration_minutes:120})];
  const model=prepareAvailability(rows,inputs,coverage);
  const first=model.measure(dates(day))['non-city'];
  close(first.recordedHours,2);close(first.approvedHours,.5);close(first.downtimeHours,1.5);
  assert.equal(first.complete,true);
  assert.equal(model.measure(dates('2026-11-07'))['non-city'].percent,100);
  const result=model.measure([dates(day,'2026-11-30'),dates('2026-11-07')])['non-city'];
  assert.equal(result.scheduledHours,254*48);
  close(result.approvedHours,.5);close(result.downtimeHours,1.5);
  assert.equal(model.measure(dates('2026-11-08')),null);
});

test('unresolved classification and missing duration never produce a confirmed KPI',()=>{
  const day='2026-10-07',rows=[
    row('PR1','COW001','Metro',day,'00:00','00:00',{duration_minutes:null}),
    row('PR5','COW002','Remote',day,'10:00','11:00'),
    row('PR6','COW002','SC_P1A',day,'10:30','11:30'),
    row('PR7','COW003','VVVIP',day,'05:00','10:00')
  ];
  const result=prepareAvailability(rows,inputs,coverage).measure(dates(day));
  assert.equal(result.city.complete,false);assert.equal(result.city.meetsTarget,null);
  assert.equal(result['non-city'].complete,false);assert.equal(result['non-city'].meetsTarget,null);
  close(result.city.downtimeHours,0);close(result['non-city'].downtimeHours,2);
  const withoutApprovals=prepareAvailability(rows,{schedule:inputs.schedule},coverage);
  assert.equal(withoutApprovals.ready,false);
  assert.equal(withoutApprovals.measure(dates(day)),null);
});

test('all SA dashboards and PDF exports use selected periods and the fleet scope; NSA has no availability',()=>{
  const rows=[row('PR10','COW002','Remote','2026-11-07','01:00','02:00'),row('PR11','COW001','Metro','2026-10-07','01:00','02:00')];
  const meta={...coverage,dashboard_from:'2025-01-01',availability:inputs};
  for(const view of Object.keys(REPORTS)){
    const state={view,year:2026,week:45,period:'2026-11',vendor:'Huawei'};
    const report=buildReport(rows,state,{},meta);
    const sections=dashboardSections(report,state,meta);
    const charts=sections.filter(s=>s.id.startsWith('availability-')).flatMap(s=>s.charts);
    assert.equal(charts.length,view==='weekly-nsa'?0:4);
    if(!charts.length)continue;
    const [city,remote,cityTrend]=charts;
    for(const gauge of [city,remote]){
      const labels=[...gauge.svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)].map(([,label])=>label);
      assert.deepEqual(labels,[gauge.data.current.percent.toFixed(3)+'%']);
    }
    assert.deepEqual(cityTrend.data.lines,[]);
    assert.equal(report.now.summary.tickets,0);
    assert.ok(remote.data.current.downtimeHours>0,'Availability uses the whole fleet, regardless of the ticket filter');
    assert.deepEqual(cityTrend.data.series.map(s=>s.buckets),areaData(report,state,meta).series.map(s=>s.buckets));
    for(const [,points] of cityTrend.svg.matchAll(/<polyline points="([^"]+)"/g)){
      const coords=points.split(' ').map(p=>p.split(',').map(Number));
      assert.ok(coords.every(([x,y,...extra],i)=>Number.isFinite(x)&&Number.isFinite(y)&&!extra.length&&(!i||x>coords[i-1][0])));
    }
    const manifest=createDashboardExport({records:rows,state,meta,selectedIds:charts.map(c=>c.id)});
    assert.deepEqual(exportChartRows(manifest).flatMap(r=>r.charts.map(c=>c.id)),charts.map(c=>c.id));
  }
});

test('2024 is absent from ticket rows, all-year weeks, annual legends and export periods',()=>{
  const old=row('PR1','COW001','Metro','2024-12-31','01:00','02:00');
  const spill=row('PR2','COW002','Remote','2024-12-31','23:00','01:00',{impact_finish:midnight('2025-01-01','01:00')});
  const recent=row('PR3','COW003','Metro','2025-01-01','02:00','03:00');
  const {records,meta}=dashboardDataset({records:[old,spill,recent],meta:{...coverage,min_date:'2024-01-01',availability:inputs}});
  assert.deepEqual(records,[recent]);
  const state={view:'weekly-sa',year:2025,week:1,allYears:true,period:'2025-01'};
  const report=buildReport(records,state,{},meta);
  for(const period of report.series){
    if(period.range)assert.ok((period.range.ranges||[period.range]).every(r=>r.start>='2025-01-01'));
  }
  assert.equal(report.availability.measure(dates('2025-01-01'))['non-city'].downtimeHours,0);
  assert.equal(report.availability.measure(dates('2025-01-01'))['non-city'].approvedHours,0);
  const month={...state,view:'overview',allYears:false};
  const monthly=buildReport(records,month,{},meta);
  assert.equal(monthly.prev.range,null);
  assert.equal(yearMonthData(monthly,month,meta).series.some(s=>s.name.includes('2024')),false);
  const manifest=createDashboardExport({records,state:month,meta});
  assert.ok(manifest.report.series.every(p=>!JSON.stringify(p.range).includes('2024')));
});
