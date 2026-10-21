import pg from 'pg';
import {randomBytes,createHash} from 'node:crypto';

export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const sections = ['compliance','hr'];
export function createPool(connectionString) {
  if (!connectionString) throw Error('TDSA_POSTGRES_URL is required; there is no SQLite fallback');
  return new pg.Pool({connectionString,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
}
export async function transaction(pool,work) {
  const c=await pool.connect();
  try {await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
export async function assertRuntimeDatabase(pool) {
  const c=await pool.connect();
  try {
    const {rows:[role]}=await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    const {rows:[owner]}=await c.query("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname IN ('document_hub','hub_identity') AND tableowner=current_user) AS owns_tables");
    if(role.rolsuper||role.rolbypassrls||owner.owns_tables)throw Error('Use a non-owner PostgreSQL runtime role without BYPASSRLS');
    const {rows}=await c.query("SELECT name FROM public.tdsa_schema_migrations WHERE name='004_document_register.sql'");
    if(!rows.length)throw Error('Apply all document register migrations with the separate migration identity first');
  } finally{c.release();}
}
export async function scoped(pool,principalId,scope,work) {
  if(!sections.includes(scope.section))throw new HttpError(404,'Section not found');
  return transaction(pool,async c=>{
    const {rows:[member]}=await c.query(`SELECT m.* FROM hub_identity.memberships m JOIN hub_identity.principals p ON p.id=m.principal_id
      WHERE m.principal_id=$1 AND m.organisation_id=$2 AND m.facility_id=$3 AND m.section=$4 AND m.active AND p.active`,[principalId,scope.organisationId,scope.facilityId,scope.section]);
    if(!member)throw new HttpError(403,'You do not have access to this section');
    await c.query(`SELECT set_config('tdsa.organisation_id',$1,true),set_config('tdsa.facility_id',$2,true),set_config('tdsa.section',$3,true),set_config('tdsa.principal_id',$4,true),set_config('tdsa.role',$5,true)`,[scope.organisationId,scope.facilityId,scope.section,principalId,member.role]);
    return work(c,{...scope,principalId,role:member.role});
  });
}
export function requireEditor(actor){if(!['editor','manager'].includes(actor.role))throw new HttpError(403,'Document editing permission required');}
export function requireManager(actor){if(actor.role!=='manager')throw new HttpError(403,'Section manager permission required');}
export async function audit(c,a,action,id){await c.query('INSERT INTO document_hub.audit(organisation_id,facility_id,section,actor_id,action,record_id) VALUES($1,$2,$3,$4,$5,$6)',[a.organisationId,a.facilityId,a.section,a.principalId,action,id]);}
