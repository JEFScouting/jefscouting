import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleIntake} from '../../netlify/functions/_shared/intake-transport.mts';
import {FakeBase,FakeStore,source} from './harness.mjs';

test('generated Client native run proves its live claim, preserves blocked commercial handoff and rejects stale/forged proofs',async()=>{
  const store=new FakeStore(),base=new FakeBase(),provider=source('client'),dispatched=[],out={};
  const env={JOTFORM_API_KEY:'test',JOTFORM_ADMIN_SECRET:'test',JEF_CLIENT_INTAKE_V2_ENABLED:'true',AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL:'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/client'};
  const deps={store,env:k=>env[k],now:()=>new Date().toISOString(),log:()=>{},fetch:async(url,opts)=>{
    if(String(url).startsWith('https://api.jotform.com/'))return Response.json({responseCode:200,content:provider});
    dispatched.push(JSON.parse(opts.body));return Response.json({success:true});
  }};
  const endpoint='https://jefscouting.com/api/client-jotform-webhook';
  const f=new FormData();f.set('submissionID',provider.id);f.set('formID',provider.form_id);
  assert.equal((await handleIntake(new Request(endpoint,{method:'POST',body:f}),'client',deps)).status,202);
  let consumer;
  const nativeFetch=async(url,opts)=>{
    const body=JSON.parse(opts.body),r=await handleIntake(new Request(url,opts),'client',deps);
    if(body.action==='claim')consumer=(await r.clone().json()).consumerToken;
    if(body.action==='assertClaim'){
      const before=store.revision;
      const bad=await handleIntake(new Request(url,{...opts,body:JSON.stringify({...body,consumerToken:'forged'})}),'client',deps);
      assert.equal(bad.status,409);assert.equal(store.revision,before);assert.equal(r.status,200);
    }
    return r;
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const script=await readFile(new URL('../../automation/intake/generated/client.js',import.meta.url),'utf8');
  await new AsyncFunction('base','fetch','input','output',script)(base,nativeFetch,{config:()=>dispatched[0]},{set:(k,v)=>out[k]=v});
  assert.equal(out.status,'done');const h=JSON.parse(out.handoffReadback);
  assert.equal(h.slots.reason,'FULL_COMMERCIAL_GATE_REQUIRED');assert.deepEqual(h.finance,[]);
  assert.equal(base.data.coverage.size,0);assert.equal(base.data.payroll.size,0);
  const stale=await handleIntake(new Request(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...dispatched[0],action:'assertClaim',consumerToken:consumer})}),'client',deps);
  assert.equal(stale.status,409);
});
