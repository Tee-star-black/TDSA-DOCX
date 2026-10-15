import {randomUUID} from 'node:crypto';
import {scoped,HttpError,requireEditor,requireManager,audit,digest} from './database.js';
import {docxText} from '../classification.js';

export const privacyLevels=['section','team','personal','restricted'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(value){if(typeof value!=='string'||!uuid.test(value))throw new HttpError(422,'Invalid record identifier');return value;}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>150||/[\x00-\x1f/\\]/.test(value))throw new HttpError(422,'Use a name of 1–150 characters without slashes');return value.trim();}
function revision(value){if(!Number.isSafeInteger(value)||value<1)throw new HttpError(422,'A current document revision is required');return value;}
function scopeValues(a){return [a.organisationId,a.facilityId,a.section];}
async function getFile(c,fileId,lock=false){const {rows:[f]}=await c.query(`SELECT * FROM document_hub.files WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id(fileId)]);if(!f)throw new HttpError(404,'Document not found');return f;}
async function canEdit(c,a,f){requireEditor(a);if(f.privacy==='personal')requireManager(a);if(f.privacy==='restricted'){const {rows}=await c.query("SELECT 1 FROM document_hub.file_grants WHERE file_id=$1 AND principal_id=$2 AND capability='manage'",[f.id,a.principalId]);if(!rows.length)throw new HttpError(403,'This document is shared with you for reading only');}}
async function folder(c,folderId){if(folderId===null)return null;const {rows:[f]}=await c.query('SELECT * FROM document_hub.folders WHERE id=$1',[id(folderId)]);if(!f)throw new HttpError(404,'Folder not found');return f;}
function validatePrivacy(input,section){if(!privacyLevels.includes(input.privacy))throw new HttpError(422,'Choose a valid privacy level');if(input.privacy==='personal'){if(section!=='hr')throw new HttpError(422,'Employee records belong in HR');id(input.subjectId);}else if(input.subjectId)throw new HttpError(422,'Only employee records can have an employee owner');}
async function validSubject(c,a,subjectId){if(!subjectId)return;const {rows}=await c.query(`SELECT 1 FROM hub_identity.memberships m JOIN hub_identity.principals p ON p.id=m.principal_id WHERE organisation_id=$1 AND facility_id=$2 AND section=$3 AND principal_id=$4 AND m.active AND p.active`,[...scopeValues(a),subjectId]);if(!rows.length)throw new HttpError(422,'Choose an active member of this section');}
export function uploadBytes(input){
  if(typeof input.content!=='string'||input.content.length>5600000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content))throw new HttpError(422,'Invalid document encoding');
  const bytes=Buffer.from(input.content,'base64');if(!bytes.length||bytes.length>4*1024*1024)throw new HttpError(422,'Choose a document between 1 byte and 4 MiB');
  const filename=name(input.filename),ext=filename.split('.').at(-1).toLowerCase();let mime;
  if(ext==='pdf'&&bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
  else if(ext==='txt'&&!bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD'))mime='text/plain; charset=utf-8';
  else if(ext==='docx'){try{docxText(bytes);}catch{throw new HttpError(422,'Invalid DOCX document');}mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';}
  else throw new HttpError(422,'Choose a PDF, DOCX or UTF-8 text document');
  return {bytes,filename,mime,hash:digest(bytes)};
}

export function documentService(pool,storage,scanner){
  const run=(principal,scope,work)=>scoped(pool,principal,scope,work);
  return {
    list(principal,scope,query=''){
      if(query.length>150)throw new HttpError(422,'Search is too long');
      return run(principal,scope,async(c,a)=>{
        const {rows:folders}=await c.query('SELECT id,parent_id,name FROM document_hub.folders ORDER BY lower(name)');
        const {rows:files}=await c.query(`SELECT f.*,v.version,v.filename,v.mime,v.created_at AS updated_at,o.size_bytes AS size,m.category,m.tags,m.review_status,m.review_date
          FROM document_hub.files f JOIN LATERAL(SELECT * FROM document_hub.file_versions WHERE file_id=f.id ORDER BY version DESC LIMIT 1)v ON true
          JOIN document_hub.objects o ON o.id=v.object_id LEFT JOIN document_hub.file_metadata m ON m.file_id=f.id
          WHERE position(lower($1) in lower(f.title||' '||COALESCE(m.tags::text,'')))>0 ORDER BY lower(f.title)`,[query]);
        return {folders,files,role:a.role,section:a.section};
      });
    },
    createFolder(principal,scope,input){return run(principal,scope,async(c,a)=>{requireEditor(a);const parent=input.parentId??null;await folder(c,parent);const fid=randomUUID();await c.query('INSERT INTO document_hub.folders(organisation_id,facility_id,section,id,parent_id,name) VALUES($1,$2,$3,$4,$5,$6)',[...scopeValues(a),fid,parent,name(input.name)]);await audit(c,a,'folder.created',fid);return {id:fid};});},
    updateFolder(principal,scope,folderId,input){return run(principal,scope,async(c,a)=>{
      requireEditor(a);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[JSON.stringify(scopeValues(a))]);
      const old=await folder(c,folderId),parent=input.parentId===undefined?old.parent_id:input.parentId;let next=parent,seen=new Set([old.id]);
      while(next){if(seen.has(next))throw new HttpError(422,'A folder cannot be placed inside itself');seen.add(next);next=(await folder(c,next)).parent_id;}
      await c.query('UPDATE document_hub.folders SET name=$1,parent_id=$2 WHERE id=$3',[input.name===undefined?old.name:name(input.name),parent,old.id]);await audit(c,a,'folder.updated',old.id);return {id:old.id};
    });},
    async upload(principal,scope,input,fileId=null){
      const data=uploadBytes(input);
      const title=name(input.title??data.filename);
      if(!fileId)validatePrivacy({privacy:input.privacy??'team',subjectId:input.subjectId},scope.section);
      const preflight=async(c,a)=>{
        requireEditor(a);
        if(fileId){const f=await getFile(c,fileId,true);await canEdit(c,a,f);if(f.archived)throw new HttpError(409,'Restore the document before adding a version');if(f.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before uploading.');}
        else {if(['personal','restricted','section'].includes(input.privacy))requireManager(a);await folder(c,input.folderId??null);await validSubject(c,a,input.subjectId);}
      };
      await run(principal,scope,preflight);
      await scanner.scan(data.bytes,data.hash);
      const stored=await storage.put(scope,data.bytes,data.hash);
      // Recheck membership, privacy and revision after external calls. Failed
      // transactions leave an unreferenced private object for reconciliation.
      return run(principal,scope,async(c,a)=>{
        await preflight(c,a);const fid=fileId??randomUUID(),oid=randomUUID(),vid=randomUUID();
        if(!fileId){
          await c.query('INSERT INTO document_hub.files(organisation_id,facility_id,section,id,folder_id,title,privacy,subject_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...scopeValues(a),fid,input.folderId??null,title,input.privacy??'team',input.subjectId??null]);
          await c.query("INSERT INTO document_hub.file_grants(organisation_id,facility_id,section,file_id,principal_id,capability) VALUES($1,$2,$3,$4,$5,'manage')",[...scopeValues(a),fid,principal]);
        }
        await c.query(`INSERT INTO document_hub.objects(organisation_id,facility_id,section,id,sha256,size_bytes,storage_key,storage_generation,scan_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'clean')`,[...scopeValues(a),oid,data.hash,data.bytes.length,stored.key,stored.generation]);
        const {rows:[count]}=await c.query('SELECT COALESCE(MAX(version),0)+1 AS n FROM document_hub.file_versions WHERE file_id=$1',[fid]);
        await c.query('INSERT INTO document_hub.file_versions(organisation_id,facility_id,section,id,file_id,version,object_id,filename,mime,author_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[...scopeValues(a),vid,fid,count.n,oid,data.filename,data.mime,principal]);
        await c.query(`INSERT INTO document_hub.file_metadata(organisation_id,facility_id,section,file_id) VALUES($1,$2,$3,$4)
          ON CONFLICT(organisation_id,facility_id,file_id) DO UPDATE SET review_status='pending',reviewed_by=NULL,reviewed_at=NULL,revision=document_hub.file_metadata.revision+1`,[...scopeValues(a),fid]);
        if(fileId)await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[fid]);
        await audit(c,a,'file.version_added',fid);return {id:fid,version:count.n};
      });
    },
    detail(principal,scope,fileId){return run(principal,scope,async(c,a)=>{
      const f=await getFile(c,fileId);const {rows:versions}=await c.query('SELECT id,version,filename,mime,author_id,created_at FROM document_hub.file_versions WHERE file_id=$1 ORDER BY version DESC',[f.id]);
      const {rows:[metadata]}=await c.query('SELECT category,tags,review_status,review_date,revision FROM document_hub.file_metadata WHERE file_id=$1',[f.id]);
      let editable=true;try{await canEdit(c,a,f);}catch(e){if(e.status!==403)throw e;editable=false;}
      return {...f,versions,metadata,editable,canManagePrivacy:a.role==='manager'&&editable};
    });},
    update(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      const f=await getFile(c,fileId,true);await canEdit(c,a,f);
      if(f.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before saving.');
      if(input.section!==undefined&&input.section!==a.section)throw new HttpError(422,'Sharing across sections is not enabled');
      const parent=input.folderId===undefined?f.folder_id:input.folderId;await folder(c,parent);
      if(input.archived!==undefined&&typeof input.archived!=='boolean')throw new HttpError(422,'Invalid archive state');
      await c.query('UPDATE document_hub.files SET title=$1,folder_id=$2,archived=$3,revision=revision+1 WHERE id=$4',[input.title===undefined?f.title:name(input.title),parent,input.archived??f.archived,f.id]);await audit(c,a,'file.updated',f.id);return {id:f.id};
    });},
    privacy(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);const f=await getFile(c,fileId,true);await canEdit(c,a,f);if(f.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before saving.');
      validatePrivacy(input,a.section);await validSubject(c,a,input.subjectId);
      // A fresh privacy boundary must not revive previously assigned access.
      // Keep the acting manager's grant until after the update so restricted
      // row visibility remains available throughout this transaction.
      if(input.privacy!==f.privacy)await c.query('DELETE FROM document_hub.file_grants WHERE file_id=$1 AND principal_id<>$2',[f.id,principal]);
      await c.query(`INSERT INTO document_hub.file_grants(organisation_id,facility_id,section,file_id,principal_id,capability) VALUES($1,$2,$3,$4,$5,'manage') ON CONFLICT(organisation_id,facility_id,section,file_id,principal_id) DO UPDATE SET capability='manage'`,[...scopeValues(a),f.id,principal]);
      await c.query('UPDATE document_hub.files SET privacy=$1,subject_id=$2,revision=revision+1 WHERE id=$3',[input.privacy,input.subjectId??null,f.id]);await audit(c,a,'file.privacy_changed',f.id);return {id:f.id};
    });},
    members(principal,scope){return run(principal,scope,async(c,a)=>{requireManager(a);const {rows}=await c.query('SELECT p.id,p.display_name,m.role FROM hub_identity.memberships m JOIN hub_identity.principals p ON p.id=m.principal_id WHERE m.organisation_id=$1 AND m.facility_id=$2 AND m.section=$3 AND m.active AND p.active ORDER BY p.display_name',scopeValues(a));return rows;});},
    grants(principal,scope,fileId){return run(principal,scope,async(c,a)=>{requireManager(a);const f=await getFile(c,fileId);await canEdit(c,a,f);const {rows}=await c.query('SELECT g.principal_id,g.capability,p.display_name FROM document_hub.file_grants g JOIN hub_identity.principals p ON p.id=g.principal_id WHERE file_id=$1',[f.id]);return rows;});},
    grant(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);const f=await getFile(c,fileId,true);await canEdit(c,a,f);if(f.privacy!=='restricted')throw new HttpError(422,'Named access applies to restricted documents');
      if(f.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before saving.');
      id(input.principalId);if(input.principalId===principal)throw new HttpError(422,'Another authorised manager must change your own access');
      if(!['read','manage','revoke'].includes(input.capability))throw new HttpError(422,'Invalid access permission');
      if(input.capability==='revoke')await c.query('DELETE FROM document_hub.file_grants WHERE file_id=$1 AND principal_id=$2',[f.id,input.principalId]);
      else {await validSubject(c,a,input.principalId);await c.query('INSERT INTO document_hub.file_grants(organisation_id,facility_id,section,file_id,principal_id,capability) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organisation_id,facility_id,section,file_id,principal_id) DO UPDATE SET capability=excluded.capability',[...scopeValues(a),f.id,input.principalId,input.capability]);}
      await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[f.id]);await audit(c,a,input.capability==='revoke'?'file.access_revoked':'file.access_granted',f.id);return {id:f.id};
    });},
    async content(principal,scope,fileId,version){
      if(version!==null&&(!/^\d+$/.test(version)||Number(version)<1))throw new HttpError(422,'Invalid version');
      const select=async c=>{await getFile(c,fileId);const {rows:[v]}=await c.query(`SELECT v.filename,v.mime,v.version,o.* FROM document_hub.file_versions v JOIN document_hub.objects o ON o.id=v.object_id WHERE v.file_id=$1 ${version===null?'':'AND v.version=$2'} ORDER BY v.version DESC LIMIT 1`,version===null?[fileId]:[fileId,Number(version)]);if(!v)throw new HttpError(404,'Version not found');return v;};
      const v=await run(principal,scope,select);const bytes=await storage.get(scope,{key:v.storage_key,generation:v.storage_generation,hash:v.sha256,size:Number(v.size_bytes)});
      await run(principal,scope,async(c,a)=>{await select(c);await audit(c,a,'file.downloaded',fileId);});return {bytes,mime:v.mime,filename:v.filename};
    },
    activity(principal,scope){return run(principal,scope,async(c,a)=>{requireEditor(a);return (await c.query('SELECT action,record_id,actor_id,created_at FROM document_hub.audit ORDER BY id DESC LIMIT 50')).rows;});}
  };
}
