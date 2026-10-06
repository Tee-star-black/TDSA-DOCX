import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync,existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {openStore,AppError} from './store.js';
import {templates,DEMO_FACILITY} from './forms.js';
import {explorer} from './explorer.js';
import {ingestArchive} from './ingest.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const clinicianActor={id:'local-demo-clinician',facilityId:DEMO_FACILITY,surface:'clinician',permissions:['documents.manage','complaints.manage']};
const patientActor={id:'local-demo-patient',facilityId:DEMO_FACILITY,surface:'patient',permissions:[]};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const documentAudience=d=>d.audience??(d.templateId==='complaint'||/(complaint|feedback).*form/i.test(d.filename)?'patient':'clinician');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createApp({dataDir=resolve(root,process.env.TDSA_DATA_DIR??'.data'),cataloguePath=existsSync(join(dataDir,'catalogue.json'))?join(dataDir,'catalogue.json'):join(root,'data/catalogue.json')}={}) {
  if(process.env.NODE_ENV==='production') throw new Error('Local pilot cannot run in production. Implement host-app authentication and private storage first.');
  const store=openStore(join(dataDir,'pilot.sqlite'),cataloguePath);
  const csrfTokens={clinician:randomBytes(32).toString('hex'),patient:randomBytes(32).toString('hex')};
  const files=explorer(store,dataDir);
  // Move legacy file-system contents into database storage without altering originals.
  const hashes=[...store.documents().filter(d=>!d.restricted).map(d=>({hash:d.sha256,path:join(dataDir,'documents',`${d.sha256}.pdf`)})),...store.db.prepare('SELECT DISTINCT hash FROM file_versions').all().map(v=>({hash:v.hash,path:join(dataDir,'objects',v.hash)}))];
  for(const item of hashes){if(/^[a-f0-9]{64}$/.test(item.hash)&&!store.hasBlob(item.hash)&&existsSync(item.path)){const bytes=readFileSync(item.path);if(createHash('sha256').update(bytes).digest('hex')!==item.hash)throw new Error('Legacy file hash mismatch');store.putBlob(item.hash,bytes);}}
  store.db.exec('CREATE TABLE IF NOT EXISTS case_management(case_id TEXT PRIMARY KEY REFERENCES cases(id), assignee TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const managedCases=actor=>{if(!actor.permissions.includes('complaints.manage'))throw new AppError(403,'Complaint management permission required');return store.db.prepare('SELECT c.*,m.assignee,COALESCE(m.status,c.status) AS workflow_status,m.note FROM cases c LEFT JOIN case_management m ON m.case_id=c.id WHERE c.facility_id=? ORDER BY c.created_at DESC').all(actor.facilityId);};
  const send=(res,status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const expected=`127.0.0.1:${server.address().port}`;
      if(req.headers.host!==expected && req.headers.host!==`localhost:${server.address().port}`) throw new AppError(403,'Invalid host');
      if(req.headers.origin && ![`http://${expected}`,`http://localhost:${server.address().port}`].includes(req.headers.origin)) throw new AppError(403,'Cross-origin access is blocked');
      const actualPath=new URL(req.url,`http://${expected}`).pathname;
      const appNavigation=req.method==='GET' && ['/', '/patient'].includes(actualPath)
        && req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document';
      if(req.headers['sec-fetch-site']==='cross-site' && !appNavigation) throw new AppError(403,'Cross-site access is blocked');
      const patient=actualPath.startsWith('/api/patient/')||actualPath.startsWith('/patient/records/');
      const actor=patient?patientActor:clinicianActor;const csrf=csrfTokens[actor.surface];
      const path=patient?actualPath.replace(/^\/api\/patient\//,'/api/').replace(/^\/patient\/records\//,'/records/'):actualPath;
      if(patient && !/^\/(api\/(session|templates|submissions)(\/|$)|records\/)/.test(path))throw new AppError(403,'Patient interface cannot access staff records');
      if(!['GET','POST','PUT'].includes(req.method)) throw new AppError(405,'Method not allowed');
      let input;
      if(req.method!=='GET'){
        if(req.headers['x-csrf-token']!==csrf) throw new AppError(403,'Invalid request token');
        if(!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415,'Expected JSON');
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(path==='/api/imports'?15:6)*1024*1024) throw new AppError(413,'Request too large');}
        try{input=JSON.parse(body);}catch{throw new AppError(400,'Invalid JSON');}
        if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'Expected a JSON object');
      }
      if(path==='/api/session' && req.method==='GET') return send(res,200,{actor,csrfToken:csrf,mode:'local-demo',warning:'Synthetic data only. Host-app authentication is not connected.'});
      if(path==='/api/documents' && req.method==='GET') return send(res,200,store.documents().filter(d=>documentAudience(d)==='clinician').map(d=>({...d,fileAvailable:!d.restricted && store.hasBlob(d.sha256)})));
      if(path==='/api/templates' && req.method==='GET') return send(res,200,templates.filter(t=>t.audience===actor.surface));
      if(path==='/api/submissions' && req.method==='GET') return send(res,200,store.submissions(actor).filter(r=>templates.find(t=>t.id===r.templateId)?.audience===actor.surface));
      if(path==='/api/cases' && req.method==='GET') return send(res,200,managedCases(actor));
      if(path==='/api/submissions' && req.method==='POST') return send(res,201,store.save(input,actor));
      const record=path.match(/^\/api\/submissions\/([a-f\d-]{36})(\/submit)?$/);
      if(record){
        if(req.method==='GET' && !record[2]) return send(res,200,store.getSubmission(record[1],actor));
        if(req.method==='PUT' && !record[2]) return send(res,200,store.save(input,actor,false,record[1]));
        if(req.method==='POST' && record[2]) return send(res,200,store.save(input,actor,true,record[1]));
      }
      if(path==='/api/imports' && req.method==='POST')return send(res,201,ingestArchive(store,files,input,actor));
      if(path==='/api/database' && req.method==='GET'){
        if(!actor.permissions.includes('documents.manage'))throw new AppError(403,'Database management permission required');
        const tables=['documents','folders','files','file_versions','submissions','cases','file_blobs','imports','audit'];
        const counts=Object.fromEntries(tables.map(t=>[t,Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)]));
        return send(res,200,{engine:'SQLite',connected:true,mode:'local',integrity:store.db.prepare('PRAGMA quick_check').get().quick_check,schemaVersion:store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,counts,storedBytes:Number(store.db.prepare('SELECT COALESCE(SUM(length(content)),0) AS n FROM file_blobs').get().n)});
      }
      if(path==='/api/database/backup' && req.method==='POST'){
        if(!actor.permissions.includes('documents.manage'))throw new AppError(403,'Database management permission required');
        const directory=join(dataDir,'backups');mkdirSync(directory,{recursive:true});const backup=join(directory,randomUUID()+'.sqlite');
        store.audit(actor,'database.backup','workspace');store.db.prepare('VACUUM INTO ?').run(backup);
        res.setHeader('Content-Disposition','attachment; filename="TDSA-workspace-backup.sqlite"');
        try{return send(res,200,readFileSync(backup),'application/vnd.sqlite3');}finally{unlinkSync(backup);}
      }
      if(path==='/api/explorer' && req.method==='GET')return send(res,200,{folders:files.tree(actor),files:files.files(actor),locations:files.locations(actor)});
      if(path==='/api/folders' && req.method==='POST')return send(res,201,files.createFolder(input,actor));
      const folderRoute=path.match(/^\/api\/folders\/([a-f\d-]{36})$/);
      if(folderRoute && req.method==='PUT')return send(res,200,files.updateFolder(folderRoute[1],input,actor));
      if(path==='/api/files' && req.method==='POST')return send(res,201,files.upload(input,actor));
      const fileRoute=path.match(/^\/api\/files\/([a-f\d-]{36})(?:\/(versions|content))?$/);
      if(fileRoute){
        const id=fileRoute[1],action=fileRoute[2];
        if(!action && req.method==='PUT')return send(res,200,files.updateFile(id,input,actor));
        if(action==='versions' && req.method==='GET')return send(res,200,files.versions(id,actor));
        if(action==='versions' && req.method==='POST')return send(res,201,files.upload(input,actor,id));
        if(action==='content' && req.method==='GET'){
          const requested=new URL(req.url,`http://${expected}`).searchParams.get('version');
          const versions=files.versions(id,actor),v=requested?versions.find(v=>String(v.version)===requested):versions[0];
          if(!v)throw new AppError(404,'Version not found');store.audit(actor,'file.downloaded',id);
          res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'");
          const preview=new URL(req.url,`http://${expected}`).searchParams.get('preview')==='1';
          res.setHeader('Content-Disposition',`${preview?'inline':'attachment'}; filename="download.${v.mime.startsWith('application/pdf')?'pdf':'txt'}"`);
          return send(res,200,store.getBlob(v.hash)??(()=>{throw new AppError(404,'File contents are unavailable');})(),v.mime);
        }
      }
      const sourceMove=path.match(/^\/api\/documents\/([\w-]+)\/location$/);
      if(sourceMove && req.method==='PUT'){files.moveSource(sourceMove[1],input,actor);return send(res,200,{ok:true});}
      const caseRoute=path.match(/^\/api\/cases\/([a-f\d-]{36})$/);
      if(caseRoute){
        const c=managedCases(actor).find(c=>c.id===caseRoute[1]);if(!c)throw new AppError(404,'Case not found');
        if(req.method==='GET'){const r=store.db.prepare('SELECT data FROM submissions WHERE id=?').get(c.submission_id);store.audit(actor,'case.opened',c.id);return send(res,200,{...c,data:JSON.parse(r.data)});}
        if(req.method==='PUT'){
          if(!['received','acknowledged','investigating','resolved'].includes(input.status)||typeof input.assignee!=='string'||input.assignee.length>150||typeof input.note!=='string'||input.note.length>4000)throw new AppError(422,'Invalid case management fields');
          if(input.status==='resolved'&&!input.note.trim())throw new AppError(422,'Record a resolution note before resolving');
          store.db.prepare('INSERT INTO case_management VALUES (?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET assignee=excluded.assignee,status=excluded.status,note=excluded.note,updated_at=excluded.updated_at').run(c.id,input.assignee.trim(),input.status,input.note.trim(),new Date().toISOString());store.audit(actor,'case.updated',c.id);return send(res,200,{ok:true});
        }
      }
      const pdf=path.match(/^\/api\/documents\/([\w-]+)\/file$/);
      if(pdf && req.method==='GET'){
        const d=store.documents().find(x=>x.id===pdf[1]);
        if(!d || d.restricted || documentAudience(d)!=='clinician') throw new AppError(404,'Document not found');
        const contents=store.getBlob(d.sha256);if(!contents) throw new AppError(404,'Source PDF has not been imported');
        store.audit(actor,'document.opened',d.id);res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'");res.setHeader('Content-Disposition',`inline; filename="${d.id}.pdf"`);return send(res,200,contents,'application/pdf');
      }
      const print=path.match(/^\/records\/([a-f\d-]{36})\/print$/);
      if(print && req.method==='GET'){
        const s=store.getSubmission(print[1],actor),t=templates.find(t=>t.id===s.templateId);store.audit(actor,'record.printed',s.id);
        const rows=t.fields.map(f=>`<tr><th>${escape(f.label)}</th><td>${escape(s.data[f.name]??'')}</td></tr>`).join('');
        return send(res,200,`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(t.title)}</title><link rel="stylesheet" href="/styles.css"></head><body class="print-record"><p class="eyebrow">TDSA / LOCAL DEMO · NOT A LIVE CLINICAL RECORD</p><h1>${escape(t.title)}</h1><p>Record: ${escape(s.id)}<br>Status: ${escape(s.status)} · Template version: ${s.templateVersion}<br>Facility: ${escape(s.facilityId)} · Author: ${escape(s.authorId)}<br>Updated: ${escape(s.updatedAt)}</p><table>${rows}</table><p class="print-help">Use your browser’s Print command to save as PDF.</p></body></html>`,'text/html; charset=utf-8');
      }
      const asset={'/':'index.html','/patient':'index.html','/app.js':'app.js','/styles.css':'styles.css'}[path];
      if(asset && req.method==='GET'){const ext=asset.slice(asset.lastIndexOf('.'));return send(res,200,readFileSync(join(root,'public',asset)),types[ext]);}
      throw new AppError(404,'Not found');
    }catch(error){if(!res.headersSent) send(res,error.status??500,{message:error.status?error.message:'Unexpected server error',errors:error.errors??{}});}
  });
  return {server,store};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server,store}=createApp();const port=Number(process.env.PORT??8795);
  const pidFile=resolve(root,process.env.TDSA_DATA_DIR??'.data','server.pid');
  server.listen(port,'127.0.0.1',()=>{writeFileSync(pidFile,String(process.pid));console.log(`TDSA local workspace: http://127.0.0.1:${server.address().port} (SQLite connected; synthetic data only)`);});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();try{unlinkSync(pidFile);}catch{}process.exit(0);}));
}
