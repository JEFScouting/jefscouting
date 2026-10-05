import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADAPTER_VERSION,
  evaluateDualRead,
  evaluateReconstructed,
} from "../eng-content-release/dual-read-adapter.mjs";

const base = {
  recordId: "rec-fixture",
  contentId: "QA-CONTENT-DUAL-READ",
  contentIdentityKey: "qa-content-dual-read|facebook",
  legacy: {
    contentPublishGate: "READY FOR PUBLISHING QUEUE",
    releaseRuntimeGate: "READY — INITIAL CONNECTOR INVOCATION",
    releaseRuntimeStatus: "Not Released",
    correctionGate: "PASS — CURRENT CONTENT",
  },
  reconstructed: {
    contentSafetyDecision: "Pass",
    contentTruthDecision: "Pass — Timeless / Not Applicable",
    qualityDecision: "PASS",
    authorityClass: "FAST — Weekly Delegation Eligible",
    authorityDecision: "AUTHORIZED — WEEKLY FAST DELEGATION",
    packageIntegrity: "FROZEN — CURRENT",
    publicationSafetyShadow: "READY",
    lifecycleState: "RELEASE",
    nextAction: "Execute governed release once.",
    actionOwner: "Content Release Engine",
  },
};

const run = (overrides = {}) => evaluateDualRead({
  ...base,
  ...overrides,
  legacy: { ...base.legacy, ...overrides.legacy },
  reconstructed: { ...base.reconstructed, ...overrides.reconstructed },
}, { executionId: "UAT-20260908", evaluatedAt: "2026-09-08T17:00:00.000Z" });

test("agreement: eligible FAST item is READY on both sides", () => {
  const result = run();
  assert.equal(result.adapterVersion, ADAPTER_VERSION);
  assert.equal(result.legacy.decision, "READY");
  assert.equal(result.reconstructed.decision, "READY");
  assert.match(result.divergenceClass, /^AGREEMENT_/);
});

test("CONTROLLED without explicit owner approval fails closed", () => {
  const result = run({ reconstructed: {
    authorityClass: "CONTROLLED — Owner Approval Required",
    authorityDecision: "BLOCKED — OWNER APPROVAL REQUIRED",
    publicationSafetyShadow: "BLOCKED — OWNER AUTHORITY",
  }});
  assert.equal(result.reconstructed.decision, "BLOCKED");
  assert.equal(result.reconstructed.control, "AUTHORITY");
});

test("privacy ambiguity blocks even if the shadow summary were accidentally READY", () => {
  const result = run({ reconstructed: { contentSafetyDecision: "Blocked — Privacy" }});
  assert.deepEqual([result.reconstructed.decision, result.reconstructed.control], ["BLOCKED", "CONTENT_SAFETY"]);
});

test("rights ambiguity blocks even if the shadow summary were accidentally READY", () => {
  const result = run({ reconstructed: { contentSafetyDecision: "Blocked — Rights" }});
  assert.deepEqual([result.reconstructed.decision, result.reconstructed.control], ["BLOCKED", "CONTENT_SAFETY"]);
});

test("stale currentness blocks", () => {
  const result = run({ reconstructed: { contentTruthDecision: "Blocked — Stale" }});
  assert.deepEqual([result.reconstructed.decision, result.reconstructed.control], ["BLOCKED", "CURRENTNESS"]);
});

test("material package change blocks", () => {
  const result = run({ reconstructed: { packageIntegrity: "BLOCKED — MATERIAL CHANGE" }});
  assert.deepEqual([result.reconstructed.decision, result.reconstructed.control], ["BLOCKED", "LIFECYCLE_CORRECTION"]);
});

test("superseded/correction lineage blocks", () => {
  const result = run({ legacy: { correctionGate: "BLOCKED — SUPERSEDED PREDECESSOR" }});
  assert.deepEqual([result.reconstructed.decision, result.reconstructed.control], ["BLOCKED", "LIFECYCLE_CORRECTION"]);
});

test("UNKNOWN is HOLD on both sides and never becomes READY", () => {
  const result = run({
    legacy: { releaseRuntimeStatus: "Publication Unknown", releaseRuntimeGate: "HOLD — RECONCILE BEFORE RETRY" },
    reconstructed: { publicationSafetyShadow: "HOLD — OUTCOME UNKNOWN" },
  });
  assert.equal(result.legacy.decision, "HOLD");
  assert.equal(result.reconstructed.decision, "HOLD");
  assert.match(result.divergenceClass, /^AGREEMENT_/);
});

test("UNKNOWN recovery is evaluated only after reconciled state is supplied", () => {
  const unknown = run({
    legacy: { releaseRuntimeStatus: "Publication Unknown", releaseRuntimeGate: "HOLD — RECONCILE BEFORE RETRY" },
    reconstructed: { publicationSafetyShadow: "HOLD — OUTCOME UNKNOWN" },
  });
  assert.equal(unknown.reconstructed.decision, "HOLD");

  const recovered = run({
    legacy: { releaseRuntimeStatus: "Not Released", releaseRuntimeGate: "READY — RECONCILED / INITIAL INVOCATION" },
    reconstructed: { publicationSafetyShadow: "READY" },
  });
  assert.equal(recovered.reconstructed.decision, "READY");
  assert.match(recovered.divergenceClass, /^AGREEMENT_/);
});

test("legacy compatibility block versus reconstructed READY is classified, not hidden", () => {
  const result = run({ legacy: { contentPublishGate: "BLOCKED — V1.2 PRODUCTION OR RELEASE REQUIREMENTS INCOMPLETE", releaseRuntimeGate: "BLOCKED — IDENTITY INPUTS" }});
  assert.equal(result.divergenceClass, "LEGACY_COMPATIBILITY_DIVERGENCE");
});

test("missing reconstructed decision fails closed", () => {
  const result = evaluateReconstructed({ legacy: {}, reconstructed: {} });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.control, "FAIL_CLOSED");
});

test("adapter emits an immutable zero-effect census", () => {
  const result = run();
  assert.deepEqual(result.effectProof, {
    providerBoundaryCrossed: false,
    providerInvocationCount: 0,
    publicationPerformed: false,
    canonicalBusinessStateMutated: false,
    productionAuthorityChanged: false,
    legacyControlChanged: false,
    productionCutoverPerformed: false,
  });
  assert.throws(() => { result.effectProof.publicationPerformed = true; });
});

test("execution identity is mandatory", () => {
  assert.throws(() => evaluateDualRead(base), /executionId is required/);
});

test("sanitized canonical-equivalent fixtures produce the expected bounded divergence census", () => {
  const snapshot = JSON.parse(readFileSync(
    new URL("./fixtures/content-release-sanitized-fixtures.json", import.meta.url),
    "utf8",
  ));
  const census = {};
  for (const record of snapshot) {
    const result = evaluateDualRead(record, {
      executionId: "UAT-CONTENT-DUAL-READ-20260908",
      evaluatedAt: "2026-09-08T17:00:00.000Z",
    });
    census[result.divergenceClass] = (census[result.divergenceClass] ?? 0) + 1;
    assert.equal(result.effectProof.providerInvocationCount, 0);
    assert.equal(result.effectProof.publicationPerformed, false);
  }
  assert.deepEqual(census, {
    LEGACY_COMPATIBILITY_DIVERGENCE: 2,
    SAFE_OUTCOME_DIVERGENCE: 1,
    AGREEMENT_OUTCOME_DIFFERENT_REASON: 4
  });
});
