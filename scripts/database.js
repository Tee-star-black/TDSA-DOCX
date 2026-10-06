import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,copyFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.js';

export function restoreDatabase(source,target){
 const db=new DatabaseSync(source,{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');
  for(const table of ['schema_migrations','documents','file_blobs','folders','files','file_versions','submissions','cases'])if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('Not a compatible TDSA workspace backup');
 }finally{db.close();}
 const temp=target+'.restore-'+randomUUID();copyFileSync(source,temp);const check=new DatabaseSync(temp);try{check.exec('PRAGMA journal_mode=DELETE;');}finally{check.close();}
 if(existsSync(target)){const current=new DatabaseSync(target);try{current.prepare('VACUUM INTO ?').run(target+'.before-restore-'+Date.now());}finally{current.close();}}
 for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix);
 copyFileSync(temp,target);unlinkSync(temp);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));const directory=resolve(root,process.env.TDSA_DATA_DIR??'.data'),target=join(directory,'pilot.sqlite');
 const command=process.argv[2];
 try{
  if(command==='restore'){
   if(!process.argv.includes('--confirm'))throw Error('Restoring replaces the workspace. Stop the app, then use: npm run db:restore -- path/to/backup.sqlite --confirm');
   const pidFile=join(directory,'server.pid');if(existsSync(pidFile)){const pid=Number(readFileSync(pidFile,'utf8'));let active=false;try{process.kill(pid,0);active=true;}catch(err){if(err.code==='EPERM')active=true;}if(active)throw Error('Stop the running app before restoring');}
   if(!process.argv[3]||process.argv[3]==='--confirm')throw Error('Specify a backup file');
   mkdirSync(directory,{recursive:true});restoreDatabase(resolve(process.argv[3]),target);console.log('Workspace restored. Start the app and check your records.');
  }else{
   const {store}=createApp({dataDir:directory});console.log(JSON.stringify({engine:'SQLite',connected:true,integrity:store.db.prepare('PRAGMA quick_check').get().quick_check,documents:store.documents().length},null,2));store.close();
  }
 }catch(err){console.error(err.message);process.exitCode=1;}
}
