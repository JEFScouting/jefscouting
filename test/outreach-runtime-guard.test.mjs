import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netlify/functions/slice01.mts", import.meta.url), "utf8");
const diagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic.mts", import.meta.url), "utf8");
const oneShotDiagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic-once.mts", import.meta.url), "utf8");
const netlifyConfigSource = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const motekEffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-ANCHOR-20260819-001|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const otherEffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-OTHER|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const motekEffectKeySha256 = createHash("sha256").update(motekEffectKey,"utf8").digest("hex");

function runtimeEnv(overrides={}) {
  return {
    DATABASE_URL:"postgresql://user:pass@example.invalid/db",
    OUTREACH_RUNTIME_MODE:"zero-send",
    OUTREACH_SEND_ENABLED:"false",
    OUTREACH_RUNTIME_SHARED_SECRET:"test-secret",
    ...overrides,
  };
}

function runtimeRequest(body) {
  return new Request("https://runtime.invalid/slice01",{method:"POST",headers:{"content-type":"application/json","x-outreach-runtime-secret":"test-secret"},body:JSON.stringify(body)});
}

const motekPayload = Object.freeze({
  contractVersion:"outreach-v2",suppressionCleared:true,campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",leadId:"LEAD-ANCHOR-20260819-001",
  messageVersion:"FOLLOW-UP-ADAPTIVE-v1.0",sequenceStep:"FOLLOW-UP-1",destination:"info@motek.com",subject:"Following up - hospitality support for Motek / Happy Corner Hospitality",textBody:"Frozen body",
  sequenceInstanceKey:"OUTREACH-SEQUENCE|LEAD-ANCHOR-20260819-001|GMAIL-THREAD|1a0193666357e1f4",sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",
  senderIdentitySnapshot:"JEF Scouting <jefscouting@gmail.com>",verifiedRecipient:"info@motek.com",finalSubjectSnapshot:"Following up - hospitality support for Motek / Happy Corner Hospitality",finalBodySnapshot:"Frozen body",priorContactSnapshot:"CLEAR",
  airtableActivityRecordId:"recsTFnxSZPkWrHFa",airtableLeadRecordId:"rec8xWqvtmWw5U0Rz",airtableCampaignRecordId:"reclIlbWpaTcMrc18",airtableCommandRecordId:"recpYdDfwJjrpUwyX",
  gmailThreadId:"1a0193666357e1f4",priorRfcMessageId:"<CAO+js0xOLCzRRKH=+EYqpTXrC5YoyxqiTK7=Lp6sC+VzmouCrw@mail.gmail.com>"
});

test("production mode exists only behind the canonical First-Touch adapter", () => {
  assert.match(source, /new Set\(\["zero-send", "canary-send", "production"\]\)/);
  assert.match(source, /op === "EXECUTE_FIRST_TOUCH"/);
  assert.match(source, /new GmailOutreachV2Adapter/);
  assert.match(source, /adapter\.execute/);
  assert.match(source, /PRODUCTION_TRANSMISSION_DISABLED/);
});

