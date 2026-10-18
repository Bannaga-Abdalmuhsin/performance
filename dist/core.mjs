export const FIELDS = ['id','ticket_number','site_id','site_name','region','district','city','vendor','severity','service_impact','site_label','created_at','created_date','cleared_at','referred_at','impact_start','impact_finish','duration_minutes','sla_minutes','sla_breached','sla_excluded','exclusion_reason','parent_tt','root_cause','repair_details','cleared_group','source_row','quality_flags','source_key','restoration_days','duration_text','duration_dax_minutes'];
export const IMPORT_FIELDS = [...FIELDS,'source_data','deduplication'];
export const DEDUPLICATION_POLICY = 'ticket-richest-v1';
const technicalFields=new Set(['#','id','source_key','source_row','source_data','deduplication','quality_flags','import_id','updated_at']);
const cellError=/^#(?:ERR|REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/i;
export function rowRichness(row) {
  const values=Object.entries(row).filter(([k])=>!technicalFields.has(k)).map(([,v])=>v).filter(v=>v!==null&&v!==undefined&&typeof v!=='object'&&!cellError.test(String(v))&&!['','na','n/a','null','none','nan','-'].includes(String(v).trim().toLowerCase()));
  return {populated_fields:values.length,text_characters:values.reduce((n,v)=>n+(typeof v==='string'?[...v.trim()].length:0),0)};
}
export const num = (v) => typeof v === 'number' && Number.isFinite(v);
export const sum = (xs) => xs.reduce((a,b)=>a+(num(b)?b:0),0);
export const monthOf = (r) => r.created_date?.slice(0,7);
export const previousMonth = (m, offset=-1) => { const [y,n]=m.split('-').map(Number); return new Date(Date.UTC(y,n-1+offset,1)).toISOString().slice(0,7); };
export function percentageChange(current, previous) { return !num(current)||!num(previous)||previous===0 ? null : (current-previous)/previous*100; }
export function scopeFilter(records, filters={}, profile={}) {
  const excluded=new Set((profile.excluded_root_causes||[]).map(s=>s.trim().toLowerCase()));
  return records.filter(r=>{
    if(filters.scope==='powerbi' && (r.parent_tt || excluded.has((r.root_cause||'').trim().toLowerCase()))) return false;
    for(const field of ['region','district','vendor','severity','service_impact','site_label','root_cause','site_id']) {
      if(filters[field] && filters[field]!=='all' && r[field]!==filters[field]) return false;
    }
    if(filters.period && monthOf(r)!==filters.period) return false;
    if(filters.duration_bucket && filters.duration_bucket!=='all'){const v=r.duration_minutes,b=!num(v)?'Missing':v>=1440?'>24hrs':v>=480?'08-24hrs':v>=240?'04-08hrs':v>=120?'02-04hrs':'<2hrs';if(b!==filters.duration_bucket)return false;}
    if(filters.query) {
      const q=filters.query.toLowerCase();
      if(![r.ticket_number,r.site_id,r.site_name,r.root_cause,r.repair_details].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    }
    return true;
  });
}
export function summarize(records) {
  const durations=records.map(r=>r.duration_minutes).filter(num);
  const sla=records.filter(r=>typeof r.sla_breached==='boolean'&&!r.sla_excluded);
  const breached=sla.filter(r=>r.sla_breached).length;
  const sites=new Map();
  for(const r of records) if(r.site_id) sites.set(r.site_id,(sites.get(r.site_id)||0)+1);
  const validImpact=records.filter(r=>r.impact_start&&r.impact_finish&&r.impact_finish>=r.impact_start);
  return { tickets:records.length, distinctTickets:new Set(records.map(r=>r.ticket_number)).size, rows:records.length,
    durationMinutes:sum(durations), durationCount:durations.length,
    mttr:durations.length?sum(durations)/durations.length:null,
    sites:sites.size, repeatSites:[...sites.values()].filter(n=>n>=2).length,
    breached, slaEligible:sla.length, slaCompliance:sla.length?(sla.length-breached)/sla.length*100:null,
    slaExcluded:records.filter(r=>r.sla_excluded).length,
    uncleared:records.filter(r=>!r.cleared_at).length,
    impactMinutes:validImpact.length?sum(validImpact.map(r=>(Date.parse(r.impact_finish)-Date.parse(r.impact_start))/60000)):null,
    impactCount:validImpact.length,
    missingDuration:records.length-durations.length,
    qualityIssues:records.filter(r=>r.quality_flags?.length).length,
  };
}
export function groupBy(records, field) {
  const groups=new Map();
  for(const r of records) { const key=r[field]||'Unknown'; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r); }
  return [...groups].map(([name,rows])=>({name,...summarize(rows),rows})).sort((a,b)=>b.tickets-a.tickets||a.name.localeCompare(b.name));
}
export function monthlyTrend(records, period, meta, count=12) {
  const buckets=new Map(); for(const r of records) { const m=monthOf(r); if(!buckets.has(m))buckets.set(m,[]);buckets.get(m).push(r); }
  return Array.from({length:count},(_,i)=>{
    const month=previousMonth(period,i-count+1),covered=month>=meta.min_date?.slice(0,7)&&month<=meta.max_date?.slice(0,7);
    return {month,covered,...(covered?summarize(buckets.get(month)||[]):{tickets:null,durationMinutes:null,mttr:null,slaCompliance:null})};
  });
}
export function coverageFor(meta, month) { return month>=meta.min_date?.slice(0,7)&&month<=meta.max_date?.slice(0,7); }
export function csvEscape(v) {
  let s=v===null||v===undefined?'':Array.isArray(v)?v.join('; '):String(v);
  if(/^\s*[=+@\-\t\r]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function exportCSV(records, fields=FIELDS) { return '\uFEFF'+[fields.map(csvEscape).join(','),...records.map(r=>fields.map(k=>csvEscape(r[k])).join(','))].join('\r\n'); }
export function parseCSV(text) {
  text=text.replace(/^\uFEFF/,''); const first=text.split(/\r?\n/,1)[0];
  const delim=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const rows=[]; let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote; }
    else if(c===delim&&!quote) {row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote) {if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quote)throw new Error('CSV contains an unclosed quoted field.');
  if(cell||row.length){row.push(cell);rows.push(row);}
  if(!rows.length)throw new Error('CSV is empty.');
  const headers=rows.shift().map(s=>s.trim());
  if(new Set(headers).size!==headers.length)throw new Error('CSV contains duplicate column headers.');
  return rows.map((values,i)=>{
    if(values.length!==headers.length)throw new Error(`CSV row ${i+2} has ${values.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h,j)=>[h,values[j]]));
  });
}
export function normalizeRecords(input) {
  const aliases={'Ticket Number':'ticket_number','SiteID':'site_id','SiteName':'site_name','Region':'region','District':'district','City':'city','Vendor':'vendor','Severity':'severity','Service Impacted':'service_impact','Site Label':'site_label','Create Date':'created_at','Cleared Date':'cleared_at','First Referred to ACES':'referred_at','Service Impact Start':'impact_start','Service Impact Finish':'impact_finish','Parent TT':'parent_tt','Root Cause Details':'root_cause','RepairDetails':'repair_details','Cleared Group':'cleared_group','Exclusions':'exclusion_reason'};
  const number=(x)=>x===''||x===null||x===undefined?null:Number.isFinite(Number(x))?Number(x):null;
  const bool=(x)=>[true,'true','yes','Yes','YES'].includes(x)?true:[false,'false','no','No','NO'].includes(x)?false:null;
  const clean=(x)=>x===null||x===undefined||cellError.test(String(x))?null:String(x).trim()||null;
  const date=(x)=>{
    if(!clean(x))return null;
    if(number(x)>30000&&number(x)<80000)return new Date(Date.UTC(1899,11,30)+Math.round(Number(x)*86400)*1000).toISOString().slice(0,19)+'+03:00';
    let s=String(x).trim();const us=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:[ T](\d{1,2}):(\d\d)(?::(\d\d))?)?$/);if(us)s=`20${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}T${(us[4]||'00').padStart(2,'0')}:${us[5]||'00'}:${us[6]||'00'}+03:00`;const d=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d\d:\d\d(?::\d\d)?))?$/);
    const value=d?`${d[3]}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}T${d[4]||'00:00:00'}${d[4]?.length===5?':00':''}+03:00`:s.length===10?s+'T00:00:00+03:00':s.replace(' ','T')+(/(Z|[+-]\d\d:\d\d)$/.test(s)?'':'+03:00');
    const [yy,mm,dd]=value.slice(0,10).split('-').map(Number);
    if(!yy||!mm||!dd||new Date(Date.UTC(yy,mm-1,dd)).toISOString().slice(0,10)!==value.slice(0,10))return null;
    return Number.isNaN(Date.parse(value))?null:value;
  };
  const groups=new Map(),rejected=[];
  input.forEach((r,i)=>{
    const copy=Object.fromEntries(Object.entries(r).map(([k,v])=>[k.trim(),v])); for(const [from,to]of Object.entries(aliases))if(copy[to]===undefined&&copy[from]!==undefined)copy[to]=copy[from];
    let sourceData=copy.source_data;if(typeof sourceData==='string'){try{sourceData=JSON.parse(sourceData)}catch{sourceData=null}}
    if(!sourceData||typeof sourceData!=='object'||Array.isArray(sourceData))sourceData=Object.fromEntries(Object.entries(r).filter(([k])=>!technicalFields.has(k)));
    const sourceRow=number(copy.source_row)||i+2,ticket=clean(copy.ticket_number)?.replace(/\s+/g,'').toUpperCase(),site=clean(copy.site_id),created=date(copy.created_at)||date(copy.created_date);
    if(!ticket||! /^(PR|PMR|TT)\d+$/.test(ticket)||!created){rejected.push({row:sourceRow,ticket_number:clean(copy.ticket_number),reason:!ticket?'Missing ticket number':!/^(PR|PMR|TT)\d+$/.test(ticket)?'Invalid ticket number (expected PR, PMR or TT followed by digits)':'Missing or invalid create date',source_data:sourceData});return;}
    const rawDays=number(copy.restoration_days)??number(copy['RestorationTime HHMMSS']),days=rawDays!==null&&rawDays>=0?rawDays:null;
    const duration=days!==null?days*1440:number(copy.duration_minutes)??(number(copy['RestorationTime HHMMSS'])!==null?number(copy['RestorationTime HHMMSS'])*1440:null);
    let flags=copy.quality_flags||[]; if(typeof flags==='string'){try{flags=JSON.parse(flags)}catch{flags=[flags]}}
    if(!Array.isArray(flags))flags=[];else flags=[...flags];
    if(num(duration)&&duration<0)flags.push('Negative duration rejected');
    if(rawDays!==null&&rawDays<0)flags.push('Negative restoration days rejected');
    for(const [k,v]of Object.entries(sourceData))if(cellError.test(String(v)))flags.push('Source cell error: '+k);
    const sourceKey=ticket;
    const record=Object.fromEntries(FIELDS.map(k=>[k,clean(copy[k])]));
    Object.assign(record,{id:'pbi:'+sourceKey,source_key:sourceKey,restoration_days:days,duration_text:clean(copy.duration_text??copy['RestorationTime DDHHMMSS']),duration_dax_minutes:number(copy.duration_dax_minutes),ticket_number:ticket,site_id:site,created_at:created,created_date:new Date(Date.parse(created)+3*3600000).toISOString().slice(0,10),cleared_at:date(copy.cleared_at),referred_at:date(copy.referred_at),impact_start:date(copy.impact_start),impact_finish:date(copy.impact_finish),duration_minutes:num(duration)&&duration>=0?duration:null,sla_minutes:number(copy.sla_minutes)??(number(copy['SLA Time'])!==null?number(copy['SLA Time'])*1440:null),sla_breached:bool(copy.sla_breached??copy['Exceed SLA']),sla_excluded:bool(copy.sla_excluded)??['exclude','excluded'].includes(String(copy['SLA (Include / Excluded)']||'').toLowerCase()),source_row:sourceRow,quality_flags:flags,source_data:sourceData,deduplication:copy.deduplication||null});
    if(record.sla_minutes!==null&&record.sla_minutes<0){record.sla_minutes=null;flags.push('Negative SLA allowance rejected');}
    if(record.cleared_at&&Date.parse(record.cleared_at)<Date.parse(created))flags.push('Cleared before create date');
    if(record.cleared_at&&record.referred_at&&Date.parse(record.cleared_at)<Date.parse(record.referred_at))flags.push('Cleared before referral');
    if(num(record.duration_minutes)&&record.cleared_at&&Math.abs(record.duration_minutes-(Date.parse(record.cleared_at)-Date.parse(created))/60000)>1/30)flags.push('Recorded duration differs from create-to-clear');
    record.quality_flags=[...new Set(flags)];
    for(const k of ['region','district'])record[k]=(record[k]||'Unknown').toLowerCase().replace(/\b\w/g,s=>s.toUpperCase());
    record.service_impact=({no:'No impact','no impact':'No impact',outage:'Outage',degraded:'Degraded'})[(record.service_impact||'').toLowerCase()]||'Unknown';
    for(const k of ['root_cause','vendor','severity','site_label'])record[k]||='Unknown';
    // One original row per ticket. Compare original business fields before
    // aliases/defaults; zero/false count as data, empty/error cells do not.
    const key=ticket,existing=groups.get(key),score=rowRichness(sourceData),candidate={record,score};
    if(!existing)groups.set(key,{...candidate,candidates:[candidate]});
    else{existing.candidates.push(candidate);if(score.populated_fields>existing.score.populated_fields||(score.populated_fields===existing.score.populated_fields&&score.text_characters>existing.score.text_characters)){existing.record=record;existing.score=score;}}
  });
  for(const group of groups.values())if(group.candidates.length>1)group.record.deduplication={policy:DEDUPLICATION_POLICY,kept:{row:group.record.source_row,...group.score},removed:group.candidates.filter(c=>c.record!==group.record).map(c=>({row:c.record.source_row,...c.score}))};
  return {records:[...groups.values()].map(x=>x.record),rejected,duplicates:input.length-rejected.length-groups.size};
}
