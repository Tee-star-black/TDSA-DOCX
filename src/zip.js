import {inflateRawSync} from 'node:zlib';
import {AppError} from './store.js';

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function readZip(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>10*1024*1024)throw new AppError(422,'Choose a ZIP archive up to 10 MiB');
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0)throw new AppError(422,'Invalid ZIP archive');
 const entries=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),centralStart=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||entries!==bytes.readUInt16LE(end+8)||entries>1000||centralStart+centralSize!==end)throw new AppError(422,'Unsupported or oversized ZIP directory');
 const result=[],names=new Set();let offset=centralStart,total=0;
 try{
  for(let i=0;i<entries;i++){
   if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw Error();
   const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),compressed=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24);
   const nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
   const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
   if(offset+46+nameLength+extraLength+commentLength>end||flags&1||flags&0x40||![0,8].includes(method)||bytes.readUInt16LE(offset+34)||size>10*1024*1024||compressed>10*1024*1024||local+30>centralStart)throw Error();
   if(!name||name.includes('\u0000')||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>p==='..')||names.has(name))throw Error();
   names.add(name);total+=size;if(total>50*1024*1024)throw Error();
   if(bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method)throw Error();
   const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),dataStart=local+30+localName+localExtra;
   if(bytes.subarray(local+30,local+30+localName).toString('utf8')!==name||dataStart+compressed>centralStart)throw Error();
   const packed=bytes.subarray(dataStart,dataStart+compressed),data=method===8?inflateRawSync(packed,{maxOutputLength:10*1024*1024}):packed;
   if(data.length!==size||crc32(data)!==crc)throw Error();
   if(!name.endsWith('/'))result.push({name,data});
   offset+=46+nameLength+extraLength+commentLength;
  }
  if(offset!==end)throw Error();return result;
 }catch{throw new AppError(422,'ZIP validation failed. Use an unencrypted standard ZIP without unsafe paths.');}
}
