export const templates = [
  {id:'complaint', audience:'patient', version:1, title:'Complaint, compliment or suggestion', category:'Patient experience', scope:'facility', description:'Record feedback and create a linked case on submission.', fields:[
    {name:'type',label:'Feedback type',type:'select',options:['Complaint','Compliment','Suggestion'],required:true},
    {name:'anonymous',label:'Submit anonymously',type:'checkbox'},
    {name:'name',label:'Full name',type:'text'}, {name:'contact',label:'Contact number or email',type:'text'},
    {name:'eventDate',label:'Event date',type:'date'}, {name:'area',label:'Area or service',type:'text'},
    {name:'details',label:'What happened?',type:'textarea',required:true}, {name:'desiredOutcome',label:'Requested outcome',type:'textarea'}]},
  {id:'cleaning', audience:'clinician', version:1, title:'Daily environmental decontamination log', category:'Infection prevention', scope:'facility', description:'Record a cleaning activity for a room or area.',fields:[
    {name:'area',label:'Area / room',type:'text',required:true}, {name:'date',label:'Date',type:'date',required:true},
    {name:'time',label:'Time',type:'time',required:true}, {name:'surfaces',label:'Surfaces cleaned',type:'textarea',required:true},
    {name:'disinfectant',label:'Disinfectant used',type:'text',required:true}, {name:'cleaner',label:'Cleaner name',type:'text',required:true},
    {name:'comments',label:'Comments / corrective action',type:'textarea'}]}
];
export const DEMO_FACILITY='demo-facility';
export function validateSubmission(input, {final=false}={}) {
  const errors={};
  if(!input || typeof input!=='object' || Array.isArray(input)) return {errors:{form:'Invalid request'}};
  const template=templates.find(t=>t.id===input.templateId);
  if(!template) return {errors:{templateId:'Unknown template'}};
  if(input.templateVersion!==template.version) errors.templateVersion='Unsupported template version';
  if(input.facilityId!==DEMO_FACILITY) errors.facilityId='Facility is not authorised';
  if(!input.data || typeof input.data!=='object' || Array.isArray(input.data)) return {errors:{...errors,data:'Invalid field data'}};
  const data={};
  for(const key of Object.keys(input.data)) if(!template.fields.some(f=>f.name===key)) errors[key]='Unknown field';
  for(const f of template.fields){
    const value=input.data[f.name];
    if(f.type==='checkbox') {if(value!==undefined && typeof value!=='boolean') errors[f.name]='Must be true or false'; data[f.name]=value===true;continue;}
    if(value!==undefined && typeof value!=='string'){errors[f.name]='Must be text';continue;}
    const text=(value??'').trim(); data[f.name]=text;
    if(text.length>4000) errors[f.name]='Maximum 4,000 characters';
    if(final && f.required && !text) errors[f.name]='Required';
    if(f.options && text && !f.options.includes(text)) errors[f.name]='Choose a listed value';
    if(f.type==='date' && text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text)) errors[f.name]='Enter a valid date';
    if(f.type==='time' && text && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) errors[f.name]='Enter a valid time';
  }
  if(template.id==='complaint'){
    if(final && !data.anonymous && !data.name) errors.name='Enter a name or choose anonymous';
    if(data.anonymous){data.name='';data.contact='';}
  }
  if(final && input.attested!==true) errors.attested='Confirm that you have reviewed this record';
  return {errors,template,data};
}
