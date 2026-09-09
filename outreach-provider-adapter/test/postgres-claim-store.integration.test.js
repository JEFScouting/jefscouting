import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { PostgresClaimStore } from "../src/postgres-claim-store.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;

test("real Postgres same-EffectKey contention yields one reservation and one loser HOLD", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresClaimStore({ pool });

  const effectKey = "OUTREACH-SEND|uat-campaign|uat-lead|v1|FU1";
  const claimToken = "22222222-2222-4222-8222-222222222222";
  const identity = {
    correlationId: "jef-outreach-v2-uat-concurrency",
    rfcMessageId: "<jef-outreach-v2-uat-concurrency@jefscouting.com>"
  };
  const payloadFingerprint = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  try {
    await pool.query("DROP TABLE IF EXISTS outreach_effect_events");
    await pool.query("DROP TABLE IF EXISTS outreach_effects");
    await pool.query(`
      CREATE TABLE outreach_effects (
        effect_key text PRIMARY KEY,
        state text NOT NULL,
        claim_token uuid,
        claimant_id text,
        claimed_at timestamptz,
        campaign_id text,
        lead_id text,
        destination text,
        message_version text,
        sequence_step text,
        runtime_mode text,
        provider_invocation_count integer NOT NULL DEFAULT 0 CHECK (provider_invocation_count IN (0,1)),
        provider_payload_fingerprint text,
        provider_correlation_id text,
        provider_rfc_message_id text,
        provider_attempt_reserved_at timestamptz,
        provider_message_id text,
        last_error text,
        updated_at timestamptz
      )
    `);
    await pool.query(
      "INSERT INTO outreach_effects(effect_key,state,claim_token,provider_invocation_count) VALUES ($1,'CLAIMED',$2::uuid,0)",
      [effectKey, claimToken]
    );
    await pool.query(`CREATE TABLE outreach_effect_events (
      event_id bigserial PRIMARY KEY, effect_key text REFERENCES outreach_effects(effect_key), operation text, result text,
      claim_token uuid, claimant_id text, provider_invocation_count integer, metadata jsonb, occurred_at timestamptz)`);

    const [a, b] = await Promise.all([
      store.reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint }),
      store.reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint })
    ]);

    const results = [a.result, b.result].sort();
    assert.deepEqual(results, ["EXISTS_HOLD", "RESERVED"]);

    const readback = await pool.query(
      "SELECT provider_invocation_count, provider_payload_fingerprint, provider_correlation_id, provider_rfc_message_id FROM outreach_effects WHERE effect_key=$1",
      [effectKey]
    );
    assert.equal(readback.rowCount, 1);
    assert.equal(readback.rows[0].provider_invocation_count, 1);
    assert.equal(readback.rows[0].provider_payload_fingerprint, payloadFingerprint);
    assert.equal(readback.rows[0].provider_correlation_id, identity.correlationId);
    assert.equal(readback.rows[0].provider_rfc_message_id, identity.rfcMessageId);

    const eventIds = await pool.query("SELECT event_id FROM outreach_effect_events WHERE effect_key=$1 ORDER BY event_id", [effectKey]);
    assert.ok(eventIds.rowCount >= 2);
    assert.ok(eventIds.rows.every((row) => Number.isSafeInteger(Number(row.event_id)) && Number(row.event_id) > 0));

    const replay = await store.reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint });
    assert.equal(replay.result, "EXISTS_HOLD");
    assert.equal(replay.providerInvocationCount, 1);
  } finally {
    await pool.end();
  }
});

test("real Postgres atomic claim yields exactly one winner and replay HOLD", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresClaimStore({ pool });
  const payload = { campaignId:"campaign", leadId:"lead", destination:"person@example.com", messageVersion:"v1", sequenceStep:"FIRST-TOUCH", runtimeMode:"production" };
  const effectKey = "OUTREACH-SEND|campaign|lead|v1|FIRST-TOUCH";
  try {
    await pool.query("DROP TABLE IF EXISTS outreach_effect_events");
    await pool.query("DROP TABLE IF EXISTS outreach_effects");
    await pool.query(`CREATE TABLE outreach_effects (
      effect_key text PRIMARY KEY, state text NOT NULL, claim_token uuid, claimant_id text, claimed_at timestamptz,
      campaign_id text, lead_id text, destination text, message_version text, sequence_step text, runtime_mode text,
      provider_invocation_count integer NOT NULL DEFAULT 0 CHECK (provider_invocation_count IN (0,1)),
      provider_payload_fingerprint text, provider_correlation_id text, provider_rfc_message_id text,
      provider_attempt_reserved_at timestamptz, provider_message_id text, last_error text, updated_at timestamptz)`);
    await pool.query(`CREATE TABLE outreach_effect_events (
      event_id bigserial PRIMARY KEY, effect_key text REFERENCES outreach_effects(effect_key), operation text, result text,
      claim_token uuid, claimant_id text, provider_invocation_count integer, metadata jsonb, occurred_at timestamptz)`);
    const [a,b] = await Promise.all([
      store.claim({ payload, effectKey, claimantId:"worker-a", claimToken:"11111111-1111-4111-8111-111111111111", payloadFingerprint:"a".repeat(64) }),
      store.claim({ payload, effectKey, claimantId:"worker-b", claimToken:"22222222-2222-4222-8222-222222222222", payloadFingerprint:"a".repeat(64) })
    ]);
    assert.deepEqual([a.result,b.result].sort(), ["EXISTS_HOLD","WON"]);
    const replay = await store.claim({ payload, effectKey, claimantId:"worker-c", claimToken:"33333333-3333-4333-8333-333333333333", payloadFingerprint:"a".repeat(64) });
    assert.equal(replay.result,"EXISTS_HOLD");
    const readback=await pool.query("SELECT count(*)::int AS n FROM outreach_effects WHERE effect_key=$1",[effectKey]);
    assert.equal(readback.rows[0].n,1);
    const events=await pool.query("SELECT event_id, result FROM outreach_effect_events WHERE effect_key=$1 ORDER BY event_id",[effectKey]);
    assert.equal(events.rowCount,3);
    assert.ok(events.rows.every((row) => Number.isSafeInteger(Number(row.event_id)) && Number(row.event_id) > 0));
    assert.equal(events.rows.filter((row)=>row.result==="WON").length,1);
    assert.equal(events.rows.filter((row)=>row.result==="EXISTS_HOLD").length,2);
  } finally { await pool.end(); }
});
