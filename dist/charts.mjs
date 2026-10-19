import {num,summarize} from './core.mjs?v=20261019pdf';
import {comparisonGroups,change,durationBucket,monthRange,DURATION_BUCKETS} from './analysis.mjs?v=20261019pdf';

export const CHART_COLORS=['#4f008c','#ff375e','#b5a0c9'];
const TEAL='#00a39b',AMBER='#d99a25',GRID='#eeeaf3',INK='#34233f',MUTED='#92849c';
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const attr=v=>esc(v).replaceAll('\n','&#10;');
const n=(v,d=0)=>num(v)?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const compact=v=>num(v)?Math.abs(v)>=1000?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(v):n(v,Math.abs(v)>0&&Math.abs(v)<1?2:Number.isInteger(v)?0:1):'—';
const pct=v=>num(v)?`${v>0?'+':''}${n(v,1)}%`:'—';
const hours=v=>num(v)?n(v/60,1):'—';
const monthLabel=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'});
const seriesName=s=>s.range?.label||'Outside coverage';
const DAY=86400000;
const drill={root_cause:'cause',region:'region',district:'district',site_label:'priority',severity:'severity',duration_bucket:'duration'};

// Mirrors the saved visual types. YoY is a new page using the same chart family.
export const CHART_PLANS={
  'weekly-sa':{periods:2,area:true,funnel:true,annualDuration:true,label:true,severity:true,root:'combo',district:'combo',duration:'bar',changeKpi:true},
  'weekly-nsa':{periods:3,area:true,funnel:true,label:true,severity:true,root:'combo',district:'bar',duration:'severity-bar',changeKpi:true},
  overview:{periods:2,area:true,funnel:true,label:true,root:'combo',district:'combo',duration:'combo',changeKpi:true},
  'mom-y':{periods:3,label:true,root:'combo',district:'combo',duration:'combo'},
  'wow-y':{periods:3,label:true,severity:true,root:'combo',district:'combo',duration:'combo'},
  yoy:{periods:3,label:true,severity:true,annualTickets:true,annualDuration:true,root:'combo',district:'combo',duration:'combo'}
};

