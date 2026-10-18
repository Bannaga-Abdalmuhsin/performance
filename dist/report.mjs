import {num} from './core.mjs?v=20261018report';
import {renderChartBoard} from './charts.mjs?v=20261018report';
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const n=(v,d=0)=>num(v)?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const hrs=v=>num(v)?n(v/60,1):'—';
const date=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable';
const colors=['#4f008c','#ff375e','#a7a0b2'];
function coverage(s){return !s.covered?'Outside source coverage':s.partial?'Partial source coverage':'Within source date range';}
function subtitle(report){return `${report.definition.impact==='NSA'?'Non-service affected · impact other than Outage':'Services affected · Outage'} · All recorded faults`;}
function seriesHeader(report){return `<div class="report-series">${report.series.map((s,i)=>`<div class="report-series-item ${i===0?'current':''}"><span class="report-series-label"><i style="background:${colors[i]}"></i>${i===0?'Review period':i===1?'Comparison':'Earlier comparison'}</span><b>${esc(s.range?.label||'Week unavailable in this year')}</b><span>${s.range?date(s.range.start)+' – '+date(s.range.end):'Calendar has no matching week'}</span><small class="${s.partial?'partial':''}">${coverage(s)} · ${n(s.summary?.tickets)} tickets</small></div>`).join('')}</div>`;}
export function renderReport(report,state,meta){
  const s=report.now.summary;
  return `<div class="section-heading bi-page-heading"><div><h2>${esc(report.now.range?.label||'Period unavailable')}</h2><p>${esc(subtitle(report))}</p></div><span class="period-badge ${report.now.partial?'partial':''}">${report.now.partial?'Partial coverage':'All recorded data'}</span></div>${seriesHeader(report)}
  ${renderChartBoard(report,state,meta)}
  <div class="report-metrics bi-supporting-metrics"><div><b>${n(s?.sites)}</b><span>COWs with tickets</span></div><div><b>${n(s?.repeatSites)}</b><span>COWs with 2+ tickets</span></div><div><b>${hrs(s?.mttr)} <small>hrs</small></b><span>Mean recorded restoration</span></div><div><b>${n(s?.slaCompliance,1)}<small>%</small></b><span>Source SLA compliance · ${n(s?.slaEligible)} eligible</span></div></div>
  `;
}
