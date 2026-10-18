import {num,summarize,groupBy} from './core.mjs?v=20261018weeks';
import {REPORTS,buildReport,comparisonGroups,change,DURATION_BUCKETS,durationBucket} from './analysis.mjs?v=20261018weeks';
import {comboSvg,CHART_COLORS} from './charts.mjs?v=20261018weeks';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(v,d=0)=>num(v)?v.toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d}):'N/A';
const h=v=>num(v)?n(v/60,1):'N/A';
const date=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable';
const range=s=>s.range?`${date(s.range.start)} - ${date(s.range.end)}`:'No matching calendar week';
const percentage=(value,whole)=>whole?`${n(value/whole*100,1)}%`:'N/A';
const share=(value,total)=>`${n(value)} tickets (${percentage(value,total)})`;
function movement(current,prior,label,unit=''){
  if(!num(current)||!num(prior))return `${label}: comparison unavailable.`;
  if(prior===0)return current===0?`${label} remained at zero.`:`${label} reached ${n(current,unit?1:0)}${unit} from a zero comparison baseline.`;
  const delta=change(current,prior);
  return `${label} ${delta===0?'was unchanged':delta<0?'decreased':'increased'}${delta===0?'':` by ${n(Math.abs(delta),1)}%`} against the comparison period.`;
}
const filters=[['region','Region'],['district','District'],['vendor','Vendor'],['severity','Severity'],['site_label','Site priority'],['root_cause','Root cause'],['site_id','COW'],['duration_bucket','Restoration band']];
function legend(series){return `<div class="legend">${series.map((s,i)=>`<span><i style="background:${s.color||CHART_COLORS[i]}"></i>${esc(s.name)}</span>`).join('')}</div>`;}
function plot(title,subtitle,data,{compact=false}={}){let svg=comboSvg({...data,field:undefined,lines:[]},{label:title,width:760});if(compact)svg=svg.replace('viewBox="0 0 760 365"','viewBox="0 0 760 305"').replace('height="365"','height="305"');return `<section class="chart"><div class="chart-title">${esc(title)}</div>${legend(data.series)}${svg}${data.note?`<p class="chart-note">${esc(data.note)}</p>`:''}</section>`;}
function categoryData(report,field,limit=8){
  const allGroups=comparisonGroups(report,field),groups=allGroups.slice(0,limit);
  return {labels:groups.map(g=>g.name),series:report.series.map((s,i)=>({name:s.range?.label||'Unavailable',color:CHART_COLORS[i],values:groups.map(g=>g.series[i]?.tickets??null)})),lines:[],unit:'tickets',note:allGroups.length>limit?`Top ${limit} categories by selected-period tickets; totals include all categories.`:''};
}
function summaryRows(report){return report.series.map((s,i)=>`<tr><td><b>${i===0?'Selected period':i===1?'Comparison':'Earlier comparison'}</b><small>${esc(s.range?.label||'Unavailable')}</small></td><td>${esc(range(s))}<small>${!s.covered?'Unavailable':s.partial?'Partial source coverage':'Within source date range'}</small></td><td class="number">${n(s.summary?.tickets)}</td><td class="number">${h(s.summary?.durationMinutes)}</td></tr>`).join('');}
function table(headers,rows,classes=''){return `<table class="${classes}"><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}" class="empty">No matching records in the selected period.</td></tr>`}</tbody></table>`;}
function regionTable(rows){return table(['Region','Tickets','Share','Restoration hrs','SLA'],groupBy(rows,'region').slice(0,8).map(g=>`<tr><td>${esc(g.name)}</td><td class="number">${n(g.tickets)}</td><td class="number">${percentage(g.tickets,rows.length)}</td><td class="number">${h(g.durationMinutes)}</td><td class="number">${num(g.slaCompliance)?n(g.slaCompliance,1)+'%':'N/A'}</td></tr>`));}
function dailyData(report){
  const weekly=report.definition.mode.includes('week'),span=weekly?7:report.definition.mode==='year'?12:31;
  const labels=Array.from({length:span},(_,i)=>weekly?`Day ${i+1}`:report.definition.mode==='year'?new Date(Date.UTC(2026,i,1)).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'}):String(i+1));
  const series=report.series.map((s,i)=>{
    const buckets=new Map();for(const r of s.rows){const key=weekly?Math.round((Date.parse(r.created_date)-Date.parse(s.range.start))/86400000):report.definition.mode==='year'?Number(r.created_date.slice(5,7))-1:Number(r.created_date.slice(8))-1;buckets.set(key,(buckets.get(key)||0)+1);}
    const values=labels.map((_,j)=>{if(!s.covered)return null;const start=Date.parse(s.range.start),day=weekly?new Date(start+j*86400000).toISOString().slice(0,10):report.definition.mode==='year'?s.range.start.slice(0,4)+'-'+String(j+1).padStart(2,'0')+'-01':s.range.start.slice(0,8)+String(j+1).padStart(2,'0');if(day>s.range.end||day>report.sourceCoverage.max_date)return null;return buckets.get(j)||0;});
    return {name:s.range?.label||'Unavailable',color:CHART_COLORS[i],values};
  });
  return {labels,series,lines:[],unit:'tickets'};
}
function trendSvg(data){
  const w=760,height=200,left=52,top=25,bottom=43,right=18,pw=w-left-right,ph=height-top-bottom,max=Math.max(1,...data.series.flatMap(s=>s.values).filter(num)),ceiling=Math.ceil(max/4)*4,x=i=>left+pw*i/Math.max(1,data.labels.length-1),y=v=>top+ph-v/ceiling*ph;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" role="img" aria-label="Ticket pattern within each selected period"><style>text{font-family:Arial,sans-serif;font-size:13px;fill:#786585}</style>`;
  for(let i=0;i<=4;i++){const yy=top+ph-i*ph/4;svg+=`<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#eeeaf3"/><text x="${left-12}" y="${yy+4}" text-anchor="end">${n(ceiling*i/4)}</text>`;}
  data.labels.forEach((label,i)=>{if(data.labels.length<=12||i%5===0||i===data.labels.length-1)svg+=`<text x="${x(i)}" y="${height-15}" text-anchor="middle">${esc(label)}</text>`;});
  data.series.forEach(s=>{let points=[];const flush=()=>{if(points.length){svg+=`<polyline points="${points.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;points=[];}};s.values.forEach((v,i)=>{if(num(v)){points.push(`${x(i)},${y(v)}`);svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"/>`;}else flush();});flush();});return svg+'</svg>';
}
function notesPages(notes){
  const chunks=[];for(const [label,text]of [['Management commentary',notes?.commentary],['Agreed actions',notes?.actions]]){
    if(!String(text||'').trim())continue;
    // Bound both line count and line length so long saved notes paginate fully.
    const lines=String(text).replace(/\r/g,'').split('\n').flatMap(line=>line.match(/.{1,88}(?:\s|$)|.{1,88}/g)||['']);
    for(let i=0;i<lines.length;i+=35)chunks.push(`<div class="section-kicker">REVIEW NOTES</div><h2>${label}${i?' (continued)':''}</h2><p class="notes">${esc(lines.slice(i,i+35).join('\n'))}</p>`);
  }return chunks;
}

