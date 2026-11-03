import { operationsSchema } from './operations-schema.mjs';
import { schema } from './schema.mjs';
const ids=v=>(v||[]).map(x=>typeof x==='string'?x:x.id);
const choice=v=>v?.name||v||'';
const exact=v=>/^rec[A-Za-z0-9]{14}$/.test(v||'');

// Uses a sourced canonical Demand Header. Free-text intake answers cannot
// manufacture a date, role, headcount, location or assignment rate.
export async function fillMissingStaffingSlots(requestId,base,{exclusiveClaim,qa=false}={}) {
  const hold=reason=>({disposition:'HOLD',reason});
  if(base.id!=='appveHEw1HrXr8nD1'||!exact(requestId)||typeof exclusiveClaim!=='function'||!await exclusiveClaim(`${requestId}|staffing-slots`))return hold('EXCLUSIVE_NATIVE_CLAIM_REQUIRED');
  const tables={...schema,...operationsSchema};
  const table=t=>base.getTable(tables[t].id);
  const field=(t,f)=>{const id=tables[t].fields[f];if(!id)throw new Error('UNMAPPED_FIELD');return id;};
  const get=(r,t,f)=>r?.getCellValue(field(t,f));
  const read=async(t,id)=>table(t).selectRecordAsync(id);
  const all=async(t,fields)=>(await table(t).selectRecordsAsync({fields:fields.map(f=>field(t,f))})).records;
  const valid=r=>r&&get(r,'intake','Record Environment')===(qa?'QA / Test':'Production / Live')&&get(r,'intake','CLI-01A Commercial / Service Authorization Gate')==='PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE'&&ids(get(r,'intake','Converted Client')).length===1;
  let request=await read('intake',requestId);if(!valid(request))return hold('FULL_COMMERCIAL_GATE_REQUIRED');
  const allCoverage=await all('coverage',['Coverage Record Type','Source Client Intake','Source Event ID','Parent Demand Coverage','Worker Slot Number','Assignment Sequence','Shift Block Sequence']);
  const headers=allCoverage.filter(r=>choice(get(r,'coverage','Coverage Record Type'))==='Demand Header'&&ids(get(r,'coverage','Source Client Intake')).includes(requestId));
  if(headers.length!==1)return hold(headers.length?'DUPLICATE_DEMAND_HEADER':'SOURCED_DEMAND_HEADER_REQUIRED');
  const header=await read('coverage',headers[0].id),clientId=ids(get(request,'intake','Converted Client'))[0],environment=qa?'QA / Test':'Production / Live';
  const count=get(header,'coverage','Required Headcount'),event=get(header,'coverage','Source Event ID'),role=get(header,'coverage','Role'),day=get(header,'coverage','Shift Date'),start=get(header,'coverage','Start Time'),end=get(header,'coverage','End Time'),location=get(header,'coverage','Location');
  const assignment=get(header,'coverage','Assignment Sequence')||1,block=get(header,'coverage','Shift Block Sequence')||1;
  if(get(header,'coverage','Record Environment')!==environment||JSON.stringify(ids(get(header,'coverage','Client Record')))!==JSON.stringify([clientId])||
    !Number.isInteger(count)||count<1||count>500||!event||!role||!location||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||!Number.isInteger(assignment)||assignment<1||!Number.isInteger(block)||block<1)return hold('INCOMPLETE_OR_CONFLICTING_DEMAND_FACTS');
  const evidenceIds=ids(get(header,'coverage','Evidence Records'));
  if(!evidenceIds.length)return hold('REVIEWED_DEMAND_EVIDENCE_REQUIRED');
  const demandFields=['Coverage Record Type','Record Environment','Required Headcount','Source Event ID','Role','Shift Date','Start Time','End Time','Location','Assignment Sequence','Shift Block Sequence','Client Record','Source Client Intake','Evidence Records'];
  const linkFields=new Set(['Client Record','Source Client Intake','Evidence Records']);
  // Capture values now, not the record handle: native reads are fresh snapshots.
  const demandVersion=r=>JSON.stringify(demandFields.map(f=>linkFields.has(f)?ids(get(r,'coverage',f)).sort():f==='Coverage Record Type'?choice(get(r,'coverage',f)):get(r,'coverage',f)));
  const admittedDemand=demandVersion(header);
  const reviewedEvidence=async()=>{for(const id of evidenceIds){const e=await read('evidence',id);if(!e||get(e,'evidence','Verified')!==true||get(e,'evidence','Source Provenance Verified')!==true||choice(get(e,'evidence','Provenance Disposition'))!=='Accepted Source'||!ids(get(e,'evidence','Coverage Requests')).includes(header.id)||!ids(get(e,'evidence','Client Intake')).includes(requestId))return false;}return true;};
  if(!await reviewedEvidence())return hold('REVIEWED_DEMAND_EVIDENCE_REQUIRED');
  const children=allCoverage.filter(r=>choice(get(r,'coverage','Coverage Record Type'))==='Staffing Slot Source'&&(ids(get(r,'coverage','Parent Demand Coverage')).includes(header.id)||get(r,'coverage','Source Event ID')===event));
  const groups=new Map();
  for(const r of children){const seq=get(r,'coverage','Assignment Sequence')||1,shift=get(r,'coverage','Shift Block Sequence')||1,num=get(r,'coverage','Worker Slot Number');if(seq!==assignment||shift!==block)continue;const list=groups.get(num)||[];list.push(r);groups.set(num,list);}
  const expected={'Client Record':[{id:clientId}],'Source Client Intake':[{id:requestId}],'Source Event ID':event,'Role':role,'Shift Date':day,'Start Time':start,'End Time':end,'Location':location,'Parent Demand Coverage':[{id:header.id}],'Assignment Sequence':assignment,'Shift Block Sequence':block};
  for(const [num,list]of groups){if(!Number.isInteger(num)||num<1||list.length!==1)return hold('AMBIGUOUS_STAFFING_SLOT_IDENTITY');const r=await read('coverage',list[0].id);for(const[f,v]of Object.entries(expected)){const observed=get(r,'coverage',f);if(Array.isArray(v)?JSON.stringify(ids(observed))!==JSON.stringify(ids(v)):observed!==v)return hold('EXISTING_SLOT_CONTRADICTION');}if(get(r,'coverage','Record Environment')!==environment)return hold('ENVIRONMENT_MISMATCH');}
  const created=[],reused=[];
  for(let number=1;number<=count;number++){
    if(!await exclusiveClaim(`${requestId}|staffing-slots`))return {...hold('EXCLUSIVE_CLAIM_LOST'),created,reused};
    request=await read('intake',requestId);if(!valid(request)||ids(get(request,'intake','Converted Client'))[0]!==clientId)return {...hold('COMMERCIAL_AUTHORITY_CHANGED'),created,reused};
    const live=await read('coverage',header.id);
    if(!live||demandVersion(live)!==admittedDemand)return {...hold('DEMAND_CHANGED_BEFORE_WRITE'),created,reused};
    if(!await reviewedEvidence())return {...hold('SOURCE_EVIDENCE_CHANGED_BEFORE_WRITE'),created,reused};
    if(groups.has(number)){reused.push(groups.get(number)[0].id);continue;}
    const values={...expected,'Coverage Request':`${qa?'TEST-':''}${role} | ${day} | Slot ${number}`,'Coverage Record Type':{name:'Staffing Slot Source'},'Object ID':`${qa?'TEST-':''}SLOT|${header.id}|${assignment}|${block}|${number}`,'Coverage Group / Batch ID':event,'Worker Slot Number':number,'Attendance Outcome':{name:'Pending'},'Evidence Records':evidenceIds.map(id=>({id}))};
    const id=await table('coverage').createRecordAsync(Object.fromEntries(Object.entries(values).map(([f,v])=>[field('coverage',f),v]))),r=await read('coverage',id);
    for(const[f,v]of Object.entries(values)){const observed=get(r,'coverage',f);const ok=Array.isArray(v)?JSON.stringify(ids(observed).sort())===JSON.stringify(ids(v).sort()):v?.name?choice(observed)===v.name:observed===v;if(!ok)throw new Error('SLOT_READBACK_FAILED');}
    created.push(id);
  }
  return {disposition:'SLOTS_RECONCILED',headerId:header.id,created,reused,protectedEffects:false};
}
