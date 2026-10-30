// Native handoff predicates, using the current canonical field names.
// Read-only: these never authorize dispatch, payment, invoice send or new rates.
const choice = v => v?.name || v || '';
const ids = v => Array.isArray(v) ? v.map(x=>typeof x==='string'?x:x.id) : [];
const exact = v => /^rec[A-Za-z0-9]{14}$/.test(v || '');
export function authorizedCoverageRequest(request) {
  return exact(request?.id) && request['Record Environment']==='Production / Live' &&
    request['CLI-01A Commercial / Service Authorization Gate']==='PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE' &&
    ids(request['Converted Client']).length===1 && exact(ids(request['Converted Client'])[0]);
}
export function coverageFinanceHandoff(coverage) {
  const blocked = reason => ({ disposition:'HOLD',reason });
  if(!exact(coverage?.id)||choice(coverage['Coverage Record Type'])!=='Staffing Slot Source')return blocked('EXACT_STAFFING_SLOT_REQUIRED');
  const workers=ids(coverage['Worker Records']),clients=ids(coverage['Client Record']),evidence=ids(coverage['Evidence Records']);
  if(workers.length!==1||clients.length!==1||![...workers,...clients,...evidence].every(exact))return blocked('EXACT_WORKER_CLIENT_EVIDENCE_REQUIRED');
  if(choice(coverage['Attendance Outcome'])!=='Completed'||choice(coverage['Time Verification Status'])!=='Verified'||
    coverage['Hours Evidence Verified']!==true||!evidence.length||typeof coverage['Verified Hours']!=='number'||
    !Number.isFinite(coverage['Verified Hours'])||coverage['Verified Hours']<=0)return blocked('VERIFIED_TIME_REQUIRED');
  // Claims may differ after an evidenced reconciliation; they must not overwrite
  // Verified Hours. Disputed status already fails above. Scheduling is not read.
  if(choice(coverage['Rate Evidence Status'])!=='Verified'||
    !['Approved Worker Rate Snapshot','Approved Client Rate Snapshot'].every(f=>typeof coverage[f]==='number'&&Number.isFinite(coverage[f])&&coverage[f]>0))return blocked('VERIFIED_ASSIGNMENT_RATES_REQUIRED');
  return { disposition:'READY_FOR_DRAFT', coverageId:coverage.id,workerId:workers[0],clientId:clients[0],evidenceIds:evidence,
    snapshots:{'Coverage Record ID Snapshot':coverage.id,'Coverage Verified Hours Snapshot':coverage['Verified Hours'],
      'Coverage Time Gate Snapshot':'PASS — HOURS VERIFIED','Coverage Completion Gate Snapshot':'READY FOR PAYROLL AND BILLING'} };
}
