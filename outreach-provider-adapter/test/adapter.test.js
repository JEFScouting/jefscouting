import assert from "node:assert/strict";
import test from "node:test";
import { AmbiguousProviderResult, FailClosedError, GmailOutreachV2Adapter, gmailCorrelationIdentity } from "../src/adapter.js";

const payload = Object.freeze({ contractVersion: "outreach-v2", suppressionCleared: true, campaignId: "campaign", leadId: "lead", messageVersion: "v1", sequenceStep: "FU1", destination: "person@example.com", subject: "Hello", textBody: "Body" });
const effectKey = "OUTREACH-SEND|campaign|lead|v1|FU1";
const claimToken = "11111111-1111-4111-8111-111111111111";
const activeControls = { adapterBuildEnabled: true, campaign: "ACTIVE", runtime: "ACTIVE", circuit: "ACTIVE", productionAuthority: true };

function harness({ claimResult = "WON", safety = true, providerResult = { confirmed: true, providerMessageId: "gmail-1" }, providerError, controls = activeControls } = {}) {
  const effects = { claim: 0, safety: 0, reserve: 0, send: 0, lookup: 0, confirm: 0, unknown: 0 };
  let record;
  const adapter = new GmailOutreachV2Adapter({
    controls,
    claimClient: { async claim() { effects.claim++; return { result: claimResult, record: { effect_key: effectKey, claim_token: claimToken } }; } },
    safetyGate: { async revalidate() { effects.safety++; return { suppressionCleared: safety, responsePriorityClear: safety }; } },
    attemptStore: {
      async reserve({ identity }) { effects.reserve++; if (record) return { result: "EXISTS", providerInvocationCount: record.providerInvocationCount }; record = { state: "RESERVED", providerInvocationCount: 1, identity }; return { result: "RESERVED", providerInvocationCount: 1 }; },
      async confirm(args) { effects.confirm++; record = { ...record, ...args, state: "CONFIRMED" }; },
      async unknownHold() { effects.unknown++; record.state = "UNKNOWN_HOLD"; },
      async failNoRetry() {},
      async readForReconciliation() { return record; }
    },
    gmailProvider: {
      async sendOnce() { effects.send++; if (providerError) throw providerError; return providerResult; },
      async lookup() { effects.lookup++; return { confirmed: true, providerMessageId: "gmail-1" }; }
    }
  });
  return { adapter, effects, record: () => record };
}

const request = { payload, effectKey, claimantId: "worker", claimToken };

test("confirmed send claims, revalidates, reserves exactly once, and persists Gmail outcome", async () => {
  const h = harness();
  assert.equal((await h.adapter.execute(request)).result, "CONFIRMED");
  assert.deepEqual(h.effects, { claim: 1, safety: 1, reserve: 1, send: 1, lookup: 0, confirm: 1, unknown: 0 });
  assert.equal(h.record().providerInvocationCount, 1);
  assert.equal(gmailCorrelationIdentity(effectKey).correlationId, gmailCorrelationIdentity(effectKey).correlationId);
});

test("default PAUSED/NO-GO controls fail before claim and produce zero effects", async () => {
  const h = harness({ controls: {} });
  await assert.rejects(h.adapter.execute(request), FailClosedError);
  assert.deepEqual(h.effects, { claim: 0, safety: 0, reserve: 0, send: 0, lookup: 0, confirm: 0, unknown: 0 });
});

test("claim loss and suppression revalidation failure never reach provider", async () => {
  for (const options of [{ claimResult: "EXISTS_HOLD" }, { safety: false }]) {
    const h = harness(options);
    await assert.rejects(h.adapter.execute(request), FailClosedError);
    assert.equal(h.effects.send, 0);
    assert.equal(h.effects.reserve, 0);
  }
});

test("ambiguous acknowledgment becomes UNKNOWN_HOLD and retry cannot reserve or resend", async () => {
  const h = harness({ providerError: new AmbiguousProviderResult("timeout") });
  assert.deepEqual(await h.adapter.execute(request), { result: "UNKNOWN_HOLD", identity: gmailCorrelationIdentity(effectKey), automaticRetry: false });
  await assert.rejects(h.adapter.execute(request), FailClosedError);
  assert.equal(h.effects.send, 1);
  assert.equal(h.record().providerInvocationCount, 1);
});

test("reconciliation uses stored identity lookup and never sends", async () => {
  const h = harness({ providerError: new AmbiguousProviderResult("timeout") });
  await h.adapter.execute(request);
  assert.equal((await h.adapter.reconcile({ effectKey, claimToken })).result, "RECONCILED");
  assert.equal(h.effects.send, 1);
  assert.equal(h.effects.lookup, 1);
  assert.equal(h.record().providerInvocationCount, 1);
});

test("malformed canonical payload/effect mismatch fail with zero external effects", async () => {
  const h = harness();
  await assert.rejects(h.adapter.execute({ ...request, effectKey: "wrong" }), FailClosedError);
  await assert.rejects(h.adapter.execute({ ...request, payload: { ...payload, suppressionCleared: false } }), FailClosedError);
  assert.equal(h.effects.send, 0);
  assert.equal(h.effects.claim, 0);
});
