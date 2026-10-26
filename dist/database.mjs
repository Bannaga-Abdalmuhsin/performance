import {FIELDS,IMPORT_FIELDS} from './core.mjs?v=20261026all';
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
  rememberUser(user){
    if(!user?.id||(this.session?.user?.id&&user.id!==this.session.user.id))throw new Error('The account could not be verified. Sign out and sign in again.');
    this.session.user=user;sessionStorage.setItem(SESSION,JSON.stringify(this.session));return user;
  }
  async getUser(){return this.rememberUser(await this.request('/auth/v1/user'));}
  async updateProfile(displayName){
    const name=String(displayName||'').trim();if(!name||name.length>100)throw new Error('Enter a display name between 1 and 100 characters.');
    return this.rememberUser(await this.request('/auth/v1/user',{method:'PUT',body:JSON.stringify({data:{display_name:name}})}));
  }
  async changePassword(currentPassword,newPassword){
    if(!currentPassword)throw new Error('Enter your current password.');
    if(typeof newPassword!=='string'||newPassword.length<8)throw new Error('Use at least 8 characters for your new password.');
    if(newPassword===currentPassword)throw new Error('Choose a different new password.');
    const id=this.session?.user?.id,email=this.session?.user?.email;if(!id||!email)throw new Error('Sign in before changing your password.');
    const verified=await this.login(email,currentPassword);if(verified.id!==id){this.session=null;sessionStorage.removeItem(SESSION);throw new Error('The account could not be verified. Sign in again.');}
    return this.rememberUser(await this.request('/auth/v1/user',{method:'PUT',body:JSON.stringify({password:newPassword,current_password:currentPassword})}));
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
  async member(){const r=await this.request('/rest/v1/performance_members?select=role,active&user_id=eq.'+encodeURIComponent(this.session.user.id));if(!r.length||!r[0].active)throw new Error('Performance access is not enabled for '+(this.session.user.email||'this account')+'. Ask the project owner to approve this email.');return r[0];}
  async latest(){return (await this.request('/rest/v1/performance_imports?select=id,status,metadata,record_count,min_date,max_date,completed_at,source_name&status=eq.complete&order=completed_at.desc,id.desc&limit=1'))[0]||null;}
  async load(progress=()=>{}) {
    await this.member();
    const first=await this.latest();
    if(!first||first.status!=='complete')throw new Error('No completed performance import is available yet.');
    const page=1000,records=[];let cursor='';
    // Every row is pinned to one immutable completed snapshot. A pending or
    // failed upload cannot replace the last verified dashboard version.
    while(true){
      const rows=await this.request('/rest/v1/performance_tickets?select='+FIELDS.join(',')+'&import_id=eq.'+first.id+'&order=id.asc&limit='+page+(cursor?'&id=gt.'+encodeURIComponent(cursor):''));
      records.push(...rows);progress(records.length);
      if(!rows.length)break;const next=rows.at(-1).id;if(typeof next!=='string'||(cursor&&next<=cursor))throw new Error('Invalid database pagination cursor. No dashboard data was replaced.');cursor=next;
    }
    if(records.length!==first.record_count)throw new Error('Snapshot count mismatch. No dashboard data was replaced.');
    const meta={...first.metadata,record_count:records.length,min_date:first.min_date,max_date:first.max_date,import_id:first.id,completed_at:first.completed_at};
    if(!records.length)throw new Error('The completed import returned no visible tickets. Check database access.');
    return {meta,records};
  }
  async import(records,meta,progress=()=>{}) {
    const member=await this.member();if(!['admin','analyst'].includes(member.role))throw new Error('Analyst or administrator access is required to import.');
    const [batch]=await this.request('/rest/v1/performance_imports',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({source_name:meta.source_workbook||'Performance upload',source_sha256:meta.source_sha256||null,metadata:meta,min_date:meta.min_date,max_date:meta.max_date,record_count:records.length,status:'pending'})});
    try {
      for(let i=0;i<records.length;i+=500){const chunk=records.slice(i,i+500).map(r=>({...Object.fromEntries(IMPORT_FIELDS.map(k=>[k,r[k]??null])),sla_excluded:!!r.sla_excluded,quality_flags:r.quality_flags||[],import_id:batch.id,updated_at:new Date().toISOString()}));
        await this.request('/rest/v1/performance_tickets?on_conflict=import_id,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(chunk)});progress(Math.min(i+500,records.length),records.length);}
      await this.request('/rest/v1/rpc/performance_complete_import',{method:'POST',body:JSON.stringify({batch_id:batch.id,expected_count:records.length})});
    }catch(error){try{await this.request('/rest/v1/performance_imports?id=eq.'+batch.id,{method:'PATCH',body:JSON.stringify({status:'failed'})});}catch{}throw new Error('Import did not complete. The previous complete snapshot is still live. Retry the file as a new batch. '+error.message);}
    return batch.id;
  }
  async getReview(key){return (await this.request('/rest/v1/performance_reviews?select=*&review_key=eq.'+encodeURIComponent(key)))[0]||null;}
  async saveReview(review){await this.request('/rest/v1/performance_reviews?on_conflict=review_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({...review,updated_by:this.session.user.id,updated_at:new Date().toISOString()})});}
}
