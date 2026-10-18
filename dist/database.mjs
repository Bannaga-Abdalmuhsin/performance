import {FIELDS} from './core.mjs';
const SESSION='cow-performance-session';
export function validatePublicKey(key) {
  if(key.startsWith('sb_secret_'))throw new Error('Use the publishable key. Secret keys cannot be used in this page.');
  if(key.startsWith('sb_publishable_'))return true;
  try { const p=JSON.parse(atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(p.role==='anon')return true; }catch{}
  throw new Error('Enter the project publishable key or legacy anon key.');
}
export class PerformanceDatabase {
  constructor(url,key) {
    const parsed=new URL(url); if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co'))throw new Error('Use your HTTPS Supabase project URL.');
    validatePublicKey(key);this.url=parsed.origin;this.key=key;
    try {const s=JSON.parse(sessionStorage.getItem(SESSION));this.session=s?.url===this.url?s:null;}catch{this.session=null;}
  }
  saveSession(data) {this.session={...data,url:this.url,expires_at:Date.now()+(data.expires_in||3600)*1000};sessionStorage.setItem(SESSION,JSON.stringify(this.session));}
  async login(email,password) {
    const r=await fetch(this.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:this.key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const body=await r.json();if(!r.ok)throw new Error(body.msg||body.error_description||body.message||'Sign-in failed.');
    this.saveSession(body);return body.user;
  }
  async refresh() {
    if(!this.session)throw new Error('Sign in to the performance database first.');
    if(this.session.expires_at>Date.now()+60000)return;
    const r=await fetch(this.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:this.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:this.session.refresh_token})});
    const data=await r.json();if(!r.ok){this.session=null;sessionStorage.removeItem(SESSION);throw new Error('Your database session expired. Please sign in again.');}this.saveSession(data);
  }
  async logout(){try{await this.request('/auth/v1/logout',{method:'POST'});}finally{this.session=null;sessionStorage.removeItem(SESSION);}}
  async request(path,options={}) {
    await this.refresh();
    const r=await fetch(this.url+path,{...options,headers:{apikey:this.key,Authorization:'Bearer '+this.session.access_token,'Content-Type':'application/json',...options.headers}});
    if(!r.ok){let e;try{e=await r.json();}catch{}throw new Error(e?.message||e?.msg||`Database request failed (${r.status}).`);}
    if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null;
  }
  async member(){const r=await this.request('/rest/v1/performance_members?select=role,active&user_id=eq.'+encodeURIComponent(this.session.user.id));if(!r.length||!r[0].active)throw new Error('Your account needs performance access. Ask the project administrator to add it to performance_members.');return r[0];}
  async load(progress=()=>{}) {
    await this.member();
    const latestPath='/rest/v1/performance_imports?select=*&order=imported_at.desc&limit=1';
    const imports=await this.request(latestPath);
    if(!imports.length)throw new Error('No performance import is available yet.');
    if(imports[0].status!=='complete')throw new Error('The latest import is '+imports[0].status+'. Complete or retry that import before reviewing database results.');
    const first=imports[0],page=1000,records=[];let cursor='';
    // Keyset pagination remains stable and does not silently stop at the default
    // API row limit. The full import must succeed before the UI swaps data.
    while(true){
      const rows=await this.request('/rest/v1/performance_tickets?select='+FIELDS.join(',')+'&order=id.asc&limit='+page+(cursor?'&id=gt.'+encodeURIComponent(cursor):''));
      records.push(...rows);progress(records.length);
      if(!rows.length)break;cursor=rows.at(-1).id;
    }
    const [latest]=await this.request(latestPath);
    if(latest?.id!==first.id||latest?.status!=='complete')throw new Error('The source changed while loading. Reload once the latest import completes.');
    const meta={...first.metadata,record_count:records.length};
    if(!records.length)throw new Error('The completed import returned no visible tickets. Check database access.');
    meta.min_date=records.reduce((m,r)=>r.created_date<m?r.created_date:m,records[0].created_date);
    meta.max_date=records.reduce((m,r)=>r.created_date>m?r.created_date:m,records[0].created_date);
    return {meta,records};
  }
  async import(records,meta,progress=()=>{}) {
    const member=await this.member();if(!['admin','analyst'].includes(member.role))throw new Error('Analyst or administrator access is required to import.');
    const [batch]=await this.request('/rest/v1/performance_imports',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({source_name:meta.source_workbook||'Performance upload',source_sha256:meta.source_sha256||null,metadata:meta,min_date:meta.min_date,max_date:meta.max_date,record_count:records.length,status:'pending'})});
    try {
      for(let i=0;i<records.length;i+=500){const chunk=records.slice(i,i+500).map(r=>({...Object.fromEntries(FIELDS.map(k=>[k,r[k]??null])),sla_excluded:!!r.sla_excluded,quality_flags:r.quality_flags||[],import_id:batch.id,updated_at:new Date().toISOString()}));
        await this.request('/rest/v1/performance_tickets?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(chunk)});progress(Math.min(i+500,records.length),records.length);}
      await this.request('/rest/v1/rpc/performance_complete_import',{method:'POST',body:JSON.stringify({batch_id:batch.id,expected_count:records.length})});
    }catch(error){try{await this.request('/rest/v1/performance_imports?id=eq.'+batch.id,{method:'PATCH',body:JSON.stringify({status:'failed'})});}catch{}throw new Error('Import did not complete. Some rows may have been upserted; retry the same file to finish. '+error.message);}
    return batch.id;
  }
  async getReview(key){return (await this.request('/rest/v1/performance_reviews?select=*&review_key=eq.'+encodeURIComponent(key)))[0]||null;}
  async saveReview(review){await this.request('/rest/v1/performance_reviews?on_conflict=review_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({...review,updated_by:this.session.user.id,updated_at:new Date().toISOString()})});}
}
