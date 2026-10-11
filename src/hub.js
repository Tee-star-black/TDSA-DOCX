import {AppError} from './store.js';
import {categories,documentTypes,suggestClassification,extractText} from './classification.js';

export function documentHub(store,files){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS file_metadata(file_id TEXT PRIMARY KEY REFERENCES files(id), category TEXT NOT NULL DEFAULT 'general', document_type TEXT NOT NULL DEFAULT 'Reference', confidentiality TEXT NOT NULL DEFAULT 'internal', review_status TEXT NOT NULL DEFAULT 'pending', tags TEXT NOT NULL DEFAULT '[]', review_date TEXT, revision INTEGER NOT NULL DEFAULT 1, suggestion TEXT, reviewed_by TEXT, reviewed_at TEXT);`);
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?,?)').run(2,new Date().toISOString());
 function manager(actor){if(!actor.permissions?.includes('documents.manage'))throw new AppError(403,'Document management permission required');}
 function metadata(id,actor){files.file(id,actor);const r=db.prepare('SELECT * FROM file_metadata WHERE file_id=?').get(id);return r?{...r,tags:JSON.parse(r.tags),suggestion:r.suggestion?JSON.parse(r.suggestion):null}:{file_id:id,category:'general',document_type:'Reference',confidentiality:'internal',review_status:'pending',tags:[],review_date:null,revision:0,suggestion:null};}
 function initialise(id,actor){manager(actor);const versions=files.versions(id,actor),v=versions[0];
  const bytes=store.getBlob(v.hash);const text=v.mime.startsWith('text/plain')?bytes.toString('utf8'):'';
  const suggestion=suggestClassification(v.filename,text,text?'text':'filename');
  db.prepare('INSERT INTO file_metadata(file_id,suggestion) VALUES (?,?) ON CONFLICT(file_id) DO UPDATE SET suggestion=excluded.suggestion,review_status=\'pending\',reviewed_by=NULL,reviewed_at=NULL,revision=revision+1').run(id,JSON.stringify(suggestion));return metadata(id,actor);
 }
 async function classify(id,actor){manager(actor);const original=metadata(id,actor);const v=files.versions(id,actor)[0];const result=await extractText(store.getBlob(v.hash),v.mime);
  const suggestion=suggestClassification(v.filename,result.text,result.extraction);
  if(files.versions(id,actor)[0].version!==v.version||metadata(id,actor).revision!==original.revision)throw new AppError(409,'Document changed during extraction. Try again.');
  db.prepare('INSERT INTO file_metadata(file_id,suggestion) VALUES (?,?) ON CONFLICT(file_id) DO UPDATE SET suggestion=excluded.suggestion,revision=revision+1').run(id,JSON.stringify(suggestion));store.audit(actor,'file.classification_suggested',id);return metadata(id,actor);
 }
 function update(id,input,actor){manager(actor);const old=metadata(id,actor);
  if(input.revision!==old.revision)throw new AppError(409,'Document metadata changed. Reload before saving.');
  const value={category:input.category??old.category,document_type:input.document_type??old.document_type,confidentiality:input.confidentiality??old.confidentiality,review_status:input.review_status??old.review_status,tags:input.tags??old.tags,review_date:input.review_date===undefined?old.review_date:input.review_date};
  if(!categories.some(c=>c.id===value.category)||!documentTypes.includes(value.document_type)||!['internal','restricted'].includes(value.confidentiality)||!['pending','reviewed'].includes(value.review_status)||!Array.isArray(value.tags)||value.tags.length>10||value.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40))throw new AppError(422,'Invalid document metadata');
  if(value.review_date!==null&&(typeof value.review_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.review_date)||!Number.isFinite(Date.parse(value.review_date))||new Date(value.review_date).toISOString().slice(0,10)!==value.review_date))throw new AppError(422,'Choose a valid review date');
  if(value.confidentiality!==old.confidentiality&&!actor.permissions?.includes('documents.restricted'))throw new AppError(403,'Restricted document permission required');
  const reviewed=value.review_status==='reviewed';
  db.prepare(`INSERT INTO file_metadata(file_id,category,document_type,confidentiality,review_status,tags,review_date,revision,suggestion,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET category=excluded.category,document_type=excluded.document_type,confidentiality=excluded.confidentiality,review_status=excluded.review_status,tags=excluded.tags,review_date=excluded.review_date,revision=excluded.revision,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`).run(id,value.category,value.document_type,value.confidentiality,value.review_status,JSON.stringify([...new Set(value.tags.map(t=>t.trim()))]),value.review_date,old.revision+1,old.suggestion?JSON.stringify(old.suggestion):null,reviewed?actor.id:null,reviewed?new Date().toISOString():null);
  store.audit(actor,reviewed?'file.metadata_reviewed':'file.metadata_updated',id);return metadata(id,actor);
 }
 function bulk(input,actor){manager(actor);if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100||input.ids.some(id=>typeof id!=='string')||new Set(input.ids).size!==input.ids.length)throw new AppError(422,'Select between 1 and 100 distinct files');
  if(!['move','archive','restore'].includes(input.action))throw new AppError(422,'Unknown bulk action');
  if(input.action==='move'&&input.folderId!==null&&typeof input.folderId!=='string')throw new AppError(422,'Choose a destination');
  db.exec('BEGIN IMMEDIATE');try{for(const id of input.ids){files.updateFile(id,input.action==='move'?{folderId:input.folderId}:{archived:input.action==='archive'},actor);}db.exec('COMMIT');return {updated:input.ids.length};}catch(err){db.exec('ROLLBACK');throw err;}
 }
 function setupFolders(actor){manager(actor);db.exec('BEGIN IMMEDIATE');try{const tree=files.tree(actor);for(const c of categories){if(!tree.some(f=>f.parent_id===null&&f.name.toLowerCase()===c.name.toLowerCase()))files.createFolder({name:c.name},actor);}db.exec('COMMIT');return files.tree(actor);}catch(err){db.exec('ROLLBACK');throw err;}}
 return {metadata,initialise,classify,update,bulk,setupFolders,categories,documentTypes,
  list:actor=>files.files(actor).map(f=>({...f,metadata:metadata(f.id,actor)})),
  activity:actor=>{manager(actor);return db.prepare("SELECT a.* FROM audit a WHERE a.record_id IN (SELECT id FROM files WHERE facility_id=? UNION SELECT id FROM folders WHERE facility_id=?) ORDER BY a.id DESC LIMIT 50").all(actor.facilityId,actor.facilityId);},
  status:()=>({mode:'local-preview',classification:{provider:'local-rules',cloudAI:false,ocr:false},encryption:store.encryptionStatus(),connections:[{id:'clinician',name:'TDSA clinician app',status:'not-connected'},{id:'patient',name:'TDSA patient app',status:'not-connected'},{id:'medcnx',name:'MedCNX HR',status:'not-connected'},{id:'drive',name:'Google Drive',status:'not-connected'},{id:'cloudsql',name:'Cloud SQL / PostgreSQL',status:'not-connected'}]})
 };
}
