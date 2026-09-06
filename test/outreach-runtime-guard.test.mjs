import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netlify/functions/slice01.mts", import.meta.url), "utf8");

test("runtime does not expose production mode", () => {
  assert.match(source, /new Set\(\["zero-send", "canary-send"\]\)/);
  assert.doesNotMatch(source, /new Set\(\[[^\]]*"production"/);
  assert.match(source, /RUNTIME_MODE_INVALID_PRODUCTION_UNSUPPORTED/);
});

test("direct SEND_PROVIDER cannot cross the provider boundary", () => {
  const branch = source.match(/if \(op === "SEND_PROVIDER"\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(branch, /CANONICAL_ADAPTER_REQUIRED/);
  assert.match(branch, /provider_send_called: false/);
  assert.match(branch, /provider_call_count: 0/);
  assert.doesNotMatch(branch, /gmailSend|processSelfCanarySend/);
});

test("only the self-canary path reaches Gmail send composition", () => {
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
