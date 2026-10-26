import {groupBy} from './core.mjs?v=20261026all';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=value=>value.toLocaleString('en-US');
const regions={central:'CR',east:'ER',eastern:'ER',west:'WR',western:'WR',south:'SR',southern:'SR',north:'NR',northern:'NR'};
const regionCode=value=>regions[String(value??'').trim().toLowerCase()]||String(value||'Unknown').trim();
const date=value=>new Date(value+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});

function periodTitle(report){
  const range=report.now.range,prefix=report.definition.impact==='NSA'?'NSA tickets':'Outages';
  if(!range)return prefix+' · Period unavailable';
  if(range.allYears&&range.week)return `${prefix} Week #${range.week} · All years (${range.firstYear}–${range.lastYear})`;
  if(range.custom)return `${prefix} · ${date(range.start)} – ${date(range.end)}`;
  if(range.week)return `${prefix} Week #${range.week} · ${date(range.start)} – ${date(range.end)}`;
  return `${prefix} · ${range.label} · ${date(range.start)} – ${date(range.end)}`;
}

export function cowPerformanceData(report,{records=report.now.rows,query='',sort='tickets',dir=-1}={}){
  let rows=groupBy(records,'site_id').filter(g=>g.name.trim()&&g.name.trim().toLowerCase()!=='unknown').map(g=>{
    const regionNames=[...new Set(g.rows.map(r=>r.region||'Unknown'))],causes=groupBy(g.rows,'root_cause').map(c=>c.name);
    return {...g,site_id:g.name,region:regionNames.map(regionCode).join(' / '),regionNames:regionNames.join(' '),district:[...new Set(g.rows.map(r=>r.district||''))].join(' '),rootCause:causes.join(' / '),breachOutcome:g.breached>0?'Yes':g.slaUnrecorded>0?'Unrecorded':'No'};
  });
  const total=rows.length,needle=query.trim().toLowerCase();
  if(needle)rows=rows.filter(g=>[g.name,g.region,g.regionNames,g.district,g.rootCause,...g.rows.map(r=>r.site_name)].some(v=>String(v||'').toLowerCase().includes(needle)));
  const key=['name','region','tickets','rootCause','breached','durationMinutes'].includes(sort)?sort:'tickets';
  rows.sort((a,b)=>{const x=a[key],y=b[key];return (typeof x==='number'?x-y:String(x??'').localeCompare(String(y??'')))*(dir===1?1:-1)||a.name.localeCompare(b.name);});
  return {title:periodTitle(report),total,rows,labels:rows.map(r=>r.name),series:[],lines:[],columns:[['COW ID','name'],['Region','region'],[report.definition.impact==='NSA'?'Tickets Counts':'Outages Counts','tickets'],['Root Cause','rootCause'],['Breaches SLA','breached']]};
}

export function renderCowPerformanceTable(data,{sortHeader,sort,dir}={}){
  return `<div class="data-table-wrap cow-performance-wrap"><table class="cow-performance-table"><caption>${esc(data.title)}</caption><thead><tr>${data.columns.map(([label,key])=>`<th scope="col"${key===sort?` aria-sort="${dir===1?'ascending':'descending'}"`:''}>${sortHeader?sortHeader(label,key):esc(label)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr><td><button class="cow-id-link" data-site="${esc(row.name)}">${esc(row.name)}</button></td><td>${esc(row.region)}</td><td>${count(row.tickets)}</td><td>${esc(row.rootCause)}</td><td>${row.breachOutcome}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No matching COWs.</td></tr>'}</tbody></table></div>`;
}

function wrap(value,limit){
  const lines=[];let line='';
  for(const word of String(value).split(/\s+/))for(const chunk of word.match(new RegExp(`.{1,${limit}}`,'g'))||['']){
    if(line&&(line+' '+chunk).length>limit){lines.push(line);line=chunk;}else line=(line+' '+chunk).trim();
  }
  if(line)lines.push(line);return lines.length?lines:[''];
}
const widths=[160,135,195,420,190],limits=[13,10,16,39,16];
function rowCells(row){return [row.name,row.region,count(row.tickets),row.rootCause,row.breachOutcome].map((v,i)=>wrap(v,limits[i]));}
const rowHeight=row=>Math.max(36,Math.max(...rowCells(row).map(lines=>lines.length))*22+14);

export function cowPerformanceSvg(data){
  const width=1100,top=80,height=top+(data.rows.length?data.rows.reduce((sum,row)=>sum+rowHeight(row),0):50)+1;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(data.title)}"><style>text{font-family:Inter,Segoe UI,Arial,sans-serif;font-size:18px;fill:#221b26}.cow-heading{fill:white;font-weight:650}.cow-rule{stroke:#63566d;stroke-width:1}</style><rect width="${width}" height="${height}" fill="white"/><rect width="${width}" height="38" fill="#f10d20"/><text class="cow-heading" x="550" y="25" text-anchor="middle">${esc(data.title)}</text>`;
  let x=0;
  data.columns.forEach(([label],i)=>{svg+=`<rect class="cow-rule" x="${x}" y="38" width="${widths[i]}" height="42" fill="#7030a0"/><text class="cow-heading" x="${x+widths[i]/2}" y="65" text-anchor="middle">${esc(label)}</text>`;x+=widths[i];});
  let y=top;
  for(const [index,row]of data.rows.entries()){
    const cells=rowCells(row),h=rowHeight(row);x=0;
    cells.forEach((lines,i)=>{svg+=`<rect class="cow-rule" x="${x}" y="${y}" width="${widths[i]}" height="${h}" fill="${index%2?'#fbf8ff':'white'}"/><text x="${x+widths[i]/2}" y="${y+h/2-(lines.length-1)*11+6}" text-anchor="middle">${lines.map((line,j)=>`<tspan x="${x+widths[i]/2}" dy="${j?22:0}">${esc(line)}</tspan>`).join('')}</text>`;x+=widths[i];});
    y+=h;
  }
  if(!data.rows.length)svg+=`<rect class="cow-rule" x="0" y="80" width="1100" height="50" fill="white"/><text x="550" y="111" text-anchor="middle">No matching COWs.</text>`;
  return svg+'</svg>';
}

export function cowPerformanceChart(report,options){
  const data=cowPerformanceData(report,options);
  return {id:report.id+'-cow-performance-table',title:'COW performance table',data,svg:cowPerformanceSvg(data),kind:'table',showLegend:false};
}

export function cowPerformanceParts(chart,{maxRows=12,maxHeight=600}={}){
  const chunks=[];let rows=[],height=80,startIndex=0;
  const add=()=>{chunks.push({rows,startIndex});startIndex+=rows.length;rows=[];height=80;};
  for(const row of chart.data.rows){const h=rowHeight(row);if(rows.length&&(rows.length>=maxRows||height+h>maxHeight))add();rows.push(row);height+=h;}
  if(rows.length||!chunks.length)add();
  return chunks.map((chunk,i)=>{const data={...chart.data,rows:chunk.rows,labels:chunk.rows.map(row=>row.name)};return {...chart,data,svg:cowPerformanceSvg(data),title:chart.title+(chunks.length>1?` (${i+1}/${chunks.length})`:''),part:i+1,partCount:chunks.length,startIndex:chunk.startIndex};});
}
