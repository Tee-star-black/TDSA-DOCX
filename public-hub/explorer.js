// TDSA Document Hub explorer: view-layer only. Authorisation stays in the API.
// Server-side filtered rows are the only documents that this UI can display.
const app = document.querySelector('#app');
const categories = {
  compliance: ['Clinical & Medical','Compliance & Governance','Operations','Projects','Templates & Forms'],
  hr: ['HR & Staff','Operations','Projects','Templates & Forms'],
};
const icon = {
  folder:'<path d="M3 6.5h7l2 2H21v10H3z"/>',
  file:'<path d="M6 2h8l5 5v15H6zM14 2v6h6"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  arrow:'<path d="m9 18 6-6-6-6"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  layers:'<path d="m12 2 10 6-10 6L2 8zM2 13l10 6 10-6"/>',
  close:'<path d="M5 5 19 19M19 5 5 19"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
function ico(name,size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icon[name]||icon.file}</svg>`;}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pref={filter:'all',expanded:new Set(),selected:null,openFolders:false,scope:'',principal:null,register:null,loading:false,token:0,contextEpoch:0,allowOpen:false};
const DATE_WINDOW=30*86400000;
function parseDate(value){if(!value)return null;const date=new Date(String(value).slice(0,10)+'T00:00:00Z');return Number.isNaN(+date)?null:date;}
function withinThirty(value){const t=parseDate(value);if(!t)return false;const today=new Date();today.setUTCHours(0,0,0,0);return +t<=+today+DATE_WINDOW;}
function dateLabel(value){const d=parseDate(value);return d?d.toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Not set';}
function statusFor(row){
  if(row.dataset.archived==='true')return {text:'Archived',tone:'neutral'};
  if(row.dataset.approval==='pending')return {text:'Awaiting approval',tone:'amber'};
  if(row.dataset.approval==='rejected')return {text:'Changes requested',tone:'red'};
  if(row.dataset.expiry && parseDate(row.dataset.expiry)<new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'))return {text:'Expired',tone:'red'};
  if(withinThirty(row.dataset.expiry))return {text:'Expiring soon',tone:'amber'};
  if(row.dataset.approval==='approved'&&!row.dataset.published)return {text:'Ready to publish',tone:'blue'};
  if(row.dataset.published)return {text:'Approved',tone:'green'};
  if(row.dataset.controlled==='true')return {text:'Draft',tone:'neutral'};
  if(withinThirty(row.dataset.review))return {text:'Review due',tone:'amber'};
  return {text:'Active',tone:'muted'};
}
function actionable(row){return row.dataset.approval==='pending'&&row.dataset.latestAuthor!==pref.principal&&row.dataset.submitter!==pref.principal&&document.querySelector('.layout')?.dataset.role==='manager';}
function getPanel(){return app?.querySelector('#document-panel');}
function getScope(){return app?.querySelector('.layout')?.dataset.apiBase||'';}
function rowCollection(panel=getPanel()){return [...(panel?.querySelectorAll('tbody tr')||[])].filter(x=>x.querySelector('.file-name'));}
function allRows(){return rowCollection();}
function headingFor(filter){const names={all:'All documents',mine:'My documents',shared:'Shared with me',approvals:'Awaiting my approval',expiring:'Expiring soon',archive:'Archived documents',missing:'Missing required documents'};return names[filter]||filter.replace(/^category:/,'');}
function matching(row,filter){
  if(filter==='archive')return row.dataset.archived==='true';
  if(row.dataset.archived==='true')return false;
  if(filter==='all')return true;
  if(filter==='mine')return [row.dataset.owner,row.dataset.author,row.dataset.subject].includes(pref.principal);
  if(filter==='shared')return row.dataset.privacy==='restricted'&&row.dataset.owner!==pref.principal&&row.dataset.author!==pref.principal;
  if(filter==='approvals')return actionable(row);
  if(filter==='expiring')return withinThirty(row.dataset.expiry);
  if(filter.startsWith('category:'))return row.dataset.category===filter.slice(9);
  return true;
}
function announce(message){const area=document.querySelector('#explorer-status');if(area)area.textContent=message;}
async function getJSON(url,opts={}){
  const headers={'Accept':'application/json',...opts.headers};
  if(opts.body){const session=await getJSON('/api/session');headers['Content-Type']='application/json';headers['X-CSRF-Token']=session.csrfToken;}
  const r=await fetch(url,{...opts,headers,credentials:'same-origin'});
  let data;try{data=await r.json();}catch{throw Error('Could not read the server response');}
  if(!r.ok)throw Error(data.message||'This action could not be completed');
  return data;
}
function createElement(tag,cls,content){const elem=document.createElement(tag);if(cls)elem.className=cls;if(content!==undefined)elem.innerHTML=content;return elem;}
async function loadContext(epoch){
  try{const session=await getJSON('/api/session');if(epoch===pref.contextEpoch)pref.principal=session.principalId;}catch{if(epoch===pref.contextEpoch)pref.principal=null;}
}
async function loadRegister(scope,epoch){
  try{const data=await getJSON(scope+'/register');if(getScope()!==scope||epoch!==pref.contextEpoch)return;pref.register=data;updateCounts();if(pref.filter==='missing')showRequirements();}catch{if(epoch===pref.contextEpoch){pref.register=null;updateCounts();}}
}
function makeNav(sidebar){
  if(sidebar.querySelector('.explorer-navigation'))return;
  const nav=createElement('nav','explorer-navigation');nav.setAttribute('aria-label','Document navigation');
  const items=[['all','All documents','file'],['mine','My documents','file'],['shared','Shared with me','layers'],['approvals','Approvals','check'],['expiring','Expiring soon','clock'],['archive','Archive','folder']];
  nav.innerHTML='<p class="explorer-caption">DOCUMENTS</p>'+items.map(([key,label,ic])=>`<button type="button" class="explorer-nav-button" data-explorer-filter="${key}" aria-current="${pref.filter===key?'page':'false'}">${ico(ic)}<span>${label}</span><b data-nav-count="${key}" aria-hidden="true"></b></button>`).join('');
  const old=sidebar.querySelector('.folder-title');
  if(old)sidebar.insertBefore(nav,old);else sidebar.append(nav);
  nav.querySelectorAll('[data-explorer-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.explorerFilter));
}
function makeCategories(sidebar){
  if(sidebar.querySelector('.explorer-categories'))return;
  const section=app.querySelector('.layout')?.dataset.section||'compliance';
  const labels=categories[section]||[];
  const el=createElement('div','explorer-categories');
  el.innerHTML=`<p class="explorer-caption">CATEGORIES</p>${labels.map(label=>`<button type="button" class="explorer-category" data-category-filter="${escapeHTML(label)}">${ico('folder',15)}<span>${escapeHTML(label)}</span></button>`).join('')}`;
  const note=sidebar.querySelector('.side-note');if(note)sidebar.insertBefore(el,note);else sidebar.append(el);
  el.querySelectorAll('[data-category-filter]').forEach(b=>b.onclick=()=>setFilter('category:'+b.dataset.categoryFilter));
}
function makeFolderTree(sidebar){
  const source=sidebar.querySelector('.folders');if(!source||source.dataset.nested==='true')return;
  source.dataset.nested='true';
  const buttons=[...source.querySelectorAll('button.folder-link')];
  if(buttons.length<2)return;
  const root=buttons.find(b=>b.dataset.folder==='');
  const byParent=new Map();
  for(const b of buttons){if(b===root)continue;const parent=b.dataset.parent||'';if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(b);}
  const seen=new Set();
  function addNodes(parent,target,depth){if(depth>10)return;for(const button of byParent.get(parent)||[]){const id=button.dataset.folder;if(seen.has(id))continue;seen.add(id);
    const item=createElement('div','explorer-tree-node');item.dataset.folderNode=id;
    const line=createElement('div','explorer-tree-line');
    if(byParent.has(id)){const toggle=createElement('button','explorer-tree-toggle',ico('chevron',13));toggle.type='button';toggle.setAttribute('aria-label',`Expand ${button.textContent.trim()}`);toggle.setAttribute('aria-expanded',String(pref.expanded.has(id)));toggle.onclick=()=>{pref.expanded.has(id)?pref.expanded.delete(id):pref.expanded.add(id);const exp=pref.expanded.has(id);toggle.setAttribute('aria-expanded',String(exp));item.querySelector(':scope > .explorer-tree-children').hidden=!exp;};line.append(toggle);}
    else line.append(createElement('span','explorer-tree-indent'));
    button.textContent=button.textContent.replace(/^[↳▱]\s*/,'');line.append(button);item.append(line);
    const children=createElement('div','explorer-tree-children');children.hidden=!pref.expanded.has(id);item.append(children);addNodes(id,children,depth+1);target.append(item);
  }}
  source.replaceChildren();if(root)source.append(root);addNodes('',source,0);
  for(const b of buttons){if(b!==root&&!seen.has(b.dataset.folder))source.append(b);}
}
function addTopActions(){
  const top=app.querySelector('.topbar'),main=app.querySelector('.main');if(!top||top.querySelector('.explorer-top-actions')||!main)return;
  const actions=createElement('div','explorer-top-actions');
  actions.innerHTML=`<button class="explorer-mobile-toggle" id="explorer-mobile-toggle" aria-label="Open folders and navigation" aria-expanded="false">${ico('menu')}</button><button type="button" class="explorer-search-shortcut">${ico('search')}<span>Search documents</span><kbd>/</kbd></button><button type="button" class="explorer-new-folder">${ico('folder')}<span>New folder</span></button><button type="button" class="explorer-upload">${ico('upload')}<span>Upload</span></button><button type="button" class="explorer-alerts" aria-label="Show approvals awaiting your review">${ico('bell')}<i data-alert-count></i></button>`;
  const user=top.querySelector('.user');if(user)top.insertBefore(actions,user);else top.append(actions);
  actions.querySelector('.explorer-search-shortcut').onclick=()=>main.querySelector('#search input')?.focus();
  actions.querySelector('.explorer-new-folder').onclick=()=>app.querySelector('#new-folder')?.click();
  actions.querySelector('.explorer-upload').onclick=()=>app.querySelector('#upload')?.click();
  actions.querySelector('.explorer-alerts').onclick=()=>setFilter('approvals');
  actions.querySelector('.explorer-mobile-toggle').onclick=()=>toggleMobile(true);
  const editable=app.querySelector('.layout')?.dataset.role!=='reader';
  actions.querySelector('.explorer-new-folder').hidden=!editable;
  actions.querySelector('.explorer-upload').hidden=!editable;
}
function toggleMobile(show){pref.openFolders=show;const sidebar=app.querySelector('.sidebar'),button=app.querySelector('#explorer-mobile-toggle');if(sidebar)sidebar.classList.toggle('mobile-open',show);if(button)button.setAttribute('aria-expanded',String(show));document.body.classList.toggle('explorer-nav-open',show);const veil=document.querySelector('#explorer-veil');if(veil)veil.hidden=!show;}
function enrichTable(panel){
  for(const row of rowCollection(panel)){
    const s=statusFor(row);
    const status=row.querySelector('[data-document-status]');if(status)status.innerHTML=`<span class="document-status ${s.tone}"><i></i>${s.text}</span>`;
    row.dataset.searchTitle=row.querySelector('.file-name')?.textContent?.trim()||'';
    row.querySelector('.file-name')?.setAttribute('aria-label',`Preview ${row.dataset.searchTitle}`);
  }
  panel.addEventListener('click',ev=>{
    const button=ev.target.closest('.file-name');
    if(!button||pref.allowOpen)return;
    ev.stopPropagation();ev.stopImmediatePropagation();ev.preventDefault();
    const id=button.dataset.file;if(id)openInspector(id,button.textContent.trim());
  },true);
}
function addSummary(main){
  if(main.querySelector('.explorer-dashboard'))return;
  const old=main.querySelector('.stats');if(old)old.hidden=true;
  const strip=createElement('section','explorer-dashboard');strip.setAttribute('aria-label','Document actions requiring attention');
  strip.innerHTML=`<button type="button" data-summary="approvals"><span>AWAITING MY APPROVAL</span><strong data-count-approvals>0</strong><small>Open review queue ${ico('arrow',15)}</small></button><button type="button" data-summary="expiring"><span>EXPIRING SOON</span><strong data-count-expiring>0</strong><small>Expired or due in 30 days ${ico('arrow',15)}</small></button><button type="button" data-summary="missing"><span>MISSING REQUIRED DOCUMENTS</span><strong data-count-missing>—</strong><small data-required-hint>Requirement register not configured</small></button>`;
  const panel=main.querySelector('#document-panel');if(panel)main.insertBefore(strip,panel);else main.append(strip);
  strip.querySelectorAll('[data-summary]').forEach(b=>b.onclick=()=>setFilter(b.dataset.summary));
}
function addInspector(main){
  if(main.querySelector('#explorer-inspector'))return;
  const inspector=createElement('aside','explorer-inspector');inspector.id='explorer-inspector';inspector.setAttribute('aria-label','Selected document details');
  inspector.innerHTML=`<div class="explorer-empty-inspector">${ico('file',32)}<h2>Document details</h2><p>Select a document to preview it, review its history, and see available actions.</p></div>`;
  const panel=main.querySelector('#document-panel');if(!panel)return;
  const shell=createElement('div','explorer-work-area');const list=createElement('div','explorer-document-list');
  panel.replaceWith(shell);shell.append(list,inspector);list.append(panel);
}
function updateCounts(){
  const panel=getPanel();if(!panel)return;
  const rows=rowCollection(panel);
  const approvals=rows.filter(actionable).length;
  const expiring=rows.filter(r=>r.dataset.archived!=='true'&&withinThirty(r.dataset.expiry)).length;
  const missing=pref.register?.configured?pref.register.missing:null;
  const figures={approvals,expiring,missing:missing===null?'—':missing};
  for(const [name,count]of Object.entries(figures)){
    const el=app.querySelector(`[data-count-${name}]`);if(el)el.textContent=String(count);
  }
  const helper=app.querySelector('[data-required-hint]');if(helper)helper.textContent=missing===null?'Set up required documents':'View missing documents';
  const alerts=app.querySelector('[data-alert-count]');if(alerts){alerts.textContent=approvals?String(approvals):'';alerts.hidden=!approvals;}
  for(const filter of ['approvals','expiring']){const count=app.querySelector(`[data-nav-count="${filter}"]`);if(count)count.textContent=String(figures[filter]);}
}
function applyFilter(){
  const panel=getPanel();if(!panel)return;
  const current=pref.filter;
  const isMissing=current==='missing';
  const list=app.querySelector('.explorer-document-list');
  if(list)list.hidden=isMissing;
  const requirements=app.querySelector('#explorer-requirements');if(requirements)requirements.hidden=!isMissing;
  const shouldArchive=current==='archive';
  const select=panel.querySelector('#archive');if(select&&select.value!==(shouldArchive?'archive':'active')){select.value=shouldArchive?'archive':'active';select.dispatchEvent(new Event('change',{bubbles:true}));return;}
  const rows=rowCollection(panel);let visible=0;
  for(const row of rows){row.hidden=!matching(row,current);if(!row.hidden)visible++;}
  const heading=panel.querySelector('.panel-head h2');if(heading)heading.textContent=headingFor(current);
  const count=panel.querySelector('.panel-head-meta');if(count)count.textContent=`${visible} ${visible===1?'document':'documents'}`;
  panel.querySelectorAll('.explorer-filter-empty').forEach(x=>x.remove());
  if(visible===0&&rows.length>0&&!isMissing){
    const empty=createElement('p','explorer-filter-empty','No documents match this view. Try another folder or filter.');
    panel.querySelector('.table-scroll')?.insertAdjacentElement('afterend',empty);
  }
  app.querySelectorAll('[data-explorer-filter]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.explorerFilter===current?'page':'false')));
  app.querySelectorAll('[data-category-filter]').forEach(b=>b.classList.toggle('active',current==='category:'+b.dataset.categoryFilter));
}
function setFilter(filter){
  pref.filter=filter;closeInspector();toggleMobile(false);
  if(filter==='archive'){const select=getPanel()?.querySelector('#archive');if(select){select.value='archive';select.dispatchEvent(new Event('change',{bubbles:true}));return;}}
  else if(getPanel()?.querySelector('#archive')?.value==='archive'){const select=getPanel().querySelector('#archive');select.value='active';select.dispatchEvent(new Event('change',{bubbles:true}));return;}
  if(filter==='missing')showRequirements();else applyFilter();
  const inspector=app.querySelector('#explorer-inspector');if(inspector){inspector.classList.remove('open');inspector.querySelector('.explorer-inspector-inner')?.remove();}
}
function closeInspector(){pref.selected=null;const panel=app.querySelector('#explorer-inspector');if(panel){panel.classList.remove('open');panel.querySelector('.explorer-inspector-inner')?.remove();}document.body.classList.remove('inspector-open');}
function fullDocument(id,action){
  const target=[...app.querySelectorAll('.file-name')].find(b=>b.dataset.file===id);
  if(!target)return;
  pref.allowOpen=true;target.click();pref.allowOpen=false;
  if(action){const observer=new MutationObserver(()=>{const button=app.querySelector(action==='version'?'#version':action==='access'?'#privacy':null);if(button){observer.disconnect();button.click();}});observer.observe(app,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),4500);}
}
async function openInspector(id,label){
  const inspector=app.querySelector('#explorer-inspector');if(!inspector)return;
  pref.selected=id;const token=++pref.token;
  inspector.classList.add('open');document.body.classList.add('inspector-open');
  inspector.innerHTML=`<div class="explorer-inspector-inner"><div class="inspector-top"><p>DOCUMENT PREVIEW</p><button type="button" class="inspector-close" aria-label="Close document preview">${ico('close')}</button></div><p class="loading">Loading ${escapeHTML(label)}…</p></div>`;
  inspector.querySelector('.inspector-close').onclick=closeInspector;
  try{
    const base=getScope();const [f,history]=await Promise.all([getJSON(base+'/files/'+id),getJSON(base+'/files/'+id+'/approvals')]);
    if(token!==pref.token||pref.selected!==id||!inspector.isConnected)return;
    const latest=f.versions?.[0];const status=statusFor(rowCollection().find(r=>r.dataset.fileId===id)||{dataset:{}});
    const expiry=f.metadata?.expires_on||null,review=f.metadata?.review_date||null;
    const approval=history.reviews?.find(x=>x.version_id===latest?.id);
    const canManage=f.canManagePrivacy,canEdit=f.editable&&!f.archived;
    inspector.innerHTML=`<div class="explorer-inspector-inner"><div class="inspector-top"><p>DOCUMENT PREVIEW</p><button type="button" class="inspector-close" aria-label="Close document preview">${ico('close')}</button></div>
      <div class="inspector-document-head"><span class="inspector-document-icon">${ico('file',25)}</span><div><h2>${escapeHTML(f.title)}</h2><p>${escapeHTML(latest?.filename||'Document')} · Version ${escapeHTML(latest?.version||1)}</p></div></div>
      <div class="inspector-preview"><iframe title="Preview of ${escapeHTML(f.title)}" loading="lazy" referrerpolicy="no-referrer" src="${base}/files/${encodeURIComponent(id)}/content?preview=1"></iframe></div>
      <div class="inspector-actions"><a class="inspector-primary" href="${base}/files/${encodeURIComponent(id)}/content">Download</a><button type="button" data-inspector-action="full">Open full details</button></div>
      <div class="inspector-divider"><h3>Document information</h3><dl class="inspector-metadata"><div><dt>Owner</dt><dd>${escapeHTML(f.metadata?.owner_name||'Unassigned')}</dd></div><div><dt>Category</dt><dd>${escapeHTML(f.metadata?.category||'General')}</dd></div><div><dt>Privacy</dt><dd>${escapeHTML(f.privacy==='personal'?'Employee record':f.privacy==='restricted'?'Named access':f.privacy==='section'?'Section members':'Department team')}</dd></div><div><dt>Expires</dt><dd>${dateLabel(expiry)}</dd></div><div><dt>Review due</dt><dd>${dateLabel(review)}</dd></div><div><dt>Status</dt><dd><span class="document-status ${status.tone}">${escapeHTML(status.text)}</span></dd></div></dl></div>
      <div class="inspector-divider"><h3>Versions & history</h3><div class="inspector-version-list">${f.versions.map(v=>`<div><span>Version ${v.version}</span><a href="${base}/files/${encodeURIComponent(id)}/content?version=${v.version}">Download</a></div>`).join('')}</div></div>
      ${f.requires_approval?`<div class="inspector-divider"><h3>Review & publication</h3><p>${escapeHTML(approval?approval.status:'Draft')} ${history.publishedVersion?`· Published v${history.publishedVersion}`:'· Not published'}</p></div>`:''}
      <div class="inspector-management">${canEdit?`<button type="button" data-inspector-action="classify">Edit classification</button><button type="button" data-inspector-action="version">Upload new version</button>`:''}${canManage?`<button type="button" data-inspector-action="access">Manage access</button>`:''}${canEdit&&f.requires_approval&&approval?.status!=='pending'&&approval?.status!=='approved'&&history.publishedVersion!==latest.version?`<button type="button" data-inspector-action="submit">Request approval</button>`:''}${canManage&&approval?.status==='pending'&&approval.submitted_by!==pref.principal&&latest.author_id!==pref.principal?`<button type="button" data-inspector-action="approve">Approve version</button><button type="button" data-inspector-action="reject">Request changes</button>`:''}${canManage&&approval?.status==='approved'&&history.publishedVersion!==latest.version?`<button type="button" data-inspector-action="publish">Publish approved version</button>`:''}</div>
      <p class="inspector-security-note">Access and document history are checked by the server on every request.</p></div>`;
    inspector.querySelector('.inspector-close').onclick=closeInspector;
    inspector.querySelectorAll('[data-inspector-action]').forEach(b=>b.onclick=async()=>{
      const action=b.dataset.inspectorAction;
      if(['full','version','access'].includes(action)){closeInspector();fullDocument(id,action);return;}
      if(action==='classify'){await classificationDialog(id,f);return;}
      try{
        b.disabled=true;
        if(action==='submit')await getJSON(`${base}/files/${id}/approvals`,{method:'POST',body:JSON.stringify({revision:f.revision,note:'Submitted from Document Explorer'})});
        if(action==='approve'||action==='reject'){
          const note=action==='reject'?window.prompt('Explain the changes required:'):'';
          if(action==='reject'&&!note?.trim()){b.disabled=false;return;}
          await getJSON(`${base}/files/${id}/approvals/${approval.id}/decision`,{method:'PUT',body:JSON.stringify({revision:f.revision,decision:action==='approve'?'approved':'rejected',note:note||''})});
        }
        if(action==='publish')await getJSON(`${base}/files/${id}/publications`,{method:'POST',body:JSON.stringify({revision:f.revision})});
        announce('Document workflow updated.');refreshLibrary();
      }catch(err){announce(err.message);b.disabled=false;}
    });
  }catch(err){if(token!==pref.token)return;inspector.innerHTML=`<div class="explorer-inspector-inner"><div class="inspector-top"><p>DOCUMENT PREVIEW</p><button type="button" class="inspector-close">${ico('close')}</button></div><p>${escapeHTML(err.message)}</p></div>`;inspector.querySelector('button').onclick=closeInspector;}
}
function refreshLibrary(){closeInspector();const form=getPanel()?.querySelector('#search');form?.requestSubmit();}
function modal(title,fields,onSubmit){
  let el=document.querySelector('#explorer-dialog');if(!el){el=document.createElement('dialog');el.id='explorer-dialog';document.body.append(el);}
  el.innerHTML=`<form method="dialog"><header><h2>${escapeHTML(title)}</h2><button type="button" data-dialog-close aria-label="Close">${ico('close')}</button></header>${fields}<p class="explorer-form-error" role="alert"></p><footer><button value="cancel" type="button" data-dialog-close>Cancel</button><button class="primary" type="submit">Save changes</button></footer></form>`;
  el.showModal();el.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>el.close());
  el.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const save=el.querySelector('[type="submit"]');save.disabled=true;try{await onSubmit(new FormData(ev.target));el.close();}catch(err){el.querySelector('.explorer-form-error').textContent=err.message;}finally{save.disabled=false;}};
}
async function classificationDialog(id,file){
  const metadata=file.metadata||{},section=app.querySelector('.layout')?.dataset.section,role=app.querySelector('.layout')?.dataset.role;
  const people=role==='manager'?(await getJSON(getScope()+'/members')):[];
  modal('Classify document',`<label>Category<select name="category">${(categories[section]||[]).concat(['General']).map(c=>`<option value="${escapeHTML(c)}" ${c===metadata.category?'selected':''}>${escapeHTML(c)}</option>`).join('')}</select></label><label>Document type<input name="documentType" required maxlength="80" value="${escapeHTML(metadata.document_type||'Reference')}"></label>${role==='manager'?`<label>Responsible owner<select name="ownerPrincipalId"><option value="">Unassigned</option>${people.map(p=>`<option value="${escapeHTML(p.id)}" ${metadata.owner_principal_id===p.id?'selected':''}>${escapeHTML(p.display_name)}</option>`).join('')}</select></label>`:''}<div class="explorer-date-grid"><label>Review date<input name="reviewDate" type="date" value="${escapeHTML(metadata.review_date||'')}"></label><label>Expiry date<input name="expiresOn" type="date" value="${escapeHTML(metadata.expires_on||'')}"></label></div><p class="hint">Classification changes are audited. Changing dates does not approve or publish a document.</p>`,async data=>{
    const input={revision:file.revision,category:data.get('category'),documentType:data.get('documentType'),reviewDate:data.get('reviewDate')||null,expiresOn:data.get('expiresOn')||null};
    if(role==='manager')input.ownerPrincipalId=data.get('ownerPrincipalId')||null;
    await getJSON(`${getScope()}/files/${id}/classification`,{method:'PUT',body:JSON.stringify(input)});announce('Classification saved.');refreshLibrary();
  });
}
async function showRequirements(){
  const main=app.querySelector('.main'),area=main?.querySelector('.explorer-work-area');if(!area)return;
  let wrap=main.querySelector('#explorer-requirements');if(!wrap){wrap=createElement('section','explorer-requirements');wrap.id='explorer-requirements';area.insertAdjacentElement('beforebegin',wrap);}
  wrap.hidden=false;const reg=pref.register;const manager=app.querySelector('.layout')?.dataset.role==='manager';
  const rules=reg?.requirements??[];
  wrap.innerHTML=`<div class="requirements-head"><div><p class="explorer-caption">DOCUMENT REGISTER</p><h2>Missing required documents</h2><p>Requirements defined by your section manager. Linked files are rechecked against visibility, expiry and publication status.</p></div>${manager?'<button class="primary" id="requirement-new">+ Add requirement</button>':''}</div>${reg?.configured?`<div class="requirements-table">${rules.map(r=>`<div class="requirement-row"><div><strong>${escapeHTML(r.title)}</strong><p>${escapeHTML(r.category)} ${r.assigned_name?' · '+escapeHTML(r.assigned_name):''} · Due ${dateLabel(r.due_on)}</p></div><span class="document-status ${r.missing?'amber':'green'}">${r.missing?'Missing':'Satisfied'}</span>${manager?`<button type="button" data-requirement-link="${r.id}">${r.fulfilled_file_id?'Change file':'Link file'}</button>`:''}</div>`).join('')}</div>`:`<div class="requirements-zero">${ico('info',26)}<h3>No requirements defined</h3><p>${manager?'Add required policies or employee records to start tracking missing documents.':'Your manager has not assigned required documents to you.'}</p></div>`}`;
  if(manager){
    wrap.querySelector('#requirement-new')?.addEventListener('click',()=>addRequirement());
    wrap.querySelectorAll('[data-requirement-link]').forEach(b=>b.onclick=()=>linkRequirement(b.dataset.requirementLink));
  }
  applyFilter();
}
async function addRequirement(){
  const section=app.querySelector('.layout')?.dataset.section;
  const members=await getJSON(getScope()+'/members');
  modal('Add required document',`<label>Requirement name<input name="title" maxlength="150" required placeholder="e.g. Professional registration"></label><label>Category<select name="category">${['General',...(categories[section]||[])].map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('')}</select></label><label>Assigned employee (optional)<select name="assignedPrincipalId"><option value="">Section-wide</option>${members.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.display_name)}</option>`).join('')}</select></label><label>Due date<input name="dueOn" type="date"></label>`,async data=>{
    await getJSON(getScope()+'/register/requirements',{method:'POST',body:JSON.stringify({title:data.get('title'),category:data.get('category'),dueOn:data.get('dueOn')||null,assignedPrincipalId:data.get('assignedPrincipalId')||null})});
    pref.register=await getJSON(getScope()+'/register');updateCounts();showRequirements();announce('Document requirement created.');
  });
}
async function linkRequirement(id){
  const files=allRows().filter(r=>r.dataset.archived!=='true');
  modal('Link a document',`<label>Document<select name="fileId"><option value="">Mark as missing</option>${files.map(r=>`<option value="${escapeHTML(r.dataset.fileId)}">${escapeHTML(r.dataset.searchTitle||r.querySelector('.file-name')?.textContent||'Document')}</option>`).join('')}</select></label><p class="hint">The selected file must be accessible in this section. Restricted files require manage access. Expired or unpublished controlled documents still count as missing.</p>`,async data=>{
    await getJSON(`${getScope()}/register/requirements/${id}`,{method:'PUT',body:JSON.stringify({fileId:data.get('fileId')||null})});
    pref.register=await getJSON(getScope()+'/register');updateCounts();showRequirements();announce('Required document register updated.');
  });
}
function enhance(){
  const main=app?.querySelector('.main'),layout=app?.querySelector('.layout'),panel=getPanel();if(!main||!layout)return;
  const scope=layout.dataset.apiBase;if(!scope)return;
  if(scope!==pref.scope){pref.scope=scope;pref.filter='all';pref.selected=null;}
  pref.principal=null;pref.register=null;const epoch=++pref.contextEpoch;
  loadContext(epoch).then(()=>{if(epoch===pref.contextEpoch){updateCounts();applyFilter();}});loadRegister(scope,epoch);
  if(!panel)return;
  if(main.dataset.explorerReady==='true')return;
  main.dataset.explorerReady='true';
  const side=layout.querySelector('.sidebar');if(side){makeNav(side);makeFolderTree(side);makeCategories(side);}
  addTopActions();addSummary(main);enrichTable(panel);addInspector(main);
  updateCounts();applyFilter();
  const veil=document.querySelector('#explorer-veil')||createElement('button','explorer-veil');veil.id='explorer-veil';veil.type='button';veil.hidden=true;veil.setAttribute('aria-label','Close navigation');veil.onclick=()=>toggleMobile(false);if(!veil.isConnected)document.body.append(veil);
  if(!document.querySelector('#explorer-status')){const announceNode=createElement('p','sr-only');announceNode.id='explorer-status';announceNode.setAttribute('role','status');announceNode.setAttribute('aria-live','polite');document.body.append(announceNode);}
  if(pref.filter==='missing')showRequirements();
}
if(app){
  const observer=new MutationObserver(enhance);
  observer.observe(app,{childList:true});
  enhance();
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){closeInspector();toggleMobile(false);}if(ev.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){const search=getPanel()?.querySelector('#search input');if(search){ev.preventDefault();search.focus();}}});
}
