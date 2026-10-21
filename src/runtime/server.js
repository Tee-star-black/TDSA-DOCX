import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {HttpError} from './database.js';
import {docxText} from '../classification.js';

const assets=fileURLToPath(new URL('../../public-hub/',import.meta.url));
function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'Expected JSON');let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>6*1024*1024)throw new HttpError(413,'Request too large');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new HttpError(400,'Invalid request');}}
export function createHubServer({service,sessions,login,origin,preview=false,previewLogin}){
  if(!preview&&(!origin?.startsWith('https://')||!login))throw Error('Verified sign-in and HTTPS origin are required');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(!preview)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const expected=preview?`http://127.0.0.1:${server.address().port}`:origin;
      if(req.headers.host!==new URL(expected).host)throw new HttpError(403,'Invalid host');
      const url=new URL(req.url,expected),path=url.pathname;
      if(req.headers.origin&&req.headers.origin!==expected)throw new HttpError(403,'Cross-origin request blocked');
      if(req.headers['sec-fetch-site']==='cross-site'&&!['/','/auth/callback','/auth/login'].includes(path))throw new HttpError(403,'Cross-site request blocked');
      if(!['GET','POST','PUT'].includes(req.method))throw new HttpError(405,'Method not allowed');
      const asset={'/':'index.html','/hub.js':'hub.js','/reviews.js':'reviews.js','/hub.css':'hub.css','/experience.css':'experience.css','/experience.js':'experience.js'}[path];
      if(asset&&req.method==='GET')return send(res,200,readFileSync(join(assets,asset)),asset.endsWith('.js')?'text/javascript; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      if(path==='/healthz'&&req.method==='GET')return send(res,200,{status:'ok'});
      if(path==='/auth/status'&&req.method==='GET')return send(res,200,{preview,loginAvailable:Boolean(login),storage:preview?'local-preview':'gcp'});
      if(path==='/auth/login'&&req.method==='GET'&&login){const result=await login.begin();res.writeHead(302,{'Location':result.url,'Set-Cookie':result.cookie});return res.end();}
      if(path==='/auth/callback'&&req.method==='GET'&&login){const cookies=await login.complete(req,url);res.writeHead(302,{'Location':'/','Set-Cookie':cookies});return res.end();}
      if(path==='/auth/preview'&&preview&&req.method==='POST'&&previewLogin){if(req.headers.origin!==expected)throw new HttpError(403,'Invalid preview origin');const input=await body(req);const cookie=await previewLogin(input.profile);res.setHeader('Set-Cookie',cookie);return send(res,200,{ok:true});}
      if(!path.startsWith('/api/')&&path!=='/auth/logout')throw new HttpError(404,'Not found');
      const session=await sessions.resolve(req);
      let input;
      if(req.method!=='GET'){
        if(req.headers.origin!==expected||req.headers['x-csrf-token']!==session.csrf_token)throw new HttpError(403,'Invalid request token');input=await body(req);
      }
      if(path==='/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',await sessions.logout(req));return send(res,200,{ok:true});}
      if(path==='/api/session'&&req.method==='GET')return send(res,200,{principalId:session.principal_id,name:session.display_name,csrfToken:session.csrf_token,memberships:session.memberships,preview});
      const match=path.match(/^\/api\/workspaces\/([^/]+)\/([^/]+)\/(compliance|hr)(?:\/(.*))?$/);
      if(!match)throw new HttpError(404,'Not found');
      const scope={organisationId:decodeURIComponent(match[1]),facilityId:decodeURIComponent(match[2]),section:match[3]},route=match[4]??'',who=session.principal_id;
      if(route===''&&req.method==='GET')return send(res,200,await service.list(who,scope,url.searchParams.get('q')??''));
      if(route==='folders'&&req.method==='POST')return send(res,201,await service.createFolder(who,scope,input));
      if(route==='files'&&req.method==='POST')return send(res,201,await service.upload(who,scope,input));
      if(route==='members'&&req.method==='GET')return send(res,200,await service.members(who,scope));
      if(route==='activity'&&req.method==='GET')return send(res,200,await service.activity(who,scope));
      const folder=route.match(/^folders\/([^/]+)$/);
      if(folder&&req.method==='PUT')return send(res,200,await service.updateFolder(who,scope,folder[1],input));
      const controlled=route.match(/^files\/([^/]+)\/controlled$/);
      if(controlled&&req.method==='PUT')return send(res,200,await service.enableApproval(who,scope,controlled[1],input));
      const decisions=route.match(/^files\/([^/]+)\/approvals\/([^/]+)\/decision$/);
      if(decisions&&req.method==='PUT')return send(res,200,await service.decideApproval(who,scope,decisions[1],decisions[2],input));
      const reviews=route.match(/^files\/([^/]+)\/approvals$/);
      if(reviews&&req.method==='GET')return send(res,200,await service.approvalHistory(who,scope,reviews[1]));
      if(reviews&&req.method==='POST')return send(res,201,await service.submitApproval(who,scope,reviews[1],input));
      const publish=route.match(/^files\/([^/]+)\/publications$/);
      if(publish&&req.method==='POST')return send(res,201,await service.publishApproval(who,scope,publish[1],input));
      const file=route.match(/^files\/([^/]+)(?:\/(versions|content|privacy|grants))?$/);
      if(file){const [,fid,action]=file;
        if(!action&&req.method==='GET')return send(res,200,await service.detail(who,scope,fid));
        if(!action&&req.method==='PUT')return send(res,200,await service.update(who,scope,fid,input));
        if(action==='versions'&&req.method==='POST')return send(res,201,await service.upload(who,scope,input,fid));
        if(action==='privacy'&&req.method==='PUT')return send(res,200,await service.privacy(who,scope,fid,input));
        if(action==='grants'&&req.method==='GET')return send(res,200,await service.grants(who,scope,fid));
        if(action==='grants'&&req.method==='PUT')return send(res,200,await service.grant(who,scope,fid,input));
        if(action==='content'&&req.method==='GET'){
          const content=await service.content(who,scope,fid,url.searchParams.get('version'));const previewFile=url.searchParams.get('preview')==='1';
          res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; sandbox");
          res.setHeader('Content-Disposition',`${previewFile?'inline':'attachment'}; filename="document.${content.mime==='application/pdf'?'pdf':content.mime.includes('wordprocessingml')?'docx':'txt'}"`);
          if(previewFile&&content.mime.includes('wordprocessingml'))return send(res,200,docxText(content.bytes),'text/plain; charset=utf-8');
          return send(res,200,content.bytes,content.mime);
        }
      }
      throw new HttpError(404,'Not found');
    }catch(error){
      if(error.code==='23505')error=new HttpError(409,'A record with that name already exists');
      if(error.code==='23503')error=new HttpError(422,'The destination or member is unavailable');
      if(!res.headersSent)send(res,error.status??500,{message:error.status?error.message:'The request could not be completed'});
      else res.end();
    }
  });
  server.requestTimeout=45000;server.headersTimeout=15000;
  return server;
}
