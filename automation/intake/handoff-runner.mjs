import { schema } from './schema.mjs';
import { operationsSchema } from './operations-schema.mjs';
import { fillMissingStaffingSlots } from './coverage-slots.mjs';
import { prepareFinanceDrafts } from './finance-drafts.mjs';

// Runs inside the existing Client native receipt claim, before completion.
// It consumes existing reviewed demand/time; it never manufactures either.
export async function runIntakeHandoffs(envelope,result,base,assertClaim) {
  const hold=reason=>({disposition:'HOLD',reason});
  if(envelope?.lane!=='client'||result?.status!=='done')return hold('CLIENT_RECONCILIATION_REQUIRED');
  if(typeof assertClaim!=='function'||!await assertClaim())return hold('EXCLUSIVE_NATIVE_CLAIM_REQUIRED');
  const evidence=await base.getTable(schema.evidence.id).selectRecordAsync(result.recordIds[0]);
  const ids=v=>(v||[]).map(x=>typeof x==='string'?x:x.id);
  const requestIds=ids(evidence?.getCellValue(schema.evidence.fields['Client Intake']));
  if(requestIds.length!==1)return hold('EXACT_RECONCILED_REQUEST_REQUIRED');
  const requestId=requestIds[0],request=await base.getTable(schema.intake.id).selectRecordAsync(requestId);
  if(request?.getCellValue(schema.intake.fields['Record Environment'])!==(envelope.qa?'QA / Test':'Production / Live'))return hold('ENVIRONMENT_MISMATCH');
  const clientIds=ids(request.getCellValue(schema.intake.fields['Converted Client']));
  if(clientIds.length!==1)return hold('EXACT_RECONCILED_CLIENT_REQUIRED');
  const allowed=new Set([`${requestId}|staffing-slots`]);
  const exclusiveClaim=async key=>allowed.has(key)&&await assertClaim();
  const slots=await fillMissingStaffingSlots(requestId,base,{exclusiveClaim,qa:envelope.qa===true});
  const cf=operationsSchema.coverage.fields,choice=v=>v?.name||v||'';
  const fields=['Source Client Intake','Client Record','Attendance Outcome','Time Verification Status','Record Environment'];
  const rows=(await base.getTable(operationsSchema.coverage.id).selectRecordsAsync({fields:fields.map(f=>cf[f])})).records;
  const ready=rows.filter(r=>ids(r.getCellValue(cf['Source Client Intake'])).includes(requestId)&&
    JSON.stringify(ids(r.getCellValue(cf['Client Record'])))===JSON.stringify(clientIds)&&
    choice(r.getCellValue(cf['Attendance Outcome']))==='Completed'&&choice(r.getCellValue(cf['Time Verification Status']))==='Verified'&&
    r.getCellValue(cf['Record Environment'])===(envelope.qa?'QA / Test':'Production / Live'));
  // Keep the existing synchronous native run bounded. Remaining exact IDs are
  // visible for a later governed source event, never silently marked complete.
  const finance=[];
  for(const r of ready.slice(0,5)){
    allowed.add(`${r.id}|finance-drafts`);
    finance.push(await prepareFinanceDrafts(r.id,base,{exclusiveClaim,qa:envelope.qa===true,now:()=>new Date().toISOString()}));
  }
  return {disposition:'HANDOFFS_CHECKED',requestId,slots,finance,remainingCoverageIds:ready.slice(5).map(r=>r.id)};
}
