import {randomUUID} from 'node:crypto';
import {scoped,HttpError,requireEditor,requireManager,audit} from './database.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function recordId(value){if(typeof value!=='string'||!uuid.test(value))throw new HttpError(422,'Invalid record identifier');return value;}
function revision(value){if(!Number.isSafeInteger(value)||value<1)throw new HttpError(422,'A current document revision is required');return value;}
function note(value,required=false){if(value===undefined||value===null)value='';if(typeof value!=='string'||value.length>2000||(required&&!value.trim()))throw new HttpError(422,'Provide a review note of up to 2000 characters');return value.trim();}
function checkRevision(f,input){if(f.revision!==revision(input.revision))throw new HttpError(409,'Document changed. Refresh before continuing.');}
async function getControlled(c,fileId){const {rows:[f]}=await c.query('SELECT * FROM document_hub.files WHERE id=$1 FOR UPDATE',[recordId(fileId)]);if(!f)throw new HttpError(404,'Document not found');return f;}
function ensureControlled(f){if(!f.requires_approval)throw new HttpError(422,'Document is not controlled for review and publication');if(f.archived)throw new HttpError(409,'Restore the document before changing its publication');}
async function latest(c,fileId){const {rows:[v]}=await c.query('SELECT id,version,author_id FROM document_hub.file_versions WHERE file_id=$1 ORDER BY version DESC LIMIT 1',[fileId]);if(!v)throw new HttpError(404,'Document version not found');return v;}
function values(a){return[a.organisationId,a.facilityId,a.section];}

export function approvalService(pool){
  const run=(principal,scope,fn)=>scoped(pool,principal,scope,fn);
  return {
    enableApproval(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);const f=await getControlled(c,fileId);checkRevision(f,input);
      if(f.requires_approval)throw new HttpError(409,'Document already uses controlled approval');
      if(f.archived)throw new HttpError(409,'Restore the document before enabling approval');
      if(!['section','team'].includes(f.privacy))throw new HttpError(422,'Only section or team documents may use controlled publication');
      await c.query('UPDATE document_hub.files SET requires_approval=true,revision=revision+1 WHERE id=$1',[f.id]);
      await audit(c,a,'file.approval_required',f.id);return {id:f.id,requiresApproval:true};
    });},
    approvalHistory(principal,scope,fileId){return run(principal,scope,async(c,a)=>{
      const {rows:[f]}=await c.query('SELECT id,requires_approval FROM document_hub.files WHERE id=$1',[recordId(fileId)]);
      if(!f)throw new HttpError(404,'Document not found');
      const {rows:[publication]}=await c.query(`SELECT p.version_id,v.version,p.published_at
        FROM document_hub.file_publications p JOIN document_hub.file_versions v ON v.id=p.version_id
        WHERE p.file_id=$1 ORDER BY p.id DESC LIMIT 1`,[fileId]);
      if(a.role==='reader')return {requiresApproval:f.requires_approval,publishedVersion:publication?.version??null,reviews:[]};
      const {rows:reviews}=await c.query(`SELECT r.id,r.status,r.version_id,v.version,r.submitted_by,r.submission_note,r.submitted_at,
          r.reviewed_by,r.review_note,r.reviewed_at
        FROM document_hub.file_approvals r JOIN document_hub.file_versions v ON v.id=r.version_id
        WHERE r.file_id=$1 ORDER BY r.submitted_at DESC,r.id DESC LIMIT 30`,[fileId]);
      return {requiresApproval:f.requires_approval,publishedVersion:publication?.version??null,reviews};
    });},
    submitApproval(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireEditor(a);const f=await getControlled(c,fileId);ensureControlled(f);checkRevision(f,input);
      const version=await latest(c,f.id),{rows:pending}=await c.query("SELECT id FROM document_hub.file_approvals WHERE file_id=$1 AND status='pending'",[f.id]);
      if(pending.length)throw new HttpError(409,'This version already awaits approval');
      const rid=randomUUID();await c.query(`INSERT INTO document_hub.file_approvals
        (organisation_id,facility_id,section,id,file_id,version_id,submitted_by,submission_note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[...values(a),rid,f.id,version.id,principal,note(input.note)]);
      await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[f.id]);
      await audit(c,a,'file.approval_submitted',f.id);return {id:rid,fileId:f.id,version:version.version,status:'pending'};
    });},
    decideApproval(principal,scope,fileId,approvalId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);const f=await getControlled(c,fileId);ensureControlled(f);checkRevision(f,input);
      if(!['approved','rejected'].includes(input.decision))throw new HttpError(422,'Choose approve or reject');
      const {rows:[review]}=await c.query('SELECT * FROM document_hub.file_approvals WHERE id=$1 AND file_id=$2 FOR UPDATE',[recordId(approvalId),f.id]);
      if(!review)throw new HttpError(404,'Approval request not found');
      if(review.status!=='pending')throw new HttpError(409,'Approval request has already been decided');
      const version=await latest(c,f.id);
      if(review.version_id!==version.id)throw new HttpError(409,'Newer draft uploaded; submit that version for review');
      if(review.submitted_by===principal||version.author_id===principal)throw new HttpError(403,'The submitter or version author cannot approve their own work');
      const comment=note(input.note,input.decision==='rejected');
      await c.query(`UPDATE document_hub.file_approvals SET status=$1,reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$4`,[input.decision,principal,comment,review.id]);
      await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[f.id]);
      await audit(c,a,input.decision==='approved'?'file.approval_approved':'file.approval_rejected',f.id);
      return {id:review.id,status:input.decision,fileId:f.id,version:version.version};
    });},
    publishApproval(principal,scope,fileId,input){return run(principal,scope,async(c,a)=>{
      requireManager(a);const f=await getControlled(c,fileId);ensureControlled(f);checkRevision(f,input);
      const version=await latest(c,f.id);
      const {rows:[review]}=await c.query(`SELECT id FROM document_hub.file_approvals
        WHERE file_id=$1 AND version_id=$2 AND status='approved'
        ORDER BY reviewed_at DESC LIMIT 1`,[f.id,version.id]);
      if(!review)throw new HttpError(409,'Latest version needs independent approval before publication');
      const {rows:[already]}=await c.query('SELECT id FROM document_hub.file_publications WHERE file_id=$1 AND version_id=$2',[f.id,version.id]);
      if(already)throw new HttpError(409,'This version is already published');
      await c.query(`INSERT INTO document_hub.file_publications
        (organisation_id,facility_id,section,file_id,version_id,approval_id,published_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[...values(a),f.id,version.id,review.id,principal]);
      await c.query('UPDATE document_hub.files SET revision=revision+1 WHERE id=$1',[f.id]);
      await audit(c,a,'file.version_published',f.id);
      return {id:f.id,publishedVersion:version.version};
    });}
  };
}
