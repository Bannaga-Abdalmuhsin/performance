import {num, sum, summarize, scopeFilter, previousMonth, vendorGroup,siteLabelGroup,rootCauseGroup,analysisRecords} from './core.mjs?v=20261026all';
const DAY=86400000;
const iso=d=>new Date(d).toISOString().slice(0,10);
const utc=s=>Date.parse(s+'T00:00:00Z');
export const REPORTS={
  'weekly-sa':{title:'Weekly Overview (SA)',mode:'week',impact:'SA',comparison:'previous week'},
  'weekly-nsa':{title:'Weekly Overview (NSA)',mode:'week',impact:'NSA',comparison:'previous week'},
  overview:{title:'Monthly Overview (SA)',mode:'month',impact:'SA',comparison:'previous month'},
  'mom-y':{title:'MoM Y',mode:'month-year',impact:'SA',comparison:'same month last year'},
  'wow-y':{title:'WoW Y',mode:'week-year',impact:'SA',comparison:'same week last year'},
  yoy:{title:'YoY',mode:'year',impact:'SA',comparison:'matching period last year'}
};
export function weekNumber(date){const d=new Date(utc(date)),jan=Date.UTC(d.getUTCFullYear(),0,1);return Math.floor(((utc(date)-jan)/DAY+new Date(jan).getUTCDay())/7)+1;}
export function weeksInYear(year){return weekNumber(year+'-12-31');}
export function weekRange(year,week){
  const jan=Date.UTC(year,0,1),end=Date.UTC(year,11,31);
  if(!Number.isInteger(week)||week<1||week>weeksInYear(year))return null;
  const start=jan+(week-1)*7*DAY-new Date(jan).getUTCDay()*DAY;
  return {start:iso(Math.max(jan,start)),end:iso(Math.min(end,start+6*DAY)),year,week,label:`W${String(week).padStart(2,'0')} · ${year}`};
}
export function shiftWeek(year,week,offset){
  let y=Number(year),w=Number(week)+offset;
  while(w<1){y--;w+=weeksInYear(y);}while(w>weeksInYear(y)){w-=weeksInYear(y);y++;}
  return weekRange(y,w);
}
export function monthRange(month){const [y,m]=month.split('-').map(Number);return {start:month+'-01',end:iso(Date.UTC(y,m,0)),year:y,month,label:new Date(Date.UTC(y,m-1,15)).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'})};}
export function durationBucket(value){return !num(value)?'Missing':value>=1440?'>24hrs':value>=480?'08-24hrs':value>=240?'04-08hrs':value>=120?'02-04hrs':'<2hrs';}
export const DURATION_BUCKETS=['<2hrs','02-04hrs','04-08hrs','08-24hrs','>24hrs','Missing'];
export function reportProfile(profiles,id){return profiles[id]||profiles.overview||{};}
function impactRows(records,id){
  const impact=REPORTS[id]?.impact||'SA';
  return analysisRecords(records).filter(r=>impact==='NSA'?r.service_impact!=='Outage':r.service_impact==='Outage');
}
export function reportScope(records,state,profiles,id=state.reportView||state.view){
  return scopeFilter(impactRows(records,id),{...state,service_impact:undefined,period:undefined,query:undefined});
}
export function latestReportDate(records,profiles,meta,id){
  return impactRows(records,id).reduce((latest,row)=>row.created_date&&(!latest||row.created_date>latest)?row.created_date:latest,null);
}
function impactCoverage(records,id,meta){
  const dates=impactRows(records,id).map(r=>r.created_date).filter(Boolean).sort();
  const eligible=analysisRecords(records),latest=eligible.reduce((date,r)=>r.created_date&&(!date||r.created_date>date)?r.created_date:date,null);
  return {min_date:meta.min_date,max_date:REPORTS[id]?.impact==='NSA'?(dates.at(-1)||null):eligible.length===records.length?meta.max_date:latest};
}
function covered(range,meta){
  if(!range||!meta.min_date||!meta.max_date)return {covered:false,partial:false};
  if(range.ranges){const parts=range.ranges.map(r=>covered(r,meta)),yes=parts.some(p=>p.covered);return {covered:yes,partial:yes&&parts.some(p=>!p.covered||p.partial)};}
  const yes=range.end>=meta.min_date&&range.start<=meta.max_date;
  return {covered:yes,partial:yes&&(range.start<meta.min_date||range.end>meta.max_date)};
}
function inRange(rows,range){return range?rows.filter(r=>(range.ranges||[range]).some(p=>r.created_date>=p.start&&r.created_date<=p.end)):[];}
export function change(current,previous,kind='count'){
  if(!num(current)||!num(previous))return null;
  if(previous===0)return current===0?0:100;
  return (current-previous)/previous*100;
}
function matchedYearRange(year,monthDay){
  const [m,d]=monthDay.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {start:year+'-01-01',end:`${year}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`,year,label:String(year)};
}
export function allWeeksSelected(id,state){return state.week==='all'&&['week','week-year'].includes(REPORTS[id]?.mode);}
export function allYearsSelected(id,state){return !!(state.allYears||state.year==='all')&&['week','week-year'].includes(REPORTS[id]?.mode);}
export function fullYearRange(year){return {start:year+'-01-01',end:year+'-12-31',year,label:`${year} · All weeks`};}
function allYearPeriods(id,state,meta){
  const first=Number(meta.min_date?.slice(0,4)),last=Number(meta.max_date?.slice(0,4));
  if(!first||!last||last<first)return [null,null,null];
  const years=Array.from({length:last-first+1},(_,i)=>first+i),week=Number(state.week),allWeeks=state.week==='all';
  const combined=offset=>{
    const ranges=years.filter(year=>allWeeks||weekRange(year,week)).map(year=>allWeeks?fullYearRange(year):offset?shiftWeek(year,week,offset):weekRange(year,week)).filter(Boolean);
    if(!ranges.length)return null;
    if(allWeeks)for(const r of ranges){r.start=r.start<meta.min_date?meta.min_date:r.start;r.end=r.end>meta.max_date?meta.max_date:r.end;}
    const common=[...new Set(ranges.map(r=>r.week))],number=common.length===1?common[0]:null;
    return {start:ranges.map(r=>r.start).sort()[0],end:ranges.map(r=>r.end).sort().at(-1),ranges,allYears:true,years,week:allWeeks?null:week,firstYear:first,lastYear:last,
      label:allWeeks?`All years · ${first}–${last}`:`${number?'W'+String(number).padStart(2,'0'):offset===-1?'Previous week':'Earlier week'} · All years`,custom:allWeeks};
  };
  return [combined(0),...(!allWeeks&&REPORTS[id].mode==='week'?[combined(-1),combined(-2)]:[null,null])];
}
export function validReviewDates(from,to){
  const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(utc(value))&&iso(utc(value))===value;
  return valid(from)&&valid(to)&&from<=to;
}
export function shiftReviewDate(date,months,{monthEnd=false}={}){
  const d=new Date(utc(date)),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const last=new Date(d);last.setUTCMonth(last.getUTCMonth()+1,0);d.setUTCDate(monthEnd?last.getUTCDate():Math.min(day,last.getUTCDate()));return iso(d);
}
function reviewRangeLabel(start,end){
  const format=(value,year)=>new Date(utc(value)).toLocaleDateString('en-GB',{day:'2-digit',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
  return format(start,start.slice(0,4)!==end.slice(0,4))+' – '+format(end,true);
}
function customReviewPeriods(id,state){
  const mode=REPORTS[id]?.mode,range=state.reviewRanges?.[id];
  if(!range||mode?.includes('week'))return null;
  if(!validReviewDates(range.from,range.to))throw new Error('Choose a valid From–To review timeframe.');
  const monthCount=(Number(range.to.slice(0,4))-Number(range.from.slice(0,4)))*12+Number(range.to.slice(5,7))-Number(range.from.slice(5,7))+1;
  const step=mode==='month'?monthCount:12,preserveMonthEnd=mode==='month'&&range.to===monthRange(range.to.slice(0,7)).end;
  return [0,1,2].map(i=>{const start=shiftReviewDate(range.from,-i*step),end=shiftReviewDate(range.to,-i*step,{monthEnd:preserveMonthEnd});return {start,end,year:Number(end.slice(0,4)),label:reviewRangeLabel(start,end),custom:true};});
}
export function reportPeriods(id,state,meta){
  const mode=REPORTS[id]?.mode||'month',year=Number(state.year||state.period.slice(0,4)),week=Number(state.week||1);
  if(allYearsSelected(id,state))return allYearPeriods(id,state,meta);
  const custom=customReviewPeriods(id,state);if(custom)return custom;
  if(allWeeksSelected(id,state))return [0,1,2].map(n=>fullYearRange(year-n));
  if(mode==='week')return [weekRange(year,week),shiftWeek(year,week,-1),shiftWeek(year,week,-2)];
  if(mode==='week-year')return [0,1,2].map(n=>weekRange(year-n,week));
  if(mode==='month-year')return [0,1,2].map(n=>monthRange((year-n)+state.period.slice(4)));
  if(mode==='year'){
    const end=monthRange(`${year}${state.period.slice(4)}`).end;
    const cutoff=meta.max_date.slice(0,4)===String(year)&&meta.max_date<end?meta.max_date:end;
    return [0,1,2].map(n=>matchedYearRange(year-n,cutoff.slice(5)));
  }
  return [0,-1,-2].map(n=>monthRange(previousMonth(state.period,n)));
}
export function buildReport(records,state,profiles,meta,id=state.view){
  const sourceCoverage=impactCoverage(records,id,meta),scope=reportScope(records,state,profiles,id),ranges=reportPeriods(id,state,{...meta,max_date:sourceCoverage.max_date||meta.max_date});
  // Month/year views compare like-for-like days when the uploaded month is partial.
  if(REPORTS[id]?.mode==='month-year'&&!ranges[0].custom&&sourceCoverage.max_date&&ranges[0].start<=sourceCoverage.max_date&&ranges[0].end>sourceCoverage.max_date){
    const day=Number(sourceCoverage.max_date.slice(8));
    ranges.forEach(r=>r.end=r.end.slice(0,8)+String(Math.min(day,Number(r.end.slice(8)))).padStart(2,'0'));
  }
  const series=ranges.map(range=>{
    const coverage=covered(range,sourceCoverage),rows=coverage.covered?inRange(scope,range):[];
    return {range,...coverage,rows,summary:coverage.covered?summarize(rows):null};
  });
  const [now,prev]=series;
  const definition=allYearsSelected(id,state)?{...REPORTS[id],allYears:true,comparisonUnavailable:!prev.range,...(state.week==='all'?{mode:'year',customRange:true,fullYear:true}:{})}:allWeeksSelected(id,state)?{...REPORTS[id],mode:'year',comparison:'previous year',fullYear:true}:now.range?.custom?{...REPORTS[id],customRange:true,...(REPORTS[id].mode==='month'?{comparison:'previous matching month range'}:{})}:REPORTS[id];
  return {id,definition,profile:reportProfile(profiles,id),sourceCoverage,scope,series,now,prev,
    ticketChange:prev.summary?change(now.summary?.tickets,prev.summary.tickets):null,
    durationChange:prev.summary?change(now.summary?.durationMinutes,prev.summary.durationMinutes,'duration'):null};
}
export function comparisonGroups(report,field){
  const key=r=>field==='duration_bucket'?durationBucket(r.duration_minutes):field==='vendor'?vendorGroup(r[field]):field==='site_label'?siteLabelGroup(r[field]):field==='root_cause'?rootCauseGroup(r[field]):r[field]||'Unknown';
  const maps=report.series.map(s=>{const m=new Map();for(const r of s.rows){const name=key(r);if(!m.has(name))m.set(name,[]);m.get(name).push(r);}return m;});
  const names=new Set(maps.flatMap(m=>[...m.keys()]));
  const result=[...names].map(name=>({name,series:maps.map((m,i)=>report.series[i].covered?summarize(m.get(name)||[]):null)}));
  for(const g of result){g.ticketChange=change(g.series[0]?.tickets,g.series[1]?.tickets);g.durationChange=change(g.series[0]?.durationMinutes,g.series[1]?.durationMinutes);}
  return field==='duration_bucket'?result.sort((a,b)=>DURATION_BUCKETS.indexOf(a.name)-DURATION_BUCKETS.indexOf(b.name)):result.sort((a,b)=>(b.series[0]?.tickets||0)-(a.series[0]?.tickets||0)||a.name.localeCompare(b.name));
}
export function reportTrend(report,state,meta){
  meta={...meta,...report.sourceCoverage};
  const weekly=['week','week-year'].includes(report.definition.mode),year=Number(state.year||state.period.slice(0,4));
  const ranges=Array.from({length:12},(_,i)=>weekly?shiftWeek(year,Number(state.week),i-11):monthRange(previousMonth(state.period,i-11)));
  return ranges.map(range=>{const coverage=covered(range,meta);return {range,...coverage,summary:coverage.covered?summarize(inRange(report.scope,range)):null};});
}
export function dailyTrend(report){
  if(!report.now.range)return [];
  const days=new Map();for(const r of report.now.rows){if(!days.has(r.created_date))days.set(r.created_date,[]);days.get(r.created_date).push(r);}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,...summarize(rows)}));
}
