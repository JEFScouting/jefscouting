import assert from "node:assert/strict";
import test from "node:test";
import { AmbiguousProviderResult, FailClosedError, PreInvocationProviderError } from "../src/adapter.js";
import { GmailApiProvider, buildGmailRawMessage } from "../src/gmail-provider.js";

const payload = { destination: "person@example.com", subject: "Hello", textBody: "Body" };
const identity = { rfcMessageId: "<jef-outreach-v2-test@jefscouting.com>" };

function decode(raw) {
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

test("raw Gmail message binds exact recipient, sender, subject, body and deterministic Message-ID", () => {
  const raw = buildGmailRawMessage({ payload, identity, from: "hello@jefscouting.com" });
  const mime = decode(raw);
  assert.match(mime, /^From: hello@jefscouting\.com\r\nTo: person@example\.com\r\nSubject: Hello\r\nMessage-ID: <jef-outreach-v2-test@jefscouting\.com>/);
  assert.ok(mime.endsWith("\r\n\r\nBody"));
});

test("header injection is rejected before transport", () => {
  for (const bad of [
    { ...payload, destination: "person@example.com\r\nBcc: attacker@example.com" },
    { ...payload, subject: "Hello\nBcc: attacker@example.com" }
  ]) assert.throws(() => buildGmailRawMessage({ payload: bad, identity, from: "hello@jefscouting.com" }), FailClosedError);
});

test("confirmed send maps provider id and performs exactly one transport call", async () => {
  let calls = 0;
  const provider = new GmailApiProvider({ from: "hello@jefscouting.com", transport: {
    async sendRaw() { calls++; return { id: "gmail-123" }; },
    async lookupByRfcMessageId() { throw new Error("not expected"); }
  }});
  assert.deepEqual(await provider.sendOnce({ payload, identity }), { confirmed: true, providerMessageId: "gmail-123", outcome: "SENT" });
  assert.equal(calls, 1);
});

test("definite pre-invocation failure remains distinguishable", async () => {
  const provider = new GmailApiProvider({ from: "hello@jefscouting.com", transport: {
    async sendRaw() { const e = new Error("socket never opened"); e.definitelyNotInvoked = true; throw e; },
    async lookupByRfcMessageId() { return null; }
  }});
  await assert.rejects(provider.sendOnce({ payload, identity }), PreInvocationProviderError);
});

test("uncertain send failure and missing ack id become ambiguous, never auto-retried", async () => {
  for (const sendRaw of [async () => { throw new Error("timeout"); }, async () => ({})]) {
    let calls = 0;
    const provider = new GmailApiProvider({ from: "hello@jefscouting.com", transport: {
      async sendRaw(args) { calls++; return sendRaw(args); },
      async lookupByRfcMessageId() { return null; }
    }});
    await assert.rejects(provider.sendOnce({ payload, identity }), AmbiguousProviderResult);
    assert.equal(calls, 1);
  }
});

test("lookup reconciles only by deterministic RFC Message-ID and never sends", async () => {
  let sends = 0; let lookups = 0;
  const provider = new GmailApiProvider({ from: "hello@jefscouting.com", transport: {
    async sendRaw() { sends++; return { id: "unexpected" }; },
    async lookupByRfcMessageId({ rfcMessageId }) { lookups++; assert.equal(rfcMessageId, identity.rfcMessageId); return { id: "gmail-123" }; }
  }});
  assert.deepEqual(await provider.lookup({ identity }), { confirmed: true, providerMessageId: "gmail-123", outcome: "SENT" });
  assert.equal(sends, 0); assert.equal(lookups, 1);
});
