export class PostgresClaimStore {
  constructor({ pool, tableName = "outreach_effects", eventTableName = "outreach_effect_events" }) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("POSTGRES_POOL_REQUIRED");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new TypeError("SAFE_TABLE_NAME_REQUIRED");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(eventTableName)) throw new TypeError("SAFE_EVENT_TABLE_NAME_REQUIRED");
    this.pool = pool;
    this.tableName = tableName;
    this.eventTableName = eventTableName;
  }

  async recordEvent({ effectKey, operation, result, claimToken, claimantId, providerInvocationCount, metadata = {} }) {
    await this.pool.query(
      `INSERT INTO ${this.eventTableName} (effect_key,operation,result,claim_token,claimant_id,provider_invocation_count,metadata,occurred_at)
       VALUES ($1,$2,$3,$4::uuid,$5,$6,$7::jsonb,NOW())`,
      [effectKey, operation, result, claimToken, claimantId, providerInvocationCount, JSON.stringify(metadata)]
    );
  }

  async claim({ payload, effectKey, claimantId, claimToken, payloadFingerprint }) {
    if (!payload || !effectKey || !claimantId || !claimToken || !payloadFingerprint) {
      throw new TypeError("CLAIM_IDENTITY_REQUIRED");
    }
    const claimed = await this.pool.query(
      `INSERT INTO ${this.tableName} (
         effect_key, claim_token, claimant_id, claimed_at, campaign_id, lead_id,
         destination, message_version, sequence_step, state, runtime_mode,
         provider_invocation_count, provider_payload_fingerprint, updated_at
       ) VALUES ($1,$2::uuid,$3,NOW(),$4,$5,$6,$7,$8,'CLAIMED',$9,0,$10,NOW())
       ON CONFLICT (effect_key) DO NOTHING
       RETURNING effect_key, claim_token::text, claimant_id, state,
                 provider_invocation_count, provider_payload_fingerprint`,
      [effectKey, claimToken, claimantId, payload.campaignId, payload.leadId,
       payload.destination, payload.messageVersion, payload.sequenceStep, payload.runtimeMode, payloadFingerprint]
    );
    if (claimed.rowCount === 1) {
      await this.recordEvent({ effectKey, operation:"CLAIM", result:"WON", claimToken, claimantId, providerInvocationCount:0 });
      return { result: "WON", record: claimed.rows[0] };
    }
    const current = await this.pool.query(
      `SELECT effect_key, claim_token::text, claimant_id, state,
              provider_invocation_count, provider_payload_fingerprint
         FROM ${this.tableName} WHERE effect_key=$1`,
      [effectKey]
    );
    await this.recordEvent({ effectKey, operation:"CLAIM", result:"EXISTS_HOLD", claimToken, claimantId, providerInvocationCount:current.rows[0]?.provider_invocation_count ?? 0 });
    return { result: "EXISTS_HOLD", record: current.rows[0] ?? null };
  }

  async reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint }) {
    if (!effectKey || !claimToken || !identity?.correlationId || !identity?.rfcMessageId || !payloadFingerprint) {
      throw new TypeError("PROVIDER_RESERVATION_IDENTITY_REQUIRED");
    }

    const reserved = await this.pool.query(
      `UPDATE ${this.tableName}
          SET provider_invocation_count = 1,
              state = 'INVOCATION_STARTED',
              provider_payload_fingerprint = $3,
              provider_correlation_id = $4,
              provider_rfc_message_id = $5,
              provider_attempt_reserved_at = NOW(), updated_at = NOW()
        WHERE effect_key = $1
          AND claim_token = $2::uuid
          AND provider_invocation_count = 0
          AND state = 'CLAIMED'
      RETURNING effect_key, claim_token, claimant_id, provider_invocation_count,
                provider_payload_fingerprint, provider_correlation_id,
                provider_rfc_message_id, provider_attempt_reserved_at`,
      [effectKey, claimToken, payloadFingerprint, identity.correlationId, identity.rfcMessageId]
    );

    if (reserved.rowCount === 1) {
      await this.recordEvent({ effectKey, operation:"RESERVE_PROVIDER_ATTEMPT", result:"RESERVED", claimToken, claimantId:reserved.rows[0].claimant_id || "canonical-adapter", providerInvocationCount:1, metadata:{ correlation_id:identity.correlationId, rfc_message_id:identity.rfcMessageId } });
      return { result: "RESERVED", providerInvocationCount: reserved.rows[0].provider_invocation_count, record: reserved.rows[0] };
    }

    const current = await this.pool.query(
      `SELECT effect_key, claim_token, claimant_id, state, provider_invocation_count,
              provider_payload_fingerprint, provider_correlation_id,
              provider_rfc_message_id, provider_attempt_reserved_at
         FROM ${this.tableName}
        WHERE effect_key = $1`,
      [effectKey]
    );

    await this.recordEvent({ effectKey, operation:"RESERVE_PROVIDER_ATTEMPT", result:"EXISTS_HOLD", claimToken, claimantId:current.rows[0]?.claimant_id || "canonical-adapter", providerInvocationCount:current.rows[0]?.provider_invocation_count ?? 0 });
    return {
      result: "EXISTS_HOLD",
      providerInvocationCount: current.rows[0]?.provider_invocation_count ?? null,
      record: current.rows[0] ?? null
    };
  }

  async confirmProviderOutcome({ effectKey, claimToken, identity, payloadFingerprint, providerMessageId, outcome }) {
    const result = await this.pool.query(
      `UPDATE ${this.tableName}
          SET state=$7, provider_message_id=$6, last_error=NULL, updated_at=NOW()
        WHERE effect_key=$1 AND claim_token=$2::uuid
          AND provider_invocation_count=1
          AND provider_payload_fingerprint=$3
          AND provider_correlation_id=$4
          AND provider_rfc_message_id=$5
          AND state IN ('CLAIMED','INVOCATION_STARTED','UNKNOWN_HOLD')
        RETURNING effect_key, claimant_id, state, provider_message_id, provider_invocation_count`,
      [effectKey, claimToken, payloadFingerprint, identity?.correlationId, identity?.rfcMessageId, providerMessageId, outcome === "RECONCILED_SENT" ? "RECONCILED" : "ACCEPTED"]
    );
    if (result.rowCount !== 1) throw new TypeError("PROVIDER_CONFIRMATION_FENCE_LOST");
    await this.recordEvent({ effectKey, operation:outcome === "RECONCILED_SENT" ? "RECONCILE" : "SEND_PROVIDER", result:outcome === "RECONCILED_SENT" ? "RECONCILED_FOUND" : "ACCEPTED", claimToken, claimantId:result.rows[0].claimant_id || "canonical-adapter", providerInvocationCount:1, metadata:{provider_message_id:providerMessageId} });
    return { ...result.rows[0], outcome };
  }

  async holdUnknownProviderOutcome({ effectKey, claimToken, identity, payloadFingerprint, reason }) {
    const result = await this.pool.query(
      `UPDATE ${this.tableName}
          SET state='UNKNOWN_HOLD', last_error=$6, updated_at=NOW()
        WHERE effect_key=$1 AND claim_token=$2::uuid
          AND provider_invocation_count=1
          AND provider_payload_fingerprint=$3
          AND provider_correlation_id=$4
          AND provider_rfc_message_id=$5
          AND state IN ('CLAIMED','INVOCATION_STARTED')
        RETURNING effect_key, claimant_id, state, provider_invocation_count`,
      [effectKey, claimToken, payloadFingerprint, identity?.correlationId, identity?.rfcMessageId, reason]
    );
    if (result.rowCount !== 1) throw new TypeError("UNKNOWN_HOLD_FENCE_LOST");
    await this.recordEvent({ effectKey, operation:"SEND_PROVIDER", result:"UNKNOWN_HOLD", claimToken, claimantId:result.rows[0].claimant_id || "canonical-adapter", providerInvocationCount:1, metadata:{reason,automatic_retry:false} });
    return result.rows[0];
  }

  async failProviderAttemptNoRetry({ effectKey, claimToken, identity, payloadFingerprint, reason }) {
    const result = await this.pool.query(
      `UPDATE ${this.tableName}
          SET state='FAILED', last_error=$6, updated_at=NOW()
        WHERE effect_key=$1 AND claim_token=$2::uuid
          AND provider_invocation_count=1
          AND provider_payload_fingerprint=$3
          AND provider_correlation_id=$4
          AND provider_rfc_message_id=$5
          AND state IN ('CLAIMED','INVOCATION_STARTED')
        RETURNING effect_key, claimant_id, state, provider_invocation_count`,
      [effectKey, claimToken, payloadFingerprint, identity?.correlationId, identity?.rfcMessageId, reason]
    );
    if (result.rowCount !== 1) throw new TypeError("FAILURE_FENCE_LOST");
    await this.recordEvent({ effectKey, operation:"SEND_PROVIDER", result:"FAILED", claimToken, claimantId:result.rows[0].claimant_id || "canonical-adapter", providerInvocationCount:1, metadata:{reason,automatic_retry:false} });
    return result.rows[0];
  }

  async readForReconciliation({ effectKey, claimToken }) {
    const result = await this.pool.query(
      `SELECT effect_key, state, provider_invocation_count AS "providerInvocationCount",
              provider_payload_fingerprint AS "payloadFingerprint",
              provider_correlation_id, provider_rfc_message_id
         FROM ${this.tableName}
        WHERE effect_key=$1 AND claim_token=$2::uuid`,
      [effectKey, claimToken]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      identity: row.provider_correlation_id && row.provider_rfc_message_id
        ? { correlationId: row.provider_correlation_id, rfcMessageId: row.provider_rfc_message_id }
        : null
    };
  }
}
