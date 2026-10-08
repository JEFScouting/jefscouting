import { operationsSchema } from './operations-schema.mjs';
import { schema as intakeSchema } from './schema.mjs';
import { coverageFinanceHandoff } from './handoff-guards.mjs';

const schema={...intakeSchema,...operationsSchema};
const ids=v=>(v||[]).map(x=>typeof x==='string'?x:x.id);
const choice=v=>v?.name||v||'';
const exact=v=>/^rec[A-Za-z0-9]{14}$/.test(v||'');
const cents=v=>Math.round((v+Number.EPSILON)*100)/100;

// Native execution boundary: caller must already hold the existing governed
// exclusive write claim. This module adds neither a scheduler nor a queue.
export async function prepareFinanceDrafts(coverageId,base,{exclusiveClaim,qa=false,now=()=>new Date().toISOString()}={}) {
  const hold=reason=>({disposition:'HOLD',reason});
  if(base.id!=='appveHEw1HrXr8nD1'||!exact(coverageId)||typeof exclusiveClaim!=='function'||!await exclusiveClaim(`${coverageId}|finance-drafts`)) return hold('EXCLUSIVE_NATIVE_CLAIM_REQUIRED');
  const table=t=>base.getTable(schema[t].id);
  const field=(t,f)=>{const id=schema[t].fields[f];if(!id)throw new Error('UNMAPPED_FIELD');return id;};
  const get=(r,t,f)=>r?.getCellValue(field(t,f));
  const read=async(t,id)=>table(t).selectRecordAsync(id);
  const all=async(t,fields)=>(await table(t).selectRecordsAsync({fields:fields.map(f=>field(t,f))})).records;
  const encode=(t,fields)=>Object.fromEntries(Object.entries(fields).map(([f,v])=>[field(t,f),v]));
  const asObject=(r,t)=>({id:r.id,...Object.fromEntries(Object.keys(schema[t].fields).map(f=>[f,get(r,t,f)]))});
  const verify=async(t,id,values)=>{const r=await read(t,id);if(!r)throw new Error('READBACK_MISSING');for(const[f,v]of Object.entries(values)){const current=get(r,t,f);const ok=Array.isArray(v)?JSON.stringify(ids(current).sort())===JSON.stringify(ids(v).sort()):v?.name?choice(current)===v.name:JSON.stringify(current??null)===JSON.stringify(v??null);if(!ok)throw new Error('DRAFT_READBACK_FAILED:'+f);}return r;};
  const evidenceVersions=new Map();
  const evidenceSourceFields=['Evidence ID','Evidence Type','Related Module','Related Object ID','Evidence Date','File Link','Attachment','Notes','Verified','Source Provenance Verified','Provenance Disposition','Coverage Requests','Workers','Candidates','Record Environment'];
  const evidenceVersion=r=>JSON.stringify(evidenceSourceFields.map(f=>get(r,'evidence',f)));
  const immutableSource=record=>Object.fromEntries(Object.entries(asObject(record,'coverage')).filter(([f])=>!['Payroll Cycle Link','Invoice Link','Finance Control Records'].includes(f)));
  const upsert=async(t,r,values)=>{if(!await exclusiveClaim(`${coverageId}|finance-drafts`))throw new Error('EXCLUSIVE_CLAIM_LOST');const latest=await read('coverage',coverageId);if(!latest||JSON.stringify(immutableSource(latest))!==JSON.stringify(immutableSource(source)))throw new Error('COVERAGE_CHANGED_DURING_WRITE');for(const id of plan.evidenceIds){const e=await read('evidence',id);if(!e||get(e,'evidence','Verified')!==true||get(e,'evidence','Source Provenance Verified')!==true||choice(get(e,'evidence','Provenance Disposition'))!=='Accepted Source'||!ids(get(e,'evidence','Coverage Requests')).includes(coverageId)||evidenceVersion(e)!==evidenceVersions.get(id))throw new Error('SOURCE_EVIDENCE_CHANGED_DURING_WRITE');}if(r)await table(t).updateRecordAsync(r.id,encode(t,values));const id=r?.id||await table(t).createRecordAsync(encode(t,values));await verify(t,id,values);return id;};
  const source=await read('coverage',coverageId);if(!source)return hold('COVERAGE_NOT_FOUND');
  const c=asObject(source,'coverage'),plan=coverageFinanceHandoff(c);
  if(plan.disposition!=='READY_FOR_DRAFT')return plan;
  const environment=qa?'QA / Test':'Production / Live';
  if(c['Record Environment']!==environment)return hold('ENVIRONMENT_MISMATCH');
  const client=await read('clients',plan.clientId),worker=await read('workers',plan.workerId);
  if(!client||!worker||get(client,'clients','Record Environment')!==environment||get(worker,'workers','Record Environment')!==environment)return hold('EXACT_CANONICAL_PERSON_CLIENT_REQUIRED');
  const day=c['Shift Date'];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!c.Role)return hold('EXACT_PERIOD_ROLE_REQUIRED');
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(c['End Time']||'')||!Number.isFinite(Date.parse(c['End Time']))||!Number.isFinite(Date.parse(now()))||Date.parse(c['End Time'])>Date.parse(now()))return hold('SHIFT_NOT_EVIDENCED_AS_ENDED');
  for(const id of plan.evidenceIds){const e=await read('evidence',id);if(!e||get(e,'evidence','Verified')!==true||get(e,'evidence','Source Provenance Verified')!==true||choice(get(e,'evidence','Provenance Disposition'))!=='Accepted Source'||!ids(get(e,'evidence','Coverage Requests')).includes(coverageId))return hold('EXACT_REVIEWED_SOURCE_EVIDENCE_REQUIRED');evidenceVersions.set(id,evidenceVersion(e));}
  const payroll=await all('payroll',['Object ID','Workers','Client Record','Period Start','Period End','Hours','Rate','Gross Pay','Coverage Requests','Coverage Record ID Snapshot','Worker Payment Status']);
  const invoices=await all('invoices',['Client Record','Period Start','Period End','Coverage Requests','Invoice Status','Billable Hours','Bill Rate','Total Amount']);
  const finance=await all('finance',['Coverage Requests','Closeout Coverage Record ID Snapshot','Payroll Cycle Records','Invoice Record','Closeout Disposition']);
  const overlapping=r=>get(r,'payroll','Period Start')<=day&&get(r,'payroll','Period End')>=day;
  const pm=payroll.filter(r=>ids(get(r,'payroll','Coverage Requests')).includes(coverageId)||get(r,'payroll','Coverage Record ID Snapshot')===coverageId||get(r,'payroll','Object ID')===`${qa?'TEST-':''}P3-PAYROLL|${coverageId}`);
  const im=invoices.filter(r=>ids(get(r,'invoices','Coverage Requests')).includes(coverageId));
  const fm=finance.filter(r=>ids(get(r,'finance','Coverage Requests')).includes(coverageId)||get(r,'finance','Closeout Coverage Record ID Snapshot')===coverageId);
  if(pm.length>1||im.length>1||fm.length>1)return hold('DUPLICATE_FINANCE_IDENTITY');
  // An unlinked period aggregate might already represent this liability or
  // receivable. Preserve it for reconciliation; never create a per-slot copy.
  if(payroll.some(r=>!pm.includes(r)&&ids(get(r,'payroll','Workers')).includes(plan.workerId)&&ids(get(r,'payroll','Client Record')).includes(plan.clientId)&&overlapping(r))||
    invoices.some(r=>!im.includes(r)&&ids(get(r,'invoices','Client Record')).includes(plan.clientId)&&get(r,'invoices','Period Start')<=day&&get(r,'invoices','Period End')>=day))return hold('EXISTING_PERIOD_AGGREGATE_REQUIRES_RECONCILIATION');
  const p=pm[0],i=im[0],f=fm[0],hours=c['Verified Hours'],pay=cents(hours*c['Approved Worker Rate Snapshot']),bill=cents(hours*c['Approved Client Rate Snapshot']);
  if(f&&((ids(get(f,'finance','Payroll Cycle Records')).length&&JSON.stringify(ids(get(f,'finance','Payroll Cycle Records')))!==JSON.stringify(p?[p.id]:[]))||(ids(get(f,'finance','Invoice Record')).length&&JSON.stringify(ids(get(f,'finance','Invoice Record')))!==JSON.stringify(i?[i.id]:[]))))return hold('EXISTING_FINANCE_RELATIONSHIP_CONFLICT');
  const conflict=(r,t,values)=>r&&Object.entries(values).some(([k,v])=>{const current=get(r,t,k);return current!==null&&current!==undefined&&current!==''&&(Array.isArray(v)?ids(current).length>0&&JSON.stringify(ids(current).sort())!==JSON.stringify(ids(v).sort()):JSON.stringify(current)!==JSON.stringify(v));});
  const pValues={'Workers':[{id:plan.workerId}],'Client Record':[{id:plan.clientId}],'Coverage Requests':[{id:coverageId}],'Period Start':day,'Period End':day,Hours:hours,Rate:c['Approved Worker Rate Snapshot'],'Gross Pay':pay,...plan.snapshots};
  const iValues={'Client Record':[{id:plan.clientId}],'Coverage Requests':[{id:coverageId}],'Period Start':day,'Period End':day,'Billable Hours':hours,'Bill Rate':c['Approved Client Rate Snapshot'],'Total Amount':bill};
  if(conflict(p,'payroll',pValues)||conflict(i,'invoices',iValues)||p&&['Paid','Disputed','Excluded'].includes(choice(get(p,'payroll','Worker Payment Status')))||i&&!['Draft','Review'].includes(choice(get(i,'invoices','Invoice Status')))||f&&['Closed','Ready to Close','Approved Exception'].includes(choice(get(f,'finance','Closeout Disposition'))))return hold('PROTECTED_OR_CONFLICTING_MONEY_OBJECT');
  const alreadyLinkedPayroll=ids(c['Payroll Cycle Link']),alreadyLinkedInvoice=ids(c['Invoice Link']),alreadyLinkedFinance=ids(c['Finance Control Records']);
  if((alreadyLinkedPayroll.length&&JSON.stringify(alreadyLinkedPayroll)!==JSON.stringify(p?[p.id]:[]))||(alreadyLinkedInvoice.length&&JSON.stringify(alreadyLinkedInvoice)!==JSON.stringify(i?[i.id]:[]))||(alreadyLinkedFinance.length&&JSON.stringify(alreadyLinkedFinance)!==JSON.stringify(f?[f.id]:[])))return hold('EXISTING_RELATIONSHIP_CONFLICT');
  // Immediate authoritative reread before any write. Source changes invalidate
  // the planned handoff; they cannot silently alter an existing money object.
  const latest=await read('coverage',coverageId);
  if(JSON.stringify(asObject(latest,'coverage'))!==JSON.stringify(c))return hold('COVERAGE_CHANGED_BEFORE_WRITE');
  const evidence=plan.evidenceIds.map(id=>({id}));
  const union=(r,t,field,extra)=>[...new Set([...ids(get(r,t,field)),...extra])].map(id=>({id}));
  const payrollId=await upsert('payroll',p,{...pValues,'Hours Evidence Verified':true,'Evidence Records':union(p,'payroll','Evidence Records',plan.evidenceIds),...(!p?{'Payroll Cycle':`${qa?'TEST-':''}P3 Payroll ${coverageId}`,'Object ID':`${qa?'TEST-':''}P3-PAYROLL|${coverageId}`,'Worker Payment Status':{name:'Unpaid'}}:{})});
  const invoiceId=await upsert('invoices',i,{...iValues,'Billing Evidence Verified':true,'Payroll Cycles':union(i,'invoices','Payroll Cycles',[payrollId]),'Evidence Records':union(i,'invoices','Evidence Records',plan.evidenceIds),...(!i?{'Invoice Number':qa?`TEST-DRAFT-${coverageId}`:'','Service Label':c.Role,'Invoice Status':{name:'Draft'}}:{})});
  const financeId=await upsert('finance',f,{'Coverage Requests':[{id:coverageId}],'Closeout Coverage Record ID Snapshot':coverageId,'Client Record':[{id:plan.clientId}],'Payroll Cycle Records':[{id:payrollId}],'Invoice Record':[{id:invoiceId}],'Evidence Records':union(f,'finance','Evidence Records',plan.evidenceIds),...(!f?{'Finance Item':`${qa?'TEST-':''}P3 Review ${coverageId}`,'Finance Area':{name:'Reconciliation Review'},'Approval Status':{name:'Needs Approval'},'Closeout Disposition':{name:'Open'}}:{})});
  await upsert('payroll',await read('payroll',payrollId),{'Invoices':union(await read('payroll',payrollId),'payroll','Invoices',[invoiceId]),'Finance Control':union(await read('payroll',payrollId),'payroll','Finance Control',[financeId])});
  await upsert('invoices',await read('invoices',invoiceId),{'Finance Control':union(await read('invoices',invoiceId),'invoices','Finance Control',[financeId])});
  await upsert('coverage',latest,{'Payroll Cycle Link':[{id:payrollId}],'Invoice Link':[{id:invoiceId}],'Finance Control Records':[{id:financeId}]});
  return {disposition:'DRAFTS_PREPARED',coverageId,payrollId,invoiceId,financeId,protectedEffects:false};
}
