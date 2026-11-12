import {isAnalysisRecord} from './core.mjs?v=20261112aprootcause';

const DAY=86400000, DAY_MINUTES=24*60, RIYADH_OFFSET=3*3600000;
export const AVAILABILITY_CATEGORIES=[
  {key:'city',label:'City Sites',classification:'Metro',target:99.96,weight:10},
  {key:'non-city',label:'Non City Sites',classification:'Remote',target:95,weight:10}
];
const saMidnight=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?Date.parse(date+'T00:00:00+03:00'):NaN;
const ticketKey=value=>String(value??'').trim().toUpperCase();
const siteKey=value=>String(value??'').trim().toUpperCase()
  .replace(/^(COW|CWH)[\s_-]*0*(\d+)$/,'$1$2');
export function nodeCategory(value){
  const text=String(value??'').toLowerCase().replace(/\bnon[\s-]*city\b/g,'remote');
  const city=/\b(?:metro(?:politan)?|city)\b/.test(text),remote=/\bremote\b/.test(text);
  return city===remote?null:city?'city':'non-city';
}
const sourceClass=row=>nodeCategory(row.performance_node_classification??row.source_data?.['Node Classification']??row['Node Classification']);

function hasClosedDate(row){
  const value=String(row.performance_closed_date??row.closed_at??row.source_data?.['Closed Date']??row['Closed Date']??'').trim();
  const serial=Number(value);
  if(Number.isFinite(serial))return serial>30000&&serial<80000;
  const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[ T])/);
  const slash=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?=$|[ T])/);
  if(!iso&&!slash)return false;
  const [y,m,d]=iso?iso.slice(1,4).map(Number):slash[3].length===2?[2000+Number(slash[3]),Number(slash[1]),Number(slash[2])]:[Number(slash[3]),Number(slash[2]),Number(slash[1])];
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
const closedOutage=row=>row.service_impact==='Outage'&&isAnalysisRecord(row)&&hasClosedDate(row);

function intervals(range,from,to){
  const parts=(Array.isArray(range)?range:range?.ranges||[range]).map(r=>{
    if(!r?.start||!r.end)return null;
    const start=saMidnight(r.start),end=saMidnight(r.end)+DAY;
    return [Math.max(from,start),Math.min(to,end)];
  }).filter(p=>p&&p[0]<p[1]).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const part of parts){
    const last=merged.at(-1);
    if(last&&part[0]<=last[1])last[1]=Math.max(last[1],part[1]);
    else merged.push(part);
  }
  return merged;
}

/** Use recorded duration and ticket dates from the selected, closed SA tickets.
 * Approved hours apply to their matching ticket, up to its recorded duration.
 */
export function prepareAvailability(records,inputs,coverage,{classificationRecords=records}={}){
  const schedule=inputs?.schedule,approvals=inputs?.approvals?.records;
  const rosterCounts=roster=>{
    const counts=roster?.counts;
    return AVAILABILITY_CATEGORIES.every(({key})=>Number.isSafeInteger(counts?.[key])&&counts[key]>0)&&
      roster.total===counts.city+counts['non-city']?counts:null;
  };
  const counts=schedule?.basis==='fixed-monthly-roster'?rosterCounts(schedule):null;
  const monthCounts=new Map();
  if(schedule?.basis==='monthly-on-air-roster'){
    for(const [month,roster] of Object.entries(schedule.months??{})){
      const verified=rosterCounts(roster);
      if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&verified)monthCounts.set(month,verified);
    }
  }
  const from=Math.max(saMidnight(coverage.min_date),saMidnight(schedule?.from)),to=saMidnight(coverage.max_date)+DAY;
  if((!counts&&!monthCounts.size)||!Array.isArray(approvals)||!(to>from))return {ready:false,measure:()=>null};

  const credits=new Map();
  for(const {ticket_number,approved_minutes} of approvals){
    const key=ticketKey(ticket_number);
    if(key&&Number.isFinite(approved_minutes)&&approved_minutes>0)credits.set(key,Math.max(credits.get(key)||0,approved_minutes));
  }
  const sa=records.filter(closedOutage),classRows=classificationRecords===records?sa:classificationRecords.filter(closedOutage);
  const monthClasses=new Map(),keyFor=row=>siteKey(row.site_id)+'|'+String(row.created_date||'').slice(0,7);
  for(const row of classRows){
    const category=sourceClass(row);
    if(!category||!siteKey(row.site_id))continue;
    const key=keyFor(row);
    monthClasses.set(key,monthClasses.has(key)&&monthClasses.get(key)!==category?null:category);
  }

  const daily=new Map(),empty=()=>({raw:0,approved:0,uncertain:0});
  for(const row of sa){
    const day=saMidnight(row.created_date);
    if(!(day>=from&&day<to))continue;
    const category=sourceClass(row)??monthClasses.get(keyFor(row))??null;
    const totals=daily.get(day)||{city:empty(),'non-city':empty(),unknown:0};
    daily.set(day,totals);
    const minutes=row.duration_minutes,valid=Number.isFinite(minutes)&&minutes>=0;
    const credit=valid?Math.min(minutes,credits.get(ticketKey(row.ticket_number))||0):0;
    if(!category){
      if(!valid||minutes>credit)totals.unknown++;
    }else if(!valid)totals[category].uncertain++;
    else{
      totals[category].raw+=minutes;
      totals[category].approved+=credit;
    }
  }

  return {ready:true,counts,measure(range){
    const parts=intervals(range,from,to);
    if(!parts.length)return null;
    const totals={city:empty(),'non-city':empty()},siteDays={city:0,'non-city':0};let days=0;
    for(const [start,end] of parts){
      days+=(end-start)/DAY;
      for(let day=start;day<end;day+=DAY){
        const roster=counts??monthCounts.get(new Date(day+RIYADH_OFFSET).toISOString().slice(0,7));
        if(!roster)return null;
        const sum=daily.get(day);
        for(const {key} of AVAILABILITY_CATEGORIES){
          siteDays[key]+=roster[key];
          if(!sum)continue;
          totals[key].raw+=sum[key].raw;
          totals[key].approved+=sum[key].approved;
          totals[key].uncertain+=sum[key].uncertain+sum.unknown;
        }
      }
    }
    return Object.fromEntries(AVAILABILITY_CATEGORIES.map(({key,target})=>{
      const {raw,approved,uncertain}=totals[key],scheduled=siteDays[key]*DAY_MINUTES;
      const charged=Math.max(0,raw-approved),percent=100*(1-charged/scheduled),complete=uncertain===0&&percent>=0;
      return [key,{percent:percent>=0?percent:null,complete,uncertain,sites:siteDays[key]/days,
        scheduledHours:scheduled/60,recordedHours:raw/60,downtimeHours:charged/60,approvedHours:approved/60,
        meetsTarget:complete?percent>=target:null}];
    }));
  }};
}
