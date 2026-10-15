import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {migratePostgres} from '../postgres-migrations.js';
import {digest} from '../runtime/database.js';
import {randomUUID} from 'node:crypto';

export const profiles={
  compliance:{id:'10000000-0000-4000-8000-000000000001',name:'Compliance manager'},
  hr:{id:'10000000-0000-4000-8000-000000000002',name:'HR manager'},
  employee:{id:'10000000-0000-4000-8000-000000000003',name:'Employee A'},
  colleague:{id:'10000000-0000-4000-8000-000000000004',name:'Employee B'},
  dual:{id:'10000000-0000-4000-8000-000000000005',name:'Both departments'}
};
export const scope=section=>({organisationId:'preview-org',facilityId:'preview-facility',section});
export async function previewDatabase(path){
  if(process.env.NODE_ENV==='production')throw Error('Synthetic preview is unavailable in production');
  const db=new PGlite(path);await migratePostgres(db);
  await db.exec("INSERT INTO document_hub.organisations VALUES('preview-org','Synthetic organisation') ON CONFLICT DO NOTHING; INSERT INTO document_hub.facilities VALUES('preview-org','preview-facility','Synthetic facility') ON CONFLICT DO NOTHING;");
  for(const [key,p] of Object.entries(profiles))await db.query("INSERT INTO hub_identity.principals VALUES($1,'urn:tdsa:synthetic-preview',$2,$3,true) ON CONFLICT DO NOTHING",[p.id,key,p.name]);
  for(const [key,section,role] of [['compliance','compliance','manager'],['hr','hr','manager'],['employee','hr','reader'],['colleague','hr','reader'],['dual','hr','manager'],['dual','compliance','manager']])await db.query("INSERT INTO hub_identity.memberships VALUES('preview-org','preview-facility',$1,$2,$3,true) ON CONFLICT DO NOTHING",[section,profiles[key].id,role]);
  const {rows}=await db.query("SELECT 1 FROM pg_roles WHERE rolname='tdsa_runtime'");
  if(!rows.length)await db.exec(readFileSync(new URL('../../scripts/runtime-grants.sql',import.meta.url),'utf8'));
  await db.exec('SET ROLE tdsa_runtime');
  let tail=Promise.resolve();
  const pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query:(...args)=>db.query(...args),release};},end:()=>db.close()};
  const admin=async work=>{const c=await pool.connect();try{await db.exec('RESET ROLE');return await work(db);}finally{await db.exec('SET ROLE tdsa_runtime');c.release();}};
  return {pool,admin};
}
export function memoryStorage(){const values=new Map();return {kind:'synthetic-memory',values,async put(scope,bytes,hash){if(digest(bytes)!==hash)throw Error('Integrity');const key=scope.section+'/'+randomUUID();values.set(key,Buffer.from(bytes));return {key,generation:'1'};},async get(scope,{key,hash}){if(!key.startsWith(scope.section+'/'))throw Error('Scope');const bytes=values.get(key);if(!bytes||digest(bytes)!==hash)throw Error('Integrity');return bytes;}};}
export const previewScanner={kind:'synthetic-only',async scan(){}};
