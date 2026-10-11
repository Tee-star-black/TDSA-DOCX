import {readZip} from './zip.js';
import {AppError} from './store.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const categories=[
 {id:'clinical',name:'Clinical forms',description:'Clinical assessments and practice templates'},
 {id:'consent',name:'Consent & patient rights',description:'Consent templates and patient rights policies'},
 {id:'sops',name:'Policies & SOPs',description:'Practice policies and standard operating procedures'},
 {id:'infection',name:'Infection prevention',description:'Cleaning, sterilisation and infection control'},
 {id:'medicines',name:'Medicines & dispensing',description:'Medication records and dispensing procedures'},
 {id:'governance',name:'Governance & compliance',description:'Audits, compliance and quality assurance'},
 {id:'hr',name:'HR & workforce',description:'Staff policies and workforce templates'},
 {id:'general',name:'General & unclassified',description:'Documents awaiting categorisation'}
];
export const documentTypes=['Form','Consent','SOP','Policy','Register','Log','Report','Reference'];
const rules=[['consent',/\b(consent|informed|patient rights|vmmc|circumcision)\b/gi],['infection',/\b(infection|sterilis\w*|steriliz\w*|cleaning|hygiene|decontamination)\b/gi],['medicines',/\b(medicine\w*|medication\w*|dispensing|pharmacy|prescription)\b/gi],['hr',/\b(employee\w*|employment|payroll|payslip|leave|recruitment|workforce|staff)\b/gi],['governance',/\b(audit\w*|compliance|governance|quality assurance|popia|incident)\b/gi],['sops',/\b(sop|standard operating|policy|policies|procedure\w*)\b/gi],['clinical',/\b(clinical|assessment|triage|consultation|growth|immunisation|immunization|patient|vital signs)\b/gi]];
export function suggestClassification(filename,text='',extraction='filename'){
 const input=(filename.replace(/[_-]/g,' ')+' '+text).slice(0,60000);
 const ranked=rules.map(([id,pattern])=>({id,hits:[...input.matchAll(pattern)].length})).sort((a,b)=>b.hits-a.hits);
 const winner=ranked[0]; const category=winner.hits?winner.id:'general';
 const type=/\bconsent\b/i.test(input)?'Consent':/\b(sop|standard operating)\b/i.test(input)?'SOP':/\bpolic(y|ies)\b/i.test(input)?'Policy':/\bregister\b/i.test(input)?'Register':/\blog\b/i.test(input)?'Log':/\breport\b/i.test(input)?'Report':/\bform\b/i.test(input)?'Form':'Reference';
 return {category,type,method:'local-rules',extraction,evidence:ranked.filter(r=>r.hits).slice(0,3).map(r=>({category:r.id,matches:r.hits})),message:extraction==='filename'?'Suggestion based on filename only. Review the contents.':'Suggestion based on extracted text and filename. Review before confirming.'};
}
export function docxText(bytes){
 const entries=readZip(bytes);
 if(!entries.some(e=>e.name==='[Content_Types].xml')||!entries.some(e=>e.name==='word/document.xml')||entries.some(e=>/vbaProject\.bin$/i.test(e.name)))throw new AppError(422,'Choose a standard DOCX document without macros');
 const xml=entries.find(e=>e.name==='word/document.xml').data.toString('utf8');
 return xml.replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').slice(0,60000);
}
export async function extractText(bytes,mime){
 if(mime.startsWith('text/plain'))return {text:bytes.toString('utf8').slice(0,60000),extraction:'text'};
 if(mime.includes('wordprocessingml'))return {text:docxText(bytes),extraction:'docx-text'};
 if(mime==='application/pdf'){
  const dir=await mkdtemp(join(tmpdir(),'tdsa-extract-'));
  try{const path=join(dir,'document.pdf');await writeFile(path,bytes,{mode:0o600});const {stdout}=await promisify(execFile)('pdftotext',['-f','1','-l','20','-enc','UTF-8',path,'-'],{timeout:5000,maxBuffer:1024*1024});return {text:stdout.slice(0,60000),extraction:stdout.trim()?'pdf-text':'filename'};}
  catch{return {text:'',extraction:'filename'};}finally{await rm(dir,{recursive:true,force:true});}
 }
 return {text:'',extraction:'filename'};
}
