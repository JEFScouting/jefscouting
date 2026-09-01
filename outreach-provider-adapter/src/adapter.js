import { createHash } from "node:crypto";

export class FailClosedError extends Error {}
export class PreInvocationProviderError extends Error {}
export class AmbiguousProviderResult extends Error {}

const REQUIRED_PAYLOAD_FIELDS = [
  "campaignId",
  "leadId",
  "messageVersion",
  "sequenceStep",
  "destination",
  "subject",
  "textBody",
  "sequenceInstanceKey",
  "sequenceVersionSnapshot",
  "templateVersionSnapshot",
  "senderIdentitySnapshot",
  "verifiedRecipient",
  "finalSubjectSnapshot",
  "finalBodySnapshot",
  "priorContactSnapshot"
];

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function requireCanonicalPayload(payload, effectKey) {
  if (!payload || payload.contractVersion !== "outreach-v2" || payload.suppressionCleared !== true) {
    throw new FailClosedError("CANONICAL_SUPPRESSION_CLEARED_V2_PAYLOAD_REQUIRED");
  }
  if (REQUIRED_PAYLOAD_FIELDS.some((field) => !nonEmpty(payload[field]))) {
    throw new FailClosedError("CANONICAL_PAYLOAD_INCOMPLETE");
  }
  if (payload.priorContactSnapshot !== "CLEAR") throw new FailClosedError("PRIOR_CONTACT_NOT_CLEAR");
  if (payload.destination !== payload.verifiedRecipient) throw new FailClosedError("VERIFIED_RECIPIENT_MISMATCH");
  if (payload.subject !== payload.finalSubjectSnapshot) throw new FailClosedError("FINAL_SUBJECT_SNAPSHOT_MISMATCH");
  if (payload.textBody !== payload.finalBodySnapshot) throw new FailClosedError("FINAL_BODY_SNAPSHOT_MISMATCH");

  const expected = ["OUTREACH-SEND", payload.campaignId, payload.leadId, payload.messageVersion, payload.sequenceStep].join("|");
  if (!effectKey || effectKey !== expected) throw new FailClosedError("EFFECT_KEY_MISMATCH");
}

export function canonicalPayloadFingerprint(payload) {
  const exact = [
    payload.campaignId,
    payload.leadId,
    payload.messageVersion,
    payload.sequenceStep,
    payload.sequenceInstanceKey,
    payload.sequenceVersionSnapshot,
    payload.templateVersionSnapshot,
    payload.senderIdentitySnapshot,
    payload.verifiedRecipient,
    payload.finalSubjectSnapshot,
    payload.finalBodySnapshot,
    payload.priorContactSnapshot
  ];
  return createHash("sha256").update(JSON.stringify(exact), "utf8").digest("hex");
}

function requireSafeControls(controls) {
  if (!controls?.adapterBuildEnabled || controls.campaign !== "ACTIVE" || controls.runtime !== "ACTIVE" || controls.circuit !== "ACTIVE") {
    throw new FailClosedError("PRODUCTION_CONTROLS_NO_GO");
  }
}

function requireCanonicalExecutionBinding(binding, { payload, effectKey }) {
  if (!binding || binding.decision !== "AUTHORIZED") throw new FailClosedError("CANONICAL_EXECUTION_AUTHORITY_REQUIRED");
  if (!nonEmpty(binding.commandId) || !nonEmpty(binding.releaseId) || !nonEmpty(binding.authorityVersion)) {
    throw new FailClosedError("CANONICAL_AUTHORITY_IDENTITY_INCOMPLETE");
  }
  if (binding.effectKey !== effectKey) throw new FailClosedError("AUTHORITY_EFFECT_KEY_MISMATCH");
  if (binding.payloadFingerprint !== canonicalPayloadFingerprint(payload)) throw new FailClosedError("CANONICAL_PAYLOAD_FINGERPRINT_MISMATCH");
  if (!nonEmpty(binding.verifiedRecipient) || binding.verifiedRecipient !== payload.destination) throw new FailClosedError("AUTHORITY_RECIPIENT_MISMATCH");
  if (!nonEmpty(binding.senderIdentity) || binding.senderIdentity !== payload.senderIdentitySnapshot) throw new FailClosedError("AUTHORITY_SENDER_MISMATCH");
  if (!nonEmpty(binding.correlationDomain) || binding.correlationDomain.endsWith(".invalid") || binding.correlationDomain === "outreach.invalid") {
    throw new FailClosedError("APPROVED_CORRELATION_DOMAIN_REQUIRED");
  }
}

export function gmailCorrelationIdentity(effectKey, correlationDomain) {
  if (!nonEmpty(correlationDomain) || correlationDomain.endsWith(".invalid") || correlationDomain === "outreach.invalid") {
    throw new FailClosedError("APPROVED_CORRELATION_DOMAIN_REQUIRED");
  }
  const digest = createHash("sha256").update(`gmail\0${effectKey}`, "utf8").digest("hex");
  return { correlationId: `jef-outreach-v2-${digest}`, rfcMessageId: `<jef-outreach-v2-${digest}@${correlationDomain}>` };
}

