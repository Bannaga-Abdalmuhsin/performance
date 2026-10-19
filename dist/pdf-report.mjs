import {summarize,matchesTicketQuery} from './core.mjs?v=20261019parenttt';
import {REPORTS,buildReport,change} from './analysis.mjs?v=20261019parenttt';
import {dashboardCards,dashboardSections,cardSvg,chartLegend,exportChartParts} from './charts.mjs?v=20261019parenttt';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const filterFields=[['region','Region'],['district','District'],['vendor','Vendor'],['severity','Severity'],['site_label','Sites Label'],['root_cause','Root cause'],['site_id','COW'],['duration_bucket','Restoration band']];
const date=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable';
const safeFile=s=>String(s).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
const dimensions=svg=>{const m=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);if(!m)throw new Error('A chart could not be prepared.');return {width:Number(m[1]),height:Number(m[2])};};

export function createDashboardExport({records,state,profiles={},meta,generatedAt=new Date(),selectedIds}={}){
  const selection={...state,scope:'all'},id=REPORTS[selection.view]?selection.view:REPORTS[selection.reportView]?selection.reportView:'overview';
  const report=buildReport(records,selection,profiles,meta,id);
  if(selection.view==='tickets'&&selection.query){
    const matches=r=>matchesTicketQuery(r,selection.query);
    report.scope=report.scope.filter(matches);report.series=report.series.map(s=>{const rows=s.rows.filter(matches);return {...s,rows,summary:s.covered?summarize(rows):null};});
    [report.now,report.prev]=report.series;report.ticketChange=change(report.now.summary?.tickets,report.prev.summary?.tickets);report.durationChange=change(report.now.summary?.durationMinutes,report.prev.summary?.durationMinutes);
  }
  const cards=dashboardCards(report,selection,meta),sections=dashboardSections(report,selection,meta);
  const items=[...cards.map(card=>({id:card.id,label:card.label,type:'card',card})),...sections.flatMap(section=>section.charts.map(chart=>({id:chart.id,label:chart.title,type:'chart',chart,section:section.id,layout:section.layout})))];
  const selectedFilters=filterFields.filter(([key])=>selection[key]&&selection[key]!=='all').map(([key,label])=>`${label}: ${selection[key]}`);
  if(selection.view==='tickets'&&selection.query)selectedFilters.push(`Search: ${selection.query}`);
  const manifest={report,state:selection,meta:{...meta},cards,sections,items,selectedFilters,generatedAt:new Date(generatedAt),title:report.definition.title,period:report.now.range?.label||'Unavailable',filename:`stc-COW-${id}-${safeFile(report.now.range?.label||selection.period)}-dashboard.pdf`};
  return selectedIds===undefined?manifest:selectExportItems(manifest,selectedIds);
}

export function selectExportItems(manifest,selectedIds){
  const ids=new Set(selectedIds),available=new Set(manifest.items.map(i=>i.id));
  if([...ids].some(id=>!available.has(id)))throw new Error('One of the selected items is unavailable. Reopen the export.');
  const items=manifest.items.filter(i=>ids.has(i.id));
  if(!items.length)throw new Error('Select at least one card or chart.');
  return {...manifest,items};
}
function wrap(text,max){
  const lines=[];let line='';
  for(const word of String(text).split(/\s+/)){
    const chunks=word.length>max?Array.from({length:Math.ceil(word.length/max)},(_,i)=>word.slice(i*max,(i+1)*max)):[word];
    for(const chunk of chunks){if(line&&(line+' '+chunk).length>max){lines.push(line);line=chunk;}else line=(line+' '+chunk).trim();}
  }
  if(line)lines.push(line);return lines;
}
function textSvg(lines,{width=1480,size=16,color='#816c91',padding=0,lineHeight=24}={}){
  const height=lines.length*lineHeight+padding*2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${lines.map((line,i)=>`<text x="${padding}" y="${padding+size+i*lineHeight}" style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:${size}px;fill:${color}">${esc(line)}</text>`).join('')}</svg>`;
}
function periodsSvg(manifest){
  const width=1480,height=91,gap=18,count=manifest.report.series.length,cw=(width-gap*(count-1))/count;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${manifest.report.series.map((s,i)=>{
    const x=i*(cw+gap),label=i===0?'Review period':i===1?'Comparison':'Earlier comparison';
    return `<rect x="${x+1}" y="1" width="${cw-2}" height="88" rx="11" fill="${i?'white':'#faf7fc'}" stroke="${i?'#e9e3ee':'#cfb9df'}"/><g style="font-family:Inter,Segoe UI,Arial,sans-serif"><text x="${x+19}" y="24" style="font-size:12px;fill:#807188">${label}</text><text x="${x+19}" y="49" style="font-size:19px;font-weight:600;fill:#36144f">${esc(s.range?.label||'Unavailable')}</text><text x="${x+19}" y="72" style="font-size:12px;fill:#83768c">${esc(s.range?date(s.range.start)+' - '+date(s.range.end):'Calendar has no matching week')}</text></g>`;
  }).join('')}</svg>`;
}

