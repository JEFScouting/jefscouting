import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { FakeBase } from './harness.mjs';
import { linkBookingEvidence } from '../../automation/intake/booking-evidence.mjs';

function fixture(status = 'Completed') {
  const base = new FakeBase();
  const candidate = base.seed('candidates', { Candidate: '[QA] Person', 'Team Member Number': 'TM-1' });
  const worker = base.seed('workers', { Worker: '[QA] Person', 'Source Candidate Record': [{id:candidate}], 'Team Member Number': 'TM-1' });
  base.data.candidates.get(candidate)['Promoted Worker'] = [{id:worker}];
  const coverage = base.seed('coverage', { 'Coverage Request': '[QA] Shift' });
  const booking = base.seed('bookings', { 'Coverage Slot': [{id:coverage}], Worker:[{id:worker}], Candidate:[{id:candidate}], 'Booking Status': {name:status}, 'Record Environment': 'QA / Test' });
  const evidence = base.seed('evidence', { Verified:true, 'Source Provenance Verified':true, 'Provenance Disposition':{name:'Accepted Source'}, 'Related Module':{name:'Assignments Shifts'}, 'Evidence Type':{name:'Message'}, 'File Link':'https://example.invalid/source', 'Worker Bookings':[{id:booking}], 'Coverage Requests':[{id:coverage}], 'Related Object ID':booking, 'Record Environment':'QA / Test', Notes:'Source statement; no inferred hours.' });
  base.data.bookings.get(booking)['Evidence Records']=[{id:evidence}];
  return {base,candidate,worker,coverage,booking,evidence, ev:base.data.evidence.get(evidence)};
}
for (const status of ['Completed','Cancelled','Released','Replaced']) test(`${status}: source links only; replay creates nothing`, async()=>{
  const f=fixture(status), before=structuredClone(f.base.data);
  assert.equal((await linkBookingEvidence(f.evidence,f.base)).status,'LINKED');
  assert.deepEqual(f.ev.Workers,[{id:f.worker}]); assert.deepEqual(f.ev.Candidates,[{id:f.candidate}]);
  assert.equal((await linkBookingEvidence(f.evidence,f.base)).status,'REPLAY_NO_WRITE');
  assert.equal(f.ev.Notes,'Source statement; no inferred hours.');
  for(const t of ['bookings','coverage','workers','candidates'])assert.deepEqual(f.base.data[t],before[t]);
  assert.equal(f.base.data.evidence.size,1);
});
const cases = [
  ['unreviewed', f=>f.ev['Source Provenance Verified']=false,'SOURCE_NOT_REVIEWED'],
  ['reference only', f=>f.ev['Provenance Disposition']={name:'Reference Only'},'SOURCE_NOT_REVIEWED'],
  ['system proof', f=>f.ev['Evidence Type']={name:'System Verification'},'SOURCE_ARTIFACT_REQUIRED'],
  ['no artifact', f=>delete f.ev['File Link'],'SOURCE_ARTIFACT_REQUIRED'],
  ['shared source', f=>f.ev['Worker Bookings'].push({id:'recOther'}),'SOURCE_SCOPE_AMBIGUOUS'],
  ['wrong object', f=>f.ev['Related Object ID']=f.coverage,'SOURCE_SCOPE_AMBIGUOUS'],
  ['pending', f=>f.base.data.bookings.get(f.booking)['Booking Status']={name:'Confirmed'},'BOOKING_NOT_TERMINAL'],
  ['different TM', f=>f.base.data.workers.get(f.worker)['Team Member Number']='TM-2','IDENTITY_MISMATCH'],
  ['wrong promotion', f=>f.base.data.candidates.get(f.candidate)['Promoted Worker']=[],'IDENTITY_MISMATCH'],
  ['environment', f=>f.ev['Record Environment']='Production / Live','ENVIRONMENT_MISMATCH'],
  ['existing person', f=>f.ev.Workers=[{id:'recOther'}],'EXISTING_PERSON_CONFLICT'],
];
for(const [name,mutate,reason] of cases)test(`HOLD ${name} without writes`,async()=>{
  const f=fixture();mutate(f);const before=structuredClone(f.base.data);
  assert.equal((await linkBookingEvidence(f.evidence,f.base)).reason,reason);
  assert.deepEqual(f.base.data,before);
});
test('concurrent same-source invocations converge without records or history overwrite',async()=>{
  const f=fixture();await Promise.all(Array.from({length:8},()=>linkBookingEvidence(f.evidence,f.base)));
  assert.deepEqual(f.ev.Workers,[{id:f.worker}]);assert.deepEqual(f.ev.Candidates,[{id:f.candidate}]);assert.equal(f.base.data.evidence.size,1);
});
test('failed effect can retry without duplicate',async()=>{
  const f=fixture();f.base.failNext='evidence:update';await assert.rejects(linkBookingEvidence(f.evidence,f.base));
  assert.equal((await linkBookingEvidence(f.evidence,f.base)).status,'LINKED');assert.equal(f.base.data.evidence.size,1);
});
test('approval revoked during preparation holds before write',async()=>{
  const f=fixture(), get=f.base.getTable.bind(f.base);let reads=0;
  f.base.getTable=id=>{const t=get(id);const read=t.selectRecordAsync;t.selectRecordAsync=async rid=>{if(rid===f.evidence&&++reads===2)f.ev.Verified=false;return read(rid);};return t;};
  assert.equal((await linkBookingEvidence(f.evidence,f.base)).reason,'SOURCE_NOT_REVIEWED');assert.equal(f.ev.Workers,undefined);
});
test('generated native runner executes the same handler',async()=>{
  const f=fixture(), outputs={};const script=await readFile(new URL('../../automation/intake/generated/booking-evidence.js',import.meta.url),'utf8');
  await vm.runInNewContext(`(async()=>{${script}})()`,{base:f.base,input:{config:()=>({evidenceId:f.evidence})},output:{set:(k,v)=>outputs[k]=v}});
  assert.equal(JSON.parse(outputs.result).status,'LINKED');
});
