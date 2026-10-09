import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubmission } from '../../netlify/functions/_shared/intake-normalize.mts';
import { reconcile } from '../../automation/intake/reconcile.mjs';
import { FakeBase, FakeStore } from './harness.mjs';
import { handleIntake } from '../../netlify/functions/_shared/intake-transport.mts';
const now='2026-10-04T20:00:00.000Z';
function source(overrides={},sid='9000000000000000201') {
 const values={2:'[JEF INTAKE QA] River Events',4:{first:'Alex',last:'Rivera'},5:'Owner',6:'qa.alex@example.invalid',7:{full:'2025550101'},9:{year:'2026',month:'10',day:'04'},13:'Yes',14:'https://www.jotform.com/uploads/qa/signature.png',15:'Alex Rivera / Owner',16:{year:'2026',month:'10',day:'04'},19:'TEST-REQUEST-001',20:'TEST-AGREEMENT-001',21:'JF-CL-AGR-01',22:'AGR-JEF-2026-v0.3',23:'QA / Test',24:'Jotform',25:'',28:'TEST-CLIENT-001',...overrides};
 return {id:sid,form_id:'262220234744045',status:'ACTIVE',created_at:'2026-10-04 16:00:00',answers:Object.fromEntries(Object.entries(values).map(([qid,answer])=>[qid,{text:'Question '+qid,answer}]))};
}
function seed(b,{client={},intake={}}={}){
 const clientId=b.seed('clients',{'NEXT Object ID':'TEST-CLIENT-001','Client Name':'[JEF INTAKE QA] River Events','Client Status':{name:'Active'},...client});
 const intakeId=b.seed('intake',{'Request ID':'TEST-REQUEST-001','Converted Client':[{id:clientId}],'Client Identity Reconciliation':{name:'Existing Client — exact/strong match'},'Agreement Control Status':{name:'Required / Missing'},'Client Readiness State':{name:'COMMERCIAL HOLD'},'Service Authorization Decision':{name:'Not Reviewed'},'CLI-01A Commercial / Service Authorization Gate':'HOLD — COMMERCIAL HOLD',...intake});
 return {clientId,intakeId};
}
test('client agreement exact IDs record signed source then reread full gate; replay reuses everything',async()=>{
 const b=new FakeBase(),{clientId,intakeId}=seed(b),e=normalizeSubmission('client',source(),now);
 assert.equal(e.kind,'clientAgreement');assert.deepEqual(e.issues,[]);
 for(let n=0;n<2;n++){const r=await reconcile(e,b);assert.equal(r.status,'done');assert.equal(r.code,'AGREEMENT_RECORDED_COMMERCIAL_GATE_HELD');}
 assert.equal(b.data.clients.size,1);assert.equal(b.data.intake.size,1);assert.equal(b.data.evidence.size,1);
 const c=b.data.clients.get(clientId),i=b.data.intake.get(intakeId);
 assert.equal(c['Commercial Agreement Status'].name,'Fully Signed');assert.equal(c['Current Agreement Evidence'].length,1);assert.equal(c['Agreement History Evidence'].length,1);
 assert.equal(c['Client Status'].name,'Active');assert.equal(i['Agreement Control Status'].name,'Accepted / Current');assert.equal(i['Service Authorization Decision'].name,'Not Reviewed');
 const ev=[...b.data.evidence.values()][0],payload=JSON.parse(ev.Notes.split('\n')[1]);
 assert.equal(payload.readback['CLI-01A Commercial / Service Authorization Gate'],'HOLD — COMMERCIAL HOLD');assert.ok(payload.snapshot.answers['14']);
});
for(const [name,values,seedExtra] of [
 ['missing client ID',{28:''},{}],['missing intake ID',{19:''},{}],['unknown client ID',{28:'WRONG'},{}],['unknown intake ID',{19:'WRONG'},{}],
 ['missing agreement ID',{20:''},{}],['business contradiction',{2:'[JEF INTAKE QA] Other Business'},{}],['no signature',{14:''},{}],['no acknowledgment',{13:''},{}],['negative acknowledgment',{13:'No'},{}],['unknown widget payload',{13:'Accepted'},{}],
 ['form code drift',{21:'OTHER'},{}],['version drift',{22:'v9'},{}],['environment missing',{23:''},{}],['signature date missing',{16:''},{}],['invalid signature date',{16:{year:'2026',month:'02',day:'31'}},{}],['future signature',{16:'2026-10-05'},{}],
 ['terminated',{}, {client:{'Commercial Agreement Status':{name:'Terminated'}}}],['current pointer protected',{}, {client:{'Current Agreement Evidence':[{id:'rec00000000000999'}]}}],['unsigned Fully Signed invalid',{}, {client:{'Commercial Agreement Status':{name:'Fully Signed'}}}],
 ['request held',{}, {intake:{'Agreement Control Status':{name:'Exception'}}}],['identity held',{}, {intake:{'Client Identity Reconciliation':{name:'Ambiguous — review required'}}}],['request linked elsewhere',{}, {intake:{'Converted Client':[{id:'rec00000000000999'}]}}],
])test('client agreement '+name+' holds source without signing or repairing records',async()=>{
 const b=new FakeBase(),{clientId,intakeId}=seed(b,seedExtra);const before=structuredClone(b.data.clients.get(clientId)),requestBefore=structuredClone(b.data.intake.get(intakeId));
 assert.equal((await reconcile(normalizeSubmission('client',source(values),now),b)).status,'exception');assert.equal(b.data.evidence.size,1);
 assert.deepEqual(b.data.clients.get(clientId),before);assert.deepEqual(b.data.intake.get(intakeId),requestBefore);
});
test('client agreement duplicate exact ID holds even with matching name/contact',async()=>{const b=new FakeBase();seed(b);b.seed('clients',{'NEXT Object ID':'TEST-CLIENT-001','Client Name':'[JEF INTAKE QA] River Events'});assert.equal((await reconcile(normalizeSubmission('client',source(),now),b)).status,'exception');});
test('client agreement environment mismatch holds',async()=>{const b=new FakeBase();const {clientId}=seed(b);b.data.clients.get(clientId)['Record Environment']='Production / Live';assert.equal((await reconcile(normalizeSubmission('client',source(),now),b)).status,'exception');});
test('client agreement partial failure resumes same Evidence and Client and request',async()=>{const b=new FakeBase(),{clientId,intakeId}=seed(b),e=normalizeSubmission('client',source(),now);b.failNext='intake:update';await assert.rejects(reconcile(e,b));assert.equal(b.data.clients.get(clientId)['Commercial Agreement Status'].name,'Fully Signed');assert.equal((await reconcile(e,b)).status,'done');assert.equal(b.data.evidence.size,1);assert.equal(b.data.intake.get(intakeId)['Agreement Control Status'].name,'Accepted / Current');});
test('changed signed submission cannot replace the current controlling evidence',async()=>{const b=new FakeBase();const {clientId}=seed(b);await reconcile(normalizeSubmission('client',source(),now),b);const pointer=structuredClone(b.data.clients.get(clientId)['Current Agreement Evidence']);assert.equal((await reconcile(normalizeSubmission('client',source({15:'Changed signer name'}),now),b)).status,'exception');assert.deepEqual(b.data.clients.get(clientId)['Current Agreement Evidence'],pointer);assert.equal(b.data.evidence.size,2);});
test('client agreement gate readback failure never reports successful completion',async()=>{const b=new FakeBase();seed(b);const old=b.record.bind(b);b.record=(t,id)=>{const r=old(t,id);if(t==='intake'&&r){const get=r.getCellValue;r.getCellValue=f=>{if(f==='fldW7Mgmccgyy26iN')throw new Error('Gate readback failure');return get(f);};}return r;};await assert.rejects(reconcile(normalizeSubmission('client',source(),now),b),/Gate readback failure/);});
test('client agreement stays off by default, uses the existing client lane, and rejects mismatched provider form',async()=>{
 const store=new FakeStore(),config={JEF_CLIENT_INTAKE_V2_ENABLED:'true',JOTFORM_API_KEY:'qa',AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/qa'};
 let provider=source();const calls=[],deps={store,env:k=>config[k],now:()=>now,log:()=>{},fetch:async(url,opts)=>{if(String(url).includes('api.jotform.com'))return Response.json({responseCode:200,content:provider});calls.push(JSON.parse(opts.body));return new Response('',{status:200});}};
 const request=()=>new Request('https://jefscouting.com/api/client-jotform-webhook',{method:'POST',body:new URLSearchParams({formID:'262220234744045',submissionID:provider.id})});
 assert.equal((await handleIntake(request(),'client',deps)).status,503);assert.equal(store.entries.size,0);
 config.JEF_CLIENT_AGREEMENT_INTAKE_ENABLED='true';assert.equal((await handleIntake(request(),'client',deps)).status,202);assert.equal(calls[0].lane,'client');assert.ok(store.entries.has('lane/client'));
 provider={...source({},'9000000000000000202'),form_id:'262081932367056'};assert.equal((await handleIntake(request(),'client',deps)).status,400);
});
test('same Agreement ID on a distinct submission is held for review',async()=>{const b=new FakeBase();seed(b);await reconcile(normalizeSubmission('client',source(),now),b);assert.equal((await reconcile(normalizeSubmission('client',source({},'9000000000000000203'),now),b)).status,'exception');assert.equal(b.data.evidence.size,2);});
test('record IDs bind exactly; production PASS is read, never manufactured',async()=>{const b=new FakeBase();const {clientId,intakeId}=seed(b,{client:{'Client Name':'River Events'},intake:{'Request ID':'REQUEST-001','CLI-01A Commercial / Service Authorization Gate':'PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE'}});const e=normalizeSubmission('client',source({2:'River Events',19:intakeId,28:clientId,23:'Production'}),now);assert.equal(e.qa,false);const r=await reconcile(e,b);assert.equal(r.status,'done');assert.equal(r.code,'AGREEMENT_RECORDED_GATE_PASS_STOP_BEFORE_COVERAGE');assert.equal(b.data.clients.size,1);assert.equal(b.data.intake.size,1);});
