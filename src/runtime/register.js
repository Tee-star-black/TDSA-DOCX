import {randomUUID} from 'node:crypto';
import {scoped, HttpError, requireEditor, requireManager, audit} from './database.js';

// Section-specific taxonomy: labels only. Actual access is always checked by
// scoped PostgreSQL operations and existing document privacy policies.
export const CATEGORIES = Object.freeze({
  compliance: ['General', 'Clinical & Medical', 'Compliance & Governance', 'Operations', 'Projects', 'Templates & Forms'],
  hr: ['General', 'HR & Staff', 'Operations', 'Projects', 'Templates & Forms'],
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = value => {if(typeof value!=='string'||!uuid.test(value))throw new HttpError(422,'Invalid record ID');return value;};
function short(value,description='Text',limit=150){
  if(typeof value!=='string'||!value.trim()||value.trim().length>limit||/[\x00-\x1f]/.test(value))throw new HttpError(422,`${description} must contain 1-${limit} characters`);
  return value.trim();
}
function optionalDate(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new HttpError(422,'Choose a valid date in YYYY-MM-DD format');
  return value;
}
function category(value,section){
  if(!CATEGORIES[section]?.includes(value))throw new HttpError(422,'Choose an approved category for this section');
  return value;
}
function revision(value){if(!Number.isSafeInteger(value)||value<1)throw new HttpError(422,'Refresh and supply the latest document revision');return value;}
async function member(c,a,id){
  if(id===null||id===undefined||id==='')return null;
  validId(id);
  const {rows:[exists]}=await c.query(`SELECT 1 FROM hub_identity.memberships m JOIN hub_identity.principals p ON p.id=m.principal_id
    WHERE m.organisation_id=$1 AND m.facility_id=$2 AND m.section=$3
      AND m.principal_id=$4 AND m.active AND p.active`,[a.organisationId,a.facilityId,a.section,id]);
  if(!exists)throw new HttpError(422,'Choose an active member of this document section');
  return id;
}
async function editable(c,a,file){
  requireEditor(a);
  if(file.privacy==='personal')requireManager(a);
  if(file.privacy==='restricted'){
    const {rows}=await c.query(`SELECT 1 FROM document_hub.file_grants
      WHERE file_id=$1 AND principal_id=$2 AND capability='manage'`,[file.id,a.principalId]);
    if(!rows.length)throw new HttpError(403,'Manage access is required to classify this document');
  }
}
function scopeArgs(a){return [a.organisationId,a.facilityId,a.section];}
function requireInput(input){if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(422,'Invalid document register request');}
export function registerService(pool){
  const run=(principal,scope,work)=>scoped(pool,principal,scope,work);
  return {
    updateClassification(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireInput(input);
      const {rows:[file]}=await c.query('SELECT * FROM document_hub.files WHERE id=$1 FOR UPDATE',[validId(fileId)]);
      if(!file)throw new HttpError(404,'Document not found');
      await editable(c,a,file);
      if(file.archived)throw new HttpError(409,'Restore the document before changing its classification');
      if(file.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before saving');
      const {rows:[existing]}=await c.query('SELECT * FROM document_hub.file_metadata WHERE file_id=$1',[file.id]);
      if(!existing)throw new HttpError(409,'Document metadata is unavailable');
      const nextOwner=input.ownerPrincipalId===undefined?existing.owner_principal_id:input.ownerPrincipalId;
      if(input.ownerPrincipalId!==undefined && input.ownerPrincipalId!==existing.owner_principal_id)requireManager(a);
      const owner=await member(c,a,nextOwner);
      const cat=category(input.category??(existing.category==='general'?'General':existing.category)??'General',a.section);
      const type=short(input.documentType??existing.document_type??'Reference','Document type',80);
      const review=optionalDate(input.reviewDate===undefined?existing.review_date:input.reviewDate);
      const expiry=optionalDate(input.expiresOn===undefined?existing.expires_on:input.expiresOn);
      const tags=input.tags===undefined?existing.tags:input.tags;
      if(!Array.isArray(tags)||tags.length>12||tags.some(v=>typeof v!=='string'||v.trim().length<1||v.length>40||/[\x00-\x1f]/.test(v)))throw new HttpError(422,'Use up to 12 short document tags');
      await c.query(`UPDATE document_hub.file_metadata SET category=$1,document_type=$2,review_date=$3,
        expires_on=$4,owner_principal_id=$5,tags=$6::jsonb,revision=revision+1,
        review_status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE file_id=$7`,
        [cat,type,review,expiry,owner,JSON.stringify(tags.map(x=>x.trim())),file.id]);
      await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[file.id]);
      await audit(c,a,'file.classification_updated',file.id);
      return {id:file.id,revision:file.revision+1};
    });},
    requirements(principal,scope){return run(principal,scope,async(c,a)=>{
      const {rows}=await c.query(`SELECT r.id,r.title,r.category,r.due_on,r.assigned_principal_id,
        p.display_name AS assigned_name,r.fulfilled_file_id,f.title AS file_title,
        f.archived AS file_archived,f.requires_approval,
        m.expires_on AS linked_expiry,
        EXISTS(SELECT 1 FROM document_hub.file_publications pub WHERE pub.file_id=f.id) AS has_publication
        FROM document_hub.document_requirements r
        LEFT JOIN hub_identity.principals p ON p.id=r.assigned_principal_id
        LEFT JOIN document_hub.files f ON f.id=r.fulfilled_file_id
        LEFT JOIN document_hub.file_metadata m ON m.file_id=f.id
        ORDER BY r.due_on NULLS LAST,lower(r.title) LIMIT 250`);
      const today=new Date().toISOString().slice(0,10);
      const result=rows.map(r=>({
        ...r,
        missing:!r.fulfilled_file_id||!r.file_title||r.file_archived||(r.requires_approval&&!r.has_publication)||(r.linked_expiry!==null && r.linked_expiry!==undefined && String(r.linked_expiry).slice(0,10)<today),
      }));
      return {configured:result.length>0,missing:result.filter(x=>x.missing).length,requirements:result,role:a.role};
    });},
    createRequirement(principal,scope,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);requireInput(input);
      const title=short(input.title,'Requirement title');
      const cat=category(input.category??'General',a.section),due=optionalDate(input.dueOn),assigned=await member(c,a,input.assignedPrincipalId);
      const id=randomUUID();
      await c.query(`INSERT INTO document_hub.document_requirements
        (organisation_id,facility_id,section,id,title,category,due_on,assigned_principal_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[...scopeArgs(a),id,title,cat,due,assigned,principal]);
      await audit(c,a,'requirement.created',id);
      return {id};
    });},
    linkRequirement(principal,scope,requirementId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);requireInput(input);
      const {rows:[rule]}=await c.query('SELECT * FROM document_hub.document_requirements WHERE id=$1 FOR UPDATE',[validId(requirementId)]);
      if(!rule)throw new HttpError(404,'Requirement not found');
      const fileId=input.fileId===null?null:validId(input.fileId);
      if(fileId){
        const {rows:[file]}=await c.query('SELECT * FROM document_hub.files WHERE id=$1',[fileId]);
        if(!file||file.archived)throw new HttpError(422,'Choose an accessible, active document');
        if(file.privacy==='personal' && (!rule.assigned_principal_id||file.subject_id!==rule.assigned_principal_id))throw new HttpError(422,'This employee record does not match the assigned requirement');
        if(rule.assigned_principal_id){
          const {rows:[assignee]}=await c.query(`SELECT role FROM hub_identity.memberships m
            JOIN hub_identity.principals p ON p.id=m.principal_id
            WHERE m.organisation_id=$1 AND m.facility_id=$2 AND m.section=$3
              AND m.principal_id=$4 AND m.active AND p.active`,[...scopeArgs(a),rule.assigned_principal_id]);
          if(!assignee)throw new HttpError(422,'The assigned employee no longer belongs to this section');
          let canRead=file.privacy==='section'||(file.privacy==='team'&&['editor','manager'].includes(assignee.role))||
            (file.privacy==='personal'&&file.subject_id===rule.assigned_principal_id);
          if(file.privacy==='restricted'){
            const {rows:[grant]}=await c.query('SELECT 1 FROM document_hub.file_grants WHERE file_id=$1 AND principal_id=$2',[file.id,rule.assigned_principal_id]);
            canRead=Boolean(grant);
          }
          if(!canRead)throw new HttpError(422,'The assigned employee cannot open this document');
        }
        if(file.privacy==='restricted'){
          const {rows:grants}=await c.query(`SELECT 1 FROM document_hub.file_grants WHERE file_id=$1 AND principal_id=$2 AND capability='manage'`,[file.id,principal]);
          if(!grants.length)throw new HttpError(403,'Manage permission is required to link a restricted document');
        }
      }
      await c.query('UPDATE document_hub.document_requirements SET fulfilled_file_id=$1,updated_at=now() WHERE id=$2',[fileId,rule.id]);
      await audit(c,a,fileId?'requirement.file_linked':'requirement.file_unlinked',rule.id);
      return {id:rule.id,fulfilledFileId:fileId};
    });},
  };
}
