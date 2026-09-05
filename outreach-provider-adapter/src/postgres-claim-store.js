export class PostgresClaimStore {
  constructor({ pool, tableName = "outreach_effects" }) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("POSTGRES_POOL_REQUIRED");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new TypeError("SAFE_TABLE_NAME_REQUIRED");
    this.pool = pool;
    this.tableName = tableName;
  }

  async reserveProviderAttempt({ effectKey, claimToken, identity, payloadFingerprint }) {
    if (!effectKey || !claimToken || !identity?.correlationId || !identity?.rfcMessageId || !payloadFingerprint) {
      throw new TypeError("PROVIDER_RESERVATION_IDENTITY_REQUIRED");
    }

    const reserved = await this.pool.query(
      `UPDATE ${this.tableName}
          SET provider_invocation_count = 1,
              provider_payload_fingerprint = $3,
              provider_correlation_id = $4,
              provider_rfc_message_id = $5,
              provider_attempt_reserved_at = NOW()
        WHERE effect_key = $1
          AND claim_token = $2::uuid
          AND provider_invocation_count = 0
          AND state = 'CLAIMED'
      RETURNING effect_key, claim_token, provider_invocation_count,
                provider_payload_fingerprint, provider_correlation_id,
                provider_rfc_message_id, provider_attempt_reserved_at`,
      [effectKey, claimToken, payloadFingerprint, identity.correlationId, identity.rfcMessageId]
    );

    if (reserved.rowCount === 1) {
      return { result: "RESERVED", providerInvocationCount: reserved.rows[0].provider_invocation_count, record: reserved.rows[0] };
    }

    const current = await this.pool.query(
      `SELECT effect_key, claim_token, state, provider_invocation_count,
              provider_payload_fingerprint, provider_correlation_id,
              provider_rfc_message_id, provider_attempt_reserved_at
         FROM ${this.tableName}
        WHERE effect_key = $1`,
      [effectKey]
    );

    return {
      result: "EXISTS_HOLD",
      providerInvocationCount: current.rows[0]?.provider_invocation_count ?? null,
      record: current.rows[0] ?? null
    };
  }
}
