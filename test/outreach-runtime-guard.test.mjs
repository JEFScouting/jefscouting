import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netlify/functions/slice01.mts", import.meta.url), "utf8");
const diagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic.mts", import.meta.url), "utf8");
const oneShotDiagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic-once.mts", import.meta.url), "utf8");
const netlifyConfigSource = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const motekEffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-ANCHOR-20260819-001|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const motekV11EffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-ANCHOR-20260819-001|FOLLOW-UP-ADAPTIVE-v1.1|FOLLOW-UP-1";
const otherEffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-OTHER|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const recoveryKind = "CLOSED_NO_PROVIDER_EFFECT_ONCE";
const hughFailedEffectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-ANCHOR-20260819-002|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const contaminatedEffectKeys = Object.freeze([
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-20260810-CHATEAU-ZZS|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V14-20260808-MIA-B1-031|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-DAILY-20260806-100|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-20260810-DELILAH-MIAMI|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V163-20260821-HOTELS-FLL-B1-CORAL-KEY|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V163-20260822-HOTELS-BROWARD-TRU-POMPANO|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V14-20260808-MIA-B1-021|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V163-20260821-HOTELS-FLL-B1-BREAKAWAY|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V14-20260808-MIA-B1-051|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V163-20260821-HOTELS-FLL-B1-BLUE-STRAWBERRY|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V163-20260822-HOTELS-BROWARD-HIX-DANIA|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
  "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-V14-20260808-MIA-B1-039|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1"
]);
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

