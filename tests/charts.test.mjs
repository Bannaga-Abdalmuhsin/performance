import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReport} from '../dist/analysis.mjs';
import {CHART_PLANS,comparisonData,yearMonthData,areaData,funnelData,durationSeverityData,comboSvg,horizontalSvg,areaSvg,regionalSvg,regionalData,funnelSvg,donutSvg,countScale,percentScale,renderChartBoard,createChartExport} from '../dist/charts.mjs';
const profiles=JSON.parse(readFileSync(new URL('../dist/report-profiles.json',import.meta.url)));
const state={period:'2026-08',year:2026,week:35,scope:'powerbi'};
const meta={min_date:'2024-01-01',max_date:'2026-08-31'};
const r=(id,date,extra={})=>({id,ticket_number:id,created_date:date,service_impact:'Outage',parent_tt:null,root_cause:'Generator Issue',duration_minutes:60,site_id:'COW1',region:'Central',district:'Riyadh City',site_label:'VIP',severity:'High',quality_flags:[],...extra});
const rows=[r('a','2026-08-24'),r('b','2026-08-25',{duration_minutes:180}),r('c','2026-08-17',{duration_minutes:120}),r('d','2026-08-10'),r('e','2025-08-24',{duration_minutes:240}),r('f','2024-08-25',{duration_minutes:360})];
test('chart families match the five source pages and extend consistently to YoY',()=>{
 const expected={
  'weekly-sa':['area','funnel','stacked-combo','line','bar','combo'],
  'weekly-nsa':['area','funnel','line','bar','severity-bar','combo'],
  overview:['area','funnel','line','combo'],
  'mom-y':['line','combo'],'wow-y':['line','combo'],yoy:['line','combo','stacked-combo']
 };
 for(const [id,types]of Object.entries(expected)){const report=buildReport(rows,state,profiles,meta,id),html=renderChartBoard(report,state,meta);for(const type of types)assert.ok(html.includes(`data-chart-kind="${type}"`),id+' '+type);assert.equal((html.match(/class="bi-donut-svg"/g)||[]).length,2,id);assert.ok(!html.includes('NaN'),id);}
 assert.equal(CHART_PLANS['weekly-sa'].periods,2);assert.equal(CHART_PLANS['weekly-nsa'].periods,3);assert.equal(CHART_PLANS.overview.periods,2);assert.equal(CHART_PLANS['mom-y'].periods,3);
});
test('comparison bar series use the visible periods and independently computed percentages',()=>{
 const report=buildReport(rows,state,profiles,meta,'weekly-sa'),data=comparisonData(report,'root_cause');
 assert.deepEqual(data.labels,['Generator Issue']);assert.deepEqual(data.series.map(s=>s.values),[[2],[1]]);
 assert.equal(data.lines[0].values[0],100);assert.equal(data.lines[1].values[0],100);
});
test('weekly area shows real daily zero and leaves outside-coverage days unavailable',()=>{
 const report=buildReport(rows,{...state,week:36},profiles,meta,'weekly-sa'),data=areaData(report,{...state,week:36},meta);
 assert.deepEqual(data.series[0].values,[0,0,null,null,null,null,null]);
});
test('YoY monthly charts clip all years to matching YTD coverage',()=>{
 const source=[...rows,r('x','2025-09-01'),r('y','2024-12-01')],report=buildReport(source,state,profiles,meta,'yoy');
 const data=yearMonthData(report,state,meta,'tickets');assert.equal(data.series[1].values[7],1);assert.equal(data.series[1].values[8],null);assert.equal(data.series[2].values[11],null);
 assert.equal(data.series[0].values[0],0);assert.deepEqual(data.series.map(s=>s.name),['2026','2025','2024']);
});
test('funnel excludes missing durations, preserves zero, and sorts by source ticket count',()=>{
 const report=buildReport([...rows,r('zero','2026-08-24',{duration_minutes:0}),r('missing','2026-08-24',{duration_minutes:null})],state,profiles,meta,'weekly-sa');
 const data=funnelData(report);assert.equal(data.labels[0],'<2hrs');assert.equal(data.series[0].values[0],2);assert.equal(data.series[0].values.reduce((a,b)=>a+b,0),3);
});
test('NSA duration bars account for every severity and keep severity totals additive',()=>{
 const source=[r('a','2026-08-24',{service_impact:'No impact',duration_minutes:30,severity:'Critical'}),r('b','2026-08-24',{service_impact:'Degraded',duration_minutes:180,severity:'High'}),r('c','2026-08-24',{service_impact:'No impact',duration_minutes:500,severity:null})];
 const report=buildReport(source,state,profiles,meta,'weekly-nsa'),data=durationSeverityData(report);
 assert.deepEqual(data.series.map(s=>s.name),['Critical','High','Unknown']);assert.equal(data.series.flatMap(s=>s.values).reduce((a,b)=>a+b,0),3);
});
test('plot scales and SVGs handle empty, zero, negative change, and missing comparisons',()=>{
 const scale=countScale([0,1,135,null]);assert.ok(scale.max>=135);assert.equal(scale.max/4,scale.step);assert.ok(Number.isInteger(scale.step));
 const percent=percentScale([-100,271,null]);assert.ok(percent.min<=-100);assert.ok(percent.max>=271);
 for(const id of Object.keys(CHART_PLANS)){const report=buildReport([],state,profiles,meta,id),data=comparisonData(report,'root_cause');for(const svg of [comboSvg(data),horizontalSvg(data),areaSvg(areaData(report,state,meta)),regionalSvg(regionalData(report)),funnelSvg(funnelData(report)),donutSvg(null,'No comparison'),donutSvg(271,'Duration change')]){assert.ok(svg.startsWith('<svg'));assert.ok(!/NaN|Infinity|undefined/.test(svg));assert.ok(!/height="-\d/.test(svg));}}
});
test('source labels and tooltips are escaped, categories drill down, and charts can be exported',()=>{
 const report=buildReport([r('x','2026-08-24',{root_cause:'<script>"& injection'})],state,{...profiles,'weekly-sa':{...profiles['weekly-sa'],visuals:{}}},meta,'weekly-sa');
 const svg=comboSvg(comparisonData(report,'root_cause'));
 assert.ok(svg.includes('data-cause="&lt;script&gt;&quot;&amp; injection"'));assert.ok(!svg.includes('<script>'));
 const html=renderChartBoard(report,state,meta);assert.ok(html.includes('data-action="chart-download"'));assert.ok(html.includes('data-action="chart-expand"'));assert.ok(html.includes('View chart data'));
});
test('exported charts include a white background, title and period/line legends',()=>{
 const report=buildReport(rows,state,profiles,meta,'weekly-sa'),svg=comboSvg(comparisonData(report,'root_cause'));
 const exported=createChartExport(svg,'Root causes <&>',[{name:'W35 · 2026',color:'#4f008c'},{name:'Ticket change',color:'#00a39b',line:true}]);
 assert.ok(exported.includes('fill="white"'));assert.ok(exported.includes('Root causes &lt;&amp;&gt;'));assert.ok(exported.includes('W35 · 2026'));assert.ok(exported.includes('Ticket change'));assert.ok(exported.includes('<svg x="0" y="'));
});
