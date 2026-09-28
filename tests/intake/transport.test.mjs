import test from 'node:test';
import assert from 'node:assert/strict';
import {handleIntake} from '../../netlify/functions/_shared/intake-transport.mts';
import {FakeStore,FakeBase,source} from './harness.mjs';
import {reconcile} from '../../automation/intake/reconcile.mjs';

function setup(lane='candidate') {
  const store=new FakeStore(), logs=[],sent=[],records=new FakeBase();let provider=source(lane);
  const config={JOTFORM_API_KEY:'test-provider-key',JOTFORM_ADMIN_SECRET:'test-admin-key',AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/candidate',AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/client',JEF_CANDIDATE_INTAKE_V2_ENABLED:'true',JEF_CLIENT_INTAKE_V2_ENABLED:'true'};
  const deps={store,env:k=>config[k],log:x=>logs.push(x),now:()=>new Date().toISOString(),fetch:async(url,options)=>{if(String(url).startsWith('https://api.jotform.com/submission/'))return Response.json({responseCode:200,content:provider});sent.push(JSON.parse(options.body));return Response.json({success:true});}};
  const request=(extra={})=>{const body=new FormData();body.set('submissionID',provider.id);body.set('formID',provider.form_id);for(const[k,v]of Object.entries(extra))body.set(k,v);return new Request('https://jefscouting.com/api/'+lane+'-jotform-webhook',{method:'POST',body});};
  const deliver=()=>handleIntake(request(),lane,deps);
  const control=(action,extra={})=>handleIntake(new Request('https://jefscouting.com/api/'+lane+'-jotform-webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...sent.at(-1),action,...extra})}),lane,deps);
  const consume=async()=>{const claim=await (await control('claim')).json();if(claim.skip)return claim;const result=await reconcile(claim.envelope,records);await control('complete',{consumerToken:claim.consumerToken,...result});return result;};
  return {store,logs,sent,records,config,deps,request,deliver,control,consume,setProvider:p=>provider=p};
}
for(const lane of ['candidate','client'])test(lane+' full simulated provider→gateway→automation→readback→receipt→replay path',async()=>{const x=setup(lane);assert.equal((await x.deliver()).status,202);assert.equal((await x.consume()).status,'done');assert.equal((await x.deliver()).status,200);assert.equal(x.sent.length,1);assert.equal(x.records.data[lane==='candidate'?'candidates':'clients'].size,1);assert.equal(x.records.data.evidence.size,1);});
test('simultaneous deliveries cannot start two Airtable runs',async()=>{const x=setup();const responses=await Promise.all([x.deliver(),x.deliver()]);assert.equal(responses.filter(r=>r.status===202).length,2);assert.equal(x.sent.length,1);await x.consume();assert.equal(x.records.data.candidates.size,1);});
test('duplicate Airtable invocation may claim only once',async()=>{const x=setup();await x.deliver();const r=await Promise.all([x.control('claim'),x.control('claim')]);assert.equal(r.filter(r=>r.status===200).length,1);assert.equal(r.filter(r=>r.status===409).length,1);});
test('a claimed run never expires automatically into duplicate execution',async()=>{const x=setup();await x.deliver();await x.control('claim');assert.equal((await x.deliver()).status,202);assert.equal(x.sent.length,1);});
test('forged Airtable claim does not get source answers',async()=>{const x=setup();await x.deliver();const r=await x.control('claim',{token:'forged'});assert.equal(r.status,403);assert.ok(!(await r.text()).includes('Alex'));});
test('forged completion cannot release a running writer',async()=>{const x=setup();await x.deliver();await x.control('claim');assert.equal((await x.control('complete',{status:'done',consumerToken:'forged'})).status,403);assert.equal((await x.deliver()).status,202);});
test('source answers are provider fetched; forged webhook raw data is ignored',async()=>{const x=setup();await handleIntake(x.request({rawRequest:'{"email":"attacker@invalid.example"}'}),'candidate',x.deps);const c=await (await x.control('claim')).json();assert.equal(c.envelope.person.email,'qa.alex@example.invalid');});
test('partial failure callback releases lane and next delivery resumes same canonical source',async()=>{const x=setup();await x.deliver();const c=await (await x.control('claim')).json();x.records.failNext='candidates:create';await assert.rejects(()=>reconcile(c.envelope,x.records));assert.equal((await x.control('complete',{consumerToken:c.consumerToken,status:'failed'})).status,200);assert.equal((await x.deliver()).status,202);await x.consume();assert.equal(x.records.data.evidence.size,1);assert.equal(x.records.data.candidates.size,1);});
test('Airtable HTTP failure retains the same receipt token for safe redelivery',async()=>{const x=setup();const original=x.deps.fetch;x.deps.fetch=async(url,opts)=>String(url).includes('hooks.airtable.com')?new Response('failure',{status:502}):original(url,opts);assert.equal((await x.deliver()).status,503);assert.equal((await x.deliver()).status,503);assert.ok(x.logs.some(x=>x.status==='delivery_uncertain'));});
test('unknown completed callback retry is harmless after lane release',async()=>{const x=setup();await x.deliver();const c=await (await x.control('claim')).json();const r=await reconcile(c.envelope,x.records);assert.equal((await x.control('complete',{consumerToken:c.consumerToken,...r})).status,200);assert.equal((await x.control('complete',{consumerToken:c.consumerToken,...r})).status,200);});
test('missing configuration produces no dispatch',async()=>{const x=setup();delete x.config.AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL;assert.equal((await x.deliver()).status,503);assert.equal(x.sent.length,0);});
test('malformed control requests fail without writes',async()=>{const x=setup();assert.equal((await x.control('unknown')).status,400);assert.equal(x.store.entries.size,0);});
test('source ID/form mismatches fail before touching Airtable',async()=>{const x=setup();assert.equal((await handleIntake(x.request({formID:'wrong'}),'candidate',x.deps)).status,400);assert.equal(x.sent.length,0);});
test('same submission updated at provider is a new version on same canonical person',async()=>{const x=setup();await x.deliver();await x.consume();x.setProvider(source('candidate','9000000000000000001',{34:'Server'}));await x.deliver();await x.consume();assert.equal(x.records.data.candidates.size,1);assert.equal(x.records.data.evidence.size,2);assert.equal([...x.records.data.candidates.values()][0]['Target Role'],'Server');});
test('operational logs never contain answers, contact data or credentials',async()=>{const x=setup();await x.deliver();await x.consume();const logs=JSON.stringify(x.logs);for(const value of ['Alex','example.invalid','test-provider-key','test-admin-key',x.sent[0].token])assert.ok(!logs.includes(value));});
test('status inspection requires existing admin authentication',async()=>{const x=setup();const r=await handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook'),'candidate',x.deps);assert.equal(r.status,401);});

test('second distinct submission is durable and dispatches automatically after first completes',async()=>{
 const x=setup();await x.deliver();
 x.setProvider(source('candidate','9000000000000000002',{3:{first:'[JEF INTAKE QA] Sam',last:'Taylor'},5:'qa.sam@example.invalid',4:{full:'2025550102'}}));
 const queued=await x.deliver();assert.equal(queued.status,202);assert.equal((await queued.json()).status,'queued');assert.equal(x.sent.length,1);
 await x.consume();assert.equal(x.sent.length,2);await x.consume();assert.equal(x.records.data.candidates.size,2);
});
test('a lost dispatch acknowledgement can be retried without concurrent writers',async()=>{
 const x=setup();await x.deliver();const original={...x.sent[0]};await x.deliver();assert.equal(x.sent[1].token,original.token);
 const claims=await Promise.all([x.control('claim'),x.control('claim')]);assert.equal(claims.filter(v=>v.status===200).length,1);
});
test('authenticated inspection exposes completion and attention without credentials or answers',async()=>{
 const x=setup();await x.deliver();await x.consume();
 const r=await handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook',{headers:{authorization:'Bearer test-admin-key'}}),'candidate',x.deps);
 const data=await r.json();assert.equal(data.counts.done,1);assert.equal(data.last.status,'done');assert.equal(data.active,null);
 const serialized=JSON.stringify(data);for(const value of ['Alex','example.invalid',x.sent[0].token])assert.ok(!serialized.includes(value));
});
test('authenticated retry cannot steal a claimed writer',async()=>{
 const x=setup();await x.deliver();await x.control('claim');
 const r=await handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-admin-key'},body:JSON.stringify({action:'retry',receiptId:x.sent[0].receiptId})}),'candidate',x.deps);
 assert.equal(r.status,409);assert.equal(x.sent.length,1);
});
test('malformed JSON is reported as invalid input',async()=>{
 const x=setup();const r=await handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook',{method:'POST',headers:{'content-type':'application/json'},body:'{' }),'candidate',x.deps);assert.equal(r.status,400);
});
