import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { PostgresClaimStore } from "../src/postgres-claim-store.js";
import {
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_ID,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_SHA256,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,
  GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,
  LEGACY_ZERO_PROVIDER_IMPORT_KIND,
  ZERO_PROVIDER_RECOVERY_KIND
} from "../src/adapter.js";

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

test("real Postgres zero-provider recovery is exact, atomic, same-claim and one-shot", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresClaimStore({ pool });
  const effectKey = GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY;
  const claimToken = "44444444-4444-4444-8444-444444444444";
  const claimantId = "original-motek-claimant";
  const payloadFingerprint = "d".repeat(64);
  const payload = {
    campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",
    leadId:"LEAD-ANCHOR-20260819-001",
    destination:"info@motek.com",
    messageVersion:"FOLLOW-UP-ADAPTIVE-v1.0",
    sequenceStep:"FOLLOW-UP-1",
    runtimeMode:"zero-send"
  };
  const recoveryAuthority = {kind:ZERO_PROVIDER_RECOVERY_KIND,effectKey};

  async function createSchema() {
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
  }

  async function seed({state="RECONCILED",providerInvocationCount=0,providerIdentity=false,events=[["RECONCILE","CLOSED_NO_PROVIDER_EFFECT",0]]}={}) {
    await pool.query("DELETE FROM outreach_effect_events");
    await pool.query("DELETE FROM outreach_effects");
    await pool.query(
      `INSERT INTO outreach_effects(
        effect_key,state,claim_token,claimant_id,claimed_at,campaign_id,lead_id,destination,message_version,
        sequence_step,runtime_mode,provider_invocation_count,provider_payload_fingerprint,
        provider_correlation_id,provider_rfc_message_id,provider_attempt_reserved_at,provider_message_id,updated_at
      ) VALUES ($1,$2,$3::uuid,$4,'2026-09-09T06:07:26.457Z',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
      [
        effectKey,state,claimToken,claimantId,payload.campaignId,payload.leadId,payload.destination,payload.messageVersion,
        payload.sequenceStep,payload.runtimeMode,providerInvocationCount,payloadFingerprint,
        providerIdentity?"corr-1":null,providerIdentity?"<provider-1@jefscouting.com>":null,
        providerIdentity?"2026-09-09T07:00:00Z":null,providerIdentity?"gmail-1":null
      ]
    );
    for (const [operation,result,count] of events) {
      await pool.query(
        `INSERT INTO outreach_effect_events(
          effect_key,operation,result,claim_token,claimant_id,provider_invocation_count,metadata,occurred_at
        ) VALUES ($1,$2,$3,$4::uuid,$5,$6,'{}'::jsonb,NOW())`,
        [effectKey,operation,result,claimToken,claimantId,count]
      );
    }
  }

  const attempt = () => store.claim({payload,effectKey,claimantId,claimToken,payloadFingerprint,recoveryAuthority});
  try {
    await createSchema();
    await seed();
    const before = await pool.query("SELECT claim_token::text, claimant_id, claimed_at FROM outreach_effects WHERE effect_key=$1",[effectKey]);
    const [a,b] = await Promise.all([attempt(),attempt()]);
    assert.deepEqual([a.result,b.result].sort(),["EXISTS_HOLD","WON"]);

    const after = await pool.query(
      `SELECT state,claim_token::text,claimant_id,claimed_at,provider_invocation_count,
              provider_correlation_id,provider_rfc_message_id,provider_attempt_reserved_at,provider_message_id
         FROM outreach_effects WHERE effect_key=$1`,
      [effectKey]
    );
    assert.equal(after.rows[0].state,"CLAIMED");
    assert.equal(after.rows[0].claim_token,before.rows[0].claim_token);
    assert.equal(after.rows[0].claimant_id,before.rows[0].claimant_id);
    assert.equal(after.rows[0].claimed_at.toISOString(),before.rows[0].claimed_at.toISOString());
    assert.equal(after.rows[0].provider_invocation_count,0);
    assert.equal(after.rows[0].provider_correlation_id,null);
    assert.equal(after.rows[0].provider_rfc_message_id,null);
    assert.equal(after.rows[0].provider_attempt_reserved_at,null);
    assert.equal(after.rows[0].provider_message_id,null);

    const events = await pool.query(
      `SELECT event_id::text,operation,result,provider_invocation_count
         FROM outreach_effect_events WHERE effect_key=$1 ORDER BY event_id`,
      [effectKey]
    );
    assert.equal(events.rows.filter((row)=>row.result==="ZERO_PROVIDER_RECOVERY_WON").length,1);
    assert.equal(events.rows.filter((row)=>["RESERVE_PROVIDER_ATTEMPT","SEND_PROVIDER"].includes(row.operation)).length,0);
    assert.ok(events.rows.every((row)=>Number.isSafeInteger(Number(row.event_id))&&Number(row.event_id)>0));
    assert.equal((await attempt()).result,"EXISTS_HOLD");

    const blocked = [
      {state:"RECONCILED",providerInvocationCount:1,providerIdentity:true},
      {state:"UNKNOWN_HOLD",providerInvocationCount:0},
      {state:"ACCEPTED",providerInvocationCount:1,providerIdentity:true},
      {state:"RECONCILED",events:[["RECONCILE","RECONCILED_FOUND",1]]},
      {state:"RECONCILED",events:[["RECONCILE","CLOSED_NO_PROVIDER_EFFECT",0],["SEND_PROVIDER","UNKNOWN_HOLD",1]]},
      {state:"RECONCILED",events:[["RECONCILE","CLOSED_NO_PROVIDER_EFFECT",0],["RESERVE_PROVIDER_ATTEMPT","RESERVED",1]]}
    ];
    for (const scenario of blocked) {
      await seed(scenario);
      assert.equal((await attempt()).result,"EXISTS_HOLD");
      const readback=await pool.query("SELECT state,provider_invocation_count FROM outreach_effects WHERE effect_key=$1",[effectKey]);
      assert.equal(readback.rows[0].state,scenario.state);
      assert.equal(readback.rows[0].provider_invocation_count,scenario.providerInvocationCount??0);
      const recoveryEvents=await pool.query("SELECT count(*)::int AS n FROM outreach_effect_events WHERE result='ZERO_PROVIDER_RECOVERY_WON'");
      assert.equal(recoveryEvents.rows[0].n,0);
    }

    for (const unrelatedEffectKey of [
      "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-ANCHOR-20260819-002|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1",
      "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-20260810-CHATEAU-ZZS|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1"
    ]) {
      await assert.rejects(
        store.claim({
          payload:{...payload,leadId:unrelatedEffectKey.split("|")[2]},
          effectKey:unrelatedEffectKey,
          claimantId,
          claimToken,
          payloadFingerprint,
          recoveryAuthority:{kind:ZERO_PROVIDER_RECOVERY_KIND,effectKey:unrelatedEffectKey}
        }),
        /ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/
      );
    }
  } finally {
    await pool.end();
  }
});

test("real Postgres imports exact legacy zero-provider history and issues one distinct fresh claim", { skip: !databaseUrl }, async () => {
  const pool=new Pool({connectionString:databaseUrl});
  const store=new PostgresClaimStore({pool});
  const effectKey=GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY;
  const claimToken="55555555-5555-4555-8555-555555555555";
  const claimantId="fresh-recovery-worker";
  const payloadFingerprint="e".repeat(64);
  const payload={
    campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",
    leadId:"LEAD-ANCHOR-20260819-001",
    destination:"info@motek.com",
    messageVersion:"FOLLOW-UP-ADAPTIVE-v1.1",
    sequenceStep:"FOLLOW-UP-1",
    runtimeMode:"manual",
    airtableActivityRecordId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,
    gmailThreadId:"1a0193666357e1f4"
  };
  const recoveryAuthority={
    kind:LEGACY_ZERO_PROVIDER_IMPORT_KIND,
    effectKey,
    activityRecordId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,
    evidenceCommentId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_ID,
    evidenceCommentSha256:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_SHA256,
    historicalClaimExistence:"VERIFIED",
    historicalClaimIdentity:"UNAVAILABLE",
    providerInvocationCount:0,
    gmailSentCount:0,
    sameClaimPreserved:false
  };
  const attempt=()=>store.claim({payload,effectKey,claimantId,claimToken,payloadFingerprint,recoveryAuthority});
  async function createSchema(){
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
  }
  async function seedExisting({providerInvocationCount=0,providerCorrelationId=null,providerRfcMessageId=null,providerReservedAt=null,providerMessageId=null}={}){
    await pool.query("DELETE FROM outreach_effect_events");
    await pool.query("DELETE FROM outreach_effects");
    await pool.query(
      `INSERT INTO outreach_effects(
        effect_key,state,claim_token,claimant_id,claimed_at,campaign_id,lead_id,destination,message_version,
        sequence_step,runtime_mode,provider_invocation_count,provider_payload_fingerprint,
        provider_correlation_id,provider_rfc_message_id,provider_attempt_reserved_at,provider_message_id,updated_at
      ) VALUES ($1,'FAILED',$2::uuid,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
      [effectKey,claimToken,claimantId,payload.campaignId,payload.leadId,payload.destination,payload.messageVersion,
       payload.sequenceStep,payload.runtimeMode,providerInvocationCount,payloadFingerprint,providerCorrelationId,
       providerRfcMessageId,providerReservedAt,providerMessageId]
    );
  }
  try{
    await createSchema();
    const [a,b]=await Promise.all([attempt(),attempt()]);
    assert.deepEqual([a.result,b.result].sort(),["EXISTS_HOLD","WON"]);
    const winner=[a,b].find((item)=>item.result==="WON");
    assert.equal(winner.recovery,LEGACY_ZERO_PROVIDER_IMPORT_KIND);
    assert.equal(winner.record.claim_token,claimToken);
    assert.equal(winner.record.claimant_id,claimantId);
    assert.equal(winner.record.provider_invocation_count,0);

    const effects=await pool.query(
      `SELECT state,claim_token::text,claimant_id,provider_invocation_count,provider_correlation_id,
              provider_rfc_message_id,provider_attempt_reserved_at,provider_message_id
         FROM outreach_effects WHERE effect_key=$1`,[effectKey]
    );
    assert.equal(effects.rowCount,1);
    assert.equal(effects.rows[0].state,"CLAIMED");
    assert.equal(effects.rows[0].claim_token,claimToken);
    assert.equal(effects.rows[0].claimant_id,claimantId);
    assert.equal(effects.rows[0].provider_invocation_count,0);
    for(const field of ["provider_correlation_id","provider_rfc_message_id","provider_attempt_reserved_at","provider_message_id"]) assert.equal(effects.rows[0][field],null);

    const events=await pool.query(
      `SELECT event_id::text,operation,result,claim_token::text,claimant_id,provider_invocation_count,metadata
         FROM outreach_effect_events WHERE effect_key=$1 ORDER BY event_id`,[effectKey]
    );
    assert.equal(events.rowCount,2);
    const [historical,fresh]=events.rows;
    assert.equal(historical.operation,"RECONCILE");
    assert.equal(historical.result,"CLOSED_NO_PROVIDER_EFFECT");
    assert.equal(historical.claim_token,null);
    assert.equal(historical.claimant_id,null);
    assert.equal(historical.provider_invocation_count,0);
    assert.equal(historical.metadata.historical_claim_existence,"VERIFIED");
    assert.equal(historical.metadata.historical_claim_identity,"UNAVAILABLE");
    assert.equal(historical.metadata.gmail_sent_count,0);
    assert.equal(historical.metadata.same_claim_preserved,false);
    assert.equal(historical.metadata.imported_legacy_history,true);
    assert.equal(historical.metadata.activity_record_id,GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID);
    assert.equal(historical.metadata.evidence_comment_sha256,GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_SHA256);
    assert.equal(fresh.operation,"CLAIM");
    assert.equal(fresh.result,"LEGACY_ZERO_PROVIDER_RECOVERY_WON");
    assert.equal(fresh.claim_token,claimToken);
    assert.equal(fresh.claimant_id,claimantId);
    assert.equal(fresh.metadata.fresh_recovery_claim,true);
    assert.equal(fresh.metadata.historical_claim_identity,"UNAVAILABLE");
    assert.equal(fresh.metadata.same_claim_preserved,false);
    assert.ok(Number(historical.event_id)<Number(fresh.event_id));
    assert.equal((await attempt()).result,"EXISTS_HOLD");

    const identity={correlationId:"jef-outreach-v2-legacy-import",rfcMessageId:"<jef-outreach-v2-legacy-import@jefscouting.com>"};
    assert.equal((await store.reserveProviderAttempt({effectKey,claimToken,identity,payloadFingerprint})).result,"RESERVED");
    const secondReservation=await store.reserveProviderAttempt({effectKey,claimToken,identity,payloadFingerprint});
    assert.equal(secondReservation.result,"EXISTS_HOLD");
    assert.equal(secondReservation.providerInvocationCount,1);

    for(const providerHistory of [
      {providerInvocationCount:1},
      {providerCorrelationId:"corr-existing"},
      {providerRfcMessageId:"<existing@jefscouting.com>"},
      {providerReservedAt:"2026-09-10T00:00:00Z"},
      {providerMessageId:"gmail-existing"}
    ]){
      await seedExisting(providerHistory);
      assert.equal((await attempt()).result,"EXISTS_HOLD");
      const count=await pool.query("SELECT count(*)::int AS n FROM outreach_effect_events WHERE effect_key=$1",[effectKey]);
      assert.equal(count.rows[0].n,0);
    }

    await pool.query("DELETE FROM outreach_effect_events");
    await pool.query("DELETE FROM outreach_effects");
    for(const invalidAuthority of [
      {...recoveryAuthority,evidenceCommentId:undefined},
      {...recoveryAuthority,evidenceCommentSha256:"0".repeat(64)},
      {...recoveryAuthority,historicalClaimExistence:"UNKNOWN"},
      {...recoveryAuthority,historicalClaimIdentity:"PRESERVED"},
      {...recoveryAuthority,providerInvocationCount:1},
      {...recoveryAuthority,gmailSentCount:1},
      {...recoveryAuthority,sameClaimPreserved:true}
    ]) await assert.rejects(
      store.claim({payload,effectKey,claimantId,claimToken,payloadFingerprint,recoveryAuthority:invalidAuthority}),
      /ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/
    );
    await assert.rejects(
      store.claim({payload:{...payload,leadId:"LEAD-OTHER"},effectKey:"OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-OTHER|FOLLOW-UP-ADAPTIVE-v1.1|FOLLOW-UP-1",claimantId,claimToken,payloadFingerprint,recoveryAuthority:{...recoveryAuthority,effectKey:"OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-OTHER|FOLLOW-UP-ADAPTIVE-v1.1|FOLLOW-UP-1"}}),
      /ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/
    );
    await assert.rejects(
      store.claim({payload:{campaignId:"campaign",leadId:"lead",destination:"person@example.com",messageVersion:"v1",sequenceStep:"FOLLOW-UP-1",runtimeMode:"manual",airtableActivityRecordId:"recAAAAAAAAAAAAAA",gmailThreadId:"thread"},effectKey:"OUTREACH-SEND|campaign|lead|v1|FOLLOW-UP-1",claimantId,claimToken,payloadFingerprint,recoveryAuthority}),
      /ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/
    );
  }finally{await pool.end();}
});