export function countScale(values){
  const maximum=Math.max(0,...values.filter(num));
  const raw=Math.max(1,maximum/4),power=10**Math.floor(Math.log10(raw));
  const step=[1,2,2.5,5,10].find(v=>v*power>=raw)*power;
  const integerStep=Math.max(1,Math.ceil(step));
  return {min:0,max:integerStep*4,step:integerStep};
}
export function percentScale(values){
  const valid=values.filter(num);let lo=Math.min(0,...valid),hi=Math.max(0,...valid);
  if(lo===hi){lo=-10;hi=10;}
  const raw=(hi-lo)/4,power=10**Math.floor(Math.log10(raw));
  const step=[1,2,2.5,5,10].find(v=>v*power>=raw)*power;
  return {min:Math.floor(lo/step)*step,max:Math.ceil(hi/step)*step};
}
function svgStart(w,h,label){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${attr(label)}"><style>text{font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;fill:${MUTED}}.bi-value{font-size:12px;font-weight:600;fill:#5e456e}.bi-category{font-size:13px;fill:#786585}.bi-axis-title{font-size:12px;letter-spacing:.5px;fill:#9b8ba5}.bi-point{transition:opacity .12s}.bi-drill:focus{outline:none}.bi-drill:focus rect,.bi-drill:hover rect{opacity:.8}.bi-drill:hover .bi-category,.bi-drill:focus .bi-category{fill:#4f008c;font-weight:600}</style>`;}
function emptySvg(label){return svgStart(760,300,label)+`<rect x="55" y="40" width="650" height="200" rx="12" fill="#fcfafd"/><text x="380" y="137" text-anchor="middle" style="font-size:16px;fill:#8a7798">No matching records in this period</text><text x="380" y="164" text-anchor="middle" style="font-size:12px">Adjust the period or selected filters</text></svg>`;}
function wrap(text,width=13,lines=3){
  const result=[];let current='';
  for(const word of String(text).split(/\s+/)){
    const chunks=word.length>width?word.match(new RegExp(`.{1,${width}}`,'g')):[word];
    for(const chunk of chunks){if((current+' '+chunk).trim().length>width){if(current)result.push(current);current=chunk;}else current=(current+' '+chunk).trim();}
  }
  if(current)result.push(current);if(result.length>lines){result.length=lines;result[lines-1]=result[lines-1].replace(/.$/,'…');}return result;
}
function labelText(name,x,y,width=13,lines=3){return `<text class="bi-category" x="${x}" y="${y}" text-anchor="middle">${wrap(name,width,lines).map((line,i)=>`<tspan x="${x}" dy="${i?17:0}">${esc(line)}</tspan>`).join('')}</text>`;}
function anchor(field,name,content,tip){return field&&drill[field]?`<a class="bi-drill" href="#tickets" data-${drill[field]}="${attr(name)}" data-tip="${attr(tip)}" aria-label="${attr(tip+'; select to inspect records')}"><title>${esc(tip)}</title>${content}</a>`:`<g data-tip="${attr(tip)}"><title>${esc(tip)}</title>${content}</g>`;}
function segmented(values,x,y){
  const result=[];let points=[];
  values.forEach((v,i)=>{if(num(v))points.push([x(i),y(v),v,i]);else if(points.length){result.push(points);points=[];}});
  if(points.length)result.push(points);return result;
}
function legend(series,lines=[]){return `<div class="bi-legend">${series.map((s,i)=>`<span><i style="background:${s.color||CHART_COLORS[i]}"></i>${esc(s.name)}</span>`).join('')}${lines.map(l=>`<span><i class="line" style="--legend-color:${l.color}"></i>${esc(l.name)}</span>`).join('')}</div>`;}
function tools(){return '<div class="bi-tools"><button class="bi-tool" data-action="chart-download" title="Download chart as SVG" aria-label="Download chart as SVG"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg></button><button class="bi-tool" data-action="chart-expand" title="Expand chart" aria-label="Expand chart"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button></div>';}
function panel({id,title,data,svg,kind='combo',className='',legendLines=true,showLegend=true,scrollHeight,fit=false}){
  const wide=!fit&&kind==='combo'&&data.labels.length>8;
  const scrollStyle=[scrollHeight?`max-height:${scrollHeight}px`:null,wide?`--chart-wide-width:${Math.max(760,data.labels.length*92+145)}px`:null].filter(Boolean).join(';');
  return `<section class="panel bi-panel ${className}" data-chart-id="${id}" data-chart-kind="${kind}"><div class="panel-title"><div><h2>${esc(title)}</h2></div>${tools()}</div>${showLegend?legend(data.series,legendLines?data.lines||[]:[]):''}<div class="bi-scroll ${wide?'bi-wide':''}"${scrollStyle?` style="${scrollStyle}"`:''}>${svg}</div></section>`;
}
function groupTip(data,index){return `${data.labels[index]}\n${data.series.map(s=>`${s.name}: ${n(s.values[index],data.unit==='hours'?1:0)}${data.unit==='hours'?' hrs':' tickets'}`).join('\n')}${data.lines?.length?'\n'+data.lines.map(l=>l.name+': '+pct(l.values[index])).join('\n'):''}`;}

export function comparisonData(report,field){
  const plan=CHART_PLANS[report.id],groups=comparisonGroups(report,field),periods=plan.periods;
  const lines=[{name:'Ticket change',color:TEAL,values:groups.map(g=>g.ticketChange)}];
  if(report.id!=='weekly-nsa'&&field!=='duration_bucket')lines.push({name:'Duration change',color:AMBER,values:groups.map(g=>g.durationChange)});
  if(report.id==='overview'&&field==='duration_bucket')lines.push({name:'Duration change',color:AMBER,values:groups.map(g=>g.durationChange)});
  return {labels:groups.map(g=>g.name),series:report.series.slice(0,periods).map((s,i)=>({name:seriesName(s),color:CHART_COLORS[i],values:groups.map(g=>g.series[i]?.tickets??null)})),lines,field,unit:'tickets'};
}
export function comboSvg(data,{stacked=false,label='',width,axisScale,changeScale,showValues=data.labels.length<=8}={}){
  if(!data.labels.length)return emptySvg(label);
  const w=width||Math.max(760,data.labels.length*92+145),h=365,l=65,r=data.lines?.length?83:27,t=34,b=96,pw=w-l-r,ph=h-t-b,gap=pw/data.labels.length;
  const totals=data.labels.map((_,i)=>data.series.reduce((a,s)=>a+(s.values[i]||0),0));
  const scale=axisScale||countScale(stacked?totals:data.series.flatMap(s=>s.values)),percent=changeScale||percentScale((data.lines||[]).flatMap(s=>s.values));
  const x=i=>l+gap*(i+.5),y=v=>t+ph-v/scale.max*ph,yp=v=>t+ph-(v-percent.min)/(percent.max-percent.min)*ph;
  let svg=svgStart(w,h,label)+`<text class="bi-axis-title" x="${l}" y="16">${data.unit==='hours'?'RESTORATION HOURS':'TICKETS'}</text>`;
  if(data.lines?.length)svg+=`<text class="bi-axis-title" x="${w-8}" y="16" text-anchor="end">CHANGE %</text>`;
  for(let i=0;i<=4;i++){const yy=t+ph-i*ph/4;svg+=`<line x1="${l}" x2="${w-r}" y1="${yy}" y2="${yy}" stroke="${GRID}" ${i?'stroke-dasharray="3 5"':''}/><text x="${l-12}" y="${yy+5}" text-anchor="end">${compact(scale.max*i/4)}</text>`;if(data.lines?.length)svg+=`<text x="${w-r+16}" y="${yy+5}">${compact(percent.min+(percent.max-percent.min)*i/4)}%</text>`;}
  const cluster=Math.min(68,gap*.72),barW=stacked?Math.min(40,gap*.5):(cluster-(data.series.length-1)*4)/data.series.length;
  data.labels.forEach((name,i)=>{
    let stack=0;const tip=groupTip(data,i);let bars='';
    data.series.forEach((s,j)=>{const value=s.values[i];if(!num(value))return;
      const bx=stacked?x(i)-barW/2:x(i)-cluster/2+j*(barW+4),by=stacked?y(stack+value):y(value),height=value/scale.max*ph;
      bars+=`<rect class="bi-point" data-series-index="${j}" x="${bx}" y="${by}" width="${Math.max(1,barW)}" height="${Math.max(0,height)}" rx="${stacked?1:3}" fill="${s.color||CHART_COLORS[j]}"/>`;
      if(!stacked&&showValues&&value>0)bars+=`<text class="bi-value" x="${bx+barW/2}" y="${Math.max(t+5,by-7)}" text-anchor="middle">${compact(value)}</text>`;
      stack+=value;
    });
    if(stacked&&stack>0)bars+=`<text class="bi-value" x="${x(i)}" y="${Math.max(t+5,y(stack)-8)}" text-anchor="middle">${compact(stack)}</text>`;
    bars+=`<rect x="${x(i)-gap/2+3}" y="${t}" width="${gap-6}" height="${ph+82}" fill="transparent"/>${labelText(name,x(i),t+ph+25,Math.min(16,Math.floor(gap/7.2)),3)}`;
    svg+=anchor(data.field,name,bars,tip);
  });
  for(const line of data.lines||[]){for(const segment of segmented(line.values,x,yp)){
    svg+=`<polyline points="${segment.map(p=>p[0]+','+p[1]).join(' ')}" fill="none" stroke="${line.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
    for(const [xx,yy,value,i]of segment)svg+=anchor(data.field,data.labels[i],`<circle cx="${xx}" cy="${yy}" r="4.2" fill="white" stroke="${line.color}" stroke-width="2.4"/>`,`${data.labels[i]}\n${line.name}: ${pct(value)}\n${groupTip(data,i)}`);
  }}
  return svg+'</svg>';
}
export function horizontalSvg(data,{label='',axisScale}={}){
  if(!data.labels.length)return emptySvg(label);
  const w=800,l=165,r=65,t=28,b=45,rowH=Math.max(48,data.series.length*13+18),h=t+b+rowH*data.labels.length,pw=w-l-r;
  const scale=axisScale||countScale(data.series.flatMap(s=>s.values));let svg=svgStart(w,h,label);
  for(let i=0;i<=4;i++){const xx=l+pw*i/4;svg+=`<line x1="${xx}" x2="${xx}" y1="${t}" y2="${h-b}" stroke="${GRID}" stroke-dasharray="3 5"/><text x="${xx}" y="${h-b+27}" text-anchor="middle">${compact(scale.max*i/4)}</text>`;}
  data.labels.forEach((name,i)=>{const yy=t+i*rowH+7,tip=groupTip(data,i);let bars=`<text class="bi-category" x="${l-18}" y="${yy+rowH/2-3}" text-anchor="end">${esc(name.length>21?name.slice(0,20)+'…':name)}</text>`;
    data.series.forEach((s,j)=>{const value=s.values[i];if(!num(value))return;const bh=10,bw=value/scale.max*pw,by=yy+j*13;bars+=`<rect x="${l}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="${s.color||CHART_COLORS[j]}"/><text class="bi-value" x="${l+bw+9}" y="${by+10}">${compact(value)}</text>`;});
    bars+=`<rect x="5" y="${yy-6}" width="${w-10}" height="${rowH-2}" fill="transparent"/>`;svg+=anchor(data.field,name,bars,tip);
  });return svg+`<text class="bi-axis-title" x="${w-r}" y="${h-2}" text-anchor="end">TICKETS</text></svg>`;
}
function seriesRows(report){return report.series.map(s=>({name:seriesName(s),color:CHART_COLORS[report.series.indexOf(s)],rows:s.rows}));}
export function yearMonthData(report,state,meta,metric='hours'){
  const years=[0,1,2].map(n=>Number(state.year||state.period.slice(0,4))-n),months=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
  const buckets=new Map();for(const r of report.scope){const key=r.created_date.slice(0,7);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  const series=years.map((year,index)=>({name:String(year),color:CHART_COLORS[index],values:months.map(m=>{
    const range=monthRange(year+'-'+m),clip=report.id==='yoy'?report.series[index].range:null;
    if(range.end<meta.min_date||range.start>meta.max_date||clip&&range.start>clip.end)return null;
    const rows=(buckets.get(year+'-'+m)||[]).filter(r=>!clip||r.created_date<=clip.end),s=summarize(rows);
    return metric==='hours'?s.durationMinutes/60:s.tickets;
  })}));
  return {labels:months.map(m=>monthLabel('2024-'+m)),series,lines:[{name:metric==='hours'?'Duration change':'Ticket change',color:metric==='hours'?AMBER:TEAL,values:months.map((_,i)=>change(series[0].values[i],series[1].values[i]))}],unit:metric};
}
export function areaData(report,state,meta){
  meta={...meta,...report.sourceCoverage};
  const weekly=report.definition.mode.includes('week');let ranges=[];
  if(weekly&&report.now.range){for(let t=Date.parse(report.now.range.start+'T00:00:00Z');t<=Date.parse(report.now.range.end+'T00:00:00Z');t+=DAY){const date=new Date(t).toISOString().slice(0,10);ranges.push({start:date,end:date,label:new Date(t).toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'})});}}
  else ranges=Array.from({length:12},(_,i)=>{const range=monthRange(String(state.year||state.period.slice(0,4))+'-'+String(i+1).padStart(2,'0'));return {...range,label:monthLabel(range.month)};});
  const values=ranges.map(range=>!meta.max_date||range.end<meta.min_date||range.start>meta.max_date?null:report.scope.filter(r=>r.created_date>=range.start&&r.created_date<=range.end).length);
  return {labels:ranges.map(r=>r.label),series:[{name:'Ticket volume',color:CHART_COLORS[0],values}],lines:[],unit:'tickets',ranges};
}
export function areaSvg(data,{label='',id='area'}={}){
  if(!data.labels.length)return emptySvg(label);
  const w=760,h=290,l=57,r=24,t=30,b=47,pw=w-l-r,ph=h-t-b,scale=countScale(data.series[0].values),gap=pw/Math.max(1,data.labels.length-1),x=i=>data.labels.length===1?l+pw/2:l+gap*i,y=v=>t+ph-v/scale.max*ph;
  let svg=svgStart(w,h,label)+`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e45bd" stop-opacity=".3"/><stop offset="1" stop-color="#8e45bd" stop-opacity=".015"/></linearGradient></defs><text class="bi-axis-title" x="${l}" y="15">TICKETS</text>`;
  for(let i=0;i<=4;i++){const yy=t+ph-i*ph/4;svg+=`<line x1="${l}" x2="${w-r}" y1="${yy}" y2="${yy}" stroke="${GRID}" stroke-dasharray="3 5"/><text x="${l-12}" y="${yy+4}" text-anchor="end">${compact(scale.max*i/4)}</text>`;}
  for(const points of segmented(data.series[0].values,x,y)){
    const path=points.map(([xx,yy],i)=>(i?'L':'M')+xx+','+yy).join(' ');
    svg+=`<path d="${path} L${points.at(-1)[0]},${t+ph} L${points[0][0]},${t+ph} Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="#6e23a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    for(const [xx,yy,value,i]of points)svg+=`<g data-tip="${attr(data.labels[i]+'\n'+n(value)+' tickets')}"><title>${esc(data.labels[i])}: ${n(value)} tickets</title><circle cx="${xx}" cy="${yy}" r="4" fill="white" stroke="#6e23a0" stroke-width="2.5"/><circle cx="${xx}" cy="${yy}" r="15" fill="transparent"/></g>`;
  }
  data.labels.forEach((name,i)=>svg+=`<text x="${x(i)}" y="${h-17}" text-anchor="middle">${esc(name)}</text>`);return svg+'</svg>';
}
export function regionalData(report,metric='tickets'){
  const groups=comparisonGroups(report,'region');return {labels:groups.map(g=>g.name),series:[],lines:[{name:metric==='tickets'?'Ticket change':'Duration change',color:metric==='tickets'?TEAL:AMBER,values:groups.map(g=>metric==='tickets'?g.ticketChange:g.durationChange)}],field:'region',unit:'percent'};
}
export function regionalSvg(data,{label=''}={}){
  if(!data.labels.length)return emptySvg(label);
  const w=760,h=245,l=72,r=35,t=35,b=43,pw=w-l-r,ph=h-t-b,scale=percentScale(data.lines[0].values),gap=pw/Math.max(1,data.labels.length),x=i=>l+gap*(i+.5),y=v=>t+ph-(v-scale.min)/(scale.max-scale.min)*ph,line=data.lines[0];
  let svg=svgStart(w,h,label);
  for(let i=0;i<=4;i++){const value=scale.min+(scale.max-scale.min)*i/4,yy=y(value);svg+=`<line x1="${l}" x2="${w-r}" y1="${yy}" y2="${yy}" stroke="${value===0?'#cfc3da':GRID}" stroke-dasharray="${value===0?'0':'3 5'}"/><text x="${l-12}" y="${yy+5}" text-anchor="end">${compact(value)}%</text>`;}
  for(const points of segmented(line.values,x,y))svg+=`<polyline points="${points.map(p=>p[0]+','+p[1]).join(' ')}" fill="none" stroke="${line.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  data.labels.forEach((name,i)=>{const value=line.values[i],tip=name+'\n'+line.name+': '+pct(value);let shape=labelText(name,x(i),h-17,19,1);if(num(value))shape+=`<circle cx="${x(i)}" cy="${y(value)}" r="5" fill="white" stroke="${line.color}" stroke-width="3"/><text x="${x(i)}" y="${Math.max(17,y(value)-13)}" text-anchor="middle" style="font-size:16px;font-weight:600;fill:${line.color}">${pct(value)}</text><circle cx="${x(i)}" cy="${y(value)}" r="18" fill="transparent"/>`;svg+=anchor('region',name,shape,tip);});return svg+'</svg>';
}
export function funnelData(report){
  const values=DURATION_BUCKETS.filter(b=>b!=='Missing').map(name=>({name,count:report.now.rows.filter(r=>durationBucket(r.duration_minutes)===name).length})).sort((a,b)=>b.count-a.count);
  return {labels:values.map(v=>v.name),series:[{name:seriesName(report.now),color:CHART_COLORS[0],values:values.map(v=>v.count)}],lines:[],field:'duration_bucket',unit:'tickets'};
}
export function funnelSvg(data,{label=''}={}){
  const w=400,h=280,center=237,top=24,row=45,max=Math.max(1,...data.series[0].values),palette=['#4f008c','#7737aa','#9a6cbf','#b596cf','#d0bde0'];
  let svg=svgStart(w,h,label);
  data.labels.forEach((name,i)=>{const value=data.series[0].values[i],a=value/max*170,b=(data.series[0].values[i+1]??value*.62)/max*170,y=top+i*row;const tip=name+'\n'+n(value)+' tickets';svg+=anchor('duration_bucket',name,`<text class="bi-category" x="15" y="${y+25}">${esc(name)}</text><path d="M${center-a/2},${y} L${center+a/2},${y} L${center+b/2},${y+36} L${center-b/2},${y+36} Z" fill="${palette[i]}"/><text class="bi-value" x="380" y="${y+25}" text-anchor="end" style="font-size:15px">${n(value)}</text><rect x="6" y="${y-2}" width="388" height="${row}" fill="transparent"/>`,tip);});
  return svg+'</svg>';
}
export function durationSeverityData(report){
  const severities=['Critical','High','Medium','Low'],extra=[...new Set(report.now.rows.map(r=>r.severity||'Unknown'))].filter(s=>!severities.includes(s));severities.push(...extra);
  const present=severities.filter(s=>report.now.rows.some(r=>(r.severity||'Unknown')===s)),labels=DURATION_BUCKETS.filter(x=>x!=='Missing');
  return {labels,series:present.map((name,i)=>({name,color:['#4f008c','#ff375e','#00a39b','#b5a0c9','#d99a25'][i%5],values:labels.map(b=>report.now.rows.filter(r=>(r.severity||'Unknown')===name&&durationBucket(r.duration_minutes)===b).length)})),lines:[],field:'duration_bucket',unit:'tickets'};
}
function sparkline(values,color){const valid=values.filter(num);if(!valid.length)return '';const w=180,h=38,max=Math.max(1,...valid),gap=w/Math.max(1,values.length-1);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" class="bi-spark" aria-hidden="true">${segmented(values,i=>i*gap,v=>h-4-v/max*(h-8)).map(p=>`<polyline points="${p.map(x=>x[0]+','+x[1]).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`).join('')}</svg>`;}
export function donutSvg(value,label){
  const circumference=2*Math.PI*43,portion=num(value)?Math.min(100,Math.abs(value))/100:0,color=num(value)&&value<0?'#00a38d':'#ff375e';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bi-donut-svg" viewBox="0 0 132 132" role="img" aria-label="${attr(label+': '+pct(value))}"><title>${esc(label)}: ${pct(value)}. Ring shows absolute change up to 100%.</title><circle cx="66" cy="66" r="43" fill="none" stroke="#f0e9f5" stroke-width="9"/><circle cx="66" cy="66" r="43" fill="none" stroke="${color}" stroke-width="9" stroke-dasharray="${circumference*portion} ${circumference}" stroke-linecap="${portion?'round':'butt'}" transform="rotate(-90 66 66)"/><text x="66" y="72" text-anchor="middle" style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:${Math.abs(value||0)>999?17:22}px;font-weight:650;fill:${INK}">${esc(pct(value))}</text></svg>`;
}
export function createChartExport(svg,title,items=[]){
  const match=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);if(!match)throw new Error('Chart dimensions are unavailable.');
  const w=Number(match[1]),h=Number(match[2]);let x=28,y=65,keys='';
  for(const item of items){const width=String(item.name).length*7+34;if(x+width>w-25){x=28;y+=24;}keys+=`${item.line?`<line x1="${x}" x2="${x+16}" y1="${y-4}" y2="${y-4}" stroke="${attr(item.color)}" stroke-width="3"/>`:`<rect x="${x}" y="${y-10}" width="11" height="11" rx="2" fill="${attr(item.color)}"/>`}<text x="${x+22}" y="${y}" style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;fill:#8a7599">${esc(item.name)}</text>`;x+=width;}
  const top=y+23,nested=svg.replace('<svg ',`<svg x="0" y="${top}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h+top}" width="${w}" height="${h+top}"><rect width="100%" height="100%" fill="white"/><text x="28" y="31" style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:650;fill:#4f008c">${esc(title)}</text>${keys}${nested}</svg>`;
}

export function dashboardCards(report,state,meta){
  const s=report.now.summary;
  return [
    {id:'card-tickets',label:'No. of tickets KPI',value:n(s?.tickets),unit:'tickets',kind:'value',featured:true,pill:report.definition.impact,spark:areaData(report,state,meta).series[0].values},
    {id:'card-ticket-change',label:'Ticket change',value:pct(report.ticketChange),metric:report.ticketChange,kind:'ring'},
    {id:'card-duration',label:'Duration KPI',value:hours(s?.durationMinutes),unit:'hrs',kind:'value'},
    {id:'card-duration-change',label:'Duration change',value:pct(report.durationChange),metric:report.durationChange,kind:'ring'},
    {id:'card-sites',label:'COWs with tickets',value:n(s?.sites),kind:'support'},
    {id:'card-repeat-sites',label:'COWs with 3+ TTs',value:n(s?.repeatSites),kind:'support'},
    {id:'card-mttr',label:'MTTR',value:hours(s?.mttr),unit:'hrs',kind:'support'},
    {id:'card-repeat-rate',label:'Repeat rate (3+ TTs)',value:n(s?.repeatRate,1),unit:'%',kind:'support'}
  ];
}
function direction(value){return !num(value)?'Unavailable':value<0?'Improved':value>0?'Increased':'No change';}
function renderKpis(cards){
  return `<div class="bi-kpis">${cards.slice(0,4).map(c=>c.kind==='ring'
    ?`<article class="bi-kpi-ring" data-export-card="${c.id}"><div class="bi-kpi-eyebrow">${esc(c.label)}</div><div class="bi-ring-body">${donutSvg(c.metric,c.label)}<div><b class="${!num(c.metric)||c.metric===0?'neutral':c.metric<0?'good':'bad'}">${direction(c.metric)}</b></div></div></article>`
    :`<article class="bi-kpi-value ${c.featured?'featured':''}" data-export-card="${c.id}"><div class="bi-kpi-eyebrow">${esc(c.label)}${c.pill?`<span class="bi-pill">${esc(c.pill)}</span>`:''}</div><div class="bi-kpi-number">${esc(c.value)}${c.unit?`<small>${esc(c.unit)}</small>`:''}</div>${c.spark?sparkline(c.spark,'#e7b5f2'):''}</article>`).join('')}</div>`;
}
export function renderSupportingMetrics(report,state,meta){
  return `<div class="report-metrics bi-supporting-metrics">${dashboardCards(report,state,meta).slice(4).map(c=>`<div data-export-card="${c.id}"><span>${esc(c.label)}</span><b>${esc(c.value)}${c.unit?` <small>${esc(c.unit)}</small>`:''}</b></div>`).join('')}</div>`;
}
export function cardSvg(c){
  const w=340,h=c.kind==='support'?108:160,ink=c.featured?'white':INK,muted=c.featured?'#e1d1ec':MUTED;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="15" fill="${c.featured?'#4f008c':'white'}" stroke="${c.featured?'#4f008c':'#e9e0ef'}"/><g style="font-family:Inter,Segoe UI,Arial,sans-serif"><text x="24" y="32" style="font-size:13px;font-weight:600;fill:${muted}">${esc(c.label)}</text>`;
  if(c.pill)svg+=`<text x="315" y="32" text-anchor="end" style="font-size:12px;fill:#e1d1ec">${esc(c.pill)}</text>`;
  if(c.kind==='ring'){
    const nested=donutSvg(c.metric,c.label).replace('<svg ','<svg x="18" y="31" width="124" height="124" ');
    svg+=nested+`<text x="154" y="102" style="font-size:15px;font-weight:600;fill:${!num(c.metric)||c.metric===0?MUTED:c.metric<0?'#008f7c':'#dc4264'}">${esc(direction(c.metric))}</text>`;
  }else{
    svg+=`<text x="24" y="${c.kind==='support'?82:91}" style="font-size:${c.value.length>10?32:40}px;font-weight:650;letter-spacing:-1px;fill:${ink}">${esc(c.value)}${c.unit?`<tspan style="font-size:14px;letter-spacing:0;font-weight:400;fill:${muted}"> ${esc(c.unit)}</tspan>`:''}</text>`;
    if(c.spark)svg+=sparkline(c.spark,'#e7b5f2').replace('<svg ','<svg x="24" y="111" width="180" height="32" ');
  }
  return svg+'</g></svg>';
}
function comparisonChart(report,field,title,kind='combo',className=''){
  let data=comparisonData(report,field),svg;
  if(kind==='severity-bar'){data=durationSeverityData(report);svg=horizontalSvg(data,{label:title});}
  else if(kind==='bar'){
    if(field==='duration_bucket'){const groups=comparisonGroups(report,field);data={labels:groups.map(g=>g.name),series:[{name:seriesName(report.now),color:CHART_COLORS[0],values:groups.map(g=>g.series[0]?.tickets??null)}],lines:[],field,unit:'tickets'};}
    else data={...data,lines:[]};
    svg=horizontalSvg(data,{label:title});
  }else svg=comboSvg(data,{label:title});
  return {id:report.id+'-'+field,title,data,svg,kind,className,scrollHeight:kind==='bar'&&data.labels.length>8?445:undefined};
}
function regionalChart(report,metric){const data=regionalData(report,metric),title=metric==='tickets'?'Ticket rate change by region':'Duration change by region';return {id:report.id+'-region-'+metric,title,data,svg:regionalSvg(data,{label:title}),kind:'line',className:'bi-region',showLegend:false};}
function performanceChart(report){const chronological=[...report.series.slice(0,CHART_PLANS[report.id].periods)].reverse(),values=chronological.map(s=>s.summary?.tickets??null),data={labels:chronological.map(seriesName),series:[{name:'Ticket volume',color:CHART_COLORS[0],values}],lines:[{name:'Period change',color:TEAL,values:values.map((v,i)=>i?change(v,values[i-1]):null)}],unit:'tickets'};return {id:report.id+'-change-kpi',title:'Ticket performance KPI',data,svg:comboSvg(data,{label:'Ticket performance KPI'}),kind:'combo'};}
export function dashboardSections(report,state,meta){
  const p=CHART_PLANS[report.id],sections=[];
  const add=(id,layout,charts)=>{if(charts.length)sections.push({id,layout,charts});};
  const annual=[];
  if(p.annualTickets){const data=yearMonthData(report,state,meta,'tickets');annual.push({id:report.id+'-annual-tickets',title:'Monthly ticket volume by year',data,svg:comboSvg(data,{label:'Monthly ticket volume by year',width:950}),kind:'combo',fit:true});}
  if(p.annualDuration){const data=yearMonthData(report,state,meta,'hours');annual.push({id:report.id+'-annual-duration',title:'MoM duration KPI',data,svg:comboSvg(data,{label:'MoM duration KPI',stacked:true,width:950}),kind:'stacked-combo',fit:true});}
  add('annual',annual.length>1?'two':'one',annual);
  if(p.area){const area=areaData(report,state,meta),funnel=funnelData(report);add('trend','area-row',[
    {id:report.id+'-ticket-trend',title:'Tickets volume KPI trend',data:area,svg:areaSvg(area,{label:'Tickets volume KPI trend',id:'area-'+report.id}),kind:'area'},
    {id:report.id+'-age-funnel',title:'Age distribution',data:funnel,svg:funnelSvg(funnel,{label:'Age distribution'}),kind:'funnel'}
  ]);}
  const priorities=[];if(p.severity)priorities.push(comparisonChart(report,'severity','Severity TTs comparison'));if(p.label)priorities.push(comparisonChart(report,'site_label','Sites Label TTs comparison'));
  add('priorities',p.severity?'two':'one',priorities);
  add('regions','two regional-row',[regionalChart(report,'tickets'),regionalChart(report,'duration')]);
  add('root-causes','one',[comparisonChart(report,'root_cause','Top root cause TTs comparison',p.root,'bi-root-chart')]);
  add('details','two detail-row',[comparisonChart(report,'district','District TTs comparison',p.district),comparisonChart(report,'duration_bucket','TT age group distribution',p.duration)]);
  if(p.changeKpi)add('performance','one',[performanceChart(report)]);
  return sections;
}
export function chartLegend(chart){return chart.showLegend===false?[]:[...chart.data.series.map((s,i)=>({name:s.name,color:s.color||CHART_COLORS[i]})),...(chart.data.lines||[]).map(l=>({...l,line:true}))];}
export function exportChartParts(chart,{maxCategories=12,maxRows=7}={}){
  const horizontal=['bar','severity-bar'].includes(chart.kind),combo=['combo','stacked-combo'].includes(chart.kind),limit=horizontal?maxRows:maxCategories;
  if((!horizontal&&!combo)||chart.data.labels.length<=limit)return [{...chart,part:1,partCount:1}];
  const data=chart.data,totals=data.labels.map((_,i)=>data.series.reduce((n,s)=>n+(s.values[i]||0),0));
  const axisScale=countScale(chart.kind==='stacked-combo'?totals:data.series.flatMap(s=>s.values)),changeScale=percentScale((data.lines||[]).flatMap(s=>s.values));
  const parts=[];
  for(let start=0;start<data.labels.length;start+=limit){
    const slice={...data,labels:data.labels.slice(start,start+limit),series:data.series.map(s=>({...s,values:s.values.slice(start,start+limit)})),lines:(data.lines||[]).map(s=>({...s,values:s.values.slice(start,start+limit)}))};
    const part=parts.length+1,partCount=Math.ceil(data.labels.length/limit),title=`${chart.title} (${part}/${partCount})`;
    const svg=horizontal?horizontalSvg(slice,{label:title,axisScale}):comboSvg(slice,{label:title,stacked:chart.kind==='stacked-combo',axisScale,changeScale,showValues:data.labels.length<=8});
    parts.push({...chart,data:slice,svg,title,part,partCount,axisScale,changeScale,startIndex:start});
  }
  return parts;
}
export function renderChartBoard(report,state,meta){
  return renderKpis(dashboardCards(report,state,meta))+dashboardSections(report,state,meta).map(s=>`<div class="bi-chart-row ${s.layout}">${s.charts.map(panel).join('')}</div>`).join('')+`<div class="bi-chart-key"><span><i style="background:${TEAL}"></i>Ticket change</span><span><i style="background:${AMBER}"></i>Duration change</span></div>`;
}
