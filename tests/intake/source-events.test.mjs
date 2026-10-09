import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FakeBase,FakeStore} from './harness.mjs';
import {sourceEventSnapshot} from '../../automation/intake/source-events.mjs';
import {handleIntake} from '../../netlify/functions/_shared/intake-transport.mts';

const endpoint='https://jefscouting.com/api/client-jotform-webhook';
async function setup(operation='financeDrafts') {
 const base=new FakeBase(),store=new FakeStore(),dispatches=[];
 const worker=base.seed('workers',{Worker:'TEST-Worker'}),client=base.seed('clients',{'Client Name':'[QA] Client'});
 const evidence=base.seed('evidence',{Verified:true,'Source Provenance Verified':true,'Provenance Disposition':{name:'Accepted Source'}});
 const coverage=base.seed('coverage',{'Coverage Request':'TEST-Shift','Coverage Record Type':{name:'Staffing Slot Source'},'Worker Records':[{id:worker}],'Client Record':[{id:client}],'Attendance Outcome':{name:'Completed'},'Time Verification Status':{name:'Verified'},'Hours Evidence Verified':true,'Verified Hours':8,'Rate Evidence Status':{name:'Verified'},'Approved Worker Rate Snapshot':20,'Approved Client Rate Snapshot':30,'Shift Date':'2026-10-01',Role:'Server','End Time':'2026-10-01T23:00:00Z','Evidence Records':[{id:evidence}]});
 base.data.evidence.get(evidence)['Coverage Requests']=[{id:coverage}];
 const config={JOTFORM_ADMIN_SECRET:'test-secret',JEF_CLIENT_INTAKE_V2_ENABLED:'true',AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/client'};
 const deps={store,env:k=>config[k],now:()=>new Date().toISOString(),log:()=>{},fetch:async(_,opts)=>{dispatches.push(JSON.parse(opts.body));return Response.json({ok:true});}};
 let recordId=coverage;
 if(operation==='staffingSlots') {
   const request=base.seed('intake',{'Request ID':'TEST-REQUEST','Converted Client':[{id:client}],'CLI-01A Commercial / Service Authorization Gate':'PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE'});
   Object.assign(base.data.coverage.get(coverage),{'Coverage Record Type':{name:'Demand Header'},'Source Client Intake':[{id:request}],'Required Headcount':2,'Source Event ID':'TEST-DEMAND','Start Time':'2026-10-01T15:00:00Z',Location:'QA Site','Assignment Sequence':1,'Shift Block Sequence':1});
   base.data.evidence.get(evidence)['Client Intake']=[{id:request}];
 }
 if(operation==='bookingEvidence') {
   const booking=base.seed('bookings',{Worker:[{id:worker}],'Coverage Slot':[{id:coverage}],'Booking Status':{name:'Completed'},'Evidence Records':[{id:evidence}],'Record Environment':'QA / Test'});
   Object.assign(base.data.evidence.get(evidence),{'Record Environment':'QA / Test','Evidence Type':{name:'Message'},'Related Module':{name:'Assignments Shifts'},'Related Object ID':booking,'Worker Bookings':[{id:booking}],'File Link':'https://example.invalid/qa-source'});
   recordId=evidence;
 }
 const event={action:'sourceEvent',operation,recordId,snapshot:await sourceEventSnapshot(base,operation,recordId)};
 const deliver=(body=event,auth=true,lane='client')=>handleIntake(new Request(endpoint,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer test-secret'}:{})},body:JSON.stringify(body)}),lane,deps);
 const consume=async(index=0)=>{
   const script=await readFile(new URL('../../automation/intake/generated/client.js',import.meta.url),'utf8'),out={};
   const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
   await new AsyncFunction('base','fetch','input','output',script)(base,(url,opts)=>handleIntake(new Request(url,opts),'client',deps),{config:()=>dispatches[index]},{set:(k,v)=>out[k]=v});
   return out;
 };
 return {base,store,dispatches,event,deliver,consume,coverage,evidence,config,__deps:deps};
}
for(const operation of ['staffingSlots','financeDrafts','bookingEvidence'])test(`${operation}: authenticated source→existing receipt→native claim→effect→readback→exact replay`,async()=>{
 const f=await setup(operation);assert.equal((await f.deliver()).status,202);assert.equal((await f.consume()).status,'done');
 const before=structuredClone(f.base.data);const freshReplay={...f.event,snapshot:await sourceEventSnapshot(f.base,operation,f.event.recordId)};assert.deepEqual(freshReplay.snapshot,f.event.snapshot);const replay=await f.deliver(freshReplay);assert.equal(replay.status,200);assert.equal((await replay.json()).replay,true);assert.equal(f.dispatches.length,1);assert.deepEqual(f.base.data,before);
 if(operation==='financeDrafts')for(const table of ['payroll','invoices','finance'])assert.equal(f.base.data[table].size,1);
 if(operation==='staffingSlots')assert.equal(f.base.data.coverage.size,3);
 if(operation==='bookingEvidence')assert.equal(f.base.data.evidence.get(f.evidence).Workers.length,1);
});
test('source event rejects missing auth, foreign lane and unsupported operations before receipt',async()=>{
 const f=await setup();assert.equal((await f.deliver(f.event,false)).status,401);assert.equal((await f.deliver(f.event,true,'candidate')).status,400);assert.equal((await f.deliver({...f.event,operation:'pay'})).status,400);assert.equal(f.store.entries.size,0);
});
test('changed authoritative source between trigger and executor holds with no money writes',async()=>{
 const f=await setup();await f.deliver();f.base.data.coverage.get(f.coverage)['Verified Hours']=9;
 const out=await f.consume();assert.equal(out.status,'exception');assert.equal(JSON.parse(out.operationReadback).code,'SOURCE_VERSION_CHANGED');assert.equal(f.base.data.payroll.size,0);
});
test('negative source persists visible HOLD and exact replay does not execute again',async()=>{
 const f=await setup();f.base.data.coverage.get(f.coverage)['Time Verification Status']={name:'Disputed'};f.event.snapshot=await sourceEventSnapshot(f.base,'financeDrafts',f.coverage);
 await f.deliver();const out=await f.consume();assert.equal(out.status,'exception');assert.equal(JSON.parse(out.operationReadback).reason,'VERIFIED_TIME_REQUIRED');assert.equal((await f.deliver()).status,200);assert.equal(f.base.data.payroll.size,0);
});
test('distinct events share existing Client serialization; completion wakes next event',async()=>{
 const f=await setup();await f.deliver();f.base.data.coverage.get(f.coverage)['Verified Hours']=9;
 const second={...f.event,snapshot:await sourceEventSnapshot(f.base,'financeDrafts',f.coverage)};await f.deliver(second);assert.equal(f.dispatches.length,1);
 assert.equal((await f.consume(0)).status,'exception');assert.equal(f.dispatches.length,2);assert.equal((await f.consume(1)).status,'done');assert.equal(f.base.data.payroll.size,1);
});
test('partial failure retries same receipt and reuses existing payroll',async()=>{
 const f=await setup();await f.deliver();f.base.failNext='invoices:create';await assert.rejects(f.consume());assert.equal(f.base.data.payroll.size,1);
 await f.deliver();assert.equal((await f.consume(1)).status,'done');assert.equal(f.base.data.payroll.size,1);
});
test('actual source trigger script relays identity and snapshot, then native executor proves effect',async()=>{
 const f=await setup(),script=await readFile(new URL('../../automation/intake/generated/source-event.js',import.meta.url),'utf8'),out={};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('base','fetch','input','output',script)(f.base,(url,opts)=>handleIntake(new Request(url,opts),'client',f.__deps),{config:()=>({operation:'financeDrafts',recordId:f.coverage}),secret:()=> 'test-secret'},{set:(k,v)=>out[k]=v});
 assert.equal(JSON.parse(out.result).status,'accepted_pending_airtable');assert.equal((await f.consume()).status,'done');
});
test('source trigger cannot relay an event without the UI-managed shared secret',async()=>{
 const f=await setup(),script=await readFile(new URL('../../automation/intake/generated/source-event.js',import.meta.url),'utf8');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;let requests=0;
 await assert.rejects(new AsyncFunction('base','fetch','input','output',script)(f.base,async()=>{requests++;return Response.json({});},{config:()=>({operation:'financeDrafts',recordId:f.coverage}),secret:()=>{throw new Error('SECRET_NOT_CONFIGURED');}},{set:()=>{}}),/SECRET_NOT_CONFIGURED/);
 assert.equal(requests,0);assert.equal(f.store.entries.size,0);
});
test('commercial authority change creates a new receipt after a held P2 event',async()=>{
 const f=await setup('staffingSlots'),requestId=f.base.data.coverage.get(f.coverage)['Source Client Intake'][0].id;
 const request=f.base.data.intake.get(requestId);const pass=request['CLI-01A Commercial / Service Authorization Gate'];request['CLI-01A Commercial / Service Authorization Gate']='BLOCKED';
 f.event.snapshot=await sourceEventSnapshot(f.base,'staffingSlots',f.coverage);await f.deliver();assert.equal((await f.consume()).status,'exception');
 request['CLI-01A Commercial / Service Authorization Gate']=pass;
 const corrected={...f.event,snapshot:await sourceEventSnapshot(f.base,'staffingSlots',f.coverage)};assert.notDeepEqual(corrected.snapshot,f.event.snapshot);
 await f.deliver(corrected);assert.equal((await f.consume(1)).status,'done');assert.equal(f.base.data.coverage.size,3);
});
test('Evidence approval change can recover P3B without changing Coverage hours',async()=>{
 const f=await setup();f.base.data.evidence.get(f.evidence).Verified=false;f.event.snapshot=await sourceEventSnapshot(f.base,'financeDrafts',f.coverage);
 await f.deliver();assert.equal((await f.consume()).status,'exception');f.base.data.evidence.get(f.evidence).Verified=true;
 const script=await readFile(new URL('../../automation/intake/generated/source-event.js',import.meta.url),'utf8');const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('base','fetch','input','output',script)(f.base,(url,opts)=>handleIntake(new Request(url,opts),'client',f.__deps),{config:()=>({operation:'financeDrafts',recordId:f.evidence,sourceTable:'evidence'}),secret:()=> 'test-secret'},{set:()=>{}});
 assert.equal((await f.consume(1)).status,'done');assert.equal(f.base.data.payroll.size,1);
});
test('terminal Booking change can recover P5 through its source event relay',async()=>{
 const f=await setup('bookingEvidence'),booking=f.base.data.evidence.get(f.evidence)['Worker Bookings'][0].id;
 f.base.data.bookings.get(booking)['Booking Status']={name:'Confirmed'};f.event.snapshot=await sourceEventSnapshot(f.base,'bookingEvidence',f.evidence);
 await f.deliver();assert.equal((await f.consume()).status,'exception');f.base.data.bookings.get(booking)['Booking Status']={name:'Completed'};
 const script=await readFile(new URL('../../automation/intake/generated/source-event.js',import.meta.url),'utf8');const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('base','fetch','input','output',script)(f.base,(url,opts)=>handleIntake(new Request(url,opts),'client',f.__deps),{config:()=>({operation:'bookingEvidence',recordId:booking,sourceTable:'booking'}),secret:()=> 'test-secret'},{set:()=>{}});
 assert.equal((await f.consume(1)).status,'done');assert.equal(f.base.data.evidence.get(f.evidence).Workers.length,1);
});
