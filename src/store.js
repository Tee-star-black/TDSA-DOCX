import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {validateSubmission} from './forms.js';

export class AppError extends Error {constructor(status,message,errors={}){super(message);this.status=status;this.errors=errors;}}
export function openStore(filename, cataloguePath) {
  if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, template_id TEXT NOT NULL, template_version INTEGER NOT NULL, facility_id TEXT NOT NULL, author_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','submitted')), data TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT);
    CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id), facility_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const catalogue=JSON.parse(readFileSync(cataloguePath,'utf8'));
  const insert=db.prepare('INSERT INTO documents VALUES (?,?)');
  db.exec('BEGIN; DELETE FROM documents;');
  try {for(const item of catalogue) insert.run(item.id,JSON.stringify(item));db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
  const audit=(actor,action,id)=>db.prepare('INSERT INTO audit(actor_id,action,record_id,created_at) VALUES (?,?,?,?)').run(actor.id,action,id,new Date().toISOString());
  function getSubmission(id,actor){
    const row=db.prepare('SELECT * FROM submissions WHERE id=? AND author_id=? AND facility_id=?').get(id,actor.id,actor.facilityId);
    if(!row) throw new AppError(404,'Record not found');
    return map(row);
  }
  function map(r){return {id:r.id,templateId:r.template_id,templateVersion:r.template_version,facilityId:r.facility_id,authorId:r.author_id,status:r.status,data:JSON.parse(r.data),revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,submittedAt:r.submitted_at};}
  function save(input,actor,final=false,id=null){
    const v=validateSubmission(input,{final}); if(Object.keys(v.errors).length) throw new AppError(422,'Check the form fields',v.errors);
    if(input.facilityId!==actor.facilityId) throw new AppError(403,'Facility is not authorised');
    db.exec('BEGIN IMMEDIATE');
    try{
      const now=new Date().toISOString(); let record;
      if(id){
        const previous=getSubmission(id,actor);
        if(previous.templateId!==input.templateId || previous.templateVersion!==input.templateVersion) throw new AppError(409,'A draft cannot change template');
        if(previous.status==='submitted') {
          if(final && JSON.stringify(previous.data)===JSON.stringify(v.data)) {db.exec('COMMIT');return previous;}
          throw new AppError(409,'Submitted records are locked. Amendments are not available in this pilot.');
        }
        if(input.revision!==previous.revision) throw new AppError(409,'This draft changed. Reload before saving.');
        db.prepare('UPDATE submissions SET data=?,status=?,revision=revision+1,updated_at=?,submitted_at=? WHERE id=?').run(JSON.stringify(v.data),final?'submitted':'draft',now,final?now:null,id);
        record=getSubmission(id,actor);
      }else{
        if(final) throw new AppError(400,'Save a draft before submission');
        id=randomUUID();db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,v.template.id,v.template.version,actor.facilityId,actor.id,'draft',JSON.stringify(v.data),1,now,now,null);
        record=getSubmission(id,actor);
      }
      if(final && v.template.id==='complaint') db.prepare('INSERT OR IGNORE INTO cases VALUES (?,?,?,?,?,?)').run(randomUUID(),id,actor.facilityId,v.data.type,'received',now);
      audit(actor,final?'submission.finalised':'draft.saved',id); db.exec('COMMIT');return record;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {
    db,save,getSubmission,audit,
    documents:()=>db.prepare('SELECT metadata FROM documents').all().map(r=>JSON.parse(r.metadata)),
    submissions:actor=>db.prepare('SELECT * FROM submissions WHERE facility_id=? AND author_id=? ORDER BY updated_at DESC').all(actor.facilityId,actor.id).map(map),
    cases:actor=>db.prepare('SELECT cases.* FROM cases JOIN submissions ON submissions.id=cases.submission_id WHERE cases.facility_id=? AND submissions.author_id=? ORDER BY cases.created_at DESC').all(actor.facilityId,actor.id),
    close:()=>db.close()
  };
}
