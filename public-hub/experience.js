// Non-authoritative UI enhancements for the TDSA Document Hub.
// Never grant access, change application permissions or infer records from DOM state.
const hubRoot = document.querySelector('#app');
const viewPreference = { mode: 'list', sort: 'updated' };
const icons = {
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.1M3.5 12h.1M3.5 18h.1"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
};

function addContext(main) {
  if (main.querySelector('.context-path')) return;
  const active = hubRoot.querySelector('.section-link[aria-current="page"]');
  const isDetail = Boolean(main.querySelector('.detail-grid'));
  const location = active?.textContent?.trim() || 'Document Hub';
  const context = document.createElement('div');
  context.className = 'context-path';
  context.setAttribute('aria-label', 'Current location');
  const crumbs = ['TDSA Workspace', 'Document Hub', location];
  if (isDetail) crumbs.push('Document preview');
  for (const [index, title] of crumbs.entries()) {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'context-sep'; sep.textContent = '/'; context.append(sep);
    }
    const part = document.createElement(index === crumbs.length - 1 ? 'strong' : 'span');
    part.textContent = title; context.append(part);
  }
  main.prepend(context);
}

function getRows(panel) {
  return [...panel.querySelectorAll('tbody tr')].filter(row => row.querySelector('.file-name'));
}
function updateView(panel) {
  panel.dataset.experienceView = viewPreference.mode;
  panel.querySelectorAll('[data-experience-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.experienceMode === viewPreference.mode));
  });
}
function sortRows(panel) {
  const body = panel.querySelector('tbody');
  if (!body) return;
  const rows = getRows(panel);
  const collate = (a,b) => a.localeCompare(b, undefined, {numeric:true,sensitivity:'base'});
  rows.sort((a,b) => {
    const read = (row,n) => row.querySelector(`td:nth-child(${n})`)?.textContent?.trim() || '';
    if (viewPreference.sort === 'updated') {
      const dateA=Date.parse(a.dataset.updated||read(a,7)),dateB=Date.parse(b.dataset.updated||read(b,7));
      return (Number.isFinite(dateB)?dateB:0)-(Number.isFinite(dateA)?dateA:0) || collate(read(a,1), read(b,1));
    }
    if (viewPreference.sort === 'type') {
      return collate(a.querySelector('.file-icon')?.textContent?.trim() || '', b.querySelector('.file-icon')?.textContent?.trim() || '') || collate(read(a,1),read(b,1));
    }
    return collate(read(a,1), read(b,1));
  });
  // Moving the existing row elements preserves each document's click handler.
  for(const row of rows) body.append(row);
}
function enhanceLibrary(panel) {
  if (panel.dataset.experienceReady === 'true') return;
  panel.dataset.experienceReady = 'true';
  const toolbar = panel.querySelector('.toolbar');
  if(!toolbar) return;
  const rows = getRows(panel);
  for(const row of rows) {
    const type = row.querySelector('.file-icon');
    if(type) type.dataset.type = type.textContent.trim();
  }

  const heading = document.createElement('div');
  heading.className = 'panel-head';
  const title = document.createElement('div');
  const h2 = document.createElement('h2'); h2.textContent='Document library';
  const subtitle=document.createElement('p'); subtitle.textContent='Your documents, organised.';
  title.append(h2,subtitle);
  const count=document.createElement('span'); count.className='panel-head-meta';
  count.textContent=`${rows.length} ${rows.length === 1 ? 'document' : 'documents'} in this view`;
  heading.append(title,count);
  panel.insertBefore(heading,toolbar);

  const tools = document.createElement('div');
  tools.className = 'experience-tools';
  const orderLabel = document.createElement('label');
  orderLabel.setAttribute('for','experience-sort');
  orderLabel.textContent='Sort';
  const sort = document.createElement('select');
  sort.id='experience-sort'; sort.setAttribute('aria-label','Sort visible documents');
  for(const [value,label] of [['updated','Last updated'],['name','Name A–Z'],['type','File type']]) {
    const option=document.createElement('option'); option.value=value;option.textContent=label;sort.append(option);
  }
  sort.value=viewPreference.sort;
  sort.addEventListener('change',()=>{viewPreference.sort=sort.value;sortRows(panel);});
  orderLabel.append(sort);

  const switcher=document.createElement('div');
  switcher.className='view-switch'; switcher.setAttribute('role','group');
  switcher.setAttribute('aria-label','Library layout');
  for(const [mode,label] of [['list','List view'],['grid','Grid view']]) {
    const button=document.createElement('button');button.type='button';
    button.dataset.experienceMode=mode;button.title=label;
    button.setAttribute('aria-label',label);
    button.innerHTML=icons[mode]+`<span>${mode==='list'?'List':'Grid'}</span>`;
    button.addEventListener('click',()=>{viewPreference.mode=mode;updateView(panel);});
    switcher.append(button);
  }
  tools.append(orderLabel,switcher);
  toolbar.append(tools);
  updateView(panel);
  sortRows(panel);
}
function enhanceDetail(main) {
  const grid=main.querySelector('.detail-grid');
  if(!grid || grid.dataset.experienceReady === 'true') return;
  grid.dataset.experienceReady = 'true';
  const frame = grid.querySelector('.preview-frame');
  if(frame) {
    frame.setAttribute('loading','lazy');
    frame.setAttribute('referrerpolicy','no-referrer');
    const note = document.createElement('p');
    note.className='hint';
    note.textContent='Preview is permission-checked. Downloads and past versions remain subject to your access rights.';
    frame.insertAdjacentElement('afterend',note);
  }
}
function enhance() {
  const main=hubRoot?.querySelector('.main');
  if(!main) return;
  addContext(main);
  const panel=main.querySelector('#document-panel');
  if(panel) enhanceLibrary(panel);
  enhanceDetail(main);
}

if(hubRoot){
  // Existing hub.js replaces #app after most user actions. Reattach only the
  // presentation controls when that happens; never intercept backend requests.
  const observer=new MutationObserver(()=>enhance());
  observer.observe(hubRoot,{childList:true});
  enhance();
  document.addEventListener('keydown', event=>{
    const target=event.target;
    const typing=target?.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName);
    if(!typing && event.key==='/' && !event.ctrlKey && !event.metaKey && !event.altKey){
      const search=hubRoot.querySelector('#search input');
      if(search){event.preventDefault();search.focus();}
    }
  });
}
