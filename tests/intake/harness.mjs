import { schema as intakeSchema } from '../../automation/intake/schema.mjs';
import { operationsSchema } from '../../automation/intake/operations-schema.mjs';
const schema={...intakeSchema,...operationsSchema};
export const F=schema;
export class FakeBase {
  id='appveHEw1HrXr8nD1'; data={}; sequence=0; failNext=null;
  constructor(){ for(const t of Object.keys(schema))this.data[t]=new Map(); }
  seed(table,fields){const id='rec'+String(++this.sequence).padStart(14,'0');this.data[table].set(id,structuredClone(fields));this.derive(table,id);return id;}
  derive(t,id){const f=this.data[t].get(id);if(t==='candidates')f['Record Environment']=String(f.Candidate||'').startsWith('[')||String(f['Object ID']||'').startsWith('TEST')?'QA / Test':'Production / Live';if(t==='clients')f['Record Environment']=String(f['Client Name']||'').startsWith('[')?'QA / Test':'Production / Live';if(t==='intake')f['Record Environment']=/^(TEST|QA-)/.test(f['Request ID']||'')?'QA / Test':'Production / Live';if(['coverage','payroll','invoices','finance','workers'].includes(t)){const primary={coverage:'Coverage Request',payroll:'Payroll Cycle',invoices:'Invoice Number',finance:'Finance Item',workers:'Worker'}[t];f['Record Environment']=/^(TEST|QA-|\[)/.test(f[primary]||'')?'QA / Test':'Production / Live';}}
  record(t,id){if(!this.data[t].has(id))return null;return {id,getCellValue:fid=>{const name=Object.keys(schema[t].fields).find(k=>schema[t].fields[k]===fid);if(!name)throw new Error('Unknown field '+fid);return structuredClone(this.data[t].get(id)?.[name]??null);}};}
  getTable(tableId){const t=Object.keys(schema).find(t=>schema[t].id===tableId);if(!t)throw new Error('Unexpected table '+tableId);return {
    selectRecordsAsync:async()=>({records:[...this.data[t].keys()].map(id=>this.record(t,id))}),
    selectRecordAsync:async id=>this.record(t,id),
    createRecordAsync:async encoded=>{this.check(t,'create');const fields=this.decode(t,encoded),id=this.seed(t,fields);this.reciprocals(t,id,fields);return id;},
    updateRecordAsync:async(id,encoded)=>{this.check(t,'update');const fields=this.decode(t,encoded);Object.assign(this.data[t].get(id),fields);this.derive(t,id);this.reciprocals(t,id,fields);},
  };}
  decode(t,encoded){return Object.fromEntries(Object.entries(encoded).map(([fid,v])=>{const name=Object.keys(schema[t].fields).find(k=>schema[t].fields[k]===fid);if(!name)throw new Error('Unknown write');return [name,structuredClone(v)];}));}
  check(t,op){if(this.failNext===t+':'+op){this.failNext=null;throw new Error('Injected Airtable failure');}}
  reciprocals(t,id,fields){const reverse={candidates:'Candidates',clients:'Clients',intake:'Client Intake'}[t];if(reverse&&fields['Evidence Records'])for(const link of fields['Evidence Records']){const ev=this.data.evidence.get(link.id);if(ev)ev[reverse]=[...new Set([...(ev[reverse]||[]).map(x=>x.id),id])].map(id=>({id}));}}
}
export class FakeStore {
  entries=new Map();revision=0;
  async *list({prefix}){yield {blobs:[...this.entries.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
  async getWithMetadata(k){const v=this.entries.get(k);return v?structuredClone(v):null;}
  async setJSON(k,data,options){const old=this.entries.get(k);if(options?.onlyIfNew&&old)return {modified:false};if(options?.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};const etag=String(++this.revision);this.entries.set(k,{data:structuredClone(data),etag});return {modified:true,etag};}
}
export function source(lane='candidate',sid='9000000000000000001',overrides={}) {
  const answers={3:{text:'Full Name',answer:{first:'[JEF INTAKE QA] Alex',last:'Rivera'}},5:{text:'Email',answer:'  QA.Alex@Example.invalid  '}};
  if(lane==='candidate') Object.assign(answers,{4:{text:'Phone',answer:{full:'(202) 555-0101'}},8:{text:'Current Address',answer:{city:'Miami',state:'FL'}},11:{text:'Preferred Work Areas',answer:['Broward','West Palm Beach']},14:{text:'English',answer:'Advanced'},16:{text:'Work authorization',answer:'No'},18:{text:'Certifications',answer:['None']},34:{text:'Roles',answer:'Barista'},46:{text:'Contact consent',answer:'No, I do not consent'},49:{answer:'JEF-CANDIDATE-APPLICATION'},50:{answer:'1.0'},51:{answer:'Production'}});
  else Object.assign(answers,{2:{text:'Business',answer:'[JEF INTAKE QA] River Events'},6:{text:'Phone',answer:{full:'(202) 555-0101'}},8:{text:'Worksite',answer:{city:'Miami Beach',state:'FL'}},9:{text:'Service',answer:['Event Staffing']},10:{text:'Positions',answer:'2 Servers'},15:{text:'Urgency',answer:'Immediate (within 1–3 days)'},16:{text:'Budget',answer:'Unknown'},25:{answer:'JF-CL-02'},26:{answer:'v1.1'},32:{answer:'Live'}});
  for(const [qid,value]of Object.entries(overrides)) answers[qid]={text:'Question '+qid,answer:value};
  return {id:sid,form_id:lane==='candidate'?'261480775333056':'262081932367056',status:'ACTIVE',created_at:'2026-09-27 00:30:00',updated_at:'',answers};
}