export function exportChartRows(manifest){
  const chosen=new Set(manifest.items.filter(i=>i.type==='chart').map(i=>i.id)),rows=[];
  for(const section of manifest.sections){
    const charts=section.charts.filter(c=>chosen.has(c.id));if(!charts.length)continue;
    const expanded=charts.map(c=>exportChartParts(c));
    const pair=charts.length===2&&expanded.every(p=>p.length===1)&&(section.layout==='area-row'||charts.every(c=>{const d=dimensions(c.svg);return d.width<=800&&d.height<=550;}));
    if(pair)rows.push({charts:expanded.map(p=>p[0]),weights:section.layout==='area-row'?[.66,.34]:[.5,.5]});
    else for(const parts of expanded)for(const chart of parts)rows.push({charts:[chart],weights:[1]});
  }
  return rows;
}

// Render the whole chart viewBox, independent of scroll position or viewport.
export async function rasterizeSvg(svg,{scale=2}={}){
  const d=dimensions(svg),canvas=document.createElement('canvas');canvas.width=Math.ceil(d.width*scale);canvas.height=Math.ceil(d.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('PDF images could not be prepared in this browser.');
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('A chart could not be prepared for PDF. Please try again.'));img.src=url;});
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('A PDF image could not be saved.');
    return new Uint8Array(await blob.arrayBuffer());
  }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
}
async function loadAsset(name,base){
  const response=await fetch(new URL('assets/'+name,base));if(!response.ok)throw new Error('The report logos could not be loaded. Please try again.');return new Uint8Array(await response.arrayBuffer());
}
let library;
async function pdfLibrary(){return library??=import('./assets/vendor/pdf-lib-1.17.1.mjs');}

