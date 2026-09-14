import { FailClosedError, canonicalPayloadFingerprint } from "../../outreach-provider-adapter/src/adapter.js";
import { AirtableOutreachGates, AirtableReadOnlyClient, JEF_AIRTABLE } from "../../outreach-provider-adapter/src/airtable-gates.js";

const VERSION = "JEF-OUTREACH-AIRTABLE-DIAGNOSTIC-v1.0.0";
const PINNED_COMMAND_RECORD_ID = "recpYdDfwJjrpUwyX";
const PINNED_CAMPAIGN_RECORD_ID = "reclIlbWpaTcMrc18";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isEffectKey(value: string) {
  return /^OUTREACH-SEND\|[^|]+\|[^|]+\|[^|]+\|[^|]+$/.test(value);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST_ONLY", version: VERSION });
  }

  const sharedSecret = Netlify.env.get("OUTREACH_RUNTIME_SHARED_SECRET") || "";
  const presentedSecret = req.headers.get("x-outreach-runtime-secret") || "";
  const authorized = Boolean(sharedSecret && presentedSecret && await secureEqual(sharedSecret, presentedSecret));
  if (!authorized) {
    return json(401, { ok: false, error: "UNAUTHORIZED", version: VERSION });
  }

  const runtimeMode = String(Netlify.env.get("OUTREACH_RUNTIME_MODE") || "zero-send");
  const sendEnabled = String(Netlify.env.get("OUTREACH_SEND_ENABLED") || "false").toLowerCase() === "true";
  if (runtimeMode !== "zero-send" || sendEnabled) {
    return json(409, {
      ok: false,
      error: "DIAGNOSTIC_REQUIRES_ZERO_SEND",
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
      version: VERSION,
    });
  }

  const token = Netlify.env.get("AIRTABLE_READONLY_TOKEN") || "";
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID") || "";
  const commandRecordId = Netlify.env.get("OUTREACH_AIRTABLE_COMMAND_RECORD_ID") || "";
  const campaignRecordId = Netlify.env.get("OUTREACH_AIRTABLE_CAMPAIGN_RECORD_ID") || "";
  const correlationDomain = Netlify.env.get("OUTREACH_CORRELATION_DOMAIN") || "";

  if (baseId !== JEF_AIRTABLE.baseId || commandRecordId !== PINNED_COMMAND_RECORD_ID || campaignRecordId !== PINNED_CAMPAIGN_RECORD_ID) {
    return json(409, {
      ok: false,
      error: "PINNED_CANONICAL_AIRTABLE_AUTHORITY_REQUIRED",
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
      version: VERSION,
    });
  }

  const args: any = await req.json().catch(() => ({}));
  const payload = args?.payload;
  const effectKey = String(args?.effect_key || "").trim();
  if (!payload || typeof payload !== "object" || !isEffectKey(effectKey)) {
    return json(400, {
      ok: false,
      error: "DIAGNOSTIC_INPUT_INVALID",
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
      version: VERSION,
    });
  }

  try {
    const client = new AirtableReadOnlyClient({ token, baseId });
    const gates = new AirtableOutreachGates({ client, commandRecordId, campaignRecordId, correlationDomain });
    const payloadFingerprint = canonicalPayloadFingerprint(payload);
    const current = await gates.readCurrent({ payload, effectKey });
    const safety = await gates.revalidate({ payload, effectKey, payloadFingerprint });

    return json(200, {
      ok: true,
      result: "AIRTABLE_GATES_READ",
      execution_decision: current.decision,
      authority_version: current.authorityVersion,
      controls: current.controls,
      suppression_cleared: safety.suppressionCleared,
      response_priority_clear: safety.responsePriorityClear,
      provider_boundary_crossed: false,
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
      automatic_retry: false,
      version: VERSION,
    });
  } catch (error: any) {
    const status = error instanceof FailClosedError ? 409 : 502;
    return json(status, {
      ok: false,
      error: String(error?.message || "AIRTABLE_GATE_DIAGNOSTIC_FAILED"),
      provider_boundary_crossed: false,
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
      automatic_retry: false,
      version: VERSION,
    });
  }
};
