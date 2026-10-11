import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
const marker=Buffer.from('TDSAENC1');
export function blobCrypto(encodedKey){
 let key=null;
 if(encodedKey){key=Buffer.from(encodedKey,'base64');if(key.length!==32||key.toString('base64')!==encodedKey)throw new Error('TDSA_BLOB_KEY_B64 must be a canonical base64 encoded 32-byte key');}
 const encrypted=bytes=>bytes.subarray(0,marker.length).equals(marker);
 return {enabled:Boolean(key),encrypted,
  encode(hash,bytes){if(!key)return bytes;const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(hash));const content=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([marker,nonce,cipher.getAuthTag(),content]);},
  decode(hash,bytes,isEncrypted=encrypted(bytes)){let content=bytes;if(isEncrypted){if(!key)throw new Error('Encrypted documents require the original TDSA_BLOB_KEY_B64');try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));decipher.setAAD(Buffer.from(hash));decipher.setAuthTag(bytes.subarray(20,36));content=Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}catch{throw new Error('Document encryption key is incorrect or contents were modified');}}
   if(createHash('sha256').update(content).digest('hex')!==hash)throw new Error('Document integrity check failed');return content;}
 };
}
