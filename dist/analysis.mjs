import {num, sum, summarize, scopeFilter, previousMonth} from './core.mjs';
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
export function reportScope(records,state,profiles,id=state.reportView||state.view){
  const profile=reportProfile(profiles,id),impact=profile.impact_mode||REPORTS[id]?.impact||'SA';
  const rows=scopeFilter(records,{...state,service_impact:undefined,period:undefined,query:undefined},profile);
  return rows.filter(r=>impact==='NSA'?r.service_impact!=='Outage':r.service_impact==='Outage');
}
function covered(range,meta){
  if(!range)return {covered:false,partial:false};
  const yes=range.end>=meta.min_date&&range.start<=meta.max_date;
  return {covered:yes,partial:yes&&(range.start<meta.min_date||range.end>meta.max_date)};
}
function inRange(rows,range){return range?rows.filter(r=>r.created_date>=range.start&&r.created_date<=range.end):[];}
export function change(current,previous,kind='count'){
  if(!num(current)||!num(previous))return null;
  if(previous===0)return current===0?0:100;
  return (current-previous)/previous*100;
}
function matchedYearRange(year,monthDay){
  const [m,d]=monthDay.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {start:year+'-01-01',end:`${year}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`,year,label:String(year)};
}
export function reportPeriods(id,state,meta){
  const mode=REPORTS[id]?.mode||'month',year=Number(state.year||state.period.slice(0,4)),week=Number(state.week||1);
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
  const scope=reportScope(records,state,profiles,id),ranges=reportPeriods(id,state,meta);
  // Month/year views compare like-for-like days when the uploaded month is partial.
  if(REPORTS[id]?.mode==='month-year'&&ranges[0].start<=meta.max_date&&ranges[0].end>meta.max_date){
    const day=Number(meta.max_date.slice(8));
    ranges.forEach(r=>r.end=r.end.slice(0,8)+String(Math.min(day,Number(r.end.slice(8)))).padStart(2,'0'));
  }
  const series=ranges.map(range=>{
    const coverage=covered(range,meta),rows=coverage.covered?inRange(scope,range):[];
    return {range,...coverage,rows,summary:coverage.covered?summarize(rows):null};
  });
  const [now,prev]=series;
  return {id,definition:REPORTS[id],profile:reportProfile(profiles,id),scope,series,now,prev,
    ticketChange:prev.summary?change(now.summary?.tickets,prev.summary.tickets):null,
    durationChange:prev.summary?change(now.summary?.durationMinutes,prev.summary.durationMinutes,'duration'):null};
}
export function comparisonGroups(report,field){
  const key=r=>field==='duration_bucket'?durationBucket(r.duration_minutes):r[field]||'Unknown';
  const visual=report.profile.visuals?.[field];
  const aliases={'Root Cause Details':'root_cause','District':'district','Site Label':'site_label','Severity':'severity','Duration Criteria':'duration_bucket'};
  const accepted=r=>(visual?.row_rules||[]).every(rule=>{
    const f=aliases[rule.field];if(!f)return true;
    const raw=f==='duration_bucket'?(num(r.duration_minutes)?durationBucket(r.duration_minutes):null):r[f];
    const value=raw==='Unknown'?null:raw;
    const normalize=v=>String(v??'').trim().toLowerCase();
    const match=rule.contains!==undefined?normalize(value).includes(normalize(rule.contains)):(rule.values||[]).some(v=>normalize(v)===normalize(value));
    return rule.exclude?!match:match;
  });
  const maps=report.series.map(s=>{const m=new Map();for(const r of s.rows.filter(accepted)){const name=key(r);if(!m.has(name))m.set(name,[]);m.get(name).push(r);}return m;});
  const names=new Set(maps.flatMap(m=>[...m.keys()]));
  const result=[...names].map(name=>({name,series:maps.map((m,i)=>report.series[i].covered?summarize(m.get(name)||[]):null)}));
  for(const g of result){g.ticketChange=change(g.series[0]?.tickets,g.series[1]?.tickets);g.durationChange=change(g.series[0]?.durationMinutes,g.series[1]?.durationMinutes);}
  let filtered=result.filter(g=>(visual?.group_rules||[]).every(rule=>{
    const value=g.series[rule.period]?.tickets;if(!num(value))return false;
    let yes=({0:()=>value===rule.value,1:()=>value>rule.value,2:()=>value>=rule.value,3:()=>value<rule.value,4:()=>value<=rule.value})[rule.kind]?.()??true;
    return rule.not?!yes:yes;
  }));
  if(visual?.top_n){const ranks=new Map();for(const r of report.scope.filter(accepted))ranks.set(key(r),(ranks.get(key(r))||0)+1);const cutoff=[...ranks.values()].sort((a,b)=>b-a)[visual.top_n-1]||0;filtered=filtered.filter(g=>(ranks.get(g.name)||0)>=cutoff);}
  return field==='duration_bucket'?filtered.sort((a,b)=>DURATION_BUCKETS.indexOf(a.name)-DURATION_BUCKETS.indexOf(b.name)):filtered.sort((a,b)=>(b.series[0]?.tickets||0)-(a.series[0]?.tickets||0)||a.name.localeCompare(b.name));
}
export function reportTrend(report,state,meta){
  const weekly=['week','week-year'].includes(report.definition.mode),year=Number(state.year||state.period.slice(0,4));
  const ranges=Array.from({length:12},(_,i)=>weekly?shiftWeek(year,Number(state.week),i-11):monthRange(previousMonth(state.period,i-11)));
  return ranges.map(range=>{const coverage=covered(range,meta);return {range,...coverage,summary:coverage.covered?summarize(inRange(report.scope,range)):null};});
}
export function dailyTrend(report){
  if(!report.now.range)return [];
  const days=new Map();for(const r of report.now.rows){if(!days.has(r.created_date))days.set(r.created_date,[]);days.get(r.created_date).push(r);}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,...summarize(rows)}));
}
