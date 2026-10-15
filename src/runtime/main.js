import {createPool,assertRuntimeDatabase} from './database.js';
import {documentService} from './documents.js';
import {gcpStorage,gcpScanner} from './storage.js';
import {sessionStore,createOidcLogin} from './identity.js';
import {createHubServer} from './server.js';

let pool;
try{
  const env=process.env;
  for(const name of ['TDSA_POSTGRES_URL','TDSA_PUBLIC_ORIGIN','TDSA_OIDC_ISSUER','TDSA_OIDC_CLIENT_ID','TDSA_OIDC_CLIENT_SECRET','TDSA_COMPLIANCE_BUCKET','TDSA_HR_BUCKET','TDSA_SCANNER_URL'])if(!env[name])throw Error(`Missing required configuration: ${name}`);
  const url=new URL(env.TDSA_PUBLIC_ORIGIN);if(url.protocol!=='https:'||url.origin!==env.TDSA_PUBLIC_ORIGIN)throw Error('TDSA_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  pool=createPool(env.TDSA_POSTGRES_URL);await assertRuntimeDatabase(pool);
  const storage=await gcpStorage({complianceBucket:env.TDSA_COMPLIANCE_BUCKET,hrBucket:env.TDSA_HR_BUCKET});
  const scanner=await gcpScanner(env.TDSA_SCANNER_URL),sessions=sessionStore(pool);
  const login=await createOidcLogin(pool,sessions,{issuer:env.TDSA_OIDC_ISSUER,clientId:env.TDSA_OIDC_CLIENT_ID,clientSecret:env.TDSA_OIDC_CLIENT_SECRET,origin:env.TDSA_PUBLIC_ORIGIN});
  const service=documentService(pool,storage,scanner),server=createHubServer({service,sessions,login,origin:env.TDSA_PUBLIC_ORIGIN});
  server.listen(Number(env.PORT??8080),'0.0.0.0',()=>console.log('Document Hub started with PostgreSQL, verified sign-in and private GCP storage.'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
}catch(error){
  await pool?.end();console.error(error.message.startsWith('Missing required configuration:')?error.message:'Document Hub startup failed. Verify the approved database role, migrations, sign-in, scanner and private bucket configuration.');process.exitCode=1;
}
