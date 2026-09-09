/**
 * ENG-CONTENT-RELEASE dual-read diagnostic adapter.
 *
 * This module is deliberately effect-free. It compares the currently
 * authoritative legacy decision surface with the reconstructed Publication
 * Safety surface. It cannot publish, call a provider, or mutate canonical
 * state. Production authority remains with the legacy release contract.
 */

export const ADAPTER_VERSION = "ENG-CONTENT-RELEASE-DUAL-READ-v0.1";

const text = (value) => {
  if (value == null) return "";
  if (typeof value === "object" && typeof value.name === "string") return value.name;
  return String(value).trim();
};

const upper = (value) => text(value).toUpperCase();
const includesAny = (value, terms) => terms.some((term) => upper(value).includes(term));

export function evaluateLegacy(record) {
  const publishGate = text(record.legacy?.contentPublishGate);
  const runtimeGate = text(record.legacy?.releaseRuntimeGate);
  const runtimeStatus = text(record.legacy?.releaseRuntimeStatus);
  const correctionGate = text(record.legacy?.correctionGate);

  if (includesAny(runtimeStatus, ["UNKNOWN", "IN PROGRESS"]) ||
      includesAny(runtimeGate, ["UNKNOWN", "HOLD", "IN PROGRESS", "UNPUBLISHED"])) {
    return { decision: "HOLD", reason: runtimeStatus || runtimeGate, authority: "LEGACY" };
  }

  if (includesAny(runtimeStatus, ["PUBLISHED — VERIFIED", "ALREADY PUBLISHED", "NO-OP"])) {
    return { decision: "NO_OP", reason: runtimeStatus, authority: "LEGACY" };
  }

  if (includesAny(correctionGate, ["BLOCKED", "FAIL"])) {
    return { decision: "BLOCKED", reason: correctionGate, authority: "LEGACY" };
  }

  if (includesAny(publishGate, ["NOT APPLICABLE"])) {
    return { decision: "NOT_APPLICABLE", reason: publishGate, authority: "LEGACY" };
  }

  if (includesAny(publishGate, ["READY FOR PUBLISHING", "PASS — READY", "READY —"])) {
    return { decision: "READY", reason: publishGate, authority: "LEGACY" };
  }

  return {
    decision: "BLOCKED",
    reason: publishGate || runtimeGate || "MISSING LEGACY DECISION",
    authority: "LEGACY",
  };
}

