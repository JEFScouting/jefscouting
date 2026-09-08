import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netlify/functions/slice01.mts", import.meta.url), "utf8");
const diagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic.mts", import.meta.url), "utf8");
const oneShotDiagnosticSource = await readFile(new URL("../netlify/functions/outreach-airtable-gate-diagnostic-once.mts", import.meta.url), "utf8");

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
  globalThis.Netlify={env:{get(key){return ({DATABASE_URL:"postgresql://user:pass@example.invalid/db",OUTREACH_RUNTIME_MODE:"zero-send",OUTREACH_SEND_ENABLED:"false",OUTREACH_RUNTIME_SHARED_SECRET:"test-secret"})[key] || "";}}};
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
  assert.match(source, /JSON\.stringify\(threadId \? \{ raw, threadId \} : \{ raw \}\)/);
  assert.match(source, /async function freshMailboxReality\(payload: any\)/);
  assert.match(source, /result: "NO_OP_STALE_MAILBOX"/);
  assert.match(source, /op === "EXECUTE_FIRST_TOUCH" \|\| op === "EXECUTE_FOLLOW_UP"/);
});
