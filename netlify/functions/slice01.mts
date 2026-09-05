import { neon } from "@neondatabase/serverless";

const VERSION = "JEF-OUTREACH-RUNTIME-v1.1.3-gmail-send-gated";
const EFFECT_PREFIX = "OUTREACH-SEND";
const REQUIRED_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

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

async function digestHex(value: string) {
  const bytes = await digest(value);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEffectKey(value: string) {
  return /^OUTREACH-SEND\|[^|]+\|[^|]+\|[^|]+\|[^|]+$/.test(value);
}

function normalizeRfcMessageId(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1);
  return trimmed;
}

function messageIdHeader(value: string) {
  const normalized = normalizeRfcMessageId(value);
  return normalized ? `<${normalized}>` : "";
}

function parseScopes(value: string) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasRequiredScopes(scopes: string[]) {
  return REQUIRED_GMAIL_SCOPES.every((scope) => scopes.includes(scope));
}

function b64url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function mimeMessage({ sender, destination, subject, body, rfcMessageId }: { sender: string; destination: string; subject: string; body: string; rfcMessageId: string }) {
  const clean = (v: string) => String(v || "").replace(/[\r\n]/g, " ").trim();
  const safeSender = clean(sender);
  const safeDestination = clean(destination);
  const safeSubject = clean(subject);
  const id = messageIdHeader(rfcMessageId);
  if (!safeSender || !safeDestination || !safeSubject || !id) throw new Error("MIME_IDENTITY_REQUIRED");
  return [
    `From: ${safeSender}`,
    `To: ${safeDestination}`,
    `Subject: ${safeSubject}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    String(body || ""),
  ].join("\r\n");
}

async function oauthAccessToken() {
  const clientId = Netlify.env.get("GMAIL_OAUTH_CLIENT_ID") || "";
  const clientSecret = Netlify.env.get("GMAIL_OAUTH_CLIENT_SECRET") || "";
  const refreshToken = Netlify.env.get("GMAIL_OAUTH_REFRESH_TOKEN") || "";
  const sender = Netlify.env.get("GMAIL_SENDER_EMAIL") || "";
  const configuredScopes = parseScopes(Netlify.env.get("GMAIL_OAUTH_SCOPES") || "");
  if (!clientId || !clientSecret || !refreshToken || !sender) throw new Error("GMAIL_BINDING_INCOMPLETE");
  if (!hasRequiredScopes(configuredScopes)) throw new Error("GMAIL_SCOPES_INCOMPLETE");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const token: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !token?.access_token) throw new Error(`OAUTH_REFRESH_FAILED_${resp.status}`);
  const grantedScopes = parseScopes(token.scope || "");
  if (grantedScopes.length && !hasRequiredScopes(grantedScopes)) throw new Error("OAUTH_GRANTED_SCOPES_INCOMPLETE");
  return { accessToken: token.access_token as string, sender, configuredScopes, grantedScopes };
}

async function gmailProfile(accessToken: string) {
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const profile: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !profile?.emailAddress) throw new Error(`GMAIL_PROFILE_FAILED_${resp.status}`);
  return profile;
}

async function gmailLookup(accessToken: string, rfcMessageId: string) {
  const normalized = normalizeRfcMessageId(rfcMessageId);
  if (!normalized) throw new Error("RFC_MESSAGE_ID_REQUIRED");
  const q = `rfc822msgid:${normalized}`;
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "1");
  const resp = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`GMAIL_LOOKUP_FAILED_${resp.status}`);
  return { found: Array.isArray(data.messages) && data.messages.length > 0, messageId: data.messages?.[0]?.id || null };
}

async function gmailSend(accessToken: string, payload: { sender: string; destination: string; subject: string; body: string; rfcMessageId: string }) {
  const raw = b64url(mimeMessage(payload));
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data: any = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, messageId: data?.id || null, threadId: data?.threadId || null };
}

async function insertEvent(sql: any, input: { effectKey: string; operation: string; result: string; claimToken: string; claimantId: string; providerInvocationCount: number; metadata?: unknown }) {
  await sql`
    INSERT INTO outreach_effect_events (
      event_id, effect_key, operation, result, claim_token, claimant_id,
      provider_invocation_count, metadata, occurred_at
    ) VALUES (
      ${crypto.randomUUID()}::uuid, ${input.effectKey}, ${input.operation}, ${input.result},
      ${input.claimToken}::uuid, ${input.claimantId}, ${input.providerInvocationCount},
      ${JSON.stringify(input.metadata || {})}::jsonb, NOW()
    )
  `;
}

async function processSend(sql: any, args: any, runtimeMode: string, sendEnabled: boolean) {
  if (runtimeMode === "zero-send" || !sendEnabled) return json(409, { ok: false, error: "SEND_DISABLED", version: VERSION });
  const effectKey = String(args.effect_key || "").trim();
  const claimToken = String(args.claim_token || "").trim();
  const claimantId = String(args.claimant_id || "").trim();
  const subject = String(args.subject || "");
  const body = String(args.body || "");
  const rfcMessageId = normalizeRfcMessageId(String(args.rfc_message_id || ""));
  if (!isEffectKey(effectKey) || !isUuid(claimToken) || !claimantId || !subject || !body || !rfcMessageId) {
    return json(400, { ok: false, error: "SEND_INPUT_INVALID", version: VERSION });
  }

  const rows = await sql`
    SELECT effect_key, claim_token::text AS claim_token, claimant_id, destination, state,
           provider_invocation_count, provider_payload_fingerprint, provider_correlation_id,
           provider_rfc_message_id, provider_message_id
      FROM outreach_effects WHERE effect_key = ${effectKey} LIMIT 1
  `;
  const row: any = rows[0];
  if (!row) return json(404, { ok: false, error: "EFFECT_NOT_FOUND", version: VERSION });
  if (row.claim_token !== claimToken || row.claimant_id !== claimantId) return json(409, { ok: false, error: "CLAIM_MISMATCH", version: VERSION });
  if (row.state !== "CLAIMED" || Number(row.provider_invocation_count) !== 1 || row.provider_message_id) {
    return json(409, { ok: false, error: "SEND_NOT_ELIGIBLE", state: row.state, provider_invocation_count: Number(row.provider_invocation_count), automatic_retry: false, version: VERSION });
  }

  const auth = await oauthAccessToken();
  const profile = await gmailProfile(auth.accessToken);
  if (String(profile.emailAddress).toLowerCase() !== String(auth.sender).toLowerCase()) throw new Error("GMAIL_SENDER_IDENTITY_MISMATCH");
  if (runtimeMode === "canary-send" && String(row.destination).toLowerCase() !== String(auth.sender).toLowerCase()) {
    return json(409, { ok: false, error: "CANARY_DESTINATION_MUST_EQUAL_SENDER", automatic_retry: false, version: VERSION });
  }
  const payloadFingerprint = await digestHex([auth.sender, row.destination, subject, body, rfcMessageId].join("\n"));
  if (!row.provider_payload_fingerprint || row.provider_payload_fingerprint !== payloadFingerprint || normalizeRfcMessageId(row.provider_rfc_message_id) !== rfcMessageId) {
    return json(409, { ok: false, error: "PAYLOAD_FINGERPRINT_MISMATCH", automatic_retry: false, version: VERSION });
  }

  const started = await sql`
    UPDATE outreach_effects SET state = 'INVOCATION_STARTED', updated_at = NOW()
     WHERE effect_key = ${effectKey} AND claim_token = ${claimToken}::uuid
       AND claimant_id = ${claimantId} AND state = 'CLAIMED'
       AND provider_invocation_count = 1 AND provider_message_id IS NULL
     RETURNING effect_key
  `;
  if (!started[0]) return json(409, { ok: false, error: "INVOCATION_FENCE_LOST", automatic_retry: false, version: VERSION });

  let provider: any;
  try {
    provider = await gmailSend(auth.accessToken, { sender: auth.sender, destination: row.destination, subject, body, rfcMessageId });
  } catch {
    await sql`UPDATE outreach_effects SET state='UNKNOWN_HOLD', updated_at=NOW() WHERE effect_key=${effectKey}`;
    await insertEvent(sql, { effectKey, operation: "SEND_PROVIDER", result: "UNKNOWN_HOLD", claimToken, claimantId, providerInvocationCount: 1, metadata: { reason: "network_or_transport_exception", automatic_retry: false } });
    return json(502, { ok: false, result: "UNKNOWN_HOLD", provider_send_called: true, provider_call_count: 1, automatic_retry: false, version: VERSION });
  }

  if (!provider.ok || !provider.messageId) {
    await sql`UPDATE outreach_effects SET state='UNKNOWN_HOLD', updated_at=NOW() WHERE effect_key=${effectKey}`;
    await insertEvent(sql, { effectKey, operation: "SEND_PROVIDER", result: "UNKNOWN_HOLD", claimToken, claimantId, providerInvocationCount: 1, metadata: { provider_status: provider.status, provider_message_id_present: Boolean(provider.messageId), automatic_retry: false } });
    return json(502, { ok: false, result: "UNKNOWN_HOLD", provider_status: provider.status, provider_send_called: true, provider_call_count: 1, automatic_retry: false, version: VERSION });
  }

  await sql`
    UPDATE outreach_effects SET state='ACCEPTED', provider_message_id=${provider.messageId}, updated_at=NOW()
     WHERE effect_key=${effectKey} AND state='INVOCATION_STARTED'
  `;
  await insertEvent(sql, { effectKey, operation: "SEND_PROVIDER", result: "ACCEPTED", claimToken, claimantId, providerInvocationCount: 1, metadata: { provider_message_id: provider.messageId, provider_thread_id: provider.threadId, automatic_retry: false } });
  return json(200, { ok: true, result: "GMAIL_ACCEPTED", provider_message_id: provider.messageId, provider_thread_id: provider.threadId, rfc_message_id: messageIdHeader(rfcMessageId), provider_send_called: true, provider_call_count: 1, automatic_retry: false, version: VERSION });
}

export default async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST_ONLY", version: VERSION });

  const sharedSecret = Netlify.env.get("OUTREACH_RUNTIME_SHARED_SECRET") || "";
  const canarySecret = Netlify.env.get("OUTREACH_CANARY_SECRET") || "";
  const presented = req.headers.get("x-outreach-runtime-secret") || "";
  const canaryPresented = req.headers.get("x-outreach-canary-secret") || "";
  const sharedAuthorized = Boolean(sharedSecret && presented && await secureEqual(sharedSecret, presented));
  const canaryAuthorized = Boolean(canarySecret && canaryPresented && await secureEqual(canarySecret, canaryPresented));

  const databaseUrl = Netlify.env.get("DATABASE_URL") || "";
  const runtimeMode = String(Netlify.env.get("OUTREACH_RUNTIME_MODE") || "zero-send");
  const sendEnabled = String(Netlify.env.get("OUTREACH_SEND_ENABLED") || "false").toLowerCase() === "true";
  if (!databaseUrl) return json(503, { ok: false, error: "DATABASE_URL_REQUIRED", version: VERSION });
  if (!new Set(["zero-send", "canary-send", "production"]).has(runtimeMode)) return json(503, { ok: false, error: "RUNTIME_MODE_INVALID", version: VERSION });
  if (runtimeMode === "zero-send" && sendEnabled) return json(503, { ok: false, error: "ZERO_SEND_REQUIRES_SEND_DISABLED", version: VERSION });
  if (runtimeMode !== "zero-send" && !sendEnabled) return json(503, { ok: false, error: "SEND_MODE_REQUIRES_SEND_ENABLED", version: VERSION });

  const args: any = await req.json().catch(() => ({}));
  const op = String(args.op || "").toUpperCase();
  if (op === "SELF_CANARY_SEND") {
    if (!canaryAuthorized && !sharedAuthorized) return json(401, { ok: false, error: "UNAUTHORIZED", version: VERSION });
  } else if (!sharedAuthorized) {
    return json(401, { ok: false, error: "UNAUTHORIZED", version: VERSION });
  }

  const sql = neon(databaseUrl);

  if (op === "HEALTH") {
    const rows = await sql`SELECT COUNT(*)::int AS effect_count FROM outreach_effects`;
    return json(200, {
      ok: true,
      result: runtimeMode === "zero-send" ? "HEALTHY_ZERO_SEND" : "HEALTHY_SEND_GATED",
      version: VERSION,
      runtime_mode: runtimeMode,
      send_enabled: sendEnabled,
      provider_adapter: runtimeMode === "zero-send" ? "LOOKUP_ONLY_DIAGNOSTIC" : "GMAIL_SEND_GATED",
      provider_invocation_budget: runtimeMode === "zero-send" ? 0 : 1,
      database_reachable: true,
      effect_count: rows[0]?.effect_count ?? null,
      gmail_binding_present: Boolean(Netlify.env.get("GMAIL_OAUTH_CLIENT_ID") && Netlify.env.get("GMAIL_OAUTH_CLIENT_SECRET") && Netlify.env.get("GMAIL_OAUTH_REFRESH_TOKEN") && Netlify.env.get("GMAIL_SENDER_EMAIL")),
      canary_route_enabled: Boolean(canarySecret),
    });
  }

  if (op === "GMAIL_LOOKUP_DIAGNOSTIC") {
    const rfcMessageId = normalizeRfcMessageId(String(args.rfc_message_id || ""));
    if (!rfcMessageId) return json(400, { ok: false, error: "RFC_MESSAGE_ID_REQUIRED", version: VERSION });
    try {
      const auth = await oauthAccessToken();
      const profile = await gmailProfile(auth.accessToken);
      if (String(profile.emailAddress).toLowerCase() !== String(auth.sender).toLowerCase()) throw new Error("GMAIL_SENDER_IDENTITY_MISMATCH");
      const lookup = await gmailLookup(auth.accessToken, rfcMessageId);
      return json(200, {
        ok: true,
        result: lookup.found ? "RFC_MESSAGE_ID_FOUND" : "RFC_MESSAGE_ID_ABSENT",
        version: VERSION,
        runtime_mode: runtimeMode,
        send_enabled: sendEnabled,
        mailbox: profile.emailAddress,
        configured_scopes: auth.configuredScopes,
        granted_scopes: auth.grantedScopes,
        lookup: { type: "RFC_MESSAGE_ID", found: lookup.found, provider_message_id: lookup.messageId },
        provider_boundary_crossed: false,
        provider_send_called: false,
        provider_call_count: 0,
        automatic_retry: false,
      });
    } catch (error: any) {
      return json(502, { ok: false, error: String(error?.message || "GMAIL_DIAGNOSTIC_FAILED"), version: VERSION, provider_send_called: false, provider_call_count: 0, automatic_retry: false });
    }
  }

  if (op === "CLAIM") {
    const effectKey = String(args.effect_key || "").trim();
    const claimToken = String(args.claim_token || "").trim();
    const claimantId = String(args.claimant_id || "").trim();
    const campaignId = String(args.campaign_id || "").trim();
    const leadId = String(args.lead_id || "").trim();
    const destination = String(args.destination || "").trim();
    const messageVersion = String(args.message_version || "").trim();
    const sequenceStep = String(args.sequence_step || "").trim();
    if (!isEffectKey(effectKey) || !isUuid(claimToken) || !claimantId || !campaignId || !leadId || !destination || !messageVersion || !sequenceStep) {
      return json(400, { ok: false, error: "CLAIM_INPUT_INVALID", version: VERSION });
    }
    const inserted = await sql`
      INSERT INTO outreach_effects (
        effect_key, claim_token, claimant_id, claimed_at, campaign_id, lead_id, destination,
        message_version, sequence_step, state, runtime_mode, provider_invocation_count, updated_at
      ) VALUES (
        ${effectKey}, ${claimToken}::uuid, ${claimantId}, NOW(), ${campaignId}, ${leadId}, ${destination},
        ${messageVersion}, ${sequenceStep}, 'CLAIMED', ${runtimeMode}, 0, NOW()
      ) ON CONFLICT (effect_key) DO NOTHING RETURNING effect_key
    `;
    const won = Boolean(inserted[0]);
    await insertEvent(sql, { effectKey, operation: "CLAIM", result: won ? "WON" : "EXISTS_HOLD", claimToken, claimantId, providerInvocationCount: 0 });
    return json(200, { ok: true, result: won ? "WON" : "EXISTS_HOLD", state: won ? "CLAIMED" : "EXISTS_HOLD", provider_boundary_crossed: false, provider_send_called: false, provider_call_count: 0, automatic_retry: false, version: VERSION });
  }

  if (op === "RESERVE_PROVIDER_ATTEMPT") {
    const effectKey = String(args.effect_key || "").trim();
    const claimToken = String(args.claim_token || "").trim();
    const claimantId = String(args.claimant_id || "").trim();
    const payloadFingerprint = String(args.payload_fingerprint || "").trim();
    const correlationId = String(args.correlation_id || "").trim();
    const rfcMessageId = normalizeRfcMessageId(String(args.rfc_message_id || ""));
    if (!isEffectKey(effectKey) || !isUuid(claimToken) || !claimantId || !payloadFingerprint || !correlationId || !rfcMessageId) {
      return json(400, { ok: false, error: "RESERVATION_INPUT_INVALID", version: VERSION });
    }
    const reserved = await sql`
      UPDATE outreach_effects
         SET provider_invocation_count = 1,
             provider_payload_fingerprint = ${payloadFingerprint},
             provider_correlation_id = ${correlationId},
             provider_rfc_message_id = ${rfcMessageId},
             provider_attempt_reserved_at = NOW(), updated_at = NOW()
       WHERE effect_key = ${effectKey} AND claim_token = ${claimToken}::uuid
         AND claimant_id = ${claimantId} AND provider_invocation_count = 0 AND state = 'CLAIMED'
       RETURNING effect_key
    `;
    const result = reserved[0] ? "RESERVED" : "EXISTS_HOLD";
    await insertEvent(sql, { effectKey, operation: "RESERVE_PROVIDER_ATTEMPT", result, claimToken, claimantId, providerInvocationCount: reserved[0] ? 1 : 0, metadata: { correlation_id: correlationId, rfc_message_id: rfcMessageId } });
    return json(200, { ok: true, result, provider_invocation_count: reserved[0] ? 1 : null, provider_boundary_crossed: false, provider_send_called: false, provider_call_count: 0, automatic_retry: false, version: VERSION });
  }

  if (op === "SEND_PROVIDER") {
    return processSend(sql, args, runtimeMode, sendEnabled);
  }

  if (op === "SELF_CANARY_SEND") {
    if (runtimeMode !== "canary-send" || !sendEnabled) return json(409, { ok: false, error: "CANARY_MODE_REQUIRED", version: VERSION });
    const canaryId = String(args.canary_id || crypto.randomUUID()).replace(/[^A-Za-z0-9-]/g, "").slice(0, 48) || crypto.randomUUID();
    const auth = await oauthAccessToken();
    const profile = await gmailProfile(auth.accessToken);
    if (String(profile.emailAddress).toLowerCase() !== String(auth.sender).toLowerCase()) throw new Error("GMAIL_SENDER_IDENTITY_MISMATCH");
    const claimToken = crypto.randomUUID();
    const claimantId = `self-canary-${canaryId}`;
    const effectKey = `${EFFECT_PREFIX}|SELF-CANARY|${canaryId}|v1.1.3|CANARY`;
    const subject = `[JEF OUTREACH CANARY] ${canaryId}`;
    const body = "JEF Outreach controlled self-canary. This message is sent only to the JEF sender mailbox to verify the production Gmail transport boundary. No prospect, client, candidate, or worker is contacted.";
    const rfcMessageId = `jef-outreach-canary-${canaryId}@jefscouting.com`;
    const fingerprint = await digestHex([auth.sender, auth.sender, subject, body, rfcMessageId].join("\n"));
    const claimed = await sql`
      INSERT INTO outreach_effects (
        effect_key, claim_token, claimant_id, claimed_at, campaign_id, lead_id, destination,
        message_version, sequence_step, state, runtime_mode, provider_invocation_count, updated_at
      ) VALUES (
        ${effectKey}, ${claimToken}::uuid, ${claimantId}, NOW(), 'SELF-CANARY', 'SELF-CANARY', ${auth.sender},
        'v1.1.3', 'CANARY', 'CLAIMED', ${runtimeMode}, 0, NOW()
      ) ON CONFLICT (effect_key) DO NOTHING RETURNING effect_key
    `;
    if (!claimed[0]) return json(409, { ok: false, result: "EXISTS_HOLD", effect_key: effectKey, automatic_retry: false, version: VERSION });
    await insertEvent(sql, { effectKey, operation: "CLAIM", result: "WON", claimToken, claimantId, providerInvocationCount: 0, metadata: { self_canary: true } });
    const reserved = await sql`
      UPDATE outreach_effects SET provider_invocation_count=1,
        provider_payload_fingerprint=${fingerprint}, provider_correlation_id=${canaryId},
        provider_rfc_message_id=${rfcMessageId}, provider_attempt_reserved_at=NOW(), updated_at=NOW()
       WHERE effect_key=${effectKey} AND claim_token=${claimToken}::uuid AND state='CLAIMED' AND provider_invocation_count=0
       RETURNING effect_key
    `;
    if (!reserved[0]) return json(409, { ok: false, result: "RESERVATION_HOLD", effect_key: effectKey, automatic_retry: false, version: VERSION });
    await insertEvent(sql, { effectKey, operation: "RESERVE_PROVIDER_ATTEMPT", result: "RESERVED", claimToken, claimantId, providerInvocationCount: 1, metadata: { self_canary: true, correlation_id: canaryId, rfc_message_id: rfcMessageId } });
    return processSend(sql, { effect_key: effectKey, claim_token: claimToken, claimant_id: claimantId, subject, body, rfc_message_id: rfcMessageId }, runtimeMode, sendEnabled);
  }

  if (op === "RECONCILE") {
    const effectKey = String(args.effect_key || "").trim();
    if (!isEffectKey(effectKey)) return json(400, { ok: false, error: "EFFECT_KEY_REQUIRED", version: VERSION });
    const rows = await sql`SELECT * FROM outreach_effects WHERE effect_key=${effectKey} LIMIT 1`;
    const row: any = rows[0];
    if (!row) return json(404, { ok: false, error: "EFFECT_NOT_FOUND", version: VERSION });
    if (Number(row.provider_invocation_count) === 0) {
      await sql`UPDATE outreach_effects SET state='RECONCILED', updated_at=NOW() WHERE effect_key=${effectKey}`;
      await insertEvent(sql, { effectKey, operation: "RECONCILE", result: "CLOSED_NO_PROVIDER_EFFECT", claimToken: row.claim_token, claimantId: row.claimant_id, providerInvocationCount: 0 });
      return json(200, { ok: true, result: "CLOSED_NO_PROVIDER_EFFECT", provider_call_count: 0, automatic_retry: false, version: VERSION });
    }
    if (!row.provider_rfc_message_id) return json(409, { ok: false, result: "UNKNOWN_HOLD", reason: "RFC_MESSAGE_ID_MISSING", automatic_retry: false, version: VERSION });
    try {
      const auth = await oauthAccessToken();
      const profile = await gmailProfile(auth.accessToken);
      if (String(profile.emailAddress).toLowerCase() !== String(auth.sender).toLowerCase()) throw new Error("GMAIL_SENDER_IDENTITY_MISMATCH");
      const lookup = await gmailLookup(auth.accessToken, row.provider_rfc_message_id);
      if (!lookup.found) {
        await sql`UPDATE outreach_effects SET state='UNKNOWN_HOLD', updated_at=NOW() WHERE effect_key=${effectKey}`;
        await insertEvent(sql, { effectKey, operation: "RECONCILE", result: "ABSENT_HOLD_NO_RETRY", claimToken: row.claim_token, claimantId: row.claimant_id, providerInvocationCount: 1, metadata: { rfc_message_id: normalizeRfcMessageId(row.provider_rfc_message_id), automatic_retry: false } });
        return json(200, { ok: true, result: "ABSENT_HOLD_NO_RETRY", lookup_found: false, automatic_retry: false, version: VERSION });
      }
      await sql`UPDATE outreach_effects SET state='RECONCILED', provider_message_id=COALESCE(provider_message_id, ${lookup.messageId}), updated_at=NOW() WHERE effect_key=${effectKey}`;
      await insertEvent(sql, { effectKey, operation: "RECONCILE", result: "RECONCILED_FOUND", claimToken: row.claim_token, claimantId: row.claimant_id, providerInvocationCount: 1, metadata: { provider_message_id: lookup.messageId, automatic_retry: false } });
      return json(200, { ok: true, result: "RECONCILED_FOUND", provider_message_id: lookup.messageId, lookup_found: true, automatic_retry: false, version: VERSION });
    } catch (error: any) {
      return json(502, { ok: false, result: "UNKNOWN_HOLD", error: String(error?.message || "RECONCILE_FAILED"), automatic_retry: false, version: VERSION });
    }
  }

  if (op === "STATUS") {
    const effectKey = String(args.effect_key || "").trim();
    const rows = await sql`SELECT effect_key, claim_token::text AS claim_token, claimant_id, claimed_at, campaign_id, lead_id, destination, message_version, sequence_step, state, runtime_mode, provider_invocation_count, provider_payload_fingerprint, provider_correlation_id, provider_rfc_message_id, provider_message_id, provider_attempt_reserved_at, updated_at FROM outreach_effects WHERE effect_key=${effectKey} LIMIT 1`;
    return json(200, { ok: true, result: rows[0] ? "FOUND" : "ABSENT", effect: rows[0] || null, provider_send_called: false, automatic_retry: false, version: VERSION });
  }

  if (op === "AUDIT_READ") {
    const effectKey = String(args.effect_key || "").trim();
    const events = await sql`SELECT event_id::text AS event_id, effect_key, operation, result, claim_token::text AS claim_token, claimant_id, provider_invocation_count, metadata, occurred_at FROM outreach_effect_events WHERE effect_key=${effectKey} ORDER BY occurred_at ASC`;
    return json(200, { ok: true, result: "AUDIT", events, automatic_retry: false, version: VERSION });
  }

  return json(400, { ok: false, error: "UNKNOWN_OPERATION", version: VERSION, provider_send_called: false, automatic_retry: false });
};

export const config = { path: "/slice01" };