export async function createDashboardPdf(manifest,{rasterize=rasterizeSvg,assetLoader=loadAsset,assetBase=globalThis.document?.baseURI||import.meta.url,onProgress=()=>{}}={}){
  if(!manifest.items.length)throw new Error('Select at least one card or chart.');
  const {PDFDocument,StandardFonts,rgb}=await pdfLibrary(),doc=await PDFDocument.create();
  doc.setTitle(`stc COW - ${manifest.title} - ${manifest.period}`);doc.setAuthor('stc COW Operations');doc.setCreator('stc COW Performance');doc.setProducer('stc COW Performance');doc.setCreationDate(manifest.generatedAt);
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const [stcBytes,acesBytes]=await Promise.all([assetLoader('pdf-stc-logo.png',assetBase),assetLoader('pdf-aces-logo.png',assetBase)]);
  const stc=await doc.embedPng(stcBytes),aces=await doc.embedPng(acesBytes),cache=new Map();
  const image=async svg=>{if(!cache.has(svg))cache.set(svg,doc.embedPng(await rasterize(svg)));return await cache.get(svg);};
  const W=1190.55,H=841.89,M=36,CW=W-2*M,GAP=16,BOTTOM=44;
  const color=hex=>rgb(...hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255));
  const ink=color('#36144f'),muted=color('#8d799c'),purple=color('#4f008c'),border=color('#e9e1ef');
  const scope=[manifest.period,manifest.report.definition.impact,...(manifest.selectedFilters.length?manifest.selectedFilters:['All regions','All vendors','All Sites Label'])].join(' | ');
  const scopeSvg=textSvg(wrap(scope,170)),scopeImage=await image(scopeSvg),scopeH=dimensions(scopeSvg).height*CW/1480;
  let page,y;
  const addPage=()=>{
    const continued=doc.getPageCount()>0;
    page=doc.addPage([W,H]);page.drawRectangle({x:0,y:0,width:W,height:H,color:rgb(1,1,1)});
    const s=stc.scaleToFit(69,42);page.drawImage(stc,{x:M,y:H-47-s.height/2,width:s.width,height:s.height});
    page.drawText('COW PERFORMANCE',{x:M+86,y:H-41,size:10,font:bold,color:purple});page.drawText(continued?manifest.title:'Performance analysis',{x:M+86,y:H-58,size:continued?13:10,font:continued?bold:regular,color:continued?ink:muted});
    const a=aces.scaleToFit(116,60);page.drawImage(aces,{x:W-M-a.width,y:H-47-a.height/2,width:a.width,height:a.height});
    page.drawLine({start:{x:M,y:H-79},end:{x:W-M,y:H-79},thickness:.7,color:border});if(!continued)page.drawText(manifest.title,{x:M,y:H-111,size:23,font:bold,color:ink});
    page.drawImage(scopeImage,{x:M,y:H-(continued?91:125)-scopeH,width:CW,height:scopeH});y=H-(continued?103:139)-scopeH;
  };
  const ensure=height=>{if(y-height<BOTTOM-.01)addPage();};
  addPage();
  const periodsText=periodsSvg(manifest),periods=await image(periodsText),ph=dimensions(periodsText).height*CW/1480;
  page.drawImage(periods,{x:M,y:y-ph,width:CW,height:ph});y-=ph+17;
  const cards=manifest.items.filter(i=>i.type==='card').map(i=>i.card),cardWidth=(CW-3*GAP)/4;
  for(let start=0;start<cards.length;start+=4){
    const group=cards.slice(start,start+4),height=Math.max(...group.map(c=>dimensions(cardSvg(c)).height))*cardWidth/340;ensure(height);
    for(let i=0;i<group.length;i++){const svg=cardSvg(group[i]),h=dimensions(svg).height*cardWidth/340;page.drawImage(await image(svg),{x:M+i*(cardWidth+GAP),y:y-h,width:cardWidth,height:h});}y-=height+GAP;
  }
  const rows=exportChartRows(manifest),totalParts=rows.reduce((n,row)=>n+row.charts.length,0);let completed=0;
  for(const row of rows){
    const widths=row.weights.map(w=>(CW-GAP*(row.charts.length-1))*w);
    const boxes=row.charts.map((chart,i)=>{
      const width=widths[i],d=dimensions(chart.svg),titleLines=wrap(chart.title,Math.max(27,Math.floor((width-34)/7.4))),legendLines=[];let line=[],used=0;
      for(const item of chartLegend(chart)){const required=item.name.length*6.1+25;if(line.length&&used+required>width-40){legendLines.push(line);line=[];used=0;}line.push(item);used+=required;}
      if(line.length)legendLines.push(line);
      const top=22+titleLines.length*18+legendLines.length*18,scale=Math.min(.75,(width-32)/d.width),svgH=d.height*scale;
      return {chart,width,d,scale,svgH,titleLines,legendLines,top,height:top+svgH+17};
    });
    let height=Math.max(...boxes.map(b=>b.height));
    const available=y-BOTTOM,fit=Math.min(...boxes.map(b=>(available-b.top-17)/b.svgH));
    // A modest size adjustment keeps a whole row together without clipping it.
    if(height>available&&fit>=.8&&fit<1){for(const b of boxes){b.scale*=fit;b.svgH*=fit;b.height=b.top+b.svgH+17;}height=Math.max(...boxes.map(b=>b.height));}
    if(height>H-103-scopeH-BOTTOM)throw new Error('Shorten the selected search text before exporting these charts.');ensure(height);let x=M;
    for(const b of boxes){
      page.drawRectangle({x,y:y-height,width:b.width,height,color:rgb(1,1,1),borderColor:border,borderWidth:.7});let yy=y-25;
      for(const line of b.titleLines){page.drawText(line,{x:x+17,y:yy,size:14,font:bold,color:purple});yy-=18;}
      if(b.legendLines.length){
        const lw=(b.width-34)/.75,lh=b.legendLines.length*24;
        const ls=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lw} ${lh}" width="${lw}" height="${lh}">${b.legendLines.map((line,i)=>{let xx=0;return line.map(item=>{const at=xx;xx+=(item.name.length*6.1+25)/.75;return `${item.line?`<line x1="${at}" x2="${at+15}" y1="${i*24+13}" y2="${i*24+13}" stroke="${esc(item.color)}" stroke-width="2.5"/>`:`<rect x="${at}" y="${i*24+5}" width="11" height="11" fill="${esc(item.color)}"/>`}<text x="${at+21}" y="${i*24+17}" style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;fill:#8d799c">${esc(item.name)}</text>`;}).join('');}).join('')}</svg>`;
        page.drawImage(await image(ls),{x:x+17,y:yy-lh*.75+11,width:b.width-34,height:lh*.75});
      }
      const picture=await image(b.chart.svg),iw=b.d.width*b.scale;page.drawImage(picture,{x:x+(b.width-iw)/2,y:y-b.top-b.svgH,width:iw,height:b.svgH});
      x+=b.width+GAP;onProgress(++completed,totalParts);
    }
    y-=height+GAP;
  }
  const pages=doc.getPages(),generated=manifest.generatedAt.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'});
  pages.forEach((p,i)=>{p.drawLine({start:{x:M,y:34},end:{x:W-M,y:34},thickness:.6,color:border});p.drawText('stc COW Operations | '+manifest.title,{x:M,y:20,size:8,font:regular,color:muted});p.drawText(`Generated ${generated} AST`,{x:W/2-84,y:20,size:8,font:regular,color:muted});p.drawText(`${i+1} / ${pages.length}`,{x:W-M-35,y:20,size:8,font:regular,color:muted});});
  return {bytes:await doc.save(),filename:manifest.filename,pageCount:pages.length,exportedIds:manifest.items.map(i=>i.id),chartPartCount:totalParts,selectedFilters:[...manifest.selectedFilters]};
}

