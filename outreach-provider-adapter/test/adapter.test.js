import assert from "node:assert/strict";
import test from "node:test";
import {
  AmbiguousProviderResult,
  FailClosedError,
  GmailOutreachV2Adapter,
  PreInvocationProviderError,
  canonicalPayloadFingerprint,
  gmailCorrelationIdentity
} from "../src/adapter.js";

const payload = Object.freeze({
  contractVersion: "outreach-v2", suppressionCleared: true, campaignId: "campaign", leadId: "lead", messageVersion: "v1", sequenceStep: "FU1",
  sequenceInstanceKey: "SEQ|campaign|lead|v1", sequenceVersionSnapshot: "seq-v1", templateVersionSnapshot: "tpl-v3",
  senderIdentitySnapshot: "sender:jef-outreach", verifiedRecipient: "person@example.com", destination: "person@example.com",
  finalSubjectSnapshot: "Hello", subject: "Hello", finalBodySnapshot: "Body", textBody: "Body", priorContactSnapshot: "CLEAR"
});
const effectKey = "OUTREACH-SEND|campaign|lead|v1|FU1";
const claimToken = "11111111-1111-4111-8111-111111111111";
const activeControls = { adapterBuildEnabled: true, campaign: "ACTIVE", runtime: "ACTIVE", circuit: "ACTIVE" };
const canonicalBinding = Object.freeze({
  decision: "AUTHORIZED", commandId: "CMD-EXACT-EFFECT", releaseId: "REL-OUTREACH-V2", authorityVersion: "v1", effectKey,
  payloadFingerprint: canonicalPayloadFingerprint(payload), verifiedRecipient: payload.verifiedRecipient,
  senderIdentity: payload.senderIdentitySnapshot, correlationDomain: "outreach.example.test"
});

function harness({ claimResult = "WON", safety = true, providerResult = { confirmed: true, providerMessageId: "gmail-1" }, providerError, controls = activeControls, binding = canonicalBinding } = {}) {
  const effects = { authority: 0, claim: 0, safety: 0, reserve: 0, send: 0, lookup: 0, confirm: 0, unknown: 0, fail: 0 };
  let record;
  const claimStore = {
    async claim() { effects.claim++; return { result: claimResult, record: { effect_key: effectKey, claim_token: claimToken } }; },
    async reserveProviderAttempt({ identity, payloadFingerprint }) {
      effects.reserve++;
      if (record) return { result: "EXISTS", providerInvocationCount: record.providerInvocationCount };
      record = { state: "RESERVED", providerInvocationCount: 1, identity, payloadFingerprint };
      return { result: "RESERVED", providerInvocationCount: 1 };
    },
    async confirmProviderOutcome(args) { effects.confirm++; record = { ...record, ...args, state: "CONFIRMED" }; },
    async holdUnknownProviderOutcome(args) { effects.unknown++; record = { ...record, ...args, state: "UNKNOWN_HOLD" }; },
    async failProviderAttemptNoRetry(args) { effects.fail++; record = { ...record, ...args, state: "FAILED_NO_RETRY" }; },
    async readForReconciliation() { return record; }
  };
  const adapter = new GmailOutreachV2Adapter({
    controls,
    executionGate: { async readCurrent() { effects.authority++; return binding; } },
    claimStore,
    safetyGate: { async revalidate() { effects.safety++; return { suppressionCleared: safety, responsePriorityClear: safety }; } },
    gmailProvider: {
      async sendOnce() { effects.send++; if (providerError) throw providerError; return providerResult; },
      async lookup() { effects.lookup++; return { confirmed: true, providerMessageId: "gmail-1" }; }
    }
  });
  return { adapter, effects, record: () => record, claimStore };
}

const request = { payload, effectKey, claimantId: "worker", claimToken };

test("confirmed send uses one durable claim store for ownership + provider attempt", async () => {
  const h = harness();
  assert.equal((await h.adapter.execute(request)).result, "CONFIRMED");
  assert.deepEqual(h.effects, { authority: 1, claim: 1, safety: 1, reserve: 1, send: 1, lookup: 0, confirm: 1, unknown: 0, fail: 0 });
  assert.equal(h.record().providerInvocationCount, 1);
  assert.equal(h.record().payloadFingerprint, canonicalBinding.payloadFingerprint);
});

test("constructor rejects split-store shape", () => {
  assert.throws(() => new GmailOutreachV2Adapter({ claimClient: {}, attemptStore: {}, safetyGate: {}, executionGate: {}, gmailProvider: {}, controls: activeControls }), FailClosedError);
});

