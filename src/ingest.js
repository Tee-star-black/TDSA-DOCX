import {createHash,randomUUID} from 'node:crypto';
import {readZip} from './zip.js';
import {AppError} from './store.js';

export function ingestArchive(store,files,input,actor){
 if(!actor.permissions?.includes('documents.manage'))throw new AppError(403,'Document management permission required');
 if(!input||typeof input!=='object')throw new AppError(422,'Invalid import request');
 if(typeof input.content!=='string'||input.content.length>14*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content))throw new AppError(422,'Invalid ZIP encoding');
 const archive=Buffer.from(input.content,'base64'),archiveHash=createHash('sha256').update(archive).digest('hex');
 const previous=store.db.prepare('SELECT summary FROM imports WHERE archive_hash=? AND facility_id=?').get(archiveHash,actor.facilityId);
 if(previous)return {...JSON.parse(previous.summary),alreadyImported:true};
 const entries=readZip(archive),pdfs=entries.filter(e=>e.name.toLowerCase().endsWith('.pdf'));
 if(!pdfs.length)throw new AppError(422,'No PDFs found in this ZIP');
 const prior=store.documents(),unique=new Map();let duplicates=0;
 for(const entry of pdfs){
  if(entry.data.subarray(0,5).toString()!=='%PDF-')throw new AppError(422,'A PDF entry has an invalid file signature');
  const sha256=createHash('sha256').update(entry.data).digest('hex'),filename=entry.name.split('/').pop();
  if(unique.has(sha256)){unique.get(sha256).metadata.aliases.push(filename);duplicates++;continue;}
  const known=prior.find(d=>d.sha256===sha256),scanned=known?.restricted??/^(DOC\d|scan)/i.test(filename);
  let kind=/^SOP/i.test(filename)?'SOP':/register/i.test(filename)?'Register':/log/i.test(filename)?'Log':'Form';
  const category=kind==='SOP'?'Policies & SOPs':kind==='Register'?'Registers':kind==='Log'?'Operational logs':'Form templates';
  const metadata=known?{...known,aliases:[...(known.aliases??[])]}:{id:'source-'+sha256.slice(0,24),filename,title:filename.replace(/\.pdf$/i,'').replace(/_/g,' '),kind:scanned?'Scanned bundle':kind,category:scanned?'Restricted review':category,facility:'Applicability awaiting owner review',code:null,version:null,effectiveDate:null,reviewDate:null,status:'review',sha256,pages:null,restricted:scanned,issues:['Metadata inferred from filename. Confirm content, completeness, applicability and approval before clinical use.'],templateId:null,aliases:[]};
  metadata.audience=known?.audience??(known?.templateId==='complaint'||/(complaint|feedback).*form/i.test(filename)?'patient':'clinician');
  if(scanned&&!metadata.issues.some(s=>s.includes('Restricted')))metadata.issues.push('Restricted pending review for scans, completed records or identifying information.');
  unique.set(sha256,{metadata,bytes:entry.data});
 }
 const db=store.db;db.exec('BEGIN IMMEDIATE');
 try{
  let restricted=0;
  for(const {metadata,bytes} of unique.values()){
   db.prepare('INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(metadata.id,JSON.stringify(metadata));
   let folder=files.tree(actor).find(f=>f.parent_id===null&&f.name===metadata.category);
   if(!folder)folder=files.createFolder({name:metadata.category},actor);
   if(!db.prepare('SELECT document_id FROM source_locations WHERE document_id=?').get(metadata.id))files.moveSource(metadata.id,{folderId:folder.id},actor);
   if(metadata.restricted)restricted++;else store.putBlob(metadata.sha256,bytes);
  }
  // Synthetic examples are removed only after a successful real source import.
  for(const demo of prior.filter(d=>d.id.startsWith('demo-'))){db.prepare('DELETE FROM source_locations WHERE document_id=?').run(demo.id);db.prepare('DELETE FROM documents WHERE id=?').run(demo.id);}
  const summary={sourceEntries:pdfs.length,uniqueDocuments:unique.size,duplicates,restricted,stored:unique.size-restricted,alreadyImported:false};
  db.prepare('INSERT INTO imports VALUES (?,?,?,?,?,?)').run(randomUUID(),archiveHash,actor.facilityId,actor.id,new Date().toISOString(),JSON.stringify(summary));
  store.audit(actor,'archive.imported',archiveHash);db.exec('COMMIT');return summary;
 }catch(err){db.exec('ROLLBACK');throw err;}
}
