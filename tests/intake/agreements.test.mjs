import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubmission } from '../../netlify/functions/_shared/intake-normalize.mts';
import { reconcile } from '../../automation/intake/reconcile.mjs';
import { FakeBase, source, FakeStore } from './harness.mjs';
import { handleIntake } from '../../netlify/functions/_shared/intake-transport.mts';
import { reminderDecision, rereadReminder } from '../../automation/intake/agreement-reminders.mjs';
const now='2026-10-04T15:00:00.000Z';
function agreement(overrides={}) {
 const s=source('candidate','9000000000000000099',{8:'https://www.jotform.com/uploads/qa/signature.png',31:'TEST-CAN-001',32:'JEF-CANDIDATE-REPRESENTATION-AGREEMENT',33:'1.0',34:'Production',...overrides});
 s.form_id='261558428456063';return s;
}
function seed(b,extra={}){return b.seed('candidates',{Candidate:'[JEF INTAKE QA] Alex Rivera',Email:'qa.alex@example.invalid',Phone:'+12025550101','Object ID':'TEST-CAN-001',...extra});}
test('representation exact Object ID signs existing Candidate and replays without duplicate source or Candidate',async()=>{
 const b=new FakeBase(),id=seed(b),e=normalizeSubmission('candidate',agreement(),now);
 for(let i=0;i<2;i++)assert.equal((await reconcile(e,b)).status,'done');
 assert.equal(b.data.candidates.size,1);assert.equal(b.data.evidence.size,1);
 const c=b.data.candidates.get(id);assert.equal(c['Candidate Agreement Status'].name,'Signed');assert.equal(c['Evidence Records'].length,1);
 assert.equal(c['Promoted Worker'],undefined);assert.equal(c['Work Authorization Classification'],undefined);
});
for(const [label,overrides,extra] of [
 ['missing ID',{31:''},{}],['unknown ID',{31:'UNKNOWN'},{}],['contradictory contact',{5:'someone.else@example.invalid'},{}],
 ['missing signature',{8:''},{}],['form drift',{33:'2.0'},{}],['declined candidate',{}, {'Candidate Agreement Status':{name:'Declined'}}],
 ['redirected identity',{}, {'Canonical Candidate Record':[{id:'rec00000000000999'}]}]
])test('representation '+label+' preserves exception source without signing',async()=>{
 const b=new FakeBase(),id=seed(b,extra);assert.equal((await reconcile(normalizeSubmission('candidate',agreement(overrides),now),b)).status,'exception');
 assert.notEqual(b.data.candidates.get(id)['Candidate Agreement Status']?.name,'Signed');assert.equal(b.data.candidates.size,1);assert.equal(b.data.evidence.size,1);
});
test('representation duplicate Object ID holds',async()=>{const b=new FakeBase();seed(b);seed(b);assert.equal((await reconcile(normalizeSubmission('candidate',agreement(),now),b)).status,'exception');});
test('representation transport stays disabled until explicitly activated; shares existing lane when enabled',async()=>{
 const store=new FakeStore(),config={JEF_CANDIDATE_INTAKE_V2_ENABLED:'true',JOTFORM_API_KEY:'test-key',AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test'};
 const calls=[],deps={store,env:k=>config[k],now:()=>now,log:()=>{},fetch:async(url,opts)=>{if(String(url).includes('api.jotform.com'))return Response.json({responseCode:200,content:agreement()});calls.push(JSON.parse(opts.body));return new Response('',{status:200});}};
 const request=()=>new Request('https://jefscouting.com/api/candidate-jotform-webhook',{method:'POST',body:new URLSearchParams({formID:'261558428456063',submissionID:'9000000000000000099'})});
 assert.equal((await handleIntake(request(),'candidate',deps)).status,503);assert.equal(store.entries.size,0);
 config.JEF_REPRESENTATION_INTAKE_ENABLED='true';assert.equal((await handleIntake(request(),'candidate',deps)).status,202);assert.equal(calls[0].lane,'candidate');assert.ok(store.entries.has('lane/candidate'));
});
const cid='rec00000000000001';
const candidate=()=>({id:cid,Email:'qa@example.invalid','Tracked Representation Agreement Link':'https://form.jotform.com/261558428456063?candidateapplicationId=TEST-CAN-001'});
const provider=()=>({candidateId:cid,complete:true,effects:['initial','r1','r2'].map(step=>({step,key:`${cid}|agreement|${step}`,outcome:'not_sent'}))});
test('reminder initial due, NY window, Signed/Declined stop and unknown provider hold',()=>{
 assert.equal(reminderDecision(candidate(),provider(),now).disposition,'DUE');
 assert.equal(reminderDecision(candidate(),provider(),'2026-10-04T23:00:00Z').disposition,'OUTSIDE_WINDOW');
 for(const s of ['Signed','Declined'])assert.equal(reminderDecision({...candidate(),'Candidate Agreement Status':s},provider(),now).disposition,'STOP');
 const p=provider();p.effects[0].outcome='unknown';assert.equal(reminderDecision(candidate(),p,now).disposition,'HOLD');
});
test('reminder R1 24h, R2 48h and replay max-two; missing timestamp reconciles before effect',()=>{
 const c=candidate(),p=provider();p.effects[0]={...p.effects[0],outcome:'sent',sentAt:'2026-10-03T15:00:00Z'};
 assert.equal(reminderDecision(c,p,now).disposition,'RECONCILE');c['Agreement Initial Sent At']=p.effects[0].sentAt;
 assert.equal(reminderDecision(c,p,'2026-10-04T14:59:59Z').disposition,'NOT_DUE');assert.equal(reminderDecision(c,p,now).step,'r1');
 p.effects[1]={...p.effects[1],outcome:'sent',sentAt:now};c['Agreement R1 Sent At']=now;
 assert.equal(reminderDecision(c,p,'2026-10-06T14:59:59Z').disposition,'NOT_DUE');assert.equal(reminderDecision(c,p,'2026-10-06T15:00:00Z').step,'r2');
 p.effects[2]={...p.effects[2],outcome:'sent',sentAt:'2026-10-06T15:00:00Z'};c['Agreement R2 Sent At']=p.effects[2].sentAt;
 assert.equal(reminderDecision(c,p,'2026-10-07T15:00:00Z').disposition,'STOP');
});
test('reminder immediately rereads canonical and provider state',async()=>{let reads=0;const r=await rereadReminder(cid,{readCandidate:async()=>{reads++;return {...candidate(),'Candidate Agreement Status':'Signed'};},readProvider:async()=>{reads++;return provider();},now:()=>now});assert.equal(r.disposition,'STOP');assert.equal(reads,2);});
