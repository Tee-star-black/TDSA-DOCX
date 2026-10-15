import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function check(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const path=join(dir,f.name);if(f.isDirectory())check(path);else if(f.name.endsWith('.js')){const r=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}}}
for(const dir of ['src','scripts','public','public-hub'])check(dir);
console.log('JavaScript syntax checks passed.');
