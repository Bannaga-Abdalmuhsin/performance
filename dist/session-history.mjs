const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={online:'Online',inactive:'Inactive',signed_out:'Signed out',expired:'Expired',ended:'Ended',untracked:'Not yet tracked'};
const dateFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
export function sessionTimestamp(value){const d=value?new Date(value):null;return d&&Number.isFinite(d.getTime())?dateFormat.format(d):'—';}
export function sessionDuration(value){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
  const total=Math.max(0,Math.floor(Number(value))),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
  return [h?`${h}h`:'',m?`${m}m`:'',`${s}s`].filter(Boolean).join(' ');
}
export function renderLoginHistory(){
  return `<section class="panel login-history" id="login-history" aria-labelledby="login-history-title"><div class="panel-title"><div><h2 id="login-history-title">Login history</h2><p>Saudi Arabia time · UTC+3</p></div><span class="login-admin-label">Administrator</span></div><form class="login-history-filters"><label>User or session<input type="search" name="search" placeholder="Search email or session ID" maxlength="200"></label><label>Sign-in from<input type="date" name="from" aria-label="Sign-in from"></label><label>Sign-in to<input type="date" name="to" aria-label="Sign-in to"></label><label>Status<select name="status"><option value="all">All sessions</option>${Object.entries(statuses).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><button class="button primary" type="submit">Apply filters</button><button class="button secondary" type="button" data-session-action="refresh">Refresh</button></form><p class="login-history-feedback" role="status" aria-live="polite">Loading login history…</p><div class="data-table-wrap"><table class="data-table login-history-table"><caption class="sr-only">User sign-ins and recorded dashboard activity</caption><thead><tr>${['User','Session','Signed in','Last activity','Signed out','Duration','Status','IP address'].map(title=>`<th scope="col">${title}</th>`).join('')}</tr></thead><tbody><tr><td colspan="8" class="empty">Loading sessions…</td></tr></tbody></table></div><div class="pagination"><span data-session-count></span><div><button type="button" data-session-action="previous" disabled>Previous</button><button type="button" data-session-action="next" disabled>Next</button></div></div><p class="login-history-note">Duration counts recorded time while the dashboard is visible. Browser closure is shown as inactive after the last activity expires. Earlier duration and sign-out details are unavailable when they were not recorded.</p></section>`;
}
export function renderSessionRows(rows){
  if(!rows.length)return '<tr><td colspan="8" class="empty">No sessions match these filters.</td></tr>';
  return rows.map(row=>`<tr><td class="login-email">${escape(row.email)}</td><td><span class="login-session-id" title="${escape(row.session_id)}">${escape(String(row.session_id||'').slice(0,8))}</span></td><td>${escape(sessionTimestamp(row.signed_in_at))}</td><td>${escape(sessionTimestamp(row.last_seen_at))}</td><td>${escape(sessionTimestamp(row.signed_out_at))}</td><td>${escape(sessionDuration(row.duration_seconds))}</td><td><span class="login-status ${row.status==='online'?'online':''}">${escape(statuses[row.status]||'Unknown')}</span></td><td class="login-ip">${escape(row.ip_address||'Not recorded')}</td></tr>`).join('');
}
const mounted=new WeakMap();
export function mountLoginHistory(root,db,member){
  if(!db?.session||!member?.active||member.role!=='admin')return;
  const panel=root?.querySelector('#login-history');if(!panel||mounted.has(panel))return;
  const form=panel.querySelector('form'),feedback=panel.querySelector('.login-history-feedback'),tbody=panel.querySelector('tbody');
  const count=panel.querySelector('[data-session-count]'),previous=panel.querySelector('[data-session-action="previous"]'),next=panel.querySelector('[data-session-action="next"]');
  let offset=0,requestId=0,busy=false,filters={from:'',to:'',search:'',status:'all'};
  async function load(){
    const id=++requestId;busy=true;panel.setAttribute('aria-busy','true');feedback.textContent='Loading login history…';feedback.dataset.tone='';previous.disabled=next.disabled=true;
    try{
      const result=await db.loginSessions({...filters,offset,limit:25});
      if(id!==requestId||!panel.isConnected)return;
      tbody.innerHTML=renderSessionRows(result.rows||[]);const total=Number(result.total)||0;
      count.textContent=total?`${offset+1}–${Math.min(offset+25,total)} of ${total} sessions`:'0 sessions';
      previous.disabled=offset===0;next.disabled=offset+25>=total;
      feedback.textContent=`Updated ${sessionTimestamp(result.generated_at)}`;
    }catch(error){if(id!==requestId||!panel.isConnected)return;tbody.innerHTML='<tr><td colspan="8" class="empty">Login history could not be loaded.</td></tr>';count.textContent='';feedback.textContent=error.message;feedback.dataset.tone='error';}
    finally{if(id===requestId){busy=false;panel.setAttribute('aria-busy','false');}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();const values=new FormData(form);const from=String(values.get('from')||''),to=String(values.get('to')||'');if(from&&to&&from>to){feedback.textContent='The start date must be on or before the end date.';feedback.dataset.tone='error';return;}filters={from,to,search:String(values.get('search')||'').trim(),status:String(values.get('status')||'all')};offset=0;load();});
  panel.querySelector('[data-session-action="refresh"]').addEventListener('click',()=>load());
  previous.addEventListener('click',()=>{if(offset>0){offset=Math.max(0,offset-25);load();}});
  next.addEventListener('click',()=>{if(!next.disabled){offset+=25;load();}});
  const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return;}if(document.visibilityState!=='hidden'&&!busy)load();},30000);timer?.unref?.();
  mounted.set(panel,{load});load();
}
export function createSessionTracker({getDatabase,canTrack,document:doc=globalThis.document,window:win=globalThis.window,setInterval:every=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval}){
  let timer=null,enabled=false,inFlight=false;
  async function send(event='active',keepalive=false){
    if(!enabled||!canTrack()||!getDatabase()?.session||inFlight)return;
    if(event==='active'&&doc?.visibilityState==='hidden')return;
    inFlight=true;try{await getDatabase().trackSession(event,{keepalive});}catch{/* Activity telemetry must not block the dashboard. */}finally{inFlight=false;}
  }
  const visibility=()=>send(doc?.visibilityState==='hidden'?'pause':'active');
  doc?.addEventListener?.('visibilitychange',visibility);win?.addEventListener?.('pagehide',()=>send('pause',true));win?.addEventListener?.('pageshow',()=>send());
  return {start(){enabled=true;if(!timer){timer=every(()=>send(),30000);timer?.unref?.();}void send();},stop(){enabled=false;if(timer)cancel(timer);timer=null;},send};
}
