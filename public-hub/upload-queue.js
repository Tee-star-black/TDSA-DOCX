// Batch uploads are opt-in, section-team scoped and use the existing authenticated
// JSON upload endpoint. This is not a resumable or idempotent transport.
export const MAX_BATCH_FILES = 20;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const extensions = new Set(['pdf','docx','txt']);
export function validateBatchFile(file) {
  if (!file || typeof file.name !== 'string') return 'Choose a valid document';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!extensions.has(ext)) return 'Only PDF, DOCX and TXT files are supported';
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) return 'File must be between 1 byte and 4 MiB';
  return null;
}
export function normalizeBatch(files) {
  const selected = Array.from(files || []);
  if (selected.length > MAX_BATCH_FILES) throw Error('Choose no more than 20 files per batch');
  return selected.map(file => ({file, name:file.name, size:file.size, error:validateBatchFile(file), status:validateBatchFile(file)?'invalid':'queued', progress:0}));
}
export function formatBytes(size) {return size < 1024 ? size+' B' : (size / 1024 / 1024).toFixed(2)+' MiB';}
function readBase64(file, progress) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onprogress = event => {if(event.lengthComputable)progress(Math.round(event.loaded/event.total*100));};
    reader.onerror = () => reject(Error('Could not read the selected file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}
export function openBatchUpload({files, uploadOne, onComplete, scopeMatches}) {
  if(document.querySelector('#hub-batch-upload'))return;
  const modal=document.createElement('dialog');
  modal.id='hub-batch-upload';
  modal.className='hub-batch-upload';
  modal.setAttribute('aria-labelledby','hub-batch-title');
  modal.innerHTML=`<div class="batch-head"><div><h2 id="hub-batch-title">Upload multiple documents</h2><p>Up to 20 files, 4 MiB each. All files use department-team access.</p></div><button type="button" data-batch-close aria-label="Close upload queue">Close</button></div>
    <label class="batch-picker">Choose PDF, DOCX or TXT documents<input type="file" accept=".pdf,.docx,.txt" multiple></label>
    <p class="batch-warning">Uploads are scanned and verified by the server when configured. A failed network request may still have saved a document. Check the library before manually retrying.</p>
    <div role="status" aria-live="polite" class="batch-summary">No files selected</div>
    <ol class="batch-items" aria-label="Upload queue"></ol>
    <div class="batch-footer"><button type="button" data-batch-cancel>Cancel remaining</button><button type="button" data-batch-start disabled>Upload queued files</button></div>`;
  document.body.append(modal);
  let entries=[],running=false,stopped=false,successes=0;
  const picker=modal.querySelector('input[type="file"]'),list=modal.querySelector('.batch-items');
  const start=modal.querySelector('[data-batch-start]'),cancel=modal.querySelector('[data-batch-cancel]');
  const close=modal.querySelector('[data-batch-close]'),summary=modal.querySelector('.batch-summary');
  function render(){
    summary.textContent=`${successes} uploaded · ${entries.filter(x=>x.status==='queued').length} queued · ${entries.filter(x=>['failed','invalid'].includes(x.status)).length} needing attention`;
    start.disabled=running || !entries.some(x=>x.status==='queued');
    picker.disabled=running;
    cancel.disabled=!entries.some(x=>x.status==='queued');
    list.replaceChildren();
    for(const entry of entries){
      const item=document.createElement('li');
      const name=document.createElement('strong');name.textContent=entry.name;
      const info=document.createElement('span');info.textContent=`${formatBytes(entry.size)} · ${entry.status==='reading'?'Reading '+entry.progress+'%':entry.status==='uploading'?'Sending to server':entry.status}`;
      item.append(name,info);
      if(entry.error){const error=document.createElement('p');error.className='batch-error';error.textContent=entry.error;item.append(error);}
      if(entry.status==='failed'){
        const retry=document.createElement('button');retry.type='button';retry.textContent='Retry manually';retry.disabled=running;
        retry.addEventListener('click',()=>{
          if(!window.confirm('Check the document library first: a failed request may already have completed. Retry this file?'))return;
          entry.error=null;entry.status='queued';render();
        });item.append(retry);
      }
      list.append(item);
    }
  }
  function setFiles(selected){
    try{entries=normalizeBatch(selected);successes=0;stopped=false;render();}
    catch(error){summary.textContent=error.message;}
  }
  picker.addEventListener('change',()=>setFiles(picker.files));
  cancel.addEventListener('click',()=>{stopped=true;for(const entry of entries)if(entry.status==='queued')entry.status='cancelled';render();});
  close.addEventListener('click',()=>{if(running){summary.textContent='Finish the current upload or cancel the remaining queue before closing.';return;}modal.close();});
  modal.addEventListener('cancel',event=>{if(running){event.preventDefault();summary.textContent='Upload in progress. Cancel remaining files to stop after the current file.';}});
  modal.addEventListener('close',()=>{modal.remove();if(successes)onComplete();});
  start.addEventListener('click',async()=>{
    if(running)return;
    running=true;stopped=false;render();
    for(const entry of entries){
      if(stopped)break;
      if(entry.status!=='queued')continue;
      if(!scopeMatches()){entry.status='failed';entry.error='Your workspace changed. Reopen the upload queue in the intended section.';stopped=true;break;}
      try{
        entry.status='reading';render();
        const content=await readBase64(entry.file,value=>{entry.progress=value;render();});
        if(stopped){entry.status='cancelled';break;}
        if(!scopeMatches())throw Error('Workspace changed during upload');
        entry.status='uploading';render();
        await uploadOne({filename:entry.file.name,content});
        entry.status='completed';successes++;
      }catch(error){entry.status='failed';entry.error=error.message||'Upload failed';}
      render();
    }
    if(stopped)for(const entry of entries)if(entry.status==='queued')entry.status='cancelled';
    running=false;render();
  });
  if(files?.length)setFiles(files);
  modal.showModal();
}