let oauthDiagnosticImport = 0;
async function runOAuthRefreshDiagnostic(googleBody, status=400) {
  const originalFetch=globalThis.fetch;
  const urls=[];
  const env=runtimeEnv({
    OUTREACH_RUNTIME_MODE:"manual",
    OUTREACH_SEND_ENABLED:"false",
    GMAIL_OAUTH_CLIENT_ID:"client-id-value",
    GMAIL_OAUTH_CLIENT_SECRET:"client-secret-value",
    GMAIL_OAUTH_REFRESH_TOKEN:"refresh-token-value",
    GMAIL_SENDER_EMAIL:"jefscouting@gmail.com",
    GMAIL_OAUTH_SCOPES:"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  });
  globalThis.Netlify={env:{get(key){return env[key] || "";}}};
  globalThis.fetch=async(input)=>{
    const url=String(input);
    urls.push(url);
    if (url !== "https://oauth2.googleapis.com/token") throw new Error("NON_OAUTH_DIAGNOSTIC_CALL_FORBIDDEN");
    return Response.json(googleBody,{status});
  };
  try {
    oauthDiagnosticImport += 1;
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?oauth-diagnostic=${oauthDiagnosticImport}`,import.meta.url));
    const response=await handler(runtimeRequest({op:"GMAIL_OAUTH_REFRESH_DIAGNOSTIC"}));
    return {response,body:await response.json(),urls};
  } finally {
    globalThis.fetch=originalFetch;
    delete globalThis.Netlify;
  }
}

const motekPayload = Object.freeze({
  contractVersion:"outreach-v2",suppressionCleared:true,campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",leadId:"LEAD-ANCHOR-20260819-001",
  messageVersion:"FOLLOW-UP-ADAPTIVE-v1.0",sequenceStep:"FOLLOW-UP-1",destination:"info@motek.com",subject:"Following up - hospitality support for Motek / Happy Corner Hospitality",textBody:"Frozen body",
  sequenceInstanceKey:"OUTREACH-SEQUENCE|LEAD-ANCHOR-20260819-001|GMAIL-THREAD|1a0193666357e1f4",sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",
  senderIdentitySnapshot:"JEF Scouting <jefscouting@gmail.com>",verifiedRecipient:"info@motek.com",finalSubjectSnapshot:"Following up - hospitality support for Motek / Happy Corner Hospitality",finalBodySnapshot:"Frozen body",priorContactSnapshot:"CLEAR",
  airtableActivityRecordId:"recsTFnxSZPkWrHFa",airtableLeadRecordId:"rec8xWqvtmWw5U0Rz",airtableCampaignRecordId:"reclIlbWpaTcMrc18",airtableCommandRecordId:"recpYdDfwJjrpUwyX",
  gmailThreadId:"1a0193666357e1f4",priorRfcMessageId:"<CAO+js0xOLCzRRKH=+EYqpTXrC5YoyxqiTK7=Lp6sC+VzmouCrw@mail.gmail.com>"
});
const motekV11Payload = Object.freeze({
  ...motekPayload,
  messageVersion:"FOLLOW-UP-ADAPTIVE-v1.1",
  sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.1",
  templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.1",
  airtableActivityRecordId:"rechGpjbcwiw0DS0W",
});

test("manual and production modes exist only behind the canonical adapter", () => {
  assert.match(source, /new Set\(\["zero-send", "canary-send", "manual", "production"\]\)/);
  assert.match(source, /op === "EXECUTE_FIRST_TOUCH"/);
  assert.match(source, /new GmailOutreachV2Adapter/);
  assert.match(source, /adapter\.execute/);
  assert.match(source, /PRODUCTION_TRANSMISSION_DISABLED/);
});

test("manual authority is explicit Follow-Up-only and has no EffectKey exception", async () => {
  const {hasManualFollowUpAuthority}=await import(new URL(`../.runtime-build/slice01.mjs?manual=${Date.now()}`,import.meta.url));
  const exact={operation:"EXECUTE_FOLLOW_UP",sequenceStep:"FOLLOW-UP-1",runtimeMode:"manual",sendEnabled:false};
  assert.equal(hasManualFollowUpAuthority(exact),true);
  assert.equal(hasManualFollowUpAuthority({...exact,effectKey:motekV11EffectKey}),true);
  assert.equal(hasManualFollowUpAuthority({...exact,effectKey:otherEffectKey}),true);
  for (const changed of [
    {...exact,operation:"EXECUTE_FIRST_TOUCH",sequenceStep:"FIRST-TOUCH"},
    {...exact,operation:"SEND_PROVIDER"},
    {...exact,sequenceStep:"FIRST-TOUCH"},
    {...exact,runtimeMode:"zero-send"},
    {...exact,runtimeMode:"production",sendEnabled:true},
    {...exact,sendEnabled:true},
  ]) assert.equal(hasManualFollowUpAuthority(changed),false);
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

test("manual mode rejects First-Touch and direct provider operations before any external call", async () => {
  const originalFetch=globalThis.fetch;
  let externalCalls=0;
  const env=runtimeEnv({OUTREACH_RUNTIME_MODE:"manual",OUTREACH_SEND_ENABLED:"false"});
  globalThis.fetch=async()=>{externalCalls++;throw new Error("EXTERNAL_CALL_FORBIDDEN");};
  globalThis.Netlify={env:{get(key){return env[key] || "";}}};
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?manual-negative=${Date.now()}`,import.meta.url));
    const firstTouch=await handler(runtimeRequest({op:"EXECUTE_FIRST_TOUCH",effect_key:motekV11EffectKey,payload:{...motekV11Payload,sequenceStep:"FIRST-TOUCH",gmailThreadId:undefined,priorRfcMessageId:undefined}}));
    assert.equal(firstTouch.status,409);
    assert.equal((await firstTouch.json()).error,"PRODUCTION_TRANSMISSION_DISABLED");
    const direct=await handler(runtimeRequest({op:"SEND_PROVIDER",effect_key:motekV11EffectKey}));
    assert.equal(direct.status,409);
    assert.equal((await direct.json()).error,"CANONICAL_ADAPTER_REQUIRED");
    const batch=await handler(runtimeRequest({op:"EXECUTE_BATCH"}));
    assert.equal(batch.status,400);
    assert.equal((await batch.json()).error,"UNKNOWN_OPERATION");
    assert.equal(externalCalls,0);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("one-EffectKey canary authority is exact, Follow-Up-only, and zero-send-only", async () => {
  const {hasExactFollowUpCanaryAuthority,hasExactZeroProviderRecoveryAuthority}=await import(new URL(`../.runtime-build/slice01.mjs?authority=${Date.now()}`,import.meta.url));
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

  const recovery={boundedCanaryAuthorized:true,requestedRecoveryKind:recoveryKind,suppliedEffectKey:motekEffectKey,configuredEffectKey:motekEffectKey,sequenceStep:"FOLLOW-UP-1",runtimeMode:"zero-send",sendEnabled:false};
  assert.equal(hasExactZeroProviderRecoveryAuthority(recovery),true);
  for (const changed of [
    {...recovery,boundedCanaryAuthorized:false},
    {...recovery,requestedRecoveryKind:undefined},
    {...recovery,requestedRecoveryKind:"CLOSED_NO_PROVIDER_EFFECT"},
    {...recovery,suppliedEffectKey:otherEffectKey},
    {...recovery,configuredEffectKey:otherEffectKey},
    {...recovery,sequenceStep:"FIRST-TOUCH"},
    {...recovery,runtimeMode:"production",sendEnabled:true},
    {...recovery,sendEnabled:true},
  ]) assert.equal(hasExactZeroProviderRecoveryAuthority(changed),false);
  for (const blockedEffectKey of [...contaminatedEffectKeys,hughFailedEffectKey]) {
    assert.equal(hasExactZeroProviderRecoveryAuthority({
      ...recovery,
      suppliedEffectKey:blockedEffectKey,
      configuredEffectKey:blockedEffectKey
    }),false);
  }
});

test("production config uses manual Follow-Up mode without a bespoke EffectKey binding", async () => {
  const configured=[...netlifyConfigSource.matchAll(/^\s*OUTREACH_CANARY_EFFECT_KEY\s*=\s*"([^"]*)"\s*$/gm)].map((match)=>match[1]);
  assert.deepEqual(configured,[]);
  assert.match(netlifyConfigSource,/OUTREACH_RUNTIME_MODE\s*=\s*"manual"/);
  assert.match(netlifyConfigSource,/OUTREACH_SEND_ENABLED\s*=\s*"false"/);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("EXTERNAL_CALL_FORBIDDEN");};
  globalThis.Netlify={env:{get(){return "";}}};
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?identity=${Date.now()}`,import.meta.url));
    const response=await handler(new Request("https://runtime.invalid/slice01"));
    const body=await response.json();
    assert.equal(response.status,405);
    assert.equal(body.canary_effect_key_configured,false);
    assert.equal(body.canary_effect_key_sha256,null);
    assert.equal(body.canary_operation,null);
    assert.equal(body.canary_sequence_step,null);
    assert.equal(body.zero_provider_recovery_kind,null);
    assert.equal(body.manual_follow_up_supported,true);
    assert.equal(body.autonomous_or_batch_send_supported,false);
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
    for (const invalidRecoveryKind of ["", "CLOSED_NO_PROVIDER_EFFECT", [recoveryKind]]) {
      const recovery=await handler(runtimeRequest({op:"EXECUTE_FOLLOW_UP",effect_key:motekEffectKey,recovery_kind:invalidRecoveryKind,payload:motekPayload}));
      const recoveryBody=await recovery.json();
      assert.equal(recovery.status,409);
      assert.equal(recoveryBody.error,"ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID");
      assert.equal(recoveryBody.provider_call_count,0);
    }
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

test("ordinary Motek v1.1 manual Follow-Up reaches fresh exact-thread preflight but never a provider invocation in tests", async () => {
  const originalFetch=globalThis.fetch;
  const urls=[];
  let providerInvocations=0;
  const env=runtimeEnv({
    OUTREACH_RUNTIME_MODE:"manual",OUTREACH_SEND_ENABLED:"false",AIRTABLE_READONLY_TOKEN:"read-only",AIRTABLE_BASE_ID:"appveHEw1HrXr8nD1",
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
      {id:"1a0193666357e1f4",internalDate:"1000",labelIds:["SENT"],payload:{headers:[{name:"Message-ID",value:motekV11Payload.priorRfcMessageId},{name:"From",value:"JEF Scouting <jefscouting@gmail.com>"},{name:"To",value:"info@motek.com"}]}},
      {id:"draft-1",internalDate:"2000",labelIds:["DRAFT"],payload:{headers:[{name:"Message-ID",value:"<draft@example.com>"},{name:"From",value:"JEF Scouting <jefscouting@gmail.com>"},{name:"To",value:"info@motek.com"}]}}
    ]});
    if (url.startsWith("https://api.airtable.com/")) return Response.json({error:"intentional read-stop"},{status:500});
    throw new Error(`UNEXPECTED_EXTERNAL_CALL:${url}:${init.method || "GET"}`);
  };
  try {
    const {default:handler}=await import(new URL(`../.runtime-build/slice01.mjs?preflight=${Date.now()}`,import.meta.url));
    const response=await handler(runtimeRequest({op:"EXECUTE_FOLLOW_UP",effect_key:motekV11EffectKey,claimant_id:"test",claim_token:"11111111-1111-4111-8111-111111111111",payload:motekV11Payload}));
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.error,"AIRTABLE_READ_FAILED_500");
    assert.ok(urls.some((url)=>url.includes("/threads/1a0193666357e1f4")),"fresh exact-thread preflight must run");
    assert.ok(urls.some((url)=>url.startsWith("https://api.airtable.com/")),"a DRAFT must not be mistaken for a sent Follow-Up");
    assert.equal(providerInvocations,0);
    assert.equal(body.provider_call_count,0);
  } finally { globalThis.fetch=originalFetch; delete globalThis.Netlify; }
});

test("OAuth refresh diagnostic safely exposes invalid_grant without reaching Gmail", async () => {
  const {response,body,urls}=await runOAuthRefreshDiagnostic({
    error:"invalid_grant",
    error_description:"Token has been expired or revoked.",
  });
  assert.equal(response.status,502);
  assert.equal(body.error,"invalid_grant");
  assert.equal(body.error_description,"Token has been expired or revoked.");
  assert.deepEqual(urls,["https://oauth2.googleapis.com/token"]);
  assert.equal(body.provider_send_called,false);
  assert.equal(body.provider_call_count,0);
  assert.equal(body.business_state_mutation,false);
});

test("OAuth refresh diagnostic safely exposes invalid_client without reaching Gmail", async () => {
  const {response,body,urls}=await runOAuthRefreshDiagnostic({
    error:"invalid_client",
    error_description:"The OAuth client was not found.",
  });
  assert.equal(response.status,502);
  assert.equal(body.error,"invalid_client");
  assert.equal(body.error_description,"The OAuth client was not found.");
  assert.deepEqual(urls,["https://oauth2.googleapis.com/token"]);
  assert.equal(body.provider_send_called,false);
  assert.equal(body.provider_call_count,0);
});

test("successful OAuth refresh diagnostic discards the access token and still cannot reach Gmail", async () => {
  const {response,body,urls}=await runOAuthRefreshDiagnostic({
    access_token:"access-value",
    scope:"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  },200);
  const serialized=JSON.stringify(body);
  assert.equal(response.status,200);
  assert.equal(body.result,"OAUTH_REFRESH_OK");
  assert.equal(serialized.includes("access-value"),false);
  assert.equal(serialized.includes("access_token"),false);
  assert.deepEqual(urls,["https://oauth2.googleapis.com/token"]);
  assert.equal(body.provider_boundary_crossed,false);
  assert.equal(body.provider_send_called,false);
  assert.equal(body.provider_call_count,0);
  assert.equal(body.business_state_mutation,false);
});

test("unknown OAuth error classes fail closed without reflecting raw provider content", async () => {
  const {response,body}=await runOAuthRefreshDiagnostic({
    error:"unexpected_provider_error",
    error_description:"raw provider detail must not be reflected",
  });
  assert.equal(response.status,502);
  assert.equal(body.error,"unknown_oauth_error");
  assert.equal(body.error_description,"Google OAuth token refresh failed with an unrecognized error class.");
  assert.doesNotMatch(JSON.stringify(body),/unexpected_provider_error|raw provider detail/);
});

test("OAuth refresh diagnostic redacts credential fields and never enters a provider send path", async () => {
  const forbiddenValues=["client-id-value","client-secret-value","refresh-token-value","access-value","auth-code-value"];
  const {response,body,urls}=await runOAuthRefreshDiagnostic({
    error:"invalid_grant",
    error_description:"client_id=client-id-value client_secret=client-secret-value refresh_token=refresh-token-value access_token=access-value authorization_code=auth-code-value",
    access_token:"access-value",
    refresh_token:"refresh-token-value",
    client_secret:"client-secret-value",
    authorization_code:"auth-code-value",
    nested:{request_body:"must not escape"},
  });
  const serialized=JSON.stringify(body);
  assert.equal(response.status,502);
  assert.equal(body.error,"invalid_grant");
  assert.match(body.error_description,/\[REDACTED/);
  for (const value of forbiddenValues) assert.equal(serialized.includes(value),false);
  for (const field of ["access_token","refresh_token","client_secret","authorization_code","request_body"]) assert.equal(serialized.includes(field),false);
  assert.deepEqual(urls,["https://oauth2.googleapis.com/token"]);
  assert.equal(body.provider_boundary_crossed,false);
  assert.equal(body.provider_send_called,false);
  assert.equal(body.provider_call_count,0);
  assert.equal(body.business_state_mutation,false);
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
  assert.match(source, /JEF-OUTREACH-RUNTIME-v1\.1\.10-oauth-error-observability/);
  assert.match(source, /JSON\.stringify\(threadId \? \{ raw, threadId \} : \{ raw \}\)/);
  assert.match(source, /async function freshMailboxReality\(payload: any\)/);
  assert.match(source, /message\.labelIds\.includes\("SENT"\)/);
  assert.match(source, /canonicalGmailTransport\(payload\.senderIdentitySnapshot\)/);
  assert.match(source, /result: "NO_OP_STALE_MAILBOX"/);
  assert.match(source, /op === "EXECUTE_FIRST_TOUCH" \|\| op === "EXECUTE_FOLLOW_UP"/);
  assert.match(source, /ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/);
  assert.match(source, /ZERO_PROVIDER_RECOVERY_KIND/);
});