export function evaluateReconstructed(record) {
  const reconstructed = record.reconstructed ?? {};
  const runtimeStatus = text(record.legacy?.releaseRuntimeStatus);
  const safety = text(reconstructed.contentSafetyDecision);
  const truth = text(reconstructed.contentTruthDecision);
  const quality = text(reconstructed.qualityDecision);
  const authorityClass = text(reconstructed.authorityClass);
  const authority = text(reconstructed.authorityDecision);
  const packageIntegrity = text(reconstructed.packageIntegrity);
  const correctionGate = text(record.legacy?.correctionGate);
  const shadow = text(reconstructed.publicationSafetyShadow);

  if (includesAny(runtimeStatus, ["UNKNOWN", "IN PROGRESS"]) || includesAny(shadow, ["HOLD — OUTCOME UNKNOWN"])) {
    return { decision: "HOLD", reason: shadow || runtimeStatus, control: "UNKNOWN_RECONCILIATION" };
  }

  if (includesAny(correctionGate, ["BLOCKED", "FAIL"]) ||
      includesAny(packageIntegrity, ["MATERIAL CHANGE", "SUPERSEDED", "VERSION MISMATCH"])) {
    return { decision: "BLOCKED", reason: correctionGate || packageIntegrity, control: "LIFECYCLE_CORRECTION" };
  }

  if (includesAny(safety, ["PRIVACY", "RIGHTS", "PROHIBITED", "UNSAFE", "BLOCKED"])) {
    return { decision: "BLOCKED", reason: safety, control: "CONTENT_SAFETY" };
  }

  if (includesAny(truth, ["STALE", "UNVERIFIED", "UNKNOWN", "BLOCKED", "HOLD"])) {
    return { decision: "BLOCKED", reason: truth, control: "CURRENTNESS" };
  }

  if (includesAny(packageIntegrity, ["BLOCKED", "DRIFT", "MISSING"])) {
    return { decision: "BLOCKED", reason: packageIntegrity, control: "PACKAGE_INTEGRITY" };
  }

  if (quality && !includesAny(quality, ["PASS"])) {
    return { decision: "BLOCKED", reason: quality, control: "QUALITY" };
  }

  if (includesAny(authorityClass, ["AMBIGUOUS"])) {
    return { decision: "BLOCKED", reason: authorityClass, control: "AUTHORITY" };
  }

  if (includesAny(authorityClass, ["CONTROLLED"]) &&
      !includesAny(authority, ["AUTHORIZED — EXPLICIT OWNER APPROVAL"])) {
    return { decision: "BLOCKED", reason: authority || authorityClass, control: "AUTHORITY" };
  }

  if (includesAny(authorityClass, ["FAST"]) &&
      !includesAny(authority, ["AUTHORIZED — WEEKLY FAST DELEGATION"])) {
    return { decision: "BLOCKED", reason: authority || authorityClass, control: "AUTHORITY" };
  }

  if (includesAny(shadow, ["QA / TEST — OBSERVATION ONLY"])) {
    return { decision: "OBSERVATION_ONLY", reason: shadow, control: "SHADOW_BOUNDARY" };
  }

  if (includesAny(shadow, ["NOT APPLICABLE"])) {
    return { decision: "NOT_APPLICABLE", reason: shadow, control: "APPLICABILITY" };
  }

  if (includesAny(shadow, ["NOT REQUIRED YET"])) {
    return { decision: "PRE_RELEASE", reason: shadow, control: "LIFECYCLE" };
  }

  if (includesAny(shadow, ["BLOCKED"])) {
    return { decision: "BLOCKED", reason: shadow, control: "PUBLICATION_SAFETY" };
  }

  if (includesAny(shadow, ["READY"])) {
    return { decision: "READY", reason: shadow, control: "PUBLICATION_SAFETY" };
  }

  return { decision: "BLOCKED", reason: "MISSING RECONSTRUCTED DECISION", control: "FAIL_CLOSED" };
}

export function classifyDivergence(legacy, reconstructed) {
  if (reconstructed.decision === "OBSERVATION_ONLY") return "NOT_COMPARABLE_QA";
  if (legacy.decision === reconstructed.decision) {
    return legacy.reason === reconstructed.reason ? "AGREEMENT_EXACT" : "AGREEMENT_OUTCOME_DIFFERENT_REASON";
  }
  if (legacy.decision === "BLOCKED" && reconstructed.decision === "READY" &&
      includesAny(legacy.reason, ["V1.2", "REQUIREMENTS INCOMPLETE"])) {
    return "LEGACY_COMPATIBILITY_DIVERGENCE";
  }
  if (["BLOCKED", "HOLD"].includes(legacy.decision) &&
      ["BLOCKED", "HOLD"].includes(reconstructed.decision)) {
    return "SAFE_OUTCOME_DIVERGENCE";
  }
  if (["READY", "NO_OP"].includes(legacy.decision) &&
      ["BLOCKED", "HOLD"].includes(reconstructed.decision)) {
    return "RECONSTRUCTED_SAFETY_STRICTER";
  }
  return "SEMANTIC_DIVERGENCE";
}

export function evaluateDualRead(record, { executionId, evaluatedAt = new Date().toISOString() } = {}) {
  if (!executionId) throw new Error("executionId is required for auditable dual-read evidence");
  const legacy = evaluateLegacy(record);
  const reconstructed = evaluateReconstructed(record);

  const effectProof = Object.freeze({
    providerBoundaryCrossed: false,
    providerInvocationCount: 0,
    publicationPerformed: false,
    canonicalBusinessStateMutated: false,
    productionAuthorityChanged: false,
    legacyControlChanged: false,
    productionCutoverPerformed: false,
  });

  return Object.freeze({
    adapterVersion: ADAPTER_VERSION,
    executionId,
    evaluatedAt,
    recordId: record.recordId,
    contentId: record.contentId,
    contentIdentityKey: record.contentIdentityKey,
    legacy,
    reconstructed,
    divergenceClass: classifyDivergence(legacy, reconstructed),
    lifecycleState: text(record.reconstructed?.lifecycleState),
    nextAction: text(record.reconstructed?.nextAction),
    actionOwner: text(record.reconstructed?.actionOwner),
    effectProof,
  });
}
