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
    await pool.query("DROP TABLE IF EXISTS outreach_effects");
    await pool.query(`
      CREATE TABLE outreach_effects (
        effect_key text PRIMARY KEY,
        state text NOT NULL,
        claim_token uuid,
        provider_invocation_count integer NOT NULL DEFAULT 0 CHECK (provider_invocation_count IN (0,1)),
        provider_payload_fingerprint text,
        provider_correlation_id text,
        provider_rfc_message_id text,
        provider_attempt_reserved_at timestamptz
      )
    `);
    await pool.query(
      "INSERT INTO outreach_effects(effect_key,state,claim_token,provider_invocation_count) VALUES ($1,'CLAIMED',$2::uuid,0)",
      [effectKey, claimToken]
    );

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

    const replay = await store.reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint });
    assert.equal(replay.result, "EXISTS_HOLD");
    assert.equal(replay.providerInvocationCount, 1);
  } finally {
    await pool.end();
  }
});
