import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedCoverageRequest,coverageFinanceHandoff } from '../../automation/intake/handoff-guards.mjs';
const id='rec00000000000001',worker='rec00000000000002',client='rec00000000000003',evidence='rec00000000000004';
test('P2 exact full gate and production required; Authorized alone and QA never release Coverage',()=>{
 const r={id,'Record Environment':'Production / Live','Converted Client':[{id:client}],'Service Authorization Decision':'Authorized','CLI-01A Commercial / Service Authorization Gate':'PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE'};
 assert.equal(authorizedCoverageRequest(r),true);
 for(const patch of [{'Record Environment':'QA / Test'},{'CLI-01A Commercial / Service Authorization Gate':'BLOCKED — SIGNED STANDING AGREEMENT REQUIRED'},{'Converted Client':[]}])assert.equal(authorizedCoverageRequest({...r,...patch}),false);
});
const slot=()=>({id,'Coverage Record Type':'Staffing Slot Source','Worker Records':[{id:worker}],'Client Record':[{id:client}],'Evidence Records':[{id:evidence}],
 'Attendance Outcome':'Completed','Time Verification Status':'Verified','Hours Evidence Verified':true,'Verified Hours':6,
 'Rate Evidence Status':'Verified','Approved Worker Rate Snapshot':20,'Approved Client Rate Snapshot':30});
test('P3 current live fields derive exact provenance snapshots; replay is read-only and identical',()=>{
 const s=slot(),before=structuredClone(s),a=coverageFinanceHandoff(s);assert.equal(a.disposition,'READY_FOR_DRAFT');assert.equal(a.snapshots['Coverage Verified Hours Snapshot'],6);assert.equal(a.snapshots['Coverage Record ID Snapshot'],id);
 assert.deepEqual(coverageFinanceHandoff(s),a);assert.deepEqual(s,before);assert.equal(a['Payment Authorized'],undefined);
});
for(const [reason,patch] of [['demand header',{'Coverage Record Type':'Demand Header'}],['projected hours',{'Verified Hours':null,'Scheduled Hours':8}],['unknown outcome',{'Attendance Outcome':'Pending'}],['dispute',{'Time Verification Status':'Disputed'}],['absent evidence',{'Evidence Records':[]}],['multiple workers',{'Worker Records':[{id:worker},{id:client}]}],['unapproved rates',{'Rate Evidence Status':'Pending Review'}]])test('P3 '+reason+' holds without making money objects',()=>{assert.equal(coverageFinanceHandoff({...slot(),...patch}).disposition,'HOLD');});
