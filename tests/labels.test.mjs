import test from 'node:test';import assert from 'node:assert/strict';
import {VENDOR_GROUPS,vendorGroup,siteLabelGroup,scopeFilter,groupBy,normalizeRecords,ROOT_CAUSE_GROUPS} from '../dist/core.mjs';
import {REPORTS,buildReport,comparisonGroups} from '../dist/analysis.mjs';
import {createDashboardExport} from '../dist/pdf-report.mjs';
const state={view:'weekly-sa',reportView:'weekly-sa',period:'2026-10',year:2026,week:43,region:'all',vendor:'all',site_label:'all'},meta={min_date:'2024-01-01',max_date:'2026-10-24'};
const base=[['a','NA','NSN'],['b','Unknown','Nokia'],['c','Normal','Cisco'],['d','VIP','tetra']].map(([id,site_label,vendor])=>({id,ticket_number:id,created_date:'2026-10-20',site_id:'COW'+id,site_label,vendor,root_cause:'Unrecognized cause',region:'Central',district:'Riyadh',service_impact:'Outage',duration_minutes:60,parent_tt:null,quality_flags:[]}));
const records=[...base,...base.map(r=>({...r,id:'nsa-'+r.id,ticket_number:'nsa-'+r.id,service_impact:'No impact'})),...['2026-09-12','2025-10-20','2024-10-20'].map((date,i)=>({...base[0],id:'old'+i,ticket_number:'old'+i,created_date:date})),{...base[0],id:'parent',parent_tt:'PR111'},{...base[0],id:'fixation',repair_details:'Resolution fixation'}];

test('vendor categories rename the former remainder to TETRA and leave root-cause Others intact',()=>{
 assert.deepEqual(VENDOR_GROUPS,['Nokia','Ericsson','Huawei','TETRA']);
 assert.deepEqual(['Nokia',' ERICSSON ','huawei','TETRA','Others','Cisco',null].map(vendorGroup),['Nokia','Ericsson','Huawei','TETRA','TETRA','TETRA','TETRA']);
 assert(ROOT_CAUSE_GROUPS.includes('Others'));assert(!ROOT_CAUSE_GROUPS.includes('TETRA'));
 assert.deepEqual(['Unknown',' UNKNOWN ','na','NA','N/A',' n / a ',null,undefined,'',' Normal ','NORMAL'].map(siteLabelGroup),Array(11).fill('Normal'));
 assert.equal(siteLabelGroup('VVVIP'),'VVVIP');assert.equal(siteLabelGroup('VIP'),'VIP');
});

test('all six analyses and PDF selections share the grouped labels without changing source records',()=>{
 const before=JSON.stringify(records);
 assert.equal(groupBy(base,'site_label').find(g=>g.name==='Normal').tickets,3);
 assert.equal(groupBy(base,'vendor').find(g=>g.name==='TETRA').tickets,3);
 for(const id of Object.keys(REPORTS)){
  const selected={...state,view:id,reportView:id},report=buildReport(records,selected,{},meta);
  const labels=comparisonGroups(report,'site_label'),normal=labels.find(g=>g.name==='Normal');
  const expected=id==='yoy'?4:3;
  assert.equal(normal.series[0].tickets,expected,id);assert(!labels.some(g=>['Unknown','NA','N/A'].includes(g.name)));
  assert.equal(comparisonGroups(report,'vendor').find(g=>g.name==='TETRA').series[0].tickets,expected,id);
  assert.equal(buildReport(records,{...selected,site_label:'Normal'},{},meta).now.summary.tickets,expected,id);
  const legacy={...selected,vendor:'Others',site_label:'Unknown'},manifest=createDashboardExport({records,state:legacy,meta});
  assert.equal(manifest.report.now.summary.tickets,id==='yoy'?3:2,id);
  assert.deepEqual(manifest.selectedFilters,['Vendor: TETRA','Sites Label: Normal']);
  assert.deepEqual(manifest.items.find(i=>i.id===id+'-site_label').chart.data.labels,['Normal']);
  assert.equal(legacy.vendor,'Others');assert.equal(legacy.site_label,'Unknown');
 }
 assert.equal(JSON.stringify(records),before);
});

test('future raw uploads retain original values and immediately follow both analysis groupings',()=>{
 const source=[{'Ticket Number':'PR00120','Create Date':'20/10/2026','Site Label':'NA',Vendor:'Cisco','Service Impacted':'Outage'}];
 const normalized=normalizeRecords(source);assert.equal(normalized.records[0].site_label,'NA');assert.equal(normalized.records[0].vendor,'Cisco');
 assert.equal(scopeFilter(normalized.records,{site_label:'Normal',vendor:'TETRA'}).length,1);
 assert.equal(normalized.records[0].source_data['Site Label'],'NA');assert.equal(source[0]['Site Label'],'NA');
});
