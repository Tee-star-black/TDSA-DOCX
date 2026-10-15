import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {previewDatabase,profiles,previewScanner} from '../src/dev/fixtures.js';
import {digest,HttpError,assertRuntimeDatabase} from '../src/runtime/database.js';
import {objectPrefix} from '../src/runtime/storage.js';
import {documentService} from '../src/runtime/documents.js';
import {sessionStore} from '../src/runtime/identity.js';
import {createHubServer} from '../src/runtime/server.js';

if(process.env.NODE_ENV==='production')throw Error('Preview cannot run in production');
const directory=new URL('../.data/pg-preview/',import.meta.url);mkdirSync(directory,{recursive:true});
const {fileURLToPath}=await import('node:url');const root=fileURLToPath(directory),{pool}=await previewDatabase(join(root,'database'));
await assertRuntimeDatabase(pool);
const storage={kind:'local-synthetic',async put(scope,bytes,hash){if(digest(bytes)!==hash)throw Error('Integrity');const key=objectPrefix(scope)+randomUUID(),path=join(root,'objects',key);mkdirSync(join(root,'objects',objectPrefix(scope)),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});return {key,generation:'1'};},async get(scope,{key,hash,size}){if(!key.startsWith(objectPrefix(scope))||key.includes('..'))throw Error('Scope');const bytes=readFileSync(join(root,'objects',key));if(bytes.length!==size||digest(bytes)!==hash)throw Error('Integrity');return bytes;}};
const service=documentService(pool,storage,previewScanner),sessions=sessionStore(pool,{secure:false});
const seeded=join(root,'seeded');
if(!existsSync(seeded)){
  const base={organisationId:'preview-org',facilityId:'preview-facility'};
  for(const [profile,section,title,privacy,subjectId,text] of [
    ['compliance','compliance','Policy review checklist','section',null,'Synthetic compliance checklist. Review policies, confirm owners and record approval.'],
    ['compliance','compliance','Audit preparation notes','team',null,'Synthetic internal notes for the compliance team.'],
    ['hr','hr','Staff handbook','section',null,'Synthetic staff handbook for employees with HR access.'],
    ['hr','hr','Employee A qualification record','personal',profiles.employee.id,'Synthetic employee A record. Visible to employee A and authorised HR managers.'],
    ['hr','hr','Restricted HR review','restricted',null,'Synthetic confidential review. Available only through named access.']
  ])await service.upload(profiles[profile].id,{...base,section},{title,filename:'example.txt',privacy,subjectId,content:Buffer.from(text).toString('base64')});
  writeFileSync(seeded,'synthetic-only');
}
const server=createHubServer({service,sessions,preview:true,previewLogin:async profile=>{if(!profiles[profile])throw new HttpError(400,'Choose a preview profile');return sessions.create(profiles[profile].id,new Date(Date.now()+3600000));}});
server.listen(Number(process.env.PORT??8895),'127.0.0.1',()=>console.log(`Synthetic PostgreSQL preview: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
