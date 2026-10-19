import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardExport,selectExportItems,exportChartRows,createDashboardPdf,savePdfDownload,rasterizeSvg} from '../dist/pdf-report.mjs';
import {REPORTS,buildReport,comparisonGroups,latestReportDate} from '../dist/analysis.mjs';
import {dashboardCards,dashboardSections} from '../dist/charts.mjs';
import {ROOT_CAUSE_GROUPS} from '../dist/core.mjs';
import {PDFDocument,PDFName} from '../dist/assets/vendor/pdf-lib-1.17.1.mjs';

const row=(id,date,extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',root_cause:'Self Cleared',parent_tt:null,duration_minutes:60,region:'Central',district:'Riyadh',site_id:'COW1',site_label:'VIP',severity:'High',sla_breached:false,quality_flags:[],...extra});
const records=[row('PR1','2026-08-31'),row('PR2','2026-08-30',{region:'East',duration_minutes:120}),row('PR3','2026-07-31'),row('PR4','2025-08-31'),row('PR5','2024-08-31'),row('NSA','2026-08-31',{service_impact:'No impact'}),row('SA','2026-09-30')];
const state={view:'overview',reportView:'overview',period:'2026-08',year:2026,week:36,scope:'all',region:'all',district:'all'},meta={min_date:'2024-01-01',max_date:'2026-09-30'};
const profiles=Object.fromEntries(Object.keys(REPORTS).map(id=>[id,{impact_mode:'NSA',excluded_root_causes:['Self Cleared'],visuals:{root_cause:{top_n:1,row_rules:[{field:'Root Cause Details',values:['Self Cleared'],exclude:true}],group_rules:[{period:0,value:50,kind:1}]}}}]));
const options={records,state,profiles,meta,generatedAt:'2026-10-19T12:00:00Z'};
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));

