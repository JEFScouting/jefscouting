import { createHash } from "node:crypto";

export class FailClosedError extends Error {}
export class AmbiguousProviderResult extends Error {}

const REQUIRED_PAYLOAD_FIELDS = ["campaignId", "leadId", "messageVersion", "sequenceStep", "destination", "subject", "textBody"];

function requireCanonicalPayload(payload, effectKey) {
  if (!payload || payload.contractVersion !== "outreach-v2" || payload.suppressionCleared !== true) {
    throw new FailClosedError("CANONICAL_SUPPRESSION_CLEARED_V2_PAYLOAD_REQUIRED");
  }
  if (REQUIRED_PAYLOAD_FIELDS.some((field) => typeof payload[field] !== "string" || payload[field].trim() === "")) {
    throw new FailClosedError("CANONICAL_PAYLOAD_INCOMPLETE");
  }
  const expected = ["OUTREACH-SEND", payload.campaignId, payload.leadId, payload.messageVersion, payload.sequenceStep].join("|");
  if (!effectKey || effectKey !== expected) throw new FailClosedError("EFFECT_KEY_MISMATCH");
}

function requireSafeControls(controls) {
  if (!controls?.adapterBuildEnabled || controls.campaign !== "ACTIVE" || controls.runtime !== "ACTIVE" || controls.circuit !== "ACTIVE" || controls.productionAuthority !== true) {
    throw new FailClosedError("PRODUCTION_CONTROLS_NO_GO");
  }
}

export function gmailCorrelationIdentity(effectKey) {
  const digest = createHash("sha256").update(`gmail\0${effectKey}`, "utf8").digest("hex");
  return { correlationId: `jef-outreach-v2-${digest}`, rfcMessageId: `<jef-outreach-v2-${digest}@outreach.invalid>` };
}

/**
 * Ports are deliberately injected. This module contains no Gmail SDK, credential
 * loading, network client, database client, or deployment entry point.
 */
export class GmailOutreachV2Adapter {
  constructor({ claimClient, safetyGate, attemptStore, gmailProvider, controls }) {
    if (!claimClient || !safetyGate || !attemptStore || !gmailProvider) throw new FailClosedError("ADAPTER_PORT_MISSING");
    this.claimClient = claimClient;
    this.safetyGate = safetyGate;
    this.attemptStore = attemptStore;
    this.gmailProvider = gmailProvider;
    this.controls = controls;
  }

  async execute({ payload, effectKey, claimantId, claimToken }) {
    requireCanonicalPayload(payload, effectKey);
    requireSafeControls(this.controls);
    if (!claimantId || !claimToken) throw new FailClosedError("CLAIM_IDENTITY_REQUIRED");

    const claim = await this.claimClient.claim({ payload, effectKey, claimantId, claimToken });
    if (claim?.result !== "WON" || claim.record?.effect_key !== effectKey || claim.record?.claim_token !== claimToken) {
      throw new FailClosedError("VALID_SLICE01_WIN_REQUIRED");
    }

    const safety = await this.safetyGate.revalidate({ payload, effectKey, claimToken });
    if (safety?.suppressionCleared !== true || safety?.responsePriorityClear !== true) {
      throw new FailClosedError("PRE_PROVIDER_SAFETY_REVALIDATION_FAILED");
    }

    const identity = gmailCorrelationIdentity(effectKey);
    const reservation = await this.attemptStore.reserve({ effectKey, claimToken, identity });
    if (reservation?.result !== "RESERVED" || reservation.providerInvocationCount !== 1) {
      throw new FailClosedError("PROVIDER_ATTEMPT_NOT_RESERVED");
    }

    try {
      const outcome = await this.gmailProvider.sendOnce({ payload, effectKey, claimToken, identity });
      if (!outcome?.confirmed || !outcome.providerMessageId) throw new AmbiguousProviderResult("GMAIL_ACK_AMBIGUOUS");
      await this.attemptStore.confirm({ effectKey, claimToken, identity, providerMessageId: outcome.providerMessageId, outcome: outcome.outcome ?? "SENT" });
      return { result: "CONFIRMED", identity, providerMessageId: outcome.providerMessageId };
    } catch (error) {
      if (!(error instanceof AmbiguousProviderResult) && error?.unambiguouslyNotSent === true) {
        await this.attemptStore.failNoRetry({ effectKey, claimToken, identity, reason: "CONFIRMED_NOT_SENT" });
        throw error;
      }
      await this.attemptStore.unknownHold({ effectKey, claimToken, identity, reason: "AMBIGUOUS_PROVIDER_ACK" });
      return { result: "UNKNOWN_HOLD", identity, automaticRetry: false };
    }
  }

  async reconcile({ effectKey, claimToken }) {
    if (!effectKey || !claimToken) throw new FailClosedError("RECONCILIATION_IDENTITY_REQUIRED");
    const stored = await this.attemptStore.readForReconciliation({ effectKey, claimToken });
    if (stored?.state !== "UNKNOWN_HOLD" || stored.providerInvocationCount !== 1 || !stored.identity) {
      throw new FailClosedError("STORED_UNKNOWN_PROVIDER_EVIDENCE_REQUIRED");
    }
    const evidence = await this.gmailProvider.lookup(stored.identity);
    if (!evidence?.confirmed || !evidence.providerMessageId) return { result: "UNKNOWN_HOLD", automaticRetry: false, resend: false };
    await this.attemptStore.confirm({ effectKey, claimToken, identity: stored.identity, providerMessageId: evidence.providerMessageId, outcome: "RECONCILED_SENT" });
    return { result: "RECONCILED", providerMessageId: evidence.providerMessageId, resend: false };
  }
}
