import {Storage} from '@google-cloud/storage';
import {GoogleAuth} from 'google-auth-library';
import {randomUUID} from 'node:crypto';
import {digest,HttpError,sections} from './database.js';

export function objectPrefix(scope){if(!sections.includes(scope.section))throw Error('Invalid storage section');return `${scope.section}/${digest(JSON.stringify([scope.organisationId,scope.facilityId]))}/`;}
function verify(bytes,hash,size){if(digest(bytes)!==hash||(size!==undefined&&bytes.length!==size))throw Error('Stored document integrity check failed');return bytes;}
export async function gcpStorage({complianceBucket,hrBucket,client=new Storage()}) {
  if(!complianceBucket||!hrBucket||complianceBucket===hrBucket)throw Error('Two distinct private buckets are required');
  const buckets={compliance:client.bucket(complianceBucket),hr:client.bucket(hrBucket)};
  for(const bucket of Object.values(buckets)){
    const [m]=await bucket.getMetadata();
    if(!m.iamConfiguration?.uniformBucketLevelAccess?.enabled||m.iamConfiguration?.publicAccessPrevention!=='enforced')throw Error('Both buckets must enforce uniform access and public access prevention');
  }
  return {
    kind:'gcs',
    async put(scope,bytes,hash){
      verify(bytes,hash);const key=objectPrefix(scope)+randomUUID(),file=buckets[scope.section].file(key);
      await file.save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}});
      const [metadata]=await file.getMetadata();const generation=String(metadata.generation);
      if(!/^\d+$/.test(generation))throw Error('Missing immutable object generation');
      const [readback]=await buckets[scope.section].file(key,{generation}).download({validation:'crc32c'});
      verify(readback,hash,bytes.length);return {key,generation};
    },
    async get(scope,{key,generation,hash,size}){
      if(!key.startsWith(objectPrefix(scope))||!/^\d+$/.test(generation))throw Error('Object scope mismatch');
      const [bytes]=await buckets[scope.section].file(key,{generation}).download({validation:'crc32c'});return verify(bytes,hash,size);
    }
  };
}
export async function gcpScanner(url,{auth=new GoogleAuth()}={}){
  const endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('An approved HTTPS scanning service is required');
  const client=await auth.getIdTokenClient(endpoint.origin);
  return {kind:'authenticated-scanner',async scan(bytes,hash){
    let result;
    try{result=await client.request({url:endpoint.href,method:'POST',data:bytes,headers:{'Content-Type':'application/octet-stream','X-Content-SHA256':hash},timeout:30000,retry:false,responseType:'json'});}
    catch{throw new HttpError(503,'Document scanning is unavailable. Please try again later.');}
    if(result.data?.sha256!==hash)throw new HttpError(503,'Document scanning could not verify this file');
    if(result.data?.verdict==='infected')throw new HttpError(422,'The document was rejected by the security scanner');
    if(result.data?.verdict!=='clean')throw new HttpError(503,'Document scanning is incomplete');
  }};
}