export function savePdfDownload(bytes,filename){
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)?.unref?.();
}
export async function downloadDashboardPdf(manifest,options){const result=await createDashboardPdf(manifest,options);savePdfDownload(result.bytes,result.filename);return result;}

export function openDashboardExport(options){
  const manifest=createDashboardExport(options),dialog=document.createElement('dialog');dialog.className='pdf-export-dialog';dialog.setAttribute('aria-label','Download cards and charts as PDF');
  const choices=type=>manifest.items.filter(i=>i.type===type).map(i=>`<label class="pdf-choice"><input type="checkbox" name="pdf-item" value="${esc(i.id)}" checked><span>${esc(i.label)}</span></label>`).join('');
  dialog.innerHTML=`<form class="pdf-export-form"><div class="pdf-export-heading"><div><span class="eyebrow">DOWNLOAD PDF</span><h2>Cards & charts</h2></div><button type="button" class="icon-button" data-pdf-close aria-label="Close PDF export">×</button></div><p class="pdf-export-scope">${esc(manifest.title)} · ${esc(manifest.period)}</p><div class="pdf-export-toolbar"><p>Choose the items to include.</p><div><button type="button" class="text-button" data-pdf-all>Select all</button><button type="button" class="text-button" data-pdf-none>Clear</button></div></div><div class="pdf-export-choices"><fieldset><legend>Cards</legend>${choices('card')}</fieldset><fieldset><legend>Charts</legend>${choices('chart')}</fieldset></div><div class="pdf-export-bottom"><p class="pdf-export-status" role="status"></p><button type="button" class="button secondary" data-pdf-close>Cancel</button><button class="button primary" type="submit">Download PDF</button></div></form>`;
  const form=dialog.querySelector('form'),inputs=[...dialog.querySelectorAll('input')],status=dialog.querySelector('[role=status]'),submit=dialog.querySelector('[type=submit]');let busy=false,result=null;
  const count=()=>{const ids=new Set(inputs.filter(i=>i.checked).map(i=>i.value)),chosen=manifest.items.filter(i=>ids.has(i.id));submit.disabled=!ids.size;status.textContent=`${chosen.filter(i=>i.type==='card').length} cards · ${chosen.filter(i=>i.type==='chart').length} charts`;};
  dialog.addEventListener('change',count);
  dialog.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||busy)return;if(b.hasAttribute('data-pdf-close'))dialog.close();if(b.hasAttribute('data-pdf-all')||b.hasAttribute('data-pdf-none')){inputs.forEach(i=>i.checked=b.hasAttribute('data-pdf-all'));count();}});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;form.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);status.textContent='Preparing PDF…';
    try{const selected=selectExportItems(manifest,inputs.filter(i=>i.checked).map(i=>i.value));result=await downloadDashboardPdf(selected,{onProgress:(n,total)=>status.textContent=`Preparing charts ${n} of ${total}…`});dialog.close();}
    catch(error){busy=false;form.removeAttribute('aria-busy');dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);status.textContent=error.message;submit.disabled=!inputs.some(i=>i.checked);}
  });
  return new Promise(resolve=>{dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});document.body.append(dialog);count();dialog.showModal();});
}
