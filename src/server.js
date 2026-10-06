import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {openStore,AppError} from './store.js';
import {templates,DEMO_FACILITY} from './forms.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const actor={id:'local-demo-clinician',facilityId:DEMO_FACILITY};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createApp({dataDir=join(root,'.data'),cataloguePath=existsSync(join(dataDir,'catalogue.json'))?join(dataDir,'catalogue.json'):join(root,'data/catalogue.json')}={}) {
  if(process.env.NODE_ENV==='production') throw new Error('Local pilot cannot run in production. Implement host-app authentication and private storage first.');
  const store=openStore(join(dataDir,'pilot.sqlite'),cataloguePath);
  const csrf=randomBytes(32).toString('hex');
  const send=(res,status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const expected=`127.0.0.1:${server.address().port}`;
      if(req.headers.host!==expected && req.headers.host!==`localhost:${server.address().port}`) throw new AppError(403,'Invalid host');
      if(req.headers.origin && ![`http://${expected}`,`http://localhost:${server.address().port}`].includes(req.headers.origin)) throw new AppError(403,'Cross-origin access is blocked');
      if(req.headers['sec-fetch-site']==='cross-site') throw new AppError(403,'Cross-site access is blocked');
      const path=new URL(req.url,`http://${expected}`).pathname;
      if(!['GET','POST','PUT'].includes(req.method)) throw new AppError(405,'Method not allowed');
      let input;
      if(req.method!=='GET'){
        if(req.headers['x-csrf-token']!==csrf) throw new AppError(403,'Invalid request token');
        if(!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415,'Expected JSON');
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536) throw new AppError(413,'Request too large');}
        try{input=JSON.parse(body);}catch{throw new AppError(400,'Invalid JSON');}
      }
      if(path==='/api/session' && req.method==='GET') return send(res,200,{actor,csrfToken:csrf,mode:'local-demo',warning:'Synthetic data only. Host-app authentication is not connected.'});
      if(path==='/api/documents' && req.method==='GET') return send(res,200,store.documents().map(d=>({...d,fileAvailable:!d.restricted && existsSync(join(dataDir,'documents',`${d.sha256}.pdf`))})));
      if(path==='/api/templates' && req.method==='GET') return send(res,200,templates);
      if(path==='/api/submissions' && req.method==='GET') return send(res,200,store.submissions(actor));
      if(path==='/api/cases' && req.method==='GET') return send(res,200,store.cases(actor));
      if(path==='/api/submissions' && req.method==='POST') return send(res,201,store.save(input,actor));
      const record=path.match(/^\/api\/submissions\/([a-f\d-]{36})(\/submit)?$/);
      if(record){
        if(req.method==='GET' && !record[2]) return send(res,200,store.getSubmission(record[1],actor));
        if(req.method==='PUT' && !record[2]) return send(res,200,store.save(input,actor,false,record[1]));
        if(req.method==='POST' && record[2]) return send(res,200,store.save(input,actor,true,record[1]));
      }
      const pdf=path.match(/^\/api\/documents\/([\w-]+)\/file$/);
      if(pdf && req.method==='GET'){
        const d=store.documents().find(x=>x.id===pdf[1]);
        if(!d || d.restricted) throw new AppError(404,'Document not found');
        const file=join(dataDir,'documents',`${d.sha256}.pdf`);if(!existsSync(file)) throw new AppError(404,'Source PDF has not been imported');
        store.audit(actor,'document.opened',d.id);res.setHeader('Content-Disposition',`inline; filename="${d.id}.pdf"`);return send(res,200,readFileSync(file),'application/pdf');
      }
      const print=path.match(/^\/records\/([a-f\d-]{36})\/print$/);
      if(print && req.method==='GET'){
        const s=store.getSubmission(print[1],actor),t=templates.find(t=>t.id===s.templateId);store.audit(actor,'record.printed',s.id);
        const rows=t.fields.map(f=>`<tr><th>${escape(f.label)}</th><td>${escape(s.data[f.name]??'')}</td></tr>`).join('');
        return send(res,200,`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(t.title)}</title><link rel="stylesheet" href="/styles.css"></head><body class="print-record"><p class="eyebrow">TDSA / LOCAL DEMO · NOT A LIVE CLINICAL RECORD</p><h1>${escape(t.title)}</h1><p>Record: ${escape(s.id)}<br>Status: ${escape(s.status)} · Template version: ${s.templateVersion}<br>Facility: ${escape(s.facilityId)} · Author: ${escape(s.authorId)}<br>Updated: ${escape(s.updatedAt)}</p><table>${rows}</table><p class="print-help">Use your browser’s Print command to save as PDF.</p></body></html>`,'text/html; charset=utf-8');
      }
      const asset={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'}[path];
      if(asset && req.method==='GET'){const ext=asset.slice(asset.lastIndexOf('.'));return send(res,200,readFileSync(join(root,'public',asset)),types[ext]);}
      throw new AppError(404,'Not found');
    }catch(error){if(!res.headersSent) send(res,error.status??500,{message:error.status?error.message:'Unexpected server error',errors:error.errors??{}});}
  });
  return {server,store};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server,store}=createApp();const port=Number(process.env.PORT??8795);
  server.listen(port,'127.0.0.1',()=>console.log(`TDSA local pilot: http://127.0.0.1:${server.address().port} (synthetic data only)`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
