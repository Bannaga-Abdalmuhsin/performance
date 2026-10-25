import {renderChartBoard,renderSupportingMetrics} from './charts.mjs?v=20261025slalayout';
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const date=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable';
const colors=['#4f008c','#ff375e','#a7a0b2'];
function subtitle(report){return `${report.definition.impact==='NSA'?'Non-service affected · impact other than Outage':'Services affected · Outage'} · All recorded faults`;}
function seriesHeader(report){return `<div class="report-series">${report.series.map((s,i)=>`<div class="report-series-item ${i===0?'current':''}"><span class="report-series-label"><i style="background:${colors[i]}"></i>${i===0?'Review period':i===1?'Comparison':'Earlier comparison'}</span><b>${esc(s.range?.label||'Week unavailable in this year')}</b><span>${s.range?date(s.range.start)+' – '+date(s.range.end):'Calendar has no matching week'}</span></div>`).join('')}</div>`;}
export function renderReport(report,state,meta){
  return `<div class="section-heading bi-page-heading"><div><h2>${esc(report.now.range?.label||'Period unavailable')}</h2><p>${esc(subtitle(report))}</p></div><span class="period-badge ${report.now.partial?'partial':''}">${report.now.partial?'Partial coverage':'All recorded data'}</span></div>${seriesHeader(report)}
  ${renderChartBoard(report,state,meta)}
  ${renderSupportingMetrics(report,state,meta)}
  `;
}