test("correlation identity has stable known value and injected non-invalid domain", () => {
  const identity = gmailCorrelationIdentity(effectKey, "outreach.example.test");
  assert.equal(identity.correlationId, "jef-outreach-v2-1a07f7c1ddec742407aa655f464bdd8a4c120dd272935ac9e7064c1a73357e67");
  assert.equal(identity.rfcMessageId, "<jef-outreach-v2-1a07f7c1ddec742407aa655f464bdd8a4c120dd272935ac9e7064c1a73357e67@outreach.example.test>");
  assert.throws(() => gmailCorrelationIdentity(effectKey, "outreach.invalid"), FailClosedError);
});

test("default PAUSED/NO-GO controls fail before authority/claim and produce zero effects", async () => {
  const h = harness({ controls: {} });
  await assert.rejects(h.adapter.execute(request), FailClosedError);
  assert.deepEqual(h.effects, { authority: 0, claim: 0, safety: 0, reserve: 0, send: 0, lookup: 0, confirm: 0, unknown: 0, fail: 0 });
});

test("canonical authority cannot be manufactured by a bare boolean or mismatched effect", async () => {
  for (const binding of [{ ...canonicalBinding, decision: "HOLD" }, { ...canonicalBinding, commandId: "" }, { ...canonicalBinding, effectKey: "other" }]) {
    const h = harness({ binding });
    await assert.rejects(h.adapter.execute(request), FailClosedError);
    assert.equal(h.effects.claim, 0); assert.equal(h.effects.send, 0);
  }
});

test("recipient/sender/content snapshot tampering blocks before claim/provider", async () => {
  for (const mutated of [{ ...payload, destination: "wrong@example.com" }, { ...payload, subject: "Changed" }, { ...payload, textBody: "Changed" }, { ...payload, senderIdentitySnapshot: "sender:other" }, { ...payload, priorContactSnapshot: "UNKNOWN" }]) {
    const h = harness();
    await assert.rejects(h.adapter.execute({ ...request, payload: mutated }), FailClosedError);
    assert.equal(h.effects.claim, 0); assert.equal(h.effects.send, 0);
  }
});

test("canonical payload fingerprint mismatch blocks before claim/provider", async () => {
  const h = harness({ binding: { ...canonicalBinding, payloadFingerprint: "0".repeat(64) } });
  await assert.rejects(h.adapter.execute(request), FailClosedError);
  assert.equal(h.effects.claim, 0); assert.equal(h.effects.send, 0);
});

test("claim loss and suppression revalidation failure never reach provider", async () => {
  for (const options of [{ claimResult: "EXISTS_HOLD" }, { safety: false }]) {
    const h = harness(options);
    await assert.rejects(h.adapter.execute(request), FailClosedError);
    assert.equal(h.effects.send, 0); assert.equal(h.effects.reserve, 0);
  }
});

test("ambiguous acknowledgment becomes UNKNOWN_HOLD and retry cannot reserve or resend", async () => {
  const h = harness({ providerError: new AmbiguousProviderResult("timeout") });
  const result = await h.adapter.execute(request);
  assert.equal(result.result, "UNKNOWN_HOLD"); assert.equal(result.automaticRetry, false); assert.equal(result.classification, "AMBIGUOUS_PROVIDER_ACK");
  await assert.rejects(h.adapter.execute(request), FailClosedError);
  assert.equal(h.effects.send, 1); assert.equal(h.record().providerInvocationCount, 1);
});

test("pre-invocation provider failure is explicit and never converted to UNKNOWN_HOLD", async () => {
  const h = harness({ providerError: new PreInvocationProviderError("not invoked") });
  await assert.rejects(h.adapter.execute(request), PreInvocationProviderError);
  assert.equal(h.effects.fail, 1); assert.equal(h.effects.unknown, 0); assert.equal(h.record().state, "FAILED_NO_RETRY");
});

test("unclassified post-boundary provider error fails closed as UNKNOWN_HOLD", async () => {
  const h = harness({ providerError: new Error("unexpected") });
  const result = await h.adapter.execute(request);
  assert.equal(result.result, "UNKNOWN_HOLD"); assert.equal(result.automaticRetry, false); assert.equal(h.record().state, "UNKNOWN_HOLD");
});

test("reconciliation uses stored identity lookup and never sends", async () => {
  const h = harness({ providerError: new AmbiguousProviderResult("timeout") });
  await h.adapter.execute(request);
  assert.equal((await h.adapter.reconcile({ effectKey, claimToken })).result, "RECONCILED");
  assert.equal(h.effects.send, 1); assert.equal(h.effects.lookup, 1); assert.equal(h.record().providerInvocationCount, 1);
});

test("malformed canonical payload/effect mismatch fail with zero external effects", async () => {
  const h = harness();
  await assert.rejects(h.adapter.execute({ ...request, effectKey: "wrong" }), FailClosedError);
  await assert.rejects(h.adapter.execute({ ...request, payload: { ...payload, suppressionCleared: false } }), FailClosedError);
  assert.equal(h.effects.send, 0); assert.equal(h.effects.claim, 0);
});