/**
 * Ports are deliberately injected. This module contains no Gmail SDK, credential
 * loading, network client, database client, or deployment entry point.
 */
export class GmailOutreachV2Adapter {
  constructor({ claimClient, safetyGate, executionGate, attemptStore, gmailProvider, controls }) {
    if (!claimClient || !safetyGate || !executionGate || !attemptStore || !gmailProvider) throw new FailClosedError("ADAPTER_PORT_MISSING");
    this.claimClient = claimClient;
    this.safetyGate = safetyGate;
    this.executionGate = executionGate;
    this.attemptStore = attemptStore;
    this.gmailProvider = gmailProvider;
    this.controls = controls;
  }

  async execute({ payload, effectKey, claimantId, claimToken }) {
    requireCanonicalPayload(payload, effectKey);
    requireSafeControls(this.controls);
    if (!claimantId || !claimToken) throw new FailClosedError("CLAIM_IDENTITY_REQUIRED");

    const binding = await this.executionGate.readCurrent({ payload, effectKey, claimToken });
    requireCanonicalExecutionBinding(binding, { payload, effectKey });

    const claim = await this.claimClient.claim({ payload, effectKey, claimantId, claimToken, payloadFingerprint: binding.payloadFingerprint });
    if (claim?.result !== "WON" || claim.record?.effect_key !== effectKey || claim.record?.claim_token !== claimToken) {
      throw new FailClosedError("VALID_SLICE01_WIN_REQUIRED");
    }

    const safety = await this.safetyGate.revalidate({ payload, effectKey, claimToken, payloadFingerprint: binding.payloadFingerprint });
    if (safety?.suppressionCleared !== true || safety?.responsePriorityClear !== true) {
      throw new FailClosedError("PRE_PROVIDER_SAFETY_REVALIDATION_FAILED");
    }

    const identity = gmailCorrelationIdentity(effectKey, binding.correlationDomain);
    const reservation = await this.attemptStore.reserve({ effectKey, claimToken, identity, payloadFingerprint: binding.payloadFingerprint });
    if (reservation?.result !== "RESERVED" || reservation.providerInvocationCount !== 1) {
      throw new FailClosedError("PROVIDER_ATTEMPT_NOT_RESERVED");
    }

    try {
      const outcome = await this.gmailProvider.sendOnce({ payload, effectKey, claimToken, identity, payloadFingerprint: binding.payloadFingerprint });
      if (!outcome?.confirmed || !outcome.providerMessageId) throw new AmbiguousProviderResult("GMAIL_ACK_AMBIGUOUS");
      await this.attemptStore.confirm({ effectKey, claimToken, identity, payloadFingerprint: binding.payloadFingerprint, providerMessageId: outcome.providerMessageId, outcome: outcome.outcome ?? "SENT" });
      return { result: "CONFIRMED", identity, providerMessageId: outcome.providerMessageId };
    } catch (error) {
      if (error instanceof PreInvocationProviderError) {
        await this.attemptStore.failNoRetry({ effectKey, claimToken, identity, payloadFingerprint: binding.payloadFingerprint, reason: "CONFIRMED_NOT_SENT_PRE_INVOCATION" });
        throw error;
      }
      const reason = error instanceof AmbiguousProviderResult ? "AMBIGUOUS_PROVIDER_ACK" : "UNCLASSIFIED_PROVIDER_ERROR_AFTER_BOUNDARY";
      await this.attemptStore.unknownHold({ effectKey, claimToken, identity, payloadFingerprint: binding.payloadFingerprint, reason });
      return { result: "UNKNOWN_HOLD", identity, automaticRetry: false, classification: reason };
    }
  }

  async reconcile({ effectKey, claimToken }) {
    if (!effectKey || !claimToken) throw new FailClosedError("RECONCILIATION_IDENTITY_REQUIRED");
    const stored = await this.attemptStore.readForReconciliation({ effectKey, claimToken });
    if (stored?.state !== "UNKNOWN_HOLD" || stored.providerInvocationCount !== 1 || !stored.identity || !stored.payloadFingerprint) {
      throw new FailClosedError("STORED_UNKNOWN_PROVIDER_EVIDENCE_REQUIRED");
    }
    const evidence = await this.gmailProvider.lookup(stored.identity);
    if (!evidence?.confirmed || !evidence.providerMessageId) return { result: "UNKNOWN_HOLD", automaticRetry: false, resend: false };
    await this.attemptStore.confirm({ effectKey, claimToken, identity: stored.identity, payloadFingerprint: stored.payloadFingerprint, providerMessageId: evidence.providerMessageId, outcome: "RECONCILED_SENT" });
    return { result: "RECONCILED", providerMessageId: evidence.providerMessageId, resend: false };
  }
}
