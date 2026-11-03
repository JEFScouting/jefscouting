import { schema } from './schema.mjs';
import { operationsSchema } from './operations-schema.mjs';
import { fillMissingStaffingSlots } from './coverage-slots.mjs';
import { prepareFinanceDrafts } from './finance-drafts.mjs';
import { linkBookingEvidence } from './booking-evidence.mjs';

// Only source fields are hashed. Effects/reciprocal backlinks cannot wake loops.
export const eventSources = {
  staffingSlots: { table: 'coverage', fields: ['Record Environment','Coverage Record Type','Source Client Intake','Client Record','Required Headcount','Source Event ID','Role','Shift Date','Start Time','End Time','Location','Assignment Sequence','Shift Block Sequence','Evidence Records'] },
  financeDrafts: { table: 'coverage', fields: ['Record Environment','Coverage Record Type','Source Client Intake','Worker Records','Client Record','Attendance Outcome','Time Verification Status','Hours Evidence Verified','Verified Hours','Rate Evidence Status','Approved Worker Rate Snapshot','Approved Client Rate Snapshot','Shift Date','Role','End Time','Evidence Records'] },
  bookingEvidence: { table: 'evidence', fields: ['Record Environment','Evidence ID','Evidence Type','Related Module','Related Object ID','Evidence Date','Verified','Source Provenance Verified','Provenance Disposition','File Link','Attachment','Notes','Worker Bookings','Coverage Requests'] },
};
export async function sourceEventSnapshot(base, operation, recordId) {
  const source=eventSources[operation];
  if(!source||!/^rec[A-Za-z0-9]{14}$/.test(recordId||'')||base.id!=='appveHEw1HrXr8nD1')return null;
  const table={...schema,...operationsSchema}[source.table];
  const record=await base.getTable(table.id).selectRecordAsync(recordId);
  if(!record)return null;
  const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?(value.id?{id:value.id,...(value.url?{url:value.url}:{})}:value.name?value.name:value):value;
  const snapshot=source.fields.map(name=>[name,canonical(record.getCellValue(table.fields[name]))]);
  if(operation==='staffingSlots'){
    const requests=record.getCellValue(table.fields['Source Client Intake'])||[];
    if(requests.length===1){
      const request=await base.getTable(schema.intake.id).selectRecordAsync(requests[0].id);
      snapshot.push(['Request Authority',request?['Record Environment','Converted Client','CLI-01A Commercial / Service Authorization Gate'].map(name=>[name,canonical(request.getCellValue(schema.intake.fields[name]))]):null]);
    }
  }
  if(operation!=='bookingEvidence'){
    const linked=record.getCellValue(table.fields['Evidence Records'])||[];
    const proof=[];
    for(const link of [...linked].sort((a,b)=>a.id.localeCompare(b.id))){
      const e=await base.getTable(schema.evidence.id).selectRecordAsync(link.id);
      const fields=['Verified','Source Provenance Verified','Provenance Disposition','Related Object ID','File Link','Attachment','Notes','Coverage Requests','Client Intake'];
      proof.push([link.id,e?fields.map(name=>[name,name==='Coverage Requests'?(e.getCellValue(schema.evidence.fields[name])||[]).some(x=>x.id===recordId):canonical(e.getCellValue(schema.evidence.fields[name]))]):null]);
    }
    snapshot.push(['Reviewed Source',proof]);
  }else{
    const linked=record.getCellValue(table.fields['Worker Bookings'])||[];
    const bookings=[];
    for(const link of [...linked].sort((a,b)=>a.id.localeCompare(b.id))){
      const b=await base.getTable(operationsSchema.bookings.id).selectRecordAsync(link.id);
      bookings.push([link.id,b?['Booking Status','Coverage Slot','Worker','Candidate','Record Environment'].map(name=>[name,canonical(b.getCellValue(operationsSchema.bookings.fields[name]))]):null]);
    }
    snapshot.push(['Booking Source',bookings]);
  }
  return snapshot;
}
export async function runSourceEvent(envelope,base,assertClaim) {
  const hold=code=>({status:'exception',code,recordIds:[envelope.recordId]});
  if(envelope?.kind!=='operation'||envelope.lane!=='client'||!eventSources[envelope.operation])return hold('INVALID_SOURCE_EVENT');
  if(typeof assertClaim!=='function'||!await assertClaim())return hold('EXCLUSIVE_NATIVE_CLAIM_REQUIRED');
  const snapshot=await sourceEventSnapshot(base,envelope.operation,envelope.recordId);
  if(!snapshot||JSON.stringify(snapshot)!==JSON.stringify(envelope.snapshot))return hold('SOURCE_VERSION_CHANGED');
  const environment=snapshot.find(([name])=>name==='Record Environment')?.[1];
  if(!['Production / Live','QA / Test'].includes(environment))return hold('ENVIRONMENT_MISMATCH');
  const qa=environment==='QA / Test';
  let effect;
  if(envelope.operation==='bookingEvidence')effect=await linkBookingEvidence(envelope.recordId,base);
  else {
    let target=envelope.recordId;
    if(envelope.operation==='staffingSlots'){
      const links=snapshot.find(([name])=>name==='Source Client Intake')?.[1];
      if(!Array.isArray(links)||links.length!==1)return hold('EXACT_REQUEST_REQUIRED');
      target=links[0].id;
    }
    const key=`${target}|${envelope.operation==='staffingSlots'?'staffing-slots':'finance-drafts'}`;
    const exclusiveClaim=async effectKey=>effectKey===key&&await assertClaim();
    effect=await (envelope.operation==='staffingSlots'?fillMissingStaffingSlots:prepareFinanceDrafts)(target,base,{exclusiveClaim,qa});
  }
  if(effect.status==='HOLD'||effect.disposition==='HOLD')return {...hold(effect.reason),operationReadback:effect};
  return {status:'done',code:effect.status||effect.disposition,recordIds:[envelope.recordId],operationReadback:effect};
}
