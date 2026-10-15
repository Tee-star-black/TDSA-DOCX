import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gcpStorage,gcpScanner} from '../src/runtime/storage.js';
import {digest} from '../src/runtime/database.js';
import {scope,previewDatabase,profiles} from '../src/dev/fixtures.js';
import {sessionStore,createOidcLogin} from '../src/runtime/identity.js';
import {generateKeyPairSync,createSign} from 'node:crypto';

test('GCP adapter requires two private buckets, pins generations, checks bytes and rejects wrong section',async()=>{
  const values=new Map(),calls=[];let privateBuckets=true;
  const client={bucket(name){return {getMetadata:async()=>[{iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:privateBuckets?'enforced':'inherited'}}],file(key,options={}){const k=name+'/'+key;return {
    save:async(bytes,opts)=>{assert.equal(opts.preconditionOpts.ifGenerationMatch,0);values.set(k,Buffer.from(bytes));calls.push({bucket:name,key});},
    getMetadata:async()=>[{generation:'123'}],download:async()=>{assert.equal(options.generation,'123');return [values.get(k)];}
  };}};}};
  await assert.rejects(gcpStorage({complianceBucket:'same',hrBucket:'same',client}),/distinct/);
  privateBuckets=false;await assert.rejects(gcpStorage({complianceBucket:'c',hrBucket:'h',client}),/public access/);privateBuckets=true;
  const storage=await gcpStorage({complianceBucket:'c',hrBucket:'h',client}),bytes=Buffer.from('Synthetic GCP adapter test'),hash=digest(bytes);
  const object=await storage.put(scope('hr'),bytes,hash);assert.equal(calls[0].bucket,'h');
  assert.deepEqual(await storage.get(scope('hr'),{...object,hash,size:bytes.length}),bytes);
  await assert.rejects(storage.get(scope('compliance'),{...object,hash,size:bytes.length}),/scope/);
  values.set('h/'+object.key,Buffer.from('tamper'));await assert.rejects(storage.get(scope('hr'),{...object,hash,size:bytes.length}),/integrity/);
});
test('authenticated scanner accepts only a matching clean verdict and fails closed on outage',async()=>{
  const bytes=Buffer.from('sample'),hash=digest(bytes);let verdict='clean',responseHash=hash,offline=false;
  const auth={getIdTokenClient:async audience=>{assert.equal(audience,'https://scanner.example');return {request:async options=>{assert.deepEqual(options.data,bytes);assert.equal(options.timeout,30000);assert.equal(options.retry,false);if(offline)throw Error('offline');return {data:{verdict,sha256:responseHash}};}};}};
  const scanner=await gcpScanner('https://scanner.example/scan',{auth});await scanner.scan(bytes,hash);
  verdict='infected';await assert.rejects(scanner.scan(bytes,hash),e=>e.status===422);
  verdict='unknown';await assert.rejects(scanner.scan(bytes,hash),e=>e.status===503);
  verdict='clean';responseHash='wrong';await assert.rejects(scanner.scan(bytes,hash),e=>e.status===503);
  offline=true;await assert.rejects(scanner.scan(bytes,hash),e=>e.status===503);
});

test('OIDC code flow verifies signatures, nonce and audience; binds browser state; prevents replay; revokes sessions',async()=>{
  const {pool,admin}=await previewDatabase(),sessions=sessionStore(pool),issuer='https://identity.example',origin='https://hub.example';
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
  let nonce='',badAudience=false,badNonce=false,badSignature=false;
  const signed=claims=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');const message=h+'.'+p;return message+'.'+createSign('RSA-SHA256').update(message).sign(privateKey).toString('base64url');};
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('openid-configuration'))return json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']});
    if(path==='/jwks')return json({keys:[jwk]});
    if(path==='/token'){let jwt=signed({iss:issuer,sub:'employee-a',aud:badAudience?'other':'hub-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,nonce:badNonce?'wrong':nonce});if(badSignature)jwt=jwt.slice(0,-12)+'AAAAAAAAAAAA';return json({access_token:'unused-test-token',token_type:'Bearer',expires_in:3600,id_token:jwt});}
    throw Error('Unexpected provider URL');
  };
  try{
    await admin(db=>db.query('UPDATE hub_identity.principals SET issuer=$1,subject=$2 WHERE id=$3',[issuer,'employee-a',profiles.employee.id]));
    const login=await createOidcLogin(pool,sessions,{issuer,clientId:'hub-client',clientSecret:'synthetic-secret',origin,fetcher});
    const begin=async()=>{const attempt=await login.begin(),url=new URL(attempt.url);nonce=url.searchParams.get('nonce');assert.equal(url.searchParams.get('code_challenge_method'),'S256');return {attempt,url:new URL(origin+'/auth/callback?code=synthetic&state='+url.searchParams.get('state')),req:{headers:{cookie:attempt.cookie.split(';')[0]}}};};
    let b=await begin();await assert.rejects(login.complete({headers:{cookie:'__Host-tdsa-login=wrong'}},b.url),e=>e.status===401);
    const cookies=await login.complete(b.req,b.url),req={headers:{cookie:cookies[0].split(';')[0]}};
    assert.equal((await sessions.resolve(req)).principal_id,profiles.employee.id);
    await assert.rejects(login.complete(b.req,b.url),e=>e.status===401);
    for(const flag of ['audience','nonce','signature']){b=await begin();badAudience=flag==='audience';badNonce=flag==='nonce';badSignature=flag==='signature';await assert.rejects(login.complete(b.req,b.url),e=>e.status===401);}
    await sessions.logout(req);await assert.rejects(sessions.resolve(req),e=>e.status===401);
    const fresh=await sessions.create(profiles.employee.id,new Date(Date.now()+60000));
    await admin(db=>db.query('UPDATE hub_identity.principals SET active=false WHERE id=$1',[profiles.employee.id]));
    await assert.rejects(sessions.resolve({headers:{cookie:fresh.split(';')[0]}}),e=>e.status===401);
  }finally{await pool.end();}
});