test("direct SEND_PROVIDER cannot cross the provider boundary", () => {
  const branch = source.match(/if \(op === "SEND_PROVIDER"\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(branch, /CANONICAL_ADAPTER_REQUIRED/);
  assert.match(branch, /provider_send_called: false/);
  assert.match(branch, /provider_call_count: 0/);
  assert.doesNotMatch(branch, /gmailSend|processSelfCanarySend/);
});

test("legacy direct runtime composition remains restricted to self-canary", () => {
  assert.doesNotMatch(source, /async function processSend\(/);
  assert.match(source, /async function processSelfCanarySend\(/);
  assert.match(source, /runtimeMode !== "canary-send"/);
  assert.match(source, /CANARY_DESTINATION_MUST_EQUAL_SENDER/);
  const invocations = [...source.matchAll(/processSelfCanarySend\(/g)];
  assert.equal(invocations.length, 2, "one declaration plus one SELF_CANARY_SEND invocation expected");
});

test("self-canary remains sender-to-sender and uses deterministic isolated identity", () => {
  assert.match(source, /String\(row\.destination\)\.toLowerCase\(\) !== String\(auth\.sender\)\.toLowerCase\(\)/);
  assert.match(source, /\$\{EFFECT_PREFIX\}\|SELF-CANARY\|\$\{canaryId\}\|v1\.1\.3\|CANARY/);
  assert.match(source, /provider_invocation_count=1/);
});

test("exact deployed handler path rejects First-Touch in zero-send before any external call", async () => {
  const originalFetch=globalThis.fetch;
  let externalCalls=0;
  globalThis.fetch=async()=>{externalCalls++; throw new Error("EXTERNAL_CALL_FORBIDDEN");};
  globalThis.Netlify={env:{get(key){return runtimeEnv()[key] || "";}}};
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?test=${Date.now()}`,import.meta.url));
    const response=await handler(new Request("https://runtime.invalid/slice01",{method:"POST",headers:{"content-type":"application/json","x-outreach-runtime-secret":"test-secret"},body:JSON.stringify({op:"EXECUTE_FIRST_TOUCH"})}));
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.error,"PRODUCTION_TRANSMISSION_DISABLED");
    assert.equal(body.provider_send_called,false);
    assert.equal(body.provider_call_count,0);
    assert.equal(externalCalls,0);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("one-EffectKey canary authority is exact, Follow-Up-only, and zero-send-only", async () => {
  const {hasExactFollowUpCanaryAuthority}=await import(new URL(`../.runtime-build/slice01.mjs?authority=${Date.now()}`,import.meta.url));
  const exact={configuredEffectKey:motekEffectKey,operation:"EXECUTE_FOLLOW_UP",suppliedEffectKey:motekEffectKey,sequenceStep:"FOLLOW-UP-1",runtimeMode:"zero-send",sendEnabled:false};
  assert.equal(hasExactFollowUpCanaryAuthority(exact),true);
  for (const changed of [
    {...exact,suppliedEffectKey:otherEffectKey},
    {...exact,configuredEffectKey:""},
    {...exact,configuredEffectKey:` ${motekEffectKey}`},
    {...exact,configuredEffectKey:`${motekEffectKey},${otherEffectKey}`},
    {...exact,operation:"EXECUTE_FIRST_TOUCH",sequenceStep:"FIRST-TOUCH"},
    {...exact,sequenceStep:"FIRST-TOUCH"},
    {...exact,runtimeMode:"production",sendEnabled:false},
    {...exact,runtimeMode:"zero-send",sendEnabled:true},
  ]) assert.equal(hasExactFollowUpCanaryAuthority(changed),false);
});

test("production config carries one exact non-secret binding and live identity exposes only its digest", async () => {
  const configured=[...netlifyConfigSource.matchAll(/^\s*OUTREACH_CANARY_EFFECT_KEY\s*=\s*"([^"]*)"\s*$/gm)].map((match)=>match[1]);
  assert.deepEqual(configured,[motekEffectKey]);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("EXTERNAL_CALL_FORBIDDEN");};
  globalThis.Netlify={env:{get(key){return key==="OUTREACH_CANARY_EFFECT_KEY"?motekEffectKey:"";}}};
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?identity=${Date.now()}`,import.meta.url));
    const response=await handler(new Request("https://runtime.invalid/slice01"));
    const body=await response.json();
    assert.equal(response.status,405);
    assert.equal(body.canary_effect_key_configured,true);
    assert.equal(body.canary_effect_key_sha256,motekEffectKeySha256);
    assert.equal(body.canary_operation,"EXECUTE_FOLLOW_UP");
    assert.equal(body.canary_sequence_step,"FOLLOW-UP-1");
    assert.equal(JSON.stringify(body).includes(motekEffectKey),false);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("non-exact canary requests and direct SEND_PROVIDER stay blocked with zero external calls", async () => {
  const originalFetch=globalThis.fetch;
  let externalCalls=0;
  let env=runtimeEnv();
  globalThis.fetch=async()=>{externalCalls++;throw new Error("EXTERNAL_CALL_FORBIDDEN");};
  globalThis.Netlify={env:{get(key){return env[key] || "";}}};
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?negative=${Date.now()}`,import.meta.url));
    for (const configuredEffectKey of ["",otherEffectKey,` ${motekEffectKey}`,`${motekEffectKey},${otherEffectKey}`]) {
      env=runtimeEnv({OUTREACH_CANARY_EFFECT_KEY:configuredEffectKey});
      const response=await handler(runtimeRequest({op:"EXECUTE_FOLLOW_UP",effect_key:motekEffectKey,payload:motekPayload}));
      const body=await response.json();
      assert.equal(response.status,409);
      assert.equal(body.error,"PRODUCTION_TRANSMISSION_DISABLED");
      assert.equal(body.provider_call_count,0);
    }
    env=runtimeEnv({OUTREACH_CANARY_EFFECT_KEY:motekEffectKey});
    const firstTouch=await handler(runtimeRequest({op:"EXECUTE_FIRST_TOUCH",effect_key:motekEffectKey,payload:{...motekPayload,sequenceStep:"FIRST-TOUCH"}}));
    assert.equal(firstTouch.status,409);
    assert.equal((await firstTouch.json()).error,"PRODUCTION_TRANSMISSION_DISABLED");
    const direct=await handler(runtimeRequest({op:"SEND_PROVIDER",effect_key:motekEffectKey}));
    const directBody=await direct.json();
    assert.equal(direct.status,409);
    assert.equal(directBody.error,"CANONICAL_ADAPTER_REQUIRED");
    assert.equal(directBody.provider_call_count,0);
    assert.equal(externalCalls,0);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("exact Motek binding reaches fresh exact-thread preflight but never a provider invocation", async () => {
  const originalFetch=globalThis.fetch;
  const urls=[];
  let providerInvocations=0;
  const env=runtimeEnv({
    OUTREACH_CANARY_EFFECT_KEY:motekEffectKey,AIRTABLE_READONLY_TOKEN:"read-only",AIRTABLE_BASE_ID:"appveHEw1HrXr8nD1",
    OUTREACH_AIRTABLE_COMMAND_RECORD_ID:"recpYdDfwJjrpUwyX",OUTREACH_AIRTABLE_CAMPAIGN_RECORD_ID:"reclIlbWpaTcMrc18",OUTREACH_CORRELATION_DOMAIN:"jefscouting.com",
    GMAIL_OAUTH_CLIENT_ID:"client",GMAIL_OAUTH_CLIENT_SECRET:"secret",GMAIL_OAUTH_REFRESH_TOKEN:"refresh",GMAIL_SENDER_EMAIL:"jefscouting@gmail.com",
    GMAIL_OAUTH_SCOPES:"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
  });
  globalThis.Netlify={env:{get(key){return env[key] || "";}}};
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);urls.push(url);
    if (url.includes("/gmail/v1/users/me/messages/send")) {providerInvocations++;throw new Error("PROVIDER_INVOCATION_FORBIDDEN");}
    if (url==="https://oauth2.googleapis.com/token") return Response.json({access_token:"access",scope:env.GMAIL_OAUTH_SCOPES});
    if (url.endsWith("/gmail/v1/users/me/profile")) return Response.json({emailAddress:"jefscouting@gmail.com"});
    if (url.includes("/gmail/v1/users/me/threads/1a0193666357e1f4")) return Response.json({messages:[
      {id:"1a0193666357e1f4",internalDate:"1000",labelIds:["SENT"],payload:{headers:[{name:"Message-ID",value:motekPayload.priorRfcMessageId},{name:"From",value:"JEF Scouting <jefscouting@gmail.com>"},{name:"To",value:"info@motek.com"}]}},
      {id:"draft-1",internalDate:"2000",labelIds:["DRAFT"],payload:{headers:[{name:"Message-ID",value:"<draft@example.com>"},{name:"From",value:"JEF Scouting <jefscouting@gmail.com>"},{name:"To",value:"info@motek.com"}]}}
    ]});
    if (url.startsWith("https://api.airtable.com/")) return Response.json({error:"intentional read-stop"},{status:500});
    throw new Error(`UNEXPECTED_EXTERNAL_CALL:${url}:${init.method || "GET"}`);
  };
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?preflight=${Date.now()}`,import.meta.url));
    const response=await handler(runtimeRequest({op:"EXECUTE_FOLLOW_UP",effect_key:motekEffectKey,claimant_id:"test",claim_token:"11111111-1111-4111-8111-111111111111",payload:motekPayload}));
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.error,"AIRTABLE_READ_FAILED_500");
    assert.ok(urls.some((url)=>url.includes("/threads/1a0193666357e1f4")),"fresh exact-thread preflight must run");
    assert.ok(urls.some((url)=>url.startsWith("https://api.airtable.com/")),"a DRAFT must not be mistaken for a sent Follow-Up");
    assert.equal(providerInvocations,0);
    assert.equal(body.provider_call_count,0);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("Airtable gate diagnostic is shared-secret protected and zero-send only", () => {
  assert.match(diagnosticSource, /OUTREACH_RUNTIME_SHARED_SECRET/);
  assert.match(diagnosticSource, /x-outreach-runtime-secret/);
  assert.match(diagnosticSource, /runtimeMode !== "zero-send" \|\| sendEnabled/);
  assert.match(diagnosticSource, /DIAGNOSTIC_REQUIRES_ZERO_SEND/);
  assert.match(diagnosticSource, /AIRTABLE_READONLY_TOKEN/);
  assert.match(diagnosticSource, /new AirtableReadOnlyClient/);
  assert.match(diagnosticSource, /new AirtableOutreachGates/);
  assert.match(diagnosticSource, /gates\.readCurrent/);
  assert.match(diagnosticSource, /gates\.revalidate/);
  assert.match(diagnosticSource, /provider_send_called: false/);
  assert.match(diagnosticSource, /provider_call_count: 0/);
  assert.match(diagnosticSource, /mutation_performed: false/);
  assert.doesNotMatch(diagnosticSource, /GmailApiProvider|gmailSend|sendRaw|PostgresClaimStore|\bPool\b|\bneon\b/);
});

test("one-shot Airtable diagnostic runner is internal, zero-send, and mutation-free", () => {
  assert.match(oneShotDiagnosticSource, /OUTREACH_RUNTIME_SHARED_SECRET/);
  assert.match(oneShotDiagnosticSource, /"x-outreach-runtime-secret": secret/);
  assert.match(oneShotDiagnosticSource, /runtimeMode !== "zero-send" \|\| sendEnabled/);
  assert.match(oneShotDiagnosticSource, /recOJ6Z6RYeIwgyQL/);
  assert.match(oneShotDiagnosticSource, /recpYdDfwJjrpUwyX/);
  assert.match(oneShotDiagnosticSource, /reclIlbWpaTcMrc18/);
  assert.equal([...oneShotDiagnosticSource.matchAll(/await fetch\(/g)].length, 1);
  assert.doesNotMatch(oneShotDiagnosticSource, /GmailApiProvider|gmailSend|sendRaw|PostgresClaimStore|reserveProviderAttempt|claim\(/);
});

test("runtime binds Follow-Up Gmail thread and fresh mailbox reality before adapter execution", () => {
  assert.match(source, /JEF-OUTREACH-RUNTIME-v1\.1\.6-one-effectkey-canary-boundary/);
  assert.match(source, /JSON\.stringify\(threadId \? \{ raw, threadId \} : \{ raw \}\)/);
  assert.match(source, /async function freshMailboxReality\(payload: any\)/);
  assert.match(source, /message\.labelIds\.includes\("SENT"\)/);
  assert.match(source, /canonicalGmailTransport\(payload\.senderIdentitySnapshot\)/);
  assert.match(source, /result: "NO_OP_STALE_MAILBOX"/);
  assert.match(source, /op === "EXECUTE_FIRST_TOUCH" \|\| op === "EXECUTE_FOLLOW_UP"/);
});
