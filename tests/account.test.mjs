import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceDatabase} from '../dist/database.mjs';
import {renderUserSettings,saveUserSettings} from '../dist/account.mjs';
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const user={id:'user1',email:'user@example.com',user_metadata:{display_name:'Old name',role:'admin'},app_metadata:{}};
function db(){const d=new PerformanceDatabase('https://example.supabase.co','sb_publishable_test');d.session={url:d.url,user:structuredClone(user),access_token:'token',expires_at:Date.now()+3600000};return d;}
test('user settings shows account controls, escapes names and never trusts editable profile roles',()=>{
 const html=renderUserSettings({...user,user_metadata:{display_name:'<script>test</script>',role:'admin'}},{role:'viewer',active:true});
 assert.match(html,/&lt;script&gt;test&lt;\/script&gt;/);assert.ok(!html.includes('<script>'));assert.match(html,/>viewer</);assert.ok(!html.includes('>admin<'));assert.match(html,/id="profile-form"/);assert.match(html,/id="password-form"/);assert.match(html,/id="logout-db"/);for(const text of ['import-file','project-key','project-url','Source and coverage'])assert.ok(!html.includes(text));
});
test('profile updates use the current user endpoint and can only write display name metadata',async()=>{
 const d=db();let call;d.request=async(path,options)=>{call={path,...options};return {...user,user_metadata:{display_name:'New name'}};};const updated=await d.updateProfile(' New name ');assert.equal(call.path,'/auth/v1/user');assert.equal(call.method,'PUT');assert.deepEqual(JSON.parse(call.body),{data:{display_name:'New name'}});assert.equal(updated.id,user.id);assert.equal(d.session.user.user_metadata.display_name,'New name');
});
test('a wrong current password stops before any password update',async()=>{
 const d=db();let updated=false;d.login=async(email,password)=>{assert.equal(email,user.email);assert.equal(password,'wrong-password');throw new Error('Invalid login credentials');};d.request=async()=>{updated=true;};await assert.rejects(()=>d.changePassword('wrong-password','new-password-123'),/Invalid login/);assert.equal(updated,false);
});
test('password changes verify the same account and send both passwords only to Auth',async()=>{
 const d=db(),calls=[];d.login=async(email,password)=>{calls.push({email,password});return user;};d.request=async(path,options)=>{calls.push({path,...options});return user;};await d.changePassword('current-password','new-password-123');assert.equal(calls[0].email,user.email);assert.equal(calls[1].path,'/auth/v1/user');assert.equal(calls[1].method,'PUT');assert.deepEqual(JSON.parse(calls[1].body),{password:'new-password-123',current_password:'current-password'});
});
test('reauthentication cannot switch account identity during password changes',async()=>{
 const d=db();let updated=false;d.login=async()=>({id:'another-user'});d.request=async()=>{updated=true;};await assert.rejects(()=>d.changePassword('current-password','new-password-123'),/verified/);assert.equal(updated,false);assert.equal(d.session,null);
});
test('mismatched password confirmation sends no update and clears every password field',async()=>{
 const elements=new Map([['[type="submit"]',{disabled:false}],['[data-account-feedback]',{textContent:'',dataset:{}}],['#current-password',{value:'current'}],['#new-password',{value:'new-password'}],['#confirm-password',{value:'different'}]]),form={id:'password-form',querySelector:key=>elements.get(key)};let sent=false;await assert.rejects(()=>saveUserSettings(form,{changePassword:async()=>{sent=true;}}),/do not match/);assert.equal(sent,false);for(const id of ['current-password','new-password','confirm-password'])assert.equal(elements.get('#'+id).value,'');assert.equal(elements.get('[type="submit"]').disabled,false);assert.equal(elements.get('[data-account-feedback]').dataset.tone,'error');
});