test('all records and chart categories survive retired page and visual criteria',()=>{
 const report=buildReport(records,{...state,scope:'powerbi'},profiles,meta,'overview');
 assert.equal(report.now.summary.tickets,2);assert.equal(report.now.summary.durationMinutes,180);assert.deepEqual(comparisonGroups(report,'root_cause').map(x=>x.name),['Self Cleared']);
 assert.equal(latestReportDate(records,profiles,meta,'weekly-nsa'),'2026-08-31');
});
test('each report exports exactly its dashboard cards, full source charts and selected period',()=>{
 for(const id of Object.keys(REPORTS)){
  const selection={...state,view:id,reportView:id},result=createDashboardExport({...options,state:selection}),expected=buildReport(records,selection,{},meta,id);
  assert.equal(result.report.now.summary?.tickets,expected.now.summary?.tickets,id);assert.equal(result.report.now.summary?.durationMinutes,expected.now.summary?.durationMinutes,id);
  assert.deepEqual(result.cards,dashboardCards(expected,selection,meta));assert.deepEqual(result.sections,dashboardSections(expected,selection,meta));
  assert.equal(result.cards.length,8);assert.ok(result.items.some(i=>i.id==='card-repeat-rate'));assert.ok(!/SLA|eligible|Recorded tickets|Within source date range/.test(JSON.stringify(result.cards)));
  assert.equal(result.title,REPORTS[id].title);assert.ok(result.items.filter(i=>i.type==='chart').length>=6);
 }
});
test('scope captures filters and register search without changing state or source coverage',()=>{
 const selected={...state,view:'tickets',query:'PR1',region:'Central',root_cause:'Self Cleared'},before={...selected};
 const result=createDashboardExport({...options,state:selected});assert.equal(result.report.now.summary.tickets,1);assert.equal(result.report.now.summary.durationMinutes,60);assert.deepEqual(selected,before);assert.deepEqual(result.selectedFilters,['Region: Central','Root cause: Self Cleared','Search: PR1']);
 const east=createDashboardExport({...options,state:{...state,region:'East'}});assert.equal(east.report.now.summary.tickets,1);assert.equal(east.report.now.summary.durationMinutes,120);
 const absent=createDashboardExport({...options,state:{...state,view:'tickets',reportView:'weekly-nsa',query:'no match'}});assert.equal(absent.report.now.covered,true);assert.equal(absent.report.now.summary.tickets,0);assert.equal(absent.report.sourceCoverage.max_date,'2026-08-31');
});
test('missing periods and zero baselines retain the dashboard comparison rules',()=>{
 const unavailable=createDashboardExport({...options,state:{...state,period:'2023-01',year:2023}});assert.equal(unavailable.report.now.summary,null);assert.equal(unavailable.cards[0].value,'—');
 const nsa=createDashboardExport({...options,state:{...state,view:'weekly-nsa'}});assert.equal(nsa.report.now.partial,true);assert.equal(nsa.report.now.summary.tickets,1);assert.equal(nsa.cards[1].metric,100);
});
test('All weeks and grouped vendors preserve matching full calendar years',()=>{
 const source=[row('a','2026-01-01',{vendor:'NSN'}),row('b','2026-08-31',{vendor:'Cisco'}),row('c','2026-08-31',{vendor:'Huawei'}),row('d','2025-12-31',{vendor:'Uncategorized'})],selected={...state,view:'weekly-sa',week:'all',vendor:'Others'};
 const result=createDashboardExport({...options,records:source,state:selected});assert.equal(result.report.now.summary.tickets,2);assert.equal(result.report.prev.summary.tickets,1);assert.equal(result.report.now.range.end,'2026-12-31');assert.equal(result.period,'2026 · All weeks');assert.deepEqual(result.selectedFilters,['Vendor: Others']);
});
test('item selection exports only chosen cards and charts in dashboard order',()=>{
 const full=createDashboardExport(options),root=full.items.find(i=>i.id.endsWith('-root_cause')),selected=selectExportItems(full,[root.id,'card-repeat-rate','card-tickets']);
 assert.deepEqual(selected.items.map(i=>i.id),['card-tickets','card-repeat-rate',root.id]);assert.equal(full.items.length,full.cards.length+full.sections.flatMap(s=>s.charts).length);
 assert.deepEqual(exportChartRows(selected).flatMap(row=>row.charts).map(c=>c.id),[root.id]);assert.throws(()=>selectExportItems(full,[]),/Select at least one/);assert.throws(()=>selectExportItems(full,['unknown']),/unavailable/);
});
test('wide and tall charts include all categories, preserving values and global scales',()=>{
 const source=Array.from({length:37},(_,i)=>row('PR'+i,'2026-08-31',{root_cause:ROOT_CAUSE_GROUPS[i%14],district:'District '+i,duration_minutes:i*11}));
 for(const id of ['overview','weekly-nsa']){
  const selectedRecords=id==='weekly-nsa'?source.map(r=>({...r,service_impact:'No impact'})):source;
  const full=createDashboardExport({...options,records:selectedRecords,state:{...state,view:id}});
  for(const field of ['root_cause','district']){
   const chart=full.items.find(i=>i.id===id+'-'+field).chart,parts=exportChartRows(selectExportItems(full,[chart.id])).flatMap(r=>r.charts);
   const count=field==='root_cause'?14:37;assert.equal(parts.length,field==='root_cause'?1:id==='weekly-nsa'?6:4);assert.deepEqual(parts.flatMap(p=>p.data.labels),chart.data.labels);assert.equal(new Set(parts.flatMap(p=>p.data.labels)).size,count);
   for(let s=0;s<chart.data.series.length;s++)assert.deepEqual(parts.flatMap(p=>p.data.series[s].values),chart.data.series[s].values);
   for(let s=0;s<(chart.data.lines||[]).length;s++)assert.deepEqual(parts.flatMap(p=>p.data.lines[s].values),chart.data.lines[s].values);
   for(const part of parts){assert.deepEqual(part.axisScale,parts[0].axisScale);assert.deepEqual(part.changeScale,parts[0].changeScale);assert.ok(!/NaN|Infinity|undefined/.test(part.svg));}
   assert.equal(chart.data.labels.length,count,'source descriptor must not be truncated');
  }
 }
});
test('PDF bytes contain selected cards and complete chart pages, with no print or script action',async()=>{
 const source=ROOT_CAUSE_GROUPS.map((root_cause,i)=>row('PR'+i,'2026-08-31',{root_cause}));
 const manifest=createDashboardExport({...options,records:source,selectedIds:['card-repeat-rate','overview-root_cause']}),rendered=[],progress=[];
 const result=await createDashboardPdf(manifest,{rasterize:async svg=>{rendered.push(svg);return png;},assetLoader:async()=>png,onProgress:(n,total)=>progress.push([n,total])});
 assert.equal(Buffer.from(result.bytes).subarray(0,5).toString(),'%PDF-');assert.equal(result.chartPartCount,1);assert.deepEqual(result.exportedIds,['card-repeat-rate','overview-root_cause']);assert.deepEqual(progress,[[1,1]]);
 const doc=await PDFDocument.load(result.bytes);assert.equal(doc.getPageCount(),result.pageCount);assert.equal(result.pageCount,1);assert.match(doc.getTitle(),/Monthly Overview/);assert.equal(doc.catalog.get(PDFName.of('OpenAction')),undefined);assert.equal(doc.catalog.get(PDFName.of('AA')),undefined);
 for(const page of doc.getPages()){assert.ok(Math.abs(page.getWidth()-1190.55)<.01);assert.ok(Math.abs(page.getHeight()-841.89)<.01);}
 const svg=rendered.join('\n');assert.ok(svg.includes('Repeat rate (3+ TTs)'));assert.ok(!svg.includes('No. of tickets KPI'));assert.ok(!svg.includes('SLA compliance'));for(const cause of ROOT_CAUSE_GROUPS)assert.ok(svg.includes(cause),cause);
});
test('SVG rasterization uses the full chart dimensions, independent of a viewport',async()=>{
 const saved={document:globalThis.document,Image:globalThis.Image},canvases=[],draws=[];
 try{
  globalThis.document={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){draws.push(args.slice(1));}}),toBlob(fn,type){assert.equal(type,'image/png');canvases.push([canvas.width,canvas.height]);fn(new Blob([png],{type}));}};return canvas;}};
  globalThis.Image=class{set src(value){assert.match(value,/^blob:/);queueMicrotask(()=>this.onload());}};
  assert.deepEqual(await rasterizeSvg('<svg viewBox="0 0 1400 900"></svg>'),png);assert.deepEqual(canvases,[[2800,1800]]);assert.deepEqual(draws,[[0,0,2800,1800]]);
 }finally{Object.assign(globalThis,saved);}
});
test('download saves application/pdf through a download link without a print frame',async()=>{
 const saved={document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};let anchor,blob,clicked=false,removed=false;
 try{
  URL.createObjectURL=value=>{blob=value;return 'blob:report';};URL.revokeObjectURL=()=>{};
  globalThis.document={createElement(tag){assert.equal(tag,'a');anchor={click(){clicked=true;},remove(){removed=true;}};return anchor;},body:{append(el){assert.equal(el,anchor);}}};
  savePdfDownload(Uint8Array.of(37,80,68,70,45),'selected-dashboard.pdf');assert.equal(blob.type,'application/pdf');assert.equal(await blob.text(),'%PDF-');assert.equal(anchor.download,'selected-dashboard.pdf');assert.equal(anchor.href,'blob:report');assert.ok(clicked&&removed);
 }finally{globalThis.document=saved.document;URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke;}
});
