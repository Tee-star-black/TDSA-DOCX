// TDSA Document Hub premium interface. UI enhancement only; permissions remain server-side.
const modernRoot=document.querySelector('#app');
const searchIcon='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.7"/><path d="m16 16 4.5 4.5"/></svg>';
const filterIcon='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';
let modernMenu=null;
function closeModernMenu(){
  if(!modernMenu)return;
  modernMenu.menu.hidden=true;
  modernMenu.trigger.setAttribute('aria-expanded','false');
}
function addModernFilter(actions){
  if(actions.querySelector('.modern-filter-wrap'))return;
  const wrap=document.createElement('div');wrap.className='modern-filter-wrap';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='modern-filter';
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-haspopup','menu');
  trigger.innerHTML=filterIcon+' <span>Filter</span>';
  const menu=document.createElement('div');menu.className='modern-filter-menu';menu.hidden=true;
  menu.setAttribute('role','menu');menu.setAttribute('aria-label','Document filters');
  for(const [id,label] of [['all','All documents'],['mine','My files'],['shared','Shared'],['approvals','Approvals'],['expiring','Expiring soon'],['recent','Recently updated'],['archive','Archive']]){
    const item=document.createElement('button');item.type='button';item.textContent=label;item.setAttribute('role','menuitem');
    item.onclick=()=>{
      closeModernMenu();
      const target=modernRoot.querySelector('.explorer-nav-button[data-explorer-filter="'+id+'"]')||modernRoot.querySelector('[data-summary="'+id+'"]');
      target?.click();
    };
    menu.append(item);
  }
  trigger.onclick=()=>{
    const next=menu.hidden;closeModernMenu();menu.hidden=!next;
    trigger.setAttribute('aria-expanded',String(next));
    if(next)menu.querySelector('button')?.focus();
  };
  wrap.append(trigger,menu);
  const bell=actions.querySelector('.explorer-alerts');
  if(bell)actions.insertBefore(wrap,bell);else actions.append(wrap);
  modernMenu={trigger,menu};
}
function enhanceModern(){
  const layout=modernRoot?.querySelector('.layout'),top=modernRoot?.querySelector('.topbar');
  if(!layout||!top){closeModernMenu();return;}
  const brand=top.querySelector('.brand');
  if(brand&&!brand.dataset.modernBrand){
    for(const node of brand.childNodes){
      if(node.nodeType===3&&node.textContent.trim()){node.textContent='TeleDoctorSA';break;}
    }
    brand.dataset.modernBrand='true';
  }
  const user=top.querySelector('.user'),avatar=user?.querySelector('.avatar');
  if(user&&avatar&&!user.querySelector('.modern-avatar-toggle')){
    const toggle=document.createElement('button');toggle.type='button';toggle.className='modern-avatar-toggle';
    toggle.setAttribute('aria-label','Account menu');toggle.setAttribute('aria-expanded','false');
    avatar.replaceWith(toggle);toggle.append(avatar);
    toggle.onclick=()=>{const open=user.classList.toggle('account-open');toggle.setAttribute('aria-expanded',String(open));};
  }
  const sidebar=layout.querySelector('.sidebar'),nav=sidebar?.querySelector('.explorer-navigation'),sections=sidebar?.querySelector('.sections');
  if(nav&&sections&&sections.previousElementSibling!==nav)sidebar.insertBefore(nav,sections);
  const actions=top.querySelector('.explorer-top-actions'),panel=layout.querySelector('#document-panel');
  if(!actions||!panel)return;
  if(!actions.querySelector('.modern-search')){
    const form=panel.querySelector('#search'),shortcut=actions.querySelector('.explorer-search-shortcut');
    if(form){
      form.classList.add('modern-search');
      const input=form.querySelector('input');
      if(input){input.placeholder='Search documents…';input.setAttribute('aria-label','Search documents');}
      const button=form.querySelector('button');
      if(button){button.innerHTML=searchIcon;button.setAttribute('aria-label','Search documents');button.title='Search';}
      if(shortcut)shortcut.replaceWith(form);else actions.prepend(form);
    }
  }
  const upload=actions.querySelector('.explorer-upload'),folder=actions.querySelector('.explorer-new-folder');
  if(upload&&folder&&upload.nextElementSibling!==folder)actions.insertBefore(upload,folder);
  if(!actions.querySelector('.modern-filter-wrap'))addModernFilter(actions);
  if(!panel.dataset.modernRows){
    panel.dataset.modernRows='true';
    for(const glyph of panel.querySelectorAll('.file-icon'))glyph.dataset.type=glyph.textContent.trim().toUpperCase();
  }
}
if(modernRoot){
  const observer=new MutationObserver(enhanceModern);
  observer.observe(modernRoot,{childList:true});
  enhanceModern();
  document.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'){
      closeModernMenu();
      const user=modernRoot.querySelector('.user');user?.classList.remove('account-open');
      user?.querySelector('.modern-avatar-toggle')?.setAttribute('aria-expanded','false');
      return;
    }
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){
      const input=modernRoot.querySelector('.modern-search input');
      if(input){ev.preventDefault();input.focus();input.select();}
    }
  });
  document.addEventListener('pointerdown',ev=>{
    const user=modernRoot.querySelector('.user');
    if(user&&!user.contains(ev.target)){
      user.classList.remove('account-open');
      user.querySelector('.modern-avatar-toggle')?.setAttribute('aria-expanded','false');
    }
    if(modernMenu&&!modernMenu.menu.hidden&&!modernMenu.trigger.parentElement.contains(ev.target))closeModernMenu();
  });
}
