import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {AppError} from './store.js';

export function explorer(store,dataDir){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id), facility_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id), facility_id TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS file_versions(id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id), version INTEGER NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(file_id,version));
 CREATE TABLE IF NOT EXISTS source_locations(document_id TEXT PRIMARY KEY REFERENCES documents(id), folder_id TEXT REFERENCES folders(id));`);
 const permission=(actor)=>{if(!actor.permissions?.includes('documents.manage'))throw new AppError(403,'Document management permission required');};
 const folder=(id,actor)=>{if(id===null)return null;const r=db.prepare('SELECT * FROM folders WHERE id=? AND facility_id=?').get(id,actor.facilityId);if(!r)throw new AppError(404,'Folder not found');return r;};
 const file=(id,actor)=>{const r=db.prepare('SELECT * FROM files WHERE id=? AND facility_id=?').get(id,actor.facilityId);if(!r)throw new AppError(404,'File not found');return r;};
 const name=(s)=>{if(typeof s!=='string'||!s.trim()||s.trim().length>150||/[\x00-\x1f/\\]/.test(s))throw new AppError(422,'Use a name of 1–150 characters without slashes');return s.trim();};
 const tree=(actor)=>db.prepare('SELECT * FROM folders WHERE facility_id=? ORDER BY name COLLATE NOCASE').all(actor.facilityId);
 function createFolder(input,actor){permission(actor);const parent=input.parentId??null;folder(parent,actor);const title=name(input.name);
  if(db.prepare('SELECT id FROM folders WHERE facility_id=? AND parent_id IS ? AND name=? COLLATE NOCASE').get(actor.facilityId,parent,title))throw new AppError(409,'A folder with that name already exists here');
  const id=randomUUID();db.prepare('INSERT INTO folders VALUES (?,?,?,?,?)').run(id,parent,actor.facilityId,title,new Date().toISOString());store.audit(actor,'folder.created',id);return folder(id,actor);
 }
 function updateFolder(id,input,actor){permission(actor);const old=folder(id,actor);const parent=input.parentId===undefined?old.parent_id:input.parentId;folder(parent,actor);let next=parent;
  while(next){if(next===id)throw new AppError(422,'Cannot move a folder into itself or its descendants');next=folder(next,actor).parent_id;}
  const title=input.name===undefined?old.name:name(input.name);
  if(db.prepare('SELECT id FROM folders WHERE facility_id=? AND parent_id IS ? AND name=? COLLATE NOCASE AND id<>?').get(actor.facilityId,parent,title,id))throw new AppError(409,'A folder with that name already exists here');
  db.prepare('UPDATE folders SET name=?,parent_id=? WHERE id=?').run(title,parent,id);store.audit(actor,'folder.updated',id);return folder(id,actor);
 }
 function upload(input,actor,id=null){permission(actor);const existing=id?file(id,actor):null;if(existing?.archived)throw new AppError(409,'Restore the file before adding a version');
  const parent=existing?existing.folder_id:(input.folderId??null);folder(parent,actor);
  if(typeof input.content!=='string'||input.content.length>5700000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content))throw new AppError(422,'Invalid or oversized file encoding');
  const bytes=Buffer.from(input.content,'base64');if(!bytes.length||bytes.length>4*1024*1024)throw new AppError(422,'Choose a file between 1 byte and 4 MiB');
  const filename=name(input.filename);const ext=filename.split('.').pop().toLowerCase();let mime;
  if(ext==='pdf'&&bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
  else if(ext==='txt'&&!bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD'))mime='text/plain; charset=utf-8';
  else throw new AppError(422,'This milestone accepts PDF and UTF-8 TXT files only');
  const title=existing?.title??name(input.title??filename);const hash=createHash('sha256').update(bytes).digest('hex');
  const objects=join(dataDir,'objects');mkdirSync(objects,{recursive:true});const target=join(objects,hash);const temp=join(objects,randomUUID()+'.tmp');writeFileSync(temp,bytes);renameSync(temp,target);
  db.exec('BEGIN IMMEDIATE');try{const now=new Date().toISOString();id??=randomUUID();
   if(!existing)db.prepare('INSERT INTO files(id,folder_id,facility_id,title,created_at) VALUES (?,?,?,?,?)').run(id,parent,actor.facilityId,title,now);
   const version=Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM file_versions WHERE file_id=?').get(id).n);
   db.prepare('INSERT INTO file_versions VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,version,filename,mime,hash,bytes.length,actor.id,now);
   store.audit(actor,'file.version_added',id);db.exec('COMMIT');return {...file(id,actor),version};
  }catch(err){db.exec('ROLLBACK');throw err;}
 }
 function versions(id,actor){file(id,actor);return db.prepare('SELECT * FROM file_versions WHERE file_id=? ORDER BY version DESC').all(id);}
 function updateFile(id,input,actor){permission(actor);const r=file(id,actor);const parent=input.folderId===undefined?r.folder_id:input.folderId;folder(parent,actor);if(input.archived!==undefined&&typeof input.archived!=='boolean')throw new AppError(422,'Invalid archive state');
  db.prepare('UPDATE files SET title=?,folder_id=?,archived=? WHERE id=?').run(input.title===undefined?r.title:name(input.title),parent,input.archived===undefined?r.archived:Number(input.archived),id);store.audit(actor,'file.updated',id);return file(id,actor);
 }
 function moveSource(id,input,actor){permission(actor);if(!store.documents().some(d=>d.id===id))throw new AppError(404,'Source document not found');folder(input.folderId??null,actor);db.prepare('INSERT INTO source_locations VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET folder_id=excluded.folder_id').run(id,input.folderId??null);store.audit(actor,'document.moved',id);}
 return {tree,createFolder,updateFolder,upload,versions,updateFile,moveSource,file,
  files:actor=>db.prepare('SELECT f.*,v.version,v.filename,v.mime,v.size,v.created_at AS updated_at FROM files f JOIN file_versions v ON v.file_id=f.id WHERE f.facility_id=? AND v.version=(SELECT MAX(version) FROM file_versions WHERE file_id=f.id) ORDER BY f.title COLLATE NOCASE').all(actor.facilityId),
  locations:actor=>db.prepare('SELECT l.* FROM source_locations l LEFT JOIN folders f ON f.id=l.folder_id WHERE l.folder_id IS NULL OR f.facility_id=?').all(actor.facilityId)
 };
}
