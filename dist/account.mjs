const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderUserSettings(user,member){
  const name=user.user_metadata?.display_name||user.user_metadata?.full_name||'',role=member?.active?member.role:'Not assigned';
  return `<div class="user-settings-grid"><section class="panel user-profile"><div class="panel-title"><div><h2>Your account</h2><p>Manage your personal profile.</p></div><span class="user-initial" aria-hidden="true">${esc((name||user.email||'U').trim().slice(0,1).toUpperCase())}</span></div><dl class="user-account-details"><div><dt>Email</dt><dd>${esc(user.email||'—')}</dd></div><div><dt>Dashboard access</dt><dd>${esc(role)}<small>Managed by your administrator</small></dd></div></dl><form id="profile-form" class="form-grid"><label>Display name<input name="display_name" id="profile-display-name" autocomplete="name" maxlength="100" required value="${esc(name)}"></label><p class="account-feedback" data-account-feedback role="status" aria-live="polite"></p><button type="submit" class="button primary">Save profile</button></form><div class="user-signout"><p>Signed in with your Supabase account.</p><button type="button" id="logout-db" class="button secondary">Sign out</button></div></section><section class="panel"><div class="panel-title"><div><h2>Change password</h2><p>Update the password for your Supabase account.</p></div></div><form id="password-form" class="form-grid"><label>Current password<input name="current_password" id="current-password" type="password" autocomplete="current-password" required></label><label>New password<input name="new_password" id="new-password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirm new password<input name="confirm_password" id="confirm-password" type="password" autocomplete="new-password" minlength="8" required></label><p class="help">Use at least 8 characters. Your account’s password policy also applies.</p><p class="account-feedback" data-account-feedback role="status" aria-live="polite"></p><button type="submit" class="button primary">Update password</button></form></section></div>`;
}
export async function saveUserSettings(form,db){
  const button=form.querySelector('[type="submit"]'),feedback=form.querySelector('[data-account-feedback]');
  button.disabled=true;feedback.textContent='Saving…';feedback.dataset.tone='';
  try{
    let user,message;
    if(form.id==='profile-form'){user=await db.updateProfile(form.querySelector('#profile-display-name').value);message='Your profile has been updated.';}
    else if(form.id==='password-form'){
      const current=form.querySelector('#current-password').value,next=form.querySelector('#new-password').value,confirmation=form.querySelector('#confirm-password').value;
      if(next!==confirmation)throw new Error('The new passwords do not match.');
      user=await db.changePassword(current,next);message='Your password has been updated.';
    }else throw new Error('Unknown account action.');
    feedback.textContent=message;feedback.dataset.tone='success';return {user,message};
  }catch(error){feedback.textContent=error.message;feedback.dataset.tone='error';throw error;}
  finally{button.disabled=false;if(form.id==='password-form')for(const id of ['current-password','new-password','confirm-password'])form.querySelector('#'+id).value='';}
}