export function createReviewReport({records,state,profiles={},meta,notes={},generatedAt=new Date(),assetBase=''}){
  const selection={...state,scope:'all'},id=REPORTS[selection.view]?selection.view:selection.reportView||'overview';
  // Search is a ticket-register selection and must match its exported scope.
  const report=buildReport(records,selection,profiles,meta,id);
  if(selection.view==='tickets'&&selection.query){
    const matches=r=>[r.ticket_number,r.site_id,r.site_name,r.root_cause,r.repair_details].some(v=>String(v||'').toLowerCase().includes(selection.query.toLowerCase()));
    report.scope=report.scope.filter(matches);report.series=report.series.map(s=>{const rows=s.rows.filter(matches);return {...s,rows,summary:s.covered?summarize(rows):null};});
    [report.now,report.prev]=report.series;report.ticketChange=change(report.now.summary?.tickets,report.prev.summary?.tickets);report.durationChange=change(report.now.summary?.durationMinutes,report.prev.summary?.durationMinutes);
  }
  const s=report.now.summary,prior=report.prev.summary,rows=report.now.rows,causes=groupBy(rows,'root_cause'),regions=groupBy(rows,'region'),sites=groupBy(rows,'site_id').filter(g=>g.name!=='Unknown'),current=s||summarize([]);
  const impact=report.definition.impact==='NSA'?'Non-service affected (NSA)':'Services affected (SA)',selectedFilters=filters.filter(([key])=>selection[key]&&selection[key]!=='all').map(([key,label])=>`${label}: ${selection[key]}`);
  if(selection.view==='tickets'&&selection.query)selectedFilters.push(`Search: ${selection.query}`);
  const generated=new Date(generatedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'});
  const coverage=!report.now.covered?'The selected period is outside the available source date range. Metrics are unavailable.':report.now.partial?`Partial period: available ${report.definition.impact} data ends ${date(report.sourceCoverage.max_date)}. Interpret period comparisons with this coverage in mind.`:`Available ${report.definition.impact} source date range: ${date(report.sourceCoverage.min_date)} - ${date(report.sourceCoverage.max_date)}.`;
  const findings=!s?['No metrics are reported for this unavailable period. Select a period within the source date range.']:s.tickets===0?['No tickets match the selected period and filters. Broaden the selection to review a wider scope.']:[
    `${n(s.tickets)} tickets were recorded across ${n(s.sites)} COW sites. ${movement(s.tickets,prior?.tickets,'Ticket volume')}`,
    `${h(s.durationMinutes)} restoration hours were recorded; mean restoration was ${h(s.mttr)} hours. ${movement(s.durationMinutes,prior?.durationMinutes,'Recorded restoration')}`,
    causes[0]?`${causes[0].name} was the leading cause with ${share(causes[0].tickets,s.tickets)}. ${regions[0]?.name||'The leading region'} recorded ${n(regions[0]?.tickets)} tickets.`:'',
    `${n(s.breached)} of ${n(s.slaEligible)} eligible records breached SLA${num(s.slaCompliance)?`, giving ${n(s.slaCompliance,1)}% compliance`:''}. ${n(s.repeatSites)} sites had two or more tickets.`
  ].filter(Boolean);
  const metric=(label,value,unit,note)=>`<div class="metric"><span>${label}</span><strong>${value}<em>${unit}</em></strong><small>${note}</small></div>`;
  const pages=[];
  pages.push(`<div class="section-kicker">PERFORMANCE REVIEW</div><h1>COW performance<br><span>${esc(report.definition.title)}</span></h1><p class="lead">${esc(report.now.range?.label||'Selected period unavailable')} <span class="dot">/</span> ${esc(impact)}</p><div class="scope-box"><b>Selected analysis scope</b><p>All recorded faults within the selected impact group, period and filters.</p><p>${esc(selectedFilters.join(' | ')||'All regions | All districts | All vendors | All severities | All site priorities | All root causes | All COW sites')}</p></div><div class="metrics">${metric('Recorded tickets',n(s?.tickets),'',s?`${n(s.sites)} COW sites`:'Unavailable period')}${metric('Restoration',h(s?.durationMinutes),'hrs',s?`${n(s.durationCount)} recorded durations`:'Unavailable period')}${metric('Mean restoration',h(s?.mttr),'hrs','Valid recorded durations')}${metric('SLA compliance',num(s?.slaCompliance)?n(s.slaCompliance,1):'N/A',num(s?.slaCompliance)?'%':'',`${n(s?.slaEligible)} eligible records`)}</div><h2>Executive assessment</h2><div class="findings">${findings.map((text,i)=>`<div><span>${String(i+1).padStart(2,'0')}</span><p>${esc(text)}</p></div>`).join('')}</div><h2>Period comparison</h2>${table(['Period','Date range','Tickets','Restoration hrs'],[summaryRows(report)],'comparison')}<p class="coverage">${esc(coverage)}</p>`);
  pages.push(`<div class="section-kicker">VOLUME & CONCENTRATION</div><h2>Drivers of ticket demand</h2><p class="intro">${esc(report.now.range?.label||'Selected period')} | Selected filters apply to all periods.</p>${plot('Leading root causes','Top eight by selected-period ticket count; all categories remain in the totals.',categoryData(report,'root_cause'))}${plot('District comparison','Top eight by selected-period ticket count.',categoryData(report,'district'))}`);
  const age=categoryData(report,'duration_bucket',DURATION_BUCKETS.length),trend=dailyData(report);
  pages.push(`<div class="section-kicker">RESTORATION & SERVICE</div><h2>Restoration profile and ticket pattern</h2><p class="intro">${esc(impact)} | ${esc(range(report.now))}</p>${plot('Restoration duration distribution','Ticket counts by recorded restoration duration, including missing values.',age,{compact:true})}<section class="chart trend"><div class="chart-title">Ticket pattern within each period</div>${legend(trend.series)}${trendSvg(trend)}</section><div class="two-col"><section><h3>Service assurance</h3>${table(['Measure','Selected period'],[['Eligible SLA records',n(s?.slaEligible)],['Recorded SLA breaches',n(s?.breached)],['Explicit SLA exclusions',n(s?.slaExcluded)],['Uncleared in source',n(s?.uncleared)]].map(([label,value])=>`<tr><td>${label}</td><td class="number">${value}</td></tr>`))}</section><section><h3>Record completeness</h3>${table(['Measure','Selected period'],[['Recorded durations',n(s?.durationCount)],['Missing durations',n(s?.missingDuration)],['Source inconsistencies',n(s?.qualityIssues)],['Repeat COW sites (2+)',n(s?.repeatSites)]].map(([label,value])=>`<tr><td>${label}</td><td class="number">${value}</td></tr>`))}</section></div><p class="coverage">Restoration totals include recorded values only. SLA uses eligible recorded outcomes. Missing outcomes are unavailable.</p>`);
  const breakdown=(field,label)=>`<section><h3>${label}</h3>${table([label,'Tickets','Restoration hrs'],groupBy(rows,field).slice(0,10).map(g=>`<tr><td>${esc(g.name)}</td><td class="number">${n(g.tickets)}</td><td class="number">${h(g.durationMinutes)}</td></tr>`))}</section>`;
  pages.push(`<div class="section-kicker">REGIONAL & OPERATIONAL PROFILE</div><h2>Where demand is concentrated</h2><p class="intro">${esc(impact)} | ${esc(report.now.range?.label||'Selected period')} | Selected filters apply.</p><h3>Regional contribution</h3>${regionTable(rows)}<div class="two-col breakdowns">${breakdown('severity','Severity')}${breakdown('site_label','Site priority')}</div><h3>Restoration exposure by cause</h3><p class="caption">Top eight causes by recorded restoration hours.</p>${table(['Root cause','Tickets','Restoration hrs','Mean hrs'],[...causes].sort((a,b)=>b.durationMinutes-a.durationMinutes).slice(0,8).map(g=>`<tr><td>${esc(g.name)}</td><td class="number">${n(g.tickets)}</td><td class="number">${h(g.durationMinutes)}</td><td class="number">${h(g.mttr)}</td></tr>`))}`);
  const orderedSites=[...sites].sort((a,b)=>b.tickets-a.tickets||b.durationMinutes-a.durationMinutes||a.name.localeCompare(b.name)),topRestoration=[...sites].sort((a,b)=>b.durationMinutes-a.durationMinutes)[0];
  const actions=rows.length?[
    causes[0]?['Leading cause',`Review ${causes[0].name} incidents (${share(causes[0].tickets,rows.length)}) and agree a corrective action with the responsible team.`]:null,
    orderedSites[0]?['Repeat faults',`Prioritize ${orderedSites[0].name} (${n(orderedSites[0].tickets)} tickets). Review recurrence across ${n(current.repeatSites)} sites with two or more tickets.`]:null,
    topRestoration?['Restoration exposure',`Review ${topRestoration.name}, the highest recorded restoration total at ${h(topRestoration.durationMinutes)} hours in this selection.`]:null,
    current.breached?['SLA follow-up',`Assign follow-up for ${n(current.breached)} recorded SLA breaches and confirm corrective actions.`]:['Service assurance','Maintain review of restoration outcomes and record evidence for completed incidents.'],
    current.missingDuration||current.qualityIssues?['Record completion',`Validate ${n(current.missingDuration)} missing durations and ${n(current.qualityIssues)} records flagged for source inconsistencies.`]:null
  ].filter(Boolean):[['Next review','Select a period and filters with available records to identify operational priorities.']];
  pages.push(`<div class="section-kicker">OPERATIONAL PRIORITIES</div><h2>COW focus and recommended follow-up</h2><p class="intro">Priorities derived from the selected analysis scope.</p><h3>Leading COW sites</h3><p class="caption">Top eight by ticket count; restoration hours break ties.</p>${table(['COW site','Region / district','Tickets','Restoration hrs','SLA breaches'],orderedSites.slice(0,8).map(g=>`<tr><td><b>${esc(g.name)}</b></td><td class="location">${esc(g.rows[0].region||'Unknown')}<small>${esc(g.rows[0].district||'Unknown')}</small></td><td class="number">${n(g.tickets)}</td><td class="number">${h(g.durationMinutes)}</td><td class="number">${n(g.breached)}</td></tr>`))}<h3 class="priority-heading">Recommended follow-up</h3><div class="actions">${actions.map(([title,body],i)=>`<article><span>${String(i+1).padStart(2,'0')}</span><div><b>${esc(title)}</b><p>${esc(body)}</p></div></article>`).join('')}</div><div class="report-end"><b>Review context</b><p>${esc(report.definition.title)} | ${esc(report.now.range?.label||'Unavailable')} | ${esc(selectedFilters.join(' | ')||'All geographic and operational filters')}</p><p>${esc(coverage)}</p></div>`);
  pages.push(...notesPages(notes));
  const safeLabel=(report.now.range?.label||selection.period||'review').replace(/[^a-z0-9-]+/gi,'-').replace(/-$/,'');
  const filename=`stc-COW-${id}-${safeLabel}.pdf`,image=name=>esc(new URL('assets/'+name,assetBase||'https://invalid.local/').href);
  const header=`<header><div class="brand"><img class="stc" src="${image('stc-logo.png')}" alt="stc"><span>COW OPERATIONS<br><b>Performance analysis</b></span></div><div class="provider"><span>Prepared by</span><img src="${image('aces-managed-services-logo.png')}" alt="ACES Managed Services"></div></header>`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(filename.replace('.pdf',''))}</title><style>${REPORT_CSS}</style></head><body>${pages.map((body,i)=>`<section class="report-page${i===4?' focus-page':''}">${header}<main>${body}</main><footer><span>stc COW | ${esc(report.definition.title)} | ${esc(report.now.range?.label||'Unavailable')}</span><span>${i+1} / ${pages.length}</span><small>Generated ${esc(generated)} AST</small></footer></section>`).join('')}</body></html>`;
  return {html,filename,report,pageCount:pages.length,selectedFilters};
}

export async function printAnalysisReport(options){
  const result=createReviewReport({...options,assetBase:new URL('.',document.baseURI).href}),frame=document.createElement('iframe');
  frame.title='Performance review PDF';frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0;';
  // A detached report document prevents dashboard navigation or filter changes
  // while the browser opens its native PDF destination dialog.
  const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('The report could not be prepared. Please try again.')),15000);frame.onload=()=>{clearTimeout(timer);resolve();};});
  frame.srcdoc=result.html;document.body.append(frame);
  try{
    await loaded;const doc=frame.contentDocument;
    await Promise.all([...doc.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;})));
    if(doc.fonts?.ready)await doc.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
    frame.contentWindow.focus();frame.contentWindow.print();
    // Keep the frame through asynchronous print dialogs (including Safari).
    setTimeout(()=>frame.remove(),300000)?.unref?.();
    return result.filename;
  }catch(error){frame.remove();throw error;}
}

export const REPORT_CSS=`
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:#33263f;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-page{position:relative;width:210mm;height:297mm;padding:12mm 15mm 20mm;background:#fff;break-after:page;page-break-after:always}.report-page:last-child{break-after:auto;page-break-after:auto}
header{height:20mm;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e9e1ef;padding-bottom:4mm;margin-bottom:7mm}.brand,.provider{display:flex;align-items:center}.brand{gap:12px}.brand .stc{width:58px;height:32px;object-fit:contain;background:#4f008c;border-radius:6px;padding:5px}.brand span{font-size:8px;letter-spacing:1.2px;color:#806d90}.brand b{font-size:11px;letter-spacing:.15px;color:#4f008c}.provider{gap:10px}.provider span{white-space:nowrap;font-size:8px;color:#8c7a99}.provider img{background:#4f008c;border-radius:5px;width:108px;height:43px;object-fit:cover}
.section-kicker{color:#ff375e;font-weight:700;font-size:9px;letter-spacing:2px;margin-bottom:7px}h1{font-size:32px;line-height:1.16;color:#4f008c;letter-spacing:-1px;margin:0 0 8px}h1 span{font-size:23px;letter-spacing:-.5px}h2{font-size:17px;line-height:1.25;color:#4f008c;margin:0 0 10px}h3{font-size:12px;color:#4f008c;margin:10px 0 7px}.lead{font-size:12px;color:#796586;margin:0 0 15px}.dot{color:#ff375e;padding:0 9px}.intro{font-size:10px;color:#806f8e;margin:0 0 13px}
.scope-box{padding:11px 13px;background:#f6f2fa;border-left:3px solid #4f008c;margin:0 0 14px;overflow-wrap:anywhere}.scope-box b{font-size:10px;color:#4f008c}.scope-box p{margin:4px 0;font-size:9px}.metrics{display:flex;margin:0 0 19px;border:1px solid #e9e1ef;border-radius:7px}.metric{width:25%;padding:12px 11px;min-width:0;border-right:1px solid #e9e1ef}.metric:last-child{border:0}.metric span{display:block;font-size:9px;color:#806d90}.metric strong{display:block;font-size:25px;line-height:1.3;color:#4f008c;margin:5px 0}.metric em{font-style:normal;font-size:10px;margin-left:4px}.metric small{display:block;font-size:8px;color:#897597}
.findings{margin:0 0 18px}.findings>div{display:flex;gap:11px;border-bottom:1px solid #f0eaf4;padding:7px 0}.findings>div>span{font-size:10px;font-weight:700;color:#ff375e;min-width:18px}.findings p{margin:0;font-size:11px;line-height:1.6}
table{width:100%;border-collapse:collapse;table-layout:auto;font-size:10.5px}thead{display:table-header-group}th{text-align:left;background:#f4eff8;color:#4f008c;font-size:8px;font-weight:700;padding:7px 8px;white-space:nowrap}td{padding:7px 8px;border-bottom:1px solid #eee8f3;vertical-align:top;overflow-wrap:anywhere}td.number{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}small{display:block;color:#8b7797;font-size:8px;font-weight:normal}td small{margin-top:2px}.comparison td{font-size:10px}.coverage{font-size:8px;color:#8c7798;line-height:1.6;margin:11px 0 0;padding-left:9px;border-left:2px solid #ff375e}.empty{padding:20px;text-align:center;color:#8b7797}
.chart{border:1px solid #ece5f2;border-radius:7px;padding:12px 12px 3px;margin:0 0 13px;break-inside:avoid}.chart-note{font-size:8px;color:#887095;margin:5px 0 7px}.chart-title{font-size:12px;font-weight:700;color:#4f008c}.caption{margin:3px 0 6px;color:#887095;font-size:8px}.legend{display:flex;gap:13px;flex-wrap:wrap;margin:5px 0 3px;font-size:8px;color:#80698e}.legend span{white-space:nowrap;flex:none;display:inline-flex;align-items:center;gap:5px}.legend i{flex:none;min-width:7px;display:inline-block;width:7px;height:7px;border-radius:2px}.chart>svg{display:block;width:100%;height:auto}.trend>svg{margin-top:10px}.two-col{display:flex;gap:18px}.two-col>section{width:50%}.two-col td{padding:5px 8px}.location{max-width:175px}.priority-heading{margin-top:22px}.actions article{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid #ede5f2}.actions article>span{color:#ff375e;font-size:13px;font-weight:700;min-width:20px}.actions b{color:#4f008c;font-size:10px}.actions p{margin:3px 0 0;font-size:11px;line-height:1.6}.report-end{margin-top:18px;background:#f7f3fa;border-radius:6px;padding:12px;font-size:9px}.report-end b{color:#4f008c}.report-end p{margin:5px 0;overflow-wrap:anywhere}.notes{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.8}
footer{position:absolute;left:15mm;right:15mm;bottom:9mm;border-top:1px solid #e9e1ef;padding-top:7px;display:flex;justify-content:space-between;font-size:8px;color:#7e698d}footer small{position:absolute;left:0;top:23px;font-size:7px;color:#9a87a6}
.focus-page td{padding:5px 8px}.focus-page .actions article{padding:8px 0}.focus-page .report-end{margin-top:12px}
@media screen{body{background:#eee8f3}.report-page{margin:14px auto;box-shadow:0 4px 20px #33263f20}}
`;
